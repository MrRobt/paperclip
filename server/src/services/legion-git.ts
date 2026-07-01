import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { goals, handoffs, legionGitConfig, tasks } from "@paperclipai/db";
import type { Task } from "./task-scheduler.js";

const execFileAsync = promisify(execFile);

type GitConfig = typeof legionGitConfig.$inferSelect;

interface GitResult { branchName: string; commitHash: string }
interface PullRequestOptions { baseBranch: string; title: string; body: string }

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "task";
}

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repo, ...args], { maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

/**
 * Merge the PR coordinates into the task's `verification_result` JSONB so
 * downstream services (ci-watcher, merge) can find them without re-deriving
 * from `gh`. Preserves any prior keys (e.g. `hardPassed`, `failureDigest`,
 * `evidenceId`) so verification history is not lost.
 */
async function persistPrMetadata(
  db: Db,
  taskId: string,
  metadata: { prUrl: string; prNumber: number; branchName: string },
): Promise<void> {
  const rows = await db.select({ verificationResult: tasks.verificationResult }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  const existing = parseBlob(rows[0]?.verificationResult);
  await db
    .update(tasks)
    .set({
      verificationResult: JSON.stringify({ ...existing, ...metadata, prRecordedAt: new Date().toISOString() }),
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));
}

function parseBlob(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function legionGitService(db: Db) {
  const taskBranches = new Map<string, string>();

  async function getTask(taskId: string): Promise<Task | null> {
    return db.select().from(tasks).where(eq(tasks.id, taskId)).then((rows) => rows[0] ?? null);
  }

  async function getConfigForTask(taskId: string): Promise<GitConfig | null> {
    const row = await db
      .select({ config: legionGitConfig })
      .from(tasks)
      .innerJoin(goals, eq(tasks.goalId, goals.id))
      .innerJoin(legionGitConfig, eq(goals.companyId, legionGitConfig.companyId))
      .where(eq(tasks.id, taskId))
      .then((rows) => rows[0] ?? null);
    return row?.config ?? null;
  }

  return {
    async createTaskBranch(taskId: string, task: Task): Promise<GitResult | null> {
      const config = await getConfigForTask(taskId);
      if (!config?.repositoryPath) return null;
      const branchName = `legion/${taskId.slice(0, 8)}/${slugify(task.title)}`;
      await git(config.repositoryPath, ["fetch", "--all", "--prune"]).catch(() => "");
      await git(config.repositoryPath, ["checkout", config.defaultBranch]);
      const commitHash = await git(config.repositoryPath, ["rev-parse", "HEAD"]);
      await git(config.repositoryPath, ["checkout", "-B", branchName]);
      taskBranches.set(taskId, branchName);
      return { branchName, commitHash };
    },

    async commitTask(taskId: string, files: string[], message: string): Promise<GitResult> {
      const config = await getConfigForTask(taskId);
      if (!config?.repositoryPath) throw new Error("Legion git repository is not configured");
      const task = await getTask(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);
      const branchName = (await this.getTaskBranch(taskId)) ?? (await this.createTaskBranch(taskId, task))?.branchName;
      if (!branchName) throw new Error("Legion task branch could not be created");
      await git(config.repositoryPath, ["checkout", branchName]);
      if (files.length > 0) await git(config.repositoryPath, ["add", "--", ...files]);
      const summary = message.trim() || "update task artifacts";
      await git(config.repositoryPath, ["commit", "-m", `[legion] ${task.title}: ${summary}`]);
      const commitHash = await git(config.repositoryPath, ["rev-parse", "HEAD"]);
      taskBranches.set(taskId, branchName);
      return { commitHash, branchName };
    },

    async createPullRequest(taskId: string, options: PullRequestOptions): Promise<{ prUrl: string; prNumber: number } | null> {
      const config = await getConfigForTask(taskId);
      if (!config?.repositoryPath || !config.autoPr) return null;
      const branchName = await this.getTaskBranch(taskId);
      if (!branchName) return null;
      const task = await getTask(taskId);
      const taskHandoffs = await db.select().from(handoffs).where(eq(handoffs.taskId, taskId));
      const body = [
        options.body,
        "",
        "## Legion task",
        task ? `Description: ${task.description ?? ""}` : "",
        task ? `Acceptance criteria: ${task.verificationCriteria ?? ""}` : "",
        "",
        "## Handoffs",
        ...taskHandoffs.map((handoff) => `- ${handoff.artifactType}: ${handoff.artifactPath} — ${handoff.summary ?? ""}`),
      ].join("\n");
      try {
        const output = await execFileAsync("gh", ["pr", "create", "--repo", config.repositoryPath, "--base", options.baseBranch, "--head", branchName, "--title", options.title, "--body", body], { maxBuffer: 1024 * 1024 });
        const prUrl = output.stdout.trim().split(/\s+/)[0] ?? "";
        const number = Number(prUrl.match(/\/(\d+)$/)?.[1] ?? 0);
        if (!prUrl || !number) return null;
        // Phase 9: record PR coordinates on the task so ci-watcher and
        // merge services can find them without re-deriving from `gh`.
        await persistPrMetadata(db, taskId, {
          prUrl,
          prNumber: number,
          branchName,
        });
        return { prUrl, prNumber: number };
      } catch {
        return null;
      }
    },

    async getTaskBranch(taskId: string): Promise<string | null> {
      if (taskBranches.has(taskId)) return taskBranches.get(taskId) ?? null;
      const task = await getTask(taskId);
      if (!task) return null;
      return `legion/${taskId.slice(0, 8)}/${slugify(task.title)}`;
    },
  };
}
