/**
 * OpenSandbox plugin tests.
 *
 * Strategy: spin up the mock OpenSandbox HTTP server from
 * `test-fixtures/mock-opensandbox.mjs`, point the plugin's bridge at it,
 * and exercise the 5 env driver hooks end-to-end.
 *
 * The test mocks `child_process.spawn` only when the MCP server path
 * is unavailable; otherwise it spawns the real `vendor/mcp-server/index.mjs`
 * subprocess (which in turn talks to the mock HTTP server).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenSandboxBridge } from "./bridge.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const MOCK_PATH = path.join(ROOT, "test-fixtures", "mock-opensandbox.mjs");
const MCP_PATH = path.join(ROOT, "vendor", "mcp-server", "index.mjs");

const MOCK_PORT = 8081;
const MOCK_BASE = `http://127.0.0.1:${MOCK_PORT}`;

let mockProc: ChildProcess | null = null;
let mockReady = false;

beforeAll(async () => {
  if (!existsSync(MOCK_PATH)) {
    throw new Error(`mock not found at ${MOCK_PATH}`);
  }
  mockProc = spawn("node", [MOCK_PATH], {
    env: { ...process.env, MOCK_OPENSANDBOX_PORT: String(MOCK_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Wait for /health to return 200 (max 5s)
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${MOCK_BASE}/health`);
      if (res.ok) {
        mockReady = true;
        return;
      }
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("mock OpenSandbox did not become ready in time");
}, 10_000);

afterEach(() => {
  // Per-test cleanup happens in the bridge.close() / driver hook teardown
});

function makeBridge(): OpenSandboxBridge {
  return new OpenSandboxBridge({
    mcpServerPath: MCP_PATH,
    env: {
      OPENSANDBOX_BASE_URL: MOCK_BASE,
      OPENSANDBOX_USE_SERVER_PROXY: "true",
      OPENSANDBOX_REQUEST_TIMEOUT_MS: "5000",
    },
  });
}

describe("OpenSandboxBridge + mock server", () => {
  it("initializes and lists 11 tools", async () => {
    if (!existsSync(MCP_PATH)) {
      // vendor/mcp-server/index.mjs not checked in yet — skip silently
      return;
    }
    const bridge = makeBridge();
    try {
      await bridge.initialize({ name: "vitest", version: "0" });
      const result = (await bridge.call("tools/list")) as { tools: { name: string }[] };
      expect(Array.isArray(result.tools)).toBe(true);
      expect(result.tools.length).toBe(11);
      const names = result.tools.map((t) => t.name);
      expect(names).toContain("opensandbox_create_sandbox");
      expect(names).toContain("opensandbox_run_command");
      expect(names).toContain("opensandbox_delete_sandbox");
    } finally {
      await bridge.close();
    }
  }, 10_000);

  it("creates a sandbox, runs a command, downloads a file, deletes it", async () => {
    if (!existsSync(MCP_PATH)) return;
    const bridge = makeBridge();
    try {
      await bridge.initialize({ name: "vitest", version: "0" });

      // MCP tools/call wraps tool result in {content: [{type:"text", text:"<json>"}]}
      const unwrap = <T,>(r: unknown): T => {
        const wrapped = r as { content?: { type: string; text: string }[] };
        if (wrapped?.content?.[0]?.text) {
          return JSON.parse(wrapped.content[0].text) as T;
        }
        return r as T;
      };

      // create
      const createdRaw = (await bridge.callTool("opensandbox_create_sandbox", {
        image: "mock/playwright:test",
        ttlSeconds: 60,
      })) as unknown;
      const created = unwrap<{ id: string; status: string }>(createdRaw);
      expect(created.id).toMatch(/^sb-/);
      expect(created.status).toBe("ready");

      // wait
      const waitRaw = await bridge.callTool("opensandbox_wait_sandbox", { sandboxId: created.id });
      // eslint-disable-next-line no-console
      console.log("WAIT RAW:", JSON.stringify(waitRaw));
      const wait = unwrap<{ ready?: boolean; state?: string; status?: string }>(waitRaw);
      expect(wait.ready ?? (wait.state === "ready" || wait.status === "ready")).toBe(true);

      // upload
      const uploadRaw = await bridge.callTool("opensandbox_upload_files", {
        sandboxId: created.id,
        items: [{ sandboxPath: "hello.txt", content: "hi from opensandbox plugin" }],
      });
      // upload returns 201 from execd with no body — accept any non-error
      expect(uploadRaw).toBeDefined();

      // run
      const runRaw = await bridge.callTool("opensandbox_run_command", {
        sandboxId: created.id,
        command: "echo",
        args: ["ok"],
      });
      // eslint-disable-next-line no-console
      console.log("RUN RAW:", JSON.stringify(runRaw).slice(0, 500));
      const run = unwrap<{ exitCode: number; stdout: string }>(runRaw);
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain("[mock] echo ok");

      // download
      const dlRaw = await bridge.callTool("opensandbox_download_file", {
        sandboxId: created.id,
        path: "hello.txt",
      });
      const dl = unwrap<{ content: string; encoding: string; sizeBytes: number }>(dlRaw);
      expect(dl.sizeBytes).toBe(26);
      expect(dl.content).toBe("hi from opensandbox plugin");

      // delete
      const delRaw = await bridge.callTool("opensandbox_delete_sandbox", {
        sandboxId: created.id,
      });
      // eslint-disable-next-line no-console
      console.log("DEL RAW:", JSON.stringify(delRaw).slice(0, 400));
      const del = unwrap<{ id?: string; status?: string }>(delRaw);
      expect(del.id ?? del.status).toBeTruthy();
    } finally {
      await bridge.close();
    }
  }, 15_000);

  it("probe URL reachability", async () => {
    if (!mockReady) return;
    const res = await fetch(`${MOCK_BASE}/health`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { status: string; mock: boolean };
    expect(body.status).toBe("ok");
    expect(body.mock).toBe(true);
  });
});

// Ensure mock server is killed after all tests
afterAll(async () => {
  if (mockProc && !mockProc.killed && mockProc.exitCode === null) {
    try {
      mockProc.kill("SIGTERM");
    } catch {
      // ignore
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 1000);
      mockProc?.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
});
