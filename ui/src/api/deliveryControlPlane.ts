import { api } from "./client";

export type DeliveryLiveness = "healthy" | "suspicious" | "blocked" | "stalled";
export type DeliverySeverity = "info" | "warning" | "critical";

export interface ControlPlaneDiagnosticsSummary {
  counts: {
    total: number;
    healthy: number;
    suspicious: number;
    blocked: number;
    stalled: number;
    critical: number;
  };
  headline: string;
  criticalIssueIds: string[];
}

export interface ControlPlaneIssueDiagnosis {
  issueId: string;
  identifier: string | null;
  title: string;
  issueStatus: string;
  assigneeAgentId: string | null;
  executionStatus: string;
  evidenceStatus: string;
  recoveryStatus: string;
  blockerStatus: "none" | "hard" | "soft" | "notice";
  liveness: DeliveryLiveness;
  severity: DeliverySeverity;
  nextAction: string;
  nextOwnerType: "agent" | "user" | "system" | "controller";
  nextOwnerId: string | null;
  reasons: string[];
  evidence: Record<string, unknown>;
}

export interface ModelHealthSummary {
  adapterType: string;
  modelId: string | null;
  totalEvents: number;
  failureEvents: number;
  timeoutEvents: number;
  rateLimitedEvents: number;
  fallbackAppliedEvents: number;
  averageLatencyMs: number | null;
  healthScore: number;
  status: "healthy" | "degraded" | "unhealthy";
  recommendedAction: "use_primary" | "retry_primary" | "fallback_model" | "pause_and_escalate";
  recentErrorKinds: string[];
}

export interface ControlPlaneDiagnosticsResponse {
  summary: ControlPlaneDiagnosticsSummary;
  diagnostics: ControlPlaneIssueDiagnosis[];
  modelHealthSummaries: ModelHealthSummary[];
}

export interface CommentDraft {
  id: string;
  companyId?: string;
  issueId: string;
  body: string;
  replayStatus: string;
  replayAttemptCount?: number;
  lastReplayError?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CommentDraftsResponse {
  drafts: CommentDraft[];
}

export interface ModelHealthResponse {
  summaries: ModelHealthSummary[];
  events: unknown[];
}

function withQuery(path: string, query?: Record<string, string | number | boolean | null | undefined>) {
  const params = new URLSearchParams();
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) params.set(key, String(value));
  });
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export const deliveryControlPlaneApi = {
  getDiagnostics: (companyId: string, query?: { limit?: number; includeDone?: boolean }) =>
    api.get<ControlPlaneDiagnosticsResponse>(withQuery(`/companies/${companyId}/control-plane/diagnostics`, query)),

  refreshDiagnostics: (companyId: string) =>
    api.post<ControlPlaneDiagnosticsResponse>(`/companies/${companyId}/control-plane/diagnostics/refresh`, {}),

  getCommentDrafts: (companyId: string, query?: { status?: string; limit?: number }) =>
    api.get<CommentDraftsResponse>(withQuery(`/companies/${companyId}/comment-drafts`, query)),

  replayCommentDraft: (draftId: string, body: { force?: boolean } = {}) =>
    api.post<unknown>(`/comment-drafts/${draftId}/replay`, body),

  replayCommentDraftBatch: (companyId: string, body: { draftIds?: string[]; maxAttempts?: number; limit?: number } = {}) =>
    api.post<unknown>(`/companies/${companyId}/comment-drafts/replay-batch`, body),

  getModelHealth: (companyId: string, query?: { adapterType?: string; modelId?: string | null; limit?: number }) =>
    api.get<ModelHealthResponse>(withQuery(`/companies/${companyId}/model-health`, query)),

  wakeAgents: (companyId: string, body: { agentIds: string[]; reason: string; issueId?: string | null; source?: string }) =>
    api.post<unknown>(`/companies/${companyId}/agents/wakeup-batch`, body),

  resolveRecoveryAction: (
    issueId: string,
    body: { actionId?: string; outcome: "restored" | "false_positive" | "blocked" | "cancelled"; sourceIssueStatus: "todo" | "done" | "in_review" | "blocked"; resolutionNote?: string | null },
  ) => api.post<unknown>(`/issues/${issueId}/recovery-actions/resolve`, body),

  downgradeBlockerPolicy: (blockerPolicyId: string, body: { targetLevel: "soft" | "notice"; reason: string }) =>
    api.post<unknown>(`/blocker-policies/${blockerPolicyId}/downgrade`, body),
};
