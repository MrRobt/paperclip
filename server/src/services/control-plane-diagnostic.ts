import { summarizeLatestCompletionEvidence } from "./dispatch-gates.js";
import { strongestBlockerStatus, type IssueBlockerPolicyLike } from "./issue-blocker-policies.js";
import type { ModelHealthSummary } from "./model-health.js";

export type ControlPlaneExecutionStatus = "none" | "queued" | "running" | "scheduled_retry" | "lost" | "terminal";
export type ControlPlaneEvidenceStatus = "none" | "insufficient" | "needs_evidence" | "ready_for_review";
export type ControlPlaneRecoveryStatus = "none" | "active" | "escalated" | "resolved";
export type ControlPlaneLiveness = "healthy" | "suspicious" | "blocked" | "stalled";
export type ControlPlaneSeverity = "info" | "warning" | "critical";

export interface ControlPlaneIssueLike {
  id: string;
  identifier?: string | null;
  title: string;
  status: string;
  assigneeAgentId?: string | null;
  checkoutRunId?: string | null;
  executionRunId?: string | null;
}

export interface ControlPlaneRunLike {
  id: string;
  status?: string | null;
  livenessState?: string | null;
  livenessReason?: string | null;
  scheduledRetryAt?: Date | string | null;
  lastOutputAt?: Date | string | null;
  finishedAt?: Date | string | null;
  nextAction?: string | null;
}

export interface ControlPlaneRecoveryActionLike {
  id: string;
  status: string;
  ownerType?: string | null;
  ownerAgentId?: string | null;
  nextAction?: string | null;
  cause?: string | null;
}

export interface ControlPlaneWorkProductLike {
  id: string;
  status?: string | null;
  reviewState?: string | null;
  healthStatus?: string | null;
}

export interface ControlPlaneCommentLike {
  id: string;
  body: string;
  createdAt?: Date | string | null;
}

export interface ControlPlaneIssueDiagnosis {
  issueId: string;
  identifier: string | null;
  title: string;
  issueStatus: string;
  assigneeAgentId: string | null;
  executionStatus: ControlPlaneExecutionStatus;
  evidenceStatus: ControlPlaneEvidenceStatus;
  recoveryStatus: ControlPlaneRecoveryStatus;
  blockerStatus: "none" | "hard" | "soft" | "notice";
  liveness: ControlPlaneLiveness;
  severity: ControlPlaneSeverity;
  nextAction: string;
  nextOwnerType: "agent" | "user" | "system" | "controller";
  nextOwnerId: string | null;
  reasons: string[];
  evidence: Record<string, unknown>;
}

const TERMINAL_ISSUE_STATUSES = new Set(["done", "cancelled"]);
const RUNNING_RUN_STATUSES = new Set(["running", "claimed", "started"]);
const QUEUED_RUN_STATUSES = new Set(["queued", "pending"]);
const TERMINAL_RUN_STATUSES = new Set(["succeeded", "success", "failed", "cancelled", "completed"]);

