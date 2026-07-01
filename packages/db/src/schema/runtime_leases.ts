import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { tasks } from "./tasks.js";

/**
 * Phase 16 of doc/plans/2026-07-01-orchestrator-control-plane.md.
 *
 * Renamed from `environment_leases` to avoid colliding with the existing
 * paperclip `environment_leases` table (which tracks paperclip
 * environments, a different concept). This table tracks TASK-LEVEL
 * runtime occupancy: who is holding port X, PID Y, command Z.
 *
 * Prevents the "Agent A kills Agent B's process to free port 3100"
 * failure mode (collaboration pitfall #9). The orchestrator checks
 * for conflicts before dispatch and refuses to start a second task
 * against a held port/PID.
 */
export type RuntimeLeaseStatus = "active" | "released" | "expired" | "force-killed";
export type RuntimeEnvironmentKind = "local" | "docker" | "k8s" | "sandbox";

export const RUNTIME_LEASE_STATUSES: ReadonlyArray<RuntimeLeaseStatus> = [
  "active",
  "released",
  "expired",
  "force-killed",
];

export const runtimeLeases = pgTable(
  "runtime_leases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    /** "local" = host process, "docker" = container, "k8s" = pod, "sandbox" = provider. */
    environment: text("environment").notNull(),
    /** Network port the agent is holding (nullable for headless tasks). */
    port: integer("port"),
    /** OS PID. Nullable for k8s / sandbox (no host PID). */
    pid: integer("pid"),
    /** Command line that was launched. */
    command: text("command"),
    /** Absolute path to the log file. */
    logPath: text("log_path"),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Auto-release deadline. Default 24h after acquiredAt. The orchestrator
     * sweeps expired leases on every tick.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    status: text("status").$type<RuntimeLeaseStatus>().notNull().default("active"),
    /** Required when status="force-killed"; the orchestrator refuses to force-kill without a reason logged here. */
    killReason: text("kill_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("runtime_leases_company_status_idx").on(table.companyId, table.status),
    portIdx: index("runtime_leases_port_idx").on(table.port).where(sql`${table.port} IS NOT NULL`),
    expiresIdx: index("runtime_leases_expires_idx").on(table.expiresAt).where(sql`${table.status} = 'active'`),
    taskIdx: index("runtime_leases_task_idx").on(table.taskId),
  }),
);