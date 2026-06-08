# 2026-06-08 阻塞策略与模型健康路由证据

## 本轮目标

继续纸夹智能体交付系统里程碑三：补阻塞策略路由、模型健康路由，并让写动作进入活动日志。

## 业务能力

### 阻塞策略

- `GET /api/issues/:id/blocker-policies`：查询事项阻塞策略并返回执行决策。
- `POST /api/issues/:id/blocker-policies`：创建强/弱/提示阻塞策略。
- `PATCH /api/blocker-policies/:id`：更新状态、级别、原因和元数据。
- `POST /api/blocker-policies/:id/downgrade`：将强阻塞降级为弱阻塞或提示阻塞。
- 写动作记录活动日志：`issue_blocker_policy.created/updated/downgraded`。

### 模型健康

- `GET /api/companies/:companyId/model-health`：公司维度汇总模型健康。
- `GET /api/agents/:id/model-health`：智能体维度汇总模型健康。
- `POST /api/agents/:id/model-health/probe`：记录探测/错误/降级事件，返回健康摘要和降级决策。
- 写动作记录活动日志：`model_health.probed`。

## 验证命令

```bash
pnpm --filter @paperclipai/server typecheck
pnpm --filter @paperclipai/server exec vitest run src/services/issue-blocker-policies.test.ts src/services/model-health.test.ts src/services/issue-comment-drafts.test.ts src/services/control-plane-diagnostic.test.ts src/services/local-ops-diagnostic.test.ts
```

## 验证结果

- 服务端类型检查：通过。
- 相关服务单测：5 个测试文件，20 个用例全部通过。

## 变更文件

- server/src/routes/blocker-policies.ts
- server/src/routes/model-health.ts
- server/src/app.ts
- .planning/djs-loop/paperclip-agent-delivery-system/RUN_LOG.md
- .planning/djs-loop/paperclip-agent-delivery-system/evidence/round-20260608-blocker-model-routes/summary.md

## 下一轮最小功能点

补恢复动作路由和批量唤醒路由，接入诊断快照与活动日志。
