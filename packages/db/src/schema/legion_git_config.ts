import { pgTable, uuid, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export type LegionAutoMergeMethod = "squash" | "rebase" | "merge";

export const legionGitConfig = pgTable(
  "legion_git_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    repositoryPath: text("repository_path").notNull(),
    defaultBranch: text("default_branch").notNull().default("main"),
    autoPr: boolean("auto_pr").notNull().default(true),
    /**
     * Phase 9: list of GitHub check names (e.g. ["ci/build", "ci/test"])
     * that must report success before legion-merge auto-merges a PR.
     * Empty/null means no required-check enforcement; the merge service
     * will still auto-merge if auto_merge is true, but it won't gate on CI.
     */
    requiredChecks: text("required_checks"),
    /**
     * Phase 9: when true, legion-merge auto-merges the PR once required
     * checks pass. When false, the PR stays open and the board must merge
     * manually; the merge service is a no-op for this company.
     */
    autoMerge: boolean("auto_merge").notNull().default(false),
    /**
     * Phase 9: which `gh pr merge --<method>` to use. Default "squash" per
     * project convention. Constrained at the DB level by migration 0101.
     */
    autoMergeMethod: text("auto_merge_method").$type<LegionAutoMergeMethod>().notNull().default("squash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyUniqueIdx: uniqueIndex("legion_git_config_company_idx").on(table.companyId),
  }),
);