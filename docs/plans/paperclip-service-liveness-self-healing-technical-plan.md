# 纸夹服务阻塞自愈与交付闭环技术方案

> 目标：把纸夹从“智能体看板”补强为“可审计、可自愈、可持续推进的智能体交付系统”。
>
> 源码路径：`/root/paperclip-work/paperclip`
>
> 当前分支：`dev`
>
> 远端：`https://github.com/MrRobt/paperclip.git`
>
> 方案日期：2026-06-08

## 1. 结论

纸夹服务阻塞的主因不是单个智能体不主动，而是服务端缺少统一的“非终态事项活性合同”落地面：

1. 事项状态、执行状态、产出证据、恢复动作分散在不同表和服务里。
2. 已有恢复模块能力较多，但没有形成统一主控诊断接口和自动动作闭环。
3. 评论失败已有纯函数草稿模块，但缺少持久化表、路由和后台重放器。
4. 阻塞关系只有“阻塞/不阻塞”，缺强弱分级、裁决降级和允许补证据的例外通道。
5. 唤醒接口返回“已跳过”时，缺少明确原因、下一步动作和可观测事件。

本方案不建议大改架构，建议按“诊断先行、状态分层、阻塞可执行、评论不丢、模型自愈、主控面板”六条线小步迭代。

## 2. 当前源码落点

### 2.1 仓库与技术栈

| 项 | 现状 |
|---|---|
| 仓库 | `/root/paperclip-work/paperclip` |
| 分支 | `dev` |
| 包管理 | `pnpm@9.15.4` |
| 语言 | TypeScript |
| 服务端 | `server/src`，Express 5 + Drizzle |
| 数据库包 | `packages/db/src/schema` |
| 前端 | `ui/` |
| 测试 | Vitest + Playwright |

关键脚本：

```bash
pnpm run typecheck
pnpm run test:run
pnpm --filter @paperclipai/server typecheck
pnpm --filter @paperclipai/server dev
```

### 2.2 关键服务端文件

| 模块 | 路径 | 作用 | 本方案动作 |
|---|---|---|---|
| 心跳执行 | `server/src/services/heartbeat.ts` | 调度、运行、重试、活性字段、评论写入 | 接入统一活性诊断和评论草稿持久化 |
| 恢复服务 | `server/src/services/recovery/service.ts` | 长运行静默、恢复动作、重试策略 | 补阻塞动作生成、恢复结果可观测 |
| 评论草稿 | `server/src/services/comment-draft-queue.ts` | 失败评论转草稿的纯函数 | 增加数据库表、路由、重放后台任务 |
| 调度闸门 | `server/src/services/dispatch-gates.ts` | 高优冲突、完成证据评分、恢复分组 | 扩展证据规则和阻塞分级规则 |
| 本地诊断 | `server/src/services/local-ops-diagnostic.ts` | 端口、长运行、队列摘要 | 扩展为主控诊断接口核心聚合器 |
| 智能体路由 | `server/src/routes/agents.ts` | 智能体管理、唤醒、运行日志 | 改进唤醒返回与批量诊断入口 |
| 事项路由 | `server/src/routes/issues.ts` | 事项、评论、状态流转 | 接入评论草稿、阻塞裁决、完成证据校验 |
| 接口文档 | `server/src/routes/openapi.ts` | 接口注册 | 新增诊断、草稿、阻塞接口文档 |

### 2.3 关键数据表

