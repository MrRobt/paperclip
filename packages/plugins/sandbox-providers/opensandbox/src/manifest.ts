import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

/**
 * OpenSandbox plugin manifest.
 *
 * Registers OpenSandbox as a Paperclip `sandbox_provider` environment
 * driver, plus 6 custom tools that the agent runtime can call directly
 * (`opensandbox_health`, `opensandbox_get_sandbox`, etc.).
 *
 * The driver lifecycle (acquire lease / execute command / upload files
 * / release) is wrapped around the opensandbox-orchestrator MCP
 * server's 11 tools — see `src/plugin.ts` and `src/bridge.ts`.
 */
const PLUGIN_ID = "paperclip.opensandbox-sandbox-provider";
const PLUGIN_VERSION = "0.1.0";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "OpenSandbox Sandbox Provider",
  description:
    "Provisions disposable sandboxes via the OpenSandbox control plane. Each agent gets an isolated environment, removing cross-agent interference and enabling reproducible runs.",
  author: "Paperclip",
  categories: ["automation"],
  capabilities: ["environment.drivers.register", "tools.register"],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  environmentDrivers: [
    {
      driverKey: "opensandbox",
      kind: "sandbox_provider",
      displayName: "OpenSandbox",
      description:
        "Provisions disposable OpenSandbox sandboxes. Each agent run gets its own short-lived container (configurable image + TTL) so file system, processes, and network are fully isolated from other agents and from the host.",
      configSchema: {
        type: "object",
        properties: {
          baseUrl: {
            type: "string",
            description:
              "OPENSANDBOX_BASE_URL — the OpenSandbox control plane HTTP endpoint (e.g. http://127.0.0.1:8080).",
          },
          apiKey: {
            type: "string",
            format: "secret-ref",
            description:
              "Optional bearer token for the OpenSandbox server. Falls back to OPENSANDBOX_API_KEY env var when omitted.",
          },
          useServerProxy: {
            type: "boolean",
            default: true,
            description:
              "Whether the OpenSandbox server proxies execd requests (default true).",
          },
          requestTimeoutMs: {
            type: "number",
            default: 120000,
            description: "HTTP request timeout in milliseconds.",
          },
          defaultImage: {
            type: "string",
            default: "mcr.microsoft.com/playwright:v1.61.1-noble",
            description:
              "Default container image for newly acquired sandboxes. Agent sandbox config can override this.",
          },
          defaultTtlSeconds: {
            type: "number",
            default: 600,
            description:
              "Default sandbox lifetime in seconds. Refreshed implicitly while the sandbox is in use.",
          },
        },
        required: ["baseUrl"],
      },
    },
  ],
};

export default manifest;
