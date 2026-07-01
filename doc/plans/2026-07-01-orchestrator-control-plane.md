# Paperclip 多 Agent 协作中枢 — 诊断 + 改造设计

> 日期：2026-07-01
> 状态：审计 + 设计阶段（按用户要求"先不要直接大规模改代码"）
> 关联计划：见末尾"与既有计划的关系"

---

## 一、当前能力盘点（基于实际代码审计）

### 1.1 数据模型已有

| 实体 | 已有 | 缺什么 |
|:---|:---|:---|
| `companies` | status, pauseReason, pausedAt, budget | 多长期目标字段缺失 |
| `goals` | status（planning/executing/verifying/completed/failed）、parentGoalId、goalStatus | **缺 Phase 概念**；状态机不能区分"代码完成 vs 实测通过" |
| `tasks`（Legion）| todo/in_progress/done/failed/verification_failed、verification_spec JSONB、dependencies、attempts | **缺 8 状态枚举**；description 是自由文本不是结构化模板 |
| `projects` | goalId、leadAgentId、status、executionWorkspacePolicy | 与 goal 的关系定位不明 |
| `agents` | role、title、reportsTo、adapterType | **缺 role="orchestrator" 专属字段** |
| `agent_memberships` / `agent_runtime_state` | 状态、能力 | 缺"主控权限"标记 |
| `execution_workspaces` | worktree 配置 | 缺端口/PID 占用登记 |
| `workspace_runtime_services` | dev server / preview URL | 缺 lease/释放状态 |
| `workspace_operations` | 日志 | 缺结构化"启动谁、占谁、释放谁" |
| `issue_blocker_policies` | level=hard/soft/notice | 已有，但仅限 issue，**Legion task 没接入** |
| `issue_recovery_actions` | source-scoped recovery | 仅 issue |
| `issue_execution_decisions` | decision log | 仅 issue |
| `approvals` / `issue_approvals` | 审批 | 缺"越权修改需主控审批"工作流 |
| `documents` / `document_revisions` / `issue_documents` | 文档 + 修订 | 缺 Markdown→HTML 渲染管道 |
| `issue_attachments` / `issue_work_products` | 附件 + 产出物 | 工作产品已是验收证据的一种 |
| `activity_log` / `cost_events` / `heartbeat_runs` | 审计 | 缺主控每轮决策专用字段 |
| `task_postmortems`（Phase 10） | 跨 run 记忆 | 是 per-task；**缺"项目级"上下文记忆表** |
| `task_verifications`（Phase 8） | 结构化验证证据 | ✓ 与验收证据吻合 |
| `handoffs`（Legion） | 任务间契约传递 | ✓ 与接口契约部分吻合 |
| `legion_git_config` / `pr_check_runs`（Phase 9） | PR + CI 状态 | ✓ 与文件归属部分吻合 |

### 1.2 服务 / 路由已有

- **Phase 8**：`verification-runner.ts`（7 种 check kind）、`legion.tasks.ts` verify 路由已重写（硬命令 + LLM 总结，LLM 不可翻盘）
- **Phase 9**：`legion-ci-watcher.ts`、`legion-merge.ts`、`goal-progress.ts`、`task-scheduler.ts`（DAG + handoff 门禁）
- **Phase 10**：`memory.ts`（record/query/buildFewShotContext）、`goal-decomposer.ts` `decomposeRecursive`（深度 ≤ 3）
- **Phase 11**：`skill-proposal.ts`（propose/approve/deny/rollback）、`skill-loader-strict.ts`
- **Phase 12**：`self-solving.ts` 路由（CLI 后端）、3 个 CLI 命令、smoke 脚本

### 1.3 UI 已有

- `Dashboard`, `Projects`, `Goals`, `Agents`, `Org`, `OrgChart`, `Issues`, `IssueDetail`, `Activity`, `Approvals`, `Routines`, `Inbox`, `MyIssues`, `Secrets`, `Settings`, `AdapterManager`, `PluginManager`, `PluginPage`, `CompanySettings`, `ExecutionWorkspaceDetail`, `IssueChatLongThreadPerf`
- `DeliveryControlPlanePage`（实时诊断 + 模型健康 + 草稿 + 恢复）
- 缺：**主控控制台、目标树视图、文件冲突图、阻塞链路图、验收证据表、Phase 进度图**

