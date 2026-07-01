import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  goals,
  legionGitConfig,
  prCheckRuns,
  tasks,
  type PrCheckConclusion,
  type PrCheckStatus,
} from "@paperclipai/db";

const execFileAsync = promisify(execFile);

const VALID_STATUSES: ReadonlySet<PrCheckStatus> = new Set([
  "pending",
  "success",
  "failure",
  "cancelled",
  "skipped",
]);

const VALID_CONCLUSIONS: ReadonlySet<PrCheckConclusion> = new Set([
  "success",
  "failure",
  "neutral",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
  "stale",
]);

/**
 * Exported pure helpers — used by tests in phase9.test.ts and reused by
 * the scheduler/monitor where appropriate. Keep these side-effect-free so
 * they're trivially testable without a real DB.
 */
export function normaliseGhState(value: unknown): PrCheckStatus | null {
  if (typeof value !== "string") return null;
  const lower = value.toLowerCase();
  if (VALID_STATUSES.has(lower as PrCheckStatus)) return lower as PrCheckStatus;
  if (lower === "queued" || lower === "waiting" || lower === "requested" || lower === "expected") {
    return "pending";
  }
  if (lower === "neutral") return "success";
  return null;
}

export function normaliseGhConclusion(value: unknown): PrCheckConclusion | null {
  if (typeof value !== "string") return null;
  const lower = value.toLowerCase();
  return VALID_CONCLUSIONS.has(lower as PrCheckConclusion) ? (lower as PrCheckConclusion) : null;
}

export function parseRequiredChecks(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((name): name is string => typeof name === "string" && name.trim().length > 0);
  } catch {
    return raw.split(",").map((name) => name.trim()).filter(Boolean);
  }
}

export function evaluateRequiredChecksResult(input: {
  required: string[];
  observed: Map<string, { status: string; conclusion: string | null }>;
}): RequiredChecksResult {
  const { required, observed } = input;
  if (required.length === 0) return { allPassed: true, pending: [], failed: [] };
  const pending: string[] = [];
  const failed: string[] = [];
  for (const name of required) {
    const obs = observed.get(name);
    if (!obs) {
      pending.push(name);
      continue;
    }
    if (obs.status === "success" || obs.conclusion === "success") continue;
    if (obs.status === "failure" || obs.status === "cancelled") {
      failed.push(name);
    } else {
      pending.push(name);
    }
  }
  return { allPassed: pending.length === 0 && failed.length === 0, pending, failed };
}

/**
 * One PR's worth of check rows as returned by `gh pr checks --json
 * name,state,conclusion,detailsUrl,startedAt,completedAt`. The shape is
 * what `gh` actually emits in 2.40+; older versions split across lines
 * and are not supported (the watcher logs a warning and returns an empty
 * list, which the merge service treats as "no signal yet").
 */
export interface GhCheckRow {
  name?: unknown;
  state?: unknown;
  conclusion?: unknown;
  detailsUrl?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
}

