import type { CommentDraftFailureKind } from "./comment-draft-queue.js";
import {
  buildCommentDraft,
  type CommentDraftAuthorType,
  type CommentDraftReplayStatus,
} from "./comment-draft-queue.js";

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