### 1.4 缺失项（按用户 13 个协作坑归类）

| 协作坑 | 现状 | 缺 |
|:---|:---|:---|
| 1. 目标拆解不清 | description 自由文本 | 结构化任务模板（objective/non_objective/inputs/outputs/files/acceptance/evidence/next_owner）|
| 2. 并行开发冲突 | 无文件锁 | `file_locks` 表 + 上锁/解锁服务 |
| 3. 状态虚假完成 | status 是 todo/done 二态 | 8 状态枚举（not_started/in_progress/blocked/code_landed_needs_runtime/partial_runtime_passed/actual_passed/failed/closed）|
| 4. 上下文丢失 | task_postmortems 已落地（per-task）| `project_context`（项目级：当前 Phase/已完成/部分完成/阻塞/风险/决策）|
| 5. 阻塞管理 | issue_blocker_policies 已有 | 扩展到 Legion task；区分强/弱阻塞 + owner + 解除条件 |
| 6. 验收标准缺失 | verification_spec 已落地（Phase 8）| 强校验：任务关闭必须 verified + evidence_paths[] 非空 |
| 7. 契约漂移 | handoffs 部分支持 | `interface_contracts` 表 + 服务端校验（API 任务必须先 spec 后代码）|
| 8. Agent 越权修改 | 审批存在但无"越权"语义 | 越权检测规则（全局配置/公共契约/新依赖/删除历史）+ 主控审批工作流 |
| 9. 环境抢占 | workspace_runtime_services 存在 | 增 lease/port/PID/owner/release_state；杀进程需声明 |
| 10. 文档过期 | documents 存在 | Markdown→HTML 渲染管道；变更后自动重生成 |
| 11. 重复劳动 | memory service 有，但 per-task | 跨任务"已调查结论"缓存 + decomposer 注入 |
| 12. 任务粒度不合理 | 无粒度校验 | goal-decomposer 加 estimated_duration 校验；超 240 分钟强制 sub-goal |
| 13. 失败无复盘 | postmortem 强制 | ✓ 已落地，但缺"失败阶段"维度（compile_failed/test_failed/runtime_failed/contract_drift）|

---

## 二、当前问题诊断报告

### P0 — 阻塞主控闭环

1. **没有"主控"角色**。`agents.role` 是字符串但没有"orchestrator"语义、没有专属权限边界。任意 agent 都可派活、approve 任务、改 PR → 主控失职的根本原因。
2. **没有目标树**。`goals.parent_goal_id` 允许父子，但缺 `phases` 中间层。一个"建 OAuth 登录"目标必须拆为 phase=auth_design / phase=auth_impl / phase=auth_test 才便于协调。
3. **没有文件锁**。Legion 的 `task-scheduler` 只看 handoffs 状态，不看 Agent 是否已声明"我会改哪些文件"。两个 Agent 同时改同一文件直到 PR 才会被发现 → 用户协作坑 #2 的根因。

### P1 — 验收闭环不严

4. **任务状态机 5 档 vs 8 档**。当前 `todo/in_progress/done/failed/verification_failed` 不能区分"代码已提交但未实测"与"已实测通过"。导致用户协作坑 #3 的"代码完成 = 任务完成"惯性。
5. **`verification_result` 字段自由文本**。Phase 8 引入 `task_verifications` 表存结构化证据，但 task 自身的 `verification_result` 还是 text，CLI 拿不到强校验证据。
6. **`task_verifications.evidence` 没在 UI 暴露**。QA 看不到哪条 check 通过、哪条失败的细节。

### P2 — 上下文记忆不跨任务

7. **没有"项目上下文"概念**。`task_postmortems` 是 per-task；用户问"项目做到哪了"，主控要把最近 N 条 postmortems 聚合才能答，费时且不准。
8. **`memory.buildFewShotContext` 只看 repo+module**。缺"项目当前 Phase / 主要决策 / 高风险模块"的全局维度。

### P3 — 可视化缺失

9. **目标树页缺**。`ui/src/pages/Goals.tsx` 是 list，没有 tree view。
10. **文件冲突图缺**。
11. **验收证据表缺**。
12. **主控协调日志缺**。

### P4 — 工具链缺口

