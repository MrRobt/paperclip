import { describe, expect, it } from "vitest";

import {
  buildCommentDraft,
  mergeCommentDrafts,
  summarizeDraftQueue,
  toDraftReplayFailure,
  validateDraftReplayRequest,
} from "./comment-draft-queue.js";

describe("comment draft queue helpers", () => {
  it("评论因阻塞降级时构造草稿，保留原始正文与失败原因", () => {
    const draft = buildCommentDraft({
      issueId: "issue-1",
      authorType: "agent",
      authorId: "agent-7",
      body: "已经完成 C1.1 验证，下面是证据：\n- 提交号 58be31d8f",
      requestedAt: "2026-06-06T10:00:00.000Z",
      failure: {
        kind: "blocked",
        reason: "存在未解决的强阻塞",
        httpStatus: 409,
      },
    });

    expect(draft.id).toBeTruthy();
    expect(draft.issueId).toBe("issue-1");
    expect(draft.authorType).toBe("agent");
    expect(draft.body).toContain("提交号 58be31d8f");
    expect(draft.failure).toEqual({
      kind: "blocked",
      reason: "存在未解决的强阻塞",
      httpStatus: 409,
    });
    expect(draft.replayStatus).toBe("pending");
    expect(draft.errorMessage).toBe(
      "操作失败：评论未写入。原因：存在未解决的强阻塞。建议：先解除阻塞或由主控将阻塞降级后重试。错误码：409",
    );
  });

  it("评论因外键失败时构造草稿，错误提示包含中文原因与可读建议", () => {
    const draft = buildCommentDraft({
      issueId: "issue-2",
      authorType: "agent",
      authorId: "agent-9",
      body: "证据：curl /api/claw-device/register 返回 200 OK。",
      requestedAt: "2026-06-06T10:05:00.000Z",
      failure: {
        kind: "foreign_key_missing",
        reason: "issue_id 不存在或已删除",
        httpStatus: 422,
      },
    });

    expect(draft.errorMessage).toContain("评论未写入");
    expect(draft.errorMessage).toContain("issue_id 不存在或已删除");
    expect(draft.errorMessage).toContain("错误码：422");
    expect(draft.replayStatus).toBe("pending");
  });

  it("鉴权失败时构造草稿，错误码 401，可重放性标记为 blocked", () => {
    const draft = buildCommentDraft({
      issueId: "issue-3",
      authorType: "agent",
      authorId: "agent-3",
      body: "心跳日志：3 次关键沉默，已发出降级。",
      requestedAt: "2026-06-06T10:10:00.000Z",
      failure: {
        kind: "unauthorized",
        reason: "agent 鉴权令牌失效",
        httpStatus: 401,
      },
    });

    expect(draft.replayStatus).toBe("blocked");
    expect(draft.replayBlockedReason).toBe("鉴权失败需刷新令牌后才能重放");
    expect(draft.errorMessage).toContain("错误码：401");
  });

  it("正文为空时拒绝构造草稿并返回字段级中文错误", () => {
    const result = validateDraftReplayRequest({
      issueId: "issue-1",
      body: "   ",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.body).toContain("正文不能为空");
  });

  it("重放请求缺少 issueId 时返回字段级中文错误", () => {
    const result = validateDraftReplayRequest({
      issueId: "",
      body: "hello",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.issueId).toContain("事项编号");
  });

  it("合并草稿：相同 issueId 的草稿按最新时间排序，去重重复 id", () => {
    const merged = mergeCommentDrafts([
      {
        id: "d-1",
        issueId: "issue-1",
        authorType: "agent",
        authorId: "a-1",
        body: "旧草稿",
        requestedAt: "2026-06-06T09:00:00.000Z",
        failure: { kind: "blocked", reason: "阻塞", httpStatus: 409 },
        errorMessage: "...",
        replayStatus: "pending",
        replayBlockedReason: null,
      },
      {
        id: "d-2",
        issueId: "issue-2",
        authorType: "user",
        authorId: "u-1",
        body: "另一事项的草稿",
        requestedAt: "2026-06-06T09:30:00.000Z",
        failure: { kind: "server_error", reason: "5xx", httpStatus: 500 },
        errorMessage: "...",
        replayStatus: "pending",
        replayBlockedReason: null,
      },
      {
        id: "d-1",
        issueId: "issue-1",
        authorType: "agent",
        authorId: "a-1",
        body: "新草稿（重复 id）",
        requestedAt: "2026-06-06T10:00:00.000Z",
        failure: { kind: "blocked", reason: "阻塞", httpStatus: 409 },
        errorMessage: "...",
        replayStatus: "pending",
        replayBlockedReason: null,
      },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0]?.issueId).toBe("issue-1");
    expect(merged[0]?.body).toBe("新草稿（重复 id）");
    expect(merged[1]?.issueId).toBe("issue-2");
  });

  it("汇总草稿队列：按 issue 分组计数并生成主控可读中文短报", () => {
    const summary = summarizeDraftQueue([
      {
        id: "d-1",
        issueId: "issue-1",
        authorType: "agent",
        authorId: "a-1",
        body: "草稿1",
        requestedAt: "2026-06-06T09:00:00.000Z",
        failure: { kind: "blocked", reason: "阻塞", httpStatus: 409 },
        errorMessage: "...",
        replayStatus: "pending",
        replayBlockedReason: null,
      },
      {
        id: "d-2",
        issueId: "issue-1",
        authorType: "agent",
        authorId: "a-2",
        body: "草稿2",
        requestedAt: "2026-06-06T09:10:00.000Z",
        failure: { kind: "foreign_key_missing", reason: "外键丢失", httpStatus: 422 },
        errorMessage: "...",
        replayStatus: "pending",
        replayBlockedReason: null,
      },
      {
        id: "d-3",
        issueId: "issue-2",
        authorType: "agent",
        authorId: "a-3",
        body: "草稿3",
        requestedAt: "2026-06-06T09:20:00.000Z",
        failure: { kind: "unauthorized", reason: "令牌失效", httpStatus: 401 },
        errorMessage: "...",
        replayStatus: "blocked",
        replayBlockedReason: "鉴权失败需刷新令牌后才能重放",
      },
    ]);

    expect(summary.total).toBe(3);
    expect(summary.byIssueId).toEqual({
      "issue-1": 2,
      "issue-2": 1,
    });
    expect(summary.byFailureKind).toEqual({
      blocked: 1,
      foreign_key_missing: 1,
      unauthorized: 1,
    });
    expect(summary.byReplayStatus).toEqual({
      pending: 2,
      blocked: 1,
    });
    expect(summary.headline).toContain("待补写评论 3 条");
    expect(summary.headline).toContain("2 个事项");
    expect(summary.headline).toContain("1 条需先解除鉴权");
  });

  it("toDraftReplayFailure 把 HTTP 错误归一为中文友好的失败描述", () => {
    const result = toDraftReplayFailure({
      httpStatus: 500,
      rawError: "Internal Server Error: db timeout",
    });

    expect(result.kind).toBe("server_error");
    expect(result.reason).toContain("服务器内部错误");
    expect(result.reason).toContain("db timeout");
    expect(result.httpStatus).toBe(500);
  });

  it("toDraftReplayFailure 识别 4xx 业务错误并归类", () => {
    const cases = [
      { status: 401, expectedKind: "unauthorized" },
      { status: 403, expectedKind: "forbidden" },
      { status: 404, expectedKind: "not_found" },
      { status: 409, expectedKind: "blocked" },
      { status: 422, expectedKind: "foreign_key_missing" },
      { status: 429, expectedKind: "rate_limited" },
    ];
    for (const c of cases) {
      const result = toDraftReplayFailure({ httpStatus: c.status, rawError: "x" });
      expect(result.kind).toBe(c.expectedKind);
      expect(result.httpStatus).toBe(c.status);
    }
  });
});
