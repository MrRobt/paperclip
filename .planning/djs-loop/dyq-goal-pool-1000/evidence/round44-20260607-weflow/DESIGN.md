# DESIGN — W层设备节点/事件/安全闭环

更新时间：2026-06-07
执行人：小黑（weflow-agent，djs-loop 二级卡）

## 一、链路总览

```
[1] 微信数据库变化（chatService.getNewMessages）
        ↓ messagePushService.pushSessionMessages
[2] wechatControlService.enqueueMessage
        ↓ （新增）dyqCloudTaskService.recordEnqueueEvent
[3] dyqCloudTaskService 心跳
        ↓ POST /api/claw-device/heartbeat
        ↓ body = {batteryLevel, networkType, wechatReceiveCount, lastContactSession, lastEnqueueAt, ...}
[4] 48080 主后端
        ↓ /admin-api/claw/device/{id}/tasks
        ↓ /admin-api/claw/statistics/mainline-overview -> weflow:status=normal

[5] W2.1 决策审查链
   wechatControlService.submitDecision
        ↓ draftDecisionFilter.apply
        ↓ 黑/白名单匹配
        ↓ 强制 prepare_only / 放行 auto_send
        ↓ 走原本后端 reply backend

[6] W2.2 GUI 安全确认页
   /safety/confirm 路由
        ↓ IPC 拉 inbox
        ↓ 用户点击"确认发送"
        ↓ IPC 调 wechatController.confirmSend
        ↓ 真实发送门禁由 WDA/ADB 触发（不在本轮）
```

## 二、关键文件定位

- `electron/services/dyqCloudTaskService.ts`：心跳/注册，加 wechatEventCounters 字段
- `electron/services/messagePushService.ts`：在 enqueueMessage 后调 recordEnqueueEvent
- `electron/services/wechatControlService.ts`：submitDecision 走 filter
- `electron/services/wechat/draftDecisionFilter.ts`（新）：审查链
- `src/pages/SafetyConfirmPage.tsx`（新）：GUI 安全确认页
- `src/App.tsx`：注册路由

## 三、安全边界

- 真实发送仍走 NullBackend；auto_send 改写为 prepare_only 不影响真发
- 心跳 extras 是只读 metrics，不携带微信原文
- GUI 页面仅展示与门禁，不接 ADB/WDA
- 黑/白名单关键词在审查链内集中维护，审计走 wechatAuditService

## 四、与 W1 封板契约的关系

- W1.3 设备节点契约（efbcae3）已稳定，本轮只扩 body 字段，不改路径
- W1.4 心跳契约（ae9bbe0）已稳定，本轮只扩 body.extras，不改路径
- W1.1~W1.2 验收（684e8aa）不重跑，状态保持
