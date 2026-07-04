# Per-Agent Sandbox Environment — 设计方案

> Status: **PR-1 + PR-2 + PR-3 全部合并并 push** (commits 6aac48d + 4829641 + 406697e + cf976d7 on `dev`)
> Owner: paperclip
> 目标：让公司内每个 agent 拥有独立的 disposable 沙箱环境，避免 agent 之间互相影响
> 实施进度：PR-1 (bundled skills) ✅ · PR-2 (plugin) ✅ · PR-3 (agent schema + UI) ✅
> 遗留：Layer C2 (run hooks 接 plugin) + C3 (UI 完整) — 单独 iter4

---

## 1. 背景与目标

### 产品需求
公司组织内每个 agent 跑任务时，应当运行在自己的 disposable 沙箱里（host 完全隔离），与同一公司内其他 agent、与其他公司、与其他租户彻底分开。

### 现状缺口
- Paperclip 当前所有 agent 共用 host filesystem（通过 `workspaces/<agent-id>/` 软隔离）
- 已存在 5 个 sandbox-provider plugin（`e2b` / `daytona` / `cloudflare` / `modal` / `exe-dev`）但都是 ad-hoc，没有 per-agent 默认接入
- OpenSandbox MCP 工具链（`opensandbox-orchestrator`）已通过 `paperclipai skill import` 引入到个别公司，但：
  - skill 描述了能力但 runtime 没有 MCP server 可用
  - 不是 bundled，新公司看不到
  - 缺乏 per-agent 配置入口

### 目标
1. 所有公司自动获得 4 个 opensandbox skill（`bundled/integrations/`）
2. Paperclip server 启动时通过 `sandbox-providers/opensandbox` plugin 把 opensandbox 注册为 environment driver
3. agent config 可启用/配置自己的沙箱（per-agent，默认 enabled）
4. 单 agent 内可端到端跑：create_sandbox → upload_files → run_command → download_file → delete_sandbox

### P0 调研修正（详见 P0-RESEARCH.md）

调研发现我原设计多处与 codebase 实际架构不符：

| 项 | 原设计 | 实际 | 修订 |
|----|--------|------|------|
| bundled skill key | `paperclipai/integrations/<slug>` | `paperclipai/bundled/<category>/<slug>`，categories 已有 5 个 | 新建 `bundled/integrations/` category |
| plugin 结构 | 纯 .mjs + `plugin.json` | TypeScript + `manifest.ts` + `plugin.ts` + `definePlugin()` + paperclip-managed worker | 用 TS 模板（参考 e2b） |
| 工具暴露 | MCP 11 tool 全部通过 stdio 转发 | 5 个 env driver 钩子（acquire/execute/realize/release/destroy）+ `ctx.tools.register()` 暴露剩余 6 个 | 混合方案：env driver + custom tools |

---

## 2. 现状盘点

```
paperclip/
├── packages/skills-catalog/
│   └── catalog/{bundled,optional}/<category>/<slug>/SKILL.md
├── packages/plugin-sdk/                    # 外部 plugin 契约
├── packages/plugins/
│   ├── sandbox-providers/
│   │   ├── e2b/  daytona/  cloudflare/  modal/  exe-dev/   # 已有 5 个
│   │   └── (opensandbox 缺失)
│   └── examples/...                        # 示例 plugin
├── packages/adapters/<name>-local/         # process/codex/claude 等
└── cli/src/commands/skill.ts               # paperclipai skill import/list
```

外部依赖：
```
opensandbox-orchestrator (D:/work/code/opensandbox-orchestrator)
├── mcp-server/index.mjs              # MCP stdio server（11 tools）
├── .mcp.json                          # Codex MCP 配置
├── skills/opensandbox-{ui-task,host-bootstrap,project-acceptance,task-runner}/
└── scripts/smoke-test.mjs
```

---

## 3. 三层集成方案

### Layer A — bundled skills（0.5 h）

**目标**：4 个 opensandbox skill 从外部 import 升级为 Paperclip 系统自带 bundled。

