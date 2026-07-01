-- 0116: project_context — orchestrator's project-level memory
--
-- Phase 16 of doc/plans/2026-07-01-orchestrator-control-plane.md.
--
-- One row per company. Updated by the orchestrator at the end of every
-- tick. Read by every agent at heartbeat time so the team always
-- starts from the latest project state.
--
-- Distinct from `task_postmortems` (per-task, per-attempt learning) and
-- from `agent_runtime_state` (per-agent transient context). This is the
-- cross-team single source of truth for "where is the project right now".

CREATE TABLE IF NOT EXISTS "project_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"current_long_goal_id" uuid,
	"current_phase_id" uuid,
	"completed_features" jsonb,
	"partial_features" jsonb,
	"blocked_items" jsonb,
	"risks" jsonb,
	"key_decisions" jsonb,
	"stale_doc_paths" text,
	"verified_facts" jsonb,
	"investigated_conclusions" jsonb,
	"agent_collaboration_rules" jsonb,
	"next_priority" text,
	"updated_by_agent_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_context_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "project_context_current_long_goal_id_goals_id_fk" FOREIGN KEY ("current_long_goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "project_context_current_phase_id_phases_id_fk" FOREIGN KEY ("current_phase_id") REFERENCES "public"."phases"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "project_context_updated_by_agent_id_agents_id_fk" FOREIGN KEY ("updated_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint

CREATE UNIQUE INDEX "project_context_company_unique_idx" ON "project_context" USING btree ("company_id");
--> statement-breakpoint

CREATE INDEX "project_context_updated_at_idx" ON "project_context" USING btree ("updated_at");