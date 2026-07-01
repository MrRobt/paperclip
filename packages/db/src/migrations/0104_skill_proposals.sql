-- 0104: skill_proposals — eval-gated self-modification
--
-- Phase 11 of doc/plans/2026-06-30-self-solving-agent-team.md.
-- Records every proposal to change a skill file. Eval suite is run twice
-- (baseline vs proposed) and the delta is persisted so the board can
-- approve only when the proposed version is at least as good as the
-- current one (and ideally better).
--
-- Status transitions:
--   pending    → evaluating  (eval suite running)
--   evaluating → approved    (board approved; new skill merged into catalog)
--               → denied      (board rejected)
--               → rolled_back (post-merge regression detected; reverted)
--
-- `proposed_by` distinguishes agent-initiated proposals from human
-- authored ones. Agent-initiated proposals require either:
--   (a) baseline_eval_pass_rate <= proposed_eval_pass_rate AND no regression
--       in any individual case, OR
--   (b) explicit board override.
-- The `proposal_evaluator.ts` (to be written) implements the comparison.

CREATE TABLE IF NOT EXISTS "skill_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"skill_path" text NOT NULL,
	"proposed_diff" text NOT NULL,
	"proposed_by_kind" text NOT NULL DEFAULT 'agent',
	"proposed_by_agent_id" text,
	"proposed_by_user_id" text,
	"baseline_eval_pass_rate" numeric,
	"proposed_eval_pass_rate" numeric,
	"eval_delta" numeric,
	"regressions" text,
	"status" text NOT NULL DEFAULT 'pending',
	"decided_by_user_id" text,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_proposals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "skill_proposals_proposed_by_kind_check" CHECK ("proposed_by_kind" IN ('agent', 'human')),
	CONSTRAINT "skill_proposals_status_check" CHECK ("status" IN ('pending', 'evaluating', 'approved', 'denied', 'rolled_back'))
);
--> statement-breakpoint

CREATE INDEX "skill_proposals_company_status_idx" ON "skill_proposals" USING btree ("company_id","status");
--> statement-breakpoint

CREATE INDEX "skill_proposals_skill_path_idx" ON "skill_proposals" USING btree ("skill_path");
--> statement-breakpoint

CREATE INDEX "skill_proposals_status_idx" ON "skill_proposals" USING btree ("status");