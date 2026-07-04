import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const SERVER_NAME = "opensandbox-orchestrator";
const SERVER_VERSION = "0.1.0";
const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.OPENSANDBOX_REQUEST_TIMEOUT_MS ?? "120000", 10);
const DEFAULT_SERVER_PORT = Number.parseInt(process.env.OPENSANDBOX_SERVER_PORT ?? "8080", 10);
const DEFAULT_EXECD_PORT = Number.parseInt(process.env.OPENSANDBOX_EXECD_PORT ?? "44772", 10);
const DEFAULT_USE_SERVER_PROXY = (process.env.OPENSANDBOX_USE_SERVER_PROXY ?? "true").toLowerCase() !== "false";

const toolDefinitions = [
  {
    name: "opensandbox_health",
    description: "Check the OpenSandbox control plane configuration and report the active runtime settings.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "opensandbox_bootstrap_remote_host",
    description: "Connect to a remote Linux host over SSH and install Docker, uv, and opensandbox-server, then start the control plane service.",
    inputSchema: {
      type: "object",
      properties: {
        host: { type: "string" },
        port: { type: "integer" },
        username: { type: "string" },
        password: { type: "string" },
        privateKeyPath: { type: "string" },
        publicHost: { type: "string", description: "Public hostname or IP that local clients should use to reach the server." },
        serverPort: { type: "integer" },
        installDir: { type: "string" },
        apiKey: { type: "string", description: "Optional future-facing value returned to the caller for client config. Current bootstrap does not inject it into server config." },
        skipDockerInstall: { type: "boolean" }
      },
      required: ["host", "username"],
      additionalProperties: false
    }
  },
  {
    name: "opensandbox_create_sandbox",
    description: "Create a sandbox through the OpenSandbox control plane.",
    inputSchema: {
      type: "object",
      properties: {
        image: { type: "string", description: "Container image URI, for example mcr.microsoft.com/playwright:v1.61.1-noble." },
        cpuCount: { type: "number" },
        memoryGb: { type: "number" },
        timeoutMinutes: { type: "number" },
        env: {
          type: "object",
          additionalProperties: { type: "string" }
        },
        labels: {
          type: "object",
          additionalProperties: { type: "string" }
        },
        metadata: {
          type: "object",
          additionalProperties: true
        },
        ports: {
          type: "array",
          items: { type: "integer" }
        },
        secure: { type: "boolean" },
        useGpu: { type: "boolean" },
        entrypoint: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["image"],
      additionalProperties: false
    }
  },
  {
    name: "opensandbox_wait_sandbox",
    description: "Poll a sandbox until it is ready or a timeout is reached.",
    inputSchema: {
      type: "object",
      properties: {
        sandboxId: { type: "string" },
        timeoutMs: { type: "integer" },
        pollIntervalMs: { type: "integer" },
        readyStates: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["sandboxId"],
      additionalProperties: false
    }
  },
  {
    name: "opensandbox_get_sandbox",
    description: "Fetch the latest sandbox metadata from the control plane.",
    inputSchema: {
      type: "object",
      properties: {
        sandboxId: { type: "string" }
      },
      required: ["sandboxId"],
      additionalProperties: false
    }
  },
  {
    name: "opensandbox_run_command",
    description: "Run a command through the sandbox execd service and stream back the event log.",
    inputSchema: {
      type: "object",
      properties: {
        sandboxId: { type: "string" },
        command: { type: "string" },
        cwd: { type: "string" },
        timeoutSeconds: { type: "integer" },
        background: { type: "boolean" },
        env: {
          type: "object",
          additionalProperties: { type: "string" }
        },
        execdPort: { type: "integer" },
        useServerProxy: { type: "boolean" }
      },
      required: ["sandboxId", "command"],
      additionalProperties: false
    }
  },
  {
    name: "opensandbox_get_command_logs",
    description: "Fetch background command logs from execd.",
    inputSchema: {
      type: "object",
      properties: {
        sandboxId: { type: "string" },
        commandId: { type: "string" },
        execdPort: { type: "integer" },
        useServerProxy: { type: "boolean" }
      },
      required: ["sandboxId", "commandId"],
      additionalProperties: false
    }
  },
  {
    name: "opensandbox_upload_files",
    description: "Upload one or more files into a sandbox. Each item accepts inline text or a host local path.",
    inputSchema: {
      type: "object",
      properties: {
        sandboxId: { type: "string" },
        items: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              sandboxPath: { type: "string" },
              localPath: { type: "string" },
              content: { type: "string" },
              encoding: { type: "string", enum: ["utf-8", "base64"] },
              permissions: { type: "string" }
            },
            required: ["sandboxPath"],
            additionalProperties: false
          }
        },
        execdPort: { type: "integer" },
        useServerProxy: { type: "boolean" }
      },
      required: ["sandboxId", "items"],
      additionalProperties: false
    }
  },
  {
    name: "opensandbox_download_file",
    description: "Download a file from a sandbox. Save it locally or return text or base64 in the result.",
    inputSchema: {
      type: "object",
      properties: {
        sandboxId: { type: "string" },
        sandboxPath: { type: "string" },
        localPath: { type: "string" },
        encoding: { type: "string", enum: ["utf-8", "base64"] },
        execdPort: { type: "integer" },
        useServerProxy: { type: "boolean" }
      },
      required: ["sandboxId", "sandboxPath"],
      additionalProperties: false
    }
  },
  {
    name: "opensandbox_run_playwright",
    description: "Upload and run a Playwright script inside the sandbox. If no script is supplied, generate a screenshot smoke test.",
    inputSchema: {
      type: "object",
      properties: {
        sandboxId: { type: "string" },
        targetUrl: { type: "string" },
        script: { type: "string" },
        scriptPath: { type: "string" },
        workdir: { type: "string" },
        artifactDir: { type: "string" },
        screenshotPath: { type: "string" },
        installCommand: { type: "string" },
        timeoutSeconds: { type: "integer" },
        env: {
          type: "object",
          additionalProperties: { type: "string" }
        },
        execdPort: { type: "integer" },
        useServerProxy: { type: "boolean" }
      },
      required: ["sandboxId"],
      additionalProperties: false
    }
  },
  {
    name: "opensandbox_delete_sandbox",
    description: "Delete a sandbox and release the runtime resources.",
    inputSchema: {
      type: "object",
      properties: {
        sandboxId: { type: "string" }
      },
      required: ["sandboxId"],
      additionalProperties: false
    }
  }
];

