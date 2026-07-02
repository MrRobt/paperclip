/**
 * Phase 16/17 of doc/plans/2026-07-01-orchestrator-control-plane.md.
 *
 * Orchestrator + file-locks + contracts + project-context + runtime-leases
 * HTTP routes. Backed by services/{orchestrator,file-lock,...}.ts.
 */

import { Router } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  fileLocks,
  interfaceContracts,
  orchestratorRuns,
  projectContext,
  runtimeLeases,
} from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import { fileLockService } from "../services/file-lock.js";
import { orchestratorService } from "../services/orchestrator.js";
import { orchestratorReportService } from "../services/orchestrator-report.js";

export function orchestratorRoutes(db: Db): Router {
  const router = Router();
  const locks = fileLockService(db);
  const orchestrator = orchestratorService(db);

  // ---------- orchestrator tick ----------

  router.post("/orchestrator/tick", async (req, res) => {
    try {
      const body = req.body as { companyId?: string; orchestratorAgentId?: string; triggerKind?: "manual" | "scheduled" | "event" | "escalation" };
      const companyId = body.companyId ?? (req.headers["x-paperclip-company-id"] as string | undefined);
      const orchestratorAgentId = body.orchestratorAgentId ?? (req.headers["x-paperclip-orchestrator-agent-id"] as string | undefined);
      if (!companyId || !orchestratorAgentId) {
        res.status(400).json({ error: "companyId and orchestratorAgentId are required" });
        return;
      }
      assertCompanyAccess(req, companyId);
      const out = await orchestrator.tick({
        companyId,
        orchestratorAgentId,
        triggerKind: body.triggerKind ?? "manual",
      });
      res.json(out);
    } catch (err) {
      console.error("orchestrator tick error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "tick failed" });
    }
  });

  router.get("/orchestrator/runs", async (req, res) => {
    try {
      const companyId = typeof req.query.companyId === "string" ? req.query.companyId : null;
      if (companyId) assertCompanyAccess(req, companyId);
      const rows = await db
        .select()
        .from(orchestratorRuns)
        .where(companyId ? eq(orchestratorRuns.companyId, companyId) : undefined)
        .orderBy(desc(orchestratorRuns.startedAt))
        .limit(50);
      res.json(rows);
    } catch (err) {
      console.error("orchestrator runs error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "failed to list runs" });
    }
  });

  /**
   * Phase 30 — historical timeseries for the orchestrator control plane charts.
   * Returns daily tick counts, section coverage, daily-report presence, and
   * recent run durations for a given company.
   */
  router.get("/orchestrator/:companyId/runs/timeseries", async (req, res) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      // window: 30d | 7d | 90d (default 30d)
      const windowDays = (() => {
        const w = typeof req.query.window === "string" ? req.query.window : "30d";
        if (w === "7d") return 7;
        if (w === "90d") return 90;
        return 30;
      })();

      const since = new Date();
      since.setDate(since.getDate() - windowDays);

      // 1) Daily ticks grouped by date + status
      const dailyTicksRaw = await db.execute(sql`
        SELECT
          date_trunc('day', created_at AT TIME ZONE 'UTC')::date AS date,
          status,
          COUNT(*) AS count
        FROM orchestrator_runs
        WHERE company_id = ${companyId} AND created_at >= ${since.toISOString()}
        GROUP BY 1, 2
        ORDER BY 1 ASC
      `) as unknown as Array<{ date: string; status: string; count: number }>;

      // Build dailyTicks array — fill in zeros for missing date/status combos
      const dateStatusMap = new Map<string, { total: number; successful: number; failed: number }>();
      for (const row of dailyTicksRaw) {
        const entry = dateStatusMap.get(row.date) ?? { total: 0, successful: 0, failed: 0 };
        entry.total += Number(row.count);
        if (row.status === "succeeded") entry.successful += Number(row.count);
        else if (row.status === "failed") entry.failed += Number(row.count);
        dateStatusMap.set(row.date, entry);
      }
      const dailyTicks = Array.from(dateStatusMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, v]) => ({ date, total: v.total, successful: v.successful, failed: v.failed }));

      // 2) Section coverage — inspect the output sections across recent runs
      const recentRuns = await db
        .select({
          decisions: orchestratorRuns.decisions,
          dispatches: orchestratorRuns.dispatches,
          fileLockActions: orchestratorRuns.fileLockActions,
          contextSnapshot: orchestratorRuns.contextSnapshot,
          dailyReport: orchestratorRuns.dailyReport,
          summary: orchestratorRuns.summary,
          errorMessage: orchestratorRuns.errorMessage,
        })
        .from(orchestratorRuns)
        .where(and(
          eq(orchestratorRuns.companyId, companyId),
          gte(orchestratorRuns.createdAt, since),
        ))
        .orderBy(desc(orchestratorRuns.createdAt))
        .limit(50);

      const sectionCounts: Record<string, number> = {
        decisions: 0,
        dispatches: 0,
        fileLockActions: 0,
        contextSnapshot: 0,
        dailyReport: 0,
        summary: 0,
        errorMessage: 0,
      };
      for (const run of recentRuns) {
        if ((run.decisions as unknown[])?.length > 0) sectionCounts.decisions++;
        if ((run.dispatches as unknown[])?.length > 0) sectionCounts.dispatches++;
        if ((run.fileLockActions as unknown[])?.length > 0) sectionCounts.fileLockActions++;
        if (run.contextSnapshot != null) sectionCounts.contextSnapshot++;
        if (run.dailyReport) sectionCounts.dailyReport++;
        if (run.summary) sectionCounts.summary++;
        if (run.errorMessage) sectionCounts.errorMessage++;
      }
      const sectionCoverage: Record<string, number> = {};
      const runCount = recentRuns.length || 1;
      for (const [name, cnt] of Object.entries(sectionCounts)) {
        sectionCoverage[name] = Math.round((cnt / runCount) * 100);
      }

      // 3) Daily report coverage — unique days with runs vs days with daily_report
      const uniqueDaysWithRuns = new Set(dailyTicks.map(d => d.date)).size;
      const uniqueDaysWithReport = new Set(
        dailyTicksRaw.filter(r => r.status !== null).map(r => r.date)
      ).size;
      const dailyReportCoverage = { daysWithReport: uniqueDaysWithReport, daysTotal: uniqueDaysWithRuns };

      // 4) Recent durations (last 50 runs) — derived from startedAt vs endedAt
      const durationRows = await db.execute(sql`
        SELECT
          CASE
            WHEN ended_at IS NOT NULL AND started_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000
            ELSE NULL
          END AS duration_ms
        FROM orchestrator_runs
        WHERE company_id = ${companyId} AND created_at >= ${since.toISOString()} AND ended_at IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 50
      `) as unknown as Array<{ duration_ms: number | null }>;

      const recentDurationsMs: number[] = durationRows
        .map(r => r.duration_ms)
        .filter((d): d is number => d != null);

      res.json({
        dailyTicks,
        sectionCoverage,
        dailyReportCoverage,
        recentDurationsMs,
      });
    } catch (err) {
      console.error("orchestrator timeseries error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "timeseries failed" });
    }
  });

  // Daily report — generated server-side as Markdown + a sanitised HTML
  // preview. The UI re-renders the Markdown through react-markdown, so
  // the HTML is only used for the clipboard / email share path.
  router.get("/orchestrator/reports/latest", async (req, res) => {
    try {
      const companyId = typeof req.query.companyId === "string" ? req.query.companyId : null;
      if (!companyId) {
        res.status(400).json({ error: "companyId is required" });
        return;
      }
      assertCompanyAccess(req, companyId);
      const reportDate = typeof req.query.reportDate === "string" ? req.query.reportDate : undefined;
      const runId = typeof req.query.runId === "string" ? req.query.runId : undefined;
      const reports = orchestratorReportService(db);
      const report = await reports.generate({ companyId, reportDate, runId });
      res.json(report);
    } catch (err) {
      console.error("orchestrator report error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "failed to generate report" });
    }
  });

  // ---------- file locks ----------

  router.post("/file-locks/acquire", async (req, res) => {
    try {
      const body = req.body as { taskId: string; agentId: string; files: string[]; companyId?: string; lockType?: "exclusive" | "shared"; expiryHours?: number };
      if (!body.taskId || !body.agentId || !Array.isArray(body.files)) {
        res.status(400).json({ error: "taskId, agentId, files[] required" });
        return;
      }
      const result = await locks.acquireMany({
        taskId: body.taskId,
        agentId: body.agentId,
        files: body.files,
        companyId: body.companyId,
        lockType: body.lockType,
        expiryHours: body.expiryHours,
      });
      if (result.taskNotFound) {
        res.status(400).json({ error: "task not found and no companyId provided" });
        return;
      }
      if (result.conflicts.length > 0) {
        res.status(409).json({ ok: false, acquired: result.acquired, conflicts: result.conflicts, expiresAt: result.expiresAt });
        return;
      }
      res.status(201).json({ ok: true, acquired: result.acquired, expiresAt: result.expiresAt });
    } catch (err) {
      console.error("file-lock acquire error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "acquire failed" });
    }
  });

  router.post("/file-locks/release", async (req, res) => {
    try {
      const body = req.body as { taskId: string; files?: string[]; reason?: string };
      if (!body.taskId) {
        res.status(400).json({ error: "taskId required" });
        return;
      }
      const result = await locks.releaseMany({ taskId: body.taskId, files: body.files, reason: body.reason });
      res.json(result);
    } catch (err) {
      console.error("file-lock release error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "release failed" });
    }
  });

  router.get("/file-locks", async (req, res) => {
    try {
      const taskId = typeof req.query.taskId === "string" ? req.query.taskId : undefined;
      const filePath = typeof req.query.filePath === "string" ? req.query.filePath : undefined;
      const rows = await locks.listActive({ taskId, filePath });
      res.json(rows);
    } catch (err) {
      console.error("file-lock list error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "list failed" });
    }
  });

  // ---------- contracts ----------

  router.post("/contracts", async (req, res) => {
    try {
      const body = req.body as { companyId: string; name: string; contractKind: "http-route" | "rpc" | "cli" | "data-schema" | "event-bus"; schemaJson: unknown; ownerAgentId?: string };
      if (!body.companyId || !body.name || !body.contractKind) {
        res.status(400).json({ error: "companyId, name, contractKind required" });
        return;
      }
      assertCompanyAccess(req, body.companyId);
      const inserted = await db
        .insert(interfaceContracts)
        .values({
          companyId: body.companyId,
          name: body.name,
          contractKind: body.contractKind,
          schemaJson: body.schemaJson,
          ownerAgentId: body.ownerAgentId ?? null,
          status: "draft",
        })
        .returning();
      res.status(201).json(inserted[0]);
    } catch (err) {
      console.error("contract create error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "create failed" });
    }
  });

  router.post("/contracts/:id/publish", async (req, res) => {
    try {
      const id = req.params.id as string;
      const updated = await db
        .update(interfaceContracts)
        .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
        .where(eq(interfaceContracts.id, id))
        .returning();
      if (updated.length === 0) {
        res.status(404).json({ error: "contract not found" });
        return;
      }
      res.json(updated[0]);
    } catch (err) {
      console.error("contract publish error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "publish failed" });
    }
  });

  router.post("/contracts/:id/deprecate", async (req, res) => {
    try {
      const id = req.params.id as string;
      const updated = await db
        .update(interfaceContracts)
        .set({ status: "deprecated", deprecatedAt: new Date(), updatedAt: new Date() })
        .where(eq(interfaceContracts.id, id))
        .returning();
      if (updated.length === 0) {
        res.status(404).json({ error: "contract not found" });
        return;
      }
      res.json(updated[0]);
    } catch (err) {
      console.error("contract deprecate error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "deprecate failed" });
    }
  });

  // ---------- project context ----------

  router.get("/companies/:companyId/project-context", async (req, res) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const rows = await db.select().from(projectContext).where(eq(projectContext.companyId, companyId)).limit(1);
      res.json(rows[0] ?? null);
    } catch (err) {
      console.error("project-context get error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "get failed" });
    }
  });

  router.put("/companies/:companyId/project-context", async (req, res) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as {
        currentLongGoalId?: string | null;
        currentPhaseId?: string | null;
        completedFeatures?: unknown;
        partialFeatures?: unknown;
        blockedItems?: unknown;
        risks?: unknown;
        keyDecisions?: unknown;
        staleDocPaths?: string;
        verifiedFacts?: unknown;
        investigatedConclusions?: unknown;
        agentCollaborationRules?: unknown;
        nextPriority?: string;
        updatedByAgentId?: string | null;
      };
      const updated = await db
        .insert(projectContext)
        .values({
          companyId,
          currentLongGoalId: body.currentLongGoalId ?? null,
          currentPhaseId: body.currentPhaseId ?? null,
          completedFeatures: body.completedFeatures as never,
          partialFeatures: body.partialFeatures as never,
          blockedItems: body.blockedItems as never,
          risks: body.risks as never,
          keyDecisions: body.keyDecisions as never,
          staleDocPaths: body.staleDocPaths ?? null,
          verifiedFacts: body.verifiedFacts as never,
          investigatedConclusions: body.investigatedConclusions as never,
          agentCollaborationRules: body.agentCollaborationRules as never,
          nextPriority: body.nextPriority ?? null,
          updatedByAgentId: body.updatedByAgentId ?? null,
        })
        .onConflictDoUpdate({
          target: projectContext.companyId,
          set: {
            currentLongGoalId: body.currentLongGoalId ?? null,
            currentPhaseId: body.currentPhaseId ?? null,
            completedFeatures: body.completedFeatures as never,
            partialFeatures: body.partialFeatures as never,
            blockedItems: body.blockedItems as never,
            risks: body.risks as never,
            keyDecisions: body.keyDecisions as never,
            staleDocPaths: body.staleDocPaths ?? null,
            verifiedFacts: body.verifiedFacts as never,
            investigatedConclusions: body.investigatedConclusions as never,
            agentCollaborationRules: body.agentCollaborationRules as never,
            nextPriority: body.nextPriority ?? null,
            updatedByAgentId: body.updatedByAgentId ?? null,
            updatedAt: new Date(),
          },
        })
        .returning();
      res.json(updated[0]);
    } catch (err) {
      console.error("project-context put error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "put failed" });
    }
  });

  // ---------- runtime leases (read-only quick view) ----------

  router.get("/runtime-leases", async (req, res) => {
    try {
      const companyId = typeof req.query.companyId === "string" ? req.query.companyId : null;
      const rows = await db
        .select()
        .from(runtimeLeases)
        .where(companyId ? eq(runtimeLeases.companyId, companyId) : undefined)
        .limit(100);
      res.json(rows);
    } catch (err) {
      console.error("runtime-leases list error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "list failed" });
    }
  });

  return router;
}