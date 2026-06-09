# RUN_LOG — W层设备节点/事件/安全闭环

执行时间：2026-06-07 (UTC)
状态：STATUS: COMPLETE

## 切片 1：W1.4 心跳携带 wechatReceiveCount + lastContactSession

- 改 `dyqCloudTaskService.ts`：
  - 导出 `WechatEventCounters` 接口
  - 私有字段 `wechatEventCounters`，方法 `recordEnqueueEvent(payload)` 与 `resetWechatEventCounters()`
  - `getStatus()` 新增 `wechatEventCounters` 字段（深拷贝）
  - `heartbeat()` body 加 `wechat: { receiveCount, lastContactSession, lastContactSessionName, lastEnqueueAt }`
- 改 `messagePushService.ts`：在 `enqueueMessage` 成功后 try/catch 包 `dyqCloudTaskService.recordEnqueueEvent({ sessionId, sessionName })`
- 加单测 4 条（计数器递增 / reset / 心跳携带 / 既有字段保留）

## 切片 2：W1.3 设备注册补 deviceType/capabilities

- 改 `dyqCloudTaskService.ts` `ensureRegistered` body：
  - `deviceType: 'WEFLOW'`
  - `capabilities: ['wechat-receive', 'wechat-send', 'wechat-image']`
- 加单测 1 条（断言 register body 含 deviceType + 3 capabilities）

## 切片 3：W2.1 草稿决策审查链

- 新文件 `electron/services/wechat/draftDecisionFilter.ts`：
  - 导出 `applyDecisionFilter(request, text, options?)` 返回 `DraftDecisionFilterResult`
  - 默认黑名单：代付/充值/银行卡/验证码/中奖/兼职/刷单/转账
  - 默认白名单：谢谢/收到/好的/已确认/明白/了解/没问题
  - 黑名单命中 → 强制 `prepare_only` + 审计
  - 白名单命中 → 放行原 mode
  - 黑+白同时 → 取严（prepare_only）
  - 非 reply 决策透传
- 改 `wechatControlService.ts` `submitDecision`：
  - reply 分支先过 filter，记录 `force_prepare_only` 审计
  - 用 `effectiveMode` 替换原 `(request.mode || 'auto_send')` 进行 stopped / risk 判断
  - `createReplyTask` 用 `{ ...request, mode: effectiveMode }`
- 新单测 `tests/draft-decision-filter.test.cjs` 11 条：
  - 黑名单代付/验证码 / 白名单收到 / 无命中 / 黑+白同时 / 非 reply / draft 透传 / 默认集合非空 / submitDecision 端到端（私聊黑名单 mode 强制 prepare_only / 私聊白名单放行 / 群聊 SESSION_NOT_ALLOWED）

## 切片 4：W2.2 GUI 安全确认页

- 新文件 `src/pages/SafetyConfirmPage.tsx` + `.scss`
- 改 `src/App.tsx` 引入 + 注册 `/safety/confirm` 路由
- 改 `electron/preload.ts` 暴露 `wechatControl.listDrafts / confirmDraft / rejectDraft`
- 改 `electron/main.ts` 注册 3 个 IPC handler：
  - `listDrafts` 走 wechatControlService.listReplyTasks
  - `confirmDraft` 门禁：auto_send 任务拒绝（强制走 GUI 真实按钮）
  - `rejectDraft` 写审计
- `wechatControlService.ts` 新增 `listReplyTasks({ limit, mode })` 方法：默认过滤 mode=prepare_only/confirm_required，剔除 sent/cancelled
- 新单测 `tests/safety-confirm-route.test.cjs` 7 条：路由 + IPC + 页面三件套静态扫描

## 验证命令与结果

```
$ npm run typecheck
> tsc --noEmit
(0 errors)

$ node tests/dyq-cloud-task.test.cjs
测试完成：38 通过，0 失败

$ node tests/draft-decision-filter.test.cjs
测试完成：11 通过，0 失败

$ node tests/safety-confirm-route.test.cjs
测试完成：7 通过，0 失败

$ node tests/httpService.wechat-routes.contract.cjs
httpService /api/v1/wechat route contract passed

$ npm run wechat:control:verify
wechatControlService validation passed
wechatReplyService verification passed
httpService /api/v1/wechat route contract passed
wechat control verification passed
```

合计 56 个单测 + 既有契约验证 + 静态检查全过。

## 改动文件清单

修改（7）：
- electron/main.ts
- electron/preload.ts
- electron/services/dyqCloudTaskService.ts
- electron/services/messagePushService.ts
- electron/services/wechatControlService.ts
- src/App.tsx
- tests/dyq-cloud-task.test.cjs

新增（5）：
- electron/services/wechat/draftDecisionFilter.ts
- src/pages/SafetyConfirmPage.tsx
- src/pages/SafetyConfirmPage.scss
- tests/draft-decision-filter.test.cjs
- tests/safety-confirm-route.test.cjs

## 安全边界确认

- 真实发送仍走 NullBackend
- 审查链审查不接 ADB/WDA
- GUI confirmDraft 拒绝 auto_send 任务
- heartbeat extras 只读 metrics，无微信原文
- 不绕过平台风控：未改 replyBackend 选型
- W1 封板契约 684e8aa 未改
- 未强推
- 父主控预备要求"真实微信发送走人工确认队列"满足：listDrafts + confirmDraft/rejectDraft 三段门禁

## 完成度

- 切片 1~4 全部实现 + 单测 ✅
- typecheck 0 错误 ✅
- 既有测试 38+契约+verify 全过 ✅
- 工作区改动可解释 ✅
- 提交号：见 git log
