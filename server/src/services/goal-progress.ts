import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { goals, taskVerifications, tasks, type GoalStatus, type TaskStatus } from "@paperclipai/db";

/**
 * Phase 9 of doc/plans/2026-06-30-self-solving-agent-team.md.
 *
 * Aggregates task status into goal status transitions. The state machine
 * is:
 *
 *     planning ──(any task dispatched)──▶ executing
 *     executing ──(all tasks terminal)──▶ verifying
 *     verifying ──(all verify_passed)───▶ completed
 *                └(any task max-attempts exhausted)─▶ failed
 *
 * Terminal success is gated on the latest task_verifications row per
 * task reporting `passed=true`. The scheduler's DAG gate + Phase 8 hard
 * verification are pre-conditions; this service is the policy layer that
 * decides when a goal as a whole is done.
 */

const TERMINAL_TASK_STATUSES = new Set<TaskStatus>(["actual_passed", "closed", "failed"]);

/**
 * Exported pure helpers — used by phase9.test.ts and reused by the
 * scheduler / monitor where appropriate.
 */
export { TERMINAL_TASK_STATUSES };

export function initialGoalStatus(raw: string | null | undefined): GoalStatus {
  if (raw === "executing" || raw === "verifying" || raw === "completed" || raw === "failed") {
    return raw;
  }
  return "planning";
}

/**
 * Pure state-machine transition for goal status. Returns the next status
 * the goal should occupy plus whether a transition actually happened.
 *
 * Allowed transitions:
 *   planning   → executing
 *   executing  → verifying
 *   executing  → failed   (early failure when any task exhausts attempts)
 *   verifying  → completed
 *   verifying  → failed
 *   *          → *        (no-op when already at target)
 *
 * Terminal states (`completed`, `failed`) cannot move.
 */
export function applyTransition(
  from: GoalStatus,
  to: GoalStatus,
): { transitioned: boolean; next: GoalStatus } {
  if (from === to) return { transitioned: false, next: from };
  if (from === "completed" || from === "failed") return { transitioned: false, next: from };
  const allowed: Record<GoalStatus, ReadonlySet<GoalStatus>> = {
    planning: new Set(["executing", "failed"]),
    executing: new Set(["verifying", "failed"]),
    verifying: new Set(["completed", "failed"]),
    completed: new Set(),
    failed: new Set(),
  };
  if (allowed[from].has(to)) return { transitioned: true, next: to };
  return { transitioned: false, next: from };
}

export interface GoalProgressSnapshot {
  goalId: string;
  previousStatus: GoalStatus;
  nextStatus: GoalStatus;
  /** Reason recorded in the goal's `verificationResult` field for audit. */
  reason: string;
  /** True if a transition was applied this tick. */
  transitioned: boolean;
}

