-- 0117: environment_leases — runtime occupancy registry
--
-- Phase 16 of doc/plans/2026-07-01-orchestrator-control-plane.md.
--
-- Prevents the "Agent A kills Agent B's process to free port 3100"
-- failure mode (collaboration pitfall #9: environment抢占).
--
-- Before a task starts a dev server / preview / sandbox, it must
-- acquire a lease row. The orchestrator checks for conflicts before
-- dispatch and refuses to start a task whose lease target is already
-- held by a non-expired lease from another task.
--
-- Lifecycle:
--   active    — held by a running task
--   released  — task voluntarily released (graceful)
--   expired   — expires_at passed and a tick swept the lease
--   force-killed — orchestrator killed the process (rare; always audited)

CREATE TABLE IF NOT EXISTS "environment_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
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
	CONSTRAINT "environment_leases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "environment_leases_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "environment_leases_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "environment_leases_status_check" CHECK ("status" IN ('active', 'released', 'expired', 'force-killed'))
);
--> statement-breakpoint

CREATE INDEX "environment_leases_company_status_idx" ON "environment_leases" USING btree ("company_id","status");
--> statement-breakpoint

CREATE INDEX "environment_leases_port_idx" ON "environment_leases" USING btree ("port") WHERE "port" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX "environment_leases_expires_idx" ON "environment_leases" USING btree ("expires_at") WHERE "status" = 'active';
--> statement-breakpoint

CREATE INDEX "environment_leases_task_idx" ON "environment_leases" USING btree ("task_id");