export function diagnoseControlPlaneIssue(input: {
  issue: ControlPlaneIssueLike;
  run?: ControlPlaneRunLike | null;
  comments?: readonly ControlPlaneCommentLike[];
  workProducts?: readonly ControlPlaneWorkProductLike[];
  recoveryActions?: readonly ControlPlaneRecoveryActionLike[];
  blockerPolicies?: readonly IssueBlockerPolicyLike[];
  modelHealth?: ModelHealthSummary | null;
  now?: Date;
  staleAfterMs?: number;
}): ControlPlaneIssueDiagnosis {
  const now = input.now ?? new Date();
  const staleAfterMs = input.staleAfterMs ?? 30 * 60_000;
  const issue = input.issue;
  const comments = input.comments ?? [];
  const workProducts = input.workProducts ?? [];
  const recoveryActions = input.recoveryActions ?? [];
  const blockerPolicies = input.blockerPolicies ?? [];
  const run = input.run ?? null;

  const executionStatus = deriveExecutionStatus({ run, issue });
  const evidenceScore = summarizeLatestCompletionEvidence(comments);
  const evidenceStatus = deriveEvidenceStatus({ evidenceScoreStatus: evidenceScore.status, workProducts });
  const recoveryStatus = deriveRecoveryStatus(recoveryActions);
  const blockerStatus = strongestBlockerStatus(blockerPolicies);
  const reasons: string[] = [];

  if (blockerStatus !== "none") reasons.push(`存在${blockerStatus === "hard" ? "强" : blockerStatus === "soft" ? "弱" : "提示"}阻塞`);
  if (executionStatus === "lost") reasons.push(run?.livenessReason ?? "运行丢失或无输出超时");
  if (executionStatus === "none" && !TERMINAL_ISSUE_STATUSES.has(issue.status)) reasons.push("非终态事项没有活跃运行");
  if (evidenceStatus === "none" || evidenceStatus === "insufficient") reasons.push("完成证据不足");
  if (recoveryStatus === "active") reasons.push("已有恢复动作待处理");
  if (input.modelHealth?.status === "degraded") reasons.push("模型通道降级");
  if (input.modelHealth?.status === "unhealthy") reasons.push("模型通道不健康");

  const stalledBySilence = isRunStalledByOutputSilence({ run, now, staleAfterMs });
  if (stalledBySilence) reasons.push("运行长时间无有效输出");

  const liveness = deriveLiveness({ issueStatus: issue.status, executionStatus, evidenceStatus, recoveryStatus, blockerStatus, stalledBySilence, modelHealth: input.modelHealth ?? null });
  const severity = deriveSeverity(liveness, blockerStatus, input.modelHealth ?? null);
  const next = deriveNextAction({ issue, executionStatus, evidenceStatus, recoveryStatus, blockerStatus, liveness, recoveryActions, run, modelHealth: input.modelHealth ?? null });

  return {
    issueId: issue.id,
    identifier: issue.identifier ?? null,
    title: issue.title,
    issueStatus: issue.status,
    assigneeAgentId: issue.assigneeAgentId ?? null,
    executionStatus,
    evidenceStatus,
    recoveryStatus,
    blockerStatus,
    liveness,
    severity,
    nextAction: next.action,
    nextOwnerType: next.ownerType,
    nextOwnerId: next.ownerId,
    reasons,
    evidence: {
      evidenceScore,
      workProductCount: workProducts.length,
      recoveryActionCount: recoveryActions.length,
      modelHealth: input.modelHealth ?? null,
      runId: run?.id ?? null,
    },
  };
}

function deriveExecutionStatus(input: {
  run: ControlPlaneRunLike | null;
  issue: ControlPlaneIssueLike;
}): ControlPlaneExecutionStatus {
  const run = input.run;
  if (!run) return "none";
  const status = run.status ?? "";
  if (QUEUED_RUN_STATUSES.has(status)) return "queued";
  if (RUNNING_RUN_STATUSES.has(status)) return "running";
  if (run.scheduledRetryAt) return "scheduled_retry";
  if (status === "lost" || run.livenessState === "lost" || run.livenessState === "process_lost") return "lost";
  if (TERMINAL_RUN_STATUSES.has(status) || run.finishedAt) return "terminal";
  return input.issue.executionRunId === run.id ? "running" : "none";
}

function deriveEvidenceStatus(input: {
  evidenceScoreStatus: "insufficient" | "needs_evidence" | "ready_for_review";
  workProducts: readonly ControlPlaneWorkProductLike[];
}): ControlPlaneEvidenceStatus {
  if (input.workProducts.length === 0 && input.evidenceScoreStatus === "insufficient") return "none";
  if (input.evidenceScoreStatus === "ready_for_review") return "ready_for_review";
  if (input.workProducts.some((product) => product.status === "ready" || product.reviewState === "ready_for_review")) {
    return "needs_evidence";
  }
  return input.evidenceScoreStatus;
}

function deriveRecoveryStatus(actions: readonly ControlPlaneRecoveryActionLike[]): ControlPlaneRecoveryStatus {
  if (actions.some((action) => action.status === "escalated")) return "escalated";
  if (actions.some((action) => action.status === "active" || action.status === "pending")) return "active";
  if (actions.some((action) => action.status === "resolved")) return "resolved";
  return "none";
}

function isRunStalledByOutputSilence(input: {
  run: ControlPlaneRunLike | null;
  now: Date;
  staleAfterMs: number;
}): boolean {
  if (!input.run || !RUNNING_RUN_STATUSES.has(input.run.status ?? "")) return false;
  if (!input.run.lastOutputAt) return true;
  const lastOutputAt = new Date(input.run.lastOutputAt).getTime();
  if (Number.isNaN(lastOutputAt)) return true;
  return input.now.getTime() - lastOutputAt >= input.staleAfterMs;
}

