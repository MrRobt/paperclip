import {
  type AnyPgColumn,
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  integer,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { phases } from "./phases.js";

/**
 * Phase 9: typed enum for goal status transitions. Persisted as `text`
 * (the `goalStatus` column); this type is consumed by goal-progress.ts
 * and downstream UI code that needs to render status without reaching
 * into raw string literals.
 */
export type GoalStatus =
  | "planning"
  | "executing"
  | "verifying"
  | "completed"
  | "failed";

export const GOAL_STATUSES: ReadonlyArray<GoalStatus> = [
  "planning",
  "executing",
  "verifying",
  "completed",
  "failed",
];

export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    title: text("title").notNull(),
    description: text("description"),
    level: text("level").notNull().default("task"),
    status: text("status").notNull().default("planned"),
    parentId: uuid("parent_id").references((): AnyPgColumn => goals.id),
    parentGoalId: uuid("parent_goal_id").references((): AnyPgColumn => goals.id, { onDelete: "set null" }),
    /**
     * Phase 16: when a goal is a mini-goal nested under a phase, this
     * column points at the phase row. Long goals (top of the tree) leave
     * this null. Combined with `parentGoalId`, the goal hierarchy reads:
     *   long_goal: parentGoalId=null, parentPhaseId=null
     *   mini_goal: parentPhaseId=phase.id
     *   sub_goal: parentGoalId=long_goal.id (deprecated; use parent_phase)
     */
    parentPhaseId: uuid("parent_phase_id").references((): AnyPgColumn => phases.id, { onDelete: "set null" }),
    totalTasks: integer("total_tasks").default(0),
    completedTasks: integer("completed_tasks").default(0),
    goalStatus: text("goal_status").default("planning"),
    ownerAgentId: uuid("owner_agent_id").references(() => agents.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("goals_company_idx").on(table.companyId),
  }),
);
