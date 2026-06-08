import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

export type ControlPlaneLiveness = "healthy" | "suspicious" | "blocked" | "stalled";
export type ControlPlaneSeverity = "info" | "warning" | "critical";

export const controlPlaneDiagnosticSnapshots = pgTable(
  "control_plane_diagnostic_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    liveness: text("liveness").$type<ControlPlaneLiveness>().notNull(),
    severity: text("severity").$type<ControlPlaneSeverity>().notNull().default("info"),
    issueStatus: text("issue_status").notNull(),
    executionStatus: text("execution_status").notNull(),
    evidenceStatus: text("evidence_status").notNull(),
    recoveryStatus: text("recovery_status").notNull(),
    blockerStatus: text("blocker_status").notNull(),
    nextAction: text("next_action").notNull(),
    nextOwnerType: text("next_owner_type").notNull().default("system"),
    nextOwnerId: text("next_owner_id"),
    nextOwnerAgentId: uuid("next_owner_agent_id").references(() => agents.id, { onDelete: "set null" }),
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    source: text("source").notNull().default("control_plane_diagnostic"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyCreatedIdx: index("control_plane_diagnostic_snapshots_company_created_idx").on(
      table.companyId,
      table.createdAt,
    ),
    issueCreatedIdx: index("control_plane_diagnostic_snapshots_issue_created_idx").on(
      table.issueId,
      table.createdAt,
    ),
    companyLivenessIdx: index("control_plane_diagnostic_snapshots_company_liveness_idx").on(
      table.companyId,
      table.liveness,
      table.createdAt,
    ),
    companySeverityIdx: index("control_plane_diagnostic_snapshots_company_severity_idx").on(
      table.companyId,
      table.severity,
      table.createdAt,
    ),
  }),
);
