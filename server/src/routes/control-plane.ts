import { Router, type Request, type Response } from "express";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import {
  activityLog,
  agents,
  controlPlaneDiagnosticSnapshots,
  heartbeatRuns,
  issueBlockerPolicies,
  issueComments,
  issueRecoveryActions,
  issueWorkProducts,
  issues,
  modelHealthEvents,
} from "@paperclipai/db";
import { summarizeModelHealth } from "../services/model-health.js";
import {
  diagnoseControlPlaneIssue,
  summarizeControlPlaneDiagnostics,
  type ControlPlaneIssueDiagnosis,
} from "../services/control-plane-diagnostic.js";
import { heartbeatService } from "../services/heartbeat.js";
import { notFound } from "../errors.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

const diagnosticsQuerySchema = z.object({
  companyId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  includeDone: z.coerce.boolean().default(false),
});

const refreshDiagnosticsSchema = z.object({
  issueIds: z.array(z.string().uuid()).max(200).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  includeDone: z.boolean().optional(),
});

const recoverIssueSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  forceFreshSession: z.boolean().optional(),
});

const recoverBatchSchema = recoverIssueSchema.extend({
  issueIds: z.array(z.string().uuid()).min(1).max(100),
});

const bulkWakeupSchema = recoverIssueSchema.extend({
  agentIds: z.array(z.string().uuid()).max(100).optional(),
  issueIds: z.array(z.string().uuid()).max(100).optional(),
}).refine((value) => (value.agentIds?.length ?? 0) > 0 || (value.issueIds?.length ?? 0) > 0, {
  message: "agentIds or issueIds is required",
});

const OPEN_ISSUE_STATUSES = ["backlog", "todo", "in_progress", "in_review", "blocked"] as const;

type Wakeup = (
  agentId: string,
  opts?: Parameters<ReturnType<typeof heartbeatService>["wakeup"]>[1],
) => Promise<{ id: string; agentId?: string | null } | null>;

type ControlPlaneRoutesOptions = {
  enqueueWakeup?: Wakeup;
};

function parseQuery(req: Request) {
  return diagnosticsQuerySchema.parse({
    ...req.query,
    companyId: req.params.companyId ?? req.query.companyId,
  });
}

