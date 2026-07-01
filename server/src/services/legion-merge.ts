import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { goals, legionGitConfig, tasks, type LegionAutoMergeMethod } from "@paperclipai/db";
import { legionCiWatcherService, type RequiredChecksResult } from "./legion-ci-watcher.js";

const execFileAsync = promisify(execFile);

export interface MergeAttemptResult {
  taskId: string;
  outcome: "merged" | "skipped" | "blocked";
  reason: string;
  mergeCommitSha?: string;
  prUrl?: string;
}

const MERGE_METHOD_FLAG: Record<LegionAutoMergeMethod, string> = {
  squash: "--squash",
  rebase: "--rebase",
  merge: "--merge",
};

/**
 * Pure helpers exposed for unit testing. The runtime merge service uses
 * the same functions internally.
 */
export function parseMergeBlob(raw: string | null | undefined): { url: string; number: number; branchName: string | null } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const blob = parsed as Record<string, unknown>;
    if (typeof blob.prUrl !== "string" || typeof blob.prNumber !== "number") return null;
    return {
      url: blob.prUrl,
      number: blob.prNumber,
      branchName: typeof blob.branchName === "string" ? blob.branchName : null,
    };
  } catch {
    return null;
  }
}

export function isAlreadyMerged(viewJson: { state?: unknown; mergeCommit?: { oid?: unknown } | null }): { merged: boolean; sha?: string | null } {
  const state = typeof viewJson.state === "string" ? viewJson.state.toUpperCase() : "";
  const sha =
    viewJson.mergeCommit && typeof viewJson.mergeCommit === "object" && viewJson.mergeCommit !== null && typeof (viewJson.mergeCommit as { oid?: unknown }).oid === "string"
      ? (viewJson.mergeCommit as { oid: string }).oid
      : null;
  return { merged: state === "MERGED", sha };
}

export function shouldSkipAutoMerge(config: { autoMerge: boolean; autoMergeMethod: LegionAutoMergeMethod }): boolean {
  return !config.autoMerge;
}

export const MERGE_METHOD_FLAGS = MERGE_METHOD_FLAG;

/**
 * Phase 9 of doc/plans/2026-06-30-self-solving-agent-team.md.
 *
 * Closes the PR → merge loop for a finished Legion task. The service is
 * intentionally idempotent: re-running it on an already-merged task is a
 * no-op that returns `{outcome: 'skipped', reason: 'already merged'}`.
 *
 * Pre-conditions (all must hold):
 *   1. Company `auto_merge` is true in `legion_git_config`.
 *   2. `legion_ci_watcher.evaluateRequiredChecks(taskId)` returns allPassed.
 *   3. Task has a PR recorded (URL + branch in the verificationResult blob).
 *   4. Task status is `in_progress` (i.e. the agent's run is complete and
 *      verification succeeded — caller is expected to flip status to
 *      `done` only AFTER this service returns `merged`).
 *
 * The function returns `outcome: 'blocked'` with a reason when any
 * pre-condition fails; callers should NOT flip task status in that case.
 */
export function legionMergeService(db: Db) {
  const watcher = legionCiWatcherService(db);
  return {
    async attemptMerge(taskId: string): Promise<MergeAttemptResult> {
      const rows = await db
        .select({ task: tasks, goal: goals, config: legionGitConfig })
        .from(tasks)
        .innerJoin(goals, eq(tasks.goalId, goals.id))
        .leftJoin(legionGitConfig, eq(legionGitConfig.companyId, goals.companyId))
        .where(eq(tasks.id, taskId))
        .limit(1);
      const row = rows[0];
      if (!row) {
        return { taskId, outcome: "blocked", reason: "task not found" };
      }
      if (!row.config) {
        return { taskId, outcome: "blocked", reason: "company has no legion_git_config" };
      }
      if (!row.config.autoMerge) {
        return { taskId, outcome: "skipped", reason: "auto_merge is disabled for this company" };
      }
      const prInfo = extractPrInfo(row.task.verificationResult);
      if (!prInfo) {
        return { taskId, outcome: "blocked", reason: "task has no recorded PR URL/number; legion-git must call createPullRequest first" };
      }
      if (row.task.status !== "in_progress" && row.task.status !== "actual_passed") {
        return {
          taskId,
          outcome: "blocked",
          reason: `task status=${row.task.status}; can only merge from in_progress or actual_passed`,
        };
      }

      const required: RequiredChecksResult = await watcher.evaluateRequiredChecks(taskId);
      if (!required.allPassed) {
        const parts: string[] = [];
        if (required.pending.length > 0) parts.push(`pending=${required.pending.join(",")}`);
        if (required.failed.length > 0) parts.push(`failed=${required.failed.join(",")}`);
        return { taskId, outcome: "blocked", reason: `required_checks not satisfied (${parts.join("; ")})`, prUrl: prInfo.url };
      }

      // Idempotency: if the PR is already merged, don't try again.
      const existingMerge = await isPrAlreadyMerged(row.config.repositoryPath, prInfo.url);
      if (existingMerge.merged) {
        return {
          taskId,
          outcome: "skipped",
          reason: "PR already merged",
          prUrl: prInfo.url,
          mergeCommitSha: existingMerge.sha ?? undefined,
        };
      }

      const method = MERGE_METHOD_FLAG[row.config.autoMergeMethod] ?? "--squash";
      const deleteBranch = "--delete-branch";
      try {
        const { stdout } = await execFileAsync(
          "gh",
          ["pr", "merge", String(prInfo.number), "--repo", row.config.repositoryPath, method, deleteBranch],
          { maxBuffer: 1024 * 1024 },
        );
        const sha = extractMergeSha(stdout) ?? existingMerge.sha ?? null;
        return { taskId, outcome: "merged", reason: "merged via gh", mergeCommitSha: sha ?? undefined, prUrl: prInfo.url };
      } catch (err) {
        // `gh pr merge` returns non-zero when the PR is already merged
        // (race with another watcher). Treat that as a successful no-op.
        const message = err instanceof Error ? err.message : String(err);
        if (/already merged/i.test(message)) {
          return { taskId, outcome: "skipped", reason: "PR already merged (race)", prUrl: prInfo.url };
        }
        return { taskId, outcome: "blocked", reason: `gh pr merge failed: ${message}`, prUrl: prInfo.url };
      }
    },
  };
}

interface PrInfo {
  url: string;
  number: number;
  branchName: string | null;
}

function extractPrInfo(raw: string | null | undefined): PrInfo | null {
  return parseMergeBlob(raw);
}

async function isPrAlreadyMerged(repositoryPath: string, prUrl: string): Promise<{ merged: boolean; sha?: string | null }> {
  // gh pr view --json state,mergedAt,mergeCommit
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "view", prUrl, "--repo", repositoryPath, "--json", "state,mergeCommit"],
      { maxBuffer: 64 * 1024 },
    );
    return isAlreadyMerged(JSON.parse(stdout) as { state?: unknown; mergeCommit?: { oid?: unknown } });
  } catch {
    return { merged: false };
  }
}

function extractMergeSha(stdout: string): string | null {
  // gh prints "Merge pull request #N from <branch>\n\n<url>" on success.
  // The merge commit SHA isn't in stdout by default; we leave it null and
  // let the caller re-derive via gh pr view if needed. Kept here as a
  // hook for future parsing of `gh pr merge --json` output.
  const match = stdout.match(/\b([0-9a-f]{40})\b/i);
  return match ? match[1] : null;
}