class JsonRpcError extends Error {
  constructor(code, message, data = undefined) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

class OpenSandboxClient {
  constructor() {
    const configuredBaseUrl = process.env.OPENSANDBOX_BASE_URL;
    if (!configuredBaseUrl) {
      throw new JsonRpcError(-32001, "OPENSANDBOX_BASE_URL is not configured.");
    }
    this.baseUrl = configuredBaseUrl.replace(/\/+$/, "");
    this.apiKey = process.env.OPENSANDBOX_API_KEY;
    this.timeoutMs = DEFAULT_TIMEOUT_MS;
  }

  async health() {
    return {
      baseUrl: this.baseUrl,
      apiKeyConfigured: Boolean(this.apiKey),
      serverPort: DEFAULT_SERVER_PORT,
      execdPort: DEFAULT_EXECD_PORT,
      useServerProxy: DEFAULT_USE_SERVER_PROXY,
      timeoutMs: this.timeoutMs
    };
  }

  async bootstrapRemoteHost(args) {
    const result = await bootstrapRemoteHost(args);
    return {
      ...result,
      recommendedBaseUrl: `http://${result.publicHost}:${result.serverPort}`,
      apiKeyConfigured: Boolean(args.apiKey)
    };
  }

  async createSandbox(args) {
    const payload = {
      image: { uri: args.image },
      entrypoint: Array.isArray(args.entrypoint) && args.entrypoint.length > 0
        ? args.entrypoint
        : ["tail", "-f", "/dev/null"],
      resourceLimits: buildResources(args),
      metadata: args.metadata ?? {},
      labels: args.labels ?? {},
      envs: objectEntries(args.env),
      secure: args.secure ?? false,
      use_gpu: args.useGpu ?? false
    };
    if (Array.isArray(args.ports) && args.ports.length > 0) {
      payload.exposed_ports = args.ports;
    }
    if (typeof args.timeoutMinutes === "number") {
      payload.timeout = Math.max(60, Math.round(args.timeoutMinutes * 60));
    }
    return this.fetchJson("/v1/sandboxes", {
      method: "POST",
      body: payload,
      expectedStatuses: [200, 201, 202]
    });
  }

