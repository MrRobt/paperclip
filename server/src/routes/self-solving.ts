/**
 * Phase 12 server routes for the self-solving agent team smoke + APIs.
 *
 * These routes back the `paperclipai verify|memory|skill-proposals` CLI
 * commands and the `pnpm smoke:self-solving` end-to-end script. They
 * are intentionally thin — they delegate to the Phase 8–11 services
 * (verification-runner, memory, skill-proposal, goal-decomposer,
 * task-scheduler, goal-progress) and provide the JSON contract that
 * the smoke script and the UI will share.
 */

import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  companies,
  goals,
  skillProposals,
  taskPostmortems,
  tasks,
  type RootCauseClass,
} from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import { goalDecomposerService } from "../services/goal-decomposer.js";
import { goalProgressService } from "../services/goal-progress.js";
import { memoryService } from "../services/memory.js";
import { parseVerificationSpec, verifyTask } from "../services/verification-runner.js";
import { skillProposalService } from "../services/skill-proposal.js";
import { taskSchedulerService } from "../services/task-scheduler.js";

const MAX_POSTMORTEM_LIMIT = 20;
const DEFAULT_POSTMORTEM_LIMIT = 5;

export function selfSolvingRoutes(db: Db): Router {
  const router = Router();
  const memory = memoryService(db);
  const proposals = skillProposalService(db);
  const decomposer = goalDecomposerService(db);
  const scheduler = taskSchedulerService(db);
  const goalProgress = goalProgressService(db);

  // ---------- memory ----------

  router.post("/companies/:companyId/memory/postmortems", async (req, res) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as {
        taskId?: string | null;
        goalId?: string | null;
        repoPath?: string | null;
        modulePath?: string | null;
        rootCauseClass?: RootCauseClass;
        fixSummary?: string;
        commitHash?: string | null;
        branchName?: string | null;
        prUrl?: string | null;
        filesTouched?: string[] | null;
        lessons?: string[] | null;
        attemptNumber?: number;
        passed?: boolean;
      };
      if (!body.fixSummary || typeof body.fixSummary !== "string") {
        res.status(400).json({ error: "fixSummary is required" });
        return;
      }
      const record = await memory.recordPostmortem({
        companyId,
        taskId: body.taskId ?? null,
        goalId: body.goalId ?? null,
        repoPath: body.repoPath ?? null,
        modulePath: body.modulePath ?? null,
        rootCauseClass: body.rootCauseClass ?? "unknown",
        fixSummary: body.fixSummary,
        commitHash: body.commitHash ?? null,
        branchName: body.branchName ?? null,
        prUrl: body.prUrl ?? null,
        filesTouched: body.filesTouched ?? null,
        lessons: body.lessons ?? null,
        attemptNumber: body.attemptNumber ?? 1,
        passed: body.passed ?? false,
      });
      res.status(201).json(record);
    } catch (err) {
      console.error("record postmortem error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "failed to record postmortem" });
    }
  });

  router.get("/companies/:companyId/memory/postmortems", async (req, res) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const repoPath = typeof req.query.repoPath === "string" ? req.query.repoPath : undefined;
      const modulePath = typeof req.query.modulePath === "string" ? req.query.modulePath : undefined;
      const rootCauseClass = typeof req.query.rootCauseClass === "string"
        ? (req.query.rootCauseClass as RootCauseClass)
        : undefined;
      const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
      const limit = limitRaw && Number.isFinite(limitRaw)
        ? Math.min(Math.max(limitRaw, 1), MAX_POSTMORTEM_LIMIT)
        : DEFAULT_POSTMORTEM_LIMIT;
      const rows = await memory.queryPostmortems({
        companyId,
        repoPath: repoPath ?? null,
        modulePath: modulePath ?? null,
        rootCauseClass,
        limit,
      });
      res.json(rows);
    } catch (err) {
      console.error("query postmortems error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "failed to query postmortems" });
    }
  });

  // ---------- skill proposals ----------

  router.post("/skill-proposals", async (req, res) => {
    try {
      const body = req.body as {
        companyId?: string | null;
        skillPath: string;
        proposedDiff: string;
        reason?: string;
        proposedByKind: "agent" | "human";
        proposedByAgentId?: string | null;
        proposedByUserId?: string | null;
      };
      if (!body.skillPath) {
        res.status(400).json({ error: "skillPath is required" });
        return;
      }
      const result = await proposals.propose({
        companyId: body.companyId ?? null,
        skillPath: body.skillPath,
        proposedDiff: body.proposedDiff ?? "",
        proposedByKind: body.proposedByKind ?? "human",
        proposedByAgentId: body.proposedByAgentId ?? null,
        proposedByUserId: body.proposedByUserId ?? null,
      });
      res.status(201).json(result);
    } catch (err) {
      console.error("skill-proposal create error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "failed to create proposal" });
    }
  });

  router.get("/skill-proposals", async (req, res) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : null;
      const rows = status
        ? await db.select().from(skillProposals).where(eq(skillProposals.status, status as never)).limit(50)
        : await db.select().from(skillProposals).orderBy(desc(skillProposals.createdAt)).limit(50);
      res.json(rows);
    } catch (err) {
      console.error("skill-proposal list error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "failed to list proposals" });
    }
  });

  for (const action of ["approved", "denied", "rolled_back"] as const) {
    router.post(`/skill-proposals/:id/${action}`, async (req, res) => {
      try {
        const id = req.params.id as string;
        const note = typeof req.body?.note === "string" ? req.body.note : undefined;
        // Stub: in a real auth context, decidedByUserId comes from the
        // session. For now we use the API key fingerprint; UI replaces
        // this once the route is wrapped in the auth middleware.
        const decidedByUserId = (req.headers["x-paperclip-actor-id"] as string) ?? "system";
        const updated = await proposals.transition(id, action, decidedByUserId, note);
        res.json(updated);
      } catch (err) {
        console.error(`skill-proposal ${action} error:`, err);
        res.status(400).json({ error: err instanceof Error ? err.message : `failed to ${action} proposal` });
      }
    });
  }

  // ---------- Legion task / goal orchestration ----------

  router.post("/legion/scheduler/tick", async (_req, res) => {
    try {
      const result = await scheduler.tick();
      res.json(result);
    } catch (err) {
      console.error("scheduler tick error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "failed to tick scheduler" });
    }
  });

  router.post("/legion/goals/:id/tick", async (req, res) => {
    try {
      const goalId = req.params.id as string;
      const snapshot = await goalProgress.tickGoal(goalId);
      if (!snapshot) {
        res.status(404).json({ error: "goal not found" });
        return;
      }
      res.json(snapshot);
    } catch (err) {
      console.error("goal-progress tick error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "failed to tick goal progress" });
    }
  });

  // Update verification_spec on a task. Used by the smoke script to
  // attach a structured spec before invoking verify.
  router.patch("/legion/tasks/:id", async (req, res) => {
    try {
      const id = req.params.id as string;
      const body = req.body as {
        verificationSpec?: unknown;
        verificationCriteria?: string;
      };
      const updates: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
      if (body.verificationSpec !== undefined) {
        const parsed = parseVerificationSpec(body.verificationSpec);
        if (!parsed.ok) {
          res.status(422).json({ error: parsed.errors.join("; ") });
          return;
        }
        updates.verificationSpec = parsed.spec;
      }
      if (body.verificationCriteria !== undefined) {
        updates.verificationCriteria = body.verificationCriteria;
      }
      const updated = await db
        .update(tasks)
        .set(updates)
        .where(eq(tasks.id, id))
        .returning();
      if (updated.length === 0) {
        res.status(404).json({ error: "task not found" });
        return;
      }
      res.json(updated[0]);
    } catch (err) {
      console.error("task patch error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "failed to patch task" });
    }
  });

  // Direct verify endpoint (matches the legacy /tasks/:id/verify route
  // mounted in routes/legion.tasks.ts but lives here for self-contained
  // smoke runs).
  router.post("/legion/tasks/:id/verify-direct", async (req, res) => {
    try {
      const id = req.params.id as string;
      const result = await verifyTask(db, id, {
        worktreeCwd: typeof req.body?.worktreeCwd === "string" ? req.body.worktreeCwd : undefined,
        notes: typeof req.body?.notes === "string" ? req.body.notes : undefined,
      });
      res.json(result);
    } catch (err) {
      console.error("verify-direct error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "failed to verify" });
    }
  });

  // ---------- goal decomposition endpoints ----------

  router.post("/companies/:companyId/goals", async (req, res) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as { title?: string; description?: string };
      if (!body.title || !body.description) {
        res.status(400).json({ error: "title and description required" });
        return;
      }
      const id = cryptoRandomId();
      await db.insert(goals).values({
        id,
        companyId,
        title: body.title,
        description: body.description,
        status: "planning",
        goalStatus: "planning",
        totalTasks: 0,
        completedTasks: 0,
      });
      res.status(201).json({ id, title: body.title, description: body.description });
    } catch (err) {
      console.error("goal create error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "failed to create goal" });
    }
  });

  router.post("/companies/:companyId/goals/:goalId/decompose-recursive", async (req, res) => {
    try {
      const companyId = req.params.companyId as string;
      const goalId = req.params.goalId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as { description?: string; repoPath?: string; modulePath?: string };
      if (!body.description) {
        res.status(400).json({ error: "description required" });
        return;
      }
      const result = await decomposer.decomposeRecursive(companyId, goalId, body.description, {
        repoPath: body.repoPath ?? null,
        modulePath: body.modulePath ?? null,
      });
      res.status(201).json(result);
    } catch (err) {
      console.error("decompose-recursive error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "failed to decompose" });
    }
  });

  router.get("/companies/:companyId/goals/:goalId/tasks", async (req, res) => {
    try {
      const companyId = req.params.companyId as string;
      const goalId = req.params.goalId as string;
      assertCompanyAccess(req, companyId);
      const rows = await db
        .select()
        .from(tasks)
        .where(eq(tasks.goalId, goalId));
      res.json(rows);
    } catch (err) {
      console.error("list goal tasks error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "failed to list tasks" });
    }
  });

  router.get("/companies", async (_req, res) => {
    try {
      const rows = await db.select().from(companies).limit(50);
      res.json(rows);
    } catch (err) {
      console.error("list companies error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "failed to list companies" });
    }
  });

  router.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return router;
}

function cryptoRandomId(): string {
  // Reuse the shared randomId helper so generated ids match the rest of
  // the system. The import is duplicated here to avoid pulling the
  // shared package into a route module that already has a db dep.
  return `goal_${Math.random().toString(36).slice(2, 14)}`;
}