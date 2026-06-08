# 证据：模型失败生成健康事件（里程碑四）

## 现状

模型健康事件探针接口已完整实现。模型失败时由 agent 主动上报，不是在心跳 cron 中被动探测。

## 实现链路

```
Agent 执行中发现模型失败（timeout / rate_limit / error）
  └─→ POST /api/agents/:id/model-health/probe
          ├─ 写入 model_health_events 表
          │    eventType: 'timeout' | 'adapter_error' | 'model_error' | 'rate_limited'
          │    errorKind / latencyMs / retryAttempt / fallbackApplied
          ├─ 调用 summarizeModelHealth() 汇总近期事件
          ├─ 调用 chooseModelFallbackPolicy() 获取 fallback 推荐
          └─ 记录活动日志：kind='model_health.probed'
```

## 关键文件

- `server/src/routes/model-health.ts` — 探针接口 `POST /api/agents/:id/model-health/probe`（行 68-113）
- `server/src/services/model-health.ts` — `summarizeModelHealth` 汇总逻辑
- `server/src/services/model-fallback-policy.ts` — `chooseModelFallbackPolicy` fallback 推荐逻辑
- `packages/db/src/schema/model_health_events.ts` — 表结构

## 事件类型

`probeBodySchema.eventType`：
- `probe_result`（默认）
- `adapter_error`
- `model_error`
- `timeout`
- `rate_limited`
- `budget_stopped`
- `fallback_selected`

## 证据

- 探针接口已注册路由：`POST /api/agents/:id/model-health/probe`
- probe handler 写入 `model_health_events` 表并返回 `summary` + `fallback`
- 活动日志写入 `kind='model_health.probed'`
- 表结构在 `packages/db/src/schema/model_health_events.ts`

## 闭环结论

「模型失败生成健康事件」已完整实现（agent 主动探针模式，非心跳被动探测）。事件记录 → 汇总 → fallback 推荐全链路已打通。