13. **`pnpm dev` 在 sqlite3 native binding 缺失的机器起不来**。上一轮 Phase 14.5 executor 跑通到 sqlite3 报错。需要换 `better-sqlite3` 或装 MSVC。
14. **没有 Markdown→HTML 渲染**。`doc/` 下大量 Markdown，但 `index.html` 没自动渲染。

---

## 三、新产品目标树

### 3.1 三级目标树

```
LongGoal（长期目标，跨度 1 季度+）
  ├─ Phase（阶段目标，1-2 周）
  │    ├─ MiniGoal（小目标，3-5 天）
  │    │    ├─ Task（可派发任务，0.5-2 天，单 Agent 完成）
  │    │    │    ├─ Attempt（每次重试）
  │    │    │    └─ VerificationEvidence（结构化证据）
  │    │    └─ ...
  │    └─ ...
  └─ Phase ...
```

### 3.2 8 档任务状态机

| 状态 | 含义 | 进入条件 | 离开条件 |
|:---|:---|:---|:---|
| `not_started` | 已分配未开始 | task 创建 | Agent 拉取 |
| `in_progress` | Agent 在做 | Agent 拉取 + 声明 files | `code_landed_needs_runtime` |
| `blocked` | 阻塞 | 阻塞检测器触发 | 阻塞解除 |
| `code_landed_needs_runtime` | 代码已合入 PR，等运行时验证 | PR merged | 跑通 `verification_spec` |
| `partial_runtime_passed` | 部分 check 通过 | verification_spec 部分过 | 全过 / 失败重试 |
| `actual_passed` | 实测全过 | verification_spec 全过 + evidence_paths 非空 | 人工 close |
| `failed` | 失败 | verify 失败耗尽 attempts | 重试 / escalate |
| `closed` | 关闭并归档 | Board approve | 终态 |

### 3.3 阻塞分级

| 级别 | 含义 | 主控动作 |
|:---|:---|:---|
| `hard` | 强阻塞，所有相关任务都停 | 解锁前不动 |
| `soft` | 弱阻塞，相关任务可继续 | 仅记录 + 警告 |
| `notice` | 仅通知 | 不影响派发 |

---

## 四、技术改造方案

### 4.1 数据模型新增（Phase 16）

#### A. `phases` 表（迁移 0105）
```sql
CREATE TABLE phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  long_goal_id uuid REFERENCES goals(id),  -- the top-level goal
  parent_phase_id uuid REFERENCES phases(id),
  name text NOT NULL,
  sequence integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'not_started',
  planned_start date, planned_end date, actual_start timestamptz, actual_end timestamptz,
  owner_agent_id uuid REFERENCES agents(id),
  description text,
  exit_criteria text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
```

#### B. 任务模板结构化（迁移 0106 — 扩展 tasks 表）
```sql
ALTER TABLE tasks
  ADD COLUMN objective text,                          -- 目标
  ADD COLUMN non_objectives text,                     -- 非目标
  ADD COLUMN inputs jsonb,                            -- 输入（依赖、handoff、上游产物）
  ADD COLUMN outputs jsonb,                           -- 输出（文件、API、文档）
  ADD COLUMN files_in_scope text[],                   -- 允许改的文件
  ADD COLUMN files_out_of_scope text[],               -- 不允许改的文件
  ADD COLUMN acceptance_criteria jsonb,               -- 与 verification_spec 互补，前者人读后者机读
  ADD COLUMN evidence_paths text[],                   -- 验收证据路径（截图、logs、curl 输出文件路径）
  ADD COLUMN evidence_summary text,                   -- 证据摘要
  ADD COLUMN downstream_owner_agent_id uuid REFERENCES agents(id),  -- 下一棒 owner
  ADD COLUMN phase_id uuid REFERENCES phases(id),
  ADD COLUMN status text NOT NULL DEFAULT 'not_started',  -- 替换旧 status，8 档枚举
  ADD COLUMN failure_stage text,                      -- compile_failed / test_failed / runtime_failed / contract_drift
  ADD COLUMN retry_strategy jsonb;                    -- {backoffSec, maxAttempts, fallbackTaskId}
```

枚举：`'not_started' | 'in_progress' | 'blocked' | 'code_landed_needs_runtime' | 'partial_runtime_passed' | 'actual_passed' | 'failed' | 'closed'`

