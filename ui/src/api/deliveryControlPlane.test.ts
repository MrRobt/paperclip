import { describe, expect, it, vi, beforeEach } from "vitest";
import { api } from "./client";
import { deliveryControlPlaneApi } from "./deliveryControlPlane";

vi.mock("./client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe("deliveryControlPlaneApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({});
    vi.mocked(api.post).mockResolvedValue({});
  });

  it("loads diagnostics, comment drafts, and model health from company scoped endpoints", async () => {
    await deliveryControlPlaneApi.getDiagnostics("company-1", { limit: 75, includeDone: true });
    await deliveryControlPlaneApi.getCommentDrafts("company-1", { status: "pending", limit: 25 });
    await deliveryControlPlaneApi.getModelHealth("company-1", { limit: 50 });

    expect(api.get).toHaveBeenNthCalledWith(
      1,
      "/companies/company-1/control-plane/diagnostics?limit=75&includeDone=true",
    );
    expect(api.get).toHaveBeenNthCalledWith(
      2,
      "/companies/company-1/comment-drafts?status=pending&limit=25",
    );
    expect(api.get).toHaveBeenNthCalledWith(3, "/companies/company-1/model-health?limit=50");
  });

  it("posts replay, batch wakeup, recovery resolution, and blocker downgrade commands", async () => {
    await deliveryControlPlaneApi.replayCommentDraft("draft-1", { force: true });
    await deliveryControlPlaneApi.replayCommentDraftBatch("company-1", { draftIds: ["draft-1"], limit: 10 });
    await deliveryControlPlaneApi.wakeAgents("company-1", { agentIds: ["agent-1"], reason: "control-plane" });
    await deliveryControlPlaneApi.resolveRecoveryAction("issue-1", {
      actionId: "action-1",
      outcome: "restored",
      sourceIssueStatus: "todo",
      resolutionNote: "recovered",
    });
    await deliveryControlPlaneApi.downgradeBlockerPolicy("policy-1", {
      targetLevel: "soft",
      reason: "allow evidence replay",
    });

    expect(api.post).toHaveBeenNthCalledWith(1, "/comment-drafts/draft-1/replay", { force: true });
    expect(api.post).toHaveBeenNthCalledWith(2, "/companies/company-1/comment-drafts/replay-batch", {
      draftIds: ["draft-1"],
      limit: 10,
    });
    expect(api.post).toHaveBeenNthCalledWith(3, "/companies/company-1/agents/wakeup-batch", {
      agentIds: ["agent-1"],
      reason: "control-plane",
    });
    expect(api.post).toHaveBeenNthCalledWith(4, "/issues/issue-1/recovery-actions/resolve", {
      actionId: "action-1",
      outcome: "restored",
      sourceIssueStatus: "todo",
      resolutionNote: "recovered",
    });
    expect(api.post).toHaveBeenNthCalledWith(5, "/blocker-policies/policy-1/downgrade", {
      targetLevel: "soft",
      reason: "allow evidence replay",
    });
  });
});
