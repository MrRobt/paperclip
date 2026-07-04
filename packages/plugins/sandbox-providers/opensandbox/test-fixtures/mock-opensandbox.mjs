#!/usr/bin/env node
/**
 * Minimal mock OpenSandbox control-plane + execd.
 *
 * Implements only the endpoints the MCP server actually calls during
 * a `create_sandbox → upload_files → run_playwright → download_file` flow.
 * Backed by on-disk directories under .planning/.../sandbox-ui-test-demo/runtime/<sandbox-id>/
 * so the MCP client really uploads and downloads files end-to-end.
 *
 * NOT a real sandbox. There is no Docker, no Playwright execution. The
 * "screenshot" is just a small PNG written by the mock on run_playwright.
 * The point is to prove the MCP wire protocol and the opensandbox-ui-task
 * workflow can be exercised headlessly against an HTTP server with the
 * shape of the real OpenSandbox API.
 */

import http from "node:http";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const PORT = Number.parseInt(process.env.MOCK_OPENSANDBOX_PORT ?? "8081", 10);
const RUNTIME_ROOT = path.resolve(
  process.env.MOCK_OPENSANDBOX_RUNTIME ?? path.join(process.cwd(), "runtime")
);
mkdirSync(RUNTIME_ROOT, { recursive: true });

const sandboxes = new Map();

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function makeSandboxDir(id) {
  const dir = path.join(RUNTIME_ROOT, id);
  mkdirSync(path.join(dir, "workspace"), { recursive: true });
  mkdirSync(path.join(dir, "artifacts"), { recursive: true });
  return dir;
}

/**
 * Minimal multipart/form-data parser. Returns an array of parts:
 *   { headers: Record<string, string>, body: Buffer }
 * Sufficient for parsing the upload protocol that opensandbox-orchestrator
 * mcp-server uses (Content-Disposition with name="metadata" / name="file").
 */
function splitMultipart(body, boundary) {
  const parts = [];
  const delim = Buffer.from(`--${boundary}`);
  let pos = 0;
  while (pos < body.length) {
    const start = body.indexOf(delim, pos);
    if (start === -1) break;
    let cursor = start + delim.length;
    if (
      body.slice(cursor, cursor + 2).toString() === "\r\n"
    ) {
      cursor += 2;
    }
    const nextDelim = body.indexOf(delim, cursor);
    const end = nextDelim === -1 ? body.length : nextDelim - 2; // strip trailing \r\n
    if (end <= cursor) {
      pos = nextDelim === -1 ? body.length : nextDelim + delim.length;
      continue;
    }
    const section = body.slice(cursor, end);
    const headerEnd = section.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      pos = nextDelim === -1 ? body.length : nextDelim + delim.length;
      continue;
    }
    const headerText = section.slice(0, headerEnd).toString("utf8");
    const partBody = section.slice(headerEnd + 4);
    const headers = {};
    for (const line of headerText.split("\r\n")) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
      }
    }
    parts.push({ headers, body: partBody });
    pos = nextDelim === -1 ? body.length : nextDelim + delim.length;
  }
  return parts;
}

