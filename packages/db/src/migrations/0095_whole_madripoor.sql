CREATE TABLE "control_plane_diagnostic_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"liveness" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"issue_status" text NOT NULL,
	"execution_status" text NOT NULL,
	"evidence_status" text NOT NULL,
	"recovery_status" text NOT NULL,
	"blocker_status" text NOT NULL,
	"next_action" text NOT NULL,
	"next_owner_type" text DEFAULT 'system' NOT NULL,
	"next_owner_id" text,
	"next_owner_agent_id" uuid,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text DEFAULT 'control_plane_diagnostic' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_blocker_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"blocker_issue_id" uuid,
	"level" text DEFAULT 'hard' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reason" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_actor_type" text DEFAULT 'system' NOT NULL,
	"created_by_actor_id" text,
	"created_by_agent_id" uuid,
	"downgraded_at" timestamp with time zone,
	"downgraded_by_user_id" text,
	"downgraded_by_agent_id" uuid,
	"downgrade_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_comment_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"author_agent_id" uuid,
	"author_user_id" text,
	"author_type" text,
	"created_by_run_id" uuid,
	"body" text NOT NULL,
	"presentation" jsonb,
	"metadata" jsonb,
	"failure_kind" text DEFAULT 'unknown' NOT NULL,
	"failure_reason" text,
	"http_status" integer,
	"error_message" text,
	"replay_status" text DEFAULT 'pending' NOT NULL,
	"replay_attempt_count" integer DEFAULT 0 NOT NULL,
	"last_replay_at" timestamp with time zone,
	"replayed_comment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_health_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid,
	"run_id" uuid,
	"adapter_type" text NOT NULL,
	"model_id" text,
	"event_type" text NOT NULL,
	"error_kind" text,
	"latency_ms" integer,
	"retry_attempt" integer DEFAULT 0 NOT NULL,
	"fallback_applied" boolean DEFAULT false NOT NULL,
	"fallback_adapter_type" text,
	"fallback_model_id" text,
	"error_summary" text,
	"raw_error_excerpt" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane_diagnostic_snapshots" ADD CONSTRAINT "control_plane_diagnostic_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane_diagnostic_snapshots" ADD CONSTRAINT "control_plane_diagnostic_snapshots_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane_diagnostic_snapshots" ADD CONSTRAINT "control_plane_diagnostic_snapshots_next_owner_agent_id_agents_id_fk" FOREIGN KEY ("next_owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_blocker_policies" ADD CONSTRAINT "issue_blocker_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_blocker_policies" ADD CONSTRAINT "issue_blocker_policies_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_blocker_policies" ADD CONSTRAINT "issue_blocker_policies_blocker_issue_id_issues_id_fk" FOREIGN KEY ("blocker_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_blocker_policies" ADD CONSTRAINT "issue_blocker_policies_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_blocker_policies" ADD CONSTRAINT "issue_blocker_policies_downgraded_by_agent_id_agents_id_fk" FOREIGN KEY ("downgraded_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comment_drafts" ADD CONSTRAINT "issue_comment_drafts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comment_drafts" ADD CONSTRAINT "issue_comment_drafts_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comment_drafts" ADD CONSTRAINT "issue_comment_drafts_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comment_drafts" ADD CONSTRAINT "issue_comment_drafts_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comment_drafts" ADD CONSTRAINT "issue_comment_drafts_replayed_comment_id_issue_comments_id_fk" FOREIGN KEY ("replayed_comment_id") REFERENCES "public"."issue_comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_health_events" ADD CONSTRAINT "model_health_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_health_events" ADD CONSTRAINT "model_health_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_health_events" ADD CONSTRAINT "model_health_events_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "control_plane_diagnostic_snapshots_company_created_idx" ON "control_plane_diagnostic_snapshots" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "control_plane_diagnostic_snapshots_issue_created_idx" ON "control_plane_diagnostic_snapshots" USING btree ("issue_id","created_at");--> statement-breakpoint
CREATE INDEX "control_plane_diagnostic_snapshots_company_liveness_idx" ON "control_plane_diagnostic_snapshots" USING btree ("company_id","liveness","created_at");--> statement-breakpoint
CREATE INDEX "control_plane_diagnostic_snapshots_company_severity_idx" ON "control_plane_diagnostic_snapshots" USING btree ("company_id","severity","created_at");--> statement-breakpoint
CREATE INDEX "issue_blocker_policies_company_issue_status_idx" ON "issue_blocker_policies" USING btree ("company_id","issue_id","status");--> statement-breakpoint
CREATE INDEX "issue_blocker_policies_company_blocker_idx" ON "issue_blocker_policies" USING btree ("company_id","blocker_issue_id");--> statement-breakpoint
CREATE INDEX "issue_blocker_policies_company_level_status_idx" ON "issue_blocker_policies" USING btree ("company_id","level","status");--> statement-breakpoint
CREATE INDEX "issue_comment_drafts_company_status_idx" ON "issue_comment_drafts" USING btree ("company_id","replay_status");--> statement-breakpoint
CREATE INDEX "issue_comment_drafts_issue_status_idx" ON "issue_comment_drafts" USING btree ("issue_id","replay_status");--> statement-breakpoint
CREATE INDEX "issue_comment_drafts_company_created_idx" ON "issue_comment_drafts" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "issue_comment_drafts_run_idx" ON "issue_comment_drafts" USING btree ("created_by_run_id");--> statement-breakpoint
CREATE INDEX "model_health_events_company_created_idx" ON "model_health_events" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "model_health_events_company_agent_created_idx" ON "model_health_events" USING btree ("company_id","agent_id","created_at");--> statement-breakpoint
CREATE INDEX "model_health_events_company_adapter_model_idx" ON "model_health_events" USING btree ("company_id","adapter_type","model_id","created_at");--> statement-breakpoint
CREATE INDEX "model_health_events_run_idx" ON "model_health_events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "model_health_events_company_event_type_idx" ON "model_health_events" USING btree ("company_id","event_type","created_at");