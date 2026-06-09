# 第42轮证据：W 层 WeFlow 设备节点/事件/安全闭环

- 时间：2026-06-07 05:54 +0800
- 任务：t_59fcdffb（W 层：WeFlow 设备节点、消息事件与安全草稿回复闭环）
- 父任务：t_b05b9bc0（C 主线状态总集）+ t_bd4d90a4（Kanban 二级任务图）
- 仓库：`/mnt/d/work/code/WeFlow` (main 分支)
- 改前 HEAD：684e8aa（W1 封板）
- 改后 HEAD：0b586fd
- 提交号：0b586fdadba980a621a5ae3c9b6d441cefed2e44

## 一、真实产出

1. **W1.3 设备节点能力注册**：`dyqCloudTaskService.ensureRegistered` body 增加 `deviceType='WEFLOW'` + `capabilities=['wechat-receive','wechat-send','wechat-image']`，与 48080 端设备表的 WEFLOW 节点契约对齐。
2. **W1.4 心跳携带微信事件计数**：`dyqCloudTaskService` 新增 `wechatEventCounters`（receiveCount / lastContactSession / lastContactSessionName / lastEnqueueAt），`heartbeat()` body.extras.wechat 上报；`messagePushService.pushSessionMessages` 在 enqueueMessage 成功后挂钩 `recordEnqueueEvent`。
3. **W2.1 草稿决策审查链**：`electron/services/wechat/draftDecisionFilter.ts` 新增（120 行），含默认黑/白名单关键词集合与 `applyDecisionFilter(request, text, options?)`；`wechatControlService.submitDecision` reply 分支接入审查链，黑名单命中强制 `prepare_only` 并写审计。
4. **W2.2 GUI 安全确认页**：`src/pages/SafetyConfirmPage.tsx`（218 行）+ `.scss`（197 行），`/safety/confirm` 路由注册；`wechatControl.listDrafts/confirmDraft/rejectDraft` 三个 IPC handler 接入；`confirmDraft` 对 `auto_send` 任务显式拒绝（强制走 GUI 真实按钮）。
5. **`wechatControlService.listReplyTasks`**：新增 W2.2 配套方法，默认过滤 sent/cancelled，按 updated_at 倒序，最多 200 条。

## 二、验证命令

```bash
# 静态检查
npm run typecheck
# → tsc --noEmit 无输出（0 错误）

# 既有测试
node tests/dyq-cloud-task.test.cjs
# → 38 passed 0 failed（含 W1.3+W1.4 新增 5 用例）

node tests/draft-decision-filter.test.cjs
# → 11 passed 0 failed（W2.1 审查链单元 + submitDecision 端到端）

node tests/safety-confirm-route.test.cjs
# → 7 passed 0 failed（W2.2 路由 / IPC / 页面三件套静态扫描）

node tests/httpService.wechat-routes.contract.cjs
# → passed（既有契约未破坏）

npm run wechat:control:verify
# → wechatControlService/wechatReplyService/httpService 全部通过
```

合计 **56 个单测 + 4 个既有验证命令全过**。

## 三、目标覆盖矩阵

| 目标 | 状态 | 证据 |
|---|---|---|
| W1.1 设备节点契约基础 | ✅ | 沿用 round39 封板（684e8aa） |
| W1.2 事件签名回传封装 | ✅ | 沿用 round39 封板 |
| W1.3 设备节点补 type/capabilities | ✅ | dyqCloudTaskService.ts ensureRegistered + 1 用例 |
| W1.4 心跳携带 wechat 计数/最近联系人 | ✅ | dyqCloudTaskService.ts heartbeat + 4 用例 |
| W2.1 AI 回复前安全审查链 | ✅ | draftDecisionFilter.ts + 11 用例 |
| W2.2 GUI 安全确认页 | ✅ | SafetyConfirmPage.tsx + 路由 + IPC + 7 用例 |
| W2.3 真实 backend 可插拔 | ⏸ | 留待后续（不属本轮分派） |
| W2.4 审计落盘 + HTTP 暴露 | ⏸ | 留待后续 |

## 四、硬红线确认

- 真实微信发送：wechatControlService 仍指向 NullWechatReplyBackend，sendText 仅产出 sent_unverified，evidence.verified=false
- auto_send 真实路径：仍未接真实 backend；GUI 端 confirmDraft 对 auto_send 任务显式拒绝
- 不自动键盘：SafetyConfirmPage 不调 ADB/WDA；仅展示 + 按钮门禁
- 不绕过平台风控：未改 replyBackend 选型，未动 messagePushService 的 risk 字段
- 不强推：本轮 commit 留在本地 main，未 push origin
- W1 封板契约：684e8aa 之后所有提交仅扩展 register body / heartbeat body，路径与签名契约不变
- 父主控预备要求"真实微信发送走人工确认队列"满足：listDrafts + confirmDraft/rejectDraft 三段门禁

## 五、未提交改动清点

```bash
$ git status --short
?? .planning/audit/runs/20260606-175500-weflow/
?? .planning/djs-loop/w1-1-message-safe-draft-mapping/
```

仅 2 个未跟踪 djs-loop 文档目录（沿用历史），全部可解释。

## 六、提交统计

```
$ git diff --name-status 684e8aa..0b586fd
A  .planning/djs-loop/w1w2-node-event-safety/DESIGN.md
A  .planning/djs-loop/w1w2-node-event-safety/EVIDENCE.md
A  .planning/djs-loop/w1w2-node-event-safety/GOAL.md
A  .planning/djs-loop/w1w2-node-event-safety/IMPLEMENTATION_PLAN.md
A  .planning/djs-loop/w1w2-node-event-safety/REQUIREMENTS.md
A  .planning/djs-loop/w1w2-node-event-safety/RUN_LOG.md
M  electron/main.ts                                (+44)
M  electron/preload.ts                             (+5)
M  electron/services/dyqCloudTaskService.ts        (+47 -? )
M  electron/services/messagePushService.ts         (+10)
A  electron/services/wechat/draftDecisionFilter.ts (+120)
M  electron/services/wechatControlService.ts       (+41)
M  src/App.tsx                                     (+2)
A  src/pages/SafetyConfirmPage.scss                (+197)
A  src/pages/SafetyConfirmPage.tsx                 (+218)
A  tests/draft-decision-filter.test.cjs            (+207)
M  tests/dyq-cloud-task.test.cjs                   (+69)
A  tests/safety-confirm-route.test.cjs             (+74)
```

18 文件改动，+1439 -5。