**文件结构**
```
packages/skills-catalog/catalog/bundled/
└── integrations/                          # 新建 category
    ├── opensandbox-host-bootstrap/
    │   ├── SKILL.md
    │   ├── references/opensandbox-workflow.md
    │   ├── references/...
    │   └── agents/openai.yaml
    ├── opensandbox-project-acceptance/
    │   └── (同上结构)
    ├── opensandbox-task-runner/
    │   └── (同上结构)
    └── opensandbox-ui-task/
        ├── SKILL.md
        ├── references/...
        ├── scripts/playwright-smoke-template.mjs
        └── agents/openai.yaml
```

**SKILL.md frontmatter 改动**（每个 skill）
- `key`: `local/<hash>/<slug>` → `paperclipai/bundled/integrations/<slug>`
- `source`: 现有 `local_path` 改为 `bundled`（如适用）
- `trustLevel`: 保留（`scripts_executables` / `assets` 不变）
- `recommendedForRoles`: 加 `devops`, `engineer`, `qa`

**build manifest**：`pnpm --filter @paperclipai/skills-catalog build:manifest`
**validate**：`pnpm --filter @paperclipai/skills-catalog validate`

**风险**：
- bundled 加进去后**不能 rollback**（用户期望 = 必装）。需 opensandbox skill 描述稳定后再加。
- CLAUDE.md 明示 skill 编辑必须同 commit 提交 `generated/catalog.json`。
- 新建 `integrations/` category 需 build:manifest 支持（验证过 — 现有 manifest schema 接受任意 category 字符串）。

---

### Layer B1 — opensandbox plugin 包（3-4 h）

**目标**：把 opensandbox-orchestrator 包装成 `packages/plugins/sandbox-providers/opensandbox/`，提供 environment driver 抽象 + custom tools。

**包结构**（参考 e2b）
```
packages/plugins/sandbox-providers/opensandbox/
├── package.json                          # name: @paperclipai/plugin-opensandbox
├── README.md
├── src/
│   ├── manifest.ts                       # PaperclipPluginManifestV1
│   ├── plugin.ts                         # definePlugin() — 5 env driver 钩子
│   ├── tools.ts                          # ctx.tools.register() — 6 custom tool
│   ├── bridge.ts                         # JSON-RPC over stdio → mcp-server
│   ├── worker.ts                         # plugin host 入口
│   ├── index.ts                          # re-exports
│   └── plugin.test.ts                    # vitest + mock
├── tsconfig.json
├── vitest.config.ts
├── vendor/                               # 拷贝 opensandbox-orchestrator 源码
│   └── mcp-server/                       # （被 bridge.ts child_process.spawn）
└── test-fixtures/
    └── mock-opensandbox.mjs              # 之前 driver.mjs 验证过的
```

**src/manifest.ts 草案**
```ts
import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "paperclip.opensandbox-sandbox-provider",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "OpenSandbox Sandbox Provider",
  description: "Provisions disposable sandboxes via OpenSandbox control plane (MCP-driven).",
  author: "Paperclip",
  categories: ["automation"],
  capabilities: ["environment.drivers.register", "tools.register"],
  entrypoints: { worker: "./dist/worker.js" },
  environmentDrivers: [{
    driverKey: "opensandbox",
    kind: "sandbox_provider",
    displayName: "OpenSandbox",
    description: "Provisions disposable OpenSandbox sandboxes for agent runs.",
    configSchema: {
      type: "object",
      properties: {
        baseUrl: { type: "string", required: true, description: "OPENSANDBOX_BASE_URL" },
        apiKey: { type: "string", format: "secret-ref", description: "OPENSANDBOX_API_KEY" },
        useServerProxy: { type: "boolean", default: true },
        requestTimeoutMs: { type: "number", default: 120000 },
        defaultImage: { type: "string", default: "mcr.microsoft.com/playwright:v1.61.1-noble" },
        defaultTtlSeconds: { type: "number", default: 600 },
      },
    },
  }],
};

export default manifest;
```