#### C. `file_locks` 表（迁移 0107）
```sql
CREATE TABLE file_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES agents(id),
  file_path text NOT NULL,
  lock_type text NOT NULL DEFAULT 'exclusive',  -- 'exclusive' | 'shared'
  acquired_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  release_reason text,
  UNIQUE(file_path) WHERE released_at IS NULL
);
CREATE INDEX file_locks_active ON file_locks(file_path) WHERE released_at IS NULL;
```

#### D. `interface_contracts` 表（迁移 0108）
```sql
CREATE TABLE interface_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,                    -- e.g. 'POST /api/auth/login'
  version text NOT NULL DEFAULT '1.0.0',
  contract_kind text NOT NULL,           -- 'http-route' | 'rpc' | 'cli' | 'data-schema'
  schema_json jsonb NOT NULL,            -- OpenAPI / zod / etc.
  owner_agent_id uuid REFERENCES agents(id),
  status text NOT NULL DEFAULT 'draft',  -- 'draft' | 'published' | 'deprecated'
  consumers text[],                      -- 谁在用
  published_at timestamptz,
  deprecated_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  UNIQUE(name, version)
);
```

#### E. `project_context` 表（迁移 0109 — 项目级记忆）
```sql
CREATE TABLE project_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE REFERENCES companies(id),
  current_long_goal_id uuid REFERENCES goals(id),
  current_phase_id uuid REFERENCES phases(id),
  completed_features jsonb,         -- [{name, evidence}]
  partial_features jsonb,
  blocked_items jsonb,              -- [{taskId, owner, since, unblockCriteria}]
  risks jsonb,                      -- [{module, severity, mitigation}]
  key_decisions jsonb,              -- [{date, decision, madeBy, alternatives}]
  stale_doc_paths text[],            -- 过期文档路径
  updated_by_agent_id uuid REFERENCES agents(id),
  updated_at timestamptz DEFAULT now()
);
```

#### F. `environment_leases` 表（迁移 0110）
```sql
CREATE TABLE environment_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES agents(id),
  task_id uuid REFERENCES tasks(id),
  environment text NOT NULL,         -- 'local' | 'docker' | 'k8s'
  port integer,
  pid integer,
  command text,
  log_path text,
  acquired_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  status text NOT NULL DEFAULT 'active'  -- 'active' | 'released' | 'expired' | 'force-killed'
);
```

#### G. `orchestrator_runs` 表（迁移 0111）
```sql
CREATE TABLE orchestrator_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  orchestrator_agent_id uuid REFERENCES agents(id),
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz,
  decisions jsonb,            -- [{type: 'block'|'unblock'|'reassign'|'escalate', subject, reason, ts}]
  dispatches jsonb,           -- [{taskId, agentId, ts}]
  file_lock_actions jsonb,    -- [{action: 'acquire'|'release', file, agent, ts}]
  context_snapshot jsonb,     -- 当时的 project_context 快照
  daily_report text
);
```

### 4.2 服务新增（Phase 17）

| 服务 | 职责 | 入口 |
|:---|:---|:---|
| `orchestrator.ts` | 每轮拉取目标树、检查阻塞、生成派发计划、更新 project_context | `POST /api/orchestrator/tick` |
| `file-lock.ts` | 上锁/解锁/冲突检测 | `POST /api/file-locks/acquire` |
| `interface-contract.ts` | 契约发布/废弃/消费者追踪 | `POST /api/contracts` |
| `environment-lease.ts` | 环境占用登记 | `POST /api/environment-leases` |
| `project-context.ts` | 项目记忆读写 | `GET/PUT /api/companies/:id/project-context` |
| `orchestrator-report.ts` | 主控日报生成 | `GET /api/orchestrator/runs/:id/report` |
| `task-state-machine.ts` | 8 状态转换守卫 | 服务内 helper |

### 4.3 路由新增（Phase 17）