  async getSandbox(sandboxId) {
    return this.fetchJson(`/v1/sandboxes/${encodeURIComponent(sandboxId)}`, {
      method: "GET"
    });
  }

  async deleteSandbox(sandboxId) {
    return this.fetchJson(`/v1/sandboxes/${encodeURIComponent(sandboxId)}`, {
      method: "DELETE",
      expectedStatuses: [200, 202, 204]
    });
  }

  async waitSandbox(sandboxId, timeoutMs, pollIntervalMs, readyStates) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      last = await this.getSandbox(sandboxId);
      const state = extractState(last);
      if (readyStates.includes(state)) {
        return {
          ready: true,
          state,
          sandbox: last
        };
      }
      if (isTerminalFailureState(state)) {
        return {
          ready: false,
          state,
          sandbox: last
        };
      }
      await delay(pollIntervalMs);
    }
    return {
      ready: false,
      state: last ? extractState(last) : "unknown",
      sandbox: last,
      timeoutMs
    };
  }

  async runCommand(args) {
    const response = await this.execdRequest(args.sandboxId, "/command", {
      method: "POST",
      body: {
        command: args.command,
        cwd: args.cwd,
        timeout_secs: args.timeoutSeconds,
        background: args.background ?? false,
        envs: args.env ?? {}
      },
      execdPort: args.execdPort,
      useServerProxy: args.useServerProxy
    });
    return response;
  }

  async getCommandLogs(args) {
    return this.execdRequest(args.sandboxId, `/command/${encodeURIComponent(args.commandId)}/logs`, {
      method: "GET",
      execdPort: args.execdPort,
      useServerProxy: args.useServerProxy
    });
  }

  async uploadFiles(args) {
    const form = new FormData();
    for (const item of args.items) {
      const content = await resolveUploadContent(item);
      const metadata = {
        path: item.sandboxPath,
        permissions: item.permissions
      };
      form.append("metadata", JSON.stringify(stripUndefined(metadata)));
      form.append("file", new Blob([content]), path.posix.basename(item.sandboxPath));
    }
    return this.execdRequest(args.sandboxId, "/files/upload", {
      method: "POST",
      body: form,
      execdPort: args.execdPort,
      useServerProxy: args.useServerProxy
    });
  }

  async downloadFile(args) {
    const response = await this.execdRawRequest(args.sandboxId, "/files/download", {
      method: "GET",
      query: {
        path: args.sandboxPath
      },
      execdPort: args.execdPort,
      useServerProxy: args.useServerProxy
    });
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    let savedTo = null;
    if (args.localPath) {
      const resolved = path.resolve(args.localPath);
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, buffer);
      savedTo = resolved;
    }
    const encoding = args.encoding ?? "utf-8";
    const content = encoding === "base64"
      ? buffer.toString("base64")
      : buffer.toString("utf-8");
    return {
      sandboxPath: args.sandboxPath,
      savedTo,
      encoding,
      sizeBytes: buffer.byteLength,
      content
    };
  }

  async runPlaywright(args) {
    const scriptPath = args.scriptPath ?? "/workspace/opensandbox-playwright-test.mjs";
    const artifactDir = args.artifactDir ?? "/workspace/opensandbox-artifacts";
    const screenshotPath = args.screenshotPath ?? `${artifactDir}/page.png`;
    const workdir = args.workdir ?? path.posix.dirname(scriptPath);
    const script = args.script && args.script.trim().length > 0
      ? args.script
      : buildDefaultPlaywrightScript({
          targetUrl: args.targetUrl,
          screenshotPath
        });

    await this.uploadFiles({
      sandboxId: args.sandboxId,
      items: [
        {
          sandboxPath: scriptPath,
          content: script,
          encoding: "utf-8"
        }
      ],
      execdPort: args.execdPort,
      useServerProxy: args.useServerProxy
    });

    await this.runCommand({
      sandboxId: args.sandboxId,
      command: `mkdir -p ${shellQuote(workdir)} ${shellQuote(artifactDir)}`,
      execdPort: args.execdPort,
      useServerProxy: args.useServerProxy
    });

    if (args.installCommand) {
      await this.runCommand({
        sandboxId: args.sandboxId,
        command: args.installCommand,
        cwd: workdir,
        execdPort: args.execdPort,
        useServerProxy: args.useServerProxy
      });
    }

    return this.runCommand({
      sandboxId: args.sandboxId,
      command: `node ${shellQuote(scriptPath)}`,
      cwd: workdir,
      timeoutSeconds: args.timeoutSeconds,
      env: {
        TARGET_URL: args.targetUrl ?? "",
        PLAYWRIGHT_ARTIFACT_DIR: artifactDir,
        SCREENSHOT_PATH: screenshotPath,
        ...(args.env ?? {})
      },
      execdPort: args.execdPort,
      useServerProxy: args.useServerProxy
    });
  }

  async fetchJson(pathname, options) {
    const response = await this.fetchRaw(pathname, options);
    if (response.status === 204) {
      return { ok: true };
    }
    const text = await response.text();
    if (!text) {
      return { ok: true };
    }
    return parseMaybeJson(text);
  }

  async execdRequest(sandboxId, pathname, options) {
    const response = await this.execdRawRequest(sandboxId, pathname, options);
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    if (contentType.includes("text/event-stream")) {
      return parseSseResponse(text);
    }
    if (contentType.includes("application/json")) {
      return parseMaybeJson(text);
    }
    return {
      contentType,
      body: text
    };
  }

  async execdRawRequest(sandboxId, pathname, options) {
    const execdPort = options.execdPort ?? DEFAULT_EXECD_PORT;
    const useServerProxy = options.useServerProxy ?? DEFAULT_USE_SERVER_PROXY;
    const endpoint = await this.getSandboxEndpoint(sandboxId, execdPort, useServerProxy);
    const relativePath = String(pathname).replace(/^\/+/, "");
    const url = new URL(relativePath, ensureTrailingSlash(endpoint.url));
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return this.fetchByUrl(url.toString(), {
      ...options,
      headers: {
        ...endpoint.headers,
        ...(options.headers ?? {})
      }
    });
  }

  async getSandboxEndpoint(sandboxId, port, useServerProxy) {
    const payload = await this.fetchJson(
      `/v1/sandboxes/${encodeURIComponent(sandboxId)}/endpoints/${port}?use_server_proxy=${String(useServerProxy)}`,
      { method: "GET" }
    );
    return normalizeEndpointPayload(this.baseUrl, payload);
  }

  async fetchRaw(pathname, options = {}) {
    const url = new URL(pathname, ensureTrailingSlash(this.baseUrl));
    return this.fetchByUrl(url.toString(), options);
  }

  async fetchByUrl(url, options = {}) {
    const headers = new Headers(options.headers ?? {});
    if (this.apiKey && !headers.has("X-API-Key")) {
      headers.set("X-API-Key", this.apiKey);
    }
    const requestInit = {
      method: options.method ?? "GET",
      headers,
      signal: AbortSignal.timeout(this.timeoutMs)
    };
    if (options.body instanceof FormData) {
      requestInit.body = options.body;
    } else if (options.body !== undefined) {
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      requestInit.body = typeof options.body === "string" ? options.body : JSON.stringify(stripUndefined(options.body));
    }
    const response = await fetch(url, requestInit);
    const expectedStatuses = options.expectedStatuses ?? [200, 201];
    if (!expectedStatuses.includes(response.status)) {
      const text = await response.text();
      throw new JsonRpcError(
        -32002,
        `OpenSandbox request failed with status ${response.status}.`,
        {
          url,
          status: response.status,
          body: parseMaybeJson(text)
        }
      );
    }
    return response;
  }
}

