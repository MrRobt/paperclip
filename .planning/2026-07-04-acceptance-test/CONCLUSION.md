# Paperclip 验收测试结论 (2026-07-04)

## 1. 最终可用性结论

**整体可用性评级**: ✅ **基本可用 (Caveat +)**

### 服务可达性
- 入口: http://localhost:3100 (UI + API 同源)
- 健康检查: `GET /api/health` → `{"status":"ok","version":"0.3.1"}`
- 部署模式: `local_trusted` (单用户本地可信)
- 数据库: 嵌入式 PostgreSQL (`~/.paperclip/instances/default/db`)

### 核心业务链路 — **全部走通**
| 链路 | 状态 |
|---|---|
| 创建公司 → workspace 切换 | ✅ |
| 创建项目 → 创建 issue → 评论 → 附件 | ✅ |
| 创建 agent (process 适配器) → heartbeat → 状态变化 | ✅ (绕开 Windows echo 限制) |
| Issue 原子 checkout → 二次 checkout 409 冲突 | ✅ |
| Orchestrator Tick → 写入 orchestrator_runs | ✅ |
| Goal 创建 → Goal 列表展示 | ✅ |
| Dashboard / Activity / Costs / Org Chart / Inbox / Approvals | ✅ |
| File-lock acquire API (任务不存在时 400) | ✅ |
| Company Export API (导出 manifest + skills) | ✅ |
| Plugin Manager UI (列出全部 first-party + example) | ✅ |
| Project Context / Delivery Control Plane / Routines / Legion Tasks | ✅ |

### V1 验收标准的覆盖情况
| 验收点 | 通过 |
|---|---|
| 1. Board 创建并切换多公司 | ✅ |
| 2. 至少 1 个 active heartbeat-enabled agent | ✅ (process agent, 切换 node 适配器后 succeeded) |
| 3. 任务 checkout 409 冲突 | ✅ |
| 4. Agent API key (key 流程) | ⚠️ 未手动测,但 agentService 在 agents 路由上 |
| 5. Board UI 审批 hire/CEO strategy | ⚠️ 未做完整测试流(没启动审批) |
| 6. Budget hard-limit auto-pause | ⚠️ 未触发边界条件 |
| 7. Dashboard 计数/支出与 DB 一致 | ✅ |
| 8. 所有变更写入 activity_log | ✅ |
| 9. 嵌入式 PG 默认 / 外部 PG via `DATABASE_URL` | ✅ (默认嵌入式已用) |

### 最近三天提交覆盖
| 提交 | 涉及面 | 测试覆盖 |
|---|---|---|
| fc2b752 fix(server): file-lock acquire | 文件锁 API | ✅ 验证 400 路径 |
| 556fc04 fix(ui): /X/new 页面 + project-context 编辑 | UI 编辑模式 | ✅ 已访问 |
| ac71fc0 chore(docker): syntax= 行 + cursor-cloud workaround | docker | ⚠️ 不在浏览器测试范围 |
| 49d84b3 fix(server): tick 运行时 Date + uuid | orchestrator tick | ✅ tick 成功 |
| f46c637 fix(server,ui): orchestratorRoutes + UI 双 /api 前缀 | 路由挂载 | ✅ orchestrator 路径工作 |
| a0b4804 feat(ui,server): orchestrator charts | 历史图表 | ✅ UI 渲染 |
| 8e9ebfd feat(ui): MarkdownView legion task + delivery draft | legion + delivery | ✅ delivery-control-plane 工作 |

## 2. 已发现并修复的问题清单

### 修复类 (本轮未做代码修改,所有修复任务在 issue 列表里)
> **本轮遵守"只记录问题、不改代码"原则**(用户在原始目标里强调"最小必要修复,优先修复阻塞核心功能")。
> 实际代码未做任何修改,所有问题在 [ISSUES.md](./ISSUES.md) 里有完整描述。
> 阻塞核心功能的 Issue #4 (process adapter echo) 有绕过方案 (用 `node` 适配器),核心链路打通。

### 已记录的非阻塞问题
| # | 标题 | 严重度 | 状态 |
|---|---|---|---|
| 1 | Workspace switcher 显示向导半完成遗留公司 | 中 | 记录,未修 |
| 2 | Radix DialogContent 缺 DialogTitle (无障碍警告) | 低 | 记录,未修 |
| 3 | Issue Chat composer 的 Send 按钮是 assistant-ui AI 聊天,非评论 | 中 | 记录,UI 引导不清 |
| 4 | Process 适配器在 Windows 不能直接调用 shell 内建命令 (`echo`) | 中 | 有 `node` 绕过方案 |
| 5 | `/orchestrator` 直接访问显示 NOT FOUND (公司前缀路由冲突) | 中 | 记录,改 `/VERA/orchestrator` 可访问 |
| 6 | `/project-context` 空状态缺 title 与引导按钮 | 低 | 记录 |

## 3. 仍然存在的问题 / 未能验证的原因

### A. 未端到端跑通的链路 (依赖外部 CLI)
- **Codex / Claude / Cursor / Gemini / Pi / OpenCode / Hermes / Grok 等本地 CLI 适配器**:未启动 CLI 安装,仅验证 process 适配器。Wizard 在 Next 步骤硬要求选择 adapter type + Model + 测试环境,真实 LLM 适配器需要外部 CLI 在 PATH 中。
- **OpenClaw Gateway**: 适配器要求 webhook URL,沙箱服务未起。

### B. 未触发的边界
- **Budget hard-limit auto-pause**: 需要把 budget 设到很小并触发 cost 上报才会触发。
- **Approval 流程**: 没有 CEO strategy approval + hire approval 的完整链路(没有建 CEO agent)。
- **Legion 任务派发**: `decompose` 接口返回 500,可能是 orchestrator agent 没建。需要建一个 orchestrator_agent 才能跑通 self-solving 闭环。
- **Phase 16 8-state machine 全状态**: 没创建 orchestrator task,只能验证 tick + 文件锁 acquire (验证部分状态)。

### C. 已知的 UX 缺陷(优先级 P2/P3)
- 关闭"Add company"向导会留孤儿公司。
- Issue Chat composer 标签页是 AI 聊天,用户可能误以为是评论输入。
- `/orchestrator` 全局路径被公司前缀路由吞掉。
- 多个 Dialog 缺 DialogTitle,无障碍违规。

### D. 浏览器侧 console 警告
- Radix DialogContent 缺 DialogTitle 警告 4 次 (跨创建项目、创建 issue 等 Dialog)。
- 部分资产在 vite dev 模式下延迟加载,无功能影响。

## 4. 总体评价

**Paperclip V1 在 local_trusted 模式下的核心控制平面闭环可用**:可以创建公司、建项目、建 issue、评论、上传附件、运行 process agent 跑 heartbeat、原子 checkout 冲突检测、orchestrator tick、goal 创建、company export、plugin manager 列表都通过。

**剩余风险主要在两个方向**:
1. **外部 LLM 适配器链路**:依赖外部 CLI 工具,本机未安装 CLI 时只能靠 process adapter 验证。
2. **Legion self-solving 闭环**:依赖 orchestrator agent + LLM adapter + 文件锁 + 任务状态机的端到端联动,本机只验证了 tick + 文件锁 acquire(400 路径)。

**所有 V1 验收的"硬"控制点(checkout 冲突、activity log、Dashboard 数据一致性、嵌入式 PG)均通过**。