**src/plugin.ts 草案**（5 env driver 钩子）
```ts
import { definePlugin } from "@paperclipai/plugin-sdk";
import { OpenSandboxBridge } from "./bridge.js";

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("OpenSandbox plugin ready");
  },

  async onHealth() {
    return { status: "ok" };
  },

  async onEnvironmentValidateConfig({ config }) {
    if (!config.baseUrl) return { ok: false, errors: ["baseUrl is required"] };
    return { ok: true, normalizedConfig: { ...config } };
  },

  async onEnvironmentProbe({ config }) {
    // GET {baseUrl}/health via bridge
    return { ok: true, latencyMs: 0 };
  },

  async onEnvironmentAcquireLease({ config, instanceId }) {
    // bridge.call("opensandbox_create_sandbox", { image, ttlSeconds })
    return {
      providerLeaseId: sandbox.id,
      metadata: { sandboxId: sandbox.id, image: ..., execdEndpoint: ... },
    };
  },

  async onEnvironmentRealizeWorkspace({ providerLeaseId, workspacePath, files }) {
    // bridge.call("opensandbox_upload_files", { sandboxId, files: [{path, content}] })
  },

  async onEnvironmentExecute({ providerLeaseId, command, args, env, cwd }) {
    // bridge.call("opensandbox_run_command", { sandboxId, command, args, env })
    return { exitCode, stdout, stderr, timedOut };
  },

  async onEnvironmentReleaseLease({ providerLeaseId }) {
    // bridge.call("opensandbox_delete_sandbox", { id })
  },

  async onEnvironmentDestroyLease({ providerLeaseId }) {
    // force kill
  },
});

export default plugin;
```

**src/tools.ts 草案**（6 custom tool 通过 `ctx.tools.register()`）
```ts
export function registerTools(ctx) {
  ctx.tools.register("opensandbox_health", {
    displayName: "OpenSandbox Health",
    description: "...",
    parametersSchema: { type: "object", properties: {} },
  }, async (params) => {
    return { content: [{ type: "text", text: await bridge.health() }] };
  });

  ctx.tools.register("opensandbox_run_playwright", {...}, async (params) => {
    // bridge.call("opensandbox_run_playwright", { sandboxId, script, targetUrl })
  });

  ctx.tools.register("opensandbox_download_file", {...}, async (params) => {...});
  ctx.tools.register("opensandbox_get_command_logs", {...}, async (params) => {...});
  ctx.tools.register("opensandbox_bootstrap_remote_host", {...}, async (params) => {...});
  ctx.tools.register("opensandbox_get_sandbox", {...}, async (params) => {...});
}
```

**src/bridge.ts 草案**（JSON-RPC over stdio）
```ts
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export class OpenSandboxBridge {
  private child: ChildProcess;
  private pending = new Map<number, { resolve, reject }>();
  private buffer = "";

  constructor(mcpServerPath: string, env: Record<string, string>) {
    this.child = spawn("node", [mcpServerPath], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.on("data", (chunk) => this.onStdout(chunk));
  }

  async call(method: string, params: unknown): Promise<unknown> {
    const id = randomUUID();
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
    });
  }

  private onStdout(chunk: Buffer) {
    // parse Content-Length framing, dispatch to pending
  }

  async close() { this.child.kill(); }
}
```

**生命周期**
```
Paperclip server boot
  └─ plugin loader 加载 packages/plugins/sandbox-providers/opensandbox/
     └─ spawn worker (Node.js + tsc 编译产物)
        └─ worker.setup(ctx) 初始化 OpenSandboxBridge (spawn mcp-server)
        └─ worker.onHealth() 健康检查 (bridge.call("tools/list"))
        └─ agent invoke → ctx.tools.register() tools 暴露给 LLM
        └─ env driver 钩子: acquire/execute/realize/release/destroy → bridge.call(...)
```

**风险**：
- 拷贝 opensandbox-orchestrator vendor/ 后，mcp-server 的 npm 依赖怎么处理（`@modelcontextprotocol/sdk` 还是其它）
- 跨进程 stdio 通信需要稳定的 JSON-RPC 桥（200 行 TypeScript 自行实现）
- 现有 sandbox-providers 已被 pnpm-workspace 排除，独立打包 — 需要 server 端 plugin-loader 兼容
- TypeScript 编译产物 vs 上游 .mjs 源码 — bridge.ts 应 spawn `node vendor/mcp-server/index.mjs`（不需编译）

