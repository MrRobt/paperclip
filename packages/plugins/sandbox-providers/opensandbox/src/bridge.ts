/**
 * JSON-RPC over stdio bridge to the opensandbox-orchestrator MCP server.
 *
 * The MCP server uses Content-Length framed JSON-RPC 2.0 over stdio
 * (see `vendor/mcp-server/index.mjs`). This bridge handles the framing
 * and request/response correlation so `plugin.ts` can call methods
 * with `await bridge.call("opensandbox_create_sandbox", {...})`.
 */

import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";

export interface BridgeOptions {
  mcpServerPath: string;
  env?: Record<string, string>;
  cwd?: string;
}

interface PendingCall {
  id: number;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

/**
 * Lightweight JSON-RPC 2.0 over stdio client.
 *
 * - `call(method, params)` returns a promise that resolves with the
 *   result of the matching response, or rejects with the error message
 *   from a JSON-RPC error response.
 * - `notify(method, params)` sends a fire-and-forget notification
 *   (no response expected).
 * - Exposes an `exit` event when the underlying child process exits.
 */
export class OpenSandboxBridge extends EventEmitter {
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<number, PendingCall>();
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private closed = false;

  constructor(opts: BridgeOptions) {
    super();
    this.child = spawn("node", [opts.mcpServerPath], {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.on("data", (chunk) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      // MCP server logs to stderr; relay at debug level
      this.emit("stderr", chunk.toString("utf8"));
    });
    this.child.on("exit", (code, signal) => {
      this.closed = true;
      const err = new Error(`opensandbox MCP server exited code=${code} signal=${signal}`);
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
      this.emit("exit", { code, signal });
    });
    this.child.on("error", (err) => {
      this.emit("stderr", `spawn error: ${err.message}`);
    });
  }

  call<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error("bridge closed"));
    }
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} });
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { id, resolve: resolve as (v: unknown) => void, reject });
      try {
        this.child.stdin.write(
          `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`,
        );
      } catch (err) {
        this.pending.delete(id);
        reject(err as Error);
      }
    });
  }

  /**
   * Call an MCP tool — wraps `tools/call` with the tool name + arguments.
   * Use this for opensandbox_* tool invocations.
   */
  callTool<T = unknown>(name: string, args?: unknown): Promise<T> {
    return this.call<T>("tools/call", { name, arguments: args ?? {} });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params: params ?? {} });
    try {
      this.child.stdin.write(
        `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`,
      );
    } catch {
      // ignore — process likely closed
    }
  }

  async initialize(clientInfo: { name: string; version: string }): Promise<void> {
    await this.call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo,
    });
    this.notify("notifications/initialized", {});
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.child.stdin.end();
    } catch {
      // ignore
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          this.child.kill("SIGTERM");
        } catch {
          // ignore
        }
        resolve();
      }, 2000);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private onStdout(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    // Parse Content-Length framed messages
    // (we always operate on a single in-process MCP server; no pipelining)
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const headerText = this.buffer.slice(0, headerEnd).toString("utf8");
      const match = headerText.match(/content-length:\s*(\d+)/i);
      if (!match) {
        // Not a valid framed message — flush and bail to avoid infinite loop
        this.buffer = Buffer.alloc(0);
        return;
      }
      const contentLength = Number.parseInt(match[1]!, 10);
      const totalLength = headerEnd + 4 + contentLength;
      if (this.buffer.length < totalLength) return;
      const body = this.buffer.slice(headerEnd + 4, totalLength).toString("utf8");
      this.buffer = this.buffer.slice(totalLength);
      this.handleMessage(body);
    }
  }

  private handleMessage(body: string): void {
    let parsed: { id?: number; result?: unknown; error?: { message: string; code?: number } };
    try {
      parsed = JSON.parse(body) as typeof parsed;
    } catch (err) {
      this.emit("stderr", `failed to parse MCP message: ${(err as Error).message}`);
      return;
    }
    if (parsed.id == null) return; // notification
    const pending = this.pending.get(parsed.id);
    if (!pending) return;
    this.pending.delete(parsed.id);
    if (parsed.error) {
      pending.reject(new Error(parsed.error.message));
    } else {
      pending.resolve(parsed.result);
    }
  }
}

/** Convenience: stable id for run correlation. */
export function newRunId(): string {
  return randomUUID();
}
