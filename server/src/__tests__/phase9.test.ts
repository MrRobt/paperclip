import { describe, expect, it } from "vitest";
import {
  evaluateRequiredChecksResult,
  normaliseGhState,
  normaliseGhConclusion,
  parseRequiredChecks,
} from "../services/legion-ci-watcher.ts";
import {
  parseMergeBlob,
  isAlreadyMerged,
  shouldSkipAutoMerge,
} from "../services/legion-merge.ts";
import {
  applyTransition,
  TERMINAL_TASK_STATUSES,
  initialGoalStatus,
} from "../services/goal-progress.ts";

describe("legion-ci-watcher: status / conclusion normalisation", () => {
  it("maps gh states to the canonical PrCheckStatus set", () => {
    expect(normaliseGhState("SUCCESS")).toBe("success");
    expect(normaliseGhState("FAILURE")).toBe("failure");
    expect(normaliseGhState("PENDING")).toBe("pending");
    expect(normaliseGhState("SKIPPED")).toBe("skipped");
    expect(normaliseGhState("CANCELLED")).toBe("cancelled");
  });

  it("treats queued/waiting/requested/expected as pending", () => {
    expect(normaliseGhState("queued")).toBe("pending");
    expect(normaliseGhState("waiting")).toBe("pending");
    expect(normaliseGhState("requested")).toBe("pending");
    expect(normaliseGhState("expected")).toBe("pending");
  });

  it("treats neutral as success-equivalent for watcher purposes", () => {
    expect(normaliseGhState("neutral")).toBe("success");
  });

  it("rejects unknown states", () => {
    expect(normaliseGhState("garbage")).toBeNull();
    expect(normaliseGhState(undefined)).toBeNull();
    expect(normaliseGhState(42)).toBeNull();
  });

  it("normalises conclusions to the constrained set", () => {
    expect(normaliseGhConclusion("success")).toBe("success");
    expect(normaliseGhConclusion("failure")).toBe("failure");
    expect(normaliseGhConclusion("timed_out")).toBe("timed_out");
    expect(normaliseGhConclusion("action_required")).toBe("action_required");
    expect(normaliseGhConclusion("nope")).toBeNull();
    expect(normaliseGhConclusion(null)).toBeNull();
  });
});

describe("legion-ci-watcher: parseRequiredChecks", () => {
  it("returns empty for null/empty", () => {
    expect(parseRequiredChecks(null)).toEqual([]);
    expect(parseRequiredChecks("")).toEqual([]);
  });

  it("parses JSON arrays", () => {
    expect(parseRequiredChecks(JSON.stringify(["ci/build", "ci/test"]))).toEqual(["ci/build", "ci/test"]);
  });

  it("falls back to comma-separated when JSON parse fails", () => {
    expect(parseRequiredChecks("ci/build, ci/test")).toEqual(["ci/build", "ci/test"]);
  });

  it("drops non-string entries from JSON arrays", () => {
    expect(parseRequiredChecks(JSON.stringify([1, "ci/test", null]))).toEqual(["ci/test"]);
  });
});

describe("legion-ci-watcher: evaluateRequiredChecksResult", () => {
  const base = { required: ["ci/build", "ci/test"], observed: new Map() };

  it("returns allPassed=true with empty lists when no checks required", () => {
    expect(evaluateRequiredChecksResult({ required: [], observed: new Map() })).toEqual({
      allPassed: true,
      pending: [],
      failed: [],
    });
  });

  it("marks required checks as pending when not yet observed", () => {
    const result = evaluateRequiredChecksResult(base);
    expect(result.allPassed).toBe(false);
    expect(result.pending).toEqual(["ci/build", "ci/test"]);
    expect(result.failed).toEqual([]);
  });

  it("marks checks as failed when status=failure or cancelled", () => {
    const observed = new Map([
      ["ci/build", { status: "failure", conclusion: "failure" }],
      ["ci/test", { status: "success", conclusion: "success" }],
    ]);
    const result = evaluateRequiredChecksResult({ required: ["ci/build", "ci/test"], observed });
    expect(result.allPassed).toBe(false);
    expect(result.failed).toEqual(["ci/build"]);
    expect(result.pending).toEqual([]);
  });

  it("treats conclusion=success as a pass even if status is stale", () => {
    const observed = new Map([
      ["ci/build", { status: "pending", conclusion: "success" }],
    ]);
    const result = evaluateRequiredChecksResult({ required: ["ci/build"], observed });
    expect(result.allPassed).toBe(true);
  });

  it("passes when every required check is success", () => {
    const observed = new Map([
      ["ci/build", { status: "success", conclusion: "success" }],
      ["ci/test", { status: "success", conclusion: "success" }],
    ]);
    expect(evaluateRequiredChecksResult({ required: ["ci/build", "ci/test"], observed })).toEqual({
      allPassed: true,
      pending: [],
      failed: [],
    });
  });
});

