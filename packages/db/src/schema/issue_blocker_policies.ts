import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

export type IssueBlockerPolicyLevel = "hard" | "soft" | "notice";

export const issueBlockerPolicies = pgTable(
  "issue_blocker_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    blockerIssueId: uuid("blocker_issue_id").references(() => issues.id, { onDelete: "set null" }),
    level: text("level").$type<IssueBlockerPolicyLevel>().notNull().default("hard"),
    status: text("status").notNull().default("active"),
    reason: text("reason").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdByActorType: text("created_by_actor_type").notNull().default("system"),
    createdByActorId: text("created_by_actor_id"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    downgradedAt: timestamp("downgraded_at", { withTimezone: true }),
    downgradedByUserId: text("downgraded_by_user_id"),
    downgradedByAgentId: uuid("downgraded_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    downgradeReason: text("downgrade_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIssueStatusIdx: index("issue_blocker_policies_company_issue_status_idx").on(
      table.companyId,
      table.issueId,
      table.status,
    ),
    companyBlockerIdx: index("issue_blocker_policies_company_blocker_idx").on(
      table.companyId,
      table.blockerIssueId,
    ),
    companyLevelStatusIdx: index("issue_blocker_policies_company_level_status_idx").on(
      table.companyId,
      table.level,
      table.status,
    ),
  }),
);
