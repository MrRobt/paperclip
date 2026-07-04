# iter3 P0 调研结论

> 在实施 PR-1/2/3 前必须完成。已确认现有 codebase 的关键约束。

## P0.1 — bundled skill key 命名 ✅

**实际格式**（看 `packages/skills-catalog/catalog/bundled/paperclip-operations/legion-self-solving/SKILL.md`）

```yaml
---
name: legion-self-solving
description: ...
key: paperclipai/bundled/paperclip-operations/legion-self-solving
recommendedForRoles:
  - engineer
  - qa
tags: [...]
---
```

**结论**
- key 格式：`paperclipai/bundled/<category>/<slug>`
- 已有 categories：`docs`, `paperclip-operations`, `product`, `quality`, `software-development`
- 我设计文档写 `paperclipai/bundled/integrations/<slug>` —— 需要新建 `integrations/` category

**修订**: DESIGN.md §6.1 + §4 D1 改为新建 `bundled/integrations/` category

---

## P0.2 — plugin 实际架构 ✅

**实际结构**（看 `packages/plugins/sandbox-providers/e2b/`）

```
e2b/
├── package.json                    # name: @paperclipai/plugin-e2b, deps: e2b
├── src/
│   ├── manifest.ts                 # PaperclipPluginManifestV1 typed
│   ├── plugin.ts                   # definePlugin({...})
│   ├── worker.ts                   # plugin host-managed worker entrypoint
│   ├── index.ts                    # re-exports
│   └── plugin.test.ts
├── tsconfig.json
├── vitest.config.ts
└── (dist/ 编译产物，build: "tsc")
```

**manifest 关键字段**

```ts
{
  id: "paperclip.e2b-sandbox-provider",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "E2B Sandbox Provider",
  categories: ["automation"],
  capabilities: ["environment.drivers.register"],
  entrypoints: { worker: "./dist/worker.js" },
  environmentDrivers: [{
    driverKey: "e2b",
    kind: "sandbox_provider",
    displayName: "E2B Cloud Sandbox",
    configSchema: { /* zod-like JSON schema */ },
  }],
}
```

**plugin.ts 关键钩子**

```ts
const plugin = definePlugin({
  async setup(ctx) { /* 启动时 */ },
  async onHealth() { return { status: "ok" }; },
  async onEnvironmentValidateConfig(params) { /* 验证 config */ },
  async onEnvironmentProbe(params) { /* 探活 */ },
  async onEnvironmentAcquireLease(params) { /* 创建 sandbox */ },
  async onEnvironmentResumeLease(params) { /* 重新连接 */ },
  async onEnvironmentReleaseLease(params) { /* 释放 */ },
  async onEnvironmentDestroyLease(params) { /* 强制销毁 */ },
  async onEnvironmentRealizeWorkspace(params) { /* 创建 workspace */ },
  async onEnvironmentExecute(params) { /* 跑命令 */ },
});
```

**修订**
- DESIGN.md §3 Layer B1 + §6.2 大改
- 不是 `plugin.json` —— 是 `manifest.ts` (TypeScript)
- 拷贝 opensandbox mcp-server 应作为 plugin **依赖**（`node_modules` 或 `file:`）而不是纯 .mjs inline
- 需要 TypeScript 编译（`tsc`），不是 `node mcp-server/index.mjs`
- package.json 字段 `paperclipPlugin.manifest` + `paperclipPlugin.worker`

---

## P0.3 — plugin-sdk 工具暴露 ✅

**PluginContext.tools API**（看 `packages/plugins/sdk/src/types.ts:986`）

```ts
register(
  name: string,
  declaration: Pick<PluginToolDeclaration, "displayName" | "description" | "parametersSchema">,
  fn: (params: unknown, runCtx: ToolRunContext) => Promise<ToolResult>,
): void;
```

**结论**
- plugin 可注册任意 custom tool 给 agent runtime
- 命名约定：tool name 跟 manifest declaration 匹配（**不带 namespace prefix**，namespace 在 host 层加）
- 这与 MCP 11 个 tool 完美对齐 — opensandbox plugin 可以：
  - 通过 5 个 env driver 钩子包装核心 sandbox 生命周期
  - 通过 `tools.register()` 暴露剩余 6 个（playwright, bootstrap, get_command_logs, download_file 等）

