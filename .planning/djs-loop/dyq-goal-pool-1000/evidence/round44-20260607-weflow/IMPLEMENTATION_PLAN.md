# IMPLEMENTATION_PLAN — W层设备节点/事件/安全闭环

# IMPLEMENTATION_PLAN — W层设备节点/事件/安全闭环

STATUS: COMPLETE
开始时间：2026-06-07
完成时间：2026-06-07

## 切片 1：W1.4 心跳携带微信事件计数 ✅

- 改 `dyqCloudTaskService.ts`：
  - 增加 `wechatEventCounters` 接口（wechatReceiveCount / lastContactSession / lastEnqueueAt）
  - 注入到 heartbeat body（extras）
  - 提供 `recordEnqueueEvent(payload)` 方法供 messagePushService 调用
- 改 `messagePushService.ts`：在 enqueueMessage 成功路径上调 dyqCloudTaskService.recordEnqueueEvent(payload)
- 改 `dyqCloudTaskService.ts`：可选注入 fetcher（已有）
- 单测：`tests/dyq-cloud-task.test.cjs` 加 2~3 条 heartbeat 计数断言 ✅ 38 通过

## 切片 2：W1.3 设备注册补 deviceType/capabilities ✅

- 改 `dyqCloudTaskService.ts` ensureRegistered body
- 单测：register body.deviceType === 'WEFLOW' && capabilities 包含 3 个 ✅

## 切片 3：W2.1 草稿审查链 ✅

- 新文件 `electron/services/wechat/draftDecisionFilter.ts`
- 改 wechatControlService.submitDecision 走 filter
- 单测覆盖 4 类 ✅ 11 通过

## 切片 4：W2.2 GUI 安全确认页 ✅

- 新文件 `src/pages/SafetyConfirmPage.tsx`
- 改 App.tsx 路由
- preload 暴露 confirmDraft/listPending + rejectDraft
- IPC handler 在 main.ts 注册并门禁 auto_send ✅
- 单测：`tests/safety-confirm-route.test.cjs` ✅ 7 通过

## 切片 5：W2 阶段真实后端 401/异常处理封装 ✅

- 在 `dyqCloudTaskService.ts` 顶部新增：
  - `DyqCloudHttpError` 类（kind / status / path / upstreamCode/msg / retryable / toStatusMessage）
  - `classifyHttpError(status, path, ...)` 6 种 kind 分类
  - `request()` 改写：网络异常 / 4xx / 5xx / JSON 解析失败 / 业务 code 非 0/200 全部走 classifyHttpError
  - `handleCloudHttpError()`：401/403 清空 tokenState 触发下一轮重注册；5xx/network 保留 tokenState
  - `tick()` 优先使用 `toStatusMessage()` 保留 [kind] 分类标签
- 单测：`tests/dyq-cloud-http-error.test.cjs` 15 用例 ✅
  - 401 → kind=unauthorized + 清空 tokenState + 下次 tick 自动重注册
  - 403 → kind=forbidden + 清空 tokenState
  - 5xx → kind=server + tokenState 保留 + retryable=true
  - 4xx 业务错 → kind=client
  - 网络异常 → kind=network + retryable=true
  - 业务 code=5000 → server 类 + 上游 code/msg
  - 非 JSON 响应 → server 类 + invalid json

## 完成条件 ✅

- 切片 1~5 全部实现 + 单测
- npm run typecheck 0 错误 ✅
- npm test 71 用例全过（38+11+7+15）✅
- 既有测试不破坏（38 用例未变）✅
- git status 改动可解释 ✅
- 提交号：本轮 commit 6789aab/...

## 状态机

- DISPATCHING → BUILDING (切片 1-2) → VERIFYING → BUILDING (切片 3-4) → VERIFYING → BUILDING (切片 5) → VERIFYING → COMPLETE
- 阻塞：本轮无
