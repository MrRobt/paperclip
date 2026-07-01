import { sql } from "drizzle-orm";
import {
  AnyPgColumn,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { goals } from "./goals.js";

/**
 * Phase 16 of doc/plans/2026-07-01-orchestrator-control-plane.md.
 *
 * Three-level goal tree:
 *   long_goal (goals.id)        ← strategic objective, spans quarters
 *     phase (phases.id)         ← 1–2 week milestone
 *       mini_goal (goals.id, with parent_phase_id)  ← 3–5 day deliverable
 *         task (tasks.id, with phase_id)            ← 0.5–2 day unit
 *
 * Status mirrors the task state machine so the orchestrator can apply
 * the same transition rules at phase granularity.
 */
export type PhaseStatus =
  | "not_started"
  | "in_progress"
  | "blocked"
  | "code_landed_needs_runtime"
  | "partial_runtime_passed"
  | "actual_passed"
  | "failed"
  | "closed";

export const PHASE_STATUSES: ReadonlyArray<PhaseStatus> = [
  "not_started",
  "in_progress",
  "blocked",
  "code_landed_needs_runtime",
  "partial_runtime_passed",
  "actual_passed",
  "failed",
  "closed",
];

export const phases = pgTable(
  "phases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    /** Top-level strategic objective. May be null when a phase is ad-hoc (no long_goal). */
    longGoalId: uuid("long_goal_id").references((): AnyPgColumn => goals.id, { onDelete: "set null" }),
    /** Self-reference for nested phases (e.g. research → design → build within one quarter). */
    parentPhaseId: uuid("parent_phase_id").references((): AnyPgColumn => phases.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    /**
     * Order within a long_goal: 0-based display sequence. Multiple phases
     * may share a sequence (parallel work); the orchestrator interprets
     * equal sequence as "can run concurrently".
     */
    sequence: integer("sequence").notNull().default(0),
    status: text("status").$type<PhaseStatus>().notNull().default("not_started"),
    plannedStart: date("planned_start"),
    plannedEnd: date("planned_end"),
    actualStart: timestamp("actual_start", { withTimezone: true }),
    actualEnd: timestamp("actual_end", { withTimezone: true }),
    ownerAgentId: uuid("owner_agent_id").references(() => agents.id, { onDelete: "set null" }),
    description: text("description"),
    /**
     * Free-text Definition of Done at phase granularity. Mirrors
     * `tasks.acceptance_criteria` but at a higher abstraction. Examples:
     * "all P0 tasks actual_passed", "RFC signed off by 2 board members".
     */
    exitCriteria: text("exit_criteria"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyLongGoalIdx: index("phases_company_long_goal_idx").on(table.companyId, table.longGoalId, table.sequence),
    companyStatusIdx: index("phases_company_status_idx").on(table.companyId, table.status),
    parentPhaseIdx: index("phases_parent_phase_idx").on(table.parentPhaseId),
  }),
);