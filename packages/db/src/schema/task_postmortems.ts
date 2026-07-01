import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { goals } from "./goals.js";
import { tasks } from "./tasks.js";

/**
 * Phase 10 of doc/plans/2026-06-30-self-solving-agent-team.md.
 *
 * One row per Legion task attempt that completed (passed OR failed). The
 * goal-decomposer reads recent rows from the same `(company, repo,
 * module)` triple when planning new goals so the LLM has few-shot
 * context for what worked and what didn't.
 *
 * `files_touched` and `lessons` are stored as JSON-encoded text to keep
 * the schema simple — they're read by humans reviewing history, not by
 * hot-path queries.
 */
export type RootCauseClass = "logic" | "env" | "tool" | "flaky" | "ambiguity" | "unknown";

export const ROOT_CAUSE_CLASSES: ReadonlyArray<RootCauseClass> = [
  "logic",
  "env",
  "tool",
  "flaky",
  "ambiguity",
  "unknown",
];

export const taskPostmortems = pgTable(
  "task_postmortems",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
    repoPath: text("repo_path"),
    modulePath: text("module_path"),
    rootCauseClass: text("root_cause_class").$type<RootCauseClass>().notNull().default("unknown"),
    fixSummary: text("fix_summary").notNull(),
    commitHash: text("commit_hash"),
    branchName: text("branch_name"),
    prUrl: text("pr_url"),
    filesTouched: text("files_touched"),
    lessons: text("lessons"),
    attemptNumber: integer("attempt_number").default(1),
    passed: boolean("passed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyRepoModuleIdx: index("task_postmortems_company_repo_module_idx").on(
      table.companyId,
      table.repoPath,
      table.modulePath,
      table.createdAt,
    ),
    companyRecentIdx: index("task_postmortems_company_recent_idx").on(table.companyId, table.createdAt),
    rootCauseIdx: index("task_postmortems_root_cause_idx").on(table.rootCauseClass),
  }),
);