const client = lazy(() => new OpenSandboxClient());

const server = {
  buffer: Buffer.alloc(0),
  transportMode: undefined,
  async handleMessage(message) {
    if (!message || typeof message !== "object") {
      return;
    }
    if (message.method === "notifications/initialized") {
      return;
    }
    if (message.method === "initialize") {
      return respond(message.id, {
        protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION
        }
      });
    }
    if (message.method === "tools/list") {
      return respond(message.id, { tools: toolDefinitions });
    }
    if (message.method === "tools/call") {
      try {
        const result = await dispatchToolCall(message.params?.name, message.params?.arguments ?? {});
        return respond(message.id, toolResult(result));
      } catch (error) {
        return respond(message.id, toolErrorResult(error));
      }
    }
    if (message.id !== undefined) {
      return respondError(message.id, new JsonRpcError(-32601, `Unsupported method: ${message.method}`));
    }
  }
};

process.stdin.on("data", async (chunk) => {
  server.buffer = Buffer.concat([server.buffer, chunk]);
  while (true) {
    const bodyText = readNextMessage();
    if (bodyText === undefined) {
      return;
    }
    try {
      await server.handleMessage(JSON.parse(bodyText));
    } catch (error) {
      const rpcError = error instanceof JsonRpcError
        ? error
        : new JsonRpcError(-32700, "Invalid JSON-RPC payload.", { detail: String(error.message ?? error) });
      respondError(null, rpcError);
    }
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});

async function dispatchToolCall(name, args) {
  const api = client();
  switch (name) {
    case "opensandbox_health":
      return api.health();
    case "opensandbox_bootstrap_remote_host":
      return api.bootstrapRemoteHost(args);
    case "opensandbox_create_sandbox":
      return api.createSandbox(args);
    case "opensandbox_wait_sandbox":
      return api.waitSandbox(
        args.sandboxId,
        args.timeoutMs ?? 180000,
        args.pollIntervalMs ?? 2000,
        args.readyStates ?? ["ready", "running", "active"]
      );
    case "opensandbox_get_sandbox":
      return api.getSandbox(args.sandboxId);
    case "opensandbox_run_command":
      return api.runCommand(args);
    case "opensandbox_get_command_logs":
      return api.getCommandLogs(args);
    case "opensandbox_upload_files":
      return api.uploadFiles(args);
    case "opensandbox_download_file":
      return api.downloadFile(args);
    case "opensandbox_run_playwright":
      return api.runPlaywright(args);
    case "opensandbox_delete_sandbox":
      return api.deleteSandbox(args.sandboxId);
    default:
      throw new JsonRpcError(-32601, `Unknown tool: ${name}`);
  }
}

function respond(id, result) {
  writeRpc({
    jsonrpc: "2.0",
    id,
    result
  });
}

function respondError(id, error) {
  writeRpc({
    jsonrpc: "2.0",
    id,
    error: {
      code: error.code ?? -32000,
      message: error.message ?? "Unknown error",
      data: error.data
    }
  });
}

function writeRpc(payload) {
  const body = JSON.stringify(payload);
  if (server.transportMode === "jsonl") {
    process.stdout.write(`${body}\n`);
    return;
  }
  const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n`;
  process.stdout.write(header);
  process.stdout.write(body);
}

function readNextMessage() {
  if (server.transportMode === "headers" || (!server.transportMode && looksLikeHeaderFrame(server.buffer))) {
    const separatorIndex = server.buffer.indexOf("\r\n\r\n");
    if (separatorIndex === -1) {
      return undefined;
    }
    const headerText = server.buffer.slice(0, separatorIndex).toString("utf-8");
    const contentLength = parseContentLength(headerText);
    const totalLength = separatorIndex + 4 + contentLength;
    if (server.buffer.length < totalLength) {
      return undefined;
    }
    server.transportMode = "headers";
    const bodyBuffer = server.buffer.slice(separatorIndex + 4, totalLength);
    server.buffer = server.buffer.slice(totalLength);
    return bodyBuffer.toString("utf-8");
  }

  const newlineIndex = server.buffer.indexOf("\n");
  if (newlineIndex === -1) {
    return undefined;
  }
  server.transportMode = "jsonl";
  const lineBuffer = server.buffer.slice(0, newlineIndex);
  server.buffer = server.buffer.slice(newlineIndex + 1);
  const line = lineBuffer.toString("utf-8").trim();
  return line || readNextMessage();
}

function looksLikeHeaderFrame(buffer) {
  return buffer.slice(0, 32).toString("utf-8").toLowerCase().startsWith("content-length:");
}

function toolResult(result) {
  const text = JSON.stringify(result, null, 2);
  return {
    content: [
      {
        type: "text",
        text
      }
    ],
    structuredContent: result
  };
}

function toolErrorResult(error) {
  const normalized = error instanceof JsonRpcError
    ? error
    : new JsonRpcError(-32000, error.message ?? "Unknown error", { stack: error.stack });
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            error: normalized.message,
            data: normalized.data
          },
          null,
          2
        )
      }
    ],
    structuredContent: {
      error: normalized.message,
      data: normalized.data
    },
    isError: true
  };
}

function parseContentLength(headerText) {
  const match = headerText.match(/content-length:\s*(\d+)/i);
  if (!match) {
    throw new JsonRpcError(-32600, "Missing Content-Length header.");
  }
  return Number.parseInt(match[1], 10);
}

function parseMaybeJson(text) {
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeEndpointPayload(baseUrl, payload) {
  const candidate = payload?.url
    ?? payload?.endpoint?.url
    ?? payload?.endpoint
    ?? payload?.data?.url
    ?? payload?.address;
  if (!candidate || typeof candidate !== "string") {
    throw new JsonRpcError(-32003, "OpenSandbox endpoint payload does not contain a URL.", { payload });
  }
  const url = candidate.startsWith("http://") || candidate.startsWith("https://")
    ? candidate
    : candidate.match(/^[^/]+:\d+\//)
      ? `${new URL(baseUrl).protocol}//${candidate}`
      : new URL(candidate, ensureTrailingSlash(baseUrl)).toString();
  const headers = normalizeHeaderObject(
    payload?.headers
    ?? payload?.required_headers
    ?? payload?.requiredHeaders
    ?? payload?.secure_access?.headers
  );
  return { url, headers };
}

function normalizeHeaderObject(input) {
  if (!input || typeof input !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)])
  );
}

