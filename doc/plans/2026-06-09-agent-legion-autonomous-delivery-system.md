# 纸夹 Agent 军团自主交付系统设计方案

> 版本：v1.0
> 日期：2026-06-09
> 目标：给定产品目标，Agent 军团自主拆解、分配、执行、验证、交付

---

## 一、系统愿景

用户输入一个产品目标（如「实现用户注册登录功能」「上线数字人直播模块」），系统自动：

1. **分解** — LLM 将目标拆解为有依赖关系的任务 DAG
2. **分配** — 根据 Agent 技能标签将任务分配给合适的 Agent
3. **执行** — 并行/串行执行，实时推送进度到 QQ
4. **验证** — 每个任务完成后跑验收检查，失败则打回重做
5. **交付** — 所有任务完成后生成交付报告

---

## 二、现有能力盘点

| 模块 | 路径 | 说明 |
|:-----|:-----|:-----|
| 设备/Agent 注册 | `server/src/adapters/` | Adapter 插件体系，支持 codex/claude 等 |
| 任务下发 | `server/src/routes/issues.ts` | pending-tasks 队列，状态：`todo`/`in_progress`/`done`/`blocked`/`cancelled` |
| 任务结果回传 | `POST /api/devices/:id/tasks/:uuid/result` | Webhook 回调 |
| 技能标签 | `server/src/services/company-skills.ts` | CompanySkill 体系 |
| 交付通道 | Hermes QQBot | deliver=origin → QQ 群 |
| 定时调度 | `server/src/services/cron.ts` | 定时触发任务巡检 |
| 实时事件 | `server/src/services/live-events.ts` | WebSocket 心跳 |
| Secrets 管理 | `server/src/services/secrets.ts` | 敏感信息隔离 |

---

## 三、系统架构

```
用户输入目标
      │
      ▼
┌─────────────────────────────────────────────────┐
│           Goal Decomposer（目标拆解引擎）          │
│  输入：目标描述 + 项目上下文                      │
│  输出：Task DAG（有向无环图）                     │
└─────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────┐
│           Task Scheduler（任务调度器）            │
│  依赖拓扑排序 → Agent 技能匹配 → 分配执行         │
└─────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────┐
│           Agent Legion（Agent 军团）              │
│  每个 Agent = Adapter（技能标签 + 运行时）         │
│  并行执行无依赖任务，串行执行有依赖任务             │
└─────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────┐
│           Verification Layer（验证层）            │
│  编译检查 + 接口测试 + E2E 截图                   │
│  失败 → 打回新 Task，成功 → 标记 done              │
└─────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────┐
│           Delivery Reporter（交付报告）            │
│  生成变更集 + 验证结果 + 推送到 QQ                 │
└─────────────────────────────────────────────────┘
```

---

## 四、核心数据模型

### 4.1 Task（任务）

```typescript
interface Task {
  id: string;                    // "task_xxxxx"
  goalId: string;                // 归属 Goal
  title: string;                 // 任务标题
  description: string;            // 详细描述（包含验收标准）
  status: TaskStatus;            // todo | in_progress | done | blocked | failed | verification_failed
  priority: number;              // 优先级 1-5
  dependencies: string[];         // 依赖的 Task ID 列表（前置任务必须完成）
  assigneeAgentId: string | null; // 分配给的 Agent ID
  verificationCriteria: string[]; // 验收标准列表
  attempts: number;              // 已尝试次数
  maxAttempts: number;           // 最大尝试次数（默认 3）
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  verificationResult: VerificationResult | null;
}

type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "failed" | "verification_failed";
```

### 4.2 VerificationResult（验证结果）

```typescript
interface VerificationResult {
  passed: boolean;
  checks: VerificationCheck[];
  summary: string;               // AI 生成的验收总结
  logUrl: string | null;         // 验证过程日志链接
  timestamp: Date;
}

interface VerificationCheck {
  name: string;                  // "编译通过"
  passed: boolean;
  details: string;               // 错误详情或成功信息
}
```

### 4.3 Goal（目标）

```typescript
interface Goal {
  id: string;                    // "goal_xxxxx"
  title: string;                 // 目标标题
  description: string;            // 原始需求描述
  status: GoalStatus;            // planning | executing | verifying | completed | failed
  taskGraph: TaskGraph;          // 任务 DAG 结构
  totalTasks: number;
  completedTasks: number;
  createdAt: Date;
  completedAt: Date | null;
  ownerAgentId: string | null;   // 主导 Agent
}

type GoalStatus = "planning" | "executing" | "verifying" | "completed" | "failed";
```

### 4.4 TaskGraph（任务依赖图）

