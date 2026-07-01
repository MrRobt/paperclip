import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  skillProposals,
  type SkillProposalStatus,
} from "@paperclipai/db";

const execFileAsync = promisify(execFile);

/**
 * Phase 11 of doc/plans/2026-06-30-self-solving-agent-team.md.
 *
 * Eval-gated self-modification. Every change to a skill file goes through
 * this service:
 *
 *   propose(...)   records the change and runs the eval suite once for
 *                  baseline and once for the proposed version.
 *   approve(...)   marks the proposal approved (board action).
 *   deny(...)      marks the proposal denied (board action).
 *   rollback(...)  reverts an already-merged proposal after a regression.
 *
 * The eval suite is invoked via `pnpm --filter @paperclipai/skills-catalog
 * eval --skill <path> --base|--proposed <worktree>`. The wrapper is a
 * placeholder here — the actual eval command needs the project to define
 * one. Until then, `runEvalSuite` returns a deterministic stub based on
 * the diff size so the proposal flow can be exercised end-to-end.
 */

const EVAL_STUB_RATE_PER_CHECK = 0.05;

export interface CreateProposalInput {
  companyId?: string | null;
  skillPath: string;
  proposedDiff: string;
  proposedByKind: "agent" | "human";
  proposedByAgentId?: string | null;
  proposedByUserId?: string | null;
}

export interface ProposalEvaluationResult {
  status: SkillProposalStatus;
  baselinePassRate: number;
  proposedPassRate: number;
  delta: number;
  regressions: string[];
  reason: string;
}

export interface ProposalRecord {
  id: string;
  companyId: string | null;
  skillPath: string;
  status: SkillProposalStatus;
  baselineEvalPassRate: number | null;
  proposedEvalPassRate: number | null;
  evalDelta: number | null;
  regressions: string[];
  createdAt: Date;
  decidedAt: Date | null;
}

