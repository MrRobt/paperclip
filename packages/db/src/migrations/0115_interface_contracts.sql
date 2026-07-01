-- 0115: interface_contracts — versioned contract registry
--
-- Phase 16 of doc/plans/2026-07-01-orchestrator-control-plane.md.
--
-- A contract is anything a downstream consumer can rely on:
--   http-route  — OpenAPI snippet for a REST endpoint
--   rpc         — gRPC / JSON-RPC method signature
--   cli         — command-line interface (subcommand, args, output schema)
--   data-schema — zod / TypeScript type / DB table schema
--
-- Lifecycle:
--   draft       — owner is editing; consumers must NOT pin to this version
--   published   — consumers may pin; consumers[] list updated
--   deprecated  — new consumers forbidden; existing consumers given grace period
--
-- The (name, version) UNIQUE index lets the orchestrator detect when a
-- task is editing a published contract and force the "spec first, code
-- second" workflow (collaboration pitfall #7: contract drift).

CREATE TABLE IF NOT EXISTS "interface_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL DEFAULT '1.0.0',
	"contract_kind" text NOT NULL,
	"schema_json" jsonb NOT NULL,
	"owner_agent_id" uuid,
	"status" text NOT NULL DEFAULT 'draft',
	"consumers" text,
	"change_summary" text,
	"published_at" timestamp with time zone,
	"deprecated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interface_contracts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "interface_contracts_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "interface_contracts_contract_kind_check" CHECK ("contract_kind" IN ('http-route', 'rpc', 'cli', 'data-schema', 'event-bus')),
	CONSTRAINT "interface_contracts_status_check" CHECK ("status" IN ('draft', 'published', 'deprecated'))
);
--> statement-breakpoint

CREATE UNIQUE INDEX "interface_contracts_name_version_unique_idx" ON "interface_contracts" USING btree ("name","version");
--> statement-breakpoint

CREATE INDEX "interface_contracts_company_name_idx" ON "interface_contracts" USING btree ("company_id","name");
--> statement-breakpoint

CREATE INDEX "interface_contracts_company_status_idx" ON "interface_contracts" USING btree ("company_id","status");