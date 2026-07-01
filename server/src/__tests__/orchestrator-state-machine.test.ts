import { describe, expect, it } from "vitest";
import type { PhaseStatus, TaskStatus } from "@paperclipai/db";
import {
  StateMachineError,
  assertPhaseTransition,
  assertTaskTransition,
  canTransitionPhase,
  canTransitionTask,
  detectFileLockConflicts,
  isTaskDispatchable,
} from "../services/orchestrator-state-machine.ts";

describe("task 8-state machine", () => {
  it("allows the happy-path forward chain", () => {
    const chain: TaskStatus[] = [
      "not_started",
      "in_progress",
      "code_landed_needs_runtime",
      "actual_passed",
      "closed",
    ];
    for (let i = 0; i < chain.length - 1; i += 1) {
      const result = canTransitionTask(chain[i]!, chain[i + 1]!);
      expect(result.ok).toBe(true);
      expect(result.code).toBe("ok");
    }
  });

  it("allows partial_runtime_passed before actual_passed", () => {
    expect(canTransitionTask("code_landed_needs_runtime", "partial_runtime_passed").ok).toBe(true);
    expect(canTransitionTask("partial_runtime_passed", "actual_passed").ok).toBe(true);
  });

  it("allows retry: failed → not_started", () => {
    expect(canTransitionTask("failed", "not_started").ok).toBe(true);
  });

  it("allows failed → closed when retry is not viable", () => {
    expect(canTransitionTask("failed", "closed").ok).toBe(true);
  });

  it("rejects actual_passed → in_progress (cannot un-verify)", () => {
    const result = canTransitionTask("actual_passed", "in_progress");
    expect(result.ok).toBe(false);
    expect(result.code).toBe("illegal_transition");
  });

  it("rejects closed → anywhere", () => {
    for (const to of ["not_started", "in_progress", "actual_passed", "failed"] as const) {
      const result = canTransitionTask("closed", to);
      expect(result.ok).toBe(false);
      expect(result.code).toBe("terminal");
    }
  });

  it("rejects skip-step transitions", () => {
    // not_started cannot jump straight to code_landed_needs_runtime
    expect(canTransitionTask("not_started", "code_landed_needs_runtime").ok).toBe(false);
    // in_progress cannot jump straight to actual_passed
    expect(canTransitionTask("in_progress", "actual_passed").ok).toBe(false);
  });

  it("assertTaskTransition throws structured error on illegal move", () => {
    expect(() => assertTaskTransition("actual_passed", "in_progress")).toThrowError(StateMachineError);
  });

  it("assertTaskTransition passes on legal move", () => {
    expect(() => assertTaskTransition("not_started", "in_progress")).not.toThrow();
  });

  it("rejects unknown status names", () => {
    expect(canTransitionTask("garbage" as TaskStatus, "in_progress").code).toBe("unknown_from");
    expect(canTransitionTask("not_started", "garbage" as TaskStatus).code).toBe("unknown_to");
  });
});

describe("phase 8-state machine", () => {
  it("allows not_started → in_progress → code_landed_needs_runtime → actual_passed → closed", () => {
    expect(canTransitionPhase("not_started", "in_progress").ok).toBe(true);
    expect(canTransitionPhase("in_progress", "code_landed_needs_runtime").ok).toBe(true);
    expect(canTransitionPhase("code_landed_needs_runtime", "actual_passed").ok).toBe(true);
    expect(canTransitionPhase("actual_passed", "closed").ok).toBe(true);
  });

  it("rejects closed → anywhere (phase terminal)", () => {
    expect(canTransitionPhase("closed", "in_progress").code).toBe("terminal");
  });

  it("assertPhaseTransition throws on illegal", () => {
    expect(() => assertPhaseTransition("closed", "not_started")).toThrowError(StateMachineError);
  });

  it("rejects unknown status names", () => {
    expect(canTransitionPhase("oops" as PhaseStatus, "in_progress").code).toBe("unknown_from");
  });
});

describe("detectFileLockConflicts", () => {
  it("returns empty conflicts when no overlap", () => {
    const result = detectFileLockConflicts(
      ["src/a.ts", "src/b.ts"],
      ["src/c.ts", "src/d.ts"],
    );
    expect(result.conflicts).toEqual([]);
    expect(result.clear).toEqual(["src/c.ts", "src/d.ts"]);
  });

  it("flags overlapping paths", () => {
    const result = detectFileLockConflicts(
      ["src/shared/util.ts"],
      ["src/shared/util.ts", "src/new.ts"],
    );
    expect(result.conflicts).toEqual(["src/shared/util.ts"]);
    expect(result.clear).toEqual(["src/new.ts"]);
  });

  it("handles empty inputs gracefully", () => {
    expect(detectFileLockConflicts([], []).conflicts).toEqual([]);
    expect(detectFileLockConflicts([], ["a.ts"]).conflicts).toEqual([]);
    expect(detectFileLockConflicts(["a.ts"], []).conflicts).toEqual([]);
  });
});

describe("isTaskDispatchable", () => {
  it("rejects tasks not in not_started", () => {
    const result = isTaskDispatchable({
      status: "in_progress",
      dependencies: [],
      filesInScope: [],
      activeExclusiveLocks: [],
    });
    expect(result.ready).toBe(false);
    expect(result.blocking).toContain("status=in_progress");
  });

  it("rejects tasks with unfinished dependencies", () => {
    const result = isTaskDispatchable({
      status: "not_started",
      dependencies: [
        { taskId: "dep-1", status: "in_progress" },
        { taskId: "dep-2", status: "actual_passed" },
      ],
      filesInScope: [],
      activeExclusiveLocks: [],
    });
    expect(result.ready).toBe(false);
    expect(result.blocking).toContain("dependency=dep-1:in_progress");
  });

  it("rejects tasks with file lock conflicts", () => {
    const result = isTaskDispatchable({
      status: "not_started",
      dependencies: [],
      filesInScope: ["src/shared.ts", "src/new.ts"],
      activeExclusiveLocks: ["src/shared.ts"],
    });
    expect(result.ready).toBe(false);
    expect(result.blocking).toContain("file_lock=src/shared.ts");
  });

  it("passes when everything is clear", () => {
    const result = isTaskDispatchable({
      status: "not_started",
      dependencies: [
        { taskId: "dep-1", status: "actual_passed" },
        { taskId: "dep-2", status: "closed" },
      ],
      filesInScope: ["src/new.ts"],
      activeExclusiveLocks: ["src/other.ts"],
    });
    expect(result.ready).toBe(true);
    expect(result.blocking).toEqual([]);
  });
});