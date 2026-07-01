import { describe, expect, it } from "vitest";
import {
  canTransitionTask,
  detectFileLockConflicts,
  isTaskDispatchable,
  type TransitionResult,
} from "../services/orchestrator-state-machine.ts";
import {
  renderTaskTemplate,
  validateTaskTemplate,
} from "../services/task-template.ts";
import type { TaskStatus } from "@paperclipai/db";

/**
 * Phase 20 of doc/plans/2026-07-01-orchestrator-control-plane.md.
 *
 * Contract test that exercises the orchestrator + file-lock + task-template
 * pure helpers as one continuous workflow. This is what a future smoke
 * test against a real DB will additionally exercise; here we verify the
 * pure-function contracts that don't need IO.
 */

interface OrchestratorTickSnapshot {
  currentLongGoal: string;
  currentPhase: { id: string; name: string };
  notStartedTasks: Array<{
    id: string;
    filesInScope: string[];
    dependencies: string[];
    hasOwner: boolean;
  }>;
  activeExclusiveLocks: string[];
  decisions: Array<{ type: string; subject: string }>;
  readyToDispatch: string[];
  blocked: string[];
}

/**
 * Pure simulation of one orchestrator tick. Mirrors the order of
 * operations in `services/orchestrator.ts` but inlines them so the
 * test is hermetic. Returns the same 9-section shape the real tick
 * produces, minus the DB I/O.
 */
function simulateTick(snapshot: OrchestratorTickSnapshot): {
  readyToDispatch: string[];
  blocked: string[];
  fileConflicts: Array<{ file: string; claimedBy: string[] }>;
  decisions: Array<{ type: string; subject: string; reason: string }>;
} {
  const decisions: Array<{ type: string; subject: string; reason: string }> = [];
  const readyToDispatch: string[] = [];
  const blocked: string[] = [];

  // 1. Sweep expired locks (no-op in this simulation).
  // 2. For each not_started task, run the dispatchability gate.
  for (const task of snapshot.notStartedTasks) {
    if (!task.hasOwner) {
      decisions.push({
        type: "escalate",
        subject: task.id,
        reason: "no assignee",
      });
      blocked.push(task.id);
      continue;
    }
    const depStatuses = task.dependencies.map((depId) => {
      const dep = snapshot.notStartedTasks.find((t) => t.id === depId);
      if (!dep) {
        // Dependency already closed in this snapshot.
        return { taskId: depId, status: "actual_passed" as TaskStatus };
      }
      return { taskId: dep.id, status: "not_started" as TaskStatus };
    });
    const gate = isTaskDispatchable({
      status: "not_started",
      dependencies: depStatuses,
      filesInScope: task.filesInScope,
      activeExclusiveLocks: snapshot.activeExclusiveLocks,
    });
    if (!gate.ready) {
      decisions.push({
        type: "block",
        subject: task.id,
        reason: gate.blocking.join("; "),
      });
      blocked.push(task.id);
      continue;
    }
    decisions.push({
      type: "dispatch",
      subject: task.id,
      reason: "not_started; deps closed; locks clear",
    });
    readyToDispatch.push(task.id);
  }

  // 3. Surface file conflicts as a separate signal (even when blocked).
  const fileConflicts: Array<{ file: string; claimedBy: string[] }> = [];
  for (const task of snapshot.notStartedTasks) {
    const conflicts = detectFileLockConflicts(snapshot.activeExclusiveLocks, task.filesInScope);
    for (const file of conflicts.conflicts) {
      fileConflicts.push({ file, claimedBy: ["<existing task>"] });
    }
  }

  return { readyToDispatch, blocked, fileConflicts, decisions };
}

