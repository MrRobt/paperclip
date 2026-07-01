-- 0102: pr_check_runs table
--
-- Phase 9 of doc/plans/2026-06-30-self-solving-agent-team.md.
-- One row per (PR, check_name). The legion-ci-watcher polls `gh pr checks`
-- and upserts here; legion-merge reads `status` to decide whether required
-- checks are all green.
--
-- Status enum mirrors what `gh pr checks --json state` returns:
--   - pending: still running
--   - success: passed
--   - failure: failed
--   - cancelled: skipped (workflow dismissed, etc.)
--   - skipped: not run for this PR (e.g. changed-files filter)
--
-- conclusion mirrors GitHub's overall conclusion: success | failure |
-- neutral | cancelled | skipped | timed_out | action_required | stale.

CREATE TABLE IF NOT EXISTS "pr_check_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"task_id" text NOT NULL,
	"pr_url" text NOT NULL,
	"pr_number" integer NOT NULL,
	"check_name" text NOT NULL,
	"status" text NOT NULL DEFAULT 'pending',
	"conclusion" text,
	"html_url" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pr_check_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "pr_check_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "pr_check_runs_status_check" CHECK ("status" IN ('pending', 'success', 'failure', 'cancelled', 'skipped')),
	CONSTRAINT "pr_check_runs_conclusion_check" CHECK ("conclusion" IS NULL OR "conclusion" IN ('success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required', 'stale'))
);
--> statement-breakpoint

CREATE UNIQUE INDEX "pr_check_runs_pr_check_unique_idx" ON "pr_check_runs" USING btree ("pr_url","check_name");
--> statement-breakpoint

CREATE INDEX "pr_check_runs_task_idx" ON "pr_check_runs" USING btree ("task_id");
--> statement-breakpoint

CREATE INDEX "pr_check_runs_status_idx" ON "pr_check_runs" USING btree ("status");