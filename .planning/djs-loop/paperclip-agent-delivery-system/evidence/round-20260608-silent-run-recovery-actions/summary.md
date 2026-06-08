# 证据：静默运行生成恢复动作（里程碑四）

## 现状

静默运行恢复动作已完整实现，无需新增代码。

## 实现链路

```
心跳调度 setInterval
  └─→ scanSilentActiveRuns()
          ├─ 查询：heartbeat_runs.status='running' 且 60min 无输出
          ├─ 过滤：snoozed（最近有 watchdog decision）
          └─ 创建/更新 stale_run_evaluations：
               kind='staleActiveRunEvaluation'
               origin='stale_active_run_evaluation'
               → 创建 evaluation issue → escalate / continue / fold
  └─→ reconcileStrandedAssignedIssues()
          ├─ 查找 stranded assigned issues（已分配但无运行中的 run）
          └─ 调度恢复动作：续期/重新分配/上报
```

## 关键文件

- `server/src/services/recovery/service.ts:1616` — `scanSilentActiveRuns` 函数（约 45 行）
- `server/src/services/heartbeat.ts:6954` — 代理函数，透传 `recoveryService.scanSilentActiveRuns`
- `server/src/index.ts:818` — cron 注册（在 `setInterval` 链中，与 `replayDueCommentDrafts` 同周期）

## 证据

- cron 注册已存在：`index.ts` 行 818 `heartbeat.scanSilentActiveRuns()`
- `scanSilentActiveRuns` 返回 `{ scanned, created, existing, escalated, folded, snoozed, skipped, evaluationIssueIds }`
- `reconcileStrandedAssignedIssues` 在同一 `setInterval` 链中后续处理 evaluation issues
- 证据：行 818 `logger.warn({ ...scanned }, "periodic active-run output watchdog created review work")`

## 闭环结论

「静默运行生成恢复动作」已实现并注册，无需新增代码。本证据目录记录现有实现供查阅。
