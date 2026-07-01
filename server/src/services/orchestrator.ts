import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  fileLocks,
  goals,
  orchestratorRuns,
  phases,
  projectContext,
  tasks,
  type OrchestratorDecision,
  type OrchestratorDispatch,
  type OrchestratorFileLockAction,
  type TaskStatus,
} from "@paperclipai/db";
import {
  detectFileLockConflicts,
  isTaskDispatchable,
} from "./orchestrator-state-machine.js";
import { fileLockService } from "./file-lock.js";

/**
 * Phase 16 of doc/plans/2026-07-01-orchestrator-control-plane.md.
 *
 * The orchestrator's main tick. One invocation:
 *   1. Reads project_context + active phases + ready tasks.
 *   2. Sweeps expired file_locks and runtime_leases.
 *   3. For each not_started task whose dependencies are actual_passed/closed:
 *      - Checks file lock conflicts.
 *      - If clear, acquires locks + dispatches via taskSchedulerService.
 *      - If conflicting, records a decision (no dispatch).
 *   4. Detects blocked tasks (no active dispatches, no progress) → updates project_context.
 *   5. Writes an orchestrator_runs row with the full 8-section output.
 *
 * The orchestrator itself does NOT write business code. It only
 * orchestrates, arbitrates, syncs, and verifies.
 */

export interface OrchestratorTickInput {
  companyId: string;
  orchestratorAgentId: string;
  triggerKind?: "manual" | "scheduled" | "event" | "escalation";
}

export interface OrchestratorTickOutput {
  runId: string;
  currentLongGoal: string | null;
  currentPhase: { id: string; name: string; status: string } | null;
  completedTasks: Array<{ id: string; title: string; actualPassedAt: Date | null }>;
  partialTasks: Array<{ id: string; title: string; status: TaskStatus; blockedBy: string[] }>;
  blockedTasks: Array<{ id: string; title: string; ownerAgentId: string | null; reason: string }>;
  readyToDispatch: Array<{ id: string; title: string; filesInScope: string[]; agentMatch: boolean }>;
  fileConflicts: Array<{ file: string; claimedBy: string[] }>;
  contextUpdates: Array<{ section: string; change: string }>;
  nextDispatch: OrchestratorDispatch[];
  decisions: OrchestratorDecision[];
}