**修订**
- DESIGN.md §8.1 工具列表正确（保持 `opensandbox_*` namespace）
- 但**实现路径**修正：5 个 env driver 钩子 + 6 个 custom tool.register()，不是 11 个 MCP tool 都通过 stdio 转发

---

## 修订后的 opensandbox plugin 架构

```
packages/plugins/sandbox-providers/opensandbox/
├── package.json
│   name: @paperclipai/plugin-opensandbox
│   dependencies:
│   - opensandbox-orchestrator 作为 bundled deps（git+file: ../../../../opensandbox-orchestrator 或 npm）
├── src/
│   ├── manifest.ts
│   │   id: paperclip.opensandbox-sandbox-provider
│   │   categories: [automation]
│   │   capabilities: [environment.drivers.register, tools.register]
│   │   environmentDrivers: [{
│   │     driverKey: "opensandbox",
│   │     kind: sandbox_provider,
│   │     configSchema: {
│   │       baseUrl: { type: string, required: true },
│   │       apiKey: { type: string, format: secret-ref },
│   │       useServerProxy: { type: boolean, default: true },
│   │       defaultImage: { type: string, default: mcr.microsoft.com/playwright:v1.61.1-noble },
│   │       defaultTtlSeconds: { type: number, default: 600 }
│   │     }
│   │   }]
│   ├── plugin.ts
│   │   definePlugin({
│   │     setup(ctx) { ctx.logger.info("ready"); },
│   │     onHealth() { /* try OPENSANDBOX_BASE_URL/v1/sandboxes; return status */ },
│   │     onEnvironmentAcquireLease({ config, instanceId }) {
│   │       // → opensandbox_create_sandbox via mcp bridge
│   │       // 返回 { providerLeaseId, metadata: { sandboxId, image, ... } }
│   │     },
│   │     onEnvironmentExecute({ providerLeaseId, command, args, env, cwd }) {
│   │       // → opensandbox_run_command via mcp bridge
│   │       // 返回 { exitCode, stdout, stderr, timedOut }
│   │     },
│   │     onEnvironmentRealizeWorkspace({ providerLeaseId, workspacePath, files }) {
│   │       // → opensandbox_upload_files via mcp bridge
│   │     },
│   │     onEnvironmentReleaseLease({ providerLeaseId }) { /* delete_sandbox */ },
│   │     onEnvironmentDestroyLease({ providerLeaseId }) { /* force kill */ },
│   │     onEnvironmentProbe() { /* check base url */ },
│   │     onEnvironmentValidateConfig({ config }) { /* validate baseUrl/apiKey */ }
│   │   })
│   ├── tools.ts
│   │   ctx.tools.register("opensandbox_health", {...}, async (params, runCtx) => {...})
│   │   ctx.tools.register("opensandbox_run_playwright", {...}, async (params, runCtx) => {...})
│   │   ctx.tools.register("opensandbox_download_file", {...}, async (params, runCtx) => {...})
│   │   ctx.tools.register("opensandbox_get_command_logs", {...}, async (params, runCtx) => {...})
│   │   ctx.tools.register("opensandbox_bootstrap_remote_host", {...}, async (params, runCtx) => {...})
│   │   ctx.tools.register("opensandbox_get_sandbox", {...}, async (params, runCtx) => {...})
│   ├── bridge.ts
│   │   JSON-RPC over stdio 桥 (或复用 opensandbox-orchestrator mcp-server 作为 child process)
│   ├── index.ts
│   ├── worker.ts
│   └── plugin.test.ts
├── test-fixtures/
│   └── mock-opensandbox.mjs    # 之前 driver.mjs 验证过的
├── tsconfig.json
└── vitest.config.ts
```

**两种实现路径**