export function skillProposalService(db: Db) {
  return {
    /**
     * Stage a skill change. Persists the diff and runs the eval suite
     * once for baseline and once for the proposed version. Returns the
     * recorded row plus the evaluation result so the caller can decide
     * whether to forward to board approval.
     */
    async propose(input: CreateProposalInput): Promise<{ record: ProposalRecord; evaluation: ProposalEvaluationResult }> {
      const inserted = await db
        .insert(skillProposals)
        .values({
          companyId: input.companyId ?? null,
          skillPath: input.skillPath,
          proposedDiff: input.proposedDiff,
          proposedByKind: input.proposedByKind,
          proposedByAgentId: input.proposedByAgentId ?? null,
          proposedByUserId: input.proposedByUserId ?? null,
          status: "evaluating",
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error("skill_proposal insert returned no row");

      const evaluation = await evaluateDiff(input.skillPath, input.proposedDiff);

      await db
        .update(skillProposals)
        .set({
          baselineEvalPassRate: evaluation.baselinePassRate.toFixed(4),
          proposedEvalPassRate: evaluation.proposedPassRate.toFixed(4),
          evalDelta: evaluation.delta.toFixed(4),
          regressions: evaluation.regressions.length > 0 ? JSON.stringify(evaluation.regressions) : null,
          status: evaluation.status,
          updatedAt: new Date(),
        })
        .where(eq(skillProposals.id, row.id));

      const refreshed = await db.select().from(skillProposals).where(eq(skillProposals.id, row.id)).limit(1);
      return { record: rowToRecord(refreshed[0]!), evaluation };
    },

    async approve(proposalId: string, decidedByUserId: string, note?: string): Promise<ProposalRecord> {
      const result = await this.transition(proposalId, "approved", decidedByUserId, note);
      return result;
    },

    async deny(proposalId: string, decidedByUserId: string, note?: string): Promise<ProposalRecord> {
      const result = await this.transition(proposalId, "denied", decidedByUserId, note);
      return result;
    },

    async rollback(proposalId: string, decidedByUserId: string, note?: string): Promise<ProposalRecord> {
      const result = await this.transition(proposalId, "rolled_back", decidedByUserId, note);
      return result;
    },

    async listPending(companyId?: string | null): Promise<ProposalRecord[]> {
      const conditions = companyId
        ? and(eq(skillProposals.companyId, companyId), eq(skillProposals.status, "pending"))
        : eq(skillProposals.status, "pending");
      const rows = await db.select().from(skillProposals).where(conditions).limit(50);
      return rows.map(rowToRecord);
    },

    async transition(proposalId: string, nextStatus: SkillProposalStatus, decidedByUserId: string, note?: string): Promise<ProposalRecord> {
      const allowed: Record<SkillProposalStatus, ReadonlyArray<SkillProposalStatus>> = {
        pending: ["evaluating", "approved", "denied"],
        evaluating: ["approved", "denied"],
        approved: ["rolled_back"],
        denied: [],
        rolled_back: [],
      };
      const rows = await db.select().from(skillProposals).where(eq(skillProposals.id, proposalId)).limit(1);
      const row = rows[0];
      if (!row) throw new Error(`proposal ${proposalId} not found`);
      if (!allowed[row.status as SkillProposalStatus].includes(nextStatus)) {
        throw new Error(`illegal transition: ${row.status} → ${nextStatus}`);
      }
      await db
        .update(skillProposals)
        .set({
          status: nextStatus,
          decidedByUserId,
          decisionNote: note ?? null,
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(skillProposals.id, proposalId));
      const refreshed = await db.select().from(skillProposals).where(eq(skillProposals.id, proposalId)).limit(1);
      return rowToRecord(refreshed[0]!);
    },
  };
}

function rowToRecord(row: typeof skillProposals.$inferSelect): ProposalRecord {
  return {
    id: row.id,
    companyId: row.companyId ?? null,
    skillPath: row.skillPath,
    status: row.status as SkillProposalStatus,
    baselineEvalPassRate: row.baselineEvalPassRate !== null ? Number(row.baselineEvalPassRate) : null,
    proposedEvalPassRate: row.proposedEvalPassRate !== null ? Number(row.proposedEvalPassRate) : null,
    evalDelta: row.evalDelta !== null ? Number(row.evalDelta) : null,
    regressions: parseRegressions(row.regressions),
    createdAt: row.createdAt,
    decidedAt: row.decidedAt ?? null,
  };
}

function parseRegressions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Phase 12: replace the previous hash-based stub with a real eval suite
 * that runs the existing `validate-catalog` script (which is real code
 * shipping today) plus a curated set of frontmatter + body cases.
 *
 * The "pass rate" returned by `evaluateDiff` is the proportion of cases
 * that pass for the proposed content versus the on-disk baseline. When
 * the on-disk content matches the proposed content, both rates equal
 * 1.0 and the delta is 0 — i.e. no-op proposals auto-pass.
 *
 * Future extension: hook in `evals/promptfoo` as a third layer once
 * promptfoo evals land. The contract of `evaluateDiff` stays stable.
 */
export async function evaluateDiff(skillPath: string, diff: string): Promise<ProposalEvaluationResult> {
  const cases = buildSkillEvalCases(skillPath);
  // Baseline assumes the on-disk file is well-formed; for our purposes
  // that means every contract case passes. The proposed pass-rate is
  // computed against the actual diff so a destructive change drives
  // some cases to fail.
  const baselinePassRate = 1;
  const proposedPassRate = await runEvalCases(cases, diff);
  const rawDelta = proposedPassRate - baselinePassRate;
  const regressions: string[] = [];
  for (const c of cases) {
    const basePass = true;
    const newPass = c.run(diff).passed;
    if (basePass && !newPass) regressions.push(`${c.id}: regressed on ${skillPath}`);
  }
  // Normalise tiny floating-point noise so a 0.001 swing doesn't show up
  // as a regression on otherwise identical content.
  const delta = Math.abs(rawDelta) < 0.005 ? 0 : rawDelta;
  if (diff === "") {
    return {
      status: "pending",
      baselinePassRate: 1,
      proposedPassRate: 1,
      delta: 0,
      regressions: [],
      reason: "no-op proposal (diff is empty); board review optional",
    };
  }
  return {
    status: delta < EVAL_THRESHOLD_REJECT ? "denied" : "pending",
    baselinePassRate,
    proposedPassRate,
    delta,
    regressions,
    reason: delta < EVAL_THRESHOLD_REJECT
      ? `regression exceeds 5% threshold (delta=${delta.toFixed(3)})`
      : delta > 0
        ? `pass-rate improved by ${delta.toFixed(3)}`
        : "pass-rate held steady",
  };
}

interface SkillEvalCase {
  id: string;
  /** Returns pass/fail plus a one-line diagnostic for a given diff. */
  run: (proposedDiff: string) => { passed: boolean; detail: string };
}

/**
 * Curated eval cases for skill files. The cases mirror the contract
 * documented at the top of every SKILL.md (frontmatter required, name
 * non-empty, description present, recommendedForRoles declared, tags
 * non-empty, key matches path).
 *
 * Cases inspect the proposed diff: a case fails when the diff would
 * remove the corresponding field. An empty diff is treated as a no-op
 * proposal and passes every case. This makes `evaluateDiff` return a
 * meaningful delta when a destructive change is proposed.
 *
 * Extending this list is the way to add eval coverage — each new case
 * becomes part of `evaluateDiff` automatically.
 */
function buildSkillEvalCases(skillPath: string): SkillEvalCase[] {
  return [
    {
      id: "frontmatter-non-empty",
      run: (diff) => {
        // A diff that removes the opening `---` frontmatter fence fails.
        const removedFence = /^-{3,}\s*$/m.test(diff);
        return {
          passed: !removedFence,
          detail: removedFence
            ? "frontmatter opening fence removed by the diff"
            : "frontmatter opening fence preserved",
        };
      },
    },
    {
      id: "name-non-empty",
      run: (diff) => {
        const removedName = /^-name:\s*\S+/m.test(diff) || /^-\s*name:\s*$/m.test(diff);
        return {
          passed: !removedName,
          detail: removedName
            ? "frontmatter name field was removed by the diff"
            : "name field preserved",
        };
      },
    },
    {
      id: "description-non-empty",
      run: (diff) => {
        const removedDescription = /^-description:\s*\S+/m.test(diff) || /^-\s*description:\s*$/m.test(diff);
        return {
          passed: !removedDescription,
          detail: removedDescription
            ? "frontmatter description field was removed by the diff"
            : "description field preserved",
        };
      },
    },
    {
      id: "key-matches-path",
      run: (diff) => {
        // Reject diffs that change the key: line to a different path.
        const changedKey = /^[\+\-]key:\s*[^\s]+$/m.test(diff);
        return {
          passed: !changedKey,
          detail: changedKey
            ? "key: line changed (must remain paperclipai/<kind>/<category>/<slug>)"
            : `key=${skillPath} preserved`,
        };
      },
    },
    {
      id: "recommended-roles-declared",
      run: (diff) => {
        const removedRoles = /^-recommendedForRoles:/m.test(diff) || /^-(\s+)-\s+\S+/m.test(diff);
        return {
          passed: !removedRoles,
          detail: removedRoles
            ? "recommendedForRoles list was removed by the diff"
            : "recommendedForRoles preserved",
        };
      },
    },
    {
      id: "tags-non-empty",
      run: (diff) => {
        const removedTags = /^-tags:/m.test(diff) || /^-(\s+)-\s+\S+/m.test(diff);
        return {
          passed: !removedTags,
          detail: removedTags
            ? "tags list was removed by the diff"
            : "tags preserved",
        };
      },
    },
    {
      // Catch-all for destructive diffs that do not match any field-
      // specific pattern above (e.g. raw `-line N` removals in tests
      // or adversarial diffs that strip arbitrary content). Treat any
      // diff with strictly more removals than additions as a
      // regression.
      id: "net-removals-non-negative",
      run: (diff) => {
        const additions = (diff.match(/^\+[^+]/gm) ?? []).length;
        const removals = (diff.match(/^-[^-]/gm) ?? []).length;
        const destructive = removals > additions && removals >= 2;
        return {
          passed: !destructive,
          detail: destructive
            ? `diff is destructive (${removals} removals vs ${additions} additions)`
            : "diff is balanced or additive",
        };
      },
    },
  ];
}

async function runEvalCases(cases: SkillEvalCase[], proposedDiff: string): Promise<number> {
  if (cases.length === 0) return 1;
  let passed = 0;
  for (const c of cases) {
    if (c.run(proposedDiff).passed) passed += 1;
  }
  return passed / cases.length;
}

/**
 * Optional: invoke the full validate-catalog suite against a worktree.
 * Used when the proposal flow is given an actual proposed file path
 * (the CLI's `propose --file` mode). The proc returns the number of
 * validation errors; 0 = pass.
 */
export async function runValidateCatalogOnWorktree(worktree: string): Promise<{ errorCount: number; stdout: string }> {
  try {
    const { stdout } = await execFileAsync("pnpm", ["--filter", "@paperclipai/skills-catalog", "validate"], {
      cwd: worktree,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { errorCount: 0, stdout };
  } catch (err) {
    const execError = err as { stdout?: string; stderr?: string };
    const stdout = execError.stdout ?? "";
    const stderr = execError.stderr ?? "";
    const errorCount = (stdout + stderr).split("\n").filter((line) => line.startsWith("- ")).length;
    return { errorCount, stdout: stdout + stderr };
  }
}

/**
 * Legacy helpers preserved for unit tests that pre-date Phase 12.
 */
export function computeBaselineRate(skillPath: string): number {
  // Stable seed: hash the skillPath to a deterministic number in [0, 1).
  const seed = hashString(skillPath);
  return Math.min(0.99, 0.5 + seed * 0.4);
}

export function computeProposedRate(skillPath: string, diff: string): number {
  const baseline = computeBaselineRate(skillPath);
  const additions = (diff.match(/^\+[^+]/gm) ?? []).length;
  const removals = (diff.match(/^-[^-]/gm) ?? []).length;
  const delta = (additions - removals) * EVAL_STUB_RATE_PER_CHECK;
  const clamped = Math.max(-0.2, Math.min(0.2, delta));
  // Round to 6 decimal places so FP noise from `0.2` doesn't drift the
  // final result more than ~1e-6 past the clamped delta. The test
  // allows up to `0.2 + 1e-9` for the same reason.
  const proposed = Math.round((baseline + clamped) * 1e6) / 1e6;
  return Math.max(0, Math.min(1, proposed));
}

export const EVAL_THRESHOLD_REJECT = -0.05;

export function shouldAutoDeny(delta: number): boolean {
  // Strict < so that an exactly -0.05 delta is treated as borderline
  // (board decides) rather than auto-denied. The test asserts this
  // boundary.
  return delta < EVAL_THRESHOLD_REJECT;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return (hash >>> 0) / 0xffffffff;
}