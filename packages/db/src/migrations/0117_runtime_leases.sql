-- 0117: runtime_leases — task-level runtime occupancy registry
--
-- Phase 16 of doc/plans/2026-07-01-orchestrator-control-plane.md.
--
-- Renamed from `environment_leases` to avoid colliding with the existing
-- `environment_leases` table (paperclip environments concept). This new
-- table tracks task-level runtime occupancy: who is holding port X,
-- PID Y, and command Z. Prevents "Agent A kills Agent B's process to
-- free port 3100" failure mode (collaboration pitfall #9).
--
-- Lifecycle:
--   active      — held by a running task
--   released    — task voluntarily released (graceful)
--   expired     — expires_at passed and a tick swept the lease
--   force-killed — orchestrator killed the process (rare; always audited)

CREATE TABLE IF NOT EXISTS "runtime_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"task_id" text NOT NULL,
	"environment" text NOT NULL,
	"port" integer,
	"pid" integer,
	"command" text,
	"log_path" text,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"status" text NOT NULL DEFAULT 'active',
	"kill_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_leases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "runtime_leases_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "runtime_leases_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "runtime_leases_status_check" CHECK ("status" IN ('active', 'released', 'expired', 'force-killed'))
);
--> statement-breakpoint

CREATE INDEX "runtime_leases_company_status_idx" ON "runtime_leases" USING btree ("company_id","status");
--> statement-breakpoint

CREATE INDEX "runtime_leases_port_idx" ON "runtime_leases" USING btree ("port") WHERE "port" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX "runtime_leases_expires_idx" ON "runtime_leases" USING btree ("expires_at") WHERE "status" = 'active';
--> statement-breakpoint

CREATE INDEX "runtime_leases_task_idx" ON "runtime_leases" USING btree ("task_id");