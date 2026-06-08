import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, Bot, CheckCircle2, RefreshCw, ShieldAlert } from "lucide-react";
import { Link } from "@/lib/router";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useTranslation } from "@/i18n";
import { cn, relativeTime } from "../lib/utils";
import {
  deliveryControlPlaneApi,
  type CommentDraft,
  type ControlPlaneIssueDiagnosis,
  type ModelHealthSummary,
} from "../api/deliveryControlPlane";

const diagnosticsKey = (companyId: string) => ["delivery-control-plane", companyId, "diagnostics"] as const;
const draftsKey = (companyId: string) => ["delivery-control-plane", companyId, "comment-drafts"] as const;
const modelHealthKey = (companyId: string) => ["delivery-control-plane", companyId, "model-health"] as const;

function metric(value: number | string, label: string, tone = "") {
  return (
    <div className={cn("rounded-lg border border-border bg-card px-4 py-3", tone)}>
      <div className="text-2xl font-semibold tabular-nums text-foreground">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function statusTone(status: string) {
  if (["critical", "blocked", "stalled", "unhealthy", "hard"].includes(status)) return "border-destructive/40 bg-destructive/5 text-destructive";
  if (["warning", "suspicious", "degraded", "soft", "active"].includes(status)) return "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200";
  return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
}

function pill(status: string) {
  return <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs", statusTone(status))}>{status}</span>;
}

function stringFromEvidence(evidence: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = evidence[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function numberFromEvidence(evidence: Record<string, unknown>, key: string) {
  const value = evidence[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function DeliveryControlPlanePage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: t("deliveryControlPlane.pageTitle") }]);
  }, [setBreadcrumbs, t]);

  const diagnosticsQuery = useQuery({
    queryKey: selectedCompanyId ? diagnosticsKey(selectedCompanyId) : ["delivery-control-plane", "none", "diagnostics"],
    queryFn: () => deliveryControlPlaneApi.getDiagnostics(selectedCompanyId!, { limit: 100 }),
    enabled: !!selectedCompanyId,
    refetchInterval: 15_000,
  });

  const draftsQuery = useQuery({
    queryKey: selectedCompanyId ? draftsKey(selectedCompanyId) : ["delivery-control-plane", "none", "comment-drafts"],
    queryFn: () => deliveryControlPlaneApi.getCommentDrafts(selectedCompanyId!, { status: "pending", limit: 50 }),
    enabled: !!selectedCompanyId,
    refetchInterval: 20_000,
  });

  const modelHealthQuery = useQuery({
    queryKey: selectedCompanyId ? modelHealthKey(selectedCompanyId) : ["delivery-control-plane", "none", "model-health"],
    queryFn: () => deliveryControlPlaneApi.getModelHealth(selectedCompanyId!, { limit: 100 }),
    enabled: !!selectedCompanyId,
    refetchInterval: 30_000,
  });

  const invalidate = async () => {
    if (!selectedCompanyId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: diagnosticsKey(selectedCompanyId) }),
      queryClient.invalidateQueries({ queryKey: draftsKey(selectedCompanyId) }),
      queryClient.invalidateQueries({ queryKey: modelHealthKey(selectedCompanyId) }),
    ]);
  };

  const actionOptions = {
    onSuccess: async () => {
      setMessage(t("deliveryControlPlane.actionSubmitted"));
      await invalidate();
    },
    onError: (error: Error) => setMessage(error.message),
  };

  const wakeMutation = useMutation({
    mutationFn: (agentIds: string[]) => deliveryControlPlaneApi.wakeAgents(selectedCompanyId!, {
      agentIds,
      reason: "delivery_control_plane_wakeup",
      source: "delivery_control_plane",
    }),
    ...actionOptions,
  });
  const replayDraftMutation = useMutation({ mutationFn: (draftId: string) => deliveryControlPlaneApi.replayCommentDraft(draftId, { force: true }), ...actionOptions });
  const replayBatchMutation = useMutation({
    mutationFn: (draftIds: string[]) => deliveryControlPlaneApi.replayCommentDraftBatch(selectedCompanyId!, { draftIds, limit: Math.max(draftIds.length, 1) }),
    ...actionOptions,
  });
  const recoveryMutation = useMutation({
    mutationFn: (diagnosis: ControlPlaneIssueDiagnosis) => deliveryControlPlaneApi.resolveRecoveryAction(diagnosis.issueId, {
      actionId: stringFromEvidence(diagnosis.evidence, ["recoveryActionId", "actionId"]) ?? undefined,
      outcome: "restored",
      sourceIssueStatus: "todo",
      resolutionNote: t("deliveryControlPlane.executeRecovery"),
    }),
    ...actionOptions,
  });
  const blockerMutation = useMutation({
    mutationFn: (diagnosis: ControlPlaneIssueDiagnosis) => deliveryControlPlaneApi.downgradeBlockerPolicy(
      stringFromEvidence(diagnosis.evidence, ["blockerPolicyId", "policyId"]) ?? diagnosis.issueId,
      { targetLevel: "soft", reason: t("deliveryControlPlane.degradeBlocker") },
    ),
    ...actionOptions,
  });

  const diagnostics = diagnosticsQuery.data?.diagnostics ?? [];
  const drafts = draftsQuery.data?.drafts ?? [];
  const modelSummaries = modelHealthQuery.data?.summaries ?? diagnosticsQuery.data?.modelHealthSummaries ?? [];
  const summary = diagnosticsQuery.data?.summary;
  const riskyDiagnostics = diagnostics.filter((item) => item.severity !== "info" || item.liveness !== "healthy");
  const stalledAgentIds = useMemo(
    () => Array.from(new Set(diagnostics.map((item) => item.assigneeAgentId).filter((id): id is string => Boolean(id)))),
    [diagnostics],
  );
  const evidenceReady = diagnostics.filter((item) => item.evidenceStatus === "ready_for_review").length;
  const evidenceMissing = diagnostics.filter((item) => item.evidenceStatus !== "ready_for_review").length;

  if (!selectedCompanyId) {
    return <EmptyState icon={Bot} message={t("deliveryControlPlane.selectCompanyHint")} />;
  }

  if (diagnosticsQuery.isLoading || draftsQuery.isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("deliveryControlPlane.pageTitle")}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {t("deliveryControlPlane.pageDescription")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => invalidate()} disabled={diagnosticsQuery.isFetching || draftsQuery.isFetching || modelHealthQuery.isFetching}>
            <RefreshCw className="mr-2 h-4 w-4" />{t("deliveryControlPlane.refresh")}
          </Button>
          <Button onClick={() => wakeMutation.mutate(stalledAgentIds)} disabled={stalledAgentIds.length === 0 || wakeMutation.isPending}>
            {t("deliveryControlPlane.wakeAll")}
          </Button>
          <Button variant="outline" onClick={() => replayBatchMutation.mutate(drafts.map((draft) => draft.id))} disabled={drafts.length === 0 || replayBatchMutation.isPending}>
            {t("deliveryControlPlane.replayAllDrafts")}
          </Button>
        </div>
      </div>

      {message ? <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">{message}</div> : null}

      <section className="space-y-3" aria-label={t("deliveryControlPlane.healthOverview")}>
        <h2 className="text-lg font-semibold">{t("deliveryControlPlane.healthOverview")}</h2>
        {summary ? <p className="text-sm text-muted-foreground">{summary.headline}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {metric(summary?.counts.total ?? diagnostics.length, t("deliveryControlPlane.total"))}
          {metric(summary?.counts.healthy ?? 0, t("deliveryControlPlane.healthy"))}
          {metric(summary?.counts.suspicious ?? 0, t("deliveryControlPlane.suspicious"))}
          {metric(summary?.counts.blocked ?? 0, t("deliveryControlPlane.blocked"))}
          {metric(summary?.counts.stalled ?? 0, t("deliveryControlPlane.stalled"))}
          {metric(summary?.counts.critical ?? 0, t("deliveryControlPlane.critical"), (summary?.counts.critical ?? 0) > 0 ? "border-destructive/40" : "")}
        </div>
      </section>

      <section className="space-y-3" aria-label={t("deliveryControlPlane.riskItems")}>
        <h2 className="text-lg font-semibold">{t("deliveryControlPlane.riskItems")}</h2>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {riskyDiagnostics.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">{t("deliveryControlPlane.noRiskItems")}</div>
          ) : riskyDiagnostics.map((item) => <RiskRow key={item.issueId} item={item} onRecover={() => recoveryMutation.mutate(item)} onDowngrade={() => blockerMutation.mutate(item)} />)}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <DraftQueue drafts={drafts} onReplay={(id) => replayDraftMutation.mutate(id)} />
        <RecoveryPanel diagnostics={riskyDiagnostics} onRecover={(item) => recoveryMutation.mutate(item)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ModelHealthPanel summaries={modelSummaries} />
        <section className="space-y-3" aria-label={t("deliveryControlPlane.evidenceCompleteness")}>
          <h2 className="text-lg font-semibold">{t("deliveryControlPlane.evidenceCompleteness")}</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {metric(evidenceReady, t("deliveryControlPlane.evidenceReady"))}
            {metric(evidenceMissing, t("deliveryControlPlane.evidenceMissing"))}
            {metric(diagnostics.reduce((sum, item) => sum + numberFromEvidence(item.evidence, "workProductCount"), 0), t("deliveryControlPlane.workProducts"))}
          </div>
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            {t("deliveryControlPlane.evidenceHint")}
          </div>
        </section>
      </div>
    </div>
  );
}

