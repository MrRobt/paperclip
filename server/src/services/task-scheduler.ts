import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, tasks } from "@paperclipai/db";

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
} {
  return {
    async tick(): Promise<DispatchResult> {
      const result: DispatchResult = { dispatched: [], skipped: [], failed: [] };

      const pendingTasks = await db
        .select()
        .from(tasks)
        .where(eq(tasks.status, "todo"))
        .orderBy(desc(tasks.priority), asc(tasks.createdAt));

      const availableAgents = await db.select().from(agents);

      for (const task of pendingTasks) {
        try {
          const dependenciesMet = await this.areDependenciesMet(task);
          if (!dependenciesMet) {
            result.skipped.push(`${task.id}: dependencies not met`);
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
              status: "in_progress",
              updatedAt: new Date(),
            })
            .where(and(eq(tasks.id, task.id), eq(tasks.status, "todo")))
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
      return dependencyRows.every((dependency) => dependency.status === "done");
    },
  };
}