```typescript
interface TaskGraph {
  nodes: TaskNode[];             // 所有任务节点
  edges: TaskEdge[];             // 依赖边
}

interface TaskNode {
  taskId: string;
  estimatedDuration: number;      // 预估时长（分钟）
  requiredSkills: string[];       // 所需技能标签
}

interface TaskEdge {
  from: string;                  // 依赖方 Task ID
  to: string;                    // 被依赖方 Task ID（to 依赖 from）
}
```

### 4.5 AgentSkill（Agent 技能标签）

```typescript
interface AgentSkill {
  agentId: string;
  skills: string[];              // 技能标签列表，如 ["typescript", "vue3", "mysql"]
  currentLoad: number;            // 当前任务数
  maxLoad: number;               // 最大并发任务数
  status: "available" | "busy" | "offline";
}
```

---

## 五、功能模块详细设计

### Phase 1：Goal Decomposer（目标拆解引擎）

**职责**：接收自然语言目标，输出可执行的 Task DAG

**实现位置**：`server/src/services/goal-decomposer.ts`（新建）

**Prompt 设计**：

```
你是一个高级架构师。请将以下产品目标拆解为可执行的任务列表。

要求：
1. 每个任务必须可独立完成、有明确验收标准
2. 任务之间标注依赖关系（A 完成后 B 才能开始）
3. 每个任务分配到以下技能标签之一：["frontend", "backend", "database", "devops", "testing", "review"]
4. 考虑任务并行可能性：无依赖的任务可以并行执行

目标：{用户输入}

请按以下 JSON 格式输出：
{
  "title": "目标标题",
  "tasks": [
    {
      "title": "任务标题",
      "description": "详细描述和验收标准",
      "requiredSkills": ["frontend"],
      "dependencies": [],  // 依赖的任务标题列表
      "estimatedDuration": 60  // 预估分钟数
    }
  ]
}
```

**API 接口**：

```
POST /api/goals/decompose
Body: { "description": "目标描述", "companyId": "xxx" }
Response: { goalId: string, taskCount: number, tasks: Task[] }
```

**执行流程**：
1. 接收用户目标描述
2. 调用 LLM（Claude）生成 Task DAG
3. 将 Task 写入数据库（status=todo）
4. 更新 Goal 状态为 `executing`
5. 触发 Task Scheduler

---

### Phase 2：Task Scheduler（任务调度器）

**职责**：按依赖顺序将任务分配给合适的 Agent

**实现位置**：`server/src/services/task-scheduler.ts`（新建）

**核心算法**：

```
function schedule(tasks: Task[], agents: Agent[]): Assignment[] {
  // 1. 拓扑排序 — 按依赖顺序排列任务
  sorted = topologicalSort(tasks)

  // 2. 找出当前可执行任务（所有依赖都已完成）
  runnable = sorted.filter(t => t.dependencies.every(d => isDone(d)))

  // 3. 分配给合适的 Agent
  for task in runnable:
    agent = selectBestAgent(agents, task.requiredSkills)
    if agent:
      assign(task, agent)
    else:
      // 无可用 Agent，标记 blocked，等待资源释放

  return assignments
}

function selectBestAgent(agents: Agent[], requiredSkills: string[]): Agent | null {
  // 优先：技能匹配度高 + 当前负载低 + 状态 available
  candidates = agents
    .filter(a => a.status === "available")
    .filter(a => a.currentLoad < a.maxLoad)
    .map(a => ({ agent: a, score: skillMatchScore(a, requiredSkills) }))
    .sort((a, b) => b.score - a.score)

  return candidates[0]?.agent ?? null
}
```

**事件驱动调度**：
- 当 Agent heartbeat 到达 → 检查是否有新可执行任务 → 分配
- 当 Task 完成 → 触发调度器重新计算 → 分配下游任务
- 当 Agent 下线 → 将任务重新放回队列

**失败处理**：
- 任务失败 → `attempts++` → 若 `< maxAttempts` 重新放回队列，若 `>= maxAttempts` 标记 `failed` 并告警 QQ

---

### Phase 3：Verification Layer（验证层）

**职责**：任务完成后验证交付物是否满足验收标准

**实现位置**：`server/src/services/verification-engine.ts`（新建）

**验证类型**：

| 验证类型 | 触发条件 | 验证方式 |
|:---------|:---------|:---------|
| 编译验证 | 所有代码类 Task | `tsc --noEmit` / `mvn compile` |
| 单元测试 | 有 `*.test.ts` 或 `*Test.java` | 运行对应测试命令 |
| 接口验证 | 后端 API Task | 发送 HTTP 请求验证响应 |
| 语法检查 | 所有代码文件 | `eslint --max-warnings=0` |
| 文件存在检查 | 所有 Task | 验证产物文件路径存在 |

**验证流程**：
```
1. Task 标记 done
2. Verification Engine 读取 task.verificationCriteria
3. 并行执行所有验证检查
4. 汇总结果：
   - 全部通过 → VerificationResult.passed=true，Goal.completedTasks++
   - 任一失败 → VerificationResult.passed=false，Task 标记 verification_failed，触发打回
```