---

### Layer C1 — per-agent sandbox config（1-2 h）

**目标**：agent config 显式声明 sandbox 需求；runtime 据此决定是否给 agent 暴露 `opensandbox_*` tool。

**agent config schema**（在 `@paperclipai/shared` 的 zod schema 中扩展）
```ts
type AgentSandboxConfig = {
  enabled: boolean;                 // 默认 true（per-agent 沙箱是产品要求）
  provider: "opensandbox" | "e2b" | "daytona" | ...;  // 暂时仅 opensandbox
  image?: string;                   // 覆盖 plugin defaultImage
  ttlSeconds?: number;              // 覆盖 plugin defaultTtlSeconds
  envVars?: Record<string, string>; // 注入 sandbox 的额外 env
  autoCleanup: boolean;             // 任务结束自动 delete_sandbox（默认 true）
};

type Agent = {
  // ... 现有字段
  sandbox?: AgentSandboxConfig;
};
```

**runtime 行为**
- agent invoke 之前：runtime 检查 `agent.sandbox.enabled`
  - 启用：agent runtime 注入 `opensandbox_*` 工具到 LLM 的 tools 列表
  - 禁用：不暴露这些工具
- agent 心跳时：
  - 如果 sandbox enabled：spawn 一个 sandbox（`opensandbox_create_sandbox`），记录 `sandboxId` 到 run metadata
  - 任务执行：可调 `opensandbox_run_command` / `opensandbox_upload_files` / `opensandbox_run_playwright`
  - 任务完成（成功/失败）：如果 `autoCleanup=true`，调 `opensandbox_delete_sandbox`
- cost event 写 `sandbox.create` / `sandbox.delete` 等条目，附带 duration / image / size

**UI 改动**（最小）
- `ui/src/pages/AgentDetail.tsx`：加 "Sandbox" tab，显示当前 config + 允许 inline 编辑
- `ui/src/pages/NewAgentDialog.tsx`：加 "Enable sandbox by default" 复选框（默认勾选）
- 新建公司时：默认 sandbox config（`enabled: true, provider: "opensandbox"`）

**风险**：
- 现有 process adapter 不知道 sandbox — 改 adapter 是 Layer C2，本轮不做
- 但 C1 schema 准备好后，C2 只需在 invoke 流程前/后插 2 个 hook

---

## 4. 决策记录

| # | 决策 | 选项 | 采纳 | 理由 |
|---|------|------|------|------|
| D1 | bundled skill category | runtime / integrations / sandbox | **integrations**（新建 category） | 与未来 Datadog/Slack/e2b 集成对齐 |
| D2 | opensandbox-orchestrator 源码放置 | 拷贝 / submodule / npm | **拷贝到 plugin 包 `vendor/`** | 简单可控；季度 review 同步上游 |
| D3 | worker 启动时机 | always-on / lazy / per-session | **always-on + lazy fallback** | 简单 + 资源友好 |
| D4 | Tool 命名空间 | 保持 / 加前缀 / 重命名 | **保持 `opensandbox_*`** | skill 描述已用这些名字 |
| D5 | Tool 权限控制 | 全开 / role / company / **per-agent** | **per-agent 默认 enabled** | 产品需求"每 agent 都有沙箱" |
| D6 | OpenSandbox URL 配置 | env / instance / company / agent | **instance 默认，agent 可覆盖** | 分层清晰 |
| D7 | 默认 image / ttl 放哪 | plugin / company / agent / 调用时 | **plugin 默认，agent 可覆盖** | 一致 + 灵活 |
| D8 | 多租户配额 | 不限 / paperclip 限 / OpenSandbox 限 | **OpenSandbox 限，paperclip 记 usage** | paperclip 不背锅 |
| D9 | 与现有 5 个 sandbox-provider 关系 | 替换 / 叠加 / 互斥 | **叠加**（opensandbox 注册为新 driverKey） | 不替换老 provider |
| D10 | 现在做 Layer C2/C3 吗 | 立刻 / 推迟 / 不做 | **推迟**（C1 schema 先做） | C2 改 adapter 太多，C3 UI 等 C1 落地 |

