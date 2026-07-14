import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  activityLog,
  agents,
  approvals,
  budgetIncidents,
  budgetPolicies,
  companies,
  costEvents,
  createDb,
} from "@paperclipai/db";
import { budgetService } from "../services/budgets.ts";
import { costService } from "../services/costs.ts";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres budget metric tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("budget metrics", () => {
  let db!: ReturnType<typeof createDb>;
  let budgets!: ReturnType<typeof budgetService>;
  let costs!: ReturnType<typeof costService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-budget-metric-");
    db = createDb(tempDb.connectionString);
    budgets = budgetService(db);
    costs = costService(db);
  }, 20_000);

  afterEach(async () => {
    // A hard-stop raises an approval for a human to resume the scope, and the incident points
    // at it: budget_incidents.approval_id -> approvals.id -> companies.id.
    await db.delete(budgetIncidents);
    await db.delete(approvals);
    await db.delete(budgetPolicies);
    await db.delete(costEvents);
    await db.delete(activityLog);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seed() {
    const companyId = randomUUID();
    const agentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Subscription Agent",
      role: "engineer",
      status: "active",
      adapterType: "claude_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    return { companyId, agentId };
  }

  /** A Claude Max / relay run: real tokens burned, zero billed spend. */
  async function recordSubscriptionRun(
    companyId: string,
    agentId: string,
    tokens: { input: number; cached: number; output: number },
  ) {
    return await costs.createEvent(companyId, {
      agentId,
      provider: "anthropic",
      biller: "anthropic",
      billingType: "subscription_included",
      model: "claude-opus-4-8",
      inputTokens: tokens.input,
      cachedInputTokens: tokens.cached,
      outputTokens: tokens.output,
      costCents: 0,
      occurredAt: new Date(),
    });
  }

  async function readAgent(agentId: string) {
    return await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .then((rows) => rows[0]);
  }

  it("meters the tokens a dollar budget is structurally blind to", async () => {
    const { companyId, agentId } = await seed();

    await budgets.upsertPolicy(
      companyId,
      { scopeType: "agent", scopeId: agentId, metric: "total_tokens", amount: 500_000, hardStopEnabled: true },
      null,
    );

    await recordSubscriptionRun(companyId, agentId, { input: 31_569, cached: 181_760, output: 1_366 });

    const overview = await budgets.overview(companyId);
    const policy = overview.policies.find((entry) => entry.scopeId === agentId);
    expect(policy?.metric).toBe("total_tokens");
    // Cached input is counted: it dominates agent traffic and is real metered work.
    expect(policy?.observedAmount).toBe(31_569 + 181_760 + 1_366);

    // The dollar ledger stays at zero for subscription usage — which is precisely why a
    // billed_cents budget can never restrain an agent on a Claude Max / relay plan.
    const spend = await costs.summary(companyId);
    expect(spend.spendCents).toBe(0);
  });

  it("hard-stops an agent whose token budget is exhausted by zero-cost usage", async () => {
    const { companyId, agentId } = await seed();

    await budgets.upsertPolicy(
      companyId,
      { scopeType: "agent", scopeId: agentId, metric: "total_tokens", amount: 50_000, hardStopEnabled: true },
      null,
    );

    await recordSubscriptionRun(companyId, agentId, { input: 30_000, cached: 25_000, output: 5_000 });

    const agent = await readAgent(agentId);
    expect(agent.status).toBe("paused");
    expect(agent.pauseReason).toBe("budget");

    const block = await budgets.getInvocationBlock(companyId, agentId);
    expect(block?.scopeType).toBe("agent");
  });

  it("leaves an agent running while its token budget still has headroom", async () => {
    const { companyId, agentId } = await seed();

    await budgets.upsertPolicy(
      companyId,
      { scopeType: "agent", scopeId: agentId, metric: "total_tokens", amount: 500_000, hardStopEnabled: true },
      null,
    );

    await recordSubscriptionRun(companyId, agentId, { input: 10_000, cached: 5_000, output: 1_000 });

    const agent = await readAgent(agentId);
    expect(agent.status).toBe("active");
    await expect(budgets.getInvocationBlock(companyId, agentId)).resolves.toBeNull();
  });

  it("still hard-stops on billed_cents for metered providers", async () => {
    const { companyId, agentId } = await seed();

    await budgets.upsertPolicy(
      companyId,
      { scopeType: "agent", scopeId: agentId, metric: "billed_cents", amount: 500, hardStopEnabled: true },
      null,
    );

    await costs.createEvent(companyId, {
      agentId,
      provider: "openai",
      biller: "openai",
      billingType: "metered_api",
      model: "gpt-5",
      inputTokens: 1_000,
      cachedInputTokens: 0,
      outputTokens: 500,
      costCents: 600,
      occurredAt: new Date(),
    });

    const agent = await readAgent(agentId);
    expect(agent.status).toBe("paused");
    expect(agent.pauseReason).toBe("budget");
  });

  it("blocks new work when either budget dimension is exceeded", async () => {
    const { companyId, agentId } = await seed();

    // A scope can carry one policy per metric. The preflight check used to query
    // `metric = 'billed_cents'` and take a single row, so the token cap below was invisible
    // to it and work would start regardless.
    await budgets.upsertPolicy(
      companyId,
      { scopeType: "agent", scopeId: agentId, metric: "billed_cents", amount: 10_000, hardStopEnabled: true },
      null,
    );
    await budgets.upsertPolicy(
      companyId,
      { scopeType: "agent", scopeId: agentId, metric: "total_tokens", amount: 40_000, hardStopEnabled: true },
      null,
    );

    // Blows the token cap while the dollar cap stays untouched at $0 of $100.
    await recordSubscriptionRun(companyId, agentId, { input: 30_000, cached: 15_000, output: 2_000 });

    const block = await budgets.getInvocationBlock(companyId, agentId);
    expect(block?.scopeType).toBe("agent");
    expect(block?.scopeId).toBe(agentId);
  });
});
