import { sql } from "drizzle-orm";
import {
  AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { goals } from "./goals.js";
import { phases } from "./phases.js";

/**
 * Phase 8 + 16 of doc/plans/2026-06-30-self-solving-agent-team.md and
 * doc/plans/2026-07-01-orchestrator-control-plane.md.
 *
 * 8-state task machine:
 *   not_started              ← initial
 *   in_progress              ← agent pulled + declared files
 *   blocked                  ← blocker detected
 *   code_landed_needs_runtime ← PR merged, awaiting runtime verification
 *   partial_runtime_passed   ← verification_spec partial pass
 *   actual_passed            ← verification_spec all passed + evidence_paths non-empty
 *   failed                   ← attempts exhausted; postmortem written
 *   closed                   ← board approval, archived
 *
 * Only `actual_passed` may transition to `closed`. Any other state
 * hitting `closed` is a state-machine violation surfaced via
 * services/orchestrator-state-machine.ts.
 */
export type TaskStatus =
  | "not_started"
  | "in_progress"
  | "blocked"
  | "code_landed_needs_runtime"
  | "partial_runtime_passed"
  | "actual_passed"
  | "failed"
  | "closed";

export const TASK_STATUSES: ReadonlyArray<TaskStatus> = [
  "not_started",
  "in_progress",
  "blocked",
  "code_landed_needs_runtime",
  "partial_runtime_passed",
  "actual_passed",
  "failed",
  "closed",
];

/**
 * Granular failure taxonomy. The orchestrator surfaces this on the
 * control plane so the operator can spot patterns ("3 of 10 failures
 * are `contract_drift` — need a contract-first sweep before continuing").
 */
export type TaskFailureStage =
  | "compile_failed"
  | "test_failed"
  | "runtime_failed"
  | "contract_drift"
  | "evidence_missing"
  | "agent_overrun"
  | "env_unavailable"
  | "unknown";

export const TASK_FAILURE_STAGES: ReadonlyArray<TaskFailureStage> = [
  "compile_failed",
  "test_failed",
  "runtime_failed",
  "contract_drift",
  "evidence_missing",
  "agent_overrun",
  "env_unavailable",
  "unknown",
];

/**
 * Structured verification checks. Each entry is one of the seven
 * supported check kinds (see `parseVerificationSpec` in
 * services/verification-runner.ts). Free-text 验收: descriptions are
 * intentionally rejected — the only way to declare a task done is to
 * produce a check whose exit code / probe result can be observed by
 * the verification-runner.
 *
 * `verification_criteria_legacy` is retained for one migration cycle
 * so historical data can be backfilled or read; new code must read
 * `verification_spec` only.
 */
export type TaskVerificationSpec = {
  checks: Array<
    | { kind: "run-tests"; command: string; cwd?: string; expectedExit: number; timeoutSec?: number }
    | { kind: "typecheck"; command: string; cwd?: string; expectedExit: number; timeoutSec?: number }
    | { kind: "lint"; command: string; cwd?: string; expectedExit: number; timeoutSec?: number }
    | { kind: "build"; command: string; cwd?: string; expectedExit: number; timeoutSec?: number }
    | { kind: "file-exists"; path: string }
    | { kind: "http-probe"; method: "GET" | "POST" | "PUT" | "DELETE"; url: string; expectStatus: number; expectBodyContains?: string; timeoutSec?: number }
    | { kind: "custom-exit-zero"; command: string; cwd?: string; timeoutSec?: number }
  >;
  rationale?: string;
};

/**
 * Phase 16: human-readable Definition of Done. Complementary to
 * `verification_spec` (machine-verifiable). Both are required for a
 * task to transition to `actual_passed`.
 */
export type TaskAcceptanceCriteria = {
  /** Each bullet must be a verifiable, single-statement criterion. */
  bullets: string[];
  /** Why these bullets together prove the task is done. */
  rationale?: string;
};

/**
 * Phase 16: structured inputs / outputs at task granularity.
 * `inputs` lists upstream task ids, handoff ids, and external URLs the
 * agent needs. `outputs` lists files / API endpoints / docs produced.
 */
export type TaskIOMap = {
  inputs: Array<{ kind: "task" | "handoff" | "url" | "file"; ref: string; note?: string }>;
  outputs: Array<{ kind: "file" | "endpoint" | "doc" | "table" | "skill"; ref: string; note?: string }>;
};

/**
 * Retry policy attached at task granularity. The orchestrator reads
 * this when re-dispatching after a failure. `fallbackTaskId` is the
 * task that takes over when this one is permanently killed.
 */
export type TaskRetryStrategy = {
  backoffSec: number;
  maxAttempts: number;
  fallbackTaskId?: string;
};

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey().notNull(),
    goalId: uuid("goal_id").notNull().references(() => goals.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    /**
     * 8-state machine column. Defaults to `not_started`. Transitions are
     * enforced by services/orchestrator-state-machine.ts; raw UPDATEs
     * to this column are allowed for migration scripts only.
     */
    status: text("status").$type<TaskStatus>().notNull().default("not_started"),
    priority: integer("priority").default(3),
    dependencies: text("dependencies"),
    requiredSkills: text("required_skills"),
    estimatedDuration: integer("estimated_duration"),
    assigneeAgentId: text("assignee_agent_id"),
    /**
     * @deprecated Retained for backfill; new code reads `verification_spec`.
     * Will be dropped in migration 0120.
     */
    verificationCriteria: text("verification_criteria"),
    /**
     * Phase 8: structured verification checks. Source of truth for
     * whether a task is done — the LLM verify prompt can only interpret,
     * never override, the result of running these checks.
     */
    verificationSpec: jsonb("verification_spec").$type<TaskVerificationSpec>(),
    attempts: integer("attempts").default(0),
    maxAttempts: integer("max_attempts").default(3),
    /**
     * @deprecated Replaced by `task_verifications` rows; kept for one
     * migration cycle for backward reads.
     */
    verificationResult: text("verification_result"),
    // ---------- Phase 16 structured template ----------
    /** Single-sentence goal for this task. Required for new tasks. */
    objective: text("objective"),
    /** Bullet list of things the task must NOT do. */
    nonObjectives: text("non_objectives"),
    /** Inputs (upstream task ids, handoffs, urls, files). */
    inputs: jsonb("inputs").$type<TaskIOMap>(),
    /** Outputs (files, endpoints, docs, tables, skills). */
    outputs: jsonb("outputs").$type<TaskIOMap>(),
    /** File paths the task may modify — drives file_locks.acquire. */
    filesInScope: text("files_in_scope"),
    /** File paths the task must NOT modify — touching them triggers orchestrator approval. */
    filesOutOfScope: text("files_out_of_scope"),
    /** Human-readable Definition of Done. Required alongside verification_spec for actual_passed. */
    acceptanceCriteria: jsonb("acceptance_criteria").$type<TaskAcceptanceCriteria>(),
    /** Paths to artefacts that prove actual_passed (screenshots, logs, curl outputs). */
    evidencePaths: text("evidence_paths"),
    /** Board-readable summary of the evidence bundle. */
    evidenceSummary: text("evidence_summary"),
    /** Agent id that should receive the handoff when this task closes. */
    downstreamOwnerAgentId: uuid("downstream_owner_agent_id").references(() => agents.id, { onDelete: "set null" }),
    /** Phase this task belongs to (Phase 16 three-level goal tree). */
    phaseId: uuid("phase_id").references((): AnyPgColumn => phases.id, { onDelete: "set null" }),
    /** Granular failure taxonomy. Set by verification-runner / monitor on failure. */
    failureStage: text("failure_stage").$type<TaskFailureStage>(),
    /** Retry policy override; falls back to attempts/maxAttempts when null. */
    retryStrategy: jsonb("retry_strategy").$type<TaskRetryStrategy>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    goalIdx: index("tasks_goal_idx").on(table.goalId),
    statusIdx: index("tasks_status_idx").on(table.status),
    assigneeAgentIdx: index("tasks_assignee_agent_idx").on(table.assigneeAgentId),
    /**
     * Partial index for scheduler hot path: find tasks ready to be
     * dispatched (status='not_started') within a goal.
     */
    goalStatusIdx: index("tasks_goal_status_idx").on(table.goalId, table.status),
    /** Orchestrator hot path: phase + status rollups. */
    phaseStatusIdx: index("tasks_phase_status_idx").on(table.phaseId, table.status),
    /** Orchestrator hot path: per-agent workload by status. */
    ownerStatusIdx: index("tasks_owner_status_idx").on(table.assigneeAgentId, table.status),
    /** Operator dashboard: failures by stage. */
    failureStageIdx: index("tasks_failure_stage_idx").on(table.failureStage),
  }),
);