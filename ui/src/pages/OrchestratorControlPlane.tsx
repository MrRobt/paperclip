/**
 * Phase 18 of doc/plans/2026-07-01-orchestrator-control-plane.md.
 *
 * `/orchestrator` — main control plane page. Shows the 9-section
 * orchestrator tick output and lets the operator trigger a new tick.
 *
 * The 9 sections (per the orchestrator-control-plane skill):
 *   1. currentLongGoal
 *   2. currentPhase
 *   3. completedTasks
 *   4. partialTasks
 *   5. blockedTasks
 *   6. readyToDispatch
 *   7. fileConflicts
 *   8. contextUpdates
 *   9. nextDispatch + decisions
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "@/i18n";
import { Activity } from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { orchestratorApi, type OrchestratorTickOutput } from "../api/orchestrator";
import { agentsApi } from "../api/agents";
import { Button } from "../components/ui/button";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { cn } from "../lib/utils";
import { queryKeys } from "../lib/queryKeys";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MarkdownView } from "../components/MarkdownView";
import { orchestratorReportsApi, type OrchestratorDailyReport } from "../api/orchestratorReports";
import { DailyTicksChart } from "../components/charts/DailyTicksChart";
import { SectionCoverageChart } from "../components/charts/SectionCoverageChart";
import { DailyReportCoverageCard } from "../components/charts/DailyReportCoverageCard";
import { RecentDurationsChart } from "../components/charts/RecentDurationsChart";

const STATUS_TONES: Record<string, string> = {
  not_started: "bg-slate-100 text-slate-700 border-slate-200",
  in_progress: "bg-blue-50 text-blue-700 border-blue-200",
  blocked: "bg-rose-100 text-rose-700 border-rose-200",
  code_landed_needs_runtime: "bg-amber-50 text-amber-700 border-amber-200",
  partial_runtime_passed: "bg-amber-50 text-amber-700 border-amber-200",
  actual_passed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-rose-100 text-rose-700 border-rose-200",
  closed: "bg-slate-200 text-slate-700 border-slate-300",
};

function statusTone(status: string): string {
  return STATUS_TONES[status] ?? "bg-slate-100 text-slate-700 border-slate-200";
}

// Phase 30 — historical charts section
function TimeseriesChartsSection({ companyId }: { companyId: string }) {
  const { t } = useTranslation();
  const ts = useQuery({
    queryKey: ["orchestrator-timeseries", companyId],
    queryFn: () => orchestratorApi.getRunsTimeseries(companyId),
    enabled: !!companyId,
    refetchInterval: 60_000,
  });

  const data = ts.data;
  const loading = ts.isLoading;

  return (
    <section>
      <h2 className="text-lg font-semibold">{t("orchestrator.chartsTitle")}</h2>
      <p className="text-sm text-muted-foreground">{t("orchestrator.chartsSubtitle")}</p>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {loading ? (
          <div className="col-span-2 rounded-lg border bg-card p-8 flex items-center justify-center">
            <PageSkeleton variant="dashboard" />
          </div>
        ) : (
          <>
            <DailyTicksChart
              data={data?.dailyTicks ?? []}
              title={t("orchestrator.dailyTicks")}
              subtitle={t("orchestrator.dailyTicksSubtitle")}
            />
            <SectionCoverageChart
              data={data?.sectionCoverage ?? {}}
              title={t("orchestrator.sectionCoverage")}
              subtitle={t("orchestrator.sectionCoverageSubtitle")}
            />
            <DailyReportCoverageCard
              daysWithReport={data?.dailyReportCoverage.daysWithReport ?? 0}
              daysTotal={data?.dailyReportCoverage.daysTotal ?? 0}
              title={t("orchestrator.dailyReportCoverage")}
              subtitle={t("orchestrator.dailyReportCoverageSubtitle")}
            />
            <RecentDurationsChart
              durationsMs={data?.recentDurationsMs ?? []}
              title={t("orchestrator.recentDurations")}
              subtitle={t("orchestrator.recentDurationsSubtitle")}
            />
          </>
        )}
      </div>
    </section>
  );
}

export function OrchestratorControlPlanePage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { selectedCompanyId } = useCompany();

  // Fetch the company's agents so the operator can pick (or auto-pick)
  // an orchestrator agent. Default to the CEO, falling back to the
  // first non-archived agent.
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  // We let the operator choose the orchestrator agent. Default to the
  // first agent with role=ceo, falling back to the first agent.
  const orchestratorAgentId = useMemo(() => {
    const agents = agentsQuery.data ?? [];
    const ceo = agents.find((a) => a.role === "ceo");
    return ceo?.id ?? agents[0]?.id ?? null;
  }, [agentsQuery.data]);

  const [tickOutput, setTickOutput] = useState<OrchestratorTickOutput | null>(null);
  const [tickError, setTickError] = useState<string | null>(null);
  const [isTicking, setIsTicking] = useState(false);

  const runsQuery = useQuery({
    queryKey: ["orchestrator-runs", selectedCompanyId],
    queryFn: () => orchestratorApi.listRuns(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  // The actual trigger — kept in a callback so we can refresh the
  // runs list and the tick output together.
  const handleTick = useCallback(async () => {
    if (!selectedCompanyId || !orchestratorAgentId) {
      setTickError("Select a company and an orchestrator agent first.");
      return;
    }
    setIsTicking(true);
    setTickError(null);
    try {
      const out = await orchestratorApi.tick({
        companyId: selectedCompanyId,
        orchestratorAgentId,
        triggerKind: "manual",
      });
      setTickOutput(out);
      await queryClient.invalidateQueries({ queryKey: ["orchestrator-runs", selectedCompanyId] });
    } catch (err) {
      setTickError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTicking(false);
    }
  }, [selectedCompanyId, orchestratorAgentId, queryClient]);

  // Initial load: fetch the latest run's tick output, not just the
  // audit row. The audit row only has the summary; we want the full
  // 9 sections. For now we render a placeholder until the operator
  // clicks "Tick".
  useEffect(() => {
    if (tickOutput) return;
  }, [tickOutput]);

  if (!selectedCompanyId) {
    return (
      <div className="p-6">
        <EmptyState icon={Activity} message={t("orchestrator.noCompanySelected")} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("orchestrator.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("orchestrator.subtitle")}</p>
        </div>
        <Button
          onClick={handleTick}
          disabled={isTicking || !orchestratorAgentId}
          aria-busy={isTicking}
        >
          {isTicking ? t("orchestrator.ticking") : t("orchestrator.tick")}
        </Button>
      </header>

      {tickError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {tickError}
        </div>
      ) : null}

      {!tickOutput && !isTicking ? (
        <PageSkeleton variant="dashboard" />
      ) : tickOutput ? (
        <TickOutputView out={tickOutput} />
      ) : null}

      {/* Phase 30 — historical charts */}
      <TimeseriesChartsSection companyId={selectedCompanyId!} />

      <section>
        <h2 className="text-lg font-semibold">{t("orchestrator.recentRuns")}</h2>
        <p className="text-sm text-muted-foreground">{t("orchestrator.recentRunsSubtitle")}</p>
        <div className="mt-3 rounded-lg border bg-card">
          {runsQuery.isLoading ? (
            <PageSkeleton variant="list" />
          ) : runsQuery.data && runsQuery.data.length > 0 ? (
            <ul className="divide-y">
              {runsQuery.data.slice(0, 10).map((run) => (
                <li key={run.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div>
                    <div className="font-mono text-xs text-muted-foreground">{run.id}</div>
                    <div>{run.summary ?? run.errorMessage ?? "—"}</div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className={cn("rounded border px-2 py-0.5", statusTone(run.status))}>
                      {run.status}
                    </span>
                    <span>{run.triggerKind}</span>
                    <span>{new Date(run.startedAt).toLocaleString()}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-sm text-muted-foreground">{t("orchestrator.noRunsYet")}</p>
          )}
        </div>
      </section>

      <DailyReportSection companyId={selectedCompanyId} />
    </div>
  );
}

function DailyReportSection({ companyId }: { companyId: string }) {
  const { t } = useTranslation();
  const reportQuery = useQuery({
    queryKey: ["orchestrator-daily-report", companyId],
    queryFn: () => orchestratorReportsApi.getLatest(companyId),
    enabled: !!companyId,
    refetchInterval: 60_000,
  });

  return (
    <section>
      <h2 className="text-lg font-semibold">{t("orchestrator.dailyReport")}</h2>
      <p className="text-sm text-muted-foreground">{t("orchestrator.dailyReportSubtitle")}</p>
      <div className="mt-3 rounded-lg border bg-card p-4">
        {reportQuery.isLoading ? (
          <PageSkeleton variant="detail" />
        ) : !reportQuery.data ? (
          <p className="text-sm text-muted-foreground">{t("orchestrator.dailyReportEmpty")}</p>
        ) : (
          <DailyReportView report={reportQuery.data} />
        )}
      </div>
    </section>
  );
}

function DailyReportView({ report }: { report: OrchestratorDailyReport }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {report.reportDate} · run <code className="font-mono">{report.runId}</code>
        </span>
        <button
          type="button"
          className="rounded border px-2 py-0.5 text-xs hover:bg-muted"
          onClick={() => {
            void navigator.clipboard.writeText(report.markdown);
          }}
        >
          {t("orchestrator.copyMarkdown")}
        </button>
      </div>
      <MarkdownView source={report.markdown} />
    </div>
  );
}

function TickOutputView({ out }: { out: OrchestratorTickOutput }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Section title="currentLongGoal" body={<div className="text-sm">{out.currentLongGoal ?? "—"}</div>} />
      <Section
        title="currentPhase"
        body={
          out.currentPhase ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-mono text-xs text-muted-foreground">{out.currentPhase.id}</span>
              <span>{out.currentPhase.name}</span>
              <span className={cn("rounded border px-2 py-0.5 text-xs", statusTone(out.currentPhase.status))}>
                {out.currentPhase.status}
              </span>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">—</div>
          )
        }
      />
      <TaskListSection title="completedTasks" rows={out.completedTasks.map((t) => ({ id: t.id, title: t.title, meta: t.actualPassedAt }))} />
      <TaskListSection
        title="partialTasks"
        rows={out.partialTasks.map((t) => ({ id: t.id, title: t.title, status: t.status, meta: t.blockedBy.length > 0 ? `blocked by ${t.blockedBy.join(", ")}` : null }))}
      />
      <TaskListSection
        title="blockedTasks"
        rows={out.blockedTasks.map((t) => ({ id: t.id, title: t.title, status: "blocked", meta: t.reason }))}
      />
      <TaskListSection
        title="readyToDispatch"
        rows={out.readyToDispatch.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.agentMatch ? "ready" : "needs-owner",
          meta: `${t.filesInScope.length} file(s) in scope`,
        }))}
      />
      <Section
        title="fileConflicts"
        body={
          out.fileConflicts.length === 0 ? (
            <div className="text-sm text-muted-foreground">—</div>
          ) : (
            <ul className="space-y-1 text-sm">
              {out.fileConflicts.map((c) => (
                <li key={c.file}>
                  <code className="text-xs">{c.file}</code>
                  <span className="ml-2 text-muted-foreground">→ {c.claimedBy.join(", ")}</span>
                </li>
              ))}
            </ul>
          )
        }
      />
      <Section
        title="contextUpdates"
        body={
          out.contextUpdates.length === 0 ? (
            <div className="text-sm text-muted-foreground">—</div>
          ) : (
            <ul className="space-y-1 text-sm">
              {out.contextUpdates.map((u, i) => (
                <li key={i}>
                  <span className="font-mono text-xs text-muted-foreground">{u.section}</span>
                  <span className="ml-2">{u.change}</span>
                </li>
              ))}
            </ul>
          )
        }
      />
      <Section
        title="nextDispatch"
        body={
          out.nextDispatch.length === 0 ? (
            <div className="text-sm text-muted-foreground">—</div>
          ) : (
            <ul className="space-y-1 text-sm">
              {out.nextDispatch.map((d, i) => (
                <li key={i}>
                  <code className="text-xs">{d.taskId}</code>
                  <span className="mx-1 text-muted-foreground">→</span>
                  <code className="text-xs">{d.agentId}</code>
                  <div className="ml-2 text-xs text-muted-foreground">{d.reason}</div>
                </li>
              ))}
            </ul>
          )
        }
      />
      <Section
        title="decisions"
        body={
          out.decisions.length === 0 ? (
            <div className="text-sm text-muted-foreground">—</div>
          ) : (
            <ul className="space-y-1 text-sm">
              {out.decisions.map((d, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className={cn("rounded border px-2 py-0.5 text-xs", statusTone(d.type))}>
                    {d.type}
                  </span>
                  <div className="flex-1">
                    <code className="text-xs">{d.subject}</code>
                    <div className="text-xs text-muted-foreground">{d.reason}</div>
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      />
    </div>
  );
}

function Section({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-2 text-xs font-mono uppercase tracking-wider text-muted-foreground">{title}</div>
      {body}
    </div>
  );
}

function TaskListSection({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ id: string; title: string; status?: string; meta?: string | null }>;
}) {
  return (
    <Section
      title={title}
      body={
        rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">—</div>
        ) : (
          <ul className="space-y-2 text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{r.title}</div>
                  <code className="text-xs text-muted-foreground">{r.id}</code>
                  {r.meta ? <div className="text-xs text-muted-foreground">{r.meta}</div> : null}
                </div>
                {r.status ? (
                  <span className={cn("rounded border px-2 py-0.5 text-xs shrink-0", statusTone(r.status))}>
                    {r.status}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}

// NOTE: apiClient binding via the shared `api` from "../api/client".
// In the production app this resolves the per-request base URL and
// auth headers from the active session context; tests inject a mock
// through the same module-level export.