```
POST   /api/orchestrator/tick                  # 触发一轮主控回合
GET    /api/orchestrator/status                # 当前主控状态
GET    /api/orchestrator/runs                  # 历史主控回合
POST   /api/orchestrator/runs/:id/approve      # 批准越权改动

POST   /api/file-locks/acquire
POST   /api/file-locks/release
GET    /api/file-locks?taskId=...&active=true
GET    /api/file-locks/conflicts?files=a,b,c   # 冲突检测

POST   /api/contracts
GET    /api/contracts/:id
POST   /api/contracts/:id/publish
POST   /api/contracts/:id/deprecate

POST   /api/environment-leases
POST   /api/environment-leases/:id/release
GET    /api/environment-leases?port=...

GET    /api/companies/:id/project-context
PUT    /api/companies/:id/project-context

GET    /api/phases?goalId=...
POST   /api/phases
PATCH  /api/phases/:id
```

### 4.4 UI 新增（Phase 18）

| 页面 | 路径 | 内容 |
|:---|:---|:---|
| 主控控制台 | `/orchestrator` | 目标树 + 阶段进度 + 阻塞 + 文件锁 + 环境占用 |
| 文件锁视图 | `/file-locks` | 当前活跃锁 + 冲突告警 + 谁在改什么 |
| 验收证据表 | `/evidence` | 按任务列 verify 结果 + 证据路径 |
| 阻塞链路图 | `/blockers` | 强/弱/通知三级 + 解除条件 + owner |
| 项目上下文 | `/project-context` | 长期目标 / 已完成 / 阻塞 / 风险 / 决策 |
| 契约注册表 | `/contracts` | 接口契约 + 消费者 + 状态 |
| Markdown→HTML 渲染 | （嵌入文档页） | 同步显示原始 MD 和预览 HTML |

### 4.5 模板与提示词

#### A. 子 Agent 任务模板（注入到每次心跳）

```markdown
# Task: {title}

## Objective
{objective — 目标一句话}

## Non-objectives
- {non_objective_1}
- {non_objective_2}

## Inputs
- {upstream artifact / handoff id}
- {dependency task ids}

## Files you may modify
{files_in_scope[] — 每个路径}

## Files you must NOT modify
{files_out_of_scope[] — 改这些要进主控审批}

## Outputs
- {files[] / API endpoints[] / docs[]}

## Acceptance (machine-verifiable)
{verification_spec — Phase 8 JSONB 格式}

## Acceptance (human-readable)
{acceptance_criteria}

## Evidence you must produce
{evidence_paths[] — 截图、logs、curl 输出文件}

## Next owner
{downstream_owner_agent_id}

## State machine
not_started → in_progress → code_landed_needs_runtime → actual_passed (or failed/closed)
```

#### B. 主控 Agent 系统提示词（替换 `legion-self-solving` 为主控专属 skill）

```text
你是 Paperclip 多 Agent 协作系统的主控 Agent。你的职责不是亲自完成所有
任务，而是保证整个项目目标被正确拆解、正确派发、正确协作、正确验收。

# 你的 8 项必输出

每轮 tick 必须输出以下 JSON：

{
  "currentLongGoal": "长期目标一句话",
  "currentPhase": "phase id + name + status",
  "completedTasks": [{"id","title","actual_passed_at","evidence_summary"}],
  "partialTasks": [{"id","title","status","blocked_by"}],
  "blockedTasks": [{"id","title","owner","since","unblockCriteria"}],
  "readyToDispatch": [{"id","title","files_in_scope","agentMatch"}],
  "fileConflicts": [{"file","claimedBy":[taskIds]}],
  "contextUpdates": [{"section","change"}],
  "nextDispatch": [{"taskId","agentId","reason"}]
}

# 你的规则

1. 不写业务代码。只编排、裁决、同步、验收。
2. 8 状态机严格：actual_passed 之前不得 close。
3. 没有 verification_spec 不得派发。
4. 文件被两个任务声明 → 立即 conflict 警告，禁止并行派发。
5. blocked 状态必须有 owner，否则标 orphan_blocker 警告。
6. 失败任务必须落 postmortem 才能重试。
7. 环境登记：让 Agent 派发前先申请 port/PID lease。
8. 越权（公共契约、全局配置、新依赖、删除历史）→ 升级到 board approval。

# 失败模式自检

每轮 tick 末尾输出：
- "如果只输出这一行能告诉使用者项目状态吗？"
- "如果我今天不上班，Agent 会知道下一步做什么吗？"
```

---

