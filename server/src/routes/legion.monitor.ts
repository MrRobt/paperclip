import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { legionMonitorService } from "../services/legion-monitor.js";

export function legionMonitorRoutes(db: Db): Router {
  const router = Router();
  const monitor = legionMonitorService(db);

  router.get("/legion/health", async (_req, res) => {
    try {
      res.json(await monitor.getHealth());
    } catch (err) {
      console.error("get legion health error:", err);
      res.status(500).json({ error: "failed to get legion health" });
    }
  });

  router.post("/legion/monitor/tick", async (_req, res) => {
    try {
      const timeouts = await monitor.handleTimeouts();
      const failures = await monitor.checkRetriableFailures();
      const health = await monitor.getHealth();
      res.json({ timeouts, failures, health });
    } catch (err) {
      console.error("legion monitor tick error:", err);
      res.status(500).json({ error: "failed to run legion monitor tick" });
    }
  });

  return router;
}
