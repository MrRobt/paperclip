# 证据：心跳评论失败写入草稿表（里程碑四）

## 变更文件

- `server/src/services/issue-comment-drafts.ts` — 新增 `saveCommentDraft` DB 写入函数、`DbFailureKind`/`DbReplayStatus` 内联类型
- `server/src/services/heartbeat.ts` — 两个评论失败 catch 块新增 `saveCommentDraft` 调用

## 闭环验证

- 类型检查：`npx tsc --noEmit --pretty false --project server/tsconfig.json` → 0 errors
- whitespace 检查：`git diff --check` → 无错误

## 本轮改动

### issue-comment-drafts.ts

1. 导入 `issueCommentDrafts`（Drizzle 表）和 `Db` 类型
2. 导出 `saveCommentDraft(db, input)` 函数：将 `PersistableCommentDraftInput` 转换为表行并写入 `issue_comment_drafts` 表
3. 用 `as typeof issueCommentDrafts.$inferInsert` 类型断言绕过 Drizzle insert 类型推断与 `Db` 参数不匹配的问题

### heartbeat.ts

两处 catch 块新增草稿写入逻辑：

**workspace-ready 评论失败**（`buildWorkspaceReadyComment` 返回 `string`，行 7978 附近）：

```typescript
const workspaceComment = buildWorkspaceReadyComment({ workspace, runtimeServices });
await saveCommentDraft(db, {
  companyId: agent.companyId,
  issueId,
  authorType: "agent",
  authorAgentId: agent.id,
  createdByRunId: run.id,
  body: workspaceComment,
  metadata: { runId: run.id },
  failureKind,
  failureReason: errMessage,
  httpStatus: null,
  rawErrorMessage: String(err),
  requestedAt: new Date().toISOString(),
});
```

**run summary 评论失败**（`buildHeartbeatRunIssueComment` 返回 `string`，行 8335 附近）：

```typescript
const issueCommentBody = buildHeartbeatRunIssueComment(persistedResultJson);
if (issueCommentBody) {
  await saveCommentDraft(db, {
    companyId: agent.companyId,
    issueId,
    authorType: "agent",
    authorAgentId: agent.id,
    createdByRunId: livenessRun.id,
    body: issueCommentBody,
    metadata: { runId: livenessRun.id },
    failureKind,
    failureReason: errMessage,
    httpStatus: null,
    rawErrorMessage: String(err),
    requestedAt: new Date().toISOString(),
  });
}
```

## 技术债说明

两处 `failureKind` 分类用字符串 `includes` 判断（`errMessage.includes("401")` 等），这是权宜之计，与 `comment-draft-queue.ts` 中的 `CommentDraftFailureKind` 枚举不完全对齐。后续可统一抽象一个 `classifyFailureKind(err: Error): CommentDraftFailureKind` 工具函数。

## 提交号

（本轮提交前，尚未执行 git add）
