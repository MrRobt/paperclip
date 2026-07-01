import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { goals } from "./goals.js";
import { phases } from "./phases.js";

/**
 * Phase 16 of doc/plans/2026-07-01-orchestrator-control-plane.md.
 *
 * One row per company. The orchestrator maintains this; every agent
 * reads it on heartbeat. It is the cross-team source of truth for
 * "where is the project right now" — distinct from per-task
 * postmortems and per-agent runtime state.
 */

export type ProjectContextFeatureEntry = {
  name: string;
  /** "shipped" | "partial" | "planned" — the orchestrator sets this. */
  status: "shipped" | "partial" | "planned";
  /** Evidence paths proving this status (links to PRs, screenshots, dashboards). */
  evidencePaths?: string[];
  /** Last touched timestamp (ISO 8601). */
  updatedAt?: string;
  /** Free-form note for the next reader. */
  note?: string;
};

export type ProjectContextBlockedItem = {
  taskId: string;
  title: string;
  ownerAgentId: string | null;
  since: string;            // ISO 8601
  reason: string;
  unblockCriteria: string;  // what must be true to unblock
  /** "hard" | "soft" | "notice" — mirrors issue_blocker_policies.level. */
  level: "hard" | "soft" | "notice";
};

export type ProjectContextRisk = {
  module: string;            // file path or subsystem
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  mitigation?: string;
};

export type ProjectContextDecision = {
  date: string;              // ISO 8601
  decision: string;
  madeByAgentId: string | null;
  alternativesConsidered?: string[];
  rationale?: string;
};

export type ProjectContextVerifiedFact = {
  fact: string;
  verifiedAt: string;
  verifiedByAgentId: string | null;
  evidencePath?: string;     // log line, screenshot, etc.
};

export type ProjectContextInvestigatedConclusion = {
  question: string;
  conclusion: string;
  investigatedAt: string;
  investigatedByAgentId: string | null;
  stillValid: boolean;        // orchestrator invalidates if new evidence surfaces
};

export const projectContext = pgTable(
  "project_context",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    /** Top-level strategic objective the team is currently pursuing. */
    currentLongGoalId: uuid("current_long_goal_id").references(() => goals.id, { onDelete: "set null" }),
    /** Phase within the current long-goal that the team is in. */
    currentPhaseId: uuid("current_phase_id").references(() => phases.id, { onDelete: "set null" }),
    /** Features shipped to a verified passing state (orchestrator-curated). */
    completedFeatures: jsonb("completed_features").$type<ProjectContextFeatureEntry[]>(),
    /** Features partially built but not yet verified end-to-end. */
    partialFeatures: jsonb("partial_features").$type<ProjectContextFeatureEntry[]>(),
    /** Active blockers — mirrors and supersedes per-task blocker notes. */
    blockedItems: jsonb("blocked_items").$type<ProjectContextBlockedItem[]>(),
    /** Module-level risks the orchestrator wants the team to be aware of. */
    risks: jsonb("risks").$type<ProjectContextRisk[]>(),
    /** Architectural decisions and their rationale (replaces ad-hoc Slack threads). */
    keyDecisions: jsonb("key_decisions").$type<ProjectContextDecision[]>(),
    /**
     * Paths under doc/ or ui/ that the team has outgrown and should
     * refresh. Surfaced on the orchestrator control plane.
     */
    staleDocPaths: text("stale_doc_paths"),
    /**
     * Facts the orchestrator has verified via execution evidence, so
     * subsequent agents do not re-verify. Mirrors collaboration
     * pitfall #11 (duplicate labour).
     */
    verifiedFacts: jsonb("verified_facts").$type<ProjectContextVerifiedFact[]>(),
    /**
     * Conclusions from investigation threads that subsequent agents
     * should respect unless new evidence surfaces.
     */
    investigatedConclusions: jsonb("investigated_conclusions").$type<ProjectContextInvestigatedConclusion[]>(),
    /**
     * Cross-team collaboration rules (e.g. "every public API change
     * must publish an interface_contracts row before merge").
     */
    agentCollaborationRules: jsonb("agent_collaboration_rules"),
    /**
     * Free-text priority for the next dispatch — the operator can
     * override the orchestrator's auto-priority here.
     */
    nextPriority: text("next_priority"),
    updatedByAgentId: uuid("updated_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyUniqueIdx: uniqueIndex("project_context_company_unique_idx").on(table.companyId),
    updatedAtIdx: index("project_context_updated_at_idx").on(table.updatedAt),
  }),
);