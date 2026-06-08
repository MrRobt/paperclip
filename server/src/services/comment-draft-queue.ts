/**
 * 评论草稿队列（Comment Draft Queue）
 *
 * 目的：解决"评论因阻塞/外键/鉴权/限流失败而丢内容"的痛点。
 * 任何写评论失败的情况，都应把原始正文 + 失败原因 + 元数据
 * 构造成可重放的"草稿对象"，主控可一键列出"待补写评论"，
 * 解除阻塞或刷新令牌后重新提交。
 *
 * 该模块只做"草稿/重放/汇总"三件事：
 * 1. buildCommentDraft：失败 → 草稿对象（含中文错误提示）
 * 2. validateDraftReplayRequest：重放前校验（字段级中文错误）
 * 3. mergeCommentDrafts：合并多源草稿并去重排序
 * 4. summarizeDraftQueue：按事项/失败原因/重放状态汇总成主控可读短报
 * 5. toDraftReplayFailure：把 HTTP 错误归一为中文失败描述
 *
 * 设计原则（v1）：
 * - 纯函数，无 DB 依赖；存储由调用方决定（内存 / SQLite / Redis）。
 * - 所有提示必须中文，技术原文用"中文解释（原文）"格式。
 * - 错误提示必须包含：操作失败、原因、建议、错误码（与 paperclip 改进建议对齐）。
 */

export type CommentDraftAuthorType = "agent" | "user" | "system";

export type CommentDraftFailureKind =
  | "blocked"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "foreign_key_missing"
  | "rate_limited"
  | "server_error"
  | "network"
  | "unknown";

export type CommentDraftReplayStatus = "pending" | "ready" | "blocked" | "done";

export interface CommentDraftFailure {
  kind: CommentDraftFailureKind;
  reason: string;
  httpStatus: number | null;
}

export interface CommentDraft {
  id: string;
  issueId: string;
  authorType: CommentDraftAuthorType;
  authorId: string | null;
  body: string;
  requestedAt: string;
  failure: CommentDraftFailure;
  errorMessage: string;
  replayStatus: CommentDraftReplayStatus;
  replayBlockedReason: string | null;
}

export interface BuildCommentDraftInput {
  issueId: string;
  authorType: CommentDraftAuthorType;
  authorId: string | null;
  body: string;
  requestedAt: string;
  failure: CommentDraftFailure;
  presentation?: unknown;
  metadata?: unknown;
}

export interface DraftReplayRequest {
  issueId: string;
  body: string;
}

export type DraftReplayValidationResult =
  | { ok: true }
  | { ok: false; fieldErrors: { issueId?: string; body?: string } };

