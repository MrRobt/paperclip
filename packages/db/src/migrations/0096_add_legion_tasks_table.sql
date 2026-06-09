ALTER TABLE "goals" ADD COLUMN "parent_goal_id" uuid;
--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "total_tasks" integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "completed_tasks" integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "goal_status" text DEFAULT 'planning';
--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_parent_goal_id_goals_id_fk" FOREIGN KEY ("parent_goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_goal_status_check" CHECK ("goal_status" IN ('planning', 'executing', 'verifying', 'completed', 'failed'));
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"goal_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'todo' NOT NULL,
	"priority" integer DEFAULT 3,
	"dependencies" text,
	"assignee_agent_id" text,
	"verification_criteria" text,
	"attempts" integer DEFAULT 0,
	"max_attempts" integer DEFAULT 3,
	"verification_result" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "tasks_status_check" CHECK ("status" IN ('todo', 'in_progress', 'blocked', 'done', 'failed', 'verification_failed'))
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "tasks_goal_idx" ON "tasks" USING btree ("goal_id");
--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "tasks_assignee_agent_idx" ON "tasks" USING btree ("assignee_agent_id");