| 路径 | 优 | 劣 |
|------|----|----|
| **A. 包装 mcp-server 进程**（spawn `node mcp-server/index.mjs`） | 重用上游代码 | 跨进程 IPC，需要 JSON-RPC 桥 |
| **B. 直接用 OpenSandbox HTTP API**（不经过 MCP） | 单进程，TypeScript 原生 | 需要重写 11 个 tool 逻辑 |

**推荐：A**。理由：上游已经维护了 11 个 tool 的逻辑 + 输入校验，重写是重复劳动。bridge.ts 用 200 行 TypeScript 包装 `child_process.spawn` + JSON-RPC over stdio。

---

## DESIGN.md 需要的修订

| 章节 | 修订 |
|------|------|
| §3 Layer B1 | 改为"包装 opensandbox-orchestrator 作为 sandbox-provider plugin，用 definePlugin() + environmentDrivers + tools.register" |
| §4 D1 | bundled key 改用 `paperclipai/bundled/integrations/<slug>`（新建 integrations category） |
| §4 D2 | "拷贝 mcp-server 源码" 改为 "添加 opensandbox-orchestrator 为 plugin 的 bundled 依赖（pnpm workspace 或 file: protocol）" |
| §4 D3 | MCP 进程启动时机改为"plugin 启动时由 worker 内部 spawn mcp-server" |
| §6.1 SKILL.md frontmatter | key 格式修正 |
| §6.2 plugin 包结构 | 改为 TypeScript 模板（manifest.ts + plugin.ts + tools.ts + bridge.ts） |
| §8.1 tool 列表 | 5 个走 env driver 钩子，6 个走 tools.register() |
| §12 PR 拆分 | 调整（PR-2 实施需写更多 TS 代码，工作量上调） |

---

## 实施顺序（修订后）

### PR-1: Layer A — bundled skills（0.5h）
- mkdir `packages/skills-catalog/catalog/bundled/integrations/`
- 复制 4 个 skill 完整目录
- 改 frontmatter `key: paperclipai/bundled/integrations/<slug>`
- `pnpm --filter @paperclipai/skills-catalog build:manifest`
- **风险**: 新建 category — manifest schema 接受吗？需 build:manifest 跑通验证

### PR-2: Layer B1 — opensandbox plugin（3-4h，比原估多 1h）
- mkdir `packages/plugins/sandbox-providers/opensandbox/`
- 写 `package.json`（参考 e2b）
- 写 `src/manifest.ts`
- 写 `src/plugin.ts`（5 env driver 钩子）
- 写 `src/tools.ts`（6 custom tool）
- 写 `src/bridge.ts`（JSON-RPC over stdio，~200 行）
- 写 `src/worker.ts` + `src/index.ts`
- 写 `src/plugin.test.ts`（vitest + mock）
- 拷 `test-fixtures/mock-opensandbox.mjs`（之前 driver.mjs 用的）
- `pnpm typecheck + test` 通过
- **风险**: TypeScript 类型 + bridge 正确性 — 需仔细测

### PR-3: Layer C1 — agent config schema + UI（1-2h）
- 改 `@paperclipai/shared` zod
- 改 `packages/db` schema
- 写 migration
- 改 `server/src/services/agents.ts` + run hooks
- 改 `ui/src/pages/AgentDetail.tsx` + `NewAgentDialog.tsx`
- **风险**: 改 server run hooks 可能影响现有 flow，需跑全 vitest

---

## 还有几个开放问题

1. **opensandbox-orchestrator 怎么作为 plugin 依赖？** 选项：
   - (a) `file:../../../../opensandbox-orchestrator`（外部路径）
   - (b) 拷贝到 `packages/plugins/sandbox-providers/opensandbox/vendor/mcp-server/`
   - (c) git submodule
   - 推荐 (b)：简单可控，季度同步
2. **plugin host 怎么启用 opensandbox plugin？** 看 `server/src/services/plugin-loader.ts` 是否自动扫描 `packages/plugins/sandbox-providers/*`（workspace 列表排除 sandbox-providers 因为独立打包）。需要查 server 怎么动态加载它们。
3. **agent runtime 怎么知道 sandbox driver 可用？** 已有 `environmentDrivers` 声明，server 应该会自动 expose 给 agent。

让我做 (2) 调研再开始 PR-2。