---

## 5. 实施计划

### Phase 1（Week 1，4-6 h）— 推荐本轮做

| 任务 | 文件改动 | 工作量 |
|------|----------|--------|
| **A. bundled skills** | 4×SKILL.md + references + agents + build:manifest | 0.5 h |
| **B1. plugin 包** | packages/plugins/sandbox-providers/opensandbox/ 新建（plugin.json + mcp-server 拷贝 + package.json + README） | 1.5 h |
| **B1. plugin 注册** | plugin host loader 扫描新 plugin | 1 h |
| **C1. agent schema** | `@paperclipai/shared` zod + db migration + server 服务层 | 1 h |
| **C1. UI** | AgentDetail tab + NewAgentDialog 复选框 | 0.5 h |
| **端到端验证** | 新建公司 → 4 skill 自动可见；agent config 启用 sandbox → 心跳时 agent 调 opensandbox tool 成功 | 0.5 h |
| **commit + push** | 拆 3 PR | — |

### Phase 2（待定）— 不在本轮范围

- **B2**: MCP proxy 路由（`/api/mcp/opensandbox/tools/call` HTTP 暴露）
- **C2**: adapter 改造（process/codex/claude invoke 时自动包 sandbox）
- **C3**: 完整 UI（per-run sandbox 状态展示、sandbox 列表、artifact 浏览）

### 不做（除非产品/用户要求）
- L5 模糊测试
- L6 全任务 replay eval

---

## 6. 详细文件改动清单（Phase 1）

### 6.1 Layer A — 4 个 bundled skill

新增文件
```
packages/skills-catalog/catalog/bundled/integrations/
├── opensandbox-host-bootstrap/
│   ├── SKILL.md                                      # 从 D:/work/code/opensandbox-orchestrator/skills/opensandbox-host-bootstrap/SKILL.md 复制
│   ├── references/opensandbox-workflow.md            # 复制
│   ├── references/...                                # 复制（如有）
│   └── agents/openai.yaml                            # 复制（如有）
├── opensandbox-project-acceptance/
│   ├── SKILL.md
│   ├── references/...
│   └── agents/openai.yaml
├── opensandbox-task-runner/
│   ├── SKILL.md
│   ├── references/...
│   └── agents/openai.yaml
└── opensandbox-ui-task/
    ├── SKILL.md
    ├── references/...
    ├── scripts/playwright-smoke-template.mjs
    └── agents/openai.yaml
```

修改文件
```
packages/skills-catalog/generated/catalog.json    # build:manifest 重新生成
```

**SKILL.md frontmatter 改动**（每个 skill）
```diff
- key: local/<hash>/opensandbox-<slug>
+ key: paperclipai/bundled/integrations/opensandbox-<slug>
+ recommendedForRoles:
+   - devops
+   - engineer
+   - qa
```

### 6.2 Layer B1 — opensandbox plugin 包

新增文件
```
packages/plugins/sandbox-providers/opensandbox/
├── package.json
├── README.md
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── manifest.ts                       # PaperclipPluginManifestV1
│   ├── plugin.ts                         # definePlugin() — 5 env driver 钩子
│   ├── tools.ts                          # ctx.tools.register() — 6 custom tool
│   ├── bridge.ts                         # JSON-RPC over stdio → mcp-server
│   ├── worker.ts                         # plugin host 入口
│   ├── index.ts                          # re-exports
│   └── plugin.test.ts                    # vitest + mock
├── vendor/
│   └── mcp-server/                       # 拷自 D:/work/code/opensandbox-orchestrator/mcp-server/
│       ├── index.mjs
│       └── (deps 通过 plugin 包 package.json 处理)
└── test-fixtures/
    └── mock-opensandbox.mjs              # 之前 driver.mjs 验证过的
```

