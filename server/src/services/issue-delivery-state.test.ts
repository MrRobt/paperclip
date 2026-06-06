import { describe, expect, it } from "vitest";
import { deriveIssueDeliveryState, isCompletionEvidenceWorkProduct } from "./issue-delivery-state.js";

function issue(overrides: { status?: any; executionRunId?: string | null } = {}) {
  return {
    status: overrides.status ?? "todo",
    executionRunId: overrides.executionRunId ?? null,
  };
}

function workProduct(overrides: { id?: string; type?: string; status?: string } = {}) {
  return {
    id: overrides.id ?? "wp-1",
    type: overrides.type ?? "commit",
    status: overrides.status ?? "active",
  };
}

describe("deriveIssueDeliveryState", () => {
  it("separates running with no output from verified completion", () => {
    expect(deriveIssueDeliveryState(issue({ status: "in_progress", executionRunId: "run-1" }), [])).toMatchObject({
      platformStatus: "in_progress",
      processState: "running",
      outputState: "no_output",
      verificationState: "unverified",
      hasCompletionEvidence: false,
      summary: "运行中，尚未看到可复验产出。",
    });

    expect(deriveIssueDeliveryState(issue({ status: "done" }), [workProduct({ id: "commit-1" })])).toMatchObject({
      platformStatus: "done",
      processState: "completed",
      outputState: "has_evidence",
      verificationState: "verified",
      hasCompletionEvidence: true,
      evidenceWorkProductIds: ["commit-1"],
      summary: "已完成，且已绑定可复验交付证据。",
    });
  });

  it("marks in-progress issues without an execution run as stale", () => {
    expect(deriveIssueDeliveryState(issue({ status: "in_progress" }), [])).toMatchObject({
      processState: "stale",
      outputState: "no_output",
      verificationState: "unverified",
      summary: "事项标记为进行中，但没有活动运行，疑似空转。",
    });
  });

  it("does not count draft or failed work products as completion evidence", () => {
    expect(isCompletionEvidenceWorkProduct(workProduct({ status: "draft" }))).toBe(false);
    expect(isCompletionEvidenceWorkProduct(workProduct({ status: "failed" }))).toBe(false);
    expect(isCompletionEvidenceWorkProduct(workProduct({ type: "runtime_service", status: "active" }))).toBe(false);
    expect(isCompletionEvidenceWorkProduct(workProduct({ type: "artifact", status: "ready_for_review" }))).toBe(true);
  });
});