| 表 | 路径 | 已有字段/能力 | 缺口 |
|---|---|---|---|
| `issues` | `packages/db/src/schema/issues.ts` | `status`、`assigneeAgentId`、`checkoutRunId`、`executionRunId`、`executionPolicy`、`executionState`、监控字段 | 缺状态分层摘要字段；缺阻塞等级字段 |
| `heartbeat_runs` | `packages/db/src/schema/heartbeat_runs.ts` | `status`、`lastOutputAt`、`livenessState`、`livenessReason`、`nextAction`、`issueCommentStatus` | 缺统一诊断快照表；评论失败原因不够结构化 |
| `issue_recovery_actions` | `packages/db/src/schema/issue_recovery_actions.ts` | `sourceIssueId`、`ownerAgentId`、`cause`、`nextAction`、`wakePolicy`、`timeoutAt` | 可复用，但要补主控展示和动作流转 |
| `issue_comments` | `packages/db/src/schema/issue_comments.ts` | 评论正文、作者、运行编号 | 缺失败草稿表 |
| `agent_wakeup_requests` | `packages/db/src/schema/agent_wakeup_requests.ts` | 唤醒请求、状态、幂等键、运行编号 | 缺跳过原因细分与建议动作 |
| `issue_work_products` | `packages/db/src/schema/issue_work_products.ts` | 工作产物、状态、健康、运行编号 | 可作为证据实体基础，但需完成状态强绑定 |

## 3. 目标架构

### 3.1 状态分层

将现在混杂的“任务状态”拆成四层，聚合为主控可读诊断：

```text
事项业务状态：backlog / todo / in_progress / in_review / blocked / done / cancelled
执行链路状态：无执行 / 已排队 / 运行中 / 重试中 / 已丢失 / 已结束
产出证据状态：无证据 / 证据不足 / 可复审 / 已验收
恢复动作状态：无恢复 / 待恢复 / 恢复中 / 已升级 / 已解决
```

所有非终态智能体事项必须满足：

```text
活跃运行 || 排队唤醒 || 明确等待对象 || 明确阻塞链 || 明确恢复动作 || 人类负责人
```

否则判定为“静默阻塞”。

### 3.2 主控诊断聚合器

新增服务：

```text
server/src/services/control-plane-diagnostic.ts
```

核心输出：

```ts
export interface ControlPlaneIssueDiagnosis {
  issueId: string;
  identifier: string | null;
  title: string;
  issueStatus: string;
  assigneeAgentId: string | null;
  executionStatus: "none" | "queued" | "running" | "scheduled_retry" | "lost" | "terminal";
  evidenceStatus: "none" | "insufficient" | "needs_evidence" | "ready_for_review";
  recoveryStatus: "none" | "active" | "escalated" | "resolved";
  blockerStatus: "none" | "soft" | "hard" | "stale";
  liveness: "healthy" | "suspicious" | "blocked" | "stalled";
  nextAction: string;
  nextOwnerType: "agent" | "user" | "system" | "controller";
  nextOwnerId: string | null;
  evidence: Record<string, unknown>;
}
```

接口：

```text
GET /api/companies/:companyId/control-plane/diagnostics
POST /api/issues/:id/control-plane/recover
POST /api/companies/:companyId/control-plane/bulk-wakeup
```

### 3.3 阻塞关系治理

新增阻塞等级，不建议直接改 `issue_relations` 语义，可先在 `issues.executionState` 或新表保存等级，第二阶段再规范化。

建议新表：

```text
packages/db/src/schema/issue_blocker_policies.ts
```

字段：

```ts
id
companyId
issueId
blockerIssueId
level: "hard" | "soft" | "notice"
reason
createdByActorType
createdByActorId
downgradedAt
downgradedByUserId
downgradeReason
createdAt
updatedAt
```

规则：

| 等级 | 含义 | 限制 |
|---|---|---|
| `hard` | 真实不可继续，例如等待审批、缺权限、危险操作 | 禁止执行推进；允许补评论、证据、诊断 |
| `soft` | 可旁路推进，例如等待复审但可补证据 | 允许评论、补证据、创建下游任务 |
| `notice` | 仅提示风险 | 不阻塞执行，只展示告警 |

必须保证：阻塞永远不能拦截“补证据、补诊断、补评论草稿”。

### 3.4 评论失败不丢失

现有 `server/src/services/comment-draft-queue.ts` 已经具备纯函数能力，下一步补持久化。

新增表：

```text
packages/db/src/schema/issue_comment_drafts.ts
```

字段：

