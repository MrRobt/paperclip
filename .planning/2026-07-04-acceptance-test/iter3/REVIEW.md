# iter3 DESIGN.md — Self Review

> Status: codex CLI 0.115.0 与当前 ChatGPT 账户不兼容（`gpt-5.5` / `o3` / `gpt-5` / `gpt-4o` 都报"not supported"）。
> 用户升级 codex 后可用 `codex exec -c model="gpt-5.5" "review DESIGN.md"` 重跑。
> 本文档是 design author self-review，作为 codex 不可用时的 fallback。

---

## Strengths（设计做得对的地方）

1. **3 层分层清晰** — bundled skills / plugin 包 / per-agent schema 三个改动面互不耦合，每层可独立 ship 和 rollback
2. **D1-D10 决策显式** — 把所有关键选择列成表 + 理由，traceability 好；后续讨论"为什么不 X"有据可查
3. **风险与回滚段落**（§10）— 每个风险对应一个 mitigation + 一个 rollback path，操作性强
4. **PR 拆分（§12）** — 3 个 PR 互不阻塞（PR-1 / PR-2 串行，PR-3 可并行），merge 风险分散
5. **复用 iter2 验证的 mock** — §6.2 提的 `test-fixtures/mock-opensandbox.mjs` 就是 iter2 driver.mjs 验证过的那个，测试成本几乎为零

## Issues（需要修的设计缺陷）

### RED — 必须修

#### R1. PR-2 plugin host 集成路径未验证
§6.2 写"plugin-loader 扫描 packages/plugins/sandbox-providers/opensandbox/" + "spawn MCP server process" — 但 paperclip 现有 plugin host 是否真支持这种 `sandbox-provider` kind 的 plugin 不确定。需要先验证：
- `packages/plugins/sandbox-providers/e2b/` 等现有 5 个 provider 是怎么被 paperclip server 加载的？
- 它们的 plugin manifest 格式是什么？
- 现有 host 是否支持 stdio MCP server，还是只支持某种 SDK 风格？

**修法**：在 PR-2 实施前先做 1h 调研，输出 "现状报告" 段。如果现有 host 完全不兼容，要么改 host（超 PR-2 范围），要么降级为 B1' 简单方案（直接用 child_process spawn，不走 plugin host 抽象）。

#### R2. bundled skill `key` 命名冲突
§6.1 写"key: paperclipai/integrations/opensandbox-<slug>" — 但现有 bundled skill 的 key 可能是 `paperclipai/<category>/<slug>` 格式。**冲突或不规范需要核实**：
- 现有 bundled skill 的 key 是什么？
- category 用 `/` 分隔还是 `<category>/<slug>` 两段？

**修法**：先看 `packages/skills-catalog/catalog/bundled/*/SKILL.md` 现有 frontmatter 的 `key` 字段实际格式（**注：当前 D: cwd 在 sandbox-ui-test-demo，路径不对，需要先 cd 回 paperclip 根**）。然后对齐。

#### R3. JSON-RPC over stdio 桥（§6.2）— 没现成实现
§6.2 写了 `JsonRpcBridge` 伪代码，但 paperclip 服务端 Node.js 生态不一定有现成的 JSON-RPC stdio 库。`@paperclipai/plugin-sdk` 里有没有？

**修法**：在 PR-2 实施前查 `packages/plugin-sdk/`，看是否有 MCP client wrapper。如果没有，要么引入外部 npm 包（`@modelcontextprotocol/sdk`），要么自己写一个 minimal JSON-RPC bridge（200 行内）。

### YELLOW — 建议改

#### Y1. D5 与产品需求表述模糊
§4 D5 写 "per-agent 默认 enabled"，§3 Layer C1 写 "per-agent（默认 enabled）"，但产品需求"每 agent 都有自己的沙箱" 更强 — 应该明确说"per-agent 强制 enabled（不可关闭）"或"per-agent 可关闭但默认 enabled"。

**修法**：在 §4 D5 改成 "per-agent，默认 enabled，可关闭（admin override）"。

#### Y2. cost 计量（§7.3 + §3 Layer C1）粒度模糊
"按 wall-clock 记" 没说：
- 计入 cost events 的时机（sandbox.create 时？sandbox.delete 时？）
- 跨多个 run 复用同一 sandbox 时怎么分摊
- 与 LLM token cost 怎么对比

**修法**：§7.3 加一节 "Cost event 写入时机"：
```
sandbox.create  →  on each create_sandbox call
sandbox.delete  →  on each delete_sandbox call  
sandbox.compute →  on run completion, duration = run.endedAt - run.startedAt
                   (only the time the sandbox was alive during this run)
sandbox.storage →  hourly batch (not real-time)
```

