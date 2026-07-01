-- 0114: file_locks — prevents parallel agents from clobbering the same file
--
-- Phase 16 of doc/plans/2026-07-01-orchestrator-control-plane.md.
--
-- Each row reserves a path for one task. The orchestrator enforces
-- "no two active tasks may share files_in_scope overlap" by holding
-- a transaction with SELECT ... FOR UPDATE on file_locks before
-- dispatch.
--
-- Two lock kinds:
--   exclusive — only this task may modify the file (default)
--   shared    — multiple tasks may read; writes blocked until released
--
-- The partial unique index guarantees at most one active exclusive
-- lock per file_path. Shared locks coexist.
--
-- Acquisition protocol:
--   BEGIN;
--     INSERT INTO file_locks (task_id, agent_id, file_path, lock_type, expires_at)
--     ON CONFLICT (file_path) WHERE released_at IS NULL DO NOTHING;
--     -- if no row inserted, retry as shared (or fail with 409)
--   COMMIT;

CREATE TABLE IF NOT EXISTS "file_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"lock_type" text NOT NULL DEFAULT 'exclusive',
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_locks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "file_locks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "file_locks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "file_locks_lock_type_check" CHECK ("lock_type" IN ('exclusive', 'shared'))
);
--> statement-breakpoint

-- At most one *exclusive* active lock per file. Multiple shared locks
-- coexist by design.
CREATE UNIQUE INDEX "file_locks_active_exclusive_unique_idx" ON "file_locks" USING btree ("file_path") WHERE "released_at" IS NULL AND "lock_type" = 'exclusive';
--> statement-breakpoint

CREATE INDEX "file_locks_task_idx" ON "file_locks" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX "file_locks_agent_idx" ON "file_locks" USING btree ("agent_id");
--> statement-breakpoint
CREATE INDEX "file_locks_active_idx" ON "file_locks" USING btree ("file_path") WHERE "released_at" IS NULL;