```ts
id
companyId
issueId
authorType
authorAgentId
authorUserId
createdByRunId
body
presentation
metadata
failureKind
failureReason
httpStatus
errorMessage
replayStatus: "pending" | "ready" | "blocked" | "done" | "failed"
replayAttemptCount
lastReplayAt
replayedCommentId
createdAt
updatedAt
```

新增服务：

```text
server/src/services/issue-comment-drafts.ts
```

新增接口：

```text
GET /api/companies/:companyId/comment-drafts?status=pending
POST /api/comment-drafts/:id/replay
POST /api/companies/:companyId/comment-drafts/replay-batch
```

接入点：

1. `server/src/routes/issues.ts` 的 `POST /api/issues/:id/comments`
2. `server/src/services/heartbeat.ts` 中运行结束自动写评论的路径
3. 所有捕获到外键、权限、阻塞、网络失败的位置

### 3.5 模型与适配器自愈

现有恢复服务中已有错误分类：

- `adapter_failed`
- `codex_transient_upstream`
- `claude_transient_upstream`
- `timeout`
- `budget_blocked`
- `budget_exhausted`

建议新增：

```text
server/src/services/model-health.ts
server/src/services/model-fallback-policy.ts
```

能力：

1. 每个适配器定时探针。
2. 对 agent 保存主模型、备用模型、降级模型。
3. 临时失败自动重试，连续失败自动切备用。
4. 不可重试错误直接生成恢复动作。
5. 所有切换写入 `activityLog` 和诊断摘要。

建议存储位置：

- 短期：`agents.adapter_config` 中增加 `fallbackProfiles`、`lastFallbackAt`。
- 中期：新增 `agent_model_health_snapshots` 表。

### 3.6 完成证据强绑定

现有 `dispatch-gates.ts` 已有 `scoreCompletionEvidence`，现有 `issue_work_products` 可作为证据实体。

改造规则：

1. 智能体将事项从 `in_progress` 转为 `in_review` 时，必须达到 `needs_evidence`。
2. 从 `in_review` 转为 `done` 时，必须达到 `ready_for_review` 或绑定 `issue_work_products`。
3. 完成评论必须含：改动摘要、分支、提交、验证命令、验证结果、下游复验口径。
4. 文档类任务允许 `commit=无代码提交`，但必须有文档路径和复验命令。

接口增强：

```text
GET /api/issues/:id/evidence-score
POST /api/issues/:id/work-products
PATCH /api/issues/:id/status   // 加证据闸门
```

## 4. 分阶段实施计划

### 阶段一：诊断闭环，不改核心调度

目标：先让主控一眼知道谁卡住、为什么卡住、下一步谁负责。

任务：

1. 新增 `server/src/services/control-plane-diagnostic.ts`。
2. 聚合 `issues`、`heartbeat_runs`、`agent_wakeup_requests`、`issue_recovery_actions`、`issue_comments`、`issue_work_products`。
3. 新增 `GET /api/companies/:companyId/control-plane/diagnostics`。
4. 在 `openapi.ts` 注册接口。
5. 新增测试 `server/src/__tests__/control-plane-diagnostic.test.ts`。

验收：

```bash
pnpm --filter @paperclipai/server typecheck
pnpm vitest server/src/__tests__/control-plane-diagnostic.test.ts --run
```

### 阶段二：评论草稿持久化

目标：评论写入失败不丢内容，可批量重放。

任务：

1. 新增 `packages/db/src/schema/issue_comment_drafts.ts`。
2. 导出到 `packages/db/src/schema/index.ts`。
3. 新增 `server/src/services/issue-comment-drafts.ts`。
4. 改造 `issues.ts` 评论写入失败路径。
5. 改造 `heartbeat.ts` 自动评论失败路径。
6. 新增路由和测试。

验收：

- 模拟外键失败，产生草稿。
- 模拟权限失败，草稿状态为 `blocked`。
- 修复条件后，重放成功并绑定 `replayedCommentId`。

### 阶段三：阻塞分级和主控裁决

目标：阻塞不再卡死评论、证据、诊断；主控可降级阻塞。

