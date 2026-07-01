import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { tasks } from "./tasks.js";

/**
 * Phase 16 of doc/plans/2026-07-01-orchestrator-control-plane.md.
 *
 * File-level lock acquired by the orchestrator before dispatching a
 * task. The active partial unique index guarantees at most one
 * exclusive lock per file path; conflict detection runs as part of
 * every `orchestrator.tick`.
 */
export type FileLockType = "exclusive" | "shared";

export const FILE_LOCK_TYPES: ReadonlyArray<FileLockType> = ["exclusive", "shared"];

export const fileLocks = pgTable(
  "file_locks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    lockType: text("lock_type").$type<FileLockType>().notNull().default("exclusive"),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Auto-release deadline. The orchestrator expires stale locks on
     * each tick (default 24h after acquiredAt). Tasks that overrun the
     * deadline get a `failure_stage=agent_overrun` postmortem and the
     * lock is released for re-acquisition by another task.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    /**
     * Why the lock was released: "completed" (task closed), "expired"
     * (deadline passed), "force_released" (orchestrator override),
     * "conflict_resolution" (another task won the arbitration).
     */
    releaseReason: text("release_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    activeExclusiveUniqueIdx: uniqueIndex("file_locks_active_exclusive_unique_idx")
      .on(table.filePath)
      .where(sql`${table.releasedAt} IS NULL AND ${table.lockType} = 'exclusive'`),
    taskIdx: index("file_locks_task_idx").on(table.taskId),
    agentIdx: index("file_locks_agent_idx").on(table.agentId),
    activeIdx: index("file_locks_active_idx").on(table.filePath).where(sql`${table.releasedAt} IS NULL`),
  }),
);