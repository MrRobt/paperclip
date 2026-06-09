# REQUIREMENTS — W层设备节点/事件/安全闭环

更新时间：2026-06-07

## 一、范围

按主控预备分派，本轮聚焦 W1.3 / W1.4 / W2.1 / W2.2 四块，每块按 djs-loop 切片独立验收。W1.1 / W1.2 已在 round39 封板，本轮不动。

## 二、目标层需求

| 编号 | 描述 | 验收口径 |
|---|---|---|
| REQ-W1.3-1 | WeFlow 注册到 48080 设备表时携带 deviceType=WEFLOW | 单测断言 register body.deviceType |
| REQ-W1.3-2 | register body.capabilities 含 ["wechat-receive","wechat-send","wechat-image"] | 单测断言 capabilities 数组 |
| REQ-W1.4-1 | heartbeat body 携带 wechatReceiveCount（int） | 单测断言 |
| REQ-W1.4-2 | heartbeat body 携带 lastContactSession（string|null） | 单测断言 |
| REQ-W1.4-3 | heartbeat 周期 poll 内 wechatReceiveCount 反映本周期 enqueueMessage 次数 | 单测用 mock service 推 3 条消息后断言 |
| REQ-W2.1-1 | 黑/白名单审查链存在 | 新增 src 文件 wechat/draftDecisionFilter.ts 导出审查函数 |
| REQ-W2.1-2 | submitDecision 走审查链，黑名单关键词命中时强制 prepare_only | 单测断言返回 mode 改写 |
| REQ-W2.1-3 | 白名单关键词命中时允许 auto_send | 单测断言 |
| REQ-W2.2-1 | GUI 安全确认页存在 | 新增 src/pages/SafetyConfirmPage.tsx 并注册到路由 |
| REQ-W2.2-2 | 安全确认页可读 inbox 草稿列表 | 通过 IPC 拿 wechatControlService 的 inbox 数据 |
| REQ-W2.2-3 | 真实发送按钮调用 confirmSend IPC，禁止自动键盘 | preload.ts 暴露 wechatController.confirmSend |

## 三、边界

- 不做：真实微信发送接通（auto_send 仍然走 NullBackend）
- 不做：ADB / WDA 集成
- 不做：黑/白名单持久化 UI（先用代码常量 + ConfigService 读取）
- 不做：GUI 桌面运行标记改造（已在 round18 封板）

## 四、依赖

- 后端 48080 设备表存在（round41 已封板）
- wechatControlService 已存在并被 V1 验证（wechat:control:verify 通过）
- messagePushService 调用 enqueueMessage 钩子存在

## 五、风险

- 父主控预备里"主后端 48080 主线 weflow:pending"依赖本轮 W1.3+W1.4 完成；本轮在本仓 WeFlow 侧完成可观察证据，48080 端状态变化属后续 round
- 真机 WSL 不可验：必须用 mock backend 测

## 六、验收

- `node tests/dyq-cloud-task.test.cjs` 全过
- `npm run typecheck` 退出 0
- `npm run wechat:control:verify` 退出 0
- 提交号或提交前变更清点（不强推）
- evidence 落 round42
