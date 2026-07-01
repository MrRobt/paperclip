-- 0118: orchestrator_runs — main control loop audit trail
--
-- Phase 16 of doc/plans/2026-07-01-orchestrator-control-plane.md.
--
-- One row per orchestrator tick (or a longer multi-tick run during
-- board escalation). The orchestrator writes its full 8-section JSON
-- output here so the UI can render "主控协调日志" and operators can
-- audit "why was task X dispatched to agent Y at time Z".
--
-- `daily_report` is the markdown-formatted end-of-day report when the
-- orchestrator runs a "daily" sweep (configurable cadence; default
-- once per orchestrator run that crosses midnight UTC).

CREATE TABLE IF NOT EXISTS "orchestrator_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"orchestrator_agent_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"trigger_kind" text NOT NULL DEFAULT 'manual',
	"status" text NOT NULL DEFAULT 'running',
	"decisions" jsonb,
	"dispatches" jsonb,
	"file_lock_actions" jsonb,
	"context_snapshot" jsonb,
	"daily_report" text,
	"summary" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orchestrator_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "orchestrator_runs_orchestrator_agent_id_agents_id_fk" FOREIGN KEY ("orchestrator_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "orchestrator_runs_trigger_kind_check" CHECK ("trigger_kind" IN ('manual', 'scheduled', 'event', 'escalation')),
	CONSTRAINT "orchestrator_runs_status_check" CHECK ("status" IN ('running', 'succeeded', 'failed', 'escalated'))
);
--> statement-breakpoint

CREATE INDEX "orchestrator_runs_company_started_idx" ON "orchestrator_runs" USING btree ("company_id","started_at");
--> statement-breakpoint

CREATE INDEX "orchestrator_runs_status_idx" ON "orchestrator_runs" USING btree ("status");