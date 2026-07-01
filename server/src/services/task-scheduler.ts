import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, handoffs, tasks, type TaskStatus } from "@paperclipai/db";

export type Task = typeof tasks.$inferSelect;
export type Agent = typeof agents.$inferSelect;

export interface DispatchResult {
  dispatched: string[];
  skipped: string[];
  failed: string[];
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function getDesiredSkills(agent: Agent): string[] {
  const adapterConfig = agent.adapterConfig;
  if (!adapterConfig || typeof adapterConfig !== "object" || Array.isArray(adapterConfig)) return [];
  const desiredSkills = (adapterConfig as Record<string, unknown>).desiredSkills;
  if (!Array.isArray(desiredSkills)) return [];
  return desiredSkills
    .filter((skill): skill is string => typeof skill === "string")
    .map((skill) => skill.trim().toLowerCase())
    .filter(Boolean);
}

function hasRequiredSkills(task: Task, agent: Agent): boolean {
  const requiredSkills = parseStringArray(task.requiredSkills).map((skill) => skill.toLowerCase());
  if (requiredSkills.length === 0) return true;
  const desiredSkills = getDesiredSkills(agent);
  return requiredSkills.every((requiredSkill) =>
    desiredSkills.some((desiredSkill) => desiredSkill === requiredSkill || desiredSkill.includes(requiredSkill) || requiredSkill.includes(desiredSkill)),
  );
}

export function taskSchedulerService(db: Db): {
  tick(): Promise<DispatchResult>;
  findBestAgent(task: Task, agents: Agent[]): Promise<Agent | null>;
  areDependenciesMet(task: Task): Promise<boolean>;
  areHandoffsReady(task: Task): Promise<{ ready: boolean; blocking: string[] }>;
} {
  return {
    async tick(): Promise<DispatchResult> {
      const result: DispatchResult = { dispatched: [], skipped: [], failed: [] };

      const pendingTasks = await db
        .select()
        .from(tasks)
        .where(eq(tasks.status, "not_started" as TaskStatus))
        .orderBy(desc(tasks.priority), asc(tasks.createdAt));

      const availableAgents = await db.select().from(agents);

      for (const task of pendingTasks) {
        try {
          const dependenciesMet = await this.areDependenciesMet(task);
          if (!dependenciesMet) {
            result.skipped.push(`${task.id}: dependencies not met`);
            continue;
          }

          const handoffGate = await this.areHandoffsReady(task);
          if (!handoffGate.ready) {
            result.skipped.push(`${task.id}: blocking on handoffs [${handoffGate.blocking.join(",")}]`);
            continue;
          }

          const bestAgent = await this.findBestAgent(task, availableAgents);
          if (!bestAgent) {
            result.skipped.push(`${task.id}: no matching agent`);
            continue;
          }

          const updated = await db
            .update(tasks)
            .set({
              assigneeAgentId: bestAgent.id,
              status: "in_progress" as TaskStatus,
              updatedAt: new Date(),
            })
            .where(and(eq(tasks.id, task.id), eq(tasks.status, "not_started" as TaskStatus)))
            .returning({ id: tasks.id });

          if (updated[0]) {
            result.dispatched.push(task.id);
          } else {
            result.skipped.push(`${task.id}: no longer pending`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          result.failed.push(`${task.id}: ${message}`);
        }
      }

      return result;
    },

    async findBestAgent(task: Task, agentRows: Agent[]): Promise<Agent | null> {
      const matchingAgents = agentRows.filter((agent) => hasRequiredSkills(task, agent));
      if (matchingAgents.length === 0) return null;

      const matchingAgentIds = matchingAgents.map((agent) => agent.id);
      const workloadRows = await db
        .select({
          assigneeAgentId: tasks.assigneeAgentId,
          count: sql<number>`count(*)::int`,
        })
        .from(tasks)
        .where(and(eq(tasks.status, "in_progress"), inArray(tasks.assigneeAgentId, matchingAgentIds)))
        .groupBy(tasks.assigneeAgentId);

      const workloads = new Map<string, number>();
      for (const row of workloadRows) {
        if (row.assigneeAgentId) workloads.set(row.assigneeAgentId, row.count);
      }

      return [...matchingAgents].sort((left, right) => {
        const leftWorkload = workloads.get(left.id) ?? 0;
        const rightWorkload = workloads.get(right.id) ?? 0;
        if (leftWorkload !== rightWorkload) return leftWorkload - rightWorkload;
        return left.createdAt.getTime() - right.createdAt.getTime();
      })[0] ?? null;
    },

    async areDependenciesMet(task: Task): Promise<boolean> {
      const dependencyIds = parseStringArray(task.dependencies);
      if (dependencyIds.length === 0) return true;

      const dependencyRows = await db
        .select({ id: tasks.id, status: tasks.status })
        .from(tasks)
        .where(inArray(tasks.id, dependencyIds));

      if (dependencyRows.length !== dependencyIds.length) return false;
      return dependencyRows.every((dependency) => dependency.status === "actual_passed" || dependency.status === "closed");
    },

    /**
     * Phase 9: handoff gate. If any upstream task has produced a handoff
     * that explicitly names THIS task as the consumer (via
     * `handoffs.consumed_by`), the handoff must be `status='ready'` (i.e.
     * the upstream task reached `done`) before this task can be
     * dispatched. This prevents the bug from Phase 0–7 where two parallel
     * tasks could start simultaneously and the consumer could begin work
     * before the producer's artifact was on disk.
     *
     * Returns the list of handoff IDs that are still blocking, for
     * diagnostic logging and so the UI can surface "waiting on X".
     */
    async areHandoffsReady(task: Task): Promise<{ ready: boolean; blocking: string[] }> {
      const incomingHandoffs = await db
        .select({ id: handoffs.id, status: handoffs.status })
        .from(handoffs)
        .where(and(eq(handoffs.consumedBy, task.id), eq(handoffs.status, "stale")));
      // Stale handoffs mean an upstream task was re-dispatched and the
      // previous artifact is no longer trustworthy. Block this consumer
      // until the producer marks a fresh handoff `ready`.
      const stale = incomingHandoffs.filter((h) => h.status === "stale");
      const readyOrConsumed = await db
        .select({ id: handoffs.id, status: handoffs.status })
        .from(handoffs)
        .where(eq(handoffs.consumedBy, task.id));
      const blocking = [
        ...stale.map((h) => `${h.id}:stale`),
        ...readyOrConsumed
          .filter((h) => h.status !== "ready" && h.status !== "consumed")
          .map((h) => `${h.id}:${h.status}`),
      ];
      // If no handoffs target this task, fall back to: any handoff
      // associated with the task that has status='stale' would still
      // block. We treat "no handoffs" as ready (the producer may not have
      // produced structured handoffs, in which case dependencies + DAG
      // are the source of truth).
      const total = readyOrConsumed.length + stale.length;
      if (total === 0) return { ready: true, blocking: [] };
      return { ready: blocking.length === 0, blocking };
    },
  };
}
