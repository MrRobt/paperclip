# 2026-06-08 评论草稿路由闭环证据

## 本轮目标

按完整实时方案继续里程碑三：补评论草稿队列接口和重放接口，并让写动作进入活动日志。

## 业务能力

- 公司维度查询评论草稿：`GET /api/companies/:companyId/comment-drafts`
- 事项维度查询评论草稿：`GET /api/issues/:id/comment-drafts`
- 单条草稿重放：`POST /api/comment-drafts/:id/replay`
- 公司维度批量重放：`POST /api/companies/:companyId/comment-drafts/replay-batch`
- 重放成功：正式写入 `issue_comments`，更新草稿 `done` 与 `replayedCommentId`，记录 `issue.comment.created` 和 `comment_draft.replayed` 活动日志。
- 自动重放不满足条件：更新草稿 `blocked`，记录 `comment_draft.replay_blocked` 活动日志。

## 验证命令

```bash
pnpm --filter @paperclipai/server typecheck
pnpm --filter @paperclipai/server exec vitest run src/services/control-plane-diagnostic.test.ts src/services/issue-blocker-policies.test.ts src/services/issue-comment-drafts.test.ts src/services/model-health.test.ts src/services/local-ops-diagnostic.test.ts
```

## 验证结果

- 服务端类型检查：通过。
- 相关服务单测：5 个测试文件，20 个用例全部通过。

## 变更文件

- server/src/routes/comment-drafts.ts
- server/src/app.ts
- .planning/djs-loop/paperclip-agent-delivery-system/RUN_LOG.md
- .planning/djs-loop/paperclip-agent-delivery-system/evidence/round-20260608-comment-draft-routes/summary.md

## 下一轮最小功能点

继续里程碑三：补阻塞策略路由与模型健康路由，并把降级/探测写动作接活动日志。
