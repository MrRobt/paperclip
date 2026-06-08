import { Router, type Request } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { issueBlockerPolicies, issues } from "@paperclipai/db";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { notFound } from "../errors.js";
import { decideBlockedOperation, type BlockedOperation } from "../services/issue-blocker-policies.js";
import { logActivity } from "../services/activity-log.js";

const policyLevelSchema = z.enum(["hard", "soft", "notice"]);
const policyStatusSchema = z.enum(["active", "resolved", "downgraded", "cancelled"]);
const blockedOperationSchema = z.enum(["execute", "comment", "attach_evidence", "diagnose", "recover"]);

const createPolicySchema = z.object({
  blockerIssueId: z.string().uuid().nullable().optional(),
  level: policyLevelSchema.default("hard"),
  reason: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

const updatePolicySchema = z.object({
  status: policyStatusSchema.optional(),
  level: policyLevelSchema.optional(),
  reason: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const downgradePolicySchema = z.object({
  targetLevel: z.enum(["soft", "notice"]),
  reason: z.string().min(1),
});

const listPoliciesQuerySchema = z.object({
  operation: blockedOperationSchema.optional().default("execute"),
});

export function blockerPolicyRoutes(db: Db) {
  const router = Router();

  router.get("/issues/:id/blocker-policies", async (req, res) => {
    const issue = await findIssue(db, req.params.id as string);
    if (!issue) throw notFound("Issue not found");
    assertCompanyAccess(req, issue.companyId);
    const query = listPoliciesQuerySchema.parse(req.query);
    const policies = await db
      .select()
      .from(issueBlockerPolicies)
      .where(and(eq(issueBlockerPolicies.companyId, issue.companyId), eq(issueBlockerPolicies.issueId, issue.id)))
      .orderBy(desc(issueBlockerPolicies.createdAt));
    res.json({
      policies,
      decision: decideBlockedOperation({ policies, operation: query.operation as BlockedOperation }),
    });
  });

  router.post("/issues/:id/blocker-policies", async (req, res) => {
    const issue = await findIssue(db, req.params.id as string);
    if (!issue) throw notFound("Issue not found");
    assertCompanyAccess(req, issue.companyId);
    const body = createPolicySchema.parse(req.body ?? {});
    const actor = getActorInfo(req);
    const now = new Date();
    const [policy] = await db.insert(issueBlockerPolicies).values({
      companyId: issue.companyId,
      issueId: issue.id,
      blockerIssueId: body.blockerIssueId ?? null,
      level: body.level,
      reason: body.reason,
      metadata: body.metadata,
      createdByActorType: actor.actorType,
      createdByActorId: actor.actorId,
      createdByAgentId: actor.agentId,
      updatedAt: now,
    }).returning();
    await logActivity(db, {
      companyId: issue.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue_blocker_policy.created",
      entityType: "issue_blocker_policy",
      entityId: policy.id,
      details: { issueId: issue.id, level: policy.level, status: policy.status, reason: policy.reason },
    });
    res.status(201).json({ policy });
  });

  router.patch("/blocker-policies/:id", async (req, res) => {
    const body = updatePolicySchema.parse(req.body ?? {});
    const actor = getActorInfo(req);
    const current = await findPolicy(db, req.params.id as string);
    if (!current) throw notFound("Blocker policy not found");
    assertCompanyAccess(req, current.companyId);
    const [policy] = await db.update(issueBlockerPolicies).set({
      ...(body.status ? { status: body.status } : {}),
      ...(body.level ? { level: body.level } : {}),
      ...(body.reason ? { reason: body.reason } : {}),
      ...(body.metadata ? { metadata: body.metadata } : {}),
      updatedAt: new Date(),
    }).where(eq(issueBlockerPolicies.id, current.id)).returning();
    await logActivity(db, {
      companyId: current.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue_blocker_policy.updated",
      entityType: "issue_blocker_policy",
      entityId: current.id,
      details: { before: summarizePolicy(current), after: summarizePolicy(policy) },
    });
    res.json({ policy });
  });

  router.post("/blocker-policies/:id/downgrade", async (req, res) => {
    const body = downgradePolicySchema.parse(req.body ?? {});
    const actor = getActorInfo(req);
    const current = await findPolicy(db, req.params.id as string);
    if (!current) throw notFound("Blocker policy not found");
    assertCompanyAccess(req, current.companyId);
    const [policy] = await db.update(issueBlockerPolicies).set({
      level: body.targetLevel,
      status: "active",
      downgradedAt: new Date(),
      downgradedByUserId: actor.actorType === "user" ? actor.actorId : null,
      downgradedByAgentId: actor.agentId,
      downgradeReason: body.reason,
      updatedAt: new Date(),
    }).where(eq(issueBlockerPolicies.id, current.id)).returning();
    await logActivity(db, {
      companyId: current.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue_blocker_policy.downgraded",
      entityType: "issue_blocker_policy",
      entityId: current.id,
      details: { fromLevel: current.level, toLevel: policy.level, reason: body.reason },
    });
    res.json({ policy });
  });

  return router;
}

async function findIssue(db: Db, issueId: string) {
  const [issue] = await db.select({ id: issues.id, companyId: issues.companyId }).from(issues).where(eq(issues.id, issueId)).limit(1);
  return issue ?? null;
}

async function findPolicy(db: Db, policyId: string) {
  const [policy] = await db.select().from(issueBlockerPolicies).where(eq(issueBlockerPolicies.id, policyId)).limit(1);
  return policy ?? null;
}

function summarizePolicy(policy: typeof issueBlockerPolicies.$inferSelect) {
  return { id: policy.id, issueId: policy.issueId, level: policy.level, status: policy.status, reason: policy.reason };
}
