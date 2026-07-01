import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, goals, handoffs as handoffsTable, tasks, type TaskStatus, type TaskVerificationSummary } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import { handoffService } from "../services/handoff-service.js";
import { callLlm } from "../services/llm-client.js";
import { buildVerifySummaryPrompt, verifyTask } from "../services/verification-runner.js";
import { goalProgressService } from "../services/goal-progress.js";
import { legionMergeService } from "../services/legion-merge.js";

const TERMINAL_STATUSES = new Set(["done", "failed", "blocked"]);

type TaskRow = typeof tasks.$inferSelect;
type GoalRow = typeof goals.$inferSelect;

async function getTaskAndGoal(db: Db, taskId: string): Promise<{ task: TaskRow; goal: GoalRow } | null> {
  const rows = await db
    .select({ task: tasks, goal: goals })
    .from(tasks)
    .innerJoin(goals, eq(tasks.goalId, goals.id))
    .where(eq(tasks.id, taskId));

  return rows[0] ?? null;
}

export function legionTaskRoutes(db: Db): Router {
  const router = Router();
  const handoffs = handoffService(db);
  const goalProgress = goalProgressService(db);
  const merge = legionMergeService(db);

  router.get("/legion/tasks", async (req, res) => {
    try {
      const companyId = typeof req.query.companyId === "string" ? req.query.companyId : null;
      if (companyId) assertCompanyAccess(req, companyId);
      const rows = await db
        .select({ task: tasks, goal: goals })
        .from(tasks)
        .innerJoin(goals, eq(tasks.goalId, goals.id))
        .orderBy(desc(tasks.updatedAt));
      const scoped = companyId ? rows.filter((row) => row.goal.companyId === companyId) : rows;
      res.json(scoped.map((row) => ({ ...row.task, goal: row.goal })));
    } catch (err) {
      console.error("list legion tasks error:", err);
      res.status(500).json({ error: "failed to list legion tasks" });
    }
  });

  router.get("/tasks/:id", async (req, res) => {
    try {
      const row = await getTaskAndGoal(db, req.params.id as string);
      if (!row) {
        res.status(404).json({ error: "Task not found" });
        return;
      }
      assertCompanyAccess(req, row.goal.companyId);
      res.json(row.task);
    } catch (err) {
      console.error("get task error:", err);
      res.status(500).json({ error: "failed to get task" });
    }
  });

  router.patch("/tasks/:id/status", async (req, res) => {
    try {
      const status = (req.body as { status?: unknown }).status;
      if (typeof status !== "string" || !TERMINAL_STATUSES.has(status)) {
        res.status(400).json({ error: "status must be one of: done, failed, blocked" });
        return;
      }

      const row = await getTaskAndGoal(db, req.params.id as string);
      if (!row) {
        res.status(404).json({ error: "Task not found" });
        return;
      }
      assertCompanyAccess(req, row.goal.companyId);

      const updated = await db
        .update(tasks)
        .set({
          status: status as TaskStatus,
          updatedAt: new Date(),
          completedAt: status === "done" ? new Date() : null,
        })
        .where(eq(tasks.id, row.task.id))
        .returning()
        .then((rows) => rows[0] ?? null);

      res.json(updated);
    } catch (err) {
      console.error("update task status error:", err);
      res.status(500).json({ error: "failed to update task status" });
    }
  });

  router.get("/tasks/:id/handoffs", async (req, res) => {
    try {
      const row = await getTaskAndGoal(db, req.params.id as string);
      if (!row) {
        res.status(404).json({ error: "Task not found" });
        return;
      }
      assertCompanyAccess(req, row.goal.companyId);
      res.json(await handoffs.getTaskHandoffs(row.task.id));
    } catch (err) {
      console.error("get task handoffs error:", err);
      res.status(500).json({ error: "failed to get task handoffs" });
    }
  });

  router.post("/tasks/:id/verify", async (req, res) => {
    try {
      const row = await getTaskAndGoal(db, req.params.id as string);
      if (!row) {
        res.status(404).json({ error: "Task not found" });
        return;
      }
      assertCompanyAccess(req, row.goal.companyId);

      if (!row.task.verificationSpec) {
        res.status(422).json({
          error:
            "task has no structured verification_spec; refusing to verify on LLM self-judgment alone. Add a verification_spec via PATCH /tasks/:id or PATCH /api/legion/tasks/:id.",
        });
        return;
      }

      const body = (req.body ?? {}) as {
        worktreeCwd?: string;
        notes?: string;
        skipLlmSummary?: boolean;
      };

      // 1. Hard verification — exit codes / probe results are the source of truth.
      const runner = await verifyTask(db, row.task.id, {
        worktreeCwd: typeof body.worktreeCwd === "string" ? body.worktreeCwd : undefined,
        notes: typeof body.notes === "string" ? body.notes : undefined,
      });

      // 2. Optional LLM summary — interpret only, NEVER override hard result.
      let llmSummary: TaskVerificationSummary | null = null;
      if (!body.skipLlmSummary) {
        const { system, user } = buildVerifySummaryPrompt(runner.evidence);
        try {
          const llm = await callLlm([
            { role: "system", content: system },
            { role: "user", content: user },
          ]);
          const parsed = parseLlmSummary(llm.content);
          // Hard guarantee: LLM can never flip a fail into a pass.
          llmSummary = {
            passed: runner.passed,
            summary: parsed?.summary ?? llm.content,
            issues: runner.passed ? [] : parsed?.issues ?? [llm.content],
          };
        } catch (llmErr) {
          console.warn(`LLM summarize failed for task ${row.task.id}; using runner result only:`, llmErr);
          llmSummary = {
            passed: runner.passed,
            summary: runner.passed ? "Hard verification passed; LLM summary unavailable." : "Hard verification failed; LLM summary unavailable.",
            issues: runner.passed
              ? []
              : runner.evidence.checks
                  .filter((c) => !c.passed)
                  .map((c) => `[${c.kind}${c.command ? `: ${c.command}` : c.path ? `: ${c.path}` : c.url ? `: ${c.url}` : ""}] ${c.stderrTail || `exit ${c.exitCode}`}`),
          };
        }
      } else {
        llmSummary = {
          passed: runner.passed,
          summary: runner.passed ? "Hard verification passed; LLM summary skipped." : "Hard verification failed; LLM summary skipped.",
          issues: [],
        };
      }

      // Phase 9: if hard verification passed, flip the task to `done`
      // and update dependent handoffs to `consumed`. Then attempt the
      // auto-merge (Phase 9 closes the PR loop) and advance the parent
      // goal's status machine. The route never blocks on these — they
      // are best-effort post-success hooks whose failures are logged.
      if (runner.passed) {
        try {
          await db
            .update(tasks)
            .set({ status: "actual_passed" as TaskStatus, completedAt: new Date(), updatedAt: new Date() })
            .where(eq(tasks.id, row.task.id));
          // Mark any handoffs this task produced as `consumed` (this is
          // what the task DAG gate checks for downstream consumers).
          const producedHandoffs = await handoffs.getTaskHandoffs(row.task.id);
          for (const h of producedHandoffs) {
            if (h.status === "ready") {
              await db
                .update(handoffsTable)
                .set({ status: "consumed", consumedAt: new Date() })
                .where(eq(handoffsTable.id, h.id));
            }
          }
          const mergeResult = await merge.attemptMerge(row.task.id);
          if (mergeResult.outcome === "merged") {
            console.info(`[legion] merged task ${row.task.id} via PR ${mergeResult.prUrl}`);
          } else if (mergeResult.outcome === "blocked") {
            console.warn(`[legion] task ${row.task.id} verified but merge blocked: ${mergeResult.reason}`);
          }
          await goalProgress.tickGoal(row.goal.id);
        } catch (postErr) {
          console.warn(`[legion] post-verify hook failed for ${row.task.id}:`, postErr);
        }
      } else {
        // Mark verification_failed so monitor/checkRetriableFailures can
        // route the next retry.
        await db
          .update(tasks)
          .set({ status: "failed" as TaskStatus, updatedAt: new Date() })
          .where(eq(tasks.id, row.task.id));
      }

      res.json({
        passed: runner.passed,
        evidence: runner.evidence,
        llmSummary,
        verificationId: runner.verificationId,
      });
    } catch (err) {
      console.error("verify task error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "failed to verify task" });
    }
  });

  router.post("/tasks/:id/reassign", async (req, res) => {
    try {
      const agentId = (req.body as { agentId?: unknown }).agentId;
      if (typeof agentId !== "string" || agentId.trim().length === 0) {
        res.status(400).json({ error: "agentId required" });
        return;
      }

      const row = await getTaskAndGoal(db, req.params.id as string);
      if (!row) {
        res.status(404).json({ error: "Task not found" });
        return;
      }
      assertCompanyAccess(req, row.goal.companyId);

      const targetAgent = await db.select().from(agents).where(eq(agents.id, agentId)).then((rows) => rows[0] ?? null);
      if (!targetAgent) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      if (targetAgent.companyId !== row.goal.companyId) {
        res.status(400).json({ error: "agentId does not belong to task company" });
        return;
      }

      const updated = await db
        .update(tasks)
        .set({
          assigneeAgentId: targetAgent.id,
          status: "in_progress",
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, row.task.id))
        .returning()
        .then((rows) => rows[0] ?? null);

      res.json(updated);
    } catch (err) {
      console.error("reassign task error:", err);
      res.status(500).json({ error: "failed to reassign task" });
    }
  });

  return router;
}

/**
 * Tolerant JSON parser for LLM summary responses. Accepts fenced JSON,
 * bare JSON, and free-form fallback. Never throws — failure is encoded
 * as `null` so the caller can still produce a usable summary from the
 * raw text.
 */
function parseLlmSummary(content: string): { passed?: boolean; summary?: string; issues?: string[] } | null {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1]?.trim() : trimmed;
  if (!candidate) return null;
  try {
    const obj = JSON.parse(candidate) as { passed?: unknown; summary?: unknown; issues?: unknown };
    return {
      passed: typeof obj.passed === "boolean" ? obj.passed : undefined,
      summary: typeof obj.summary === "string" ? obj.summary : undefined,
      issues: Array.isArray(obj.issues) ? obj.issues.filter((s): s is string => typeof s === "string") : undefined,
    };
  } catch {
    return null;
  }
}