async function loadIssueDiagnostics(
  db: Db,
  input: { companyId: string; limit: number; includeDone?: boolean; issueIds?: string[] },
) {
  const issueConditions = [eq(issues.companyId, input.companyId), isNull(issues.hiddenAt)];
  if (!input.includeDone) {
    issueConditions.push(inArray(issues.status, [...OPEN_ISSUE_STATUSES]));
  }
  if (input.issueIds && input.issueIds.length > 0) {
    issueConditions.push(inArray(issues.id, [...new Set(input.issueIds)]));
  }

  const issueRows = await db
    .select({
      id: issues.id,
      companyId: issues.companyId,
      identifier: issues.identifier,
      title: issues.title,
      status: issues.status,
      assigneeAgentId: issues.assigneeAgentId,
      checkoutRunId: issues.checkoutRunId,
      executionRunId: issues.executionRunId,
      updatedAt: issues.updatedAt,
    })
    .from(issues)
    .where(and(...issueConditions))
    .orderBy(desc(issues.updatedAt))
    .limit(input.limit);

  const issueIds = issueRows.map((issue) => issue.id);
  const runIds = Array.from(
    new Set(issueRows.flatMap((issue) => [issue.executionRunId, issue.checkoutRunId]).filter((id): id is string => Boolean(id))),
  );

  const [runRows, commentRows, workProductRows, recoveryRows, blockerRows, modelEventRows] = await Promise.all([
    runIds.length > 0
      ? db
          .select({
            id: heartbeatRuns.id,
            status: heartbeatRuns.status,
            livenessState: heartbeatRuns.livenessState,
            livenessReason: heartbeatRuns.livenessReason,
            scheduledRetryAt: heartbeatRuns.scheduledRetryAt,
            lastOutputAt: heartbeatRuns.lastOutputAt,
            finishedAt: heartbeatRuns.finishedAt,
            nextAction: heartbeatRuns.nextAction,
          })
          .from(heartbeatRuns)
          .where(and(eq(heartbeatRuns.companyId, input.companyId), inArray(heartbeatRuns.id, runIds)))
      : Promise.resolve([]),
    issueIds.length > 0
      ? db
          .select({ id: issueComments.id, issueId: issueComments.issueId, body: issueComments.body, createdAt: issueComments.createdAt })
          .from(issueComments)
          .where(and(eq(issueComments.companyId, input.companyId), inArray(issueComments.issueId, issueIds)))
          .orderBy(desc(issueComments.createdAt))
      : Promise.resolve([]),
    issueIds.length > 0
      ? db
          .select({
            id: issueWorkProducts.id,
            issueId: issueWorkProducts.issueId,
            status: issueWorkProducts.status,
            reviewState: issueWorkProducts.reviewState,
            healthStatus: issueWorkProducts.healthStatus,
          })
          .from(issueWorkProducts)
          .where(and(eq(issueWorkProducts.companyId, input.companyId), inArray(issueWorkProducts.issueId, issueIds)))
      : Promise.resolve([]),
    issueIds.length > 0
      ? db
          .select({
            id: issueRecoveryActions.id,
            sourceIssueId: issueRecoveryActions.sourceIssueId,
            status: issueRecoveryActions.status,
            ownerType: issueRecoveryActions.ownerType,
            ownerAgentId: issueRecoveryActions.ownerAgentId,
            nextAction: issueRecoveryActions.nextAction,
            cause: issueRecoveryActions.cause,
          })
          .from(issueRecoveryActions)
          .where(and(eq(issueRecoveryActions.companyId, input.companyId), inArray(issueRecoveryActions.sourceIssueId, issueIds)))
      : Promise.resolve([]),
    issueIds.length > 0
      ? db
          .select({
            id: issueBlockerPolicies.id,
            issueId: issueBlockerPolicies.issueId,
            blockerIssueId: issueBlockerPolicies.blockerIssueId,
            level: issueBlockerPolicies.level,
            status: issueBlockerPolicies.status,
            reason: issueBlockerPolicies.reason,
          })
          .from(issueBlockerPolicies)
          .where(and(eq(issueBlockerPolicies.companyId, input.companyId), inArray(issueBlockerPolicies.issueId, issueIds)))
      : Promise.resolve([]),
    db
      .select({
        adapterType: modelHealthEvents.adapterType,
        modelId: modelHealthEvents.modelId,
        eventType: modelHealthEvents.eventType,
        errorKind: modelHealthEvents.errorKind,
        latencyMs: modelHealthEvents.latencyMs,
        fallbackApplied: modelHealthEvents.fallbackApplied,
        createdAt: modelHealthEvents.createdAt,
      })
      .from(modelHealthEvents)
      .where(eq(modelHealthEvents.companyId, input.companyId))
      .orderBy(desc(modelHealthEvents.createdAt))
      .limit(200),
  ]);

  const runsById = new Map(runRows.map((run) => [run.id, run]));
  const commentsByIssue = groupBy(commentRows, (row) => row.issueId);
  const workProductsByIssue = groupBy(workProductRows, (row) => row.issueId);
  const recoveryByIssue = groupBy(recoveryRows, (row) => row.sourceIssueId);
  const blockersByIssue = groupBy(blockerRows, (row) => row.issueId);
  const modelHealthSummaries = summarizeModelHealthGroups(modelEventRows);

  const diagnostics = issueRows.map((issue) => diagnoseControlPlaneIssue({
    issue,
    run: issue.executionRunId ? runsById.get(issue.executionRunId) ?? null : null,
    comments: commentsByIssue.get(issue.id) ?? [],
    workProducts: workProductsByIssue.get(issue.id) ?? [],
    recoveryActions: recoveryByIssue.get(issue.id) ?? [],
    blockerPolicies: blockersByIssue.get(issue.id) ?? [],
    modelHealth: null,
  }));

  return {
    summary: summarizeControlPlaneDiagnostics(diagnostics),
    diagnostics,
    modelHealthSummaries,
  };
}

async function handleControlPlaneDiagnostics(req: Request, res: Response, db: Db) {
  const query = parseQuery(req);
  assertCompanyAccess(req, query.companyId);
  res.json(await loadIssueDiagnostics(db, {
    companyId: query.companyId,
    limit: query.limit,
    includeDone: query.includeDone,
  }));
}

async function logControlPlaneActivity(db: Db, req: Request, input: {
  companyId: string;
  action: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
}) {
  const actor = getActorInfo(req);
  await db.insert(activityLog).values({
    companyId: input.companyId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    agentId: actor.agentId,
    runId: actor.runId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    details: input.details ?? {},
  });
}

function toSnapshotValues(companyId: string, diagnosis: ControlPlaneIssueDiagnosis, source: string) {
  return {
    companyId,
    issueId: diagnosis.issueId,
    liveness: diagnosis.liveness,
    severity: diagnosis.severity,
    issueStatus: diagnosis.issueStatus,
    executionStatus: diagnosis.executionStatus,
    evidenceStatus: diagnosis.evidenceStatus,
    recoveryStatus: diagnosis.recoveryStatus,
    blockerStatus: diagnosis.blockerStatus,
    nextAction: diagnosis.nextAction,
    nextOwnerType: diagnosis.nextOwnerType,
    nextOwnerId: diagnosis.nextOwnerId,
    nextOwnerAgentId: diagnosis.assigneeAgentId,
    reasons: diagnosis.reasons,
    evidence: diagnosis.evidence,
    source,
  };
}

