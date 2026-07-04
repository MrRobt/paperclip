/**
 * OpenSandbox plugin entrypoint.
 *
 * Implements the 5 environment driver hooks the paperclip host calls
 * during a run:
 *   - onEnvironmentValidateConfig  → static check of baseUrl/apiKey
 *   - onEnvironmentProbe          → reachability check (GET /health)
 *   - onEnvironmentAcquireLease   → opensandbox_create_sandbox
 *   - onEnvironmentRealizeWorkspace → opensandbox_upload_files
 *   - onEnvironmentExecute        → opensandbox_run_command
 *   - onEnvironmentReleaseLease   → opensandbox_delete_sandbox
 *   - onEnvironmentDestroyLease   → force kill (best effort)
 *
 * The actual MCP calls go through `OpenSandboxBridge` (see bridge.ts)
 * which spawns the upstream `mcp-server/index.mjs` and proxies
 * JSON-RPC over stdio.
 *
 * The 6 extra `opensandbox_*` tools (health, run_playwright, …) are
 * registered in `tools.ts` via `ctx.tools.register()`.
 */

import { definePlugin } from "@paperclipai/plugin-sdk";
import type {
  PluginContext,
  PluginEnvironmentAcquireLeaseParams,
  PluginEnvironmentDestroyLeaseParams,
  PluginEnvironmentExecuteParams,
  PluginEnvironmentExecuteResult,
  PluginEnvironmentLease,
  PluginEnvironmentProbeParams,
  PluginEnvironmentProbeResult,
  PluginEnvironmentRealizeWorkspaceParams,
  PluginEnvironmentRealizeWorkspaceResult,
  PluginEnvironmentReleaseLeaseParams,
  PluginEnvironmentValidateConfigParams,
  PluginEnvironmentValidationResult,
} from "@paperclipai/plugin-sdk";
import { existsSync } from "node:fs";
import { OpenSandboxBridge } from "./bridge.js";
import { buildEnv, MCP_SERVER_PATH, parseDriverConfig, type DriverConfig } from "./plugin-internals.js";
import { registerTools } from "./tools.js";

async function acquireBridge(
  config: DriverConfig,
  ctx: PluginContext,
): Promise<OpenSandboxBridge> {
  if (!existsSync(MCP_SERVER_PATH)) {
    throw new Error(
      `OpenSandbox MCP server not found at ${MCP_SERVER_PATH}. ` +
        `Ensure vendor/mcp-server/index.mjs is present (rebuild after pulling upstream).`,
    );
  }
  const bridge = new OpenSandboxBridge({
    mcpServerPath: MCP_SERVER_PATH,
    env: buildEnv(config),
  });
  await bridge.initialize({ name: "@paperclipai/plugin-opensandbox", version: "0.1.0" });
  return bridge;
}

// One bridge per plugin instance — the host calls setup() once at boot
// and the env driver hooks read from the same bridge. Per-run state
// (sandboxId) lives in the lease metadata.
let sharedBridge: OpenSandboxBridge | null = null;
let sharedBridgeConfig: DriverConfig | null = null;