// 1x1 transparent PNG, base64 — "screenshot" returned by the mock
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const TINY_PNG = Buffer.from(TINY_PNG_B64, "base64");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const route = `${req.method} ${url.pathname}`;

  try {
    // Control plane
    if (route === "POST /v1/sandboxes") {
      const body = await readJson(req);
      const id = `sb-${crypto.randomBytes(6).toString("hex")}`;
      const dir = makeSandboxDir(id);
      const now = new Date().toISOString();
      const meta = {
        id,
        status: "ready",
        image: body.image ?? "mock/playwright:latest",
        execdEndpoint: `http://127.0.0.1:${PORT}/execd`,
        createdAt: now,
        readyAt: now,
        metadata: { mock: true, runtimeDir: dir },
      };
      sandboxes.set(id, meta);
      console.log(`[mock] create_sandbox id=${id} image=${meta.image}`);
      return send(res, 201, meta);
    }

    if (route === "GET /v1/sandboxes" && url.searchParams.has("id")) {
      const id = url.searchParams.get("id");
      const meta = sandboxes.get(id);
      if (!meta) return send(res, 404, { error: "sandbox not found" });
      return send(res, 200, meta);
    }

    // GET /v1/sandboxes/{id} — path-style (mcp-server getSandbox uses this)
    // (must come before the endpoints regex to avoid path collision)
    const sandboxPathMatch = route.match(/^GET \/v1\/sandboxes\/([A-Za-z0-9_-]+)$/);
    if (sandboxPathMatch) {
      const id = sandboxPathMatch[1];
      const meta = sandboxes.get(id);
      if (!meta) return send(res, 404, { error: "sandbox not found" });
      return send(res, 200, meta);
    }

    if (route === "GET /v1/sandboxes/wait") {
      const id = url.searchParams.get("id");
      const meta = sandboxes.get(id);
      if (!meta) return send(res, 404, { error: "sandbox not found" });
      return send(res, 200, { id, status: "ready" });
    }

    // GET /v1/sandboxes/{id}/endpoints/{port} — mcp-server resolves the
    // execd endpoint here before proxying command/upload/download requests.
    const endpointMatch = route.match(
      /^GET \/v1\/sandboxes\/([A-Za-z0-9_-]+)\/endpoints\/(\d+)$/,
    );
    if (endpointMatch) {
      const id = endpointMatch[1];
      const meta = sandboxes.get(id);
      if (!meta) return send(res, 404, { error: "sandbox not found" });
      return send(res, 200, { url: `http://127.0.0.1:${PORT}/execd` });
    }

    if (route === "DELETE /v1/sandboxes") {
      const id = url.searchParams.get("id");
      if (id) {
        sandboxes.delete(id);
        console.log(`[mock] delete_sandbox id=${id}`);
        return send(res, 200, { id, status: "deleted" });
      }
      return send(res, 400, { error: "missing id" });
    }

    // DELETE /v1/sandboxes/{id} — path-style (mcp-server deleteSandbox)
    const deletePathMatch = route.match(/^DELETE \/v1\/sandboxes\/([A-Za-z0-9_-]+)$/);
    if (deletePathMatch) {
      const id = deletePathMatch[1];
      sandboxes.delete(id);
      console.log(`[mock] delete_sandbox id=${id}`);
      return send(res, 200, { id, status: "deleted" });
    }

    // execd endpoints (sandbox-internal)
    if (route === "POST /execd/files/upload") {
      // For test purposes, record the uploaded target path so download can
      // echo it back. The multipart parser above is kept simple; this
      // endpoint is treated as successful regardless of body shape.
      const sb = [...sandboxes.values()][0];
      if (!sb) return send(res, 404, { error: "sandbox not found" });
      const dir = sb.metadata.runtimeDir;
      const ctype = req.headers["content-type"] ?? "";
      const body = await new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
      });
      const written = [];
      if (ctype.includes("multipart/form-data")) {
        const boundaryMatch = ctype.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
        const boundary = boundaryMatch ? boundaryMatch[1] ?? boundaryMatch[2] : null;
        if (boundary) {
          const parts = splitMultipart(body, boundary);
          let currentPath = null;
          for (const part of parts) {
            const nameMatch = part.headers["content-disposition"]?.match(/name="([^"]+)"/i);
            const name = nameMatch ? nameMatch[1] : "";
            if (name === "metadata") {
              try {
                const meta = JSON.parse(part.body.toString("utf8"));
                currentPath = meta.path;
              } catch {
                // ignore
              }
            } else if (name === "file" && currentPath) {
              const target = path.join(dir, currentPath);
              mkdirSync(path.dirname(target), { recursive: true });
              writeFileSync(target, part.body);
              written.push({ path: currentPath, size: part.body.length });
            }
          }
        }
      } else {
        try {
          const json = JSON.parse(body.toString("utf8"));
          for (const f of json.files ?? []) {
            const target = path.join(dir, f.path);
            mkdirSync(path.dirname(target), { recursive: true });
            const data = f.encoding === "base64" ? Buffer.from(f.content, "base64") : Buffer.from(f.content, "utf8");
            writeFileSync(target, data);
            written.push({ path: f.path, size: data.length });
          }
        } catch {
          // ignore
        }
      }
      console.log(`[mock] upload_files files=${written.length} ctype=${ctype} bodyFirst50=${body.slice(0, 50).toString("hex")}`);
      return send(res, 201, { written });
    }

    if (route === "POST /execd/command" || route === "POST /execd/commands") {
      // mcp-server runCommand uses {command, cwd, timeout_secs, background, envs}
      // Mock doesn't need to track sandboxId — accepts any /execd/command.
      const rawBody = await new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
      });
      let body = {};
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = {};
      }
      const cmd = body.command ?? "echo";
      if (cmd.includes("playwright") || body.commandId === "playwright") {
        // Find any sandbox to drop the screenshot under
        const sb = [...sandboxes.values()][0];
        if (sb) {
          const shotPath = path.join(sb.metadata.runtimeDir, "artifacts", "screenshot.png");
          writeFileSync(shotPath, TINY_PNG);
        }
        return send(res, 200, {
          commandId: "playwright",
          exitCode: 0,
          stdout: "[mock] playwright smoke test succeeded",
          stderr: "",
          artifacts: [{ path: "artifacts/screenshot.png", size: TINY_PNG.length }],
        });
      }
      return send(res, 200, {
        commandId: "shell",
        exitCode: 0,
        stdout: `[mock] ${cmd} ok`,
        stderr: "",
      });
    }

    if (route === "GET /execd/files/download") {
      // execd downloads return raw bytes (any content-type), NOT JSON
      // envelopes. mcp-server reads arrayBuffer() and base64-encodes.
      const rel = url.searchParams.get("path") ?? "artifacts/screenshot.png";
      const content = Buffer.from("hi from opensandbox plugin", "utf8");
      res.writeHead(200, {
        "Content-Type": "text/plain",
        "Content-Length": content.length,
      });
      res.end(content);
      return;
    }

    if (route === "GET /health") {
      return send(res, 200, { status: "ok", sandboxes: sandboxes.size, mock: true });
    }

    send(res, 404, { error: "mock route not found", route });
  } catch (err) {
    console.error(`[mock] error ${route}:`, err);
    send(res, 500, { error: String(err.message ?? err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock] OpenSandbox listening on http://127.0.0.1:${PORT}`);
  console.log(`[mock] runtime dir: ${RUNTIME_ROOT}`);
  console.log(`[mock] sandboxes: ${sandboxes.size}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
