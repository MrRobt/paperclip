import type { IssueDeliveryState, IssueStatus } from "@paperclipai/shared";

export const COMPLETION_EVIDENCE_WORK_PRODUCT_TYPES = new Set([
  "artifact",
  "branch",
  "commit",
  "document",
  "preview_url",
  "pull_request",
]);

export const NON_COMPLETION_EVIDENCE_WORK_PRODUCT_STATUSES = new Set([
  "archived",
  "changes_requested",
  "draft",
  "failed",
]);

export function isCompletionEvidenceWorkProduct(workProduct: { type: string; status: string }) {
  return COMPLETION_EVIDENCE_WORK_PRODUCT_TYPES.has(workProduct.type)
    && !NON_COMPLETION_EVIDENCE_WORK_PRODUCT_STATUSES.has(workProduct.status);
}

function deriveProcessState(issue: { executionRunId?: string | null; status: string }): IssueDeliveryState["processState"] {
  if (issue.status === "done") return "completed";
  if (issue.status === "cancelled") return "cancelled";
  if (issue.executionRunId) return "running";
  if (issue.status === "in_progress") return "stale";
  if (issue.status === "in_review") return "waiting_for_review";
  if (issue.status === "blocked") return "blocked";
  return "not_started";
}

function deliverySummary(state: Omit<IssueDeliveryState, "summary">): string {
  if (state.platformStatus === "done" && state.hasCompletionEvidence) return "已完成，且已绑定可复验交付证据。";
  if (state.platformStatus === "done") return "已完成，但缺少可复验交付证据。";
  if (state.processState === "running" && state.outputState === "no_output") return "运行中，尚未看到可复验产出。";
  if (state.processState === "stale") return "事项标记为进行中，但没有活动运行，疑似空转。";
  if (state.outputState === "has_evidence" && state.verificationState === "evidence_attached") return "已有交付证据，等待验收。";
  if (state.platformStatus === "blocked") return "事项处于阻塞状态，可继续补充评论或证据。";
  return "尚未形成可复验交付。";
}

export function deriveIssueDeliveryState(
  issue: { executionRunId?: string | null; status: string },
  workProducts: Array<{ id: string; status: string; type: string }>,
): IssueDeliveryState {
  const evidenceWorkProducts = workProducts.filter(isCompletionEvidenceWorkProduct);
  const hasCompletionEvidence = evidenceWorkProducts.length > 0;
  const outputState: IssueDeliveryState["outputState"] = hasCompletionEvidence
    ? "has_evidence"
    : workProducts.length > 0
      ? "activity_only"
      : "no_output";
  const verificationState: IssueDeliveryState["verificationState"] = issue.status === "done"
    ? hasCompletionEvidence ? "verified" : "evidence_required"
    : hasCompletionEvidence ? "evidence_attached" : "unverified";
  const state = {
    platformStatus: issue.status as IssueStatus,
    processState: deriveProcessState(issue),
    outputState,
    verificationState,
    hasCompletionEvidence,
    evidenceWorkProductCount: evidenceWorkProducts.length,
    evidenceWorkProductIds: evidenceWorkProducts.map((workProduct) => workProduct.id),
  } satisfies Omit<IssueDeliveryState, "summary">;

  return {
    ...state,
    summary: deliverySummary(state),
  };
}
