import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { tasks } from "./tasks.js";

export const handoffs = pgTable(
  "handoffs",
  {
    id: text("id").primaryKey().notNull(),
    taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    artifactType: text("artifact_type").notNull(),
    artifactPath: text("artifact_path").notNull(),
    summary: text("summary"),
    contract: text("contract"),
    status: text("status").default("ready"),
    consumedBy: text("consumed_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => ({
    taskIdx: index("handoffs_task_idx").on(table.taskId),
    statusIdx: index("handoffs_status_idx").on(table.status),
  }),
);