async function getBridge(
  config: DriverConfig,
  ctx: PluginContext,
): Promise<OpenSandboxBridge> {
  if (
    sharedBridge &&
    sharedBridgeConfig &&
    sharedBridgeConfig.baseUrl === config.baseUrl &&
    sharedBridgeConfig.apiKey === config.apiKey
  ) {
    return sharedBridge;
  }
  if (sharedBridge) {
    await sharedBridge.close().catch(() => {});
  }
  sharedBridge = await acquireBridge(config, ctx);
  sharedBridgeConfig = config;
  return sharedBridge;
}

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    ctx.logger.info("OpenSandbox plugin ready");
    // Register the 6 extra custom tools (the other 5 are surfaced as
    // env driver hooks — they don't need tools.register()).
    registerTools(ctx);
  },

  async onHealth() {
    if (!sharedBridge) return { status: "ok", message: "OpenSandbox plugin ready (no bridge yet)" };
    try {
      const result = (await sharedBridge.call("tools/list")) as { tools: unknown[] };
      return {
        status: "ok",
        message: `OpenSandbox MCP server reachable, ${result.tools?.length ?? 0} tools exposed`,
      };
    } catch (err) {
      return { status: "degraded", message: (err as Error).message };
    }
  },

  async onEnvironmentValidateConfig(
    params: PluginEnvironmentValidateConfigParams,
  ): Promise<PluginEnvironmentValidationResult> {
    const config = parseDriverConfig(params.config);
    const errors: string[] = [];
    if (!config.baseUrl) errors.push("baseUrl is required");
    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, normalizedConfig: { ...config } };
  },

  async onEnvironmentProbe(
    params: PluginEnvironmentProbeParams,
  ): Promise<PluginEnvironmentProbeResult> {
    const config = parseDriverConfig(params.config);
    if (!config.baseUrl) {
      return { ok: false, error: "baseUrl is required" };
    }
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), Math.min(config.requestTimeoutMs, 5000));
      const res = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/health`, {
        signal: ac.signal,
        headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
      });
      clearTimeout(timer);
      if (!res.ok) {
        return { ok: false, error: `OpenSandbox /health returned ${res.status}` };
      }
      return { ok: true, latencyMs: 0 };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },

  async onEnvironmentAcquireLease(
    params: PluginEnvironmentAcquireLeaseParams,
  ): Promise<PluginEnvironmentLease> {
    const config = parseDriverConfig(params.config);
    const bridge = await getBridge(config, params.ctx);
    const image =
      (typeof params.config.image === "string" && params.config.image) ||
      config.defaultImage;
    const ttl =
      Number.isFinite(Number(params.config.ttlSeconds))
        ? Math.trunc(Number(params.config.ttlSeconds))
        : config.defaultTtlSeconds;
    const result = (await bridge.callTool("opensandbox_create_sandbox", {
      image,
      ttlSeconds: ttl,
    })) as { id: string; status: string; execdEndpoint?: string };
    return {
      providerLeaseId: result.id,
      metadata: {
        provider: "opensandbox",
        sandboxId: result.id,
        image,
        ttlSeconds: ttl,
        execdEndpoint: result.execdEndpoint ?? null,
        status: result.status,
      },
    };
  },

  async onEnvironmentRealizeWorkspace(
    params: PluginEnvironmentRealizeWorkspaceParams,
  ): Promise<PluginEnvironmentRealizeWorkspaceResult> {
    const config = parseDriverConfig(params.config);
    const bridge = await getBridge(config, params.ctx);
    const items = (params.files ?? []).map((f) => ({
      sandboxPath: f.path,
      content:
        typeof f.content === "string" ? f.content : f.content.toString("base64"),
      encoding: typeof f.content === "string" ? "utf-8" : "base64",
    }));
    await bridge.callTool("opensandbox_upload_files", {
      sandboxId: params.providerLeaseId,
      items,
    });
    return { ok: true, uploadedCount: items.length };
  },

  async onEnvironmentExecute(
    params: PluginEnvironmentExecuteParams,
  ): Promise<PluginEnvironmentExecuteResult> {
    const config = parseDriverConfig(params.config);
    const bridge = await getBridge(config, params.ctx);
    const result = (await bridge.callTool("opensandbox_run_command", {
      sandboxId: params.providerLeaseId,
      command: params.command,
      args: params.args ?? [],
      env: params.env,
      cwd: params.cwd,
      timeoutSec: params.timeoutSec,
    })) as {
      exitCode: number | null;
      stdout: string;
      stderr: string;
      timedOut: boolean;
    };
    return {
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  },

  async onEnvironmentReleaseLease(
    params: PluginEnvironmentReleaseLeaseParams,
  ): Promise<void> {
    if (!sharedBridge) return;
    try {
      await sharedBridge.callTool("opensandbox_delete_sandbox", { id: params.providerLeaseId });
    } catch (err) {
      // Best-effort; surface as warning to host
      console.warn(
        `OpenSandbox release lease ${params.providerLeaseId} failed: ${(err as Error).message}`,
      );
    }
  },

  async onEnvironmentDestroyLease(
    params: PluginEnvironmentDestroyLeaseParams,
  ): Promise<void> {
    // opensandbox-orchestrator has no "force kill" separate from delete;
    // delegate to the same path. Add a separate force_kill tool upstream
    // if stronger guarantees are needed.
    if (!sharedBridge) return;
    try {
      await sharedBridge.callTool("opensandbox_delete_sandbox", { id: params.providerLeaseId });
    } catch (err) {
      console.warn(
        `OpenSandbox destroy lease ${params.providerLeaseId} failed: ${(err as Error).message}`,
      );
    }
  },
});

export default plugin;
