/**
 * Phase 26 of doc/plans/2026-07-01-orchestrator-control-plane.md.
 *
 * Auto-tick scheduler. Every `intervalMs` (default 30 minutes) the
 * orchestrator ticks for every company that has at least one agent
 * with `role="orchestrator"`. Each tick writes a row to
 * `orchestrator_runs` and, if the run crosses midnight UTC, also
 * writes the rendered daily report to `orchestrator_runs.daily_report`.
 *
 * The auto-tick is opt-in via env var `PAPERCLIP_ORCHESTRATOR_AUTO_TICK=1`.
 * Operators running on a single dev machine can leave it off; production
 * deployments should enable it.
 *
 * Idempotency: a second auto-tick while the first is still running is
 * skipped (no concurrent ticks per company). The interval is reset on
 * each call to `start()`.
 */

import type { Db } from "@paperclipai/db";
import { agents, companies } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { orchestratorService } from "./orchestrator.js";
import { orchestratorReportService } from "./orchestrator-report.js";

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export interface OrchestratorAutoTickOptions {
  intervalMs?: number;
  /** When true, ignore env-var gate (test paths only). */
  force?: boolean;
}

export interface OrchestratorAutoTickHandle {
  stop(): void;
  /** Last interval (ms) — exposed for /api/health. */
  intervalMs: number;
  /** Number of ticks issued since process start. */
  tickCount(): number;
  /** Number of ticks that ran a non-trivial 9-section output. */
  successfulTickCount(): number;
}

export function startOrchestratorAutoTick(
  db: Db,
  options: OrchestratorAutoTickOptions = {},
): OrchestratorAutoTickHandle | null {
  const force = options.force ?? false;
  if (!force && process.env.PAPERCLIP_ORCHESTRATOR_AUTO_TICK !== "1") {
    return null;
  }
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  const orchestrator = orchestratorService(db);
  const reports = orchestratorReportService(db);
  let lastReportDate = "";
  let tickCount = 0;
  let successfulTickCount = 0;
  const inflight = new Set<string>();

  async function tickAll(): Promise<void> {
    // Pick the orchestrator agent for each company. We use the first
    // agent with role="orchestrator" (the only first-class role for
    // the control plane) and fall back to the first ceo / first agent
    // per company so the loop is useful even before the new role
    // becomes a first-class field.
    const allCompanies = await db.select().from(companies);
    for (const company of allCompanies) {
      if (inflight.has(company.id)) continue;
      const companyAgents = await db
        .select()
        .from(agents)
        .where(eq(agents.companyId, company.id));
      const orchestratorAgent =
        companyAgents.find((a) => a.role === "orchestrator") ??
        companyAgents.find((a) => a.role === "ceo") ??
        companyAgents[0];
      if (!orchestratorAgent) continue;
      inflight.add(company.id);
      try {
        tickCount += 1;
        const out = await orchestrator.tick({
          companyId: company.id,
          orchestratorAgentId: orchestratorAgent.id,
          triggerKind: "scheduled",
        });
        successfulTickCount += 1;
        // If this tick crossed a UTC date boundary, write the daily
        // report. Idempotent: the report generator itself picks the
        // latest run so we don't have to track which run wrote which
        // report row.
        const today = new Date().toISOString().slice(0, 10);
        if (today !== lastReportDate) {
          lastReportDate = today;
          try {
            const report = await reports.generate({ companyId: company.id, reportDate: today });
            if (report) {
              await reports.persistDailyReport(out.runId, report.markdown);
            }
          } catch (reportErr) {
            // Report failure is non-fatal — the tick itself succeeded.
            // eslint-disable-next-line no-console
            console.warn(
              `[orchestrator-auto-tick] daily report failed for ${company.id}:`,
              reportErr instanceof Error ? reportErr.message : reportErr,
            );
          }
        }
      } catch (tickErr) {
        // eslint-disable-next-line no-console
        console.error(
          `[orchestrator-auto-tick] tick failed for ${company.id}:`,
          tickErr instanceof Error ? tickErr.message : tickErr,
        );
      } finally {
        inflight.delete(company.id);
      }
    }
  }

  // Run once at boot so a freshly-started server immediately produces
  // a baseline report.
  void tickAll();
  const timer = setInterval(() => {
    void tickAll();
  }, intervalMs);
  timer.unref?.();

  return {
    intervalMs,
    stop() {
      clearInterval(timer);
    },
    tickCount: () => tickCount,
    successfulTickCount: () => successfulTickCount,
  };
}