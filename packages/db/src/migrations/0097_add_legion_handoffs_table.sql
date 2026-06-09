CREATE TABLE "handoffs" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"artifact_type" text NOT NULL,
	"artifact_path" text NOT NULL,
	"summary" text,
	"contract" text,
	"status" text DEFAULT 'ready',
	"consumed_by" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "handoffs_artifact_type_check" CHECK ("artifact_type" IN ('api_contract', 'data_model', 'config', 'component')),
	CONSTRAINT "handoffs_status_check" CHECK ("status" IN ('ready', 'consumed', 'stale'))
);
--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "handoffs_task_idx" ON "handoffs" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX "handoffs_status_idx" ON "handoffs" USING btree ("status");