function deriveLiveness(input: {
  issueStatus: string;
  executionStatus: ControlPlaneExecutionStatus;
  evidenceStatus: ControlPlaneEvidenceStatus;
  recoveryStatus: ControlPlaneRecoveryStatus;
  blockerStatus: "none" | "hard" | "soft" | "notice";
  stalledBySilence: boolean;
  modelHealth: ModelHealthSummary | null;
}): ControlPlaneLiveness {
  if (TERMINAL_ISSUE_STATUSES.has(input.issueStatus)) return "healthy";
  if (input.blockerStatus === "hard") return "blocked";
  if (input.recoveryStatus === "active" || input.recoveryStatus === "escalated") return "blocked";
  if (input.executionStatus === "lost" || input.stalledBySilence) return "stalled";
  if (input.executionStatus === "none" && input.evidenceStatus !== "ready_for_review") return "stalled";
  if (input.modelHealth?.status === "unhealthy") return "blocked";
  if (input.blockerStatus === "soft" || input.modelHealth?.status === "degraded") return "suspicious";
  return "healthy";
}

function deriveSeverity(
  liveness: ControlPlaneLiveness,
  blockerStatus: "none" | "hard" | "soft" | "notice",
  modelHealth: ModelHealthSummary | null,
): ControlPlaneSeverity {
  if (liveness === "blocked" || liveness === "stalled" || blockerStatus === "hard" || modelHealth?.status === "unhealthy") {
    return "critical";
  }
  if (liveness === "suspicious" || blockerStatus === "soft" || modelHealth?.status === "degraded") return "warning";
  return "info";
}

function deriveNextAction(input: {
  issue: ControlPlaneIssueLike;
  executionStatus: ControlPlaneExecutionStatus;
  evidenceStatus: ControlPlaneEvidenceStatus;
  recoveryStatus: ControlPlaneRecoveryStatus;
  blockerStatus: "none" | "hard" | "soft" | "notice";
  liveness: ControlPlaneLiveness;
  recoveryActions: readonly ControlPlaneRecoveryActionLike[];
  run: ControlPlaneRunLike | null;
  modelHealth: ModelHealthSummary | null;
}): { action: string; ownerType: "agent" | "user" | "system" | "controller"; ownerId: string | null } {
  if (TERMINAL_ISSUE_STATUSES.has(input.issue.status)) {
    return { action: "事项已终态，保持审计观察。", ownerType: "system", ownerId: null };
  }
  if (input.blockerStatus === "hard") {
    return { action: "处理强阻塞；如只需补评论或证据，可走旁路动作。", ownerType: "controller", ownerId: null };
  }
  if (input.recoveryStatus === "active" || input.recoveryStatus === "escalated") {
    const action = input.recoveryActions.find((item) => item.status === "active" || item.status === "escalated");
    return { action: action?.nextAction ?? "执行或复核恢复动作。", ownerType: action?.ownerType === "user" ? "user" : "agent", ownerId: action?.ownerAgentId ?? null };
  }
  if (input.modelHealth?.recommendedAction === "fallback_model") {
    return { action: "模型通道异常，按降级策略选择备用模型或生成恢复动作。", ownerType: "system", ownerId: null };
  }
  if (input.executionStatus === "lost" || input.liveness === "stalled") {
    return { action: input.run?.nextAction ?? "创建恢复动作并重新唤醒负责人。", ownerType: "system", ownerId: null };
  }
  if (input.evidenceStatus !== "ready_for_review") {
    return { action: "补充完成证据：改动摘要、分支、提交号、验证命令、验证结果和复审口径。", ownerType: input.issue.assigneeAgentId ? "agent" : "controller", ownerId: input.issue.assigneeAgentId ?? null };
  }
  return { action: "证据已可复审，等待主控验收或进入完成流程。", ownerType: "controller", ownerId: null };
}

export function summarizeControlPlaneDiagnostics(diagnostics: readonly ControlPlaneIssueDiagnosis[]) {
  const counts = {
    total: diagnostics.length,
    healthy: diagnostics.filter((item) => item.liveness === "healthy").length,
    suspicious: diagnostics.filter((item) => item.liveness === "suspicious").length,
    blocked: diagnostics.filter((item) => item.liveness === "blocked").length,
    stalled: diagnostics.filter((item) => item.liveness === "stalled").length,
    critical: diagnostics.filter((item) => item.severity === "critical").length,
  };
  return {
    counts,
    headline: `控制面诊断 ${counts.total} 项：健康 ${counts.healthy}，可疑 ${counts.suspicious}，阻塞 ${counts.blocked}，静默停滞 ${counts.stalled}。`,
    criticalIssueIds: diagnostics.filter((item) => item.severity === "critical").map((item) => item.issueId),
  };
}