export interface CheckObservation {
  taskId: string;
  prUrl: string;
  prNumber: number;
  checkName: string;
  status: PrCheckStatus;
  conclusion: PrCheckConclusion | null;
  htmlUrl: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface RequiredChecksResult {
  /** True when every required check has status=success (or conclusion=success). */
  allPassed: boolean;
  /** Names of required checks that have NOT yet succeeded. */
  pending: string[];
  /** Names of required checks that have failed or been cancelled. */
  failed: string[];
}

export interface WatcherTickResult {
  observed: CheckObservation[];
  /** True when at least one check transitioned from non-success to success this tick. */
  anyFlippedGreen: boolean;
}

/**
 * Phase 9 of doc/plans/2026-06-30-self-solving-agent-team.md.
 *
 * Polls `gh pr checks --json` for each open task PR and persists the result
 * to `pr_check_runs`. Exposes `evaluateRequiredChecks` so the legion-merge
 * service can decide whether a PR is merge-ready.
 *
 * The watcher is intentionally a thin wrapper — `gh` is the source of
 * truth for what checks exist and their status. We don't try to parse
 * commit statuses, check-runs API responses, or GitHub Apps; if the
 * installed `gh` version supports `--json`, this works.
 */
export function legionCiWatcherService(db: Db) {
  return {
    /**
     * Run one polling tick. Returns the number of checks observed so the
     * caller (cron or WebSocket loop) can decide whether to emit a UI event.
     */
    async tickForTask(taskId: string): Promise<WatcherTickResult> {
      const rows = await db
        .select({ task: tasks, goal: goals, config: legionGitConfig })
        .from(tasks)
        .innerJoin(goals, eq(tasks.goalId, goals.id))
        .leftJoin(legionGitConfig, eq(legionGitConfig.companyId, goals.companyId))
        .where(eq(tasks.id, taskId))
        .limit(1);
      const row = rows[0];
      if (!row) return { observed: [], anyFlippedGreen: false };
      const { task, config } = row;
      if (!config?.repositoryPath) return { observed: [], anyFlippedGreen: false };
      // Only watch tasks that have produced a PR. Without a PR URL we have
      // nothing to poll — the legion-git service is responsible for setting
      // the pr_url on the task when createPullRequest succeeds.
      const prInfo = parsePrUrlFromTask(task);
      if (!prInfo) return { observed: [], anyFlippedGreen: false };

      const checks = await fetchChecks(config.repositoryPath, prInfo.branch);
      const observed: CheckObservation[] = [];
      let anyFlippedGreen = false;
      for (const check of checks) {
        if (!check.name) continue;
        const previous = await db
          .select({ status: prCheckRuns.status, conclusion: prCheckRuns.conclusion })
          .from(prCheckRuns)
          .where(and(eq(prCheckRuns.prUrl, prInfo.url), eq(prCheckRuns.checkName, check.name)))
          .limit(1);
        const observation: CheckObservation = {
          taskId,
          prUrl: prInfo.url,
          prNumber: prInfo.number,
          checkName: check.name,
          status: check.status,
          conclusion: check.conclusion,
          htmlUrl: check.htmlUrl,
          startedAt: check.startedAt,
          completedAt: check.completedAt,
        };
        observed.push(observation);
        await db
          .insert(prCheckRuns)
          .values({
            companyId: row.goal.companyId,
            taskId,
            prUrl: prInfo.url,
            prNumber: prInfo.number,
            checkName: check.name,
            status: observation.status,
            conclusion: observation.conclusion,
            htmlUrl: observation.htmlUrl,
            startedAt: observation.startedAt,
            completedAt: observation.completedAt,
            raw: check.raw,
          })
          .onConflictDoUpdate({
            target: [prCheckRuns.prUrl, prCheckRuns.checkName],
            set: {
              status: observation.status,
              conclusion: observation.conclusion,
              htmlUrl: observation.htmlUrl,
              startedAt: observation.startedAt,
              completedAt: observation.completedAt,
              raw: check.raw,
              updatedAt: new Date(),
            },
          });
        const wasGreen = previous[0]?.status === "success";
        if (!wasGreen && observation.status === "success") anyFlippedGreen = true;
      }
      return { observed, anyFlippedGreen };
    },

    /**
     * Read the latest check status and decide if `required_checks` from
     * the company config are all green. Used by legion-merge before
     * calling `gh pr merge`.
     */
    async evaluateRequiredChecks(taskId: string): Promise<RequiredChecksResult> {
      const rows = await db
        .select({ goal: goals, config: legionGitConfig })
        .from(tasks)
        .innerJoin(goals, eq(tasks.goalId, goals.id))
        .leftJoin(legionGitConfig, eq(legionGitConfig.companyId, goals.companyId))
        .where(eq(tasks.id, taskId))
        .limit(1);
      const row = rows[0];
      if (!row?.config) {
        return { allPassed: true, pending: [], failed: [] };
      }
      const required = parseRequiredChecks(row.config.requiredChecks);
      if (required.length === 0) {
        // No enforcement configured — treat as passed (but caller should
        // still respect auto_merge toggle).
        return { allPassed: true, pending: [], failed: [] };
      }
      const prInfo = parsePrUrlFromTask({ ...rows[0], } as unknown as typeof tasks.$inferSelect);
      // Fallback: re-fetch the task itself for PR URL metadata.
      const taskRow = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
      const prUrlFromTask = parsePrUrlFromTask(taskRow[0] ?? undefined);
      const prUrl = prInfo?.url ?? prUrlFromTask?.url;
      if (!prUrl) return { allPassed: false, pending: required, failed: [] };
      const checkRows = await db
        .select({ checkName: prCheckRuns.checkName, status: prCheckRuns.status, conclusion: prCheckRuns.conclusion })
        .from(prCheckRuns)
        .where(eq(prCheckRuns.prUrl, prUrl));
      const observed = new Map(checkRows.map((row) => [row.checkName, row]));
      const pending: string[] = [];
      const failed: string[] = [];
      for (const name of required) {
        const obs = observed.get(name);
        if (!obs) {
          pending.push(name);
          continue;
        }
        if (obs.status === "success" || obs.conclusion === "success") continue;
        if (obs.status === "failure" || obs.status === "cancelled") {
          failed.push(name);
        } else {
          pending.push(name);
        }
      }
      return { allPassed: pending.length === 0 && failed.length === 0, pending, failed };
    },
  };
}

interface PrInfo {
  url: string;
  number: number;
  branch: string;
}

function parsePrUrlFromTask(task: { verificationResult?: string | null; description?: string | null } | undefined): PrInfo | null {
  if (!task) return null;
  // Phase 9: legion-git stores the PR URL in the legacy `verificationResult`
  // JSON blob under `prUrl` after `createPullRequest` returns. Fall back to
  // a parse of `description` for legacy rows that recorded the PR there.
  const blob = parseBlob(task.verificationResult ?? null);
  if (blob && typeof blob.prUrl === "string" && typeof blob.prNumber === "number") {
    const branch = typeof blob.branchName === "string" ? blob.branchName : "";
    return { url: blob.prUrl, number: blob.prNumber, branch };
  }
  // No PR info on the task — return null so the watcher skips.
  return null;
}

function parseBlob(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

interface NormalizedCheck {
  name: string;
  status: PrCheckStatus;
  conclusion: PrCheckConclusion | null;
  htmlUrl: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  raw: unknown;
}

async function fetchChecks(repositoryPath: string, branch: string): Promise<NormalizedCheck[]> {
  // gh pr checks requires a PR number, not a branch. The branch is the
  // upstream feature branch for the task; we derive the PR number from
  // the working tree's metadata via `gh pr view`. If that fails the
  // caller treats the result as "no signal" and retries on the next tick.
  const prNumber = await resolvePrNumber(repositoryPath, branch);
  if (!prNumber) return [];
  try {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "pr",
        "checks",
        String(prNumber),
        "--repo",
        repositoryPath,
        "--json",
        "name,state,conclusion,detailsUrl,startedAt,completedAt",
      ],
      { maxBuffer: 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row): NormalizedCheck | null => {
        const r = row as GhCheckRow;
        const status = normaliseStatus(r.state);
        if (!status) return null;
        const name = typeof r.name === "string" ? r.name : null;
        if (!name) return null;
        return {
          name,
          status,
          conclusion: normaliseConclusion(r.conclusion),
          htmlUrl: typeof r.detailsUrl === "string" ? r.detailsUrl : null,
          startedAt: parseTimestamp(r.startedAt),
          completedAt: parseTimestamp(r.completedAt),
          raw: r,
        };
      })
      .filter((c): c is NormalizedCheck => c !== null);
  } catch (err) {
    console.warn(`legion-ci-watcher: gh pr checks failed:`, err instanceof Error ? err.message : err);
    return [];
  }
}

