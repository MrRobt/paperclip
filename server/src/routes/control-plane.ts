import { Router, type Request } from "express";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import {
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
} from "../services/control-plane-diagnostic.js";
import { assertCompanyAccess } from "./authz.js";

const diagnosticsQuerySchema = z.object({
  companyId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  includeDone: z.coerce.boolean().default(false),
});

const OPEN_ISSUE_STATUSES = ["backlog", "todo", "in_progress", "in_review", "blocked"] as const;

function parseQuery(req: Request) {
  return diagnosticsQuerySchema.parse({
    ...req.query,
    companyId: req.params.companyId ?? req.query.companyId,
  });
}

async function handleControlPlaneDiagnostics(req: Request, res: Parameters<Parameters<ReturnType<typeof Router>["get"]>[1]>[1], db: Db) {
  const query = parseQuery(req);
  assertCompanyAccess(req, query.companyId);

  const issueConditions = [eq(issues.companyId, query.companyId), isNull(issues.hiddenAt)];
  if (!query.includeDone) {
    issueConditions.push(inArray(issues.status, [...OPEN_ISSUE_STATUSES]));
  }

  const issueRows = await db
    .select({
      id: issues.id,
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
    .limit(query.limit);

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
          .where(and(eq(heartbeatRuns.companyId, query.companyId), inArray(heartbeatRuns.id, runIds)))
      : Promise.resolve([]),
    issueIds.length > 0
      ? db
          .select({ id: issueComments.id, issueId: issueComments.issueId, body: issueComments.body, createdAt: issueComments.createdAt })
          .from(issueComments)
          .where(and(eq(issueComments.companyId, query.companyId), inArray(issueComments.issueId, issueIds)))
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
          .where(and(eq(issueWorkProducts.companyId, query.companyId), inArray(issueWorkProducts.issueId, issueIds)))
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
          .where(and(eq(issueRecoveryActions.companyId, query.companyId), inArray(issueRecoveryActions.sourceIssueId, issueIds)))
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
          .where(and(eq(issueBlockerPolicies.companyId, query.companyId), inArray(issueBlockerPolicies.issueId, issueIds)))
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
      .where(eq(modelHealthEvents.companyId, query.companyId))
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

  res.json({
    summary: summarizeControlPlaneDiagnostics(diagnostics),
    diagnostics,
    modelHealthSummaries,
  });
}

export function controlPlaneRoutes(db: Db) {
  const router = Router();

  router.get("/control-plane/diagnostics", (req, res) => handleControlPlaneDiagnostics(req, res, db));
  router.get("/companies/:companyId/control-plane/diagnostics", (req, res) => handleControlPlaneDiagnostics(req, res, db));

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