function shortId(): string {
  // 不依赖 crypto，避免拉新依赖；冲突概率在单租户单会话内可接受
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function describeFailureKind(kind: CommentDraftFailureKind): string {
  switch (kind) {
    case "blocked":
      return "存在未解决的强阻塞";
    case "unauthorized":
      return "agent 鉴权令牌失效";
    case "forbidden":
      return "当前操作者无权限评论该事项";
    case "not_found":
      return "事项不存在或已删除";
    case "foreign_key_missing":
      return "外键缺失（issue/agent/run 引用不存在）";
    case "rate_limited":
      return "评论接口被限流";
    case "server_error":
      return "服务器内部错误";
    case "network":
      return "网络中断或请求未送达";
    case "unknown":
    default:
      return "未知失败原因";
  }
}

function suggestActionForFailure(kind: CommentDraftFailureKind): string {
  switch (kind) {
    case "blocked":
      return "先解除阻塞或由主控将阻塞降级后重试";
    case "unauthorized":
      return "刷新 agent 鉴权令牌后再重放草稿";
    case "forbidden":
      return "切换为有权限的 agent 或联系主控调整权限";
    case "not_found":
      return "确认事项编号是否仍存在，必要时改写为新事项评论";
    case "foreign_key_missing":
      return "校验 issue/agent/run 引用是否仍有效，修正后重放";
    case "rate_limited":
      return "等待限流冷却（建议至少 60 秒）后再重放";
    case "server_error":
      return "查看服务器日志定位根因，修复后由主控批量重放";
    case "network":
      return "确认网络连通后由主控批量重放";
    case "unknown":
    default:
      return "查看错误上下文后由主控决定是否人工介入";
  }
}

function defaultReplayStatusForFailure(
  kind: CommentDraftFailureKind,
): CommentDraftReplayStatus {
  if (kind === "unauthorized" || kind === "forbidden") {
    return "blocked";
  }
  return "pending";
}

function defaultReplayBlockedReasonForFailure(
  kind: CommentDraftFailureKind,
  status: CommentDraftReplayStatus,
): string | null {
  if (status !== "blocked") return null;
  if (kind === "unauthorized") {
    return "鉴权失败需刷新令牌后才能重放";
  }
  if (kind === "forbidden") {
    return "无权限需切换操作者或调整权限后才能重放";
  }
  return "等待前置条件满足后才能重放";
}

export function buildErrorMessage(input: {
  failure: CommentDraftFailure;
}): string {
  const { failure } = input;
  const operation = "操作失败：评论未写入。";
  const baseCause = describeFailureKind(failure.kind);
  // 若调用方传入的 reason 与 kind 默认描述完全一致，避免重复
  const reasonTrimmed = (failure.reason ?? "").trim();
  const cause =
    reasonTrimmed.length > 0 && reasonTrimmed !== baseCause
      ? `原因：${baseCause}（${reasonTrimmed}）。`
      : `原因：${baseCause}。`;
  const action = `建议：${suggestActionForFailure(failure.kind)}。`;
  const code = failure.httpStatus != null ? `错误码：${failure.httpStatus}` : "错误码：未提供";
  return `${operation}${cause}${action}${code}`;
}

export function buildCommentDraft(input: BuildCommentDraftInput): CommentDraft {
  const replayStatus = defaultReplayStatusForFailure(input.failure.kind);
  const replayBlockedReason = defaultReplayBlockedReasonForFailure(
    input.failure.kind,
    replayStatus,
  );
  const errorMessage = buildErrorMessage({ failure: input.failure });
  return {
    id: shortId(),
    issueId: input.issueId,
    authorType: input.authorType,
    authorId: input.authorId,
    body: input.body,
    requestedAt: input.requestedAt,
    failure: input.failure,
    errorMessage,
    replayStatus,
    replayBlockedReason,
  };
}

export function validateDraftReplayRequest(
  req: DraftReplayRequest,
): DraftReplayValidationResult {
  const fieldErrors: { issueId?: string; body?: string } = {};
  if (!req.issueId || req.issueId.trim() === "") {
    fieldErrors.issueId = "事项编号（issueId）不能为空";
  }
  if (!req.body || req.body.trim() === "") {
    fieldErrors.body = "正文不能为空（评论草稿至少需要一段非空白文本）";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }
  return { ok: true };
}

export function mergeCommentDrafts(
  drafts: readonly CommentDraft[],
): CommentDraft[] {
  const byId = new Map<string, CommentDraft>();
  for (const draft of drafts) {
    byId.set(draft.id, draft);
  }
  return Array.from(byId.values()).sort((a, b) => {
    if (a.issueId !== b.issueId) {
      return a.issueId.localeCompare(b.issueId);
    }
    // 同 issue 时最新请求时间在前
    return b.requestedAt.localeCompare(a.requestedAt);
  });
}

export interface DraftQueueSummary {
  total: number;
  byIssueId: Record<string, number>;
  byFailureKind: Record<string, number>;
  byReplayStatus: Record<string, number>;
  affectedIssueCount: number;
  blockedReplayCount: number;
  headline: string;
}

export function summarizeDraftQueue(
  drafts: readonly CommentDraft[],
): DraftQueueSummary {
  const byIssueId: Record<string, number> = {};
  const byFailureKind: Record<string, number> = {};
  const byReplayStatus: Record<string, number> = {};
  let blockedReplayCount = 0;

  for (const draft of drafts) {
    byIssueId[draft.issueId] = (byIssueId[draft.issueId] ?? 0) + 1;
    byFailureKind[draft.failure.kind] = (byFailureKind[draft.failure.kind] ?? 0) + 1;
    byReplayStatus[draft.replayStatus] = (byReplayStatus[draft.replayStatus] ?? 0) + 1;
    if (draft.replayStatus === "blocked") blockedReplayCount += 1;
  }

  const affectedIssueCount = Object.keys(byIssueId).length;
  const total = drafts.length;

  let headline: string;
  if (total === 0) {
    headline = "当前无待补写评论。";
  } else {
    const issuePart = `覆盖 ${affectedIssueCount} 个事项`;
    const blockedPart =
      blockedReplayCount > 0 ? `，${blockedReplayCount} 条需先解除鉴权或权限` : "";
    headline = `待补写评论 ${total} 条（${issuePart}${blockedPart}）。`;
  }

  return {
    total,
    byIssueId,
    byFailureKind,
    byReplayStatus,
    affectedIssueCount,
    blockedReplayCount,
    headline,
  };
}

export function toDraftReplayFailure(input: {
  httpStatus: number | null;
  rawError: string;
}): CommentDraftFailure {
  const status = input.httpStatus;
  const raw = (input.rawError ?? "").trim();
  let kind: CommentDraftFailureKind = "unknown";
  if (status != null) {
    if (status === 401) kind = "unauthorized";
    else if (status === 403) kind = "forbidden";
    else if (status === 404) kind = "not_found";
    else if (status === 409) kind = "blocked";
    else if (status === 422) kind = "foreign_key_missing";
    else if (status === 429) kind = "rate_limited";
    else if (status >= 500 && status < 600) kind = "server_error";
  } else if (raw.length > 0) {
    // 无 HTTP 状态但有错误信息：尝试识别网络类
    const lower = raw.toLowerCase();
    if (lower.includes("econnrefused") || lower.includes("enotfound") || lower.includes("timeout")) {
      kind = "network";
    } else if (lower.includes("foreign key") || lower.includes("fk_")) {
      kind = "foreign_key_missing";
    }
  }
  const reason = raw
    ? kind === "server_error"
      ? `服务器内部错误：${raw}`
      : raw
    : describeFailureKind(kind);
  return { kind, reason, httpStatus: status };
}