function recoveryKindForDiagnosis(diagnosis: ControlPlaneIssueDiagnosis) {
  if (diagnosis.liveness === "stalled") return "stale_run";
  if (diagnosis.liveness === "blocked") return "blocked_dependency";
  return "manual";
}

async function recoverDiagnosis(db: Db, req: Request, enqueueWakeup: Wakeup, diagnosis: ControlPlaneIssueDiagnosis, input: {
  reason?: string;
  idempotencyKey?: string;
  forceFreshSession?: boolean;
}) {
  if (!diagnosis.assigneeAgentId) {
    return { issueId: diagnosis.issueId, agentId: null, status: "skipped" as const, runId: null, reason: "事项未分配智能体" };
  }

  const now = new Date();
  const reason = input.reason ?? diagnosis.nextAction;
  const fingerprint = `${diagnosis.issueId}:${diagnosis.liveness}:${diagnosis.executionStatus}:${diagnosis.recoveryStatus}`;
  const [action] = await db.insert(issueRecoveryActions).values({
    companyId: diagnosis.evidence.companyId as string | undefined ?? "",
    sourceIssueId: diagnosis.issueId,
    kind: recoveryKindForDiagnosis(diagnosis),
    status: "active",
    ownerType: "agent",
    ownerAgentId: diagnosis.assigneeAgentId,
    cause: reason,
    fingerprint,
    evidence: { diagnosis, createdBy: "control_plane" },
    nextAction: reason,
    wakePolicy: { source: "control_plane_recover" },
    monitorPolicy: { checkAfterSeconds: 300 },
    attemptCount: 1,
    maxAttempts: 3,
    lastAttemptAt: now,
    updatedAt: now,
  }).returning();

  const run = await enqueueWakeup(diagnosis.assigneeAgentId, {
    source: "on_demand",
    triggerDetail: "manual",
    reason,
    payload: { issueId: diagnosis.issueId, recoveryActionId: action?.id ?? null },
    idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:${diagnosis.issueId}` : null,
    requestedByActorType: req.actor.type === "agent" ? "agent" : "user",
    requestedByActorId: req.actor.type === "agent" ? req.actor.agentId ?? null : req.actor.userId ?? null,
    contextSnapshot: { forceFreshSession: input.forceFreshSession === true, diagnosis },
  });

  await logControlPlaneActivity(db, req, {
    companyId: diagnosis.evidence.companyId as string | undefined ?? "",
    action: "control_plane.recover_requested",
    entityType: "issue",
    entityId: diagnosis.issueId,
    details: { recoveryActionId: action?.id ?? null, wakeupRunId: run?.id ?? null, reason },
  });

  return {
    issueId: diagnosis.issueId,
    agentId: diagnosis.assigneeAgentId,
    status: run ? "queued" as const : "skipped" as const,
    runId: run?.id ?? null,
    recoveryActionId: action?.id ?? null,
  };
}

export function controlPlaneRoutes(db: Db, options: ControlPlaneRoutesOptions = {}) {
  const router = Router();
  const enqueueWakeup = options.enqueueWakeup ?? heartbeatService(db).wakeup;

  router.get("/control-plane/diagnostics", (req, res) => handleControlPlaneDiagnostics(req, res, db));
  router.get("/companies/:companyId/control-plane/diagnostics", (req, res) => handleControlPlaneDiagnostics(req, res, db));

  router.get("/issues/:id/control-plane/diagnosis", async (req, res) => {
    const [issue] = await db
      .select({ id: issues.id, companyId: issues.companyId })
      .from(issues)
      .where(eq(issues.id, req.params.id as string))
      .limit(1);
    if (!issue) throw notFound("Issue not found");
    assertCompanyAccess(req, issue.companyId);
    const result = await loadIssueDiagnostics(db, {
      companyId: issue.companyId,
      issueIds: [issue.id],
      includeDone: true,
      limit: 1,
    });
    const diagnosis = result.diagnostics[0];
    if (!diagnosis) throw notFound("Issue diagnosis not found");
    res.json({ diagnosis, summary: result.summary, modelHealthSummaries: result.modelHealthSummaries });
  });

  router.post("/companies/:companyId/control-plane/diagnostics/refresh", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const body = refreshDiagnosticsSchema.parse(req.body ?? {});
    const result = await loadIssueDiagnostics(db, {
      companyId,
      issueIds: body.issueIds,
      limit: body.limit ?? body.issueIds?.length ?? 100,
      includeDone: body.includeDone ?? false,
    });
    if (result.diagnostics.length > 0) {
      await db.insert(controlPlaneDiagnosticSnapshots).values(
        result.diagnostics.map((diagnosis) => toSnapshotValues(companyId, diagnosis, "control_plane_refresh")),
      );
    }
    await logControlPlaneActivity(db, req, {
      companyId,
      action: "control_plane.diagnostics_refreshed",
      entityType: "company",
      entityId: companyId,
      details: { refreshedCount: result.diagnostics.length },
    });
    res.status(202).json({ ...result, refreshedCount: result.diagnostics.length });
  });

  router.post("/issues/:id/control-plane/recover", async (req, res) => {
    const body = recoverIssueSchema.parse(req.body ?? {});
    const [issue] = await db
      .select({ id: issues.id, companyId: issues.companyId })
      .from(issues)
      .where(eq(issues.id, req.params.id as string))
      .limit(1);
    if (!issue) throw notFound("Issue not found");
    assertCompanyAccess(req, issue.companyId);
    const result = await loadIssueDiagnostics(db, { companyId: issue.companyId, issueIds: [issue.id], includeDone: true, limit: 1 });
    const diagnosis = result.diagnostics[0];
    if (!diagnosis) throw notFound("Issue diagnosis not found");
    const resultWithCompany = { ...diagnosis, evidence: { ...diagnosis.evidence, companyId: issue.companyId } };
    res.status(202).json({ result: await recoverDiagnosis(db, req, enqueueWakeup, resultWithCompany, body) });
  });

  router.post("/companies/:companyId/control-plane/recover-batch", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const body = recoverBatchSchema.parse(req.body ?? {});
    const diagnostics = await loadIssueDiagnostics(db, { companyId, issueIds: body.issueIds, includeDone: true, limit: body.issueIds.length });
    const results = [];
    for (const diagnosis of diagnostics.diagnostics) {
      results.push(await recoverDiagnosis(db, req, enqueueWakeup, { ...diagnosis, evidence: { ...diagnosis.evidence, companyId } }, body));
    }
    res.status(202).json({ results });
  });

  router.post("/companies/:companyId/control-plane/bulk-wakeup", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const body = bulkWakeupSchema.parse(req.body ?? {});
    const agentIds = new Set(body.agentIds ?? []);
    if (body.issueIds?.length) {
      const diagnostics = await loadIssueDiagnostics(db, { companyId, issueIds: body.issueIds, includeDone: true, limit: body.issueIds.length });
      for (const diagnosis of diagnostics.diagnostics) {
        if (diagnosis.assigneeAgentId) agentIds.add(diagnosis.assigneeAgentId);
      }
    }

    const results = [];
    for (const agentId of agentIds) {
      const [agent] = await db
        .select({ id: agents.id, companyId: agents.companyId })
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1);
      if (!agent || agent.companyId !== companyId) {
        results.push({ agentId, status: "failed" as const, runId: null, error: "Agent not found in company" });
        continue;
      }
      try {
        const run = await enqueueWakeup(agentId, {
          source: "on_demand",
          triggerDetail: "manual",
          reason: body.reason ?? "delivery_control_plane_bulk_wakeup",
          payload: { issueIds: body.issueIds ?? [] },
          idempotencyKey: body.idempotencyKey ? `${body.idempotencyKey}:${agentId}` : null,
          requestedByActorType: req.actor.type === "agent" ? "agent" : "user",
          requestedByActorId: req.actor.type === "agent" ? req.actor.agentId ?? null : req.actor.userId ?? null,
          contextSnapshot: { forceFreshSession: body.forceFreshSession === true, controlPlaneBulkWakeup: true },
        });
        results.push({ agentId, status: run ? "queued" as const : "skipped" as const, runId: run?.id ?? null });
      } catch (error) {
        results.push({ agentId, status: "failed" as const, runId: null, error: error instanceof Error ? error.message : "Wakeup failed" });
      }
    }
    await logControlPlaneActivity(db, req, {
      companyId,
      action: "control_plane.bulk_wakeup_requested",
      entityType: "company",
      entityId: companyId,
      details: { requestedAgentCount: agentIds.size, queuedCount: results.filter((result) => result.status === "queued").length },
    });
    res.status(202).json({ results });
  });

  return router;
}

function groupBy<T>(items: readonly T[], keyFn: (item: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = map.get(key) ?? [];
    bucket.push(item);
    map.set(key, bucket);
  }
  return map;
}

function summarizeModelHealthGroups(
  events: readonly {
    adapterType: string;
    modelId: string | null;
    eventType: string;
    errorKind: string | null;
    latencyMs: number | null;
    fallbackApplied: boolean | null;
    createdAt: Date;
  }[],
) {
  const keys = Array.from(new Set(events.map((event) => `${event.adapterType}\u0000${event.modelId ?? ""}`)));
  return keys.map((key) => {
    const [adapterType = "", modelIdPart = ""] = key.split("\u0000");
    const modelId = modelIdPart || null;
    return summarizeModelHealth({ adapterType, modelId, events });
  });
}
