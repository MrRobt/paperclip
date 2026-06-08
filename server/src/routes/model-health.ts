import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { agents, modelHealthEvents } from "@paperclipai/db";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { notFound } from "../errors.js";
import { summarizeModelHealth } from "../services/model-health.js";
import { chooseModelFallbackPolicy } from "../services/model-fallback-policy.js";
import { logActivity } from "../services/activity-log.js";

const modelHealthQuerySchema = z.object({
  adapterType: z.string().optional(),
  modelId: z.string().nullable().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const fallbackOptionSchema = z.object({
  adapterType: z.string().min(1),
  modelId: z.string().nullable().optional(),
  priority: z.number().int().min(0),
  budgetAllowed: z.boolean().default(true),
  requiresApproval: z.boolean().optional(),
});

const probeBodySchema = z.object({
  adapterType: z.string().min(1),
  modelId: z.string().nullable().optional(),
  eventType: z.enum(["probe_result", "adapter_error", "model_error", "timeout", "rate_limited", "budget_stopped", "fallback_selected"]).default("probe_result"),
  errorKind: z.string().nullable().optional(),
  latencyMs: z.number().int().min(0).nullable().optional(),
  retryAttempt: z.number().int().min(0).default(0),
  fallbackApplied: z.boolean().default(false),
  fallbackAdapterType: z.string().nullable().optional(),
  fallbackModelId: z.string().nullable().optional(),
  errorSummary: z.string().nullable().optional(),
  rawErrorExcerpt: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  fallbackOptions: z.array(fallbackOptionSchema).optional().default([]),
  budgetHardStopped: z.boolean().default(false),
  approvalRequiredForFallback: z.boolean().default(false),
});

export function modelHealthRoutes(db: Db) {
  const router = Router();

  router.get("/companies/:companyId/model-health", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const query = modelHealthQuerySchema.parse(req.query);
    const events = await listEvents(db, { companyId, limit: query.limit });
    const scopes = uniqueScopes(events, query.adapterType, query.modelId ?? undefined);
    const summaries = scopes.map((scope) => summarizeModelHealth({ ...scope, events }));
    res.json({ summaries, events });
  });

  router.get("/agents/:id/model-health", async (req, res) => {
    const agent = await findAgent(db, req.params.id as string);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(req, agent.companyId);
    const query = modelHealthQuerySchema.parse(req.query);
    const events = await listEvents(db, { companyId: agent.companyId, agentId: agent.id, limit: query.limit });
    const scopes = uniqueScopes(events, query.adapterType, query.modelId ?? undefined);
    const summaries = scopes.map((scope) => summarizeModelHealth({ ...scope, events }));
    res.json({ agentId: agent.id, summaries, events });
  });

  router.post("/agents/:id/model-health/probe", async (req, res) => {
    const agent = await findAgent(db, req.params.id as string);
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(req, agent.companyId);
    const body = probeBodySchema.parse(req.body ?? {});
    const actor = getActorInfo(req);
    const [event] = await db.insert(modelHealthEvents).values({
      companyId: agent.companyId,
      agentId: agent.id,
      runId: actor.runId,
      adapterType: body.adapterType,
      modelId: body.modelId ?? null,
      eventType: body.eventType,
      errorKind: body.errorKind ?? null,
      latencyMs: body.latencyMs ?? null,
      retryAttempt: body.retryAttempt,
      fallbackApplied: body.fallbackApplied,
      fallbackAdapterType: body.fallbackAdapterType ?? null,
      fallbackModelId: body.fallbackModelId ?? null,
      errorSummary: body.errorSummary ?? null,
      rawErrorExcerpt: body.rawErrorExcerpt ?? null,
      metadata: body.metadata,
    }).returning();

    const events = await listEvents(db, { companyId: agent.companyId, agentId: agent.id, limit: 100 });
    const summary = summarizeModelHealth({ adapterType: body.adapterType, modelId: body.modelId ?? null, events });
    const fallback = chooseModelFallbackPolicy({
      health: summary,
      fallbackOptions: body.fallbackOptions.map((option) => ({ ...option, modelId: option.modelId ?? null })),
      budgetHardStopped: body.budgetHardStopped,
      approvalRequiredForFallback: body.approvalRequiredForFallback,
    });

    await logActivity(db, {
      companyId: agent.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? agent.id,
      runId: actor.runId,
      action: "model_health.probed",
      entityType: "agent",
      entityId: agent.id,
      details: { eventId: event.id, adapterType: body.adapterType, modelId: body.modelId ?? null, status: summary.status, fallbackAction: fallback.action },
    });

    res.status(201).json({ event, summary, fallback });
  });

  return router;
}

async function findAgent(db: Db, agentId: string) {
  const [agent] = await db.select({ id: agents.id, companyId: agents.companyId }).from(agents).where(eq(agents.id, agentId)).limit(1);
  return agent ?? null;
}

async function listEvents(db: Db, input: { companyId: string; agentId?: string; limit: number }) {
  const conditions = [eq(modelHealthEvents.companyId, input.companyId)];
  if (input.agentId) conditions.push(eq(modelHealthEvents.agentId, input.agentId));
  return db.select().from(modelHealthEvents).where(and(...conditions)).orderBy(desc(modelHealthEvents.createdAt)).limit(input.limit);
}

function uniqueScopes(
  events: Array<typeof modelHealthEvents.$inferSelect>,
  adapterType?: string,
  modelId?: string | null,
) {
  if (adapterType) return [{ adapterType, modelId: modelId ?? null }];
  const seen = new Set<string>();
  const scopes: Array<{ adapterType: string; modelId: string | null }> = [];
  for (const event of events) {
    const key = `${event.adapterType}\u0000${event.modelId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scopes.push({ adapterType: event.adapterType, modelId: event.modelId ?? null });
  }
  return scopes;
}
