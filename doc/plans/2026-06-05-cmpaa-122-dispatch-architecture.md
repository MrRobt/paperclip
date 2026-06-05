# CMPAA-122 调度二阶段架构方案：状态机、恢复链降噪与六件套门禁

状态：架构方案，可进入分批实现
日期：2026-06-05
责任：自家架构老周
关联任务：CMPAA-122

## 1. 结论

本方案不重构现有控制平面，只在现有 issue、run、recovery action、execution policy、comment 和 activity 之上增加二阶段调度派生层：

1. 将“成员在线/忙闲状态”和“任务真实进程”解耦，避免把 agent 状态、心跳噪声、恢复链噪声误判为真实交付。
2. 增加一人一高优调度约束：同一成员同一时间最多持有一个未完成 high/critical 的可执行任务。
3. 将完成评论的六件套解析成结构化证据分数，低分不进入完成闭环，只进入补证或复审。
4. 将恢复链按 sourceIssueId + recoveryKind + fingerprint 聚合，默认 source-scoped，避免同源重复恢复任务刷屏。
5. 用条件唤醒替代无差别心跳：只有满足“无高优冲突、无未解阻塞、有有效动作路径、预算允许、需要复审/执行”的任务才唤醒成员、小蓝或老周。
6. 分批落地：先做只读诊断和派生状态，再做轻量写入门禁，最后做自动调度与前端健康页。

## 2. 设计目标

- 控制平面不变量不变：单 assignee、任务状态语义、原有 checkoutRunId/executionRunId、blocker、recovery action 继续有效。
- 最小改动：优先增加派生服务、只读接口、诊断页面，不先硬改核心状态流。
- 可审计：所有自动阻止、自动唤醒、恢复折叠、复审结论均写 activity/comment 或结构化表。
- 可回退：早期能力以实验开关启用，关闭后不影响现有任务执行。
- 可分批：后端、前端、复审工作都能拆成小任务并独立验收。

## 3. 当前基线与问题

### 3.1 已有基线

- issue 已有 `status`、`priority`、`assigneeAgentId`、`checkoutRunId`、`executionRunId`、`executionPolicy`、`executionState`。
- `doc/execution-semantics.md` 已定义非终态任务 liveness contract、checkout 与 execution 分离、source-scoped recovery action。
- 当前任务模型支持 blocker、parent/sub issue、comment、document、work product、activity。
- 产品目标要求控制平面，而不是执行平面；任务、评论、产物必须可检查。

### 3.2 暴露问题

| 问题 | 表现 | 根因 |
|---|---|---|
| 成员状态和任务进程混淆 | 成员显示 running，但任务没有产物或无有效下一步 | agent 心跳/运行日志被当作任务进度 |
| 恢复链噪声 | 同源故障反复创建恢复任务或评论 | 缺少恢复聚合键、冷却窗口和裁决状态 |
| 一人多高优 | 同一成员同时持有多个 high/critical | 分配和唤醒缺少并发门禁 |
| 六件套缺失 | “完成了”但没有分支、提交号、验证命令等 | 完成闭环依赖自由文本，未结构化评分 |
| 复审触发不稳 | 小蓝/老周被过早或重复唤醒 | 缺少可验证证据阈值和条件唤醒 |

## 4. 核心状态分离

### 4.1 成员状态 Agent Work State

成员状态只回答“这个人是否可被派活/唤醒”，不代表任务完成度。

建议派生字段：

| 字段 | 含义 | 来源 |
|---|---|---|
| agentId | 成员 | agents.id |
| availability | available / busy / paused / offline / error | agent.status、最近 heartbeat、运行状态 |
| activeRunCount | 活跃 run 数 | runs/adapter execution |
| highPriorityLoad | 未完成 high/critical 可执行任务数 | issues |
| currentIssueIds | 当前 in_progress/todo 的任务 | issues |
| lastEffectiveProgressAt | 最近有效产物/六件套/状态推进时间 | comments、work products、activity |
| dispatchBlockedReason | 不能派活原因 | 高优冲突、暂停、离线、预算、阻塞 |

### 4.2 任务真实进程 Issue Progress State

任务进程只回答“这个 issue 的下一步是什么，是否有真实产出”。

建议派生字段：

