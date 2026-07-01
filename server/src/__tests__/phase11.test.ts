import { describe, expect, it } from "vitest";
import {
  EVAL_THRESHOLD_REJECT,
  computeBaselineRate,
  computeProposedRate,
  evaluateDiff,
  shouldAutoDeny,
} from "../services/skill-proposal.ts";
import {
  STRICT_MODE_ENV_VAR,
  checkSkillAgainstManifest,
  checkSkillLoad,
  isStrictMode,
} from "../services/skill-loader-strict.ts";

describe("skill-proposal: computeBaselineRate / computeProposedRate", () => {
  it("baseline is deterministic for the same skillPath", () => {
    expect(computeBaselineRate("bundled/quality/qa-acceptance")).toBe(computeBaselineRate("bundled/quality/qa-acceptance"));
  });

  it("baseline differs across skill paths", () => {
    expect(computeBaselineRate("a")).not.toBe(computeBaselineRate("b"));
  });

  it("baseline stays in [0, 1]", () => {
    for (const path of ["x", "y", "z", "bundled/foo/bar"]) {
      const rate = computeBaselineRate(path);
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1);
    }
  });

  it("proposed rate increases when diff is pure additions", () => {
    const path = "bundled/test/skill";
    const additions = Array.from({ length: 10 }, (_, i) => `+line ${i}`).join("\n");
    expect(computeProposedRate(path, additions)).toBeGreaterThan(computeBaselineRate(path));
  });

  it("proposed rate decreases when diff is pure removals", () => {
    const path = "bundled/test/skill";
    const removals = Array.from({ length: 10 }, (_, i) => `-line ${i}`).join("\n");
    expect(computeProposedRate(path, removals)).toBeLessThan(computeBaselineRate(path));
  });

  it("proposed rate is bounded by ±20% of baseline", () => {
    const path = "bundled/test/skill";
    const hugeAdditions = Array.from({ length: 1000 }, (_, i) => `+line ${i}`).join("\n");
    const rate = computeProposedRate(path, hugeAdditions);
    const baseline = computeBaselineRate(path);
    // 0.2 + 1e-6 epsilon to absorb IEEE 754 representation noise from
    // the round-to-6-decimals step in the impl. The clamp targets 0.2
    // exactly but rounding can move the final rate by up to one
    // millionth in either direction.
    expect(rate - baseline).toBeLessThanOrEqual(0.2 + 1e-6);
  });
});

describe("skill-proposal: evaluateDiff", () => {
  it("denies automatically when delta exceeds reject threshold", async () => {
    const path = "bundled/test/skill";
    const removals = Array.from({ length: 20 }, (_, i) => `-line ${i}`).join("\n");
    const result = await evaluateDiff(path, removals);
    expect(result.delta).toBeLessThanOrEqual(EVAL_THRESHOLD_REJECT);
    expect(result.status).toBe("denied");
    expect(result.regressions.length).toBeGreaterThan(0);
  });

  it("stays pending when delta is non-negative", async () => {
    const path = "bundled/test/skill";
    const additions = Array.from({ length: 5 }, (_, i) => `+line ${i}`).join("\n");
    const result = await evaluateDiff(path, additions);
    expect(result.delta).toBeGreaterThanOrEqual(0);
    expect(result.status).toBe("pending");
  });

  it("stays pending when delta is small but positive (board decides)", async () => {
    const path = "bundled/test/skill";
    const result = await evaluateDiff(path, "+ minor tweak");
    expect(result.status).toBe("pending");
  });

  it("regressions field records the regressed path on denial", async () => {
    const path = "bundled/quality/foo";
    const removals = Array.from({ length: 20 }, () => "-line").join("\n");
    const result = await evaluateDiff(path, removals);
    expect(result.regressions.some((r) => r.includes(path))).toBe(true);
  });
});

describe("skill-proposal: shouldAutoDeny", () => {
  it("denies below threshold", () => {
    expect(shouldAutoDeny(-0.06)).toBe(true);
    expect(shouldAutoDeny(-0.5)).toBe(true);
  });

  it("does not deny at or above threshold", () => {
    expect(shouldAutoDeny(-0.05)).toBe(false);
    expect(shouldAutoDeny(0)).toBe(false);
    expect(shouldAutoDeny(0.1)).toBe(false);
  });
});

describe("skill-loader-strict: isStrictMode", () => {
  it("returns false when env var is unset", () => {
    expect(isStrictMode({})).toBe(false);
    expect(isStrictMode({ [STRICT_MODE_ENV_VAR]: "" })).toBe(false);
  });

  it("returns true when env var is '1' or 'true'", () => {
    expect(isStrictMode({ [STRICT_MODE_ENV_VAR]: "1" })).toBe(true);
    expect(isStrictMode({ [STRICT_MODE_ENV_VAR]: "true" })).toBe(true);
    expect(isStrictMode({ [STRICT_MODE_ENV_VAR]: "TRUE" })).toBe(true);
  });

  it("returns false for other values", () => {
    expect(isStrictMode({ [STRICT_MODE_ENV_VAR]: "0" })).toBe(false);
    expect(isStrictMode({ [STRICT_MODE_ENV_VAR]: "yes" })).toBe(false);
  });
});

describe("skill-loader-strict: checkSkillAgainstManifest", () => {
  const manifest = new Set(["bundled/quality/qa-acceptance", "bundled/quality/hard-verification-authoring"]);

  it("passes when the key is in the manifest", () => {
    const result = checkSkillAgainstManifest({ manifestKeys: manifest, requestedKey: "bundled/quality/qa-acceptance" });
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("ok");
  });

  it("rejects when the key is missing", () => {
    const result = checkSkillAgainstManifest({ manifestKeys: manifest, requestedKey: "bundled/skill/unknown" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing-in-manifest");
    expect(result.message).toContain("paperclipai skill propose");
  });

  it("rejects empty manifest lookup", () => {
    const result = checkSkillAgainstManifest({ manifestKeys: new Set(), requestedKey: "any" });
    expect(result.ok).toBe(false);
  });
});

describe("skill-loader-strict: checkSkillLoad", () => {
  it("always passes when strict mode is off, even for unknown keys", () => {
    const result = checkSkillLoad({ manifestKeys: new Set(), requestedKey: "anything" }, {});
    expect(result.ok).toBe(true);
  });

  it("enforces the check when strict mode is on", () => {
    const result = checkSkillLoad(
      { manifestKeys: new Set(["a"]), requestedKey: "b" },
      { [STRICT_MODE_ENV_VAR]: "1" },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing-in-manifest");
  });

  it("passes when strict mode is on and the key is in the manifest", () => {
    const result = checkSkillLoad(
      { manifestKeys: new Set(["bundled/x"]), requestedKey: "bundled/x" },
      { [STRICT_MODE_ENV_VAR]: "true" },
    );
    expect(result.ok).toBe(true);
  });
});