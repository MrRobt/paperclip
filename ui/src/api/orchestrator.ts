/**
 * Phase 18 of doc/plans/2026-07-01-orchestrator-control-plane.md.
 *
 * API client for orchestrator + file-locks + project-context + contracts
 * + runtime-leases endpoints backed by `server/src/routes/orchestrator.ts`.
 *
 * The orchestrator is the main control loop of a Paperclip multi-agent
 * team. This client lets the UI trigger ticks, fetch the 9-section
 * output, list active file locks, and read/write project context.
 */

import { api } from "./client.js";

export type TaskStatus =
  | "not_started"
  | "in_progress"
  | "blocked"
  | "code_landed_needs_runtime"
  | "partial_runtime_passed"
  | "actual_passed"
  | "failed"
  | "closed";

export type OrchestratorDecisionType =
  | "block"
  | "unblock"
  | "reassign"
  | "escalate"
  | "force_close"
  | "acquire_lock"
  | "release_lock"
  | "dispatch"
  | "abort";

export interface OrchestratorDecision {
  type: OrchestratorDecisionType;
  subject: string;
  reason: string;
  ts: string;
  payload?: Record<string, unknown>;
}

export interface OrchestratorDispatch {
  taskId: string;
  agentId: string;
  ts: string;
  reason: string;
}

export interface OrchestratorFileLockAction {
  action: "acquire" | "release";
  filePath: string;
  taskId: string;
  agentId: string;
  ts: string;
  lockType: "exclusive" | "shared";
}

export interface OrchestratorTickOutput {
  runId: string;
  currentLongGoal: string | null;
  currentPhase: { id: string; name: string; status: string } | null;
  completedTasks: Array<{ id: string; title: string; actualPassedAt: string | null }>;
  partialTasks: Array<{ id: string; title: string; status: TaskStatus; blockedBy: string[] }>;
  blockedTasks: Array<{ id: string; title: string; ownerAgentId: string | null; reason: string }>;
  readyToDispatch: Array<{ id: string; title: string; filesInScope: string[]; agentMatch: boolean }>;
  fileConflicts: Array<{ file: string; claimedBy: string[] }>;
  contextUpdates: Array<{ section: string; change: string }>;
  nextDispatch: OrchestratorDispatch[];
  decisions: OrchestratorDecision[];
}

export interface OrchestratorRun {
  id: string;
  companyId: string;
  orchestratorAgentId: string;
  startedAt: string;
  endedAt: string | null;
  triggerKind: string;
  status: "running" | "succeeded" | "failed" | "escalated";
  decisions: OrchestratorDecision[] | null;
  dispatches: OrchestratorDispatch[] | null;
  fileLockActions: OrchestratorFileLockAction[] | null;
  summary: string | null;
  errorMessage: string | null;
}

export interface FileLockRow {
  id: string;
  companyId: string;
  taskId: string;
  agentId: string;
  filePath: string;
  lockType: "exclusive" | "shared";
  acquiredAt: string;
  expiresAt: string;
  releasedAt: string | null;
  releaseReason: string | null;
}

export interface ProjectContextEntry {
  id: string;
  companyId: string;
  currentLongGoalId: string | null;
  currentPhaseId: string | null;
  completedFeatures: unknown;
  partialFeatures: unknown;
  blockedItems: unknown;
  risks: unknown;
  keyDecisions: unknown;
  staleDocPaths: string | null;
  verifiedFacts: unknown;
  investigatedConclusions: unknown;
  agentCollaborationRules: unknown;
  nextPriority: string | null;
  updatedByAgentId: string | null;
  updatedAt: string;
}

export const orchestratorApi = {
  async tick(input: {
    companyId: string;
    orchestratorAgentId: string;
    triggerKind?: "manual" | "scheduled" | "event" | "escalation";
  }): Promise<OrchestratorTickOutput> {
    return api.post<OrchestratorTickOutput>("/api/orchestrator/tick", input);
  },

  async listRuns(companyId: string): Promise<OrchestratorRun[]> {
    return api.get<OrchestratorRun[]>(`/api/orchestrator/runs?companyId=${encodeURIComponent(companyId)}`);
  },

  async listFileLocks(filter?: { taskId?: string; filePath?: string }): Promise<FileLockRow[]> {
    const params = new URLSearchParams();
    if (filter?.taskId) params.set("taskId", filter.taskId);
    if (filter?.filePath) params.set("filePath", filter.filePath);
    const query = params.toString();
    return api.get<FileLockRow[]>(`/api/file-locks${query ? `?${query}` : ""}`);
  },

  async acquireFileLocks(input: {
    taskId: string;
    agentId: string;
    files: string[];
    lockType?: "exclusive" | "shared";
    expiryHours?: number;
  }): Promise<{ ok: boolean; acquired: string[]; conflicts?: string[]; expiresAt: string }> {
    return api.post("/api/file-locks/acquire", input);
  },

  async releaseFileLocks(input: {
    taskId: string;
    files?: string[];
    reason?: string;
  }): Promise<{ released: string[] }> {
    return api.post("/api/file-locks/release", input);
  },

  async getProjectContext(companyId: string): Promise<ProjectContextEntry | null> {
    return api.get<ProjectContextEntry | null>(`/api/companies/${companyId}/project-context`);
  },

  async putProjectContext(input: {
    companyId: string;
    currentLongGoalId?: string | null;
    currentPhaseId?: string | null;
    completedFeatures?: unknown;
    partialFeatures?: unknown;
    blockedItems?: unknown;
    risks?: unknown;
    keyDecisions?: unknown;
    staleDocPaths?: string;
    verifiedFacts?: unknown;
    investigatedConclusions?: unknown;
    agentCollaborationRules?: unknown;
    nextPriority?: string;
    updatedByAgentId?: string | null;
  }): Promise<ProjectContextEntry> {
    return api.put<ProjectContextEntry>(
      `/api/companies/${input.companyId}/project-context`,
      input,
    );
  },
};