#### Y3. §6.2 health check interval 30s 太短
30s 一次 stdio JSON-RPC 频繁 call `tools/list` 可能给 MCP server 增加负载。OpenSandbox 11 tools，每次 list 返回所有 tool defs（几 KB）。

**修法**：改成 5 min 一次，或者用 `tools/call opensandbox_health`（轻量）。

#### Y4. §8.2 新 endpoint 与现有路径不清晰
列了 4 个新 endpoint，但没说：
- 是否要加 auth（与现有 endpoint 一致？）
- 路径前缀是 `/api/` 还是别的？
- 与现有 agent CRUD endpoint 的关系（`GET /api/agents/:id` 是否要扩字段？）

**修法**：§8.2 加 "Auth" 列 + "Path prefix" 说明，并指出是否要扩展现有 endpoint（我倾向：是 — 在 `GET /api/agents/:id` 的 response 里加 `sandbox` 字段，比独立 endpoint 更 RESTful）。

#### Y5. §9.1 单元测试 — plugin-loader 不存在
§9.1 写 "plugin-loader.test.ts — 解析 plugin.json" — 但 paperclip 现有 plugin-loader 不存在（见 R1）。如果 PR-2 是新建 plugin-loader，那这个测试文件应该是 PR-2 的一部分，不是 PR-1。

**修法**：把单元测试移到 PR-2 的 checklist，§9.1 改成"PR-2 范围内"。

#### Y6. §6.2 拷源码 vs plugin-sdk 抽象
§1 D2 决策"拷贝源码" 与 §3 Layer B1 描述"通过 plugin-sdk 暴露 MCP tool 到 agent runtime" 略矛盾 — 既然是 plugin，理论上要符合 plugin-sdk 契约。如果 plugin-sdk 不支持 MCP server，需要扩 plugin-sdk（超 PR-2 范围）。

**修法**：在 §3 Layer B1 加一句："PR-2 实施时先确认 plugin-sdk 是否支持 MCP server kind，否则 plugin-sdk 也是 PR-2 范围"。

#### Y7. §8.1 工具暴露与 §3 Layer C1 的 "sandbox" 字段不同步
§3 Layer C1 schema 有 `provider` 字段（"opensandbox" / "e2b" / "daytona" / ...），但 §8.1 只列了 opensandbox 的 11 个 tool。

**修法**：§8.1 加 "其他 provider 未来扩展" 段落，说明本轮只接 opensandbox。

### GREEN — 设计正确，无需改

- G1. §5 实施计划工作量估算合理（A: 0.5h, B1: 2-3h, C1: 1-2h）
- G2. §6.3 数据模型（agents/runs/cost_events 三表加列）正确
- G3. §11 "不做" 列表清晰划界（Layer C2/C3 / B2 / 跨 sandbox 状态 都不做）

---

## Codebase Alignment Check（设计是否与 paperclip 现有约定一致）

需在实施前补：
1. **bundled skill `key` 命名规范** — 看现有 `packages/skills-catalog/catalog/bundled/operations/*/SKILL.md` 的 frontmatter
2. **plugin manifest 格式** — 看 `packages/plugins/sandbox-providers/e2b/` 的 plugin.json（如果存在）
3. **JSON-RPC / MCP 支持** — 看 `packages/plugin-sdk/`
4. **cost event schema** — 看 `packages/shared/src/schemas/cost.ts`
5. **agent config schema 扩展模式** — 看 `@paperclipai/shared` 的 agent.ts

## 修订优先级

| 优先级 | 项 | 工作量 | 何时做 |
|--------|-----|--------|--------|
| P0 | R1 plugin host 调研 | 1h | **PR-2 实施前必做** |
| P0 | R2 key 命名 | 0.5h | **PR-1 实施前必做** |
| P0 | R3 JSON-RPC 桥 | 1h | **PR-2 实施前必做** |
| P1 | Y1-D5 表述 | 0.1h | 立即（改文档） |
| P1 | Y2 cost 时机 | 0.2h | 立即 |
| P1 | Y3 health 间隔 | 0.1h | 立即 |
| P1 | Y4 endpoint 设计 | 0.2h | PR-3 实施前 |
| P2 | Y5/Y6/Y7 文档整理 | 0.2h | 立即 |

P0 三项必须先做（design-validate），P1 立即改文档，P2 顺手清。

---

## 建议下一步

不立即开始 PR-1。**先做 P0 三项调研**：
1. cd 回 paperclip 根
2. `ls packages/skills-catalog/catalog/bundled/` + 看一个 SKILL.md frontmatter
3. `ls packages/plugins/sandbox-providers/e2b/` + 看 plugin.json
4. `grep -r "JSON-RPC\|MCP" packages/plugin-sdk/`
5. 更新 DESIGN.md（补 §3 Layer B1 关于 host 的实现约束）
6. 然后再开始 PR-1
