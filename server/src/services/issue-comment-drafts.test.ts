import { describe, expect, it } from "vitest";

import {
  buildReplayAttemptResult,
  shouldAutoReplayDraft,
  toPersistableCommentDraft,
} from "./issue-comment-drafts.js";

describe("issue comment drafts persistence helpers", () => {
  it("把评论失败输入转换为可入库草稿", () => {
    const draft = toPersistableCommentDraft({
      companyId: "company-1",
      issueId: "issue-1",
      authorType: "agent",
      authorAgentId: "agent-1",
      body: "验证命令：pnpm test:run\n验证结果：通过",
      failureKind: "blocked",
      failureReason: "存在强阻塞",
      httpStatus: 409,
      requestedAt: "2026-06-08T03:00:00.000Z",
      rawErrorMessage: "blocked by hard gate",
    });

    expect(draft.companyId).toBe("company-1");
    expect(draft.issueId).toBe("issue-1");
    expect(draft.authorAgentId).toBe("agent-1");
    expect(draft.replayStatus).toBe("pending");
    expect(draft.errorMessage).toContain("评论未写入");
    expect(draft.errorMessage).toContain("blocked by hard gate");
  });

  it("鉴权失败草稿不会被自动重放", () => {
    expect(shouldAutoReplayDraft({ replayStatus: "pending", replayAttemptCount: 0, maxAttempts: 3, failureKind: "unauthorized" })).toBe(false);
    expect(shouldAutoReplayDraft({ replayStatus: "pending", replayAttemptCount: 0, maxAttempts: 3, failureKind: "server_error" })).toBe(true);
  });

  it("重放成功递增次数并关联评论编号", () => {
    const result = buildReplayAttemptResult({
      ok: true,
      attemptCountBefore: 1,
      replayedCommentId: "comment-1",
      now: new Date("2026-06-08T03:10:00.000Z"),
    });

    expect(result.replayStatus).toBe("done");
    expect(result.replayAttemptCount).toBe(2);
    expect(result.replayedCommentId).toBe("comment-1");
    expect(result.errorMessage).toBeNull();
  });

  it("前置条件仍阻塞时不递增重放次数", () => {
    const result = buildReplayAttemptResult({
      ok: false,
      blocked: true,
      attemptCountBefore: 2,
      failureReason: "仍缺少权限",
      now: new Date("2026-06-08T03:10:00.000Z"),
    });

    expect(result.replayStatus).toBe("blocked");
    expect(result.replayAttemptCount).toBe(2);
    expect(result.errorMessage).toContain("仍缺少权限");
  });
});