| 字段 | 含义 |
|---|---|
| issueId | 任务 |
| pathState | executable / waiting_blocker / waiting_review / waiting_evidence / recovering / stalled / done |
| livePathKind | active_run / queued_wake / monitor / blocker_chain / recovery_action / human_owner / none |
| evidenceScore | 六件套证据分 |
| noiseScore | 噪声分 |
| reviewGate | not_required / pending / passed / failed |
| nextOwnerAgentId | 下一步应唤醒成员 |
| nextAction | 人类可读下一步 |

### 4.3 不变量

- `agent.status=running` 不等于 issue 有效推进。
- issue `in_progress` 必须有 live path；否则进入 stalled/recovering 派生状态。
- 任务进入 `done` 前必须有 evidenceScore 达标，或由人工明确 override。
- 复审通过只改变 reviewGate/派生健康状态，不隐式改变 issue 原始产物内容。

## 5. 调度状态机

### 5.1 Issue 调度状态

```text
backlog
  -> todo_ready              可执行但未唤醒
  -> todo_parked             有意停放

todo_ready
  -> dispatch_blocked        一人一高优/预算/暂停等阻止派发
  -> wake_queued             已有唤醒路径
  -> in_progress_active      checkout + live execution

in_progress_active
  -> waiting_evidence        评论不足六件套
  -> waiting_review          六件套达标，等小蓝/老周复审
  -> recovering              live path 丢失，有恢复动作
  -> stalled                 无 live path 且无恢复动作
  -> done                    复审通过或明确免审

recovering
  -> in_progress_active      恢复成功
  -> blocked                 需要外部决策/人工介入
  -> cancelled               恢复判定无效或任务取消
```

### 5.2 调度决策顺序

1. 过滤 terminal：done/cancelled 不调度。
2. 过滤 blocker：未解阻塞不唤醒执行，只保留 blocker 链健康检查。
3. 校验成员可用性：paused/offline/error 不派新活。
4. 校验一人一高优：已有未完成 high/critical 时，新 high/critical 保持 backlog/todo 并写原因。
5. 校验证据：完成意图但六件套不足，唤醒原执行者补证，不唤醒复审。
6. 校验复审：六件套达标且需要复审，按规则唤醒小蓝/老周。
7. 校验恢复：同源恢复已有活跃组则不新建，只追加证据或更新组状态。
8. 预算与频率：超过预算或冷却窗口不唤醒。

## 6. 恢复链降噪

### 6.1 聚合键

恢复组以如下键去重：

```text
companyId + sourceIssueId + recoveryKind + idempotencyFingerprint
```

如果 fingerprint 缺失，退化为：

```text
companyId + sourceIssueId + recoveryKind + normalizedCauseHash
```

### 6.2 恢复组状态

| 状态 | 含义 |
|---|---|
| open | 有待处理恢复动作 |
| monitoring | 等待一次性 monitor/重试 |
| folded | 新活动已恢复有效 live path，恢复组折叠保留审计 |
| escalated | 自动恢复不安全，转人工/老周裁决 |
| resolved | 恢复成功 |
| cancelled | 误报或已无意义 |

### 6.3 降噪规则

- 同一恢复组 open/monitoring 时，不创建新的 recovery issue。
- 新恢复证据只追加到组摘要，不刷屏评论。
- 冷却窗口默认二十分钟；窗口内重复同源恢复只增加计数。
- 连续三次恢复失败进入 escalated，只唤醒老周一次。
- 如果 source issue 出现新的有效 live path，恢复组进入 folded/resolved，而不是隐藏删除。

## 7. 六件套证据评分

### 7.1 六件套字段

| 字段 | 目标 | 分值 |
|---|---|---:|
| 改动摘要 | 做了什么，范围是否清楚 | 20 |
| 分支 | 当前分支或工作区 | 10 |
| 提交号 | commit hash；纯方案任务可写“无代码提交，产物文档路径” | 15 |
| 验证命令 | 可复跑命令 | 20 |
| 验证结果 | 命令输出摘要、通过/失败 | 20 |
| 下游复验口径 | 复审者如何检查 | 15 |

阈值建议：

- 80 分及以上：可进入 waiting_review。
- 60-79 分：要求补证，可评论提醒，但不复审。
- 60 分以下：视为评论噪声，不算有效进度。

### 7.2 方案/文档类任务特殊规则

方案任务不要求代码提交，但必须提供：

