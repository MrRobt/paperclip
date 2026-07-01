/**
 * Phase 23 of doc/plans/2026-07-01-orchestrator-control-plane.md.
 *
 * API client for orchestrator daily report. The server-side generator
 * lives in `server/src/services/orchestrator-report.ts`; this client
 * fetches the rendered markdown + html preview for the latest run.
 */

import { api } from "./client.js";

export interface OrchestratorDailyReport {
  runId: string;
  reportDate: string;
  markdown: string;
  html: string;
}

export const orchestratorReportsApi = {
  async getLatest(companyId: string, opts?: { reportDate?: string; runId?: string }): Promise<OrchestratorDailyReport | null> {
    const params = new URLSearchParams();
    if (opts?.reportDate) params.set("reportDate", opts.reportDate);
    if (opts?.runId) params.set("runId", opts.runId);
    const qs = params.toString();
    return api.get<OrchestratorDailyReport | null>(
      `/orchestrator/reports/latest?companyId=${encodeURIComponent(companyId)}${qs ? `&${qs}` : ""}`,
    );
  },
};