function buildResources(args) {
  const cpuCount = typeof args.cpuCount === "number" ? args.cpuCount : 1;
  const memoryGb = typeof args.memoryGb === "number" ? args.memoryGb : 2;
  return {
    cpu: String(cpuCount),
    memory: `${memoryGb}Gi`
  };
}

function objectEntries(input) {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  return Object.entries(input).map(([name, value]) => ({
    name,
    value
  }));
}

function extractState(payload) {
  return String(
    payload?.status?.state
    ?? payload?.state
    ?? payload?.sandbox?.status?.state
    ?? payload?.status
    ?? payload?.sandbox?.state
    ?? "unknown"
  ).toLowerCase();
}

function isTerminalFailureState(state) {
  return ["failed", "error", "deleted", "terminated", "stopped"].includes(state);
}

function stripUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(stripUndefined);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefined(item)])
    );
  }
  return value;
}

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function lazy(factory) {
  let instance;
  return () => {
    if (!instance) {
      instance = factory();
    }
    return instance;
  };
}

async function resolveUploadContent(item) {
  if (item.localPath) {
    return fs.readFile(path.resolve(item.localPath));
  }
  if (item.content === undefined) {
    throw new JsonRpcError(-32602, "Each upload item needs either localPath or content.", { item });
  }
  return item.encoding === "base64"
    ? Buffer.from(item.content, "base64")
    : Buffer.from(item.content, "utf-8");
}

