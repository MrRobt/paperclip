import { sql } from "drizzle-orm";
import {
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

/**
 * Phase 11 of doc/plans/2026-06-30-self-solving-agent-team.md.
 *
 * One row per proposed change to a skill file. Eval suite is run twice
 * (baseline vs proposed) and the delta is persisted so the board can
 * approve only when the proposed version is at least as good as the
 * current one.
 */

export type SkillProposalStatus = "pending" | "evaluating" | "approved" | "denied" | "rolled_back";
export type SkillProposalInitiator = "agent" | "human";

export const SKILL_PROPOSAL_STATUSES: ReadonlyArray<SkillProposalStatus> = [
  "pending",
  "evaluating",
  "approved",
  "denied",
  "rolled_back",
];

export const skillProposals = pgTable(
  "skill_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Null when the proposal targets a global skill (e.g. an addition to
     * `catalog/bundled/`). Company-scoped proposals are scoped to that
     * company's instance.
     */
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    /** Path within the catalog repo, e.g. "bundled/quality/qa-acceptance". */
    skillPath: text("skill_path").notNull(),
    /** Unified diff of the proposed change. */
    proposedDiff: text("proposed_diff").notNull(),
    proposedByKind: text("proposed_by_kind").$type<SkillProposalInitiator>().notNull().default("agent"),
    proposedByAgentId: text("proposed_by_agent_id"),
    proposedByUserId: text("proposed_by_user_id"),
    /** 0.0–1.0. Null when eval hasn't been run yet. */
    baselineEvalPassRate: numeric("baseline_eval_pass_rate"),
    proposedEvalPassRate: numeric("proposed_eval_pass_rate"),
    /** proposedEvalPassRate − baselineEvalPassRate. Negative = regression. */
    evalDelta: numeric("eval_delta"),
    /** JSON array of case names that regressed in the proposed version. */
    regressions: text("regressions"),
    status: text("status").$type<SkillProposalStatus>().notNull().default("pending"),
    decidedByUserId: text("decided_by_user_id"),
    decisionNote: text("decision_note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("skill_proposals_company_status_idx").on(table.companyId, table.status),
    skillPathIdx: index("skill_proposals_skill_path_idx").on(table.skillPath),
    statusIdx: index("skill_proposals_status_idx").on(table.status),
  }),
);