import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { fileLocks, goals, tasks } from "@paperclipai/db";
import { detectFileLockConflicts } from "./orchestrator-state-machine.js";

/**
 * Phase 16 of doc/plans/2026-07-01-orchestrator-control-plane.md.
 *
 * File-level lock service. Every task must declare its
 * `files_in_scope` (Phase 16.2) before dispatch; the orchestrator
 * calls `acquireMany` to reserve them. Conflicts return 409 with the
 * list of files already held.
 */

const DEFAULT_EXPIRY_HOURS = 24;

export interface AcquireRequest {
  taskId: string;
  agentId: string;
  files: string[];
  /** Exclusive by default; pass "shared" for read-only consumers. */
  lockType?: "exclusive" | "shared";
  /** Custom expiry in hours; default 24h. */
  expiryHours?: number;
}

export interface AcquireResult {
  acquired: string[];
  conflicts: string[];
  expiresAt: Date;
}

export interface ReleaseRequest {
  taskId: string;
  /** Optional: only release these paths; default = all active for the task. */
  files?: string[];
  /** "completed" | "expired" | "force_released" | "conflict_resolution". */
  reason?: string;
}

/**
 * Resolve the companyId for a task via task.goal.companyId. Returns
 * null when the task doesn't exist; callers must reject the request
 * before calling acquireMany in that case.
 */
async function resolveCompanyIdForTask(db: Db, taskId: string): Promise<string | null> {
  const rows = await db
    .select({ companyId: goals.companyId })
    .from(tasks)
    .innerJoin(goals, eq(tasks.goalId, goals.id))
    .where(eq(tasks.id, taskId))
    .limit(1);
  return rows[0]?.companyId ?? null;
}

export function fileLockService(db: Db) {
  return {
    /**
     * Atomically reserve every requested path for the task. On
     * conflict, no partial acquire happens — the entire request is
     * rejected (callers should split and retry). Matches the
     * "no two agents touch the same file" semantic.
     */
    async acquireMany(req: AcquireRequest): Promise<AcquireResult> {
      if (req.files.length === 0) {
        return { acquired: [], conflicts: [], expiresAt: new Date() };
      }
      const lockType = req.lockType ?? "exclusive";
      const expiry = new Date(Date.now() + (req.expiryHours ?? DEFAULT_EXPIRY_HOURS) * 60 * 60_000);

      const companyId = await resolveCompanyIdForTask(db, req.taskId);
      if (!companyId) {
        return {
          acquired: [],
          conflicts: req.files,
          expiresAt: expiry,
        };
      }

      // Two-phase conflict check:
      //  1. Pull currently-active exclusive locks for the requested files.
      //  2. Refuse if any belong to a different task.
      const conflicts = await db
        .select({ id: fileLocks.id, filePath: fileLocks.filePath, taskId: fileLocks.taskId })
        .from(fileLocks)
        .where(
          and(
            inArray(fileLocks.filePath, req.files),
            isNull(fileLocks.releasedAt),
            lockType === "exclusive" ? eq(fileLocks.lockType, "exclusive") : sql`true`,
          ),
        );
      const blockingFiles = conflicts
        .filter((c) => c.taskId !== req.taskId)
        .map((c) => c.filePath);

      if (blockingFiles.length > 0) {
        return { acquired: [], conflicts: blockingFiles, expiresAt: expiry };
      }

      // Upsert: if the same task already holds a lock for a path, refresh
      // its expiry.
      for (const file of req.files) {
        const existing = await db
          .select({ id: fileLocks.id })
          .from(fileLocks)
          .where(
            and(
              eq(fileLocks.filePath, file),
              eq(fileLocks.taskId, req.taskId),
              isNull(fileLocks.releasedAt),
            ),
          )
          .limit(1);
        if (existing[0]) {
          await db
            .update(fileLocks)
            .set({ expiresAt: expiry, updatedAt: new Date() })
            .where(eq(fileLocks.id, existing[0].id));
        } else {
          await db.insert(fileLocks).values({
            companyId,
            taskId: req.taskId,
            agentId: req.agentId,
            filePath: file,
            lockType,
            expiresAt: expiry,
          });
        }
      }

      return { acquired: req.files, conflicts: [], expiresAt: expiry };
    },

    /**
     * Release locks held by a task. Default releases every active lock
     * for the task; pass `files` to release a subset.
     */
    async releaseMany(req: ReleaseRequest): Promise<{ released: string[] }> {
      const conditions = [eq(fileLocks.taskId, req.taskId), isNull(fileLocks.releasedAt)];
      if (req.files && req.files.length > 0) {
        conditions.push(inArray(fileLocks.filePath, req.files));
      }
      const rows = await db
        .select({ id: fileLocks.id, filePath: fileLocks.filePath })
        .from(fileLocks)
        .where(and(...conditions));
      if (rows.length === 0) return { released: [] };
      await db
        .update(fileLocks)
        .set({
          releasedAt: new Date(),
          releaseReason: req.reason ?? "completed",
          updatedAt: new Date(),
        })
        .where(inArray(fileLocks.id, rows.map((r) => r.id)));
      return { released: rows.map((r) => r.filePath) };
    },

    /**
     * Pure helper: given a set of currently-held exclusive locks and a
     * candidate set of paths, return the conflicting and clear paths.
     */
    detectConflicts(activeExclusiveLocks: string[], candidateFiles: string[]) {
      return detectFileLockConflicts(activeExclusiveLocks, candidateFiles);
    },

    /**
     * Sweep expired leases. Called from the orchestrator tick.
     */
    async sweepExpired(): Promise<{ swept: number }> {
      // postgres-js doesn't auto-coerce Date; bind the ISO string explicitly.
      // (Drizzle's lt(..., new Date()) throws ERR_INVALID_ARG_TYPE.)
      const nowIso = new Date().toISOString();
      const expired = await db
        .select({ id: fileLocks.id })
        .from(fileLocks)
        .where(and(isNull(fileLocks.releasedAt), sql`${fileLocks.expiresAt} < ${nowIso}`));
      if (expired.length === 0) return { swept: 0 };
      const releasedAt = new Date(nowIso);
      await db
        .update(fileLocks)
        .set({ releasedAt, releaseReason: "expired", updatedAt: releasedAt })
        .where(inArray(fileLocks.id, expired.map((e) => e.id)));
      return { swept: expired.length };
    },

    /**
     * List active locks, optionally filtered by task or file.
     */
    async listActive(filter?: { taskId?: string; filePath?: string }) {
      const conditions = [isNull(fileLocks.releasedAt)];
      if (filter?.taskId) conditions.push(eq(fileLocks.taskId, filter.taskId));
      if (filter?.filePath) conditions.push(eq(fileLocks.filePath, filter.filePath));
      return db.select().from(fileLocks).where(and(...conditions));
    },
  };
}