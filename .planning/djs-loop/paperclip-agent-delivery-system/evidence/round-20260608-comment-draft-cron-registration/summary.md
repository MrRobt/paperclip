# 证据：评论草稿重放 Cron Handler 注册（里程碑四）

## 变更文件

- `server/src/index.ts` — 在心跳调度 `setInterval` 链中追加 `replayDueCommentDrafts` 调用

## 闭环验证

- 类型检查：`npx tsc --noEmit --pretty false --project server/tsconfig.json` → 0 errors
- whitespace 检查：`git diff --check` → 无错误

## 本轮改动

### index.ts（约行 821-827 新增）

在心跳维护任务 `setInterval` 链中，按以下顺序追加 `replayDueCommentDrafts`：

```
scanSilentActiveRuns  →  replayDueCommentDrafts  →  reconcileProductivityReviews
```

每次心跳调度 tick，若有草稿被处理（`replayed | failed | blocked` 不全为空），记录 `logger.warn`。

关键设计决策：
- 与 `scanSilentActiveRuns` / `reconcileProductivityReviews` 完全对齐，都在同一 `setInterval` 周期
- 不单独创建 `setInterval`，避免周期不一致导致状态漂移
- 注册在 `scanSilentActiveRuns` 之后、`reconcileProductivityReviews` 之前，与恢复类任务就近排列

## 提交号

`cb682b8`（已提交）