**打回机制**：
- 验证失败 → 创建新的子 Task（修复任务），依赖原 Task
- 原 Task 标记 `blocked`
- 分配给原 Agent 或新 Agent 执行修复

---

### Phase 4：Shared State & Handoff（跨 Agent 状态共享）

**职责**：解决多 Agent 并行开发时的上下文交接问题

**实现位置**：`server/src/services/handoff-store.ts`（新建）

**交接文档结构**：

```typescript
interface HandoffDoc {
  taskId: string;
  producedBy: string;           // 产出者 Agent ID
  consumedBy: string | null;    // 消费者 Agent ID（null 表示未被消费）
  artifact: {
    type: "api_contract" | "data_model" | "config" | "component";
    path: string;                // 文件路径
    summary: string;            // 摘要说明
    contract?: string;           // 接口契约（供下游使用）
  };
  consumedAt: Date | null;
  status: "ready" | "consumed" | "stale";
}
```

**API 接口**：

```
GET /api/tasks/:id/handoffs        # 获取该任务产出的所有交接文档
GET /api/agents/:id/consumable     # 获取该 Agent 可消费的所有交接文档
POST /api/tasks/:id/handoffs       # 任务完成后写入交接文档
```

**Scheduler 读取逻辑**：
- 分配任务前，自动获取该任务所有 `dependencies` 的 HandoffDoc
- 将 HandoffDoc 的 contract 注入到任务上下文中
- 传递给 Agent 执行

---

### Phase 5：Git 集成

**职责**：每个 Task 分支开发，合入前强制 CI 验证

**实现位置**：`server/src/services/git-integration.ts`（新建）

**分支策略**：
- `legion/goal-{goalId}/task-{taskId}` — 每个任务一个分支
- `legion/goal-{goalId}/merge` — 合并目标分支
- 合并前必须通过 CI 验证

**PR 自动创建流程**：
1. Task 完成验证后
2. 自动创建 PR：`legion/goal-{goalId}/task-{taskId}` → `legion/goal-{goalId}/merge`
3. PR 描述包含：任务摘要、验证结果、产物路径
4. CI 通过后自动合并（或人工审批）

**冲突处理**：
- 合并冲突 → 任务标记 `blocked`，通知负责人手动解决
- 解决后重新触发验证

---

## 六、数据库 Schema 变更

在现有 `issues` 表基础上扩展，新增表：

### tasks（新建）
```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY DEFAULT ('task_' || lower(hex(randomblob(8)))),
  goal_id TEXT NOT NULL REFERENCES goals(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  priority INTEGER DEFAULT 3,
  dependencies TEXT,                    -- JSON 数组 ["task_xxx"]
  assignee_agent_id TEXT,
  verification_criteria TEXT,           -- JSON 数组
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  verification_result TEXT,             -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  FOREIGN KEY (goal_id) REFERENCES goals(id),
  FOREIGN KEY (assignee_agent_id) REFERENCES agents(id)
);
```

### handoffs（新建）
```sql
CREATE TABLE handoffs (
  id TEXT PRIMARY KEY DEFAULT ('handoff_' || lower(hex(randomblob(8)))),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  artifact_type TEXT NOT NULL,
  artifact_path TEXT NOT NULL,
  summary TEXT,
  contract TEXT,                        -- JSON 接口契约
  status TEXT DEFAULT 'ready',
  consumed_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  consumed_at DATETIME,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

### goals（扩展）
```sql
ALTER TABLE goals ADD COLUMN status TEXT DEFAULT 'planning';
ALTER TABLE goals ADD COLUMN total_tasks INTEGER DEFAULT 0;
ALTER TABLE goals ADD COLUMN completed_tasks INTEGER DEFAULT 0;
```

---

## 七、API 路由设计

| 方法 | 路径 | 说明 |
|:-----|:-----|:-----|
| POST | `/api/goals/decompose` | 目标拆解（用户输入 → Task DAG） |
| GET | `/api/goals/:id` | 查询 Goal 详情和进度 |
| GET | `/api/goals/:id/tasks` | 查询 Goal 下所有 Task |
| GET | `/api/tasks/:id` | 查询 Task 详情 |
| GET | `/api/tasks/:id/handoffs` | 查询 Task 产出的交接文档 |
| POST | `/api/tasks/:id/verify` | 手动触发验证 |
| GET | `/api/agents/:id/consumable` | 查询 Agent 可消费的最新交接文档 |
| GET | `/api/goals/:id/report` | 生成 Goal 交付报告 |
| POST | `/api/goals/:id/abort` | 中止 Goal 执行 |

---

## 八、实时事件（WebSocket）

| 事件名 | 触发时机 | payload |
|:-------|:---------|:---------|
| `goal:started` | Goal 开始执行 | `{ goalId, taskCount }` |
| `task:assigned` | 任务分配给 Agent | `{ taskId, agentId }` |
| `task:completed` | 任务完成 | `{ taskId, duration }` |
| `task:verification_failed` | 验证失败 | `{ taskId, checks }` |
| `task:failed` | 任务失败 | `{ taskId, attempts }` |
| `goal:progress` | 进度更新 | `{ goalId, completed, total }` |
| `goal:completed` | Goal 完成 | `{ goalId, reportUrl }` |
| `goal:failed` | Goal 失败 | `{ goalId, reason }` |

---

## 九、QQ 推送模板

```
🎯 [DYQ-军团] 目标开始执行
━━━━━━━━━━━━━━━
目标：{goalTitle}
任务数：{totalTasks} 个
执行者：Agent 军团
🔗 {dashboardUrl}

