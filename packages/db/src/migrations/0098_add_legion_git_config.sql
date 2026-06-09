CREATE TABLE IF NOT EXISTS "legion_git_config" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "repository_path" text NOT NULL,
  "default_branch" text DEFAULT 'main' NOT NULL,
  "auto_pr" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legion_git_config_company_id_companies_id_fk') THEN
  ALTER TABLE "legion_git_config" ADD CONSTRAINT "legion_git_config_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "legion_git_config_company_idx" ON "legion_git_config" USING btree ("company_id");