修改文件
```
server/src/services/plugin-loader.ts        # 确保 sandbox-providers 动态加载路径正确
```

**bridge.ts 核心**（伪代码，~200 行 TypeScript）
```ts
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

export class OpenSandboxBridge {
  private child: ChildProcess;
  private pending = new Map<number, { resolve; reject }>();
  private buffer = "";

  constructor(mcpServerPath: string, env: Record<string, string>) {
    this.child = spawn("node", [mcpServerPath], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout?.on("data", (chunk) => this.onStdout(chunk));
  }

  async call<T>(method: string, params: unknown): Promise<T> {
    const id = randomUUID();
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin?.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
    });
  }

  private onStdout(chunk: Buffer) {
    // parse Content-Length framing, dispatch to pending handlers
  }

  async close() {
    this.child.kill();
  }
}
```

### 6.3 Layer C1 — per-agent sandbox schema

修改文件
```
packages/shared/src/schemas/agent.ts            # 加 AgentSandboxConfig zod
packages/db/src/schema/agents.ts                # 加 sandbox JSONB 列
packages/db/src/migrations/00XX_*.sql           # migration
server/src/services/agents.ts                   # CRUD 支持 sandbox 字段
server/src/services/run-*.ts                    # invoke 时检查 agent.sandbox.enabled，注入 tools
server/src/services/cost.ts                     # 记 sandbox.create / sandbox.delete cost events
ui/src/pages/AgentDetail.tsx                    # Sandbox tab
ui/src/pages/NewAgentDialog.tsx                 # 默认勾选
ui/src/api/agents.ts                            # sandbox 字段类型
```

---

## 7. 数据模型

### 7.1 `agents` 表加列

```sql
ALTER TABLE agents
  ADD COLUMN sandbox_config JSONB,
  ADD COLUMN sandbox_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX idx_agents_sandbox_enabled
  ON agents(sandbox_enabled)
  WHERE sandbox_enabled = TRUE;
```

### 7.2 `runs` 表加列

```sql
ALTER TABLE runs
  ADD COLUMN sandbox_id TEXT,
  ADD COLUMN sandbox_provider TEXT,
  ADD COLUMN sandbox_image TEXT,
  ADD COLUMN sandbox_created_at TIMESTAMPTZ,
  ADD COLUMN sandbox_destroyed_at TIMESTAMPTZ;
```

### 7.3 `cost_events` 新 event_type

```ts
type CostEventType =
  | "llm.input" | "llm.output"           // 已有
  | "sandbox.create" | "sandbox.delete"  // 新增
  | "sandbox.compute"                    // 新增（按 wall-clock 记）
  | "sandbox.storage";                   // 新增
```

---

## 8. 接口

### 8.1 Agent 暴露给 LLM 的 tools 列表

**当 `agent.sandbox.enabled = true`**（per-agent 默认 enabled）：

通过 **5 个 env driver 钩子**（paperclip 内部调用，agent 不直接调）：
- `onEnvironmentAcquireLease` → `opensandbox_create_sandbox`
- `onEnvironmentRealizeWorkspace` → `opensandbox_upload_files`
- `onEnvironmentExecute` → `opensandbox_run_command`
- `onEnvironmentReleaseLease` → `opensandbox_delete_sandbox`
- `onEnvironmentDestroyLease` → 强制 kill

通过 **6 个 custom tool**（agent 直接调）：
- `opensandbox_health`
- `opensandbox_wait_sandbox`
- `opensandbox_get_sandbox`
- `opensandbox_run_playwright`
- `opensandbox_download_file`
- `opensandbox_get_command_logs`
- `opensandbox_bootstrap_remote_host`（安全考虑 — 默认不暴露，可配置）

**当 `agent.sandbox.enabled = false`**：
- 上述 6 个 custom tool 全部不暴露
- 但 env driver 钩子可能被 paperclip 内部其它流程触发（heartbeat / run 流程）— 若 disabled 则跳过