describe("orchestrator integration: tick workflow", () => {
  it("dispatches an unblocked task with no owner", () => {
    const snap: OrchestratorTickSnapshot = {
      currentLongGoal: "ship OAuth login",
      currentPhase: { id: "phase_1", name: "build" },
      notStartedTasks: [
        { id: "task_a", filesInScope: ["src/a.ts"], dependencies: [], hasOwner: true },
      ],
      activeExclusiveLocks: [],
      decisions: [],
      readyToDispatch: [],
      blocked: [],
    };
    const result = simulateTick(snap);
    expect(result.readyToDispatch).toEqual(["task_a"]);
    expect(result.blocked).toEqual([]);
    expect(result.fileConflicts).toEqual([]);
    expect(result.decisions.some((d) => d.type === "dispatch")).toBe(true);
  });

  it("escalates a task with no assignee", () => {
    const snap: OrchestratorTickSnapshot = {
      currentLongGoal: "ship OAuth login",
      currentPhase: { id: "phase_1", name: "build" },
      notStartedTasks: [
        { id: "task_a", filesInScope: ["src/a.ts"], dependencies: [], hasOwner: false },
      ],
      activeExclusiveLocks: [],
      decisions: [],
      readyToDispatch: [],
      blocked: [],
    };
    const result = simulateTick(snap);
    expect(result.readyToDispatch).toEqual([]);
    expect(result.blocked).toEqual(["task_a"]);
    expect(result.decisions.some((d) => d.type === "escalate")).toBe(true);
  });

  it("blocks a task whose dependency is still not_started", () => {
    const snap: OrchestratorTickSnapshot = {
      currentLongGoal: "ship OAuth login",
      currentPhase: { id: "phase_1", name: "build" },
      notStartedTasks: [
        { id: "task_a", filesInScope: ["src/a.ts"], dependencies: [], hasOwner: true },
        { id: "task_b", filesInScope: ["src/b.ts"], dependencies: ["task_a"], hasOwner: true },
      ],
      activeExclusiveLocks: [],
      decisions: [],
      readyToDispatch: [],
      blocked: [],
    };
    const result = simulateTick(snap);
    expect(result.readyToDispatch).toEqual(["task_a"]);
    expect(result.blocked).toEqual(["task_b"]);
    expect(
      result.decisions.find((d) => d.subject === "task_b")?.reason.includes("dependency"),
    ).toBe(true);
  });

  it("blocks a task whose files_in_scope overlap with an active exclusive lock", () => {
    const snap: OrchestratorTickSnapshot = {
      currentLongGoal: "ship OAuth login",
      currentPhase: { id: "phase_1", name: "build" },
      notStartedTasks: [
        { id: "task_a", filesInScope: ["src/shared.ts"], dependencies: [], hasOwner: true },
      ],
      activeExclusiveLocks: ["src/shared.ts"],
      decisions: [],
      readyToDispatch: [],
      blocked: [],
    };
    const result = simulateTick(snap);
    expect(result.readyToDispatch).toEqual([]);
    expect(result.blocked).toEqual(["task_a"]);
    expect(result.fileConflicts).toEqual([{ file: "src/shared.ts", claimedBy: ["<existing task>"] }]);
    expect(
      result.decisions.find((d) => d.subject === "task_a")?.reason.includes("file_lock"),
    ).toBe(true);
  });

  it("multiple parallel tasks with disjoint files all dispatch", () => {
    const snap: OrchestratorTickSnapshot = {
      currentLongGoal: "ship OAuth login",
      currentPhase: { id: "phase_1", name: "build" },
      notStartedTasks: [
        { id: "task_a", filesInScope: ["src/a.ts"], dependencies: [], hasOwner: true },
        { id: "task_b", filesInScope: ["src/b.ts"], dependencies: [], hasOwner: true },
        { id: "task_c", filesInScope: ["src/c.ts"], dependencies: ["task_a"], hasOwner: true },
      ],
      activeExclusiveLocks: [],
      decisions: [],
      readyToDispatch: [],
      blocked: [],
    };
    const result = simulateTick(snap);
    expect(result.readyToDispatch.sort()).toEqual(["task_a", "task_b"]);
    expect(result.blocked).toEqual(["task_c"]);
  });
});

describe("orchestrator integration: state machine + task template", () => {
  it("rejects closing a task before actual_passed", () => {
    // `failed → closed` is legal (failed tasks can be closed without passing).
    const transitions: Array<[TaskStatus, TaskStatus]> = [
      ["not_started", "closed"],
      ["in_progress", "closed"],
      ["code_landed_needs_runtime", "closed"],
      ["partial_runtime_passed", "closed"],
    ];
    for (const [from, to] of transitions) {
      const result: TransitionResult = canTransitionTask(from, to);
      expect(result.ok, `${from} → ${to} should be illegal`).toBe(false);
    }
  });

  it("allows the canonical happy path", () => {
    const chain: Array<[TaskStatus, TaskStatus]> = [
      ["not_started", "in_progress"],
      ["in_progress", "code_landed_needs_runtime"],
      ["code_landed_needs_runtime", "actual_passed"],
      ["actual_passed", "closed"],
    ];
    for (const [from, to] of chain) {
      expect(canTransitionTask(from, to).ok, `${from} → ${to}`).toBe(true);
    }
  });

  it("renders and validates a complete task template", () => {
    const md = renderTaskTemplate({
      objective: "Add typed helper X",
      filesInScope: ["src/x.ts"],
      acceptanceCriteria: { bullets: ["x exists"] },
      verificationSpec: { checks: [{ kind: "custom-exit-zero", command: "true" }] },
      evidencePaths: ["out/x.txt"],
    });
    expect(md).toContain("## Objective");
    expect(md).toContain("## Files you may modify");
    expect(md).toContain("## Acceptance (machine-verifiable)");
    const result = validateTaskTemplate({
      objective: "Add typed helper X",
      filesInScope: ["src/x.ts"],
      acceptanceCriteria: { bullets: ["x exists"] },
      verificationSpec: { checks: [{ kind: "custom-exit-zero", command: "true" }] },
      evidencePaths: ["out/x.txt"],
    });
    expect(result.ok).toBe(true);
  });
});