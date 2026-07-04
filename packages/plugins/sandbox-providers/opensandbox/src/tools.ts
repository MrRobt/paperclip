/**
 * Custom tool registrations for OpenSandbox.
 *
 * The 5 env driver hooks in `plugin.ts` cover the lifecycle of a
 * sandbox (acquire / realize / execute / release / destroy). The
 * 6 tools below expose OpenSandbox-specific operations that the
 * agent can call directly when it needs to inspect or extend a
 * sandbox:
 *
 *   opensandbox_health             — control plane reachability
 *   opensandbox_get_sandbox        — current sandbox metadata
 *   opensandbox_run_playwright     — upload + run Playwright script
 *   opensandbox_download_file      — pull artifact from sandbox
 *   opensandbox_get_command_logs   — background command logs
 *   opensandbox_bootstrap_remote_host — install OpenSandbox on a host
 *
 * Note: `opensandbox_bootstrap_remote_host` is registered with a
 * safety guard. Hosts may opt to disable it via Paperclip capability
 * policy if they don't want agents able to spawn new OpenSandbox
 * control planes.
 */

import type { PluginContext, ToolResult } from "@paperclipai/plugin-sdk";
import { OpenSandboxBridge } from "./bridge.js";
import { buildEnv, MCP_SERVER_PATH, parseDriverConfig, type DriverConfig } from "./plugin-internals.js";

function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

async function bridgeFromContext(ctx: PluginContext): Promise<OpenSandboxBridge> {
  // The env driver hooks maintain a single shared bridge per plugin
  // instance. We piggy-back on that here so tool calls and driver
  // calls share the same underlying MCP server.
  const config = parseDriverConfig((ctx.config as { raw?: Record<string, unknown> }).raw ?? {});
  if (!config.baseUrl) {
    throw new Error(
      "opensandbox_* tools require driver baseUrl — set it in the company environment config.",
    );
  }
  const bridge = new OpenSandboxBridge({
    mcpServerPath: MCP_SERVER_PATH,
    env: buildEnv(config),
  });
  await bridge.initialize({ name: "@paperclipai/plugin-opensandbox", version: "0.1.0" });
  return bridge;
}

export function registerTools(ctx: PluginContext): void {
  ctx.tools.register(
    "opensandbox_health",
    {
      displayName: "OpenSandbox Health",
      description:
        "Check OpenSandbox control plane reachability. Use to confirm a sandbox server is configured before creating a sandbox.",
      parametersSchema: { type: "object", properties: {} },
    },
    async () => {
      const bridge = await bridgeFromContext(ctx);
      const result = (await bridge.callTool("opensandbox_health")) as unknown;
      return textResult(JSON.stringify(result, null, 2));
    },
  );

  ctx.tools.register(
    "opensandbox_get_sandbox",
    {
      displayName: "OpenSandbox Get Sandbox",
      description:
        "Fetch current metadata for a sandbox (id, image, status, execd endpoint).",
      parametersSchema: {
        type: "object",
        properties: { sandboxId: { type: "string" } },
        required: ["sandboxId"],
      },
    },
    async (params) => {
      const bridge = await bridgeFromContext(ctx);
      const { sandboxId } = params as { sandboxId: string };
      const result = await bridge.callTool("opensandbox_get_sandbox", { sandboxId });
      return textResult(JSON.stringify(result, null, 2));
    },
  );

  ctx.tools.register(
    "opensandbox_run_playwright",
    {
      displayName: "OpenSandbox Run Playwright",
      description:
        "Upload a Playwright script to a sandbox and run it. If no script is supplied, generates a screenshot smoke test against targetUrl.",
      parametersSchema: {
        type: "object",
        properties: {
          sandboxId: { type: "string" },
          targetUrl: { type: "string" },
          script: { type: "string" },
        },
        required: ["sandboxId", "targetUrl"],
      },
    },
    async (params) => {
      const bridge = await bridgeFromContext(ctx);
      const { sandboxId, targetUrl, script } = params as {
        sandboxId: string;
        targetUrl: string;
        script?: string;
      };
      const result = await bridge.callTool("opensandbox_run_playwright", {
        sandboxId,
        targetUrl,
        ...(script ? { script } : {}),
      });
      return textResult(JSON.stringify(result, null, 2));
    },
  );

  ctx.tools.register(
    "opensandbox_download_file",
    {
      displayName: "OpenSandbox Download File",
      description:
        "Download a file from a sandbox. Returns the file content as text or base64.",
      parametersSchema: {
        type: "object",
        properties: {
          sandboxId: { type: "string" },
          path: { type: "string" },
          encoding: { type: "string", enum: ["text", "base64"] },
        },
        required: ["sandboxId", "path"],
      },
    },
    async (params) => {
      const bridge = await bridgeFromContext(ctx);
      const { sandboxId, path, encoding } = params as {
        sandboxId: string;
        path: string;
        encoding?: "text" | "base64";
      };
      const result = await bridge.callTool("opensandbox_download_file", {
        sandboxId,
        path,
        ...(encoding ? { encoding } : {}),
      });
      return textResult(JSON.stringify(result, null, 2));
    },
  );

  ctx.tools.register(
    "opensandbox_get_command_logs",
    {
      displayName: "OpenSandbox Get Command Logs",
      description: "Fetch logs from a background command running in a sandbox.",
      parametersSchema: {
        type: "object",
        properties: {
          sandboxId: { type: "string" },
          commandId: { type: "string" },
        },
        required: ["sandboxId", "commandId"],
      },
    },
    async (params) => {
      const bridge = await bridgeFromContext(ctx);
      const { sandboxId, commandId } = params as { sandboxId: string; commandId: string };
      const result = await bridge.callTool("opensandbox_get_command_logs", {
        sandboxId,
        commandId,
      });
      return textResult(JSON.stringify(result, null, 2));
    },
  );

  ctx.tools.register(
    "opensandbox_bootstrap_remote_host",
    {
      displayName: "OpenSandbox Bootstrap Remote Host",
      description:
        "Connect to a remote Linux host over SSH, install Docker/uv/opensandbox-server, and start the control plane. Use only when bootstrapping a new OpenSandbox deployment — the agent should not call this on every run.",
      parametersSchema: {
        type: "object",
        properties: {
          host: { type: "string" },
          username: { type: "string" },
          publicHost: { type: "string" },
          apiKey: { type: "string" },
        },
        required: ["host", "username"],
      },
    },
    async (params) => {
      const bridge = await bridgeFromContext(ctx);
      const result = await bridge.callTool("opensandbox_bootstrap_remote_host", params);
      return textResult(JSON.stringify(result, null, 2));
    },
  );
}
