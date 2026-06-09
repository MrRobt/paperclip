import { useEffect, useMemo } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Activity, Bot, CheckCircle2, RadioTower, ShieldAlert } from "lucide-react";
import type { Agent, Issue } from "@paperclipai/shared";
import { agentsApi } from "../api/agents";
import { heartbeatsApi, type LiveRunForIssue } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { StatusBadge } from "../components/StatusBadge";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import { relativeTime, cn } from "../lib/utils";
import { buildTeamHealthRows, summarizeTeamHealth } from "../lib/teamHealth";

const teamHealthIssueStatuses = ["todo", "backlog", "in_progress", "blocked", "in_review", "done", "cancelled"];

function metricLabel(value: number, label: string) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-2xl font-semibold text-foreground tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function runtimeTone(runtimeState: string) {
  if (runtimeState === "critical") return "border-destructive/40 bg-destructive/5 text-destructive";
  if (runtimeState === "warning") return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (runtimeState === "running") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  return "border-border bg-muted/30 text-muted-foreground";
}

function normalizeIssue(issue: Issue) {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    assigneeAgentId: issue.assigneeAgentId,
    originKind: issue.originKind,
    updatedAt: issue.updatedAt,
    workProducts: issue.workProducts,
  };
}

function normalizeAgent(agent: Agent) {
  return {
    id: agent.id,
    name: agent.name,
    status: agent.status,
    adapterType: agent.adapterType,
  };
}

function normalizeRun(run: LiveRunForIssue) {
  return {
    id: run.id,
    agentId: run.agentId,
    issueId: run.issueId,
    status: run.status,
    livenessState: run.livenessState,
    livenessReason: run.livenessReason,
    outputSilence: run.outputSilence,
  };
}

export function TeamHealth() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Team Health" }]);
  }, [setBreadcrumbs]);

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const liveRunsQuery = useQuery({
    queryKey: [...queryKeys.liveRuns(selectedCompanyId!), "team-health"],
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
  });

  const issuesQuery = useQuery({
    queryKey: ["team-health", "issues", selectedCompanyId],
    queryFn: async () => {
      const groups = await Promise.all(
        teamHealthIssueStatuses.map((status) =>
          issuesApi.list(selectedCompanyId!, {
            status,
            limit: 200,
            sortField: "updated",
            sortDir: "desc",
          }),
        ),
      );
      return [...new Map(groups.flat().map((issue) => [issue.id, issue])).values()];
    },
    enabled: !!selectedCompanyId,
    refetchInterval: 15_000,
  });

  const rows = useMemo(
    () => buildTeamHealthRows({
      agents: (agentsQuery.data ?? []).map(normalizeAgent),
      issues: (issuesQuery.data ?? []).map(normalizeIssue),
      liveRuns: (liveRunsQuery.data ?? []).map(normalizeRun),
    }),
    [agentsQuery.data, issuesQuery.data, liveRunsQuery.data],
  );
  const summary = useMemo(() => summarizeTeamHealth(rows), [rows]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Bot} message="请选择公司后查看团队健康状态。" />;
  }

  if (agentsQuery.isLoading || issuesQuery.isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  const firstError = agentsQuery.error ?? issuesQuery.error ?? liveRunsQuery.error;
  if (firstError) {
    const errorMessage = firstError instanceof Error ? firstError.message : "接口返回异常";
    return (
      <div className="space-y-3">
        <EmptyState icon={ShieldAlert} message="团队健康页加载失败，请刷新重试。" />
        <div className="mx-auto max-w-2xl rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          错误信息：<code className="break-all font-mono">{errorMessage}</code>
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return <EmptyState icon={Bot} message="暂无团队成员，暂时没有可展示的健康状态。" />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">团队健康</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            汇总公司状态、代理状态、任务状态、运行队列和最近异常，区分真实交付证据与恢复链噪声。
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          每十到十五秒自动刷新 · {rows.length} 名代理
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {metricLabel(summary.totalAgents, "代理总数")}
        {metricLabel(summary.activeRuntimeAgents, "运行中代理")}
        {metricLabel(summary.criticalAgents, "严重运行异常")}
        {metricLabel(summary.oneHighPriorityViolations, "高优先级超载")}
        {metricLabel(summary.effectiveEvidenceCount, "有效交付证据")}
        {metricLabel(summary.noiseCount, "噪声提示")}
      </div>

      {rows.some((row) => row.noiseCount > 0 || row.violatesOneHighPriority) ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          <div className="flex items-center gap-2 font-medium">
            <ShieldAlert className="h-4 w-4" />
            需要复核恢复链或噪声
          </div>
          <p className="mt-1 text-xs">
            仅体现恢复循环、沉默或看门狗交接的运行信号会被标记为噪声，不计入真实交付证据。
          </p>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="grid grid-cols-[1.25fr_0.9fr_1fr_1.2fr_1.2fr] gap-3 border-b border-border bg-muted/30 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <div>代理</div>
          <div>纸夹状态 / 运行态</div>
          <div>负载</div>
          <div>有效证据</div>
          <div>噪声 / 恢复链</div>
        </div>
        <div className="divide-y divide-border">
          {rows.map((row) => (
            <div key={row.agentId} className="grid grid-cols-[1.25fr_0.9fr_1fr_1.2fr_1.2fr] gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <Link className="font-medium text-foreground hover:underline" to={`/agents/${row.agentId}`}>
                  {row.agentName}
                </Link>
                <div className="mt-1 truncate text-xs text-muted-foreground">{row.adapterType ?? "未配置适配器"}</div>
              </div>
              <div className="space-y-2">
                <StatusBadge status={row.paperclipStatus} />
                <div className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs", runtimeTone(row.runtimeState))}>
                  <RadioTower className="h-3 w-3" />
                  {row.runtimeState} · {row.liveRunCount}
                </div>
              </div>
              <div className="space-y-1 text-xs">
                <div>{row.openIssueCount} 个未完成任务</div>
                <div className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5", row.violatesOneHighPriority ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
                  {row.violatesOneHighPriority ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                  {row.highPriorityLoad} 个高优先级
                </div>
              </div>
              <div className="space-y-1 text-xs">
                {row.recentEvidence.length === 0 ? (
                  <span className="text-muted-foreground">暂无近期有效证据</span>
                ) : row.recentEvidence.map((item) => (
                  <Link key={item.issueId} to={`/issues/${item.issueId}`} className="block rounded border border-border px-2 py-1 hover:bg-accent/50">
                    <div className="flex items-center gap-1 font-medium text-foreground">
                      <Activity className="h-3 w-3 text-emerald-600" />
                      {item.identifier}
                    </div>
                    <div className="truncate text-muted-foreground">{item.title}</div>
                    {item.updatedAt ? <div className="text-[11px] text-muted-foreground">{relativeTime(item.updatedAt)}</div> : null}
                  </Link>
                ))}
              </div>
              <div className="space-y-1 text-xs">
                {row.noiseHints.length === 0 ? (
                  <span className="text-muted-foreground">暂无明显噪声</span>
                ) : row.noiseHints.map((hint, index) => (
                  <div key={`${hint.issueId ?? hint.runId ?? index}`} className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1">
                    <div className="font-medium text-amber-800 dark:text-amber-200">{hint.identifier ?? hint.runId?.slice(0, 8) ?? "噪声"}</div>
                    <div className="truncate text-muted-foreground">{hint.title}</div>
                    <div className="text-[11px] text-muted-foreground">{hint.reason}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
