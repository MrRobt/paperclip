-- 0100: structured verification_spec + task_verifications history
--
-- Phase 8 of doc/plans/2026-06-30-self-solving-agent-team.md.
-- Replaces the free-text verification_criteria TEXT column with a structured
-- JSONB spec so the verification-runner can execute real commands (tests,
-- typecheck, lint, build, file-exists, http-probe, custom-exit-zero) and
-- persist structured evidence per attempt.
--
-- `verification_criteria` and `verification_result` are retained for one
-- migration cycle (dropped in 0105) so historical rows remain readable.

ALTER TABLE "tasks" ADD COLUMN "verification_spec" jsonb;
--> statement-breakpoint

CREATE TABLE "task_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"evidence" jsonb NOT NULL,
	"llm_summary" jsonb,
	"passed" boolean NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_verifications_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint

CREATE INDEX "task_verifications_task_attempt_idx" ON "task_verifications" USING btree ("task_id","attempt_number");
--> statement-breakpoint

CREATE INDEX "task_verifications_task_created_idx" ON "task_verifications" USING btree ("task_id","created_at");
--> statement-breakpoint

-- Composite index for the scheduler hot path: find todo tasks for a goal.
CREATE INDEX IF NOT EXISTS "tasks_goal_status_idx" ON "tasks" USING btree ("goal_id","status");