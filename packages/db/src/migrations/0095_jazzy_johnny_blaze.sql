ALTER TABLE "environments" ADD COLUMN "pool_key" text;--> statement-breakpoint
CREATE INDEX "environments_company_pool_idx" ON "environments" USING btree ("company_id","pool_key");