任务：

1. 新增阻塞策略表或先使用 `issues.executionState.blockerPolicy`。
2. 在阻塞校验逻辑中区分 `hard`、`soft`、`notice`。
3. 新增 `POST /api/issues/:id/blockers/:blockerId/downgrade`。
4. 所有降级必须写 `activityLog`。
5. 前端事项页展示阻塞等级和裁决记录。

验收：

- `hard` 阻塞禁止执行推进，但允许评论和证据补写。
- `soft` 阻塞允许下游任务继续创建。
- 降级必须要求原因，且可审计。

### 阶段四：自动恢复动作生成

目标：静默阻塞变成可执行恢复任务。

任务：

1. 扩展 `recovery/service.ts`：发现无活路事项时，优先创建 `issue_recovery_actions`，不是无限创建恢复 issue。
2. 对恢复动作设置 `timeoutAt`、`maxAttempts`、`nextAction`、`ownerAgentId`。
3. 超时后升级到主控或人类负责人。
4. 禁止恢复动作递归恢复自己的恢复动作。

验收：

- `in_progress` 无活跃运行超过阈值，生成恢复动作。
- 恢复动作已有时不重复创建。
- 恢复失败不会生成无限嵌套事项。

### 阶段五：模型通道自愈

目标：适配器和模型异常不再让团队停死。

任务：

1. 新增模型健康服务。
2. 扩展 agent 配置的备用模型列表。
3. 在 `heartbeat.ts` 失败分类后自动选择重试策略。
4. 对临时错误走退避重试；对连续错误走降级模型。
5. 输出模型健康和降级记录到诊断接口。

验收：

- 模拟 `adapter_failed`，自动重试。
- 模拟连续三次上游错误，切备用模型。
- 预算类错误不重试，直接阻塞并给明确负责人。

### 阶段六：主控面板与批量动作

目标：把外部巡检脚本能力内置到纸夹服务。

后端接口：

```text
GET /api/companies/:companyId/control-plane/summary
GET /api/companies/:companyId/control-plane/diagnostics
POST /api/companies/:companyId/control-plane/bulk-wakeup
POST /api/companies/:companyId/control-plane/replay-comment-drafts
POST /api/companies/:companyId/control-plane/create-recovery-actions
```

前端页面：

```text
ui/src/pages/ControlPlaneDashboard.tsx
```

页面区块：

1. 服务健康：接口、数据库、调度器。
2. 团队运行：空闲、排队、运行、异常。
3. 卡点列表：事项、成员、原因、下一步。
4. 评论草稿：待重放、失败原因、批量重放。
5. 模型健康：当前模型、失败率、降级状态。
6. 批量动作：唤醒、创建恢复动作、重放评论、导出短报。

## 5. 接口契约草案

### 5.1 诊断列表

```http
GET /api/companies/:companyId/control-plane/diagnostics?status=stalled&limit=100
```

响应：

```json
{
  "summary": {
    "totalOpen": 64,
    "healthy": 3,
    "suspicious": 8,
    "stalled": 53,
    "blocked": 0,
    "commentDrafts": 6
  },
  "items": [
    {
      "issueId": "...",
      "identifier": "CMP-123",
      "title": "...",
      "issueStatus": "in_progress",
      "executionStatus": "none",
      "evidenceStatus": "insufficient",
      "recoveryStatus": "none",
      "liveness": "stalled",
      "nextAction": "创建恢复动作并唤醒原负责人",
      "nextOwnerType": "controller",
      "nextOwnerId": null
    }
  ]
}
```

### 5.2 创建恢复动作

```http
POST /api/issues/:id/control-plane/recover
```

请求：

```json
{
  "kind": "stranded_issue_recovery",
  "ownerAgentId": "...",
  "nextAction": "检查事项为何无执行链路，恢复为 todo 后重新唤醒",
  "maxAttempts": 2,
  "timeoutMinutes": 30
}
```

### 5.3 评论草稿重放

```http
POST /api/comment-drafts/:id/replay
```

