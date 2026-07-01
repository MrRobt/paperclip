-- 0101: legion_git_config CI/merge knobs
--
-- Phase 9 of doc/plans/2026-06-30-self-solving-agent-team.md.
-- Adds the surface the legion-ci-watcher and legion-merge services read:
--   - required_checks: list of check names (e.g. ["ci/build", "ci/test"]) that
--     MUST report `success` before a PR is auto-merged.
--   - auto_merge: when true, the legion-merge service calls `gh pr merge`
--     after all required_checks pass; when false, the PR stays open and the
--     board must merge manually (still surfaced in the control plane).
--   - auto_merge_method: squash | rebase | merge. Defaults to squash per
--     project convention.

ALTER TABLE "legion_git_config" ADD COLUMN "required_checks" text;
--> statement-breakpoint

ALTER TABLE "legion_git_config" ADD COLUMN "auto_merge" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

ALTER TABLE "legion_git_config" ADD COLUMN "auto_merge_method" text NOT NULL DEFAULT 'squash';
--> statement-breakpoint

-- Constrain the merge method to the three GitHub supports. Reject bad
-- config at write time so the legion-merge service can assume the column
-- is parseable.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legion_git_config_auto_merge_method_check') THEN
    ALTER TABLE "legion_git_config" ADD CONSTRAINT "legion_git_config_auto_merge_method_check" CHECK ("auto_merge_method" IN ('squash', 'rebase', 'merge'));
  END IF;
END $$;