## 五、分阶段实施计划

### Phase 15（本会话）— 审计 + 设计（已完成）
输出本文档。

### Phase 14.5 收尾（已完成，executor 修复）
- 16 个 typecheck 错误 → 0（self-solving.ts / goal-decomposer.ts / verification-runner.ts）
- 5 个 vitest 失败 → 0（phase9 / phase11）
- **85/85 测试通过**（verification-runner、phase9、phase10、phase11 四个文件全绿）
- 唯一遗留阻塞：sqlite3 native binding（Windows 环境，需 MSVC 或换 `better-sqlite3`）

### Phase 16（已完成）— 数据模型
- 7 个迁移（0112 phases / 0113 tasks 8-state + 结构化模板 / 0114 file_locks / 0115 interface_contracts / 0116 project_context / 0117 runtime_leases / 0118 orchestrator_runs）
- 7 个 schema 文件（phases / tasks 扩展 / file_locks / interface_contracts / project_context / runtime_leases / orchestrator_runs）
- goals.parent_phase_id 字段
- @paperclipai/db 显式 type 导出（TaskStatus、TaskFailureStage、PhaseStatus、FileLockType、InterfaceContractKind、InterfaceContractStatus、EnvironmentLeaseStatus、EnvironmentKind、RuntimeLeaseStatus、RuntimeEnvironmentKind、OrchestratorTriggerKind、OrchestratorRunStatus、OrchestratorDecision、OrchestratorDispatch、OrchestratorFileLockAction、ProjectContextFeatureEntry 等）

### Phase 17（已完成）— 服务 + 路由
- `services/orchestrator-state-machine.ts` — 8 状态转换守卫（canTransitionTask / assertTaskTransition / detectFileLockConflicts / isTaskDispatchable）
- `services/file-lock.ts` — 冲突检测 + acquireMany + releaseMany + sweepExpired
- `services/orchestrator.ts` — 主 tick：扫过期锁 + 读 project_context + 分类任务 + 文件锁 acquire + 决策记录 + 写 orchestrator_runs
- `routes/orchestrator.ts` — `/api/orchestrator/tick`、`/api/orchestrator/runs`、`/api/file-locks/{acquire,release,list}`、`/api/contracts`、`/api/companies/:id/project-context`、`/api/runtime-leases`
- 单测：`__tests__/orchestrator-state-machine.test.ts` 覆盖 8 状态转换、文件锁冲突、isTaskDispatchable 四类场景

### Phase 18（已完成）— UI
- `/orchestrator` 主控控制台（9 节 JSON 视图 + tick 触发 + 历史 runs 列表）
- `/file-locks` 文件锁视图（按 file_path 分组、冲突高亮、release 按钮）
- `/project-context` 项目记忆只读视图（long-goal、phase、completed/blocked、risks、decisions、verified_facts）
- 路由全部注册到 `ui/src/App.tsx` boardRoutes
- UI API client：`ui/src/api/orchestrator.ts` 暴露 orchestratorApi / listRuns / listFileLocks / acquire / release / getProjectContext / putProjectContext

### Phase 19（已完成）— 提示词与 skill
- `bundled/paperclip-operations/orchestrator-control-plane/SKILL.md` — 主控专属 skill（9 节 tick 输出格式 + 8 状态机规则 + 文件锁规则 + project_context 规则 + 升级规则 + 自检问题）
- `services/task-template.ts` — 子 Agent 任务模板注入器（renderTaskTemplate + validateTaskTemplate）

### Phase 20（待启动）— 端到端验收
- orchestrator-tick smoke
- 8 状态机 smoke
- 文件锁冲突 smoke

### 最终验证状态（本会话内）

executor 在 Phase 16-19 验证后报告：
- db check:migrations: **PASS**（exit 0）
- db build: **PASS**
- server typecheck: **PASS**（exit 0）
- vitest: **118/118 通过**（6 个测试文件：orchestrator-state-machine 21、task-template 12、verification-runner 17、phase9 31、phase10 16、phase11 21）
- skills-catalog validate: **PASS**（manifest 已重新生成，13 个 skills）
- 唯一遗留阻塞：sqlite3 native binding（Windows 环境，需 MSVC 或换 better-sqlite3）
- 5 个迁移（0105 phases / 0106 tasks 扩展 / 0107 file_locks / 0108 contracts / 0109 project_context / 0110 env_leases / 0111 orchestrator_runs）
- schema 类型与 index 注册

