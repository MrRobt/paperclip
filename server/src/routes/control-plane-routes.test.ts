import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
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
import { errorHandler } from "../middleware/index.js";
import { controlPlaneRoutes } from "./control-plane.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";
const agentId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";

function createQuery(rows: unknown[]) {
  const query = {
    from(table: unknown) {
      return createQuery(Array.isArray(rows) ? rows : []);
    },
    where() {
      return this;
    },
    orderBy() {
      return this;
    },
    limit(limit: number) {
      return Promise.resolve(rows.slice(0, limit));
    },
    then(resolve: (value: unknown[]) => unknown, reject?: (reason?: unknown) => unknown) {
      return Promise.resolve(rows).then(resolve, reject);
    },
  };
  return query;
}

function createInsert(calls: Array<{ table: unknown; values: unknown }>) {
  return (table: unknown) => ({
    values(values: unknown) {
      calls.push({ table, values });
      return {
        returning: async () => Array.isArray(values) ? values : [{ id: "created", ...(values as object) }],
      };
    },
  });
}

function createFakeDb(overrides: Partial<Record<string, unknown[]>> = {}) {
  const inserted: Array<{ table: unknown; values: unknown }> = [];
  const baseIssue = {
    id: issueId,
    companyId,
    identifier: "PC-1",
    title: "Silent task",
    status: "in_progress",
    assigneeAgentId: agentId,
    checkoutRunId: null,
    executionRunId: runId,
    updatedAt: new Date("2026-06-08T00:00:00.000Z"),
  };
  const rowsByTable = new Map<unknown, unknown[]>([
    [issues, overrides.issues ?? [baseIssue]],
    [heartbeatRuns, overrides.heartbeatRuns ?? [{
      id: runId,
      agentId,
      status: "running",
      livenessState: null,
      livenessReason: null,
      scheduledRetryAt: null,
      lastOutputAt: new Date("2026-06-08T00:00:00.000Z"),
      finishedAt: null,
      nextAction: null,
    }]],
    [issueComments, overrides.issueComments ?? []],
    [issueWorkProducts, overrides.issueWorkProducts ?? []],
    [issueRecoveryActions, overrides.issueRecoveryActions ?? []],
    [issueBlockerPolicies, overrides.issueBlockerPolicies ?? []],
    [modelHealthEvents, overrides.modelHealthEvents ?? []],
    [agents, overrides.agents ?? [{ id: agentId, companyId, name: "Worker", status: "idle" }]],
    [controlPlaneDiagnosticSnapshots, overrides.controlPlaneDiagnosticSnapshots ?? []],
  ]);
  const db = {
    inserted,
    select: vi.fn(() => ({
      from(table: unknown) {
        return createQuery(rowsByTable.get(table) ?? []);
      },
    })),
    insert: vi.fn(createInsert(inserted)),
  };
  return db;
}

function createApp(db: any, enqueueWakeup = vi.fn(async (id: string) => ({ id: `run-${id}`, agentId: id }))) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = { type: "board", source: "local_implicit", userId: "user-1" };
    next();
  });
  app.use("/api", controlPlaneRoutes(db, { enqueueWakeup }));
  app.use(errorHandler);
  return { app, enqueueWakeup };
}

describe("controlPlaneRoutes", () => {
  it("returns one issue diagnosis by issue id", async () => {
    const db = createFakeDb();
    const { app } = createApp(db);

    const response = await request(app).get(`/api/issues/${issueId}/control-plane/diagnosis`).expect(200);

    expect(response.body.diagnosis).toMatchObject({
      issueId,
      identifier: "PC-1",
      assigneeAgentId: agentId,
    });
    expect(response.body.summary.counts.total).toBe(1);
  });

  it("refreshes diagnostics and stores snapshots", async () => {
    const db = createFakeDb();
    const { app } = createApp(db);

    const response = await request(app)
      .post(`/api/companies/${companyId}/control-plane/diagnostics/refresh`)
      .send({ issueIds: [issueId] })
      .expect(202);

    expect(response.body.refreshedCount).toBe(1);
    const snapshotInsert = db.inserted.find((entry) => entry.table === controlPlaneDiagnosticSnapshots);
    expect(snapshotInsert?.values).toEqual(expect.arrayContaining([
      expect.objectContaining({ companyId, issueId, source: "control_plane_refresh" }),
    ]));
  });

  it("recovers one issue by creating a recovery action and waking its owner", async () => {
    const db = createFakeDb();
    const enqueueWakeup = vi.fn(async (id: string) => ({ id: "wake-run-1", agentId: id }));
    const { app } = createApp(db, enqueueWakeup);

    const response = await request(app)
      .post(`/api/issues/${issueId}/control-plane/recover`)
      .send({ reason: "manual recovery" })
      .expect(202);

    expect(response.body.result).toMatchObject({ issueId, agentId, status: "queued", runId: "wake-run-1" });
    expect(enqueueWakeup).toHaveBeenCalledWith(agentId, expect.objectContaining({ reason: "manual recovery" }));
    expect(db.inserted.some((entry) => entry.table === issueRecoveryActions)).toBe(true);
  });

  it("supports batch recovery and company bulk wakeup", async () => {
    const db = createFakeDb();
    const enqueueWakeup = vi.fn(async (id: string) => ({ id: `wake-${id}`, agentId: id }));
    const { app } = createApp(db, enqueueWakeup);

    const batch = await request(app)
      .post(`/api/companies/${companyId}/control-plane/recover-batch`)
      .send({ issueIds: [issueId] })
      .expect(202);
    expect(batch.body.results).toHaveLength(1);
    expect(batch.body.results[0]).toMatchObject({ issueId, status: "queued" });

    const bulk = await request(app)
      .post(`/api/companies/${companyId}/control-plane/bulk-wakeup`)
      .send({ agentIds: [agentId] })
      .expect(202);
    expect(bulk.body.results).toEqual([expect.objectContaining({ agentId, status: "queued" })]);
  });
});
