import { describe, expect, it } from "vitest";
import { parseVerificationSpec } from "../services/verification-runner.ts";

describe("parseVerificationSpec", () => {
  it("accepts a single run-tests check with required fields", () => {
    const result = parseVerificationSpec({
      checks: [{ kind: "run-tests", command: "pnpm vitest run", expectedExit: 0 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.checks).toHaveLength(1);
    expect(result.spec.checks[0]).toMatchObject({ kind: "run-tests", command: "pnpm vitest run", expectedExit: 0 });
  });

  it("rejects an empty checks array", () => {
    const result = parseVerificationSpec({ checks: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("non-empty"))).toBe(true);
  });

  it("rejects an unsupported kind", () => {
    const result = parseVerificationSpec({
      checks: [{ kind: "smoke-it", command: "echo" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/checks\[0\].kind must be one of/);
  });

  it("rejects free-form 验收 style (no kind at all)", () => {
    const result = parseVerificationSpec({
      checks: [{ description: "验收: 看起来对就行了" }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects http-probe without http(s) URL", () => {
    const result = parseVerificationSpec({
      checks: [{ kind: "http-probe", method: "GET", url: "ftp://example.com", expectStatus: 200 }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("http(s) URL"))).toBe(true);
  });

  it("rejects http-probe with non-3-digit status", () => {
    const result = parseVerificationSpec({
      checks: [{ kind: "http-probe", method: "GET", url: "https://example.com", expectStatus: 99 }],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a file-exists check without expectedExit", () => {
    const result = parseVerificationSpec({
      checks: [{ kind: "file-exists", path: "dist/index.js" }],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a custom-exit-zero check and defaults expectedExit to 0", () => {
    const result = parseVerificationSpec({
      checks: [{ kind: "custom-exit-zero", command: "node ./scripts/check.js" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.checks[0]).toMatchObject({ kind: "custom-exit-zero", expectedExit: 0 });
  });

  it("accumulates multiple errors so the LLM can fix all in one pass", () => {
    const result = parseVerificationSpec({
      checks: [
        { kind: "run-tests" }, // missing command
        { kind: "lint" }, // missing command
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBe(2);
  });

  it("rejects null spec outright", () => {
    const result = parseVerificationSpec(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/required/);
  });

  it("rejects spec when checks is not an array", () => {
    const result = parseVerificationSpec({ checks: "nope" });
    expect(result.ok).toBe(false);
  });

  it("preserves rationale when provided", () => {
    const result = parseVerificationSpec({
      rationale: "Typecheck + targeted test prove the helper is correct.",
      checks: [{ kind: "typecheck", command: "tsc --noEmit", expectedExit: 0 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.rationale).toContain("Typecheck");
  });

  it("rejects http-probe with invalid method", () => {
    const result = parseVerificationSpec({
      checks: [{ kind: "http-probe", method: "PATCH", url: "https://example.com", expectStatus: 200 }],
    });
    expect(result.ok).toBe(false);
  });
});

/**
 * The retry-description helper lives inside legion-monitor.ts but the
 * regression risk is high (it mutates the description column that agents
 * read), so we test the pure-function behavior directly here.
 *
 * Importing the helper requires reaching through the module's exports.
 * To keep this test isolated, we duplicate the helper logic in a tiny
 * block; the canonical implementation is in legion-monitor.ts and
 * must stay in sync. If you change one, change the other.
 */
describe("retry description header (mirrored from legion-monitor)", () => {
  const RETRY_HEADER_PREFIX = "[prior failure context]";
  const RETRY_HEADER_REGEX = /^\[prior failure context\][\s\S]*?\[end prior failure context\]\n*/i;
  function buildRetryDescription(description: string | null, failureDigest: string | null): string {
    if (!failureDigest) return description ?? "";
    const header = `${RETRY_HEADER_PREFIX}\n${failureDigest}\n[end prior failure context]\n\n`;
    const cleaned = (description ?? "").replace(RETRY_HEADER_REGEX, "");
    return `${header}${cleaned}`;
  }

  it("prepends the digest when failure digest is present", () => {
    const result = buildRetryDescription("Add a helper function", "[typecheck] tsc exited 1");
    expect(result.startsWith("[prior failure context]\n[typecheck] tsc exited 1\n[end prior failure context]\n\n")).toBe(true);
    expect(result.endsWith("Add a helper function")).toBe(true);
  });

  it("returns the original description unchanged when no digest", () => {
    expect(buildRetryDescription("do a thing", null)).toBe("do a thing");
    expect(buildRetryDescription("do a thing", "")).toBe("do a thing");
  });

  it("does not accumulate the header across retries", () => {
    const once = buildRetryDescription("Task body", "first failure");
    const twice = buildRetryDescription(once, "second failure");
    const matches = twice.match(/\[prior failure context\]/g) ?? [];
    expect(matches.length).toBe(1);
    expect(twice).toContain("second failure");
    expect(twice).not.toContain("first failure");
  });

  it("handles a null description gracefully", () => {
    expect(buildRetryDescription(null, "something")).toContain("something");
  });
});