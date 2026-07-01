import { describe, expect, it } from "vitest";
import {
  renderTaskTemplate,
  validateTaskTemplate,
  type TaskTemplateInput,
} from "../services/task-template.ts";

const baseInput: TaskTemplateInput = {
  objective: "Add a typed pluck helper to packages/shared",
  nonObjectives: ["Do not touch the API server", "Do not introduce new dependencies"],
  inputs: {
    inputs: [
      { kind: "task", ref: "task_deps_1", note: "upstream helper spec" },
      { kind: "url", ref: "https://github.com/...", note: "API reference" },
    ],
    outputs: [],
  },
  outputs: {
    inputs: [],
    outputs: [
      { kind: "file", ref: "packages/shared/src/pluck.ts" },
      { kind: "doc", ref: "doc/specs/pluck.md" },
    ],
  },
  filesInScope: ["packages/shared/src/pluck.ts", "packages/shared/src/__tests__/pluck.test.ts"],
  filesOutOfScope: ["server/**", "ui/**", "package.json"],
  acceptanceCriteria: {
    bullets: [
      "Given an array of objects and a key, pluck returns an array of the values at that key",
      "Given an empty array, pluck returns []",
      "TypeScript type signatures compile under strict mode",
    ],
    rationale: "These bullets together prove the helper is well-typed and behaves on the empty case.",
  },
  verificationSpec: {
    rationale: "machine-verifiable",
    checks: [
      { kind: "typecheck", command: "pnpm -w tsc --noEmit", expectedExit: 0, timeoutSec: 120 },
      { kind: "run-tests", command: "pnpm vitest run packages/shared/src/__tests__/pluck.test.ts", expectedExit: 0, timeoutSec: 90 },
    ],
  },
  evidencePaths: ["packages/shared/src/pluck.ts", "test-output/pluck.json"],
  evidenceSummary: "Typecheck green; 3 unit tests passed; coverage 100%.",
  downstreamOwnerAgentId: "agent_xyz",
  retryStrategy: { backoffSec: 60, maxAttempts: 3, fallbackTaskId: "task_fallback_pluck" },
};

describe("renderTaskTemplate", () => {
  it("includes every required section", () => {
    const md = renderTaskTemplate(baseInput);
    expect(md).toContain("# Task brief");
    expect(md).toContain("## Objective");
    expect(md).toContain("## Non-objectives");
    expect(md).toContain("## Inputs");
    expect(md).toContain("## Outputs");
    expect(md).toContain("## Files you may modify");
    expect(md).toContain("## Files you must NOT modify");
    expect(md).toContain("## Acceptance (human-readable)");
    expect(md).toContain("## Acceptance (machine-verifiable)");
    expect(md).toContain("## Evidence you must produce");
    expect(md).toContain("## Evidence summary");
    expect(md).toContain("## Next owner");
    expect(md).toContain("## Retry strategy");
    expect(md).toContain("## State machine");
  });

  it("renders inputs with kind tag", () => {
    const md = renderTaskTemplate(baseInput);
    expect(md).toContain("- [task] task_deps_1 — upstream helper spec");
    expect(md).toContain("- [url] https://github.com/...");
  });

  it("renders outputs with kind tag", () => {
    const md = renderTaskTemplate(baseInput);
    expect(md).toContain("- [file] packages/shared/src/pluck.ts");
    expect(md).toContain("- [doc] doc/specs/pluck.md");
  });

  it("renders file scope with backticks", () => {
    const md = renderTaskTemplate(baseInput);
    expect(md).toContain("- `packages/shared/src/pluck.ts`");
  });

  it("emits verification_spec as fenced JSON", () => {
    const md = renderTaskTemplate(baseInput);
    expect(md).toContain("```json");
    expect(md).toContain("\"kind\": \"typecheck\"");
  });

  it("omits empty optional sections", () => {
    const minimal: TaskTemplateInput = {
      objective: "Just one thing",
      filesInScope: ["a.ts"],
      acceptanceCriteria: { bullets: ["it works"] },
      verificationSpec: { checks: [{ kind: "custom-exit-zero", command: "true" }] },
      evidencePaths: ["out/a.txt"],
    };
    const md = renderTaskTemplate(minimal);
    expect(md).not.toContain("## Non-objectives");
    expect(md).not.toContain("## Inputs");
    expect(md).not.toContain("## Outputs");
    expect(md).not.toContain("## Files you must NOT modify");
    expect(md).not.toContain("## Next owner");
  });
});

describe("validateTaskTemplate", () => {
  it("passes when all required fields are present", () => {
    expect(validateTaskTemplate(baseInput)).toEqual({ ok: true });
  });

  it("rejects missing objective", () => {
    const result = validateTaskTemplate({ ...baseInput, objective: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain("objective is required");
  });

  it("rejects empty filesInScope", () => {
    const result = validateTaskTemplate({ ...baseInput, filesInScope: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("filesInScope"))).toBe(true);
  });

  it("rejects missing acceptanceCriteria bullets", () => {
    const result = validateTaskTemplate({
      ...baseInput,
      acceptanceCriteria: { bullets: [] },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects missing verificationSpec", () => {
    const result = validateTaskTemplate({ ...baseInput, verificationSpec: undefined });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("verificationSpec"))).toBe(true);
  });

  it("rejects empty evidencePaths", () => {
    const result = validateTaskTemplate({ ...baseInput, evidencePaths: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("evidencePaths"))).toBe(true);
  });
});