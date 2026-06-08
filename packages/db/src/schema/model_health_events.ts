import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

export type ModelHealthEventType =
  | "adapter_error"
  | "model_error"
  | "timeout"
  | "rate_limited"
  | "budget_stopped"
  | "fallback_selected"
  | "probe_result";

export const modelHealthEvents = pgTable(
  "model_health_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    adapterType: text("adapter_type").notNull(),
    modelId: text("model_id"),
    eventType: text("event_type").$type<ModelHealthEventType>().notNull(),
    errorKind: text("error_kind"),
    latencyMs: integer("latency_ms"),
    retryAttempt: integer("retry_attempt").notNull().default(0),
    fallbackApplied: boolean("fallback_applied").notNull().default(false),
    fallbackAdapterType: text("fallback_adapter_type"),
    fallbackModelId: text("fallback_model_id"),
    errorSummary: text("error_summary"),
    rawErrorExcerpt: text("raw_error_excerpt"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyCreatedIdx: index("model_health_events_company_created_idx").on(table.companyId, table.createdAt),
    companyAgentCreatedIdx: index("model_health_events_company_agent_created_idx").on(
      table.companyId,
      table.agentId,
      table.createdAt,
    ),
    companyAdapterModelIdx: index("model_health_events_company_adapter_model_idx").on(
      table.companyId,
      table.adapterType,
      table.modelId,
      table.createdAt,
    ),
    runIdx: index("model_health_events_run_idx").on(table.runId),
    eventTypeIdx: index("model_health_events_company_event_type_idx").on(
      table.companyId,
      table.eventType,
      table.createdAt,
    ),
  }),
);