- 文档路径。
- `git diff --check -- <文档路径>` 结果。
- 对需求点的覆盖清单。
- 下游实现任务拆分。

提交号字段可为：`无代码提交，当前工作树产物：<路径>`；进入最终 done 前建议提交，若团队流程允许工作树产物先验收，则可标记 `commitPending=true`。

## 8. 条件唤醒规则

### 8.1 唤醒执行者

触发条件：

- issue 为 todo_ready 或 in_progress_active。
- 无未解 blocker。
- 成员无 high/critical 冲突。
- 不处于恢复冷却。
- 预算允许。

### 8.2 唤醒小蓝

触发条件：

- evidenceScore >= 80。
- reviewGate=pending。
- 任务类型为实现/验证/前端体验。
- 未有活跃小蓝复审 run。

### 8.3 唤醒老周

触发条件：

- 架构/数据模型/API 契约/恢复链裁决类任务。
- 三次恢复失败或恢复动作可能破坏远端修改、强改状态、重置分支。
- 小蓝复审 failed 且争议点属于架构/控制平面不变量。
- critical 任务超过时限且无有效六件套。

## 9. 数据模型变更建议

### 9.1 第一批：只读派生，不新增表

先在服务层计算：

- `IssueDispatchHealth`
- `AgentDispatchLoad`
- `EvidenceScore`
- `RecoveryGroupSummary`

优点：不改迁移，低风险，可马上用于健康页和调度日志。

### 9.2 第二批：轻量持久化表

建议新增三张表，均可幂等迁移。

#### issue_evidence_reviews

```text
id uuid pk
company_id uuid not null
issue_id uuid not null
comment_id uuid null
reviewer_agent_id uuid null
score int not null
fields jsonb not null
missing_fields jsonb not null default '[]'
status text not null -- insufficient | pending_review | passed | failed | override
created_at timestamptz not null
updated_at timestamptz not null
```

用途：保存六件套解析和复审结论。

#### issue_recovery_groups

```text
id uuid pk
company_id uuid not null
source_issue_id uuid not null
recovery_kind text not null
fingerprint text not null
status text not null -- open | monitoring | folded | escalated | resolved | cancelled
owner_agent_id uuid null
attempt_count int not null default 0
last_evidence_at timestamptz null
cooldown_until timestamptz null
summary jsonb not null default '{}'
created_at timestamptz not null
updated_at timestamptz not null
unique(company_id, source_issue_id, recovery_kind, fingerprint)
```

用途：合并同源恢复噪声，保留审计。

#### dispatch_decisions

```text
id uuid pk
company_id uuid not null
issue_id uuid null
agent_id uuid null
decision text not null -- allow | deny | defer | wake | review | recover | escalate
reason text not null
inputs jsonb not null
actor_agent_id uuid null
run_id uuid null
created_at timestamptz not null
```

用途：记录一人一高优、预算、阻塞、复审触发等调度决策。

### 9.3 不建议变更

- 不新增全局复杂工作流引擎。
- 不改变 issue 的基础 status 枚举作为第一批落点。
- 不把 recovery comment 当成唯一恢复动作。
- 不将 agent.status 作为任务完成依据。

## 10. 接口清单

### 10.1 后端只读接口

| 接口 | 用途 |
|---|---|
| `GET /api/companies/:companyId/dispatch/agents` | 成员负载、可派活原因 |
| `GET /api/companies/:companyId/dispatch/issues` | 任务派生状态、live path、证据分 |
| `GET /api/issues/:id/dispatch-health` | 单任务健康详情 |
| `GET /api/companies/:companyId/recovery-groups` | 恢复组列表与噪声统计 |
| `GET /api/issues/:id/evidence` | 六件套解析结果 |

### 10.2 后端写入接口

| 接口 | 用途 |
|---|---|
| `POST /api/issues/:id/evidence/parse` | 解析指定评论或最新完成评论 |
| `POST /api/issues/:id/review-gate` | 小蓝/老周写复审结果 |
| `POST /api/issues/:id/dispatch-decision` | 记录调度 allow/deny/defer |
| `POST /api/recovery-groups/:id/resolve` | 折叠/升级/关闭恢复组 |
| `POST /api/companies/:companyId/dispatch/wake-preview` | 预览将唤醒谁，不执行 |
| `POST /api/companies/:companyId/dispatch/wake-run` | 按预览结果执行条件唤醒 |

### 10.3 前端页面

