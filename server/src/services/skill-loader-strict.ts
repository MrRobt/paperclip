/**
 * Phase 11 of doc/plans/2026-06-30-self-solving-agent-team.md.
 *
 * Strict-mode loader for the skills catalog. When
 * PAPERCLIP_SKILL_PROPOSAL_STRICT=true, the server refuses to load any
 * skill whose key is missing from `generated/catalog.json`, and refuses
 * any in-memory skill whose frontmatter declares it has been modified
 * without a corresponding approved `skill_proposals` row.
 *
 * Strict mode is off by default to keep local dev frictionless. Turn
 * it on in production by setting the env var on the API process.
 *
 * This module is pure — the actual catalog loader wiring (which
 * filesystem path the manifest comes from, where skills are mounted)
 * lives in `packages/skills-catalog/src/index.ts`. The strict check
 * is enforced at the route level in `server/src/routes/skills.ts`.
 */

export const STRICT_MODE_ENV_VAR = "PAPERCLIP_SKILL_PROPOSAL_STRICT";

export function isStrictMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[STRICT_MODE_ENV_VAR];
  if (!raw) return false;
  return raw === "1" || raw.toLowerCase() === "true";
}

export interface StrictModeCheckInput {
  manifestKeys: ReadonlySet<string>;
  requestedKey: string;
}

export interface StrictModeCheckResult {
  ok: boolean;
  reason: "ok" | "missing-in-manifest" | "not-in-approved-proposal";
  message: string;
}

/**
 * Pure helper exposed for tests + reused by the route handler.
 */
export function checkSkillAgainstManifest(input: StrictModeCheckInput): StrictModeCheckResult {
  if (!input.manifestKeys.has(input.requestedKey)) {
    return {
      ok: false,
      reason: "missing-in-manifest",
      message: `skill "${input.requestedKey}" is not in generated/catalog.json; either regenerate the manifest via \`pnpm --filter @paperclipai/skills-catalog build:manifest\` or submit a proposal via \`paperclipai skill propose\``,
    };
  }
  return { ok: true, reason: "ok", message: "" };
}

/**
 * Convenience wrapper that respects the env-var gate.
 */
export function checkSkillLoad(input: StrictModeCheckInput, env: NodeJS.ProcessEnv = process.env): StrictModeCheckResult {
  if (!isStrictMode(env)) return { ok: true, reason: "ok", message: "" };
  return checkSkillAgainstManifest(input);
}