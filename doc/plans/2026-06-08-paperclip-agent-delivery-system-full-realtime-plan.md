# 2026-06-08 纸夹智能体交付系统完整实时研发计划

## 结论

本计划将纸夹从事项看板升级为完整智能体交付系统。目标不是最小切片，而是完整覆盖实时诊断、评论可靠投递、阻塞分级、恢复动作、模型健康、完成证据、前端控制台和审计观测。

详细 djs-loop 执行目录：

```text
.planning/djs-loop/paperclip-agent-delivery-system/
```

## 一、完整功能范围

1. 控制面诊断聚合：每个非终态事项必须能解释当前是否健康、可疑、阻塞或静默停滞。
2. 评论失败不丢：失败评论进入草稿队列，可查询、重放、批量重放。
3. 阻塞分级：强阻塞、弱阻塞、提示阻塞；阻塞不得拦截补评论、补证据、补诊断。
4. 恢复动作闭环：静默、运行丢失、唤醒跳过、模型异常自动生成恢复动作。
5. 模型通道自愈：记录适配器和模型失败，计算健康分，给出重试、降级、转人工策略。
6. 完成证据强绑定：完成事项前校验工作产物、验证命令、验证结果、证据路径、提交号或无提交原因。
7. 实时交付控制台：前端页面显示健康总览、风险事项、草稿队列、恢复动作、模型健康、证据完整度。
8. 审计与观测：所有恢复、重放、降级、阻塞变更、完成拦截都写活动日志和诊断快照。

## 二、数据表

新增表：

```text
packages/db/src/schema/issue_comment_drafts.ts
packages/db/src/schema/issue_blocker_policies.ts
packages/db/src/schema/control_plane_diagnostic_snapshots.ts
packages/db/src/schema/model_health_events.ts
```

同步：

```text
packages/db/src/schema/index.ts
数据库迁移文件
共享类型与校验器
```

## 三、服务端模块

新增或扩展：

```text
server/src/services/control-plane-diagnostic.ts
server/src/services/issue-comment-drafts.ts
server/src/services/issue-blocker-policies.ts
server/src/services/model-health.ts
server/src/services/model-fallback-policy.ts
server/src/services/dispatch-gates.ts
server/src/services/heartbeat.ts
server/src/services/recovery/service.ts
server/src/services/local-ops-diagnostic.ts
```

## 四、接口

新增：

```text
GET  /api/companies/:companyId/control-plane/diagnostics
GET  /api/issues/:id/control-plane/diagnosis
POST /api/companies/:companyId/control-plane/diagnostics/refresh
POST /api/issues/:id/control-plane/recover
POST /api/companies/:companyId/control-plane/recover-batch
POST /api/companies/:companyId/control-plane/bulk-wakeup
GET  /api/companies/:companyId/comment-drafts
GET  /api/issues/:id/comment-drafts
POST /api/comment-drafts/:id/replay
POST /api/companies/:companyId/comment-drafts/replay-batch
GET  /api/issues/:id/blocker-policies
POST /api/issues/:id/blocker-policies
PATCH /api/blocker-policies/:id
POST /api/blocker-policies/:id/downgrade
GET  /api/companies/:companyId/model-health
GET  /api/agents/:id/model-health
POST /api/agents/:id/model-health/probe
```

## 五、前端

新增页面：

```text
ui/src/pages/DeliveryControlPlanePage.tsx
```

页面能力：

- 健康总览。
- 风险事项列表。
- 评论草稿队列。
- 恢复动作队列。
- 模型健康面板。
- 证据完整度面板。
- 一键唤醒。
- 草稿重放。
- 恢复动作执行。
- 阻塞降级。
- 跳转事项详情。
- 刷新时间和错误提示。

## 六、实施里程碑

### 里程碑一：数据库基础

- 建四张表。
- 生成迁移。
- 同步导出和共享契约。
- 数据库包类型检查。

### 里程碑二：核心服务

- 诊断聚合。
- 评论草稿。
- 阻塞策略。
- 模型健康。
- 证据闸门。

### 里程碑三：接口与活动日志

- 新增控制面路由。
- 新增草稿路由。
- 新增阻塞路由。
- 新增模型健康路由。
- 接口文档更新。
- 所有写动作接活动日志。

### 里程碑四：后台运行接入

- 心跳评论失败保存草稿。
- 静默运行生成恢复动作。
- 模型失败写健康事件。
- 安全草稿自动重放。
- 周期诊断快照。

### 里程碑五：前端控制台

- 接口客户端。
- 控制台页面。
- 路由导航。
- 操作交互。
- 真浏览器验证。

### 里程碑六：全链路验收

- 构造健康、阻塞、静默、评论失败、模型失败、证据不足等场景。
- 跑类型检查、测试、构建。
- 汇总证据和提交号。

## 七、质量门禁

阶段门禁：

```bash
pnpm --filter @paperclipai/db typecheck
pnpm --filter @paperclipai/server typecheck
pnpm test:run
```

最终门禁：

```bash
pnpm -r typecheck
pnpm test:run
pnpm build
```

前端触达后加：

```bash
pnpm test:e2e
```

## 八、执行约束

- 不强推。
- 不删除历史未提交文件。
- 不改战略文档整体结构，只做增量计划与实现。
- 不绕过公司作用域、单负责人、原子领取、审批闸门、预算硬停和活动日志。
- 真实外部触达不自动执行。

## 九、当前状态

已完成：

- 数据库基础：评论草稿、阻塞策略、诊断快照、模型健康事件四张表及导出已落地。
- 核心服务：诊断聚合、评论草稿、阻塞策略、模型健康、模型降级策略已落地。
- 接口层首批：控制面诊断只读接口已挂载，支持：
  - `GET /api/companies/:companyId/control-plane/diagnostics`
  - `GET /api/control-plane/diagnostics?companyId=...`
- 验证：新增服务单测通过，服务端类型检查通过。

最新验证命令：

```bash
pnpm --filter @paperclipai/server exec vitest run src/services/control-plane-diagnostic.test.ts src/services/issue-blocker-policies.test.ts src/services/issue-comment-drafts.test.ts src/services/model-health.test.ts
pnpm --filter @paperclipai/server typecheck
```

下一步：补草稿路由、阻塞路由、模型健康路由，并把写动作接入活动日志。
