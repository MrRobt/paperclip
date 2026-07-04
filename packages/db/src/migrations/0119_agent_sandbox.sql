-- 0119: per-agent sandbox config (Layer C1 of per-agent sandbox)
--
-- Phase iter3 of .planning/2026-07-04-acceptance-test/iter3/DESIGN.md.
-- Each agent now stores an optional `sandbox_config` JSONB blob that
-- describes how it should acquire a disposable sandbox per run. The
-- plugin layer (PR-2: @paperclipai/plugin-opensandbox) reads this on
-- run invoke; PR-3 (Layer C2) will wire it into run-invocation hooks.
--
-- The shape is validated server-side via
-- `agentSandboxConfigSchema` in `@paperclipai/shared`:
--
--   { enabled?: boolean (default true),
--     provider: "opensandbox" (literal, only option for now),
--     image?: string (override plugin default),
--     ttlSeconds?: number (override plugin default),
--     envVars?: Record<string, string>,
--     autoCleanup?: boolean (default true) }

ALTER TABLE "agents"
  ADD COLUMN IF NOT EXISTS "sandbox_config" jsonb;
