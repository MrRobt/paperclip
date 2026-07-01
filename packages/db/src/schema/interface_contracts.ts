import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";

/**
 * Phase 16 of doc/plans/2026-07-01-orchestrator-control-plane.md.
 *
 * Versioned registry of every interface a downstream consumer can
 * rely on. Each contract has a stable (name, version) pair; bumping
 * the version forces consumers to opt in to the new shape.
 */
export type InterfaceContractKind = "http-route" | "rpc" | "cli" | "data-schema" | "event-bus";
export type InterfaceContractStatus = "draft" | "published" | "deprecated";

export const INTERFACE_CONTRACT_KINDS: ReadonlyArray<InterfaceContractKind> = [
  "http-route",
  "rpc",
  "cli",
  "data-schema",
  "event-bus",
];

export const INTERFACE_CONTRACT_STATUSES: ReadonlyArray<InterfaceContractStatus> = [
  "draft",
  "published",
  "deprecated",
];

export const interfaceContracts = pgTable(
  "interface_contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    /** Stable identifier, e.g. "POST /api/auth/login" or "users.create". */
    name: text("name").notNull(),
    /** SemVer-style: 1.0.0, 1.1.0, 2.0.0-rc.1 — anything the consumer can pin against. */
    version: text("version").notNull().default("1.0.0"),
    contractKind: text("contract_kind").$type<InterfaceContractKind>().notNull(),
    /**
     * The actual schema: OpenAPI snippet for http-route, zod schema
     * (serialised) for data-schema, command grammar for cli, etc.
     * Shape is intentionally free-form so each kind can carry its own
     * dialect.
     */
    schemaJson: jsonb("schema_json").notNull(),
    ownerAgentId: uuid("owner_agent_id").references(() => agents.id, { onDelete: "set null" }),
    status: text("status").$type<InterfaceContractStatus>().notNull().default("draft"),
    /**
     * Comma-separated list of consumer identifiers (agent ids, repo
     * paths, service names) that have pinned to this version. Used by
     * the orchestrator's contract-drift detector: if a published
     * contract is updated without a new version, consumers that pin
     * to it get a stale read.
     */
    consumers: text("consumers"),
    changeSummary: text("change_summary"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    deprecatedAt: timestamp("deprecated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    nameVersionUniqueIdx: uniqueIndex("interface_contracts_name_version_unique_idx").on(table.name, table.version),
    companyNameIdx: index("interface_contracts_company_name_idx").on(table.companyId, table.name),
    companyStatusIdx: index("interface_contracts_company_status_idx").on(table.companyId, table.status),
  }),
);