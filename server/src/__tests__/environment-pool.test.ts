import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb, environmentLeases, environments } from "@paperclipai/db";
import { environmentRunOrchestrator } from "../services/environment-run-orchestrator.ts";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres environment pool tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("environment pools", () => {
  let db!: ReturnType<typeof createDb>;
  let orchestrator!: ReturnType<typeof environmentRunOrchestrator>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-environment-pool-");
    db = createDb(tempDb.connectionString);
    orchestrator = environmentRunOrchestrator(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(environmentLeases);
    await db.delete(environments);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany() {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    return companyId;
  }

  let clock = 0;

  async function seedWorker(input: {
    companyId: string;
    name: string;
    poolKey?: string | null;
    status?: "active" | "disabled";
  }) {
    const id = randomUUID();
    clock += 1_000;
    const createdAt = new Date(Date.UTC(2026, 0, 1) + clock);
    await db.insert(environments).values({
      id,
      companyId: input.companyId,
      name: input.name,
      driver: "ssh",
      status: input.status ?? "active",
      poolKey: input.poolKey ?? null,
      config: {
        host: `${input.name}.example.test`,
        port: 22,
        username: "agent",
        remoteWorkspacePath: "/home/agent/workspace",
        privateKey: null,
        privateKeySecretRef: null,
        knownHosts: null,
        strictHostKeyChecking: false,
      },
      createdAt,
      updatedAt: createdAt,
    });
    return id;
  }

  /** Puts `count` runs on a worker, so it looks busy to the pool balancer. */
  async function occupy(companyId: string, environmentId: string, count: number) {
    for (let index = 0; index < count; index += 1) {
      await db.insert(environmentLeases).values({
        companyId,
        environmentId,
        status: "active",
        leasePolicy: "ephemeral",
        provider: "ssh",
      });
    }
  }

  async function resolve(companyId: string, selectedEnvironmentId: string) {
    return await orchestrator.resolveEnvironment({
      companyId,
      selectedEnvironmentId,
      // Any other id: a non-matching default keeps resolveEnvironment on the "look it up"
      // path instead of falling back to the implicit local environment.
      defaultEnvironmentId: randomUUID(),
    });
  }

  it("sends a run to the least loaded worker in the pool", async () => {
    // agents.default_environment_id is a single FK, so an agent is hard-bound to one box.
    // Pooling is what lets a fleet absorb the work instead.
    const companyId = await seedCompany();
    const busy = await seedWorker({ companyId, name: "worker-a", poolKey: "java" });
    const free = await seedWorker({ companyId, name: "worker-b", poolKey: "java" });
    const middling = await seedWorker({ companyId, name: "worker-c", poolKey: "java" });

    await occupy(companyId, busy, 2);
    await occupy(companyId, middling, 1);

    const resolved = await resolve(companyId, busy);

    expect(resolved.id).toBe(free);
  });

  it("keeps a warm worker warm when the pool is evenly loaded", async () => {
    // Ties must not bounce a run between machines on every heartbeat.
    const companyId = await seedCompany();
    await seedWorker({ companyId, name: "worker-a", poolKey: "java" });
    const bound = await seedWorker({ companyId, name: "worker-b", poolKey: "java" });
    await seedWorker({ companyId, name: "worker-c", poolKey: "java" });

    const resolved = await resolve(companyId, bound);

    expect(resolved.id).toBe(bound);
  });

  it("leaves an unpooled environment exactly where the agent pointed it", async () => {
    const companyId = await seedCompany();
    const solo = await seedWorker({ companyId, name: "solo", poolKey: null });
    const other = await seedWorker({ companyId, name: "idle-elsewhere", poolKey: null });
    await occupy(companyId, solo, 5);
    void other;

    const resolved = await resolve(companyId, solo);

    expect(resolved.id).toBe(solo);
  });

  it("does not borrow a worker from another pool", async () => {
    const companyId = await seedCompany();
    const java = await seedWorker({ companyId, name: "java-a", poolKey: "java" });
    const node = await seedWorker({ companyId, name: "node-a", poolKey: "node" });
    await occupy(companyId, java, 3);
    void node;

    const resolved = await resolve(companyId, java);

    expect(resolved.id).toBe(java);
    expect(resolved.poolKey).toBe("java");
  });

  it("skips a disabled worker even when it is the emptiest", async () => {
    const companyId = await seedCompany();
    const busy = await seedWorker({ companyId, name: "worker-a", poolKey: "java" });
    await seedWorker({ companyId, name: "worker-down", poolKey: "java", status: "disabled" });
    const healthy = await seedWorker({ companyId, name: "worker-b", poolKey: "java" });

    await occupy(companyId, busy, 2);
    await occupy(companyId, healthy, 1);

    const resolved = await resolve(companyId, busy);

    expect(resolved.id).toBe(healthy);
  });
});