async function resolvePrNumber(repositoryPath: string, branch: string): Promise<number | null> {
  if (!branch) return null;
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "view", branch, "--repo", repositoryPath, "--json", "number"],
      { maxBuffer: 64 * 1024 },
    );
    const parsed = JSON.parse(stdout) as { number?: unknown };
    return typeof parsed.number === "number" ? parsed.number : null;
  } catch {
    return null;
  }
}

function normaliseStatus(value: unknown): PrCheckStatus | null {
  if (typeof value !== "string") return null;
  const lower = value.toLowerCase();
  // gh emits states like "success", "failure", "pending", "cancelled", "skipped",
  // "neutral" (which we treat as success-equivalent for watcher purposes),
  // and "waiting"/"requested"/"queued" (all map to pending).
  if (VALID_STATUSES.has(lower as PrCheckStatus)) return lower as PrCheckStatus;
  if (lower === "queued" || lower === "waiting" || lower === "requested" || lower === "expected") {
    return "pending";
  }
  if (lower === "neutral") return "success";
  return null;
}

function normaliseConclusion(value: unknown): PrCheckConclusion | null {
  if (typeof value !== "string") return null;
  const lower = value.toLowerCase();
  return VALID_CONCLUSIONS.has(lower as PrCheckConclusion) ? (lower as PrCheckConclusion) : null;
}

function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? new Date(ts) : null;
}