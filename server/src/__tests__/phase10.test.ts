import { describe, expect, it } from "vitest";
import {
  COARSE_TASK_DURATION_THRESHOLD_MIN,
  formatFewShotEntry,
  isCoarseTask,
  parsePostmortemJsonField,
  POSTMORTEM_CONTEXT_BUDGET,
} from "../services/memory.ts";
import {
  COARSE_MINUTES,
  MAX_DEPTH,
  shouldRecurseOnTask,
} from "../services/goal-decomposer.ts";

describe("memory: isCoarseTask", () => {
  it("returns false for short tasks under the threshold", () => {
    expect(isCoarseTask(60, "Add a helper")).toBe(false);
    expect(isCoarseTask(180, "Implement feature with tests")).toBe(false);
  });

  it("returns true when estimated_duration exceeds the threshold", () => {
    expect(isCoarseTask(COARSE_TASK_DURATION_THRESHOLD_MIN + 1, "long task")).toBe(true);
  });

  it("returns true when description is very long even without an estimate", () => {
    const longDescription = "a".repeat(1501);
    expect(isCoarseTask(null, longDescription)).toBe(true);
  });

  it("returns false for null inputs", () => {
    expect(isCoarseTask(null, null)).toBe(false);
    expect(isCoarseTask(undefined, undefined)).toBe(false);
  });
});

describe("memory: parsePostmortemJsonField", () => {
  it("returns the fallback for null/empty input", () => {
    expect(parsePostmortemJsonField<string[]>(null, [])).toEqual([]);
    expect(parsePostmortemJsonField<string[]>(undefined, ["x"])).toEqual(["x"]);
  });

  it("parses JSON arrays", () => {
    expect(parsePostmortemJsonField<string[]>(JSON.stringify(["a", "b"]), [])).toEqual(["a", "b"]);
  });

  it("returns the fallback on invalid JSON", () => {
    expect(parsePostmortemJsonField<string[]>("not-json", ["fallback"])).toEqual(["fallback"]);
  });
});

describe("memory: formatFewShotEntry", () => {
  it("renders a pass entry without lessons", () => {
    const entry = formatFewShotEntry({
      id: "p1",
      companyId: "c1",
      goalId: "g1",
      taskId: "t1",
      repoPath: "r",
      modulePath: "m",
      rootCauseClass: "logic",
      fixSummary: "Refactored the parser to use a streaming tokeniser.",
      commitHash: null,
      branchName: null,
      prUrl: null,
      filesTouched: [],
      lessons: [],
      attemptNumber: 1,
      passed: true,
      createdAt: new Date(),
    });
    expect(entry).toContain("[PASS · LOGIC");
    expect(entry).toContain("Refactored the parser");
    expect(entry).not.toContain("Lessons:");
  });

  it("renders a fail entry with files and lessons", () => {
    const entry = formatFewShotEntry({
      id: "p2",
      companyId: "c1",
      goalId: "g1",
      taskId: "t2",
      repoPath: "r",
      modulePath: "m",
      rootCauseClass: "env",
      fixSummary: "Missing pnpm lockfile.",
      commitHash: null,
      branchName: null,
      prUrl: null,
      filesTouched: ["package.json", "pnpm-lock.yaml"],
      lessons: ["Always commit pnpm-lock.yaml", "Check pre-commit hooks"],
      attemptNumber: 2,
      passed: false,
      createdAt: new Date(),
    });
    expect(entry).toContain("[FAIL · ENV");
    expect(entry).toContain("package.json");
    expect(entry).toContain("Lessons: Always commit pnpm-lock.yaml | Check pre-commit hooks");
  });

  it("truncates file lists longer than 3 entries with an ellipsis", () => {
    const entry = formatFewShotEntry({
      id: "p3",
      companyId: "c1",
      goalId: "g1",
      taskId: "t3",
      repoPath: "r",
      modulePath: "m",
      rootCauseClass: "tool",
      fixSummary: "Several files touched.",
      commitHash: null,
      branchName: null,
      prUrl: null,
      filesTouched: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
      lessons: [],
      attemptNumber: 1,
      passed: true,
      createdAt: new Date(),
    });
    expect(entry).toContain("a.ts, b.ts, c.ts…");
  });
});

describe("memory: budget constant", () => {
  it("is large enough for several entries but bounded", () => {
    expect(POSTMORTEM_CONTEXT_BUDGET).toBeGreaterThan(2000);
    expect(POSTMORTEM_CONTEXT_BUDGET).toBeLessThan(20000);
  });
});

describe("goal-decomposer: shouldRecurseOnTask", () => {
  it("does not recurse when at max depth", () => {
    expect(shouldRecurseOnTask({ estimatedDuration: 600, description: "long" }, MAX_DEPTH - 1)).toBe(false);
  });

  it("does not recurse on short tasks", () => {
    expect(shouldRecurseOnTask({ estimatedDuration: 60, description: "short" }, 0)).toBe(false);
  });

  it("recurses on coarse tasks under max depth", () => {
    expect(shouldRecurseOnTask({ estimatedDuration: 600, description: "long task" }, 0)).toBe(true);
    expect(shouldRecurseOnTask({ estimatedDuration: 60, description: "a".repeat(2000) }, 0)).toBe(true);
  });

  it("exports the coarse minutes threshold as a stable constant", () => {
    expect(COARSE_MINUTES).toBe(COARSE_TASK_DURATION_THRESHOLD_MIN);
    expect(COARSE_MINUTES).toBe(240);
  });

  it("exports MAX_DEPTH as 3", () => {
    expect(MAX_DEPTH).toBe(3);
  });
});