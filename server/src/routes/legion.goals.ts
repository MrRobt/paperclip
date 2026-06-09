import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { tasks } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { goalDecomposerService } from "../services/goal-decomposer.js";
import { goalService } from "../services/goals.js";
import { assertCompanyAccess } from "./authz.js";

export function legionGoalRoutes(db: Db) {
  const router = Router();
  const decomposer = goalDecomposerService(db);
  const goalsvc = goalService(db);

  // POST /api/goals/decompose — 拆解目标为任务 DAG
  router.post("/goals/decompose", async (req, res) => {
    try {
      const { companyId, goalId, description } = req.body as {
        companyId?: string;
        goalId?: string;
        description?: string;
      };

      if (!companyId || !goalId || !description) {
        res.status(400).json({ error: "companyId, goalId, description required" });
        return;
      }

      assertCompanyAccess(req, companyId);

      const goal = await goalsvc.getById(goalId);
      if (!goal) {
        res.status(404).json({ error: "Goal not found" });
        return;
      }
      if (goal.companyId !== companyId) {
        res.status(400).json({ error: "goalId does not belong to companyId" });
        return;
      }

      const result = await decomposer.decompose(companyId, goalId, description);
      res.status(201).json(result);
    } catch (err) {
      console.error("decompose error:", err);
      res.status(500).json({ error: "decomposition failed" });
    }
  });

  // GET /api/goals/:id/tasks — 获取 Goal 下所有任务
  router.get("/goals/:id/tasks", async (req, res) => {
    try {
      const goalId = req.params.id as string;
      const goal = await goalsvc.getById(goalId);
      if (!goal) {
        res.status(404).json({ error: "Goal not found" });
        return;
      }
      assertCompanyAccess(req, goal.companyId);

      const taskList = await db.select().from(tasks).where(eq(tasks.goalId, goalId));
      res.json(taskList);
    } catch (err) {
      console.error("get tasks error:", err);
      res.status(500).json({ error: "failed to get tasks" });
    }
  });

  return router;
}