响应：

```json
{
  "status": "done",
  "commentId": "..."
}
```

## 6. 测试策略

### 6.1 单元测试

新增：

```text
server/src/__tests__/control-plane-diagnostic.test.ts
server/src/__tests__/comment-draft-persistence.test.ts
server/src/__tests__/blocker-policy.test.ts
server/src/__tests__/model-fallback-policy.test.ts
```

重点用例：

1. `in_progress + assigneeAgentId + 无 executionRunId + 无 queued wake + 无 recovery action` => `stalled`。
2. `in_review + 无 pending interaction + 无 reviewer` => `stalled`。
3. `blocked + blocker cancelled` => `stale blocker`。
4. 评论写入 500 => 草稿 pending。
5. 评论写入 403 => 草稿 blocked。
6. 同一恢复指纹重复触发 => 复用已有 `issue_recovery_actions`。
7. 适配器临时错误 => 可重试。
8. 预算错误 => 不重试，转阻塞。

### 6.2 集成测试

复用现有测试风格：

```bash
pnpm vitest server/src/__tests__/issue-recovery-actions.test.ts --run
pnpm vitest server/src/__tests__/heartbeat-issue-liveness-escalation.test.ts --run
pnpm vitest server/src/__tests__/issue-update-comment-wakeup-routes.test.ts --run
```

### 6.3 质量门禁

```bash
pnpm run typecheck
pnpm run test:run:general
pnpm run test:run:serialized
pnpm run build
```

## 7. 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| 恢复动作过度创建 | 看板膨胀 | 使用 `issue_recovery_actions_active_fingerprint_uq` 幂等约束 |
| 自动降级模型误用高成本通道 | 成本上升 | 降级策略带预算检查和最大尝试次数 |
| 阻塞降级绕过真实安全门 | 误推进危险任务 | `hard` 仅允许补证据/评论，不允许执行推进；降级必须主控权限 |
| 评论草稿泄露敏感信息 | 安全风险 | 写入前复用现有脱敏逻辑，展示时默认截断 |
| 诊断接口查询重 | 页面慢 | 按公司、状态、时间建索引，默认分页 100 |

回滚原则：

1. 阶段一只新增接口，不改调度，可直接关闭前端入口。
2. 阶段二新增表，不影响旧评论路径；失败时停用草稿重放器。
3. 阶段三阻塞分级先旁路展示，确认后再接入执行闸门。
4. 阶段五模型自愈必须有开关：`PAPERCLIP_MODEL_FALLBACK_ENABLED=false`。

## 8. 推荐优先级

最高优先级：

1. `control-plane-diagnostic.ts`：先把静默阻塞暴露出来。
2. `issue_comment_drafts`：评论失败不丢证据。
3. 阻塞分级：阻塞不再拦补证据。
4. 恢复动作幂等生成：阻塞变可执行动作。

中优先级：

1. 模型自愈。
2. 主控面板。
3. 完成证据强闸门。

后续：

1. 成本报表。
2. 中文化全站错误提示。
3. 插件化主控策略。

## 9. 最小可执行切片

如果只做第一周，建议只做四件事：

1. 新增诊断接口，列出所有 `stalled` 事项。
2. 评论失败持久化草稿。
3. `hard` 阻塞允许补评论和证据。
4. 一键创建恢复动作并唤醒负责人。

验收目标：

```text
主控打开一个接口或页面，能看到：谁卡住、卡因、下一步、负责人、是否可一键恢复。
评论失败后，草稿不会丢，恢复后可重放。
阻塞事项仍可补证据，不再导致历史断链。
```

## 10. 需要主人决策

1. 是否继续在 `dev` 分支直接开发，还是新建 `feat/纸夹阻塞自愈闭环` 分支？
2. 阻塞分级第一版是否允许先存 `issues.executionState`，减少迁移成本？
3. 主控面板是否先做后端接口和命令行短报，前端第二阶段再补？
4. 模型自愈默认开关：建议默认关闭，按团队开启。
