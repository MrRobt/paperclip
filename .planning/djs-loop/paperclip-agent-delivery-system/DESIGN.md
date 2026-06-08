# 纸夹智能体交付系统完整设计

状态：进行中

## 一、设计原则

1. 不重写现有纸夹架构，只在现有服务、数据表、路由和前端页面上增量扩展。
2. 所有新增能力必须公司作用域隔离。
3. 诊断先行，动作后置；系统必须先能解释为什么卡住，再执行恢复。
4. 阻塞不等于静默；阻塞状态下仍允许补评论、补证据、补诊断、补恢复动作。
5. 智能体自报不是完成证据，必须绑定可复核工作产物。
6. 自动自愈不得绕过预算、审批、安全和真实外部触达边界。

## 二、总体架构

```text
前端交付控制台
  ├─ 健康总览
  ├─ 风险事项队列
  ├─ 评论草稿队列
  ├─ 恢复动作队列
  ├─ 模型健康面板
  └─ 证据完整度面板

服务端控制面
  ├─ 诊断聚合服务
  ├─ 评论草稿服务
  ├─ 阻塞策略服务
  ├─ 恢复动作编排服务
  ├─ 模型健康服务
  ├─ 证据闸门服务
  └─ 活动日志服务

数据库
  ├─ 事项、评论、运行、恢复动作、工作产物等已有表
  ├─ 评论草稿表
  ├─ 阻塞策略表
  ├─ 诊断快照表
  └─ 模型健康事件表
```

## 三、核心数据模型

### 三点一 评论草稿表

路径：`packages/db/src/schema/issue_comment_drafts.ts`

核心字段：

- 编号、公司编号、事项编号。
- 作者类型、作者智能体编号、作者用户编号。
- 创建运行编号。
- 评论正文、展示形态、元数据。
- 失败类型、失败原因、接口状态码、错误消息。
- 重放状态、重放次数、上次重放时间、重放成功评论编号。
- 创建时间、更新时间。

### 三点二 阻塞策略表

路径：`packages/db/src/schema/issue_blocker_policies.ts`

核心字段：

- 编号、公司编号、事项编号、阻塞事项编号。
- 阻塞等级：强阻塞、弱阻塞、提示阻塞。
- 原因、创建者、降级人、降级原因、降级时间。
- 创建时间、更新时间。

### 三点三 诊断快照表

路径：`packages/db/src/schema/control_plane_diagnostic_snapshots.ts`

用途：保留诊断结果变化历史，支撑实时页面、趋势统计和事后审计。

核心字段：

- 编号、公司编号、事项编号。
- 活性状态、执行状态、证据状态、恢复状态、阻塞状态。
- 严重级别、下一步动作、下一步负责人类型、下一步负责人编号。
- 诊断来源、诊断明细。
- 创建时间。

### 三点四 模型健康事件表

路径：`packages/db/src/schema/model_health_events.ts`

核心字段：

- 编号、公司编号、智能体编号、运行编号。
- 适配器类型、模型标识、事件类型、错误类型。
- 耗时、重试次数、是否降级、降级目标。
- 错误摘要、原始错误摘要、创建时间。

## 四、服务端模块设计

### 四点一 诊断聚合服务

路径：`server/src/services/control-plane-diagnostic.ts`

职责：

1. 汇总事项业务状态、执行链路状态、证据状态、恢复动作状态、阻塞状态。
2. 判定健康、可疑、阻塞、静默停滞。
3. 生成下一步动作和负责人。
4. 写入诊断快照。
5. 给前端和恢复服务提供统一输入。

输出结构：

```ts
interface ControlPlaneIssueDiagnosis {
  issueId: string;
  identifier: string | null;
  title: string;
  issueStatus: string;
  executionStatus: string;
  evidenceStatus: string;
  recoveryStatus: string;
  blockerStatus: string;
  liveness: string;
  severity: string;
  nextAction: string;
  nextOwnerType: string;
  nextOwnerId: string | null;
  reasons: string[];
  evidence: Record<string, unknown>;
}
```

### 四点二 评论草稿服务

路径：`server/src/services/issue-comment-drafts.ts`

职责：

1. 保存评论失败草稿。
2. 查询待重放草稿。
3. 单条重放。
4. 批量重放。
5. 重放成功后写真实评论并回填草稿状态。
6. 重放失败后递增次数并记录原因。

接入点：

- `server/src/routes/issues.ts` 评论创建路径。
- `server/src/services/heartbeat.ts` 心跳评论写入路径。
- `server/src/services/recovery/service.ts` 恢复动作评论路径。

### 四点三 阻塞策略服务

路径：`server/src/services/issue-blocker-policies.ts`

