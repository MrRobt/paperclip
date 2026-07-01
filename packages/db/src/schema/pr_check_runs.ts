import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { tasks } from "./tasks.js";

/**
 * `gh pr checks --json state` returns one of these values per check. Mirrored
 * here so the legion-ci-watcher can `enum`-validate before persisting.
 */
export type PrCheckStatus = "pending" | "success" | "failure" | "cancelled" | "skipped";

/**
 * GitHub's overall conclusion — slightly different from `status` (e.g. a
 * `success`-status check can still end in `action_required` conclusion).
 */
export type PrCheckConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | "stale";

export const prCheckRuns = pgTable(
  "pr_check_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    prUrl: text("pr_url").notNull(),
    prNumber: integer("pr_number").notNull(),
    checkName: text("check_name").notNull(),
    status: text("status").$type<PrCheckStatus>().notNull().default("pending"),
    conclusion: text("conclusion").$type<PrCheckConclusion>(),
    htmlUrl: text("html_url"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /**
     * Raw `gh pr checks --json` row, kept so future schema drift in `gh`
     * doesn't break downstream consumers — they can always re-derive.
     */
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /**
     * One row per (PR, check_name). Upsert key for the watcher.
     */
    prCheckUniqueIdx: uniqueIndex("pr_check_runs_pr_check_unique_idx").on(table.prUrl, table.checkName),
    taskIdx: index("pr_check_runs_task_idx").on(table.taskId),
    statusIdx: index("pr_check_runs_status_idx").on(table.status),
  }),
);