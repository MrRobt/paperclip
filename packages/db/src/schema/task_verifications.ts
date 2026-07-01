import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tasks } from "./tasks.js";

/**
 * One row per `paperclipai verify <taskId>` invocation. Multiple rows per
 * task are expected — one per attempt (1, 2, 3, ... up to max_attempts).
 *
 * `evidence` is the structured output of the verification-runner: exit
 * codes, command output tails, durations. `llm_summary` is the optional
 * LLM interpretation of that evidence, but it MUST NOT override the
 * boolean derived from exit codes — see `verification-runner.ts`.
 */
export type TaskVerificationEvidence = {
  /** Per-check results. */
  checks: Array<{
    kind: string;
    command?: string;
    cwd?: string;
    path?: string;
    method?: string;
    url?: string;
    passed: boolean;
    exitCode: number | null;
    stdoutTail: string;
    stderrTail: string;
    durationMs: number;
    errorMessage?: string;
  }>;
  /** Aggregate derived from the checks above. Persisted so retries don't re-derive. */
  hardPassed: boolean;
  /** Wall-clock total for the whole verify invocation. */
  totalDurationMs: number;
};

export type TaskVerificationSummary = {
  passed: boolean;
  /** Required when hardPassed=false; one sentence per failing check. */
  summary: string;
  /** Required when hardPassed=false; precise issues for retry context. */
  issues: string[];
};

export const taskVerifications = pgTable(
  "task_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    /** 1-based attempt counter; ties to `tasks.attempts` at the time of run. */
    attemptNumber: integer("attempt_number").notNull(),
    /** Raw evidence from the verification-runner. Source of truth. */
    evidence: jsonb("evidence").$type<TaskVerificationEvidence>().notNull(),
    /** LLM interpretation. Null when the runner short-circuited on hard failure. */
    llmSummary: jsonb("llm_summary").$type<TaskVerificationSummary>(),
    /**
     * Persisted aggregate of `evidence.hardPassed` so retries don't need
     * to re-parse JSON. The verify route enforces this never contradicts
     * the evidence.
     */
    passed: boolean("passed").notNull(),
    /** Truncated free-form notes for board review / replay. */
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    taskAttemptIdx: index("task_verifications_task_attempt_idx").on(
      table.taskId,
      table.attemptNumber,
    ),
    /** Latest-first lookup for retry-with-context: WHERE task_id = ? ORDER BY created_at DESC LIMIT 1 */
    taskCreatedIdx: index("task_verifications_task_created_idx").on(table.taskId, table.createdAt),
  }),
);