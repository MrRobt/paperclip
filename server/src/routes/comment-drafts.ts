import { Router, type Request } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import {
  issueCommentDrafts,
  issueComments,
  issues,
} from "@paperclipai/db";
import { buildReplayAttemptResult, shouldAutoReplayDraft } from "../services/issue-comment-drafts.js";
import { logActivity } from "../services/activity-log.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { conflict, notFound } from "../errors.js";

const listCompanyDraftsQuerySchema = z.object({
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const replayDraftBodySchema = z.object({
  force: z.boolean().optional().default(false),
});

const replayBatchBodySchema = z.object({
  draftIds: z.array(z.string().uuid()).optional(),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  limit: z.number().int().min(1).max(100).default(25),
});

type DraftRow = typeof issueCommentDrafts.$inferSelect;

export function commentDraftRoutes(db: Db) {
  const router = Router();

  router.get("/companies/:companyId/comment-drafts", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const query = listCompanyDraftsQuerySchema.parse(req.query);
    const conditions = [eq(issueCommentDrafts.companyId, companyId)];
    if (query.status) conditions.push(eq(issueCommentDrafts.replayStatus, query.status as DraftRow["replayStatus"]));

    const rows = await db
      .select()
      .from(issueCommentDrafts)
      .where(and(...conditions))
      .orderBy(desc(issueCommentDrafts.createdAt))
      .limit(query.limit);

    res.json({ drafts: rows });
  });

  router.get("/issues/:id/comment-drafts", async (req, res) => {
    const issueId = req.params.id as string;
    const issue = await findIssue(db, issueId);
    if (!issue) throw notFound("Issue not found");
    assertCompanyAccess(req, issue.companyId);

    const rows = await db
      .select()
      .from(issueCommentDrafts)
      .where(and(eq(issueCommentDrafts.companyId, issue.companyId), eq(issueCommentDrafts.issueId, issueId)))
      .orderBy(desc(issueCommentDrafts.createdAt));

    res.json({ drafts: rows });
  });

  router.post("/comment-drafts/:id/replay", async (req, res) => {
    const draftId = req.params.id as string;
    const body = replayDraftBodySchema.parse(req.body ?? {});
    const actor = getActorInfo(req);
    const result = await replayOneDraft(db, {
      draftId,
      force: body.force,
      actor,
      request: req,
      maxAttempts: 3,
    });
    res.status(result.replayedCommentId ? 201 : 409).json(result);
  });

  router.post("/companies/:companyId/comment-drafts/replay-batch", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const body = replayBatchBodySchema.parse(req.body ?? {});
    const actor = getActorInfo(req);

    const candidates = body.draftIds?.length
      ? await db
          .select({ id: issueCommentDrafts.id })
          .from(issueCommentDrafts)
          .where(and(eq(issueCommentDrafts.companyId, companyId), inArray(issueCommentDrafts.id, body.draftIds)))
      : await db
          .select({ id: issueCommentDrafts.id })
          .from(issueCommentDrafts)
          .where(and(eq(issueCommentDrafts.companyId, companyId), inArray(issueCommentDrafts.replayStatus, ["pending", "ready", "failed"])))
          .orderBy(desc(issueCommentDrafts.createdAt))
          .limit(body.limit);

    const results = [];
    for (const candidate of candidates) {
      results.push(await replayOneDraft(db, {
        draftId: candidate.id,
        force: false,
        actor,
        request: req,
        maxAttempts: body.maxAttempts,
      }));
    }

    res.json({ results });
  });

  return router;
}

async function findIssue(db: Db, issueId: string) {
  const [issue] = await db
    .select({ id: issues.id, companyId: issues.companyId })
    .from(issues)
    .where(eq(issues.id, issueId))
    .limit(1);
  return issue ?? null;
}

async function replayOneDraft(db: Db, input: {
  draftId: string;
  force: boolean;
  maxAttempts: number;
  actor: ReturnType<typeof getActorInfo>;
  request: Request;
}) {
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [draft] = await tx.select().from(issueCommentDrafts).where(eq(issueCommentDrafts.id, input.draftId)).limit(1);
    if (!draft) throw notFound("Comment draft not found");
    assertCompanyAccess(input.request, draft.companyId);

    if (!input.force && !shouldAutoReplayDraft({
      replayStatus: draft.replayStatus,
      replayAttemptCount: draft.replayAttemptCount,
      maxAttempts: input.maxAttempts,
      failureKind: draft.failureKind,
    })) {
      const blocked = buildReplayAttemptResult({
        ok: false,
        blocked: true,
        attemptCountBefore: draft.replayAttemptCount,
        failureReason: "草稿不满足自动重放条件，可人工 force 重放。",
        now,
      });
      await tx.update(issueCommentDrafts).set({
        replayStatus: blocked.replayStatus,
        lastReplayAt: blocked.lastReplayAt,
        errorMessage: blocked.errorMessage,
        updatedAt: now,
      }).where(eq(issueCommentDrafts.id, draft.id));
      return {
        companyId: draft.companyId,
        response: { draftId: draft.id, ...blocked },
        activities: [{
          action: "comment_draft.replay_blocked",
          entityType: "issue_comment_draft",
          entityId: draft.id,
          details: blocked,
        }],
      };
    }

    const [comment] = await tx.insert(issueComments).values({
      companyId: draft.companyId,
      issueId: draft.issueId,
      authorAgentId: draft.authorAgentId,
      authorUserId: draft.authorUserId,
      authorType: draft.authorType,
      createdByRunId: draft.createdByRunId,
      body: draft.body,
      presentation: draft.presentation,
      metadata: draft.metadata,
    }).returning({ id: issueComments.id });

    const replay = buildReplayAttemptResult({
      ok: Boolean(comment?.id),
      attemptCountBefore: draft.replayAttemptCount,
      replayedCommentId: comment?.id ?? null,
      now,
    });

    await tx.update(issueCommentDrafts).set({
      replayStatus: replay.replayStatus,
      replayAttemptCount: replay.replayAttemptCount,
      lastReplayAt: replay.lastReplayAt,
      replayedCommentId: replay.replayedCommentId,
      errorMessage: replay.errorMessage,
      updatedAt: now,
    }).where(eq(issueCommentDrafts.id, draft.id));

    return {
      companyId: draft.companyId,
      response: { draftId: draft.id, ...replay },
      activities: [
        {
          action: "issue.comment.created",
          entityType: "issue",
          entityId: draft.issueId,
          details: {
            commentId: comment?.id ?? null,
            replayedFromDraftId: draft.id,
          },
        },
        {
          action: "comment_draft.replayed",
          entityType: "issue_comment_draft",
          entityId: draft.id,
          details: replay,
        },
      ],
    };
  });

  for (const activity of result.activities) {
    await logActivity(db, {
      companyId: result.companyId,
      actorType: input.actor.actorType,
      actorId: input.actor.actorId,
      agentId: input.actor.agentId,
      runId: input.actor.runId,
      action: activity.action,
      entityType: activity.entityType,
      entityId: activity.entityId,
      details: { ...activity.details },
    });
  }
  return result.response;
}