describe("legion-merge: parseMergeBlob", () => {
  it("returns null for empty/falsy input", () => {
    expect(parseMergeBlob(null)).toBeNull();
    expect(parseMergeBlob("")).toBeNull();
    expect(parseMergeBlob(undefined)).toBeNull();
  });

  it("returns null when blob is not parseable", () => {
    expect(parseMergeBlob("not json")).toBeNull();
    expect(parseMergeBlob("[1,2,3]")).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    expect(parseMergeBlob(JSON.stringify({ prUrl: "https://x" }))).toBeNull();
    expect(parseMergeBlob(JSON.stringify({ prNumber: 1 }))).toBeNull();
  });

  it("returns pr info when both url and number present", () => {
    expect(parseMergeBlob(JSON.stringify({ prUrl: "https://github.com/o/r/pull/1", prNumber: 1 }))).toEqual({
      url: "https://github.com/o/r/pull/1",
      number: 1,
      branchName: null,
    });
    expect(parseMergeBlob(JSON.stringify({ prUrl: "https://x", prNumber: 1, branchName: "legion/abc/feat" }))).toEqual({
      url: "https://x",
      number: 1,
      branchName: "legion/abc/feat",
    });
  });
});

describe("legion-merge: isAlreadyMerged", () => {
  it("treats MERGED state as already merged", () => {
    expect(isAlreadyMerged({ state: "MERGED", mergeCommit: { oid: "abc123" } })).toEqual({
      merged: true,
      sha: "abc123",
    });
  });

  it("treats OPEN state as not merged", () => {
    expect(isAlreadyMerged({ state: "OPEN", mergeCommit: null })).toEqual({ merged: false, sha: null });
  });

  it("treats CLOSED state without mergeCommit as not merged", () => {
    expect(isAlreadyMerged({ state: "CLOSED" })).toEqual({ merged: false, sha: null });
  });
});

describe("legion-merge: shouldSkipAutoMerge", () => {
  it("skips when autoMerge is false", () => {
    expect(shouldSkipAutoMerge({ autoMerge: false, autoMergeMethod: "squash" })).toBe(true);
  });

  it("does not skip when autoMerge is true regardless of method", () => {
    expect(shouldSkipAutoMerge({ autoMerge: true, autoMergeMethod: "squash" })).toBe(false);
    expect(shouldSkipAutoMerge({ autoMerge: true, autoMergeMethod: "rebase" })).toBe(false);
    expect(shouldSkipAutoMerge({ autoMerge: true, autoMergeMethod: "merge" })).toBe(false);
  });
});

describe("goal-progress: state machine constants", () => {
  it("includes actual_passed/closed/failed in terminal task statuses", () => {
    expect(TERMINAL_TASK_STATUSES.has("actual_passed")).toBe(true);
    expect(TERMINAL_TASK_STATUSES.has("closed")).toBe(true);
    expect(TERMINAL_TASK_STATUSES.has("failed")).toBe(true);
    expect(TERMINAL_TASK_STATUSES.has("in_progress")).toBe(false);
    expect(TERMINAL_TASK_STATUSES.has("not_started")).toBe(false);
  });

  it("defaults to planning", () => {
    expect(initialGoalStatus(null)).toBe("planning");
    expect(initialGoalStatus(undefined)).toBe("planning");
    expect(initialGoalStatus("executing")).toBe("executing");
  });
});

describe("goal-progress: applyTransition", () => {
  it("returns the next status when transition is allowed", () => {
    const result = applyTransition("planning", "executing");
    expect(result).toEqual({ transitioned: true, next: "executing" });
  });

  it("no-ops when status is already the target", () => {
    const result = applyTransition("completed", "completed");
    expect(result).toEqual({ transitioned: false, next: "completed" });
  });

  it("no-ops when source is terminal", () => {
    expect(applyTransition("completed", "failed")).toEqual({ transitioned: false, next: "completed" });
    expect(applyTransition("failed", "completed")).toEqual({ transitioned: false, next: "failed" });
  });

  it("rejects backward transitions", () => {
    expect(applyTransition("verifying", "executing")).toEqual({ transitioned: false, next: "verifying" });
    expect(applyTransition("completed", "verifying")).toEqual({ transitioned: false, next: "completed" });
  });

  it("allows executing → failed (early failure path)", () => {
    expect(applyTransition("executing", "failed")).toEqual({ transitioned: true, next: "failed" });
  });

  it("allows verifying → completed when all verify_passed", () => {
    expect(applyTransition("verifying", "completed")).toEqual({ transitioned: true, next: "completed" });
  });
});