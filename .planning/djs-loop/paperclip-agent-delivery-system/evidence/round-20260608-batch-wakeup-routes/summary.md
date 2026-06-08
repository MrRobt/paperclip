# 2026-06-08 批量唤醒路由闭环证据

## 结论

已补齐公司维度智能体批量唤醒接口，支持一次请求对多个智能体排队唤醒，按智能体返回 queued/skipped/failed 结果，并写入活动日志。

## 变更文件

- `server/src/routes/agents.ts`
- `server/src/routes/openapi.ts`
- `server/src/__tests__/agent-permissions-routes.test.ts`
- `.planning/djs-loop/paperclip-agent-delivery-system/RUN_LOG.md`
- `.planning/djs-loop/paperclip-agent-delivery-system/EVIDENCE.md`
- `.planning/djs-loop/paperclip-agent-delivery-system/IMPLEMENTATION_PLAN.md`
- `.planning/djs-loop/paperclip-agent-delivery-system/evidence/round-20260608-batch-wakeup-routes/summary.md`

## 接口能力

- 新增：`POST /api/companies/{companyId}/agents/wakeup-batch`
- 入参：继承单智能体唤醒参数，并新增 `agentIds`，限制 1 到 50 个 UUID。
- 行为：
  - 公司访问校验。
  - 管理智能体权限校验。
  - 自动去重重复智能体编号。
  - 每个智能体独立唤醒，不因单个失败中断整批。
  - 幂等键按智能体追加后缀，避免批量请求内部互相冲突。
  - 成功和批量摘要写活动日志。
- 返回：`202`，正文包含每个智能体的 `agentId/status/runId/error`。

## 验证命令和结果

- `npx tsc --noEmit --pretty false --project server/tsconfig.json`
  - 结果：通过。
- `git diff --check -- server/src/routes/agents.ts server/src/routes/openapi.ts server/src/__tests__/agent-permissions-routes.test.ts`
  - 结果：通过，无空白错误。
- `grep -n "P3-01\|WEB3-01\|C3-01\|W3-01\|QC3-01" server/src/routes/agents.ts server/src/routes/openapi.ts server/src/__tests__/agent-permissions-routes.test.ts || true`
  - 结果：无输出，无临时编号残留。
- `pnpm --filter @paperclipai/server test -- agent-permissions-routes.test.ts`
  - 结果：未执行成功，当前环境缺少 `pnpm` 命令。
- `corepack pnpm --filter @paperclipai/server test -- agent-permissions-routes.test.ts`
  - 结果：未执行成功，当前环境缺少 `corepack` 命令。
- `npx vitest run server/src/__tests__/agent-permissions-routes.test.ts`
  - 结果：未通过，失败根因为本地 `sqlite3` 原生绑定缺失，所有 46 个用例在加载阶段同根失败：`Could not locate the bindings file ... sqlite3 ... node_sqlite3.node`。这不是本轮业务代码断言失败。

## 风险和待验证

- 需要在依赖完整、`pnpm` 和 `sqlite3` 原生绑定可用的环境复跑服务端路由测试。
- 本轮只打通后端批量唤醒接口；前端控制台按钮和真实浏览器验收留到下一轮。

## 下一轮最小功能点

在交付控制台页面接入批量唤醒操作入口，并补齐加载、错误、空态和操作结果展示。
