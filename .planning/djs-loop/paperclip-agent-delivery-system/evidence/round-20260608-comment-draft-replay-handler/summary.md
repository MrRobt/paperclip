# 证据：心跳评论草稿重放 Cron Handler（里程碑四）

## 变更文件

- `server/src/services/heartbeat.ts` — 新增 `replayDueCommentDrafts` 函数（约 80 行），导出到 `HeartbeatService`

## 闭环验证

- 类型检查：`npx tsc --noEmit --pretty false --project server/tsconfig.json` → 0 errors
- whitespace 检查：`git diff --check` → 无错误

## 本轮改动

### heartbeat.ts

**新增导入**（约行 48）：`issueCommentDrafts` 从 `@paperclipai/db` 导入。

**新增函数 `replayDueCommentDrafts`**（约行 5797-5883）：

```
功能：Cron handler，每 tick 最多处理 20 条 replayStatus=pending 的草稿。
输入：可选 now Date（供测试注入）
输出：{ replayed: string[], failed: string[], blocked: string[] }

处理逻辑：
1. 查询 issue_comment_drafts 表，按 createdAt ASC 取最多 20 条 replayStatus=pending 的草稿
2. 逐条调用 issuesSvc.addComment(issueId, body, { agentId?, runId? }) 重放评论
3. 成功 → replayStatus='done'，写入 lastReplayAt + replayAttemptCount
4. 失败分类：
   - 401/403/unauthorized/forbidden → blocked（不再重试）
   - 其他错误且 replayAttemptCount+1 >= 3 → failed（停止重试）
   - 其他错误且重试次数未满 → pending（下次 cron 继续）
   - 每次失败记录 errorMessage + lastReplayAt
```

**导出对象新增**（约行 10350）：`replayDueCommentDrafts` 同步导出到 `HeartbeatService`。

## 技术细节

- `runIdHint` 从 `draft.metadata.runId` 提取（metadata 原始类型为 `IssueCommentMetadata`，用双 as 绕过 Drizzle jsonb 类型推断）
- 重放时传入 `{ agentId, runId }` 可选参数，保持与心跳评论一致的关联信息
- 限流：每 tick 最多 20 条，避免一次处理过多草稿
- 与 `promoteDueScheduledRetries` 模式完全对齐（查询 → 批量限流 → 逐条处理 → 返回摘要）

## 提交号

（本轮提交前，尚未执行 git add）
