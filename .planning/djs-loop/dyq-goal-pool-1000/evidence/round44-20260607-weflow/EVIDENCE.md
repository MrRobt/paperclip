# EVIDENCE — W层设备节点/事件/安全闭环

时间：2026-06-07
状态：STATUS: COMPLETE

## 验证命令

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 退出 0，0 错误 |
| `npm test` | 71 用例全过：dyq-cloud-task(38) + draft-decision-filter(11) + safety-confirm-route(7) + dyq-cloud-http-error(15) |
| `node tests/dyq-cloud-http-error.test.cjs` | 15/15 通过 |

## 切片证据

### 切片 1：W1.4 心跳携带 wechatReceiveCount + lastContactSession ✅
- `electron/services/dyqCloudTaskService.ts`：
  - `wechatEventCounters` 接口（receiveCount / lastContactSession / lastContactSessionName / lastEnqueueAt）
  - `recordEnqueueEvent(payload)` 累加计数
  - `resetWechatEventCounters()` 清零
  - heartbeat body.extras.wechat = { receiveCount, lastContactSession, lastContactSessionName, lastEnqueueAt }
- `electron/services/messagePushService.ts`：enqueueMessage 成功后调 `recordEnqueueEvent`
- 单测：W1.4 wechatEventCounters 与 heartbeat 携带（4 用例）✅

### 切片 2：W1.3 设备注册补 deviceType/capabilities ✅
- `dyqCloudTaskService.ts` ensureRegistered body：
  - `deviceType: 'WEFLOW'`
  - `capabilities: ['wechat-receive', 'wechat-send', 'wechat-image']`
- 单测：register body 携带 deviceType=WEFLOW 与 3 个 capabilities（1 用例）✅

### 切片 3：W2.1 草稿审查链 ✅
- `electron/services/wechat/draftDecisionFilter.ts`：
  - `applyDecisionFilter(request, replyText, options)` 返回 { decision, mode, reason, matchedBlacklist, matchedWhitelist, blocked }
  - 黑名单：代付/充值/银行卡/验证码/中奖/兼职/刷单/转账
  - 白名单：谢谢/收到/好的/已确认/明白/了解/没问题
  - 黑+白同时命中 → 取严（强制 prepare_only）
- `wechatControlService.ts` submitDecision 走 filter 并记录 wechatAudit
- 单测：4 类场景 + 端到端 submitDecision（11 用例）✅

### 切片 4：W2.2 GUI 安全确认页 ✅
- `src/pages/SafetyConfirmPage.tsx`（218 行）：草稿列表 + 确认/拒绝按钮
- `src/App.tsx` 注册路由 `/safety/confirm`
- `electron/preload.ts` 暴露 `wechatControl.listDrafts/confirmDraft/rejectDraft`
- `electron/main.ts` 注册 3 个 IPC handler：
  - `wechatControl:listDrafts` 调 `wechatControlService.listReplyTasks`
  - `wechatControl:confirmDraft` 调 `wechatControlService.getReplyTask`，门禁：auto_send 任务不通过 GUI 门禁（`ACTION_IN_PROGRESS` 错误）
  - `wechatControl:rejectDraft` 记录 reject_via_gui 审计
- 单测：路由 + IPC + 页面三件套（7 用例）✅

### 切片 5：W2 阶段真实后端 401/异常处理封装 ✅
- `electron/services/dyqCloudTaskService.ts` 顶部新增：
  - `DyqCloudHttpError` 类（kind / status / path / upstreamCode/msg / retryable）
  - `classifyHttpError(status, path, upstreamCode?, upstreamMsg?, cause?)` 返回 `DyqCloudHttpError`
  - 6 种 kind：`unauthorized` (401) / `forbidden` (403) / `server` (5xx) / `network` (status=0) / `client` (4xx) / `unknown`
  - `request()` 改写：网络异常 → classifyHttpError(0,...) / 4xx5xx → classifyHttpError(status,...) / JSON 解析失败 → server / 业务 code 非 0/200 → server
  - `handleCloudHttpError(err)`：401/403 清空 tokenState（下一轮 ensureRegistered 走重注册）；其他保留 tokenState
  - `tick()` 优先用 `err.toStatusMessage()` 保留 [kind] 分类标签
- 单测（15 用例）✅：
  - 401 → kind=unauthorized + 清空 tokenState + retryable=false
  - 403 → kind=forbidden + 清空 tokenState
  - 5xx（500/502/503/504）→ kind=server + retryable=true + tokenState 保留
  - 4xx（400/404/422）→ kind=client + tokenState 保留
  - 网络异常（status=0 + cause）→ kind=network + retryable=true
  - 业务 code=5000 → server 类 + upstreamCode/msg
  - 非 JSON 响应 → server 类 + invalid json 上游消息
  - tick() 端到端：401 后 status=error + lastError=[unauthorized] + tokenState 清空；下次 tick 自动重新注册 + heartbeat 成功 → status=idle + lastError 清空

## 安全边界验收

- externalSendAllowed=false ✅（main.ts confirmDraft 拒绝 auto_send；GUI 仅 confirmDraft IPC；真实发送仍由 NullBackend 决定）
- sendActionExecuted=false ✅（draftDecisionFilter 黑名单强制 prepare_only；auto_send 仅白名单放行）
- cloudReportOnly=true ✅（heartbeat 只携带 wechat 计数/最近联系人，不携带微信原文）

## 改动文件清单

```
electron/services/dyqCloudTaskService.ts      +118 -10  (DyqCloudHttpError + classifyHttpError + request() 改写 + handleCloudHttpError + tick() 升级)
electron/services/messagePushService.ts        +10  -0  (recordEnqueueEvent 调用)
electron/services/wechatControlService.ts     +35  -0  (applyDecisionFilter 集成)
electron/services/wechat/draftDecisionFilter.ts 新 (120 行)
electron/main.ts                              +44  -0  (listDrafts/confirmDraft/rejectDraft IPC handler)
electron/preload.ts                            +5  -0  (wechatControl 三接口)
src/App.tsx                                    +2  -0  (SafetyConfirmPage 路由)
src/pages/SafetyConfirmPage.tsx                新 (218 行)
src/pages/SafetyConfirmPage.scss               新 (样式)
tests/dyq-cloud-task.test.cjs                 +69  -0  (heartbeat 计数 + deviceType/capabilities 5 用例)
tests/draft-decision-filter.test.cjs           新 (11 用例)
tests/safety-confirm-route.test.cjs            新 (7 用例)
tests/dyq-cloud-http-error.test.cjs            新 (15 用例)
package.json                                   +1  -0  (test 脚本)
```

## 提交号

- 本轮 commit：`614cedc feat(W2.5): 真实后端 401/异常处理封装与 15 用例单测`
- 前置 commit：`0b586fd feat(W1W2): 设备节点能力/微信心跳计数/草稿审查链/GUI安全确认`
- W1 验收基线：`684e8aa feat(W1验收): 汇总W1.1~W1.4基线证据包`