━━━━━━━━━━━━━━━━

✅ [DYQ-军团] 任务完成
━━━━━━━━━━━━━━━
任务：{taskTitle}
执行者：{agentName}
耗时：{duration} 分钟
🔗 {taskDetailUrl}

━━━━━━━━━━━━━━━━

🎉 [DYQ-军团] 目标完成
━━━━━━━━━━━━━━━
目标：{goalTitle}
完成任务：{completedTasks}/{totalTasks}
总耗时：{totalDuration}
✅ 全部验证通过
🔗 {reportUrl}
```

---

## 十、部署架构

```
┌──────────────────────────────────────────────────────┐
│                  Paperclip Server                    │
│  Port 5173（对外） / 3101（内部）                     │
│                                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │Goal         │  │Task         │  │Verification│  │
│  │Decomposer   │  │Scheduler    │  │Engine       │  │
│  │(LLM 调用)    │  │(事件驱动)    │  │(编译/测试)   │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
│                                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │Handoff      │  │Git          │  │Cron         │  │
│  │Store        │  │Integration  │  │Trigger      │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
└──────────────────────────────────────────────────────┘
        │                                    │
        ▼                                    ▼
┌─────────────────┐              ┌─────────────────────┐
│  Sub2API MCP    │              │  Hermes QQBot       │
│  (Claude Code   │              │  (状态推送)          │
│   Agent 派发)    │              │                     │
└─────────────────┘              └─────────────────────┘
```

---

## 十一、迭代阶段

| 阶段 | 内容 | 依赖 | 预计工时 |
|:-----|:-----|:-----|:---------|
| **Phase 0** | 数据库扩展：tasks/handoffs 表 + goals 字段 | 无 | 1 天 |
| **Phase 1** | Goal Decomposer：LLM 拆解 + 路由 + 触发调度 | Phase 0 | 2 天 |
| **Phase 2** | Task Scheduler：拓扑排序 + Agent 匹配 + 事件驱动 | Phase 1 | 3 天 |
| **Phase 3** | Verification Layer：编译/测试验证 + 打回机制 | Phase 2 | 2 天 |
| **Phase 4** | Handoff Store：交接文档读写 + 上下文注入 | Phase 2 | 1 天 |
| **Phase 5** | Git 集成：分支策略 + PR 自动创建 + CI 合并 | Phase 3 | 2 天 |
| **Phase 6** | QQ 推送模板 + WebSocket 事件 + Dashboard 展示 | Phase 1-5 | 1 天 |
| **Phase 7** | 端到端测试 + 熔断机制 + 预算控制 | Phase 1-6 | 1 天 |

**总工期**：约 13 个工作日（可并行推进部分模块）

---

## 十二、风险与对策

| 风险 | 影响 | 对策 |
|:-----|:-----|:-----|
| LLM 拆解质量差 | 任务遗漏/依赖错误 | 人工 review 第一版拆解结果，可手动调整 DAG |
| Agent 并行写同一文件冲突 | 产物损坏 | Phase 5 Git 分支隔离 + 合并前 CI |
| 验证层假阳性 | 误判成功 | 允许多种验证方式组合，任一失败都算失败 |
| Agent 资源耗尽 | 任务堆积 | 调度器感知 Agent 实际负载（heartbeat） |
| 交接文档不完整 | 下游任务失败 | 交接文档作为 Task 完成的前置条件，未写入则标记失败 |

---

## 十三、待验证问题清单

- [ ] 现有 `goals` 表 Schema 是否支持直接扩展？需确认迁移脚本
- [ ] Sub2API MCP 派发的 Claude Code 是否支持技能标签路由？
- [ ] 现有 Adapter 体系是否能区分 Agent 类型（frontend/backend/review）？
- [ ] `issues` 表和新建 `tasks` 表的关系：是复用还是独立？
- [ ] Verification 执行在哪个环境？沙箱还是真实容器？