export function orchestratorService(db: Db) {
  const locks = fileLockService(db);

  return {
    async tick(input: OrchestratorTickInput): Promise<OrchestratorTickOutput> {
      const runId = `orch_run_${Math.random().toString(36).slice(2, 12)}`;
      const startedAt = new Date();
      const decisions: OrchestratorDecision[] = [];
      const dispatches: OrchestratorDispatch[] = [];
      const fileLockActions: OrchestratorFileLockAction[] = [];
      const contextUpdates: Array<{ section: string; change: string }> = [];

      // 1. Sweep expired locks (collaboration pitfall #9).
      const sweep = await locks.sweepExpired();
      if (sweep.swept > 0) {
        decisions.push({
          type: "release_lock",
          subject: `expired:${sweep.swept}`,
          reason: `${sweep.swept} expired file lock(s) released`,
          ts: new Date().toISOString(),
        });
      }

      // 2. Read project context.
      const ctxRows = await db.select().from(projectContext).where(eq(projectContext.companyId, input.companyId)).limit(1);
      const ctx = ctxRows[0] ?? null;

      let currentLongGoalTitle: string | null = null;
      let currentPhaseInfo: { id: string; name: string; status: string } | null = null;
      if (ctx?.currentLongGoalId) {
        const goalRows = await db
          .select({ id: goals.id, title: goals.title })
          .from(goals)
          .where(eq(goals.id, ctx.currentLongGoalId))
          .limit(1);
        currentLongGoalTitle = goalRows[0]?.title ?? null;
      }
      if (ctx?.currentPhaseId) {
        const phaseRows = await db
          .select({ id: phases.id, name: phases.name, status: phases.status })
          .from(phases)
          .where(eq(phases.id, ctx.currentPhaseId))
          .limit(1);
        currentPhaseInfo = phaseRows[0]
          ? { id: phaseRows[0].id, name: phaseRows[0].name, status: phaseRows[0].status }
          : null;
      }

      // 3. Read all non-terminal tasks for the company (joined via goal).
      const taskRows = await db
        .select({
          id: tasks.id,
          goalId: tasks.goalId,
          title: tasks.title,
          status: tasks.status,
          assigneeAgentId: tasks.assigneeAgentId,
          filesInScope: tasks.filesInScope,
          dependencies: tasks.dependencies,
          phaseId: tasks.phaseId,
          completedAt: tasks.completedAt,
        })
        .from(tasks)
        .innerJoin(goals, eq(tasks.goalId, goals.id))
        .where(
          and(
            eq(goals.companyId, input.companyId),
            ne(tasks.status, "closed"),
            ne(tasks.status, "actual_passed"),
          ),
        )
        .orderBy(asc(tasks.priority));

      // 4. Classify tasks by status.
      const completedTasks: OrchestratorTickOutput["completedTasks"] = [];
      const partialTasks: OrchestratorTickOutput["partialTasks"] = [];
      const blockedTasks: OrchestratorTickOutput["blockedTasks"] = [];

      for (const t of taskRows) {
        const status = t.status as TaskStatus;
        if (status === "actual_passed" || status === "closed") {
          completedTasks.push({
            id: t.id,
            title: t.title,
            actualPassedAt: t.completedAt,
          });
        } else if (status === "blocked") {
          blockedTasks.push({
            id: t.id,
            title: t.title,
            ownerAgentId: t.assigneeAgentId,
            reason: "status=blocked",
          });
        } else if (status === "failed") {
          blockedTasks.push({
            id: t.id,
            title: t.title,
            ownerAgentId: t.assigneeAgentId,
            reason: "failed; check postmortem",
          });
        } else if (status === "not_started" || status === "code_landed_needs_runtime" || status === "partial_runtime_passed") {
          partialTasks.push({
            id: t.id,
            title: t.title,
            status,
            blockedBy: [],
          });
        } else if (status === "in_progress") {
          partialTasks.push({
            id: t.id,
            title: t.title,
            status,
            blockedBy: [],
          });
        }
      }

      // 5. For each not_started task, check dispatchability.
      const activeLocks = await db
        .select({ filePath: fileLocks.filePath, taskId: fileLocks.taskId })
        .from(fileLocks)
        .where(isNull(fileLocks.releasedAt));
      const locksByFile = new Map<string, string[]>();
      for (const lock of activeLocks) {
        if (!locksByFile.has(lock.filePath)) locksByFile.set(lock.filePath, []);
        locksByFile.get(lock.filePath)!.push(lock.taskId);
      }

      const readyToDispatch: OrchestratorTickOutput["readyToDispatch"] = [];
      const fileConflicts: OrchestratorTickOutput["fileConflicts"] = [];
      const notStarted = taskRows.filter((t) => t.status === "not_started");

      for (const t of notStarted) {
        // Resolve dependencies' statuses.
        const depIds = parseDependencyList(t.dependencies);
        let depStatuses: Array<{ taskId: string; status: TaskStatus }> = [];
        if (depIds.length > 0) {
          const depRows = await db
            .select({ id: tasks.id, status: tasks.status })
            .from(tasks)
            .where(inArray(tasks.id, depIds));
          depStatuses = depRows.map((r) => ({ taskId: r.id, status: r.status as TaskStatus }));
        }
        const files = parseFileList(t.filesInScope);
        const activeExclusivePaths = Array.from(locksByFile.keys());
        const gate = isTaskDispatchable({
          status: "not_started",
          dependencies: depStatuses,
          filesInScope: files,
          activeExclusiveLocks: activeExclusivePaths,
        });
        if (!gate.ready) {
          decisions.push({
            type: "block",
            subject: t.id,
            reason: gate.blocking.join("; "),
            ts: new Date().toISOString(),
          });
          continue;
        }
        // Conflict check: which of the requested files are already held by another task?
        const conflicts = detectFileLockConflicts(activeExclusivePaths, files);
        if (conflicts.conflicts.length > 0) {
          for (const file of conflicts.conflicts) {
            fileConflicts.push({ file, claimedBy: locksByFile.get(file) ?? [] });
          }
          decisions.push({
            type: "block",
            subject: t.id,
            reason: `file_lock conflicts: ${conflicts.conflicts.join(", ")}`,
            ts: new Date().toISOString(),
          });
          continue;
        }
        // Acquire locks.
        if (files.length > 0 && t.assigneeAgentId) {
          const acquire = await locks.acquireMany({
            taskId: t.id,
            agentId: t.assigneeAgentId,
            files,
          });
          if (acquire.conflicts.length > 0) {
            for (const file of acquire.conflicts) {
              fileConflicts.push({ file, claimedBy: locksByFile.get(file) ?? [] });
            }
            decisions.push({
              type: "block",
              subject: t.id,
              reason: `acquire conflict: ${acquire.conflicts.join(", ")}`,
              ts: new Date().toISOString(),
            });
            continue;
          }
          for (const file of acquire.acquired) {
            fileLockActions.push({
              action: "acquire",
              filePath: file,
              taskId: t.id,
              agentId: t.assigneeAgentId,
              ts: new Date().toISOString(),
              lockType: "exclusive",
            });
          }
        }
        // Schedule dispatch (best-effort — only when there's an assignee).
        if (t.assigneeAgentId) {
          dispatches.push({
            taskId: t.id,
            agentId: t.assigneeAgentId,
            ts: new Date().toISOString(),
            reason: "not_started; deps closed; locks acquired",
          });
          readyToDispatch.push({
            id: t.id,
            title: t.title,
            filesInScope: files,
            agentMatch: true,
          });
        } else {
          // No owner assigned — surface as decision (orchestrator must pick one).
          readyToDispatch.push({
            id: t.id,
            title: t.title,
            filesInScope: files,
            agentMatch: false,
          });
          decisions.push({
            type: "escalate",
            subject: t.id,
            reason: "no assignee; orchestrator must assign owner",
            ts: new Date().toISOString(),
          });
        }
      }

      // 6. Persist the run record.
      const runRow = await db
        .insert(orchestratorRuns)
        .values({
          id: runId,
          companyId: input.companyId,
          orchestratorAgentId: input.orchestratorAgentId,
          startedAt,
          endedAt: new Date(),
          triggerKind: input.triggerKind ?? "manual",
          status: "succeeded",
          decisions,
          dispatches,
          fileLockActions,
          contextSnapshot: ctx ?? null,
          summary: buildSummary(decisions, dispatches, fileConflicts),
        })
        .returning();
      const persisted = runRow[0];

      // 7. Update project_context if there's anything notable to record.
      if (blockedTasks.length > 0 || readyToDispatch.length > 0) {
        contextUpdates.push({
          section: "active_items",
          change: `${blockedTasks.length} blocked, ${readyToDispatch.length} ready, ${partialTasks.length} in progress`,
        });
        await db
          .insert(projectContext)
          .values({
            companyId: input.companyId,
            updatedAt: new Date(),
            updatedByAgentId: input.orchestratorAgentId,
          })
          .onConflictDoUpdate({
            target: projectContext.companyId,
            set: {
              updatedAt: new Date(),
              updatedByAgentId: input.orchestratorAgentId,
            },
          });
      }

      return {
        runId: persisted?.id ?? runId,
        currentLongGoal: currentLongGoalTitle,
        currentPhase: currentPhaseInfo,
        completedTasks,
        partialTasks,
        blockedTasks,
        readyToDispatch,
        fileConflicts,
        contextUpdates,
        nextDispatch: dispatches,
        decisions,
      };
    },
  };
}

function parseDependencyList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d): d is string => typeof d === "string");
  } catch {
    return [];
  }
}

function parseFileList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((p): p is string => typeof p === "string");
    return raw.split(",").map((p) => p.trim()).filter(Boolean);
  } catch {
    return raw.split(",").map((p) => p.trim()).filter(Boolean);
  }
}

function buildSummary(decisions: OrchestratorDecision[], dispatches: OrchestratorDispatch[], conflicts: { file: string }[]): string {
  const dispatchCount = dispatches.length;
  const blockCount = decisions.filter((d) => d.type === "block").length;
  const escalateCount = decisions.filter((d) => d.type === "escalate").length;
  const conflictCount = conflicts.length;
  return `dispatches=${dispatchCount} blocks=${blockCount} escalations=${escalateCount} file_conflicts=${conflictCount}`;
}