function RiskRow({ item, onRecover, onDowngrade }: { item: ControlPlaneIssueDiagnosis; onRecover: () => void; onDowngrade: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 border-b border-border p-4 text-sm last:border-b-0 lg:grid-cols-[1.3fr_1fr_1.2fr_auto]">
      <div className="min-w-0">
        <Link to={`/issues/${item.issueId}`} className="font-medium text-foreground hover:underline">
          {item.identifier ?? item.issueId}
        </Link>
        <div className="mt-1 truncate text-muted-foreground">{item.title}</div>
        <div className="mt-2 flex flex-wrap gap-1">{pill(item.liveness)}{pill(item.severity)}{pill(item.blockerStatus)}</div>
      </div>
      <div className="space-y-1 text-xs text-muted-foreground">
        <div>{t("deliveryControlPlane.run")}：{item.executionStatus}</div>
        <div>{t("deliveryControlPlane.evidence")}：{item.evidenceStatus}</div>
        <div>{t("deliveryControlPlane.recovery")}：{item.recoveryStatus}</div>
      </div>
      <div className="text-xs text-muted-foreground">
        <div className="font-medium text-foreground">{t("deliveryControlPlane.nextStep")}</div>
        <div>{item.nextAction}</div>
        {item.reasons.length > 0 ? <div className="mt-1">{item.reasons.join("；")}</div> : null}
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <Button size="sm" variant="outline" onClick={onRecover}>{t("deliveryControlPlane.executeRecovery")}</Button>
        <Button size="sm" variant="outline" onClick={onDowngrade} disabled={item.blockerStatus === "none"}>{t("deliveryControlPlane.degradeBlocker")}</Button>
      </div>
    </div>
  );
}

