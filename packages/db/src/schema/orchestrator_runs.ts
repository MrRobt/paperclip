import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";

/**
 * Phase 16 of doc/plans/2026-07-01-orchestrator-control-plane.md.
 *
 * One row per orchestrator tick. The orchestrator writes its full
 * 8-section JSON output here so the UI can render "主控协调日志"
 * and operators can audit "why was task X dispatched to agent Y at
 * time Z".
 */

export type OrchestratorTriggerKind = "manual" | "scheduled" | "event" | "escalation";
export type OrchestratorRunStatus = "running" | "succeeded" | "failed" | "escalated";

export const ORCHESTRATOR_TRIGGER_KINDS: ReadonlyArray<OrchestratorTriggerKind> = [
  "manual",
  "scheduled",
  "event",
  "escalation",
];

export const ORCHESTRATOR_RUN_STATUSES: ReadonlyArray<OrchestratorRunStatus> = [
  "running",
  "succeeded",
  "failed",
  "escalated",
];

export type OrchestratorDecisionType =
  | "block"
  | "unblock"
  | "reassign"
  | "escalate"
  | "force_close"
  | "acquire_lock"
  | "release_lock"
  | "dispatch"
  | "abort";

export type OrchestratorDecision = {
  type: OrchestratorDecisionType;
  subject: string;            // taskId / agentId / filePath / phaseId
  reason: string;
  ts: string;                // ISO 8601
  /** Free-form structured payload (e.g. for force_close: the evidence summary). */
  payload?: Record<string, unknown>;
};

export type OrchestratorDispatch = {
  taskId: string;
  agentId: string;
  ts: string;
  reason: string;
};

export type OrchestratorFileLockAction = {
  action: "acquire" | "release";
  filePath: string;
  taskId: string;
  agentId: string;
  ts: string;
  lockType: "exclusive" | "shared";
};

export const orchestratorRuns = pgTable(
  "orchestrator_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    orchestratorAgentId: uuid("orchestrator_agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    triggerKind: text("trigger_kind").$type<OrchestratorTriggerKind>().notNull().default("manual"),
    status: text("status").$type<OrchestratorRunStatus>().notNull().default("running"),
    /**
     * Full 8-section output of the orchestrator tick, JSON-encoded:
     *   currentLongGoal, currentPhase, completedTasks, partialTasks,
     *   blockedTasks, readyToDispatch, fileConflicts, contextUpdates, nextDispatch.
     */
    decisions: jsonb("decisions").$type<OrchestratorDecision[]>(),
    dispatches: jsonb("dispatches").$type<OrchestratorDispatch[]>(),
    fileLockActions: jsonb("file_lock_actions").$type<OrchestratorFileLockAction[]>(),
    /**
     * Snapshot of project_context at the start of this run. Lets the
     * UI render "what did the orchestrator see when it made decision X".
     */
    contextSnapshot: jsonb("context_snapshot"),
    /** Markdown-formatted end-of-day report (only set when the run crosses midnight UTC). */
    dailyReport: text("daily_report"),
    /** One-paragraph summary shown on the orchestrator dashboard. */
    summary: text("summary"),
    /** Populated when status="failed". */
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStartedIdx: index("orchestrator_runs_company_started_idx").on(table.companyId, table.startedAt),
    statusIdx: index("orchestrator_runs_status_idx").on(table.status),
  }),
);