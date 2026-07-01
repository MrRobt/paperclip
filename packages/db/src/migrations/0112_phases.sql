-- 0112: phases — long-goal / phase / mini-goal / task decomposition
--
-- Phase 16 of doc/plans/2026-07-01-orchestrator-control-plane.md.
-- Three-level goal tree:
--
--   long_goal (goals.id)  ← top-level strategic objective, spans quarters
--     phase (phases.id)  ← 1–2 week milestone
--       mini_goal (goals.id, with parent_phase_id)  ← 3–5 day deliverable
--         task (tasks.id, with phase_id)  ← 0.5–2 day agent-owned unit
--
-- The `long_goal_id` column points at the top-level goals row; nested
-- phases use `parent_phase_id` so the tree is queryable as a single
-- recursive CTE. Mini-goals live in `goals` with `parent_phase_id`
-- (added in this migration) so we don't duplicate the goal metadata
-- table.
--
-- Status mirrors the task state machine (Phase 16.2) so the orchestrator
-- can apply the same transition rules at phase granularity:
--   not_started → in_progress → code_landed_needs_runtime
--               → partial_runtime_passed → actual_passed → closed
--   any state → blocked → in_progress
--   any state → failed → in_progress | closed

CREATE TABLE IF NOT EXISTS "phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"long_goal_id" uuid,
	"parent_phase_id" uuid,
	"name" text NOT NULL,
	"sequence" integer NOT NULL DEFAULT 0,
	"status" text NOT NULL DEFAULT 'not_started',
	"planned_start" date,
	"planned_end" date,
	"actual_start" timestamp with time zone,
	"actual_end" timestamp with time zone,
	"owner_agent_id" uuid,
	"description" text,
	"exit_criteria" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "phases_long_goal_id_goals_id_fk" FOREIGN KEY ("long_goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "phases_parent_phase_id_phases_id_fk" FOREIGN KEY ("parent_phase_id") REFERENCES "public"."phases"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "phases_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "phases_status_check" CHECK ("status" IN ('not_started', 'in_progress', 'blocked', 'code_landed_needs_runtime', 'partial_runtime_passed', 'actual_passed', 'failed', 'closed'))
);
--> statement-breakpoint

CREATE INDEX "phases_company_long_goal_idx" ON "phases" USING btree ("company_id","long_goal_id","sequence");
--> statement-breakpoint

CREATE INDEX "phases_company_status_idx" ON "phases" USING btree ("company_id","status");
--> statement-breakpoint

CREATE INDEX "phases_parent_phase_idx" ON "phases" USING btree ("parent_phase_id");
--> statement-breakpoint

-- Extend goals to allow mini-goals to point at a parent phase. Long
-- goals (parent_phase_id IS NULL) sit at the top of the tree; mini-goals
-- attach to a phase row.
ALTER TABLE "goals" ADD COLUMN "parent_phase_id" uuid;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'goals_parent_phase_id_phases_id_fk') THEN
    ALTER TABLE "goals" ADD CONSTRAINT "goals_parent_phase_id_phases_id_fk" FOREIGN KEY ("parent_phase_id") REFERENCES "public"."phases"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX "goals_parent_phase_idx" ON "goals" USING btree ("parent_phase_id");