function DraftQueue({ drafts, onReplay }: { drafts: CommentDraft[]; onReplay: (draftId: string) => void }) {
  const { t } = useTranslation();
  return (
    <section className="space-y-3" aria-label={t("deliveryControlPlane.commentDraftQueue")}>
      <h2 className="text-lg font-semibold">{t("deliveryControlPlane.commentDraftQueue")}</h2>
      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {drafts.length === 0 ? <div className="p-4 text-sm text-muted-foreground">{t("deliveryControlPlane.noDrafts")}</div> : drafts.map((draft) => (
          <div key={draft.id} className="p-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Link to={`/issues/${draft.issueId}`} className="font-medium hover:underline">{t("deliveryControlPlane.issueDetail")}</Link>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t("deliveryControlPlane.replayStatus")}：{draft.replayStatus} ·
                  {t("deliveryControlPlane.replayAttempts")} {draft.replayAttemptCount ?? 0}
                  {draft.createdAt ? ` · ${relativeTime(draft.createdAt)}` : ""}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => onReplay(draft.id)}>{t("deliveryControlPlane.replayDraft")}</Button>
            </div>
            <p className="mt-2 line-clamp-3 text-muted-foreground">{draft.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecoveryPanel({ diagnostics, onRecover }: { diagnostics: ControlPlaneIssueDiagnosis[]; onRecover: (diagnosis: ControlPlaneIssueDiagnosis) => void }) {
  const { t } = useTranslation();
  const active = diagnostics.filter((item) => item.recoveryStatus !== "none");
  return (
    <section className="space-y-3" aria-label={t("deliveryControlPlane.recoveryActions")}>
      <h2 className="text-lg font-semibold">{t("deliveryControlPlane.recoveryActions")}</h2>
      <div className="rounded-lg border border-border bg-card p-4">
        {active.length === 0 ? <div className="text-sm text-muted-foreground">{t("deliveryControlPlane.noRecoveryActions")}</div> : active.map((item) => (
          <div key={item.issueId} className="mb-3 flex items-start justify-between gap-3 last:mb-0">
            <div className="text-sm">
              <div className="flex items-center gap-2 font-medium"><ShieldAlert className="h-4 w-4 text-amber-600" />{item.identifier ?? item.issueId}</div>
              <div className="mt-1 text-xs text-muted-foreground">{item.nextAction}</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => onRecover(item)}>{t("deliveryControlPlane.executeRecovery")}</Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function ModelHealthPanel({ summaries }: { summaries: ModelHealthSummary[] }) {
  const { t } = useTranslation();
  return (
    <section className="space-y-3" aria-label={t("deliveryControlPlane.modelHealth")}>
      <h2 className="text-lg font-semibold">{t("deliveryControlPlane.modelHealth")}</h2>
      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {summaries.length === 0 ? <div className="p-4 text-sm text-muted-foreground">{t("deliveryControlPlane.noModelHealthEvents")}</div> : summaries.map((summary) => (
          <div key={`${summary.adapterType}:${summary.modelId ?? "default"}`} className="p-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">{summary.adapterType}{summary.modelId ? ` / ${summary.modelId}` : ""}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {summary.totalEvents} {t("deliveryControlPlane.events")} ·
                  {summary.failureEvents} {t("deliveryControlPlane.failures")} ·
                  {t("deliveryControlPlane.avgLatency")} {summary.averageLatencyMs ?? "-"}ms
                </div>
              </div>
              {pill(summary.status)}
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              {summary.status === "healthy" ? <CheckCircle2 className="h-3 w-3 text-emerald-600" /> : <AlertTriangle className="h-3 w-3 text-amber-600" />}
              {t("deliveryControlPlane.healthScore")} {summary.healthScore} ·
              {t("deliveryControlPlane.recommendedAction")} {summary.recommendedAction}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
