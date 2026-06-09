import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { goals } from "./goals.js";

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey().notNull(),
    goalId: uuid("goal_id").notNull().references(() => goals.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("todo"),
    priority: integer("priority").default(3),
    dependencies: text("dependencies"),
    requiredSkills: text("required_skills"),
    estimatedDuration: integer("estimated_duration"),
    assigneeAgentId: text("assignee_agent_id"),
    verificationCriteria: text("verification_criteria"),
    attempts: integer("attempts").default(0),
    maxAttempts: integer("max_attempts").default(3),
    verificationResult: text("verification_result"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    goalIdx: index("tasks_goal_idx").on(table.goalId),
    statusIdx: index("tasks_status_idx").on(table.status),
    assigneeAgentIdx: index("tasks_assignee_agent_idx").on(table.assigneeAgentId),
  }),
);