function parseSseResponse(text) {
  const events = [];
  let current = { dataLines: [] };
  const pushCurrent = () => {
    if (current.event || current.id || current.dataLines.length > 0) {
      const rawData = current.dataLines.join("\n");
      const data = parseMaybeJson(rawData);
      events.push({
        event: current.event ?? "message",
        id: current.id,
        data
      });
    }
    current = { dataLines: [] };
  };
  for (const line of text.split(/\r?\n/)) {
    if (!line) {
      pushCurrent();
      continue;
    }
    if (line.startsWith("event:")) {
      current.event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("id:")) {
      current.id = line.slice(3).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      current.dataLines.push(line.slice(5).trimStart());
    }
  }
  pushCurrent();
  const combinedText = events
    .map((event) => pickTextFragments(event.data).join("\n"))
    .filter(Boolean)
    .join("\n");
  const commandId = findCommandId(events);
  return {
    commandId,
    events,
    combinedText
  };
}

function pickTextFragments(value) {
  const result = [];
  walkObject(value, (entry) => {
    if (typeof entry !== "string") {
      return;
    }
    if (entry.length === 0) {
      return;
    }
    result.push(entry);
  }, ["stdout", "stderr", "output", "message", "text"]);
  return result;
}

function walkObject(value, visit, preferredKeys = []) {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value !== "object") {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => walkObject(item, visit, preferredKeys));
    return;
  }
  for (const key of preferredKeys) {
    if (key in value) {
      walkObject(value[key], visit, preferredKeys);
    }
  }
}

