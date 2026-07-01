/**
 * Phase 12 of doc/plans/2026-06-30-self-solving-agent-team.md.
 *
 * `paperclipai memory record|query` — operator / agent entry point to
 * the cross-run memory service. Records structured postmortems after
 * task attempts and queries recent postmortems for a (company, repo,
 * module) triple.
 */

import { Command } from "commander";
import pc from "picocolors";
import {
  addCommonClientOptions,
  apiPath,
  handleCommandError,
  resolveCommandContext,
  printOutput,
  type BaseClientOptions,
} from "./client/common.js";

interface RecordOptions extends BaseClientOptions {
  fixSummary: string;
  taskId?: string;
  goalId?: string;
  repoPath?: string;
  modulePath?: string;
  rootCauseClass?: string;
  commit?: string;
  branch?: string;
  prUrl?: string;
  files?: string[];
  lessons?: string[];
  attemptNumber?: number;
  passed?: boolean;
}

interface QueryOptions extends BaseClientOptions {
  repoPath?: string;
  modulePath?: string;
  rootCauseClass?: string;
  limit?: number;
}

interface PostmortemRecord {
  id: string;
  taskId: string | null;
  repoPath: string | null;
  modulePath: string | null;
  rootCauseClass: string;
  fixSummary: string;
  commitHash: string | null;
  branchName: string | null;
  prUrl: string | null;
  filesTouched: string[];
  lessons: string[];
  attemptNumber: number;
  passed: boolean;
  createdAt: string;
}

export function registerMemoryCommands(program: Command): void {
  const memory = program.command("memory").description("Cross-run agent memory (postmortems)");

  const record = memory
    .command("record")
    .description("Record a postmortem for a task attempt")
    .requiredOption("--fix-summary <text>", "One-paragraph summary of what was tried")
    .option("--task-id <id>", "Task ID this postmortem is about")
    .option("--goal-id <id>", "Goal ID this postmortem is about")
    .option("--repo-path <path>", "Repository path (helps the decomposer find this entry later)")
    .option("--module-path <path>", "Module path within the repo")
    .option("--root-cause <class>", "logic | env | tool | flaky | ambiguity | unknown")
    .option("--commit <hash>", "Commit hash produced by this attempt")
    .option("--branch <name>", "Branch name")
    .option("--pr-url <url>", "Pull request URL")
    .option("--files <paths...>", "Files touched by this attempt")
    .option("--lessons <bullets...>", "Up to 3 short lessons the next agent should see")
    .option("--attempt-number <n>", "Attempt number (1-based)", (v) => Number(v))
    .option("--passed", "Record this as a successful attempt", false);
  addCommonClientOptions(record);
  record.action(async (opts: RecordOptions) => {
    try {
      const ctx = resolveCommandContext(opts, { requireCompany: true });
      const body = {
        taskId: opts.taskId ?? null,
        goalId: opts.goalId ?? null,
        repoPath: opts.repoPath ?? null,
        modulePath: opts.modulePath ?? null,
        rootCauseClass: opts.rootCauseClass ?? "unknown",
        fixSummary: opts.fixSummary,
        commitHash: opts.commit ?? null,
        branchName: opts.branch ?? null,
        prUrl: opts.prUrl ?? null,
        filesTouched: opts.files ?? [],
        lessons: opts.lessons ?? [],
        attemptNumber: opts.attemptNumber ?? 1,
        passed: !!opts.passed,
      };
      const record = await ctx.api.post<PostmortemRecord>(
        apiPath`/api/companies/${ctx.companyId}/memory/postmortems`,
        body,
      );
      if (!record) {
        throw new Error("No postmortem record returned by server");
      }
      if (ctx.json) {
        printOutput(record, { json: true });
        return;
      }
      console.log(`recorded ${record.id}  ${record.passed ? "PASS" : "FAIL"}  ${record.rootCauseClass}`);
    } catch (err) {
      handleCommandError(err);
    }
  });

  const query = memory
    .command("query")
    .description("Query recent postmortems")
    .option("--repo-path <path>", "Filter to a specific repo")
    .option("--module-path <path>", "Filter to a specific module")
    .option("--root-cause <class>", "Filter to one root cause class")
    .option("--limit <n>", "Max rows (default 5, max 20)", (v) => Number(v));
  addCommonClientOptions(query);
  query.action(async (opts: QueryOptions) => {
    try {
      const ctx = resolveCommandContext(opts, { requireCompany: true });
      const params = new URLSearchParams();
      if (opts.repoPath) params.set("repoPath", opts.repoPath);
      if (opts.modulePath) params.set("modulePath", opts.modulePath);
      if (opts.rootCauseClass) params.set("rootCauseClass", opts.rootCauseClass);
      if (opts.limit) params.set("limit", String(opts.limit));
      const rows = await ctx.api.get<PostmortemRecord[]>(
        apiPath`/api/companies/${ctx.companyId}/memory/postmortems?${params.toString()}`,
      );
      if (ctx.json) {
        printOutput(rows, { json: true });
        return;
      }
      for (const row of rows ?? []) {
        const verdict = row.passed ? pc.green("PASS") : pc.red("FAIL");
        console.log(`${verdict} [${row.rootCauseClass}] ${row.fixSummary}`);
        if (row.repoPath) {
          console.log(`  repo: ${row.repoPath}${row.modulePath ? `  module: ${row.modulePath}` : ""}`);
        }
        if (row.lessons.length > 0) {
          console.log(`  lessons: ${row.lessons.join(" | ")}`);
        }
        console.log(pc.dim(`  ${row.createdAt}`));
      }
    } catch (err) {
      handleCommandError(err);
    }
  });
}