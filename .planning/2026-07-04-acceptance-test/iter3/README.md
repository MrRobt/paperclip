# iter3 — Per-Agent Sandbox Environment

> 承接 iter1+iter2 acceptance test 的延伸需求：每个 agent 拥有独立沙箱环境。

## 文档结构

| 文件 | 内容 |
|------|------|
| [DESIGN.md](./DESIGN.md) | 完整设计方案（13 节） |
| [DECISIONS.md](./DECISIONS.md) | 10 项关键决策及理由（待写） |
| [CHANGES.md](./CHANGES.md) | 实施后真实改动（PR-1/2/3 merge 后） |

## 一句话总结

把 opensandbox-orchestrator（MCP server + 4 个 skill）深度集成到 Paperclip：
- **Layer A**: skill 进 bundled
- **Layer B1**: opensandbox 作为 plugin 包
- **Layer C1**: per-agent sandbox config

## 状态

- ✅ 设计已拍板（见 DESIGN.md §4 决策记录）
- ⏳ 待实施（3 PR，按顺序）

## 决策摘要（D1-D10）

| # | 决策 | 采纳 |
|---|------|------|
| D1 | bundled skill category | **integrations** |
| D2 | mcp-server 源码放置 | **拷贝到 plugin 包** |
| D3 | MCP 进程启动时机 | **always-on + lazy fallback** |
| D4 | Tool 命名空间 | **保持 opensandbox_*** |
| D5 | Tool 权限控制 | **per-agent 默认 enabled** |
| D6 | OpenSandbox URL 配置 | **instance 默认，agent 可覆盖** |
| D7 | 默认 image / ttl | **plugin 默认，agent 可覆盖** |
| D8 | 多租户配额 | **OpenSandbox 限，paperclip 记 usage** |
| D9 | 与现有 5 个 sandbox-provider | **叠加**（不替换） |
| D10 | Layer C2/C3（adapter / 完整 UI） | **推迟** |

## 实施计划

3 PR，按序可独立 merge：

- **PR-1** Layer A：bundled skills（0.5 h）
- **PR-2** Layer B1：plugin 包（2-3 h，依赖 PR-1）
- **PR-3** Layer C1：agent config schema + minimal UI（1-2 h，可选依赖 PR-1）

详见 [DESIGN.md §13 实施 checklist](../iter3/DESIGN.md)。

## 相关

- `../iter1/` — 6 issue 修复（路由、向导、a11y、shell fallback、project-context）
- `../iter2/` — 端到端验证 + sandbox UI test demo（mock OpenSandbox + driver.mjs）
- `../iter2/sandbox-ui-test-demo/` — 已验证的 wire protocol 流程