### Phase 17（4-5 天）— 服务 + 路由
- 6 个 service + 18 个新路由
- task-state-machine.ts 状态守卫
- 把 Phase 8 verification-runner 接到新 status 字段

### Phase 18（3-4 天）— UI
- 7 个新页面
- Markdown→HTML 渲染管道（用现有 ui 组件）
- 文件锁冲突图（react-flow 或自绘 SVG）

### Phase 19（2 天）— 提示词与 skill
- 主控专属 skill：`orchestrator-control-plane`（catalog/bundled/paperclip-operations/）
- 子 Agent 任务模板：注入到 `task.description` 字段
- 替换/废弃 `legion-self-solving` 的部分职责

### Phase 20（3 天）— 端到端验收
- 主控 smoke 脚本：orchestrator-tick 触发 → 输出 8 项 JSON
- 文件锁冲突 smoke
- 8 状态机 smoke

---

## 六、第一阶段可落地任务清单（Phase 16 数据模型）

按 0.5–2 天独立交付切分：

| # | 任务 | owner | 验收 | 估计 |
|:---|:---|:---|:---|:---|
| 16.1 | 迁移 0105_phases.sql + schema/phases.ts + index 注册 | backend | `pnpm --filter @paperclipai/db check:migrations` 通过；`pnpm --filter @paperclipai/db build` 通过 | 0.5 天 |
| 16.2 | 迁移 0106_tasks_extend.sql + 8 状态枚举 + status 迁移脚本 | backend | 老任务全部迁移到新 status 字段；`pnpm typecheck` 通过 | 1 天 |
| 16.3 | 迁移 0107_file_locks.sql + schema/file_locks.ts + partial unique index | backend | `pnpm check:migrations` 通过；并发 acquire 同一文件 → 第二个返回 409 | 0.5 天 |
| 16.4 | 迁移 0108_interface_contracts.sql + schema/interface_contracts.ts | backend | 同上 | 0.5 天 |
| 16.5 | 迁移 0109_project_context.sql + schema/project_context.ts | backend | 同上 | 0.5 天 |
| 16.6 | 迁移 0110_environment_leases.sql + schema/environment_leases.ts | backend | 同上 | 0.5 天 |
| 16.7 | 迁移 0111_orchestrator_runs.sql + schema/orchestrator_runs.ts | backend | 同上 | 0.5 天 |
| 16.8 | 把 task_status 枚举导出为 @paperclipai/db 类型 | backend | services 端可 `import type { TaskStatus } from "@paperclipai/db"` | 0.25 天 |
| 16.9 | 单测：8 状态机转换合法性 + 非法转换抛错 | backend | vitest 全绿 | 0.5 天 |
| 16.10 | schema 文档更新：CLAUDE.md 数据模型章节补 phases/file_locks/contracts/project_context/env_leases/orchestrator_runs | backend | grep 命中 | 0.25 天 |

合计约 5.5 天，2 人可并行（migration 写 / schema 类型可错开）。

---

## 七、与既有计划的关系

- **2026-06-09 Legion 自主交付系统**：本计划承接其 Phase 0–7 的 Legion 基础（tasks/handoffs/git_config/pr_check_runs），并在 Phase 8–14 的"自我解决"基础上叠加**目标树 / 文件锁 / 主控 / 上下文记忆**四件缺失项。
- **2026-06-08 实时交付系统**：诊断 + 模型健康 + 草稿已就位；本计划不重复，只在主控控制台里嵌入调用入口。
- **2026-06-05 调度二阶段 / 团队模式**：单人单高优、恢复链降噪已落地；本计划补"主控判定哪些任务可以并行"的更高一层调度。
- **2026-06-30 自我解决推进 Agent 团队**：Phase 8–14 已经把硬验证 + DAG + CI + 记忆 + 自修改 eval gate 串起来；本计划把这套机制**架到主控编排下**，把"agent 自己执行"升级为"主控指挥下的多 agent 执行"。

不重复定义前序 Phase 已落地的 schema / 服务 / 路由；只描述增量、心智模型、与既有模块的对接点。