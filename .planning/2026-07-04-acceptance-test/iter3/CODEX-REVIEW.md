# iter3 Codex Review (commit `3fa7d42` 之后)

由 `npx @openai/codex@0.142.5 exec --full-auto` 产出，针对 9 个 iter3 commit
(6aac48d, 4829641, 406697e, cf976d7, 2bd5d4d, 6887b59, 0a84e1c, 324e98b, 3fa7d42)。

## 评级总览

| 区域 | 评级 | 备注 |
|------|------|------|
| type-safety | GREEN | 0 个 `as any` / unsafe cast |
| 端到端功能 | GREEN | heartbeat → lease row 真打通，provider=opensandbox |
| runtime safety | **YELLOW** | codex 发现 6 个 issue，其中 3 P1 真隐患 |

## Codex findings

### P1 (priority 1 — 真 bug)

#### #1 — plugin.ts:176 `realizeWorkspace` 错配 SDK 契约
- `realizeWorkspace` 读 `params.files` / `params.providerLeaseId` + 返回 `{ ok, uploadedCount }`
- SDK 实际给 `params.lease` / `params.workspace` + 要求返回 `{ cwd }` ([protocol.ts:495](packages/plugins/sdk/src/protocol.ts#L495))
- `execute` 同样问题（plugin.ts:195）—— 运行时调 sandbox_id 时拿不到
- **影响**：end-to-end 测试碰巧通过是因为 mock OpenSandbox 返回固定 sandbox id；真 OpenSandbox 会 NPE

#### #2 — plugin.ts:220 release/destroy 错传字段名，cleanup 静默失败
- 调 `opensandbox_delete_sandbox({ id })` 但 MCP server 期望 `{ sandboxId }`
  → `api.deleteSandbox(args.sandboxId)` 拿到 `undefined`
- `releaseRunLease` 用 `console.warn` 静默吞错
- **影响**：真实 sandbox 容器在 lease 释放后继续运行，资源泄漏
- **修法**：plugin.ts line ~226 — `await sharedBridge.callTool("opensandbox_delete_sandbox", { sandboxId: ... })`

#### #3 — orchestrator overlay 仅对 `driver:"plugin"` 工作但 UI 用 `driver:"sandbox"`
- UI 在 `CompanyEnvironments.tsx:67` 用 `driver: "sandbox"` 配 OpenSandbox（不是 plugin）
- `applyAgentSandboxOverlay` 只在 `env.driver === "plugin"` 时合并 — 实际 UI 创建的 env 永远不应用 agent.sandboxConfig
- 手动创建 `plugin` env 的路径上，overlay 写到顶层 config 但 `environment-runtime.ts:898` 只发 `driverConfig` 给 worker — 那路径也丢
- **影响**：产品目标「per-agent 独立沙箱」在 UI 创建 env 场景下实际未生效
- **修法**：
  - 选项 A：UI 创建 OpenSandbox env 时改用 `driver: "plugin"`
  - 选项 B：orchestrator overlay 同时支持 `driver: "sandbox"` 当 config 有 `provider` 字段

### P2 (应该修)

#### #4 — tools.ts:35 `ctx.config.raw` 不存在
- PluginContext.config 是 async `get()` API，不是 `raw` 字段
- `worker-rpc-host.ts:415` 永远不 build `raw`
- **影响**：所有 6 个 custom tool 跑时都拿到 `{}` → `baseUrl is required` 错误
- **修法**：每个 tool 用 `await ctx.config.get()` 拿 config object

#### #5 — environment-execution-target 无 "plugin" driver 分支
- `environment-execution-target.ts:107` 在 `driver: "plugin"` 返回 null（除非 local/sandbox/ssh）
- main orchestrator `environment-run-orchestrator.ts:435` 跳过 plugin env 的 workspace realization
- **影响**：即使 plugin env 配好 + agent.sandboxConfig 启用，实际 run 时无法执行命令
- **修法**：补 plugin driver 的 transport resolution 分支

### P3

#### #6 — `NODE_PATH` 路径算错
- 算成 `server/plugins/sdk` 不是 `packages/plugins/sdk`
- 本地 link 掩盖了，但 fallback 错
- **影响**：production install（无 link）会失败

## Iter4 待办（基于本 review）

| 优先级 | 任务 | 文件 |
|--------|------|------|
| P1 | release/destroy 改 `sandboxId` 字段 | `src/plugin.ts:220-250` |
| P1 | realizeWorkspace 改 SDK 契约 | `src/plugin.ts:170-200` |
| P1 | UI 创建 OpenSandbox env 改用 `driver: "plugin"` 或 overlay 支持 sandbox driver | `ui/src/pages/CompanyEnvironments.tsx:67` + `server/src/services/environment-run-orchestrator.ts:145` |
| P2 | tools 改用 `ctx.config.get()` | `src/tools.ts` (6 个工具) |
| P2 | transport resolution 加 plugin driver 分支 | `server/src/services/environment-execution-target.ts:107` |
| P3 | NODE_PATH fallback 路径修正 | `server/src/services/plugin-worker-manager.ts:731` |
