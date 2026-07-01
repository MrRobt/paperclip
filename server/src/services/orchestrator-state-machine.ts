/**
 * Phase 16 of doc/plans/2026-07-01-orchestrator-control-plane.md.
 *
 * 8-state task state machine + 8-state phase state machine.
 *
 * The state machines are pure functions; the orchestrator calls them
 * before issuing a DB update to ensure the requested transition is
 * legal. Raw UPDATEs that bypass this module are reserved for
 * migration scripts and explicitly audited in `orchestrator_runs`.
 */

import type { PhaseStatus, TaskStatus } from "@paperclipai/db";

/**
 * Allowed transitions for the 8-state task machine:
 *
 *   not_started              ─▶ in_progress | blocked | failed
 *   in_progress              ─▶ blocked | code_landed_needs_runtime | failed
 *   blocked                  ─▶ in_progress | failed
 *   code_landed_needs_runtime ─▶ partial_runtime_passed | actual_passed | failed
 *   partial_runtime_passed   ─▶ code_landed_needs_runtime | actual_passed | failed
 *   actual_passed            ─▶ closed
 *   failed                   ─▶ not_started (retry) | closed
 *   closed                   ─▶ ∅ (terminal)
 */
const TASK_TRANSITIONS: Record<TaskStatus, ReadonlyArray<TaskStatus>> = {
  not_started: ["in_progress", "blocked", "failed"],
  in_progress: ["blocked", "code_landed_needs_runtime", "failed"],
  blocked: ["in_progress", "failed"],
  code_landed_needs_runtime: ["partial_runtime_passed", "actual_passed", "failed"],
  partial_runtime_passed: ["code_landed_needs_runtime", "actual_passed", "failed"],
  actual_passed: ["closed"],
  failed: ["not_started", "closed"],
  closed: [],
};

/**
 * Allowed transitions for the 8-state phase machine. Mirrors the
 * task machine but at phase granularity — phases don't have an
 * intermediate "code landed" state because a phase is closed only
 * after every task inside it is closed.
 */
const PHASE_TRANSITIONS: Record<PhaseStatus, ReadonlyArray<PhaseStatus>> = {
  not_started: ["in_progress", "blocked"],
  in_progress: ["blocked", "code_landed_needs_runtime", "failed"],
  blocked: ["in_progress", "failed"],
  code_landed_needs_runtime: ["actual_passed", "failed"],
  partial_runtime_passed: ["actual_passed", "failed"],
  actual_passed: ["closed"],
  failed: ["not_started", "closed"],
  closed: [],
};

export interface TransitionResult {
  /** True when `from → to` is allowed. */
  ok: boolean;
  /** Stable reason code for logging. */
  code: "ok" | "unknown_from" | "unknown_to" | "illegal_transition" | "terminal";
  /** Human-readable message — empty when ok. */
  message: string;
  /** Echo back of `to` for ergonomic caller chains. */
  next: TaskStatus | PhaseStatus;
}

export function canTransitionTask(from: TaskStatus, to: TaskStatus): TransitionResult {
  if (!(from in TASK_TRANSITIONS)) {
    return { ok: false, code: "unknown_from", message: `unknown source status: ${from}`, next: from };
  }
  if (!(to in TASK_TRANSITIONS)) {
    return { ok: false, code: "unknown_to", message: `unknown target status: ${to}`, next: from };
  }
  if (from === "closed") {
    return { ok: false, code: "terminal", message: `task is closed; no further transitions`, next: from };
  }
  if (!TASK_TRANSITIONS[from].includes(to)) {
    return {
      ok: false,
      code: "illegal_transition",
      message: `illegal task transition: ${from} → ${to}; allowed: [${TASK_TRANSITIONS[from].join(", ")}]`,
      next: from,
    };
  }
  return { ok: true, code: "ok", message: "", next: to };
}

export function canTransitionPhase(from: PhaseStatus, to: PhaseStatus): TransitionResult {
  if (!(from in PHASE_TRANSITIONS)) {
    return { ok: false, code: "unknown_from", message: `unknown source status: ${from}`, next: from };
  }
  if (!(to in PHASE_TRANSITIONS)) {
    return { ok: false, code: "unknown_to", message: `unknown target status: ${to}`, next: from };
  }
  if (from === "closed") {
    return { ok: false, code: "terminal", message: `phase is closed; no further transitions`, next: from };
  }
  if (!PHASE_TRANSITIONS[from].includes(to)) {
    return {
      ok: false,
      code: "illegal_transition",
      message: `illegal phase transition: ${from} → ${to}; allowed: [${PHASE_TRANSITIONS[from].join(", ")}]`,
      next: from,
    };
  }
  return { ok: true, code: "ok", message: "", next: to };
}

/**
 * Convenience: validate a transition and throw a structured error on
 * illegal moves. Use this when the caller cannot continue without a
 * legal transition (e.g. the orchestrator issuing a DB update).
 */
export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  const result = canTransitionTask(from, to);
  if (!result.ok) {
    throw new StateMachineError(result.code, result.message);
  }
}

export function assertPhaseTransition(from: PhaseStatus, to: PhaseStatus): void {
  const result = canTransitionPhase(from, to);
  if (!result.ok) {
    throw new StateMachineError(result.code, result.message);
  }
}

export class StateMachineError extends Error {
  readonly code: TransitionResult["code"];
  constructor(code: TransitionResult["code"], message: string) {
    super(message);
    this.name = "StateMachineError";
    this.code = code;
  }
}

/**
 * Pure helper for the file-locks conflict check. Given a set of
 * already-active exclusive-lock paths and a list of paths a new task
 * wants to claim, return the conflicting paths. Used by the
 * orchestrator before dispatching.
 */
export function detectFileLockConflicts(
  activeExclusiveLocks: ReadonlyArray<string>,
  candidateFiles: ReadonlyArray<string>,
): { conflicts: string[]; clear: string[] } {
  const active = new Set(activeExclusiveLocks);
  const conflicts: string[] = [];
  const clear: string[] = [];
  for (const file of candidateFiles) {
    if (active.has(file)) conflicts.push(file);
    else clear.push(file);
  }
  return { conflicts, clear };
}

/**
 * Pure helper for the orchestrator's "is this task ready to dispatch"
 * gate. A task is dispatchable when:
 *   - status === "not_started"
 *   - every dependency task is in actual_passed OR closed
 *   - every file in `files_in_scope` is clear (no active exclusive lock)
 */
export function isTaskDispatchable(input: {
  status: TaskStatus;
  dependencies: ReadonlyArray<{ taskId: string; status: TaskStatus }>;
  filesInScope: ReadonlyArray<string>;
  activeExclusiveLocks: ReadonlyArray<string>;
}): { ready: boolean; blocking: string[] } {
  const blocking: string[] = [];
  if (input.status !== "not_started") {
    blocking.push(`status=${input.status}`);
    return { ready: false, blocking };
  }
  for (const dep of input.dependencies) {
    if (dep.status !== "actual_passed" && dep.status !== "closed") {
      blocking.push(`dependency=${dep.taskId}:${dep.status}`);
    }
  }
  const lockCheck = detectFileLockConflicts(input.activeExclusiveLocks, input.filesInScope);
  for (const file of lockCheck.conflicts) blocking.push(`file_lock=${file}`);
  return { ready: blocking.length === 0, blocking };
}