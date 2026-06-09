import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, goals, tasks } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import { handoffService } from "../services/handoff-service.js";
import { callLlm } from "../services/llm-client.js";

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
          status,
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

      const taskHandoffs = await handoffs.getTaskHandoffs(row.task.id);
      const verification = await callLlm([
        {
          role: "system",
          content: "You verify whether a task satisfies its acceptance criteria. Return concise JSON with passed:boolean, summary:string, issues:string[].",
        },
        {
          role: "user",
          content: JSON.stringify({
            task: row.task,
            verificationCriteria: row.task.verificationCriteria,
            handoffs: taskHandoffs,
          }),
        },
      ]);

      const updated = await db
        .update(tasks)
        .set({
          verificationResult: verification.content,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, row.task.id))
        .returning()
        .then((rows) => rows[0] ?? null);

      res.json({ task: updated, verification });
    } catch (err) {
      console.error("verify task error:", err);
      res.status(500).json({ error: "failed to verify task" });
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