| 页面/组件 | 内容 |
|---|---|
| 团队健康页 | 成员负载、一人一高优冲突、暂停成员、预算 |
| 任务健康卡 | live path、证据分、下一步、复审状态 |
| 恢复组抽屉 | 同源恢复合并、尝试次数、冷却、裁决按钮 |
| 六件套提示 | 缺失字段、补证模板、复审入口 |
| 调度预览 | 将唤醒成员/小蓝/老周及原因 |

## 11. 分批实现任务拆分

### 后端第一批：只读诊断

1. 增加 `server/src/services/dispatch-health.ts`，计算 `IssueDispatchHealth` 和 `AgentDispatchLoad`。
2. 增加六件套解析纯函数和单元测试。
3. 增加恢复组聚合纯函数，基于现有 recovery actions 只读聚合。
4. 暴露 `GET /dispatch/*` 和 `GET /issues/:id/dispatch-health`。
5. 验证：针对 blocker、in_progress stale、六件套完整/缺失、一人一高优写单元测试。

### 后端第二批：门禁与持久化

1. 新增 `issue_evidence_reviews`、`issue_recovery_groups`、`dispatch_decisions` 迁移。
2. 完成评论写入后触发证据解析，低分自动生成补证提示。
3. high/critical 分配或唤醒前检查一人一高优；阻止时记录 `dispatch_decisions`。
4. 恢复动作创建前查恢复组，命中则折叠更新，不重复创建 recovery issue。
5. 验证：迁移测试、路由测试、并发重复恢复幂等测试。

### 前端第一批：健康页原型

1. 团队健康页显示成员高优负载和冲突。
2. issue 详情展示证据分、缺失字段、下一步。
3. 恢复组列表折叠同源恢复噪声。
4. 调度预览只读，不直接唤醒。
5. 验证：真实浏览器检查 dashboard、issue 详情、空数据和异常数据。

### 自动调度第三批：条件唤醒

1. 增加 wake-preview 与 wake-run。
2. 将小蓝/老周唤醒改为 evidenceScore + reviewGate + issue type 驱动。
3. 增加冷却和最大尝试次数。
4. 所有自动行为写 activity，并可由实验开关关闭。
5. 验证：模拟批量任务，确认不会一人多高优、不会重复恢复刷屏。

## 12. 迁移风险与回退

| 风险 | 影响 | 缓解 |
|---|---|---|
| 六件套解析误判 | 有效工作被要求补证 | 第一批只提示不阻断；第二批允许人工 override |
| 一人一高优过硬 | 急单无法派发 | 支持 PM/总控 override，并写 reason |
| 恢复组折叠漏掉独立问题 | 真故障被合并 | fingerprint 包含 kind/cause/source；连续失败升级老周 |
| 新表迁移影响线上 | 数据写入失败 | 第一批无表；第二批表独立，不改现有列 |
| 前端把派生状态当原始状态 | 用户误解任务状态 | UI 明确标注“健康/调度派生状态” |
| 自动唤醒引发成本 | token 消耗增加 | wake-preview 默认开启，wake-run 需开关和预算检查 |

## 13. 验收口径

### 架构方案验收

- 覆盖成员状态/任务进程分离。
- 覆盖任务锁、恢复链、生产力复审去重策略。
- 覆盖一人一高优约束。
- 覆盖六件套证据评分。
- 覆盖条件唤醒小蓝/老周。
- 给出数据模型、接口清单、分批后端/前端任务。
- 不破坏现有控制平面不变量。

### 后续实现验收

- 单元测试覆盖六件套解析、恢复组去重、一人一高优。
- API 测试覆盖只读诊断和写入门禁。
- 前端使用真实浏览器验证健康页和 issue 详情。
- 所有完成评论必须包含六件套。
- 自动唤醒必须有预览和可关闭开关。

## 14. 下游复验清单

1. 运行 `git diff --check -- doc/plans/2026-06-05-cmpaa-122-dispatch-architecture.md`。
2. 对照 CMPAA-122 描述检查：状态分离、去重策略、一人一高优、六件套评分、条件唤醒、数据模型、接口、迁移风险、分批任务均已覆盖。
3. 确认本文未修改核心代码、未直接写数据库、未破坏现有控制平面语义。
4. 若进入实现阶段，先按“后端第一批：只读诊断”拆子任务，不直接大重构。
