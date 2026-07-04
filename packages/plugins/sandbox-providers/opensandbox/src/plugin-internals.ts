/**
 * Internal helpers shared between `plugin.ts` and `tools.ts`.
 *
 * Extracted so the tool registration in `tools.ts` can build its own
 * bridge (tools fire per-call from the agent runtime, not from the
 * env driver lifecycle). The constants and parsers are intentionally
 * minimal — keep the public surface in `plugin.ts`.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MCP_SERVER_PATH = path.resolve(here, "../../vendor/mcp-server/index.mjs");

export interface DriverConfig {
  baseUrl: string;
  apiKey: string | null;
  useServerProxy: boolean;
  requestTimeoutMs: number;
  defaultImage: string;
  defaultTtlSeconds: number;
}

export function parseDriverConfig(raw: Record<string, unknown>): DriverConfig {
  const baseUrl = typeof raw.baseUrl === "string" ? raw.baseUrl.trim() : "";
  const apiKey =
    typeof raw.apiKey === "string" && raw.apiKey.trim().length > 0
      ? raw.apiKey.trim()
      : null;
  const useServerProxy = raw.useServerProxy !== false;
  const requestTimeoutMs = Number.isFinite(Number(raw.requestTimeoutMs))
    ? Math.trunc(Number(raw.requestTimeoutMs))
    : 120000;
  const defaultImage =
    typeof raw.defaultImage === "string" && raw.defaultImage.trim().length > 0
      ? raw.defaultImage.trim()
      : "mcr.microsoft.com/playwright:v1.61.1-noble";
  const defaultTtlSeconds = Number.isFinite(Number(raw.defaultTtlSeconds))
    ? Math.trunc(Number(raw.defaultTtlSeconds))
    : 600;
  return { baseUrl, apiKey, useServerProxy, requestTimeoutMs, defaultImage, defaultTtlSeconds };
}

export function buildEnv(config: DriverConfig): Record<string, string> {
  const env: Record<string, string> = {
    OPENSANDBOX_BASE_URL: config.baseUrl,
    OPENSANDBOX_USE_SERVER_PROXY: config.useServerProxy ? "true" : "false",
    OPENSANDBOX_REQUEST_TIMEOUT_MS: String(config.requestTimeoutMs),
  };
  if (config.apiKey) env.OPENSANDBOX_API_KEY = config.apiKey;
  return env;
}
