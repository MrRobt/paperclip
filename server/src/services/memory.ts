import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  taskPostmortems,
  type RootCauseClass,
} from "@paperclipai/db";

/**
 * Phase 10 of doc/plans/2026-06-30-self-solving-agent-team.md.
 *
 * Cross-run memory for the Legion goal loop. Records a structured
 * postmortem for each completed task attempt (success or failure) and
 * surfaces them as few-shot context when the goal-decomposer plans new
 * goals.
 *
 * Without this, every new goal starts from zero. With it, the same agent
 * team makes the same mistakes less often, and the same successes more
 * often.
 */

const DEFAULT_QUERY_LIMIT = 5;
const MAX_QUERY_LIMIT = 20;
const COARSE_TASK_MINUTES = 240;
const POSTMORTEM_CONTEXT_BUDGET_CHARS = 6000;

export interface RecordPostmortemInput {
  companyId: string;
  goalId?: string | null;
  taskId?: string | null;
  repoPath?: string | null;
  modulePath?: string | null;
  rootCauseClass?: RootCauseClass;
  fixSummary: string;
  commitHash?: string | null;
  branchName?: string | null;
  prUrl?: string | null;
  filesTouched?: string[] | null;
  lessons?: string[] | null;
  attemptNumber?: number;
  passed: boolean;
}

export interface PostmortemRecord {
  id: string;
  companyId: string;
  goalId: string | null;
  taskId: string | null;
  repoPath: string | null;
  modulePath: string | null;
  rootCauseClass: RootCauseClass;
  fixSummary: string;
  commitHash: string | null;
  branchName: string | null;
  prUrl: string | null;
  filesTouched: string[];
  lessons: string[];
  attemptNumber: number;
  passed: boolean;
  createdAt: Date;
}

export interface QueryPostmortemsInput {
  companyId: string;
  /** Optional repo filter — match exactly when provided. */
  repoPath?: string | null;
  /** Optional module prefix filter — matches `module_path LIKE '%module%'`. */
  modulePath?: string | null;
  /** Optional root cause filter (e.g. only `failure` rows when planning a fix). */
  rootCauseClass?: RootCauseClass;
  /** Cap on rows returned. Defaults to 5; max 20. */
  limit?: number;
}

export function memoryService(db: Db) {
  return {
    async recordPostmortem(input: RecordPostmortemInput): Promise<PostmortemRecord> {
      const inserted = await db
        .insert(taskPostmortems)
        .values({
          companyId: input.companyId,
          goalId: input.goalId ?? null,
          taskId: input.taskId ?? null,
          repoPath: input.repoPath ?? null,
          modulePath: input.modulePath ?? null,
          rootCauseClass: input.rootCauseClass ?? "unknown",
          fixSummary: input.fixSummary,
          commitHash: input.commitHash ?? null,
          branchName: input.branchName ?? null,
          prUrl: input.prUrl ?? null,
          filesTouched: input.filesTouched && input.filesTouched.length > 0 ? JSON.stringify(input.filesTouched) : null,
          lessons: input.lessons && input.lessons.length > 0 ? JSON.stringify(input.lessons) : null,
          attemptNumber: input.attemptNumber ?? 1,
          passed: input.passed,
        })
        .returning();
      const row = inserted[0];
      return rowToRecord(row);
    },

    async queryPostmortems(input: QueryPostmortemsInput): Promise<PostmortemRecord[]> {
      const limit = Math.min(Math.max(input.limit ?? DEFAULT_QUERY_LIMIT, 1), MAX_QUERY_LIMIT);
      const conditions = [eq(taskPostmortems.companyId, input.companyId)];
      if (input.repoPath) conditions.push(eq(taskPostmortems.repoPath, input.repoPath));
      if (input.modulePath) conditions.push(sql`${taskPostmortems.modulePath} LIKE ${`%${input.modulePath}%`}`);
      if (input.rootCauseClass) conditions.push(eq(taskPostmortems.rootCauseClass, input.rootCauseClass));
      const rows = await db
        .select()
        .from(taskPostmortems)
        .where(and(...conditions))
        .orderBy(desc(taskPostmortems.createdAt))
        .limit(limit);
      return rows.map(rowToRecord);
    },

    /**
     * Build a compact few-shot prompt fragment summarising the most
     * relevant postmortems for the goal being decomposed. Caller embeds
     * the returned string into the decomposer prompt as a "## Past
     * experience" block. Returns empty string when no postmortems match.
     */
    async buildFewShotContext(input: QueryPostmortemsInput): Promise<string> {
      const rows = await this.queryPostmortems(input);
      if (rows.length === 0) return "";
      const lines: string[] = [];
      let used = 0;
      for (const r of rows) {
        const entry = formatFewShotEntry(r);
        if (used + entry.length > POSTMORTEM_CONTEXT_BUDGET_CHARS) break;
        lines.push(entry);
        used += entry.length;
      }
      return `## Past experience (most recent first)\n\n${lines.join("\n\n")}\n`;
    },
  };
}

/**
 * Pure helpers exposed for tests + the recursive decomposer.
 */
export const COARSE_TASK_DURATION_THRESHOLD_MIN = COARSE_TASK_MINUTES;
export const POSTMORTEM_CONTEXT_BUDGET = POSTMORTEM_CONTEXT_BUDGET_CHARS;

export function isCoarseTask(estimatedDuration: number | null | undefined, description: string | null | undefined): boolean {
  if (typeof estimatedDuration === "number" && estimatedDuration > COARSE_TASK_MINUTES) return true;
  // Description-only heuristic when estimated_duration is missing.
  if (typeof description === "string" && description.length > 1500) return true;
  return false;
}

export function parsePostmortemJsonField<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function formatFewShotEntry(record: PostmortemRecord): string {
  const verdict = record.passed ? "PASS" : "FAIL";
  const rootCause = record.rootCauseClass.toUpperCase();
  const files = record.filesTouched.length > 0 ? ` (files: ${record.filesTouched.slice(0, 3).join(", ")}${record.filesTouched.length > 3 ? "…" : ""})` : "";
  const lessons = record.lessons.length > 0 ? `\nLessons: ${record.lessons.join(" | ")}` : "";
  return `- [${verdict} · ${rootCause}${files}] ${record.fixSummary}${lessons}`;
}

function rowToRecord(row: typeof taskPostmortems.$inferSelect): PostmortemRecord {
  return {
    id: row.id,
    companyId: row.companyId,
    goalId: row.goalId ?? null,
    taskId: row.taskId ?? null,
    repoPath: row.repoPath ?? null,
    modulePath: row.modulePath ?? null,
    rootCauseClass: row.rootCauseClass,
    fixSummary: row.fixSummary,
    commitHash: row.commitHash ?? null,
    branchName: row.branchName ?? null,
    prUrl: row.prUrl ?? null,
    filesTouched: parsePostmortemJsonField<string[]>(row.filesTouched, []),
    lessons: parsePostmortemJsonField<string[]>(row.lessons, []),
    attemptNumber: row.attemptNumber ?? 1,
    passed: row.passed,
    createdAt: row.createdAt,
  };
}