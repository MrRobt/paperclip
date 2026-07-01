-- 0103: task_postmortems — cross-run memory
--
-- Phase 10 of doc/plans/2026-06-30-self-solving-agent-team.md.
-- Persists a structured postmortem for every Legion task attempt (success
-- OR failure) so the goal-decomposer can inject few-shot context from
-- prior runs in the same company / repo / module when planning new goals.
--
-- Without this table, every new goal starts from zero — the agent team
-- forgets how it solved (or failed to solve) similar problems last week.
--
-- Root cause classes drive the few-shot filter:
--   logic      — code bug
--   env        — missing tool / wrong cwd / network
--   tool       — LLM/CLI bug or unexpected output format
--   flaky      — test passed once, failed on retry with no code change
--   ambiguity  — criteria were unclear and the agent guessed wrong
--   unknown    — none of the above
--
-- The index ordering (company, repo, module, created_at DESC) supports
-- the query in services/memory.ts queryPostmortems() which scans the
-- most-recent matching postmortems for the (company, repo, module)
-- triple of the goal being decomposed.

CREATE TABLE IF NOT EXISTS "task_postmortems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"goal_id" uuid,
	"task_id" text,
	"repo_path" text,
	"module_path" text,
	"root_cause_class" text NOT NULL DEFAULT 'unknown',
	"fix_summary" text NOT NULL,
	"commit_hash" text,
	"branch_name" text,
	"pr_url" text,
	"files_touched" text,
	"lessons" text,
	"attempt_number" integer DEFAULT 1,
	"passed" boolean NOT NULL DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_postmortems_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "task_postmortems_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "task_postmortems_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "task_postmortems_root_cause_class_check" CHECK ("root_cause_class" IN ('logic', 'env', 'tool', 'flaky', 'ambiguity', 'unknown'))
);
--> statement-breakpoint

CREATE INDEX "task_postmortems_company_repo_module_idx" ON "task_postmortems" USING btree ("company_id","repo_path","module_path","created_at");
--> statement-breakpoint

CREATE INDEX "task_postmortems_company_recent_idx" ON "task_postmortems" USING btree ("company_id","created_at");
--> statement-breakpoint

CREATE INDEX "task_postmortems_root_cause_idx" ON "task_postmortems" USING btree ("root_cause_class");