**说明**：
- env driver 钩子是 paperclip 的核心 sandbox 抽象（与 adapter 集成），不是 agent 直接工具
- custom tool 是 agent 可直接调用的 — 给 agent 灵活性去 debug / inspect sandbox 状态
- 名字与 opensandbox-orchestrator mcp-server 一致 — 保持 skill 描述与 runtime 对齐

### 8.2 Server API

**新 endpoint**：`GET /api/agents/:id/sandbox` — 返回当前 agent 的 sandbox config + 最近一次 sandbox 状态（如果 run 在跑）

**新 endpoint**：`PUT /api/agents/:id/sandbox` — 修改 sandbox config

**新 endpoint**：`GET /api/agents/:id/runs/:runId/sandbox` — 返回 run 的 sandbox 状态

**新 endpoint**：`GET /api/companies/:id/sandboxes` — 公司所有 active sandbox（admin 视图）

### 8.3 Internal hooks

**Before agent invoke**（`run-invocation.ts`）：
```ts
if (agent.sandbox?.enabled) {
  const sb = await mcp.call("opensandbox_create_sandbox", {
    image: agent.sandbox.image ?? pluginConfig.defaultImage,
    ttlSeconds: agent.sandbox.ttlSeconds ?? pluginConfig.defaultTtlSeconds,
  });
  run.sandboxId = sb.id;
  run.sandboxImage = agent.sandbox.image ?? pluginConfig.defaultImage;
  await db.update(runs).set({ sandboxId: sb.id, ... }).where(eq(runs.id, run.id));
}
```

**After agent run**（`run-completion.ts`）：
```ts
if (run.sandboxId && agent.sandbox?.autoCleanup) {
  await mcp.call("opensandbox_delete_sandbox", { id: run.sandboxId });
  await db.update(runs).set({ sandboxDestroyedAt: new Date() }).where(eq(runs.id, run.id));
}
```

---

## 9. 测试策略

### 9.1 Unit (vitest)

- `plugin-loader.test.ts` — 解析 plugin.json，启动 + 关闭 MCP server
- `agent-sandbox-config.test.ts` — zod schema 校验、默认值
- `tool-namespace.test.ts` — 检测 opensandbox_* 冲突

### 9.2 Integration (driver.mjs 升级)

- 启 mock OpenSandbox
- 启 paperclip server
- 新建公司 → GET /api/companies/:id/skills 包含 4 个 opensandbox skill
- 创建带 sandbox config 的 agent
- invoke heartbeat
- 验证：agent 收到 `opensandbox_*` tool 列表，agent 调用触发 mock OpenSandbox 流程
- 验证：run.sandboxId 被设置
- 验证：run 完成时 sandbox 被 delete（autoCleanup=true）

### 9.3 E2E (smoke script)

- 真实 OpenSandbox server（用之前 opensandbox-orchestrator 配 OPENSANDBOX_BASE_URL）
- 真实 agent
- 真实 task
- 验证：sandbox 真的创建了 + 任务真在 sandbox 里跑 + 输出对得上

### 9.4 Regression

- 现有 vitest 全过（agent 创建/run 流程不破）
- 现有 acceptance test (iter1+iter2) 全过

---

## 10. 风险与回滚

| 风险 | 缓解 | 回滚 |
|------|------|------|
| bundled skill 不可逆 | opensandbox skill 描述先稳定（已 0.1.0 一个月） | 极难：手动 remove + build manifest + 强制升级 |
| MCP 进程 crash 频发 | 健康检查 + 自动 restart + 禁用兜底 | disable plugin (`paperclipai config`) |
| Agent 频繁调 sandbox，cost 暴涨 | D8 OpenSandbox 端限流 + paperclip 计 usage | 改 agent sandbox.enabled=false |
| 配置 `OPENSANDBOX_BASE_URL` 错 | server boot 时 health check 失败 → disable | 改 env + 重启 server |
| 11 个 tool 占 agent context 太多 | 拆分：health / create / exec / files 4 组，按需暴露 | 暂时不暴露 `opensandbox_bootstrap_remote_host` |
| opensandbox-orchestrator 上游 breaking change | D2 拷贝 — 升级有缓冲 | 锁定版本，revert 拷贝 |

---

## 11. 不做（明确）

- **Layer C2 改造 adapter**：本轮只准备 schema 和 hook 点。改 process/codex/claude 5+ adapter 是 1-2 周工作
- **Layer C3 完整 UI**：本轮只加 minimal tab + 复选框。per-run 状态面板、artifact 浏览留给 Phase 2
- **MCP proxy（Layer B2）**：phase 1 直接 spawn stdio MCP server；HTTP proxy 等真有多人并发场景再说
- **跨 sandbox 共享 state**：file lock 跨 sandbox 怎么工作不在本轮范围
- **OpenSandbox 替代 5 个 sandbox-provider**：D9 决策叠加，不替换

---

## 12. 时间线 + 拆分 PR

| PR | 内容 | 依赖 | 估算 |
|----|------|------|------|
| **PR-1: Layer A** | bundled skills + build:manifest | 无 | 0.5 h |
| **PR-2: Layer B1** | opensandbox plugin 包 + plugin host 集成 | PR-1 | 2-3 h |
| **PR-3: Layer C1** | agent sandbox config schema + minimal UI | PR-1（可选） | 1-2 h |

每个 PR 独立可 merge + 独立回滚。

---

## 13. 实施 checklist

### PR-1 (Layer A)
- [ ] mkdir `packages/skills-catalog/catalog/bundled/integrations/`
- [ ] 复制 4 个 skill 完整目录
- [ ] 改每个 SKILL.md frontmatter：`source`, `key`
- [ ] 跑 `pnpm --filter @paperclipai/skills-catalog build:manifest`
- [ ] 验证 `generated/catalog.json` 含 4 个新 skill
- [ ] `pnpm --filter @paperclipai/skills-catalog validate`
- [ ] 浏览器新建公司 → 4 skill 自动可见
- [ ] commit + push

### PR-2 (Layer B1)
- [ ] mkdir `packages/plugins/sandbox-providers/opensandbox/`
- [ ] 写 `package.json`（参考 e2b/ 格式）
- [ ] 写 `plugin.json`（含 schema + health check）
- [ ] 拷 mcp-server/index.mjs
- [ ] 拷 mock-opensandbox.mjs 到 test-fixtures/
- [ ] 改 `server/src/services/plugin-loader.ts` 加载新 plugin
- [ ] 加 health check loop
- [ ] 跑 vitest 全过
- [ ] 启动 paperclip server + 设 OPENSANDBOX_BASE_URL → plugin 自动 spawn
- [ ] commit + push

### PR-3 (Layer C1)
- [ ] 改 `packages/shared/src/schemas/agent.ts` 加 AgentSandboxConfig zod
- [ ] 改 `packages/db/src/schema/agents.ts` 加 sandbox_config JSONB + sandbox_enabled BOOLEAN
- [ ] 写 `packages/db/src/migrations/00XX_agent_sandbox.sql`
- [ ] 跑 `pnpm db:generate` 检查 migration
- [ ] 改 `server/src/services/agents.ts` CRUD 支持 sandbox
- [ ] 改 `server/src/services/run-invocation.ts` / `run-completion.ts` 加 sandbox hook
- [ ] 改 `ui/src/pages/AgentDetail.tsx` 加 Sandbox tab
- [ ] 改 `ui/src/pages/NewAgentDialog.tsx` 加默认勾选
- [ ] 跑 vitest + e2e smoke
- [ ] commit + push

---

## 14. 相关文档

- `iter1/CHANGES.md` — 上一轮 6 issue 修复
- `iter1/FIXES.md` — 修复闭环
- `iter2/sandbox-ui-test-demo/driver.mjs` — 已验证的 wire protocol 流程
- `iter2/sandbox-ui-test-demo/mock-opensandbox.mjs` — 测试用 mock
- 外部：`D:/work/code/opensandbox-orchestrator/README.md` + AGENTS.md + skills/
- Paperclip `CLAUDE.md`（项目级规则）
- Paperclip `doc/plugins/PLUGIN_SPEC.md`（plugin 规范）