职责：

1. 创建、读取、更新、降级阻塞策略。
2. 为调度闸门提供“是否允许执行、是否允许补证据、是否允许补评论”的判定。
3. 写活动日志。

### 四点四 模型健康服务

路径：`server/src/services/model-health.ts`

职责：

1. 记录模型调用失败、适配器失败、超时、取消、预算停止。
2. 计算模型和适配器近期健康分。
3. 给降级策略提供输入。

路径：`server/src/services/model-fallback-policy.ts`

职责：

1. 读取智能体运行配置。
2. 根据健康分、预算、审批策略给出建议动作。
3. 执行可安全自动执行的重试或降级。
4. 对高风险动作生成恢复动作而不是直接执行。

### 四点五 证据闸门服务

扩展路径：`server/src/services/dispatch-gates.ts`

职责：

1. 统一计算事项完成证据完整度。
2. 完成接口调用前检查工作产物、验证命令、验证结果、证据路径、提交号或无提交原因。
3. 对不满足的事项返回可操作原因，而不是笼统失败。

## 五、接口设计

### 五点一 诊断接口

- `GET /api/companies/:companyId/control-plane/diagnostics`
- `GET /api/issues/:id/control-plane/diagnosis`
- `POST /api/companies/:companyId/control-plane/diagnostics/refresh`

### 五点二 恢复接口

- `POST /api/issues/:id/control-plane/recover`
- `POST /api/companies/:companyId/control-plane/recover-batch`
- `POST /api/companies/:companyId/control-plane/bulk-wakeup`

### 五点三 评论草稿接口

- `GET /api/companies/:companyId/comment-drafts`
- `GET /api/issues/:id/comment-drafts`
- `POST /api/comment-drafts/:id/replay`
- `POST /api/companies/:companyId/comment-drafts/replay-batch`

### 五点四 阻塞策略接口

- `GET /api/issues/:id/blocker-policies`
- `POST /api/issues/:id/blocker-policies`
- `PATCH /api/blocker-policies/:id`
- `POST /api/blocker-policies/:id/downgrade`

### 五点五 模型健康接口

- `GET /api/companies/:companyId/model-health`
- `GET /api/agents/:id/model-health`
- `POST /api/agents/:id/model-health/probe`

## 六、前端页面设计

新增页面：`ui/src/pages/DeliveryControlPlanePage.tsx`

页面模块：

1. 健康总览卡片：健康、可疑、阻塞、静默、草稿待重放、恢复待执行数量。
2. 风险事项表：事项、负责人、状态、原因、下一步动作、严重级别。
3. 评论草稿队列：失败原因、正文摘要、重放按钮、批量重放按钮。
4. 恢复动作队列：来源事项、原因、负责人、超时、执行按钮。
5. 模型健康面板：适配器、模型、失败率、最近错误、建议策略。
6. 证据完整度面板：缺少提交、缺少验证、缺少证据路径的事项。

前端要求：

- 使用公司选择上下文。
- 接口失败清楚提示。
- 所有控制动作有确认、结果提示和失败原因。
- 页面显示最后刷新时间。
- 如暂未接入推送，默认短轮询刷新。

## 七、后台任务设计

新增或扩展服务端调度：

1. 周期性生成诊断快照。
2. 自动识别静默停滞事项并创建恢复动作。
3. 自动重放低风险评论草稿。
4. 自动记录模型健康事件。
5. 自动对证据不足的已完成申请降级为待复审或返回补证据。

后台任务必须可配置开关，默认先记录建议和恢复动作，不做高风险自动执行。

## 八、活动日志与审计

所有动作写活动日志：

- 创建评论草稿。
- 评论草稿重放成功或失败。
- 创建、升级、降级阻塞策略。
- 执行恢复动作。
- 自动唤醒或批量唤醒。
- 模型降级或重试策略执行。
- 完成证据闸门拦截。

## 九、风险与回滚

| 风险 | 控制 |
|---|---|
| 自动恢复误触发 | 默认生成恢复动作，低风险动作才自动执行 |
| 阻塞分级破坏现有调度 | 先作为附加策略表，不改变现有关系表语义 |
| 前端操作太危险 | 高风险动作加确认并写活动日志 |
| 数据库迁移影响旧数据 | 新表增量迁移，不改旧字段默认语义 |
| 模型降级绕过预算 | 降级策略必须读取预算和审批配置 |

## 十、分层取舍

不选择最小切片。本轮计划按完整交付系统设计，但实施时采用阶段性交付：先打基础表和服务，再打接口，再打前端，再打自愈策略，再做全链路验收。每阶段都可独立验证，但最终目标是完整系统闭环。
