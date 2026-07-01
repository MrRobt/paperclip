-- 0113: tasks structured template + 8-state machine
--
-- Phase 16 of doc/plans/2026-07-01-orchestrator-control-plane.md.
--
-- Replaces the free-form `tasks.description` workflow with a structured
-- template aligned to the orchestrator's 9 required task inputs:
--   objective        — single-sentence goal
--   non_objectives   — bullet list of things the task must NOT do
--   inputs           — upstream task ids / handoffs / external artefacts
--   outputs          — files / API endpoints / docs the task produces
--   files_in_scope   — paths the task may modify (drives file_locks)
--   files_out_of_scope — paths the task must NOT modify (orchestrator override trigger)
--   acceptance_criteria — human-readable Definition of Done
--   evidence_paths   — paths to artefacts that prove actual_passed
--                       (screenshots, curl outputs, log files, db rows)
--   evidence_summary — one-paragraph summary of the evidence (board-readable)
--   downstream_owner_agent_id — who receives the handoff next
--   phase_id         — points at the phases row from migration 0112
--   failure_stage    — granular failure taxonomy (compile_failed / test_failed /
--                       runtime_failed / contract_drift / evidence_missing)
--   retry_strategy   — { backoffSec, maxAttempts, fallbackTaskId }
--
-- The `tasks.status` column gains an 8-state enum:
--   not_started | in_progress | blocked | code_landed_needs_runtime
--             | partial_runtime_passed | actual_passed | failed | closed
--
-- A backfill step maps existing 5-state rows to the new 8-state:
--   todo                → not_started
--   in_progress         → in_progress
--   done                → code_landed_needs_runtime   (still needs verification gate)
--   failed              → failed
--   verification_failed → failed (with failure_stage=evidence_missing)
--
-- The CHECK constraint is enforced after backfill so the migration is
-- safe to run against a populated DB.

ALTER TABLE "tasks"
  ADD COLUMN "objective" text,
  ADD COLUMN "non_objectives" text,
  ADD COLUMN "inputs" jsonb,
  ADD COLUMN "outputs" jsonb,
  ADD COLUMN "files_in_scope" text,
  ADD COLUMN "files_out_of_scope" text,
  ADD COLUMN "acceptance_criteria" jsonb,
  ADD COLUMN "evidence_paths" text,
  ADD COLUMN "evidence_summary" text,
  ADD COLUMN "downstream_owner_agent_id" uuid,
  ADD COLUMN "phase_id" uuid,
  ADD COLUMN "failure_stage" text,
  ADD COLUMN "retry_strategy" jsonb;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_phase_id_phases_id_fk') THEN
    ALTER TABLE "tasks" ADD CONSTRAINT "tasks_phase_id_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."phases"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_downstream_owner_agent_id_agents_id_fk') THEN
    ALTER TABLE "tasks" ADD CONSTRAINT "tasks_downstream_owner_agent_id_agents_id_fk" FOREIGN KEY ("downstream_owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_failure_stage_check') THEN
    ALTER TABLE "tasks" ADD CONSTRAINT "tasks_failure_stage_check" CHECK (
      "failure_stage" IS NULL OR "failure_stage" IN (
        'compile_failed', 'test_failed', 'runtime_failed',
        'contract_drift', 'evidence_missing', 'agent_overrun',
        'env_unavailable', 'unknown'
      )
    );
  END IF;
END $$;
--> statement-breakpoint

-- Backfill status values to the 8-state machine BEFORE enforcing the
-- CHECK so the migration can apply to a populated database without
-- failing the constraint.
UPDATE "tasks" SET "status" = 'not_started'             WHERE "status" = 'todo';
--> statement-breakpoint
UPDATE "tasks" SET "status" = 'code_landed_needs_runtime' WHERE "status" = 'done';
--> statement-breakpoint
UPDATE "tasks" SET "status" = 'failed'                    WHERE "status" = 'verification_failed';
--> statement-breakpoint

-- Default for new rows: every task enters at not_started.
ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'not_started';
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_status_check') THEN
    ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_check" CHECK ("status" IN (
      'not_started', 'in_progress', 'blocked', 'code_landed_needs_runtime',
      'partial_runtime_passed', 'actual_passed', 'failed', 'closed'
    ));
  END IF;
END $$;
--> statement-breakpoint

-- Helpful indexes for the orchestrator's hot paths.
CREATE INDEX IF NOT EXISTS "tasks_phase_status_idx" ON "tasks" USING btree ("phase_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_owner_status_idx" ON "tasks" USING btree ("assignee_agent_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_failure_stage_idx" ON "tasks" USING btree ("failure_stage") WHERE "failure_stage" IS NOT NULL;