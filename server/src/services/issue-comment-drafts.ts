import type { CommentDraftFailureKind } from "./comment-draft-queue.js";
import {
  buildCommentDraft,
  type CommentDraftAuthorType,
  type CommentDraftReplayStatus,
} from "./comment-draft-queue.js";
import { issueCommentDrafts } from "@paperclipai/db";
import type { Db } from "@paperclipai/db";

export interface PersistableCommentDraftInput {
  companyId: string;
  issueId: string;
  authorType: CommentDraftAuthorType;
  authorAgentId?: string | null;
  authorUserId?: string | null;
  createdByRunId?: string | null;
  body: string;
  presentation?: unknown;
  metadata?: unknown;
  failureKind: CommentDraftFailureKind;
  failureReason: string;
  httpStatus?: number | null;
  rawErrorMessage?: string | null;
  requestedAt: string;
}

export interface PersistableCommentDraft {
  companyId: string;
  issueId: string;
  authorAgentId: string | null;
  authorUserId: string | null;
  authorType: CommentDraftAuthorType;
  createdByRunId: string | null;
  body: string;
  presentation: unknown | null;
  metadata: unknown | null;
  failureKind: string;
  failureReason: string;
  httpStatus: number | null;
  errorMessage: string;
  replayStatus: CommentDraftReplayStatus;
}

export interface CommentDraftReplayAttemptResult {
  replayStatus: "done" | "failed" | "blocked";
  replayAttemptCount: number;
  lastReplayAt: Date;
  replayedCommentId: string | null;
  errorMessage: string | null;
}

export function toPersistableCommentDraft(input: PersistableCommentDraftInput): PersistableCommentDraft {
  const authorId = input.authorType === "agent" ? input.authorAgentId ?? null : input.authorUserId ?? null;
  const draft = buildCommentDraft({
    issueId: input.issueId,
    authorType: input.authorType,
    authorId,
    body: input.body,
    requestedAt: input.requestedAt,
    presentation: input.presentation,
    metadata: input.metadata,
    failure: {
      kind: input.failureKind,
      reason: input.failureReason,
      httpStatus: input.httpStatus ?? null,
    },
  });

  return {
    companyId: input.companyId,
    issueId: input.issueId,
    authorAgentId: input.authorAgentId ?? null,
    authorUserId: input.authorUserId ?? null,
    authorType: input.authorType,
    createdByRunId: input.createdByRunId ?? null,
    body: input.body,
    presentation: input.presentation ?? null,
    metadata: input.metadata ?? null,
    failureKind: input.failureKind,
    failureReason: input.failureReason,
    httpStatus: input.httpStatus ?? null,
    errorMessage: input.rawErrorMessage?.trim() ? `${draft.errorMessage} 原始错误：${input.rawErrorMessage.trim()}` : draft.errorMessage,
    replayStatus: draft.replayStatus,
  };
}

export function buildReplayAttemptResult(input: {
  ok: boolean;
  attemptCountBefore: number;
  replayedCommentId?: string | null;
  failureReason?: string | null;
  now: Date;
  blocked?: boolean;
}): CommentDraftReplayAttemptResult {
  if (input.blocked) {
    return {
      replayStatus: "blocked",
      replayAttemptCount: input.attemptCountBefore,
      lastReplayAt: input.now,
      replayedCommentId: null,
      errorMessage: input.failureReason ?? "草稿仍被前置条件阻塞，未执行重放。",
    };
  }

  if (input.ok) {
    return {
      replayStatus: "done",
      replayAttemptCount: input.attemptCountBefore + 1,
      lastReplayAt: input.now,
      replayedCommentId: input.replayedCommentId ?? null,
      errorMessage: null,
    };
  }

  return {
    replayStatus: "failed",
    replayAttemptCount: input.attemptCountBefore + 1,
    lastReplayAt: input.now,
    replayedCommentId: null,
    errorMessage: input.failureReason ?? "草稿重放失败，原因未知。",
  };
}

export function shouldAutoReplayDraft(input: {
  replayStatus: string;
  replayAttemptCount: number;
  maxAttempts: number;
  failureKind?: string | null;
}): boolean {
  if (!["pending", "ready", "failed"].includes(input.replayStatus)) return false;
  if (input.replayAttemptCount >= input.maxAttempts) return false;
  if (input.failureKind === "unauthorized" || input.failureKind === "forbidden") return false;
  return true;
}

/**
 * 将评论失败写入 issue_comment_drafts 表。
 * 心跳评论失败、恢复服务写评论失败等均可调用。
 */
type DbFailureKind = "route_error" | "authorization_error" | "validation_error" | "database_error" | "comment_gate_blocked" | "unknown";
type DbReplayStatus = "pending" | "ready" | "blocked" | "done" | "failed";

export async function saveCommentDraft(
  db: Db,
  input: PersistableCommentDraftInput,
): Promise<void> {
  const draft = toPersistableCommentDraft(input);
  const row = {
    companyId: draft.companyId,
    issueId: draft.issueId,
    authorAgentId: draft.authorAgentId,
    authorUserId: draft.authorUserId ?? null,
    authorType: draft.authorType as "agent" | "user" | "system",
    createdByRunId: draft.createdByRunId ?? null,
    body: draft.body,
    presentation: draft.presentation ?? null,
    metadata: draft.metadata ?? null,
    failureKind: draft.failureKind as DbFailureKind,
    failureReason: draft.failureReason ?? null,
    httpStatus: draft.httpStatus ?? null,
    errorMessage: draft.errorMessage ?? null,
    replayStatus: draft.replayStatus as DbReplayStatus,
  };
  await db.insert(issueCommentDrafts).values(row as typeof issueCommentDrafts.$inferInsert);
}