function findCommandId(events) {
  for (const event of events) {
    const data = event.data;
    const candidate = data?.command_id ?? data?.commandId ?? data?.id;
    if (candidate && typeof candidate === "string") {
      return candidate;
    }
  }
  return undefined;
}

function buildDefaultPlaywrightScript({ targetUrl, screenshotPath }) {
  return `import { chromium } from "playwright";

const targetUrl = process.env.TARGET_URL || ${JSON.stringify(targetUrl ?? "")};
if (!targetUrl) {
  throw new Error("TARGET_URL is required for the default Playwright smoke script.");
}

const screenshotPath = process.env.SCREENSHOT_PATH || ${JSON.stringify(screenshotPath)};
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(targetUrl, { waitUntil: "networkidle" });
console.log(JSON.stringify({
  url: page.url(),
  title: await page.title()
}));
await page.screenshot({ path: screenshotPath, fullPage: true });
await browser.close();
`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

async function bootstrapRemoteHost(args) {
  const ssh = normalizeSshArgs(args);
  const installDir = args.installDir ?? "/opt/opensandbox";
  const serverPort = args.serverPort ?? DEFAULT_SERVER_PORT;
  const publicHost = args.publicHost ?? args.host;
  const bootstrapScript = buildRemoteBootstrapScript({
    installDir,
    serverPort,
    publicHost,
    skipDockerInstall: args.skipDockerInstall ?? false
  });
  const execution = await runSshScript(ssh, bootstrapScript);
  return {
    host: ssh.host,
    port: ssh.port,
    username: ssh.username,
    publicHost,
    serverPort,
    installDir,
    stdout: execution.stdout,
    stderr: execution.stderr
  };
}

function normalizeSshArgs(args) {
  if (!args.host || !args.username) {
    throw new JsonRpcError(-32602, "host and username are required.");
  }
  if (!args.password && !args.privateKeyPath) {
    throw new JsonRpcError(-32602, "Provide either password or privateKeyPath for remote bootstrap.");
  }
  return {
    host: String(args.host),
    port: args.port ?? 22,
    username: String(args.username),
    password: args.password,
    privateKeyPath: args.privateKeyPath ? path.resolve(args.privateKeyPath) : undefined
  };
}

function buildRemoteBootstrapScript({ installDir, serverPort, publicHost, skipDockerInstall }) {
  return `#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR=${shellQuote(installDir)}
SERVER_PORT=${shellQuote(String(serverPort))}
PUBLIC_HOST=${shellQuote(publicHost)}
CONFIG_PATH="$HOME/.sandbox.toml"
LOG_PATH="$INSTALL_DIR/server.log"
PID_PATH="$INSTALL_DIR/server.pid"
UV_BIN="$HOME/.local/bin/uv"
UVX_BIN="$HOME/.local/bin/uvx"
SERVER_BIN="$HOME/.local/bin/opensandbox-server"
INSECURE_ACK="\${OPENSANDBOX_INSECURE_SERVER:-YES}"

mkdir -p "$INSTALL_DIR"

if [ "$(id -u)" -eq 0 ]; then
  PRIVILEGE=""
else
  PRIVILEGE="sudo"
fi

run_privileged() {
  if [ -n "$PRIVILEGE" ]; then
    $PRIVILEGE "$@"
  else
    "$@"
  fi
}

install_packages_apt() {
  run_privileged apt-get update
  run_privileged apt-get install -y curl ca-certificates python3 python3-pip openssh-client
}

install_packages_dnf() {
  run_privileged dnf install -y curl ca-certificates python3 python3-pip openssh-clients
}

install_packages_yum() {
  run_privileged yum install -y curl ca-certificates python3 python3-pip openssh-clients
}

if command -v apt-get >/dev/null 2>&1; then
  install_packages_apt
elif command -v dnf >/dev/null 2>&1; then
  install_packages_dnf
elif command -v yum >/dev/null 2>&1; then
  install_packages_yum
else
  echo "Unsupported package manager. Expected apt-get, dnf, or yum." >&2
  exit 1
fi

if [ "${skipDockerInstall ? "true" : "false"}" != "true" ] && ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

if command -v systemctl >/dev/null 2>&1; then
  run_privileged systemctl enable docker || true
  run_privileged systemctl start docker || true
fi

if [ ! -x "$UV_BIN" ]; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi

export PATH="$HOME/.local/bin:$PATH"

"$UV_BIN" tool install --upgrade opensandbox-server

if [ ! -f "$CONFIG_PATH" ]; then
  "$UVX_BIN" opensandbox-server init-config "$CONFIG_PATH" --example docker
fi

python3 - "$CONFIG_PATH" "$SERVER_PORT" <<'PY'
import pathlib
import re
import sys

config_path = pathlib.Path(sys.argv[1])
server_port = sys.argv[2]
text = config_path.read_text(encoding="utf-8")
text = re.sub(r'^host\\s*=\\s*".*?"\\s*$', 'host = "0.0.0.0"', text, flags=re.MULTILINE)
text = re.sub(r'^port\\s*=\\s*\\d+\\s*$', f'port = {server_port}', text, flags=re.MULTILINE)
config_path.write_text(text, encoding="utf-8")
PY

if [ -f "$PID_PATH" ] && kill -0 "$(cat "$PID_PATH")" >/dev/null 2>&1; then
  kill "$(cat "$PID_PATH")"
  sleep 2
fi

env OPENSANDBOX_INSECURE_SERVER="$INSECURE_ACK" nohup "$SERVER_BIN" >"$LOG_PATH" 2>&1 &
echo $! >"$PID_PATH"
sleep 5

if ! kill -0 "$(cat "$PID_PATH")" >/dev/null 2>&1; then
  echo "opensandbox-server failed to stay up. Recent log tail:" >&2
  tail -n 80 "$LOG_PATH" >&2 || true
  exit 1
fi

if command -v ss >/dev/null 2>&1; then
  ss -ltnp | grep ":$SERVER_PORT" || true
fi

cat <<EOF
BOOTSTRAP_OK=1
PUBLIC_BASE_URL=http://$PUBLIC_HOST:$SERVER_PORT
CONFIG_PATH=$CONFIG_PATH
LOG_PATH=$LOG_PATH
PID_PATH=$PID_PATH
EOF
`;
}

async function runSshScript(ssh, script) {
  const args = [
    "-o", "BatchMode=no",
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-p", String(ssh.port)
  ];
  if (ssh.privateKeyPath) {
    args.push("-i", ssh.privateKeyPath);
  }
  args.push(`${ssh.username}@${ssh.host}`, "bash -s");

  const env = { ...process.env };
  let cleanup = async () => {};
  if (ssh.password) {
    const askpass = await createAskPassScript(ssh.password);
    cleanup = askpass.cleanup;
    env.SSH_ASKPASS = askpass.path;
    env.SSH_ASKPASS_REQUIRE = "force";
    env.DISPLAY = "codex-opensandbox-bootstrap";
  }

  try {
    return await spawnWithInput("ssh", args, script, env);
  } finally {
    await cleanup();
  }
}

async function createAskPassScript(password) {
  const tempDir = await fs.mkdtemp(path.join(process.cwd(), ".opensandbox-askpass-"));
  const scriptPath = path.join(tempDir, "askpass.cmd");
  const scriptBody = `@echo off\r\necho ${escapeCmdEcho(password)}\r\n`;
  await fs.writeFile(scriptPath, scriptBody, "utf-8");
  return {
    path: scriptPath,
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

function escapeCmdEcho(value) {
  return String(value).replace(/[%^&|<>]/g, "^$&");
}

async function spawnWithInput(command, args, input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", (error) => {
      reject(new JsonRpcError(-32004, `Failed to start ${command}.`, { error: String(error.message ?? error) }));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new JsonRpcError(-32005, `${command} exited with code ${code}.`, {
        args,
        stdout,
        stderr: redactSecrets(stderr)
      }));
    });
    child.stdin.end(input, "utf-8");
  });
}

function redactSecrets(text) {
  return String(text)
    .replace(/password/gi, "[redacted]")
    .replace(/passphrase/gi, "[redacted]");
}
