import { and, eq, lt, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, goals, tasks } from "@paperclipai/db";

export type Task = typeof tasks.$inferSelect;

export interface LegionHealth {
  goals: { total: number; executing: number; completed: number; failed: number };
  tasks: { total: number; todo: number; inProgress: number; done: number; failed: number; timedOut: number };
  agents: { total: number; active: number };
}

interface CountRow { count: number }

function warn(type: string, details: string): void {
  console.warn(`[LEGION-WARN] ${new Date().toISOString()} ${type}: ${details}`);
}

function timeoutCutoffStr(): string {
  return new Date(Date.now() - 120 * 60_000).toISOString();
}

function heartbeatCutoffStr(): string {
  return new Date(Date.now() - 10 * 60_000).toISOString();
}

async function countWhere(db: Db, table: typeof goals | typeof tasks | typeof agents, condition?: unknown): Promise<number> {
  const query = db.select({ count: sql<number>`count(*)::int` }).from(table as never);
  const rows = condition ? await (query as never as { where(c: unknown): Promise<CountRow[]> }).where(condition) : await query;
  return rows[0]?.count ?? 0;
}

export function legionMonitorService(db: Db) {
  return {
    async checkTimeouts(timeoutMinutes = 120): Promise<{ timedOut: Task[]; ok: Task[] }> {
      const cutoff = new Date(Date.now() - timeoutMinutes * 60_000);
      const inProgress = await db.select().from(tasks).where(eq(tasks.status, "in_progress"));
      const timedOut = inProgress.filter((task) => task.updatedAt < cutoff);
      const ok = inProgress.filter((task) => task.updatedAt >= cutoff);
      if (timedOut.length > 0) warn("timeout", `${timedOut.length} task(s) exceeded ${timeoutMinutes} minutes: ${timedOut.map((t) => t.id).join(", ")}`);
      return { timedOut, ok };
    },

    async handleTimeouts(): Promise<{ reScheduled: string[]; maxAttemptsReached: string[] }> {
      const { timedOut } = await this.checkTimeouts();
      const reScheduled: string[] = [];
      const maxAttemptsReached: string[] = [];
      for (const task of timedOut) {
        const attempts = task.attempts ?? 0;
        const maxAttempts = task.maxAttempts ?? 3;
        if (attempts + 1 >= maxAttempts) {
          await db.update(tasks).set({ status: "failed", attempts: attempts + 1, updatedAt: new Date() }).where(eq(tasks.id, task.id));
          maxAttemptsReached.push(task.id);
        } else {
          await db.update(tasks).set({ status: "todo", assigneeAgentId: null, attempts: attempts + 1, updatedAt: new Date() }).where(eq(tasks.id, task.id));
          reScheduled.push(task.id);
        }
      }
      return { reScheduled, maxAttemptsReached };
    },

    async checkRetriableFailures(): Promise<{ retried: string[]; maxAttemptsReached: string[] }> {
      const failed = await db.select().from(tasks).where(eq(tasks.status, "failed"));
      const retried: string[] = [];
      const maxAttemptsReached: string[] = [];
      for (const task of failed) {
        const attempts = task.attempts ?? 0;
        const maxAttempts = task.maxAttempts ?? 3;
        if (attempts < maxAttempts) {
          await db.update(tasks).set({ status: "todo", assigneeAgentId: null, attempts: attempts + 1, updatedAt: new Date() }).where(eq(tasks.id, task.id));
          retried.push(task.id);
        } else {
          maxAttemptsReached.push(task.id);
        }
      }
      return { retried, maxAttemptsReached };
    },

    async getHealth(): Promise<LegionHealth> {
      const [allGoals, goalExecuting, goalCompleted, goalFailed, allTasks, taskTodo, taskInProgress, taskDone, taskFailed, inProgressTasks] = await Promise.all([
        countWhere(db, goals),
        countWhere(db, goals, eq(goals.status, "executing")),
        countWhere(db, goals, eq(goals.status, "completed")),
        countWhere(db, goals, eq(goals.status, "failed")),
        countWhere(db, tasks),
        countWhere(db, tasks, eq(tasks.status, "todo")),
        countWhere(db, tasks, eq(tasks.status, "in_progress")),
        countWhere(db, tasks, eq(tasks.status, "done")),
        countWhere(db, tasks, eq(tasks.status, "failed")),
        db.select().from(tasks).where(eq(tasks.status, "in_progress")),
      ]);
      const timeoutCutoff = new Date(Date.now() - 120 * 60_000);
      const timedOut = inProgressTasks.filter((t) => t.updatedAt && t.updatedAt < timeoutCutoff).length;
      const health: LegionHealth = {
        goals: { total: allGoals, executing: goalExecuting, completed: goalCompleted, failed: goalFailed },
        tasks: { total: allTasks, todo: taskTodo, inProgress: taskInProgress, done: taskDone, failed: taskFailed, timedOut },
        agents: { total: await countWhere(db, agents), active: 0 },
      };
      if (health.tasks.failed > 0 && health.tasks.total > 0 && health.tasks.failed > health.tasks.total * 0.2) warn("failure-rate", `${health.tasks.failed}/${health.tasks.total} tasks failed`);
      const cutoffMs = Date.now() - 10 * 60_000;
      const allAgentsList = await db.select({ id: agents.id, name: agents.name, lastHeartbeatAt: agents.lastHeartbeatAt }).from(agents);
      const offlineAgents = allAgentsList.filter((a) => !a.lastHeartbeatAt || a.lastHeartbeatAt.getTime() < cutoffMs);
      for (const agent of offlineAgents) warn("agent-offline", `${agent.name} (${agent.id}) has no heartbeat within 10 minutes`);
      health.agents.active = allAgentsList.filter((a) => a.lastHeartbeatAt && a.lastHeartbeatAt.getTime() >= cutoffMs).length;
      return health;
    },
  };
}