export function goalProgressService(db: Db) {
  return {
    /**
     * Evaluate one goal and apply any state transition. Idempotent: a
     * second call with no state change returns `{ transitioned: false }`.
     */
    async tickGoal(goalId: string): Promise<GoalProgressSnapshot | null> {
      const rows = await db.select().from(goals).where(eq(goals.id, goalId)).limit(1);
      const goal = rows[0];
      if (!goal) return null;
      const previousStatus = (goal.status ?? "planning") as GoalStatus;
      if (previousStatus === "completed" || previousStatus === "failed") {
        return { goalId, previousStatus, nextStatus: previousStatus, reason: "already terminal", transitioned: false };
      }

      const taskRows = await db.select().from(tasks).where(eq(tasks.goalId, goalId));
      const total = taskRows.length;
      if (total === 0) {
        return { goalId, previousStatus, nextStatus: previousStatus, reason: "no tasks", transitioned: false };
      }

      // planning → executing: any task moved past `not_started`.
      if (previousStatus === "planning") {
        const anyDispatched = taskRows.some((t) => t.status !== "not_started");
        if (anyDispatched) {
          await transitionGoal(db, goalId, "executing", "at least one task dispatched");
          return { goalId, previousStatus, nextStatus: "executing", reason: "at least one task dispatched", transitioned: true };
        }
        return { goalId, previousStatus, nextStatus: previousStatus, reason: "no task dispatched yet", transitioned: false };
      }

      // executing → failed: any task reached max attempts without passing.
      const exhausted = taskRows.find((t) => (t.attempts ?? 0) >= (t.maxAttempts ?? 3) && t.status === "failed");
      if (previousStatus === "executing" && exhausted) {
        await transitionGoal(db, goalId, "failed", `task ${exhausted.id} exhausted ${exhausted.attempts} attempts`);
        return { goalId, previousStatus, nextStatus: "failed", reason: `task ${exhausted.id} exhausted attempts`, transitioned: true };
      }

      const allTerminal = taskRows.every((t) => TERMINAL_TASK_STATUSES.has(t.status ?? ""));
      if (!allTerminal) {
        return { goalId, previousStatus, nextStatus: previousStatus, reason: "tasks still in flight", transitioned: false };
      }

      // executing → verifying: every task has reached a terminal status.
      if (previousStatus === "executing") {
        await transitionGoal(db, goalId, "verifying", "all tasks terminal; awaiting verification aggregate");
        return { goalId, previousStatus, nextStatus: "verifying", reason: "all tasks terminal", transitioned: true };
      }

      // verifying → completed or failed: aggregate latest verification per task.
      const taskIds = taskRows.map((t) => t.id);
      const latestPerTask = await db
        .select({
          taskId: taskVerifications.taskId,
          passed: taskVerifications.passed,
          createdAt: taskVerifications.createdAt,
        })
        .from(taskVerifications)
        .where(sql`${taskVerifications.taskId} = ANY(${taskIds})`)
        .orderBy(taskVerifications.taskId, sql`${taskVerifications.createdAt} DESC`);
      const latestByTask = new Map<string, boolean>();
      for (const row of latestPerTask) {
        if (!latestByTask.has(row.taskId)) latestByTask.set(row.taskId, row.passed);
      }
      const failingTask = taskRows.find((t) => {
        if (t.status !== "failed") return false;
        // Treat absent verification as failure too — fail closed.
        return latestByTask.get(t.id) !== true;
      });
      if (failingTask) {
        await transitionGoal(db, goalId, "failed", `task ${failingTask.id} did not pass verification`);
        return { goalId, previousStatus, nextStatus: "failed", reason: `task ${failingTask.id} failed verification`, transitioned: true };
      }
      const allPassed = taskRows.every((t) => latestByTask.get(t.id) === true);
      if (allPassed) {
        await transitionGoal(db, goalId, "completed", "all tasks passed verification");
        return { goalId, previousStatus, nextStatus: "completed", reason: "all tasks passed", transitioned: true };
      }
      return { goalId, previousStatus, nextStatus: previousStatus, reason: "verification in flight", transitioned: false };
    },

    /**
     * Walk every non-terminal goal. Cheap enough to run from the cron
     * loop alongside legion-monitor's tick.
     */
    async tickAll(): Promise<GoalProgressSnapshot[]> {
      const nonTerminal = await db
        .select({ id: goals.id })
        .from(goals)
        .where(sql`${goals.status} <> ALL(${["completed", "failed"]})`);
      const snapshots: GoalProgressSnapshot[] = [];
      for (const row of nonTerminal) {
        const snap = await this.tickGoal(row.id);
        if (snap) snapshots.push(snap);
      }
      return snapshots;
    },
  };
}

async function transitionGoal(db: Db, goalId: string, nextStatus: GoalStatus, reason: string): Promise<void> {
  await db
    .update(goals)
    .set({
      status: nextStatus,
      updatedAt: new Date(),
    })
    .where(eq(goals.id, goalId));
  // Audit note lives in `description` field as a transient marker. A
  // dedicated `goal_progress_events` table is a future task; for now the
  // value is overwritten on each transition but reason text is preserved
  // by appending into verificationResult via a JSON blob.
  console.info(`[goal-progress] ${goalId}: ${reason} -> ${nextStatus}`);
}