# 商业化闭环二阶段集成契约（X-INT-01 / r66）

> 目标：把 Claw 云端、PokeClaw、WeFlow、Web 管理后台四端约束成「同一条业务链」——
> 可并行开发、独立冒烟、但能跨端集成验收。
>
> 适用范围：r66 阶段，不替换现有大架构、不改云端核心入口。后续 C3-01/P3-01/W3-01/WEB3-01
> 与 QC3-01 都以此契约为参照。

---

## 1. 业务链一句话

**线索 / 草稿 / 任务三态** 在四端之间流动：社媒仓库只读采集 → 社媒只读控制台生成
**人工确认草稿** → 管理后台 `claw/device/{id}/execute` 写入云端任务表 → 云端 Claw
**Outbox → MQ → 设备节点拉取 / 心跳** → 端侧执行并按契约 **签名上报结果 / 事件** → 云端
**审计 + 反馈 MQ + 统计** → 管理后台可观察、运营可介入。

四端分别承担：

| 端 | 角色 | 主要交付 |
| --- | --- | --- |
| `dyq`（云端，端口 48080） | Claw 中枢、任务分配、审计、统计 | 接口契约、MQ 拓扑、表结构 |
| `PokeClaw`（Android 端侧） | 真机/模拟端，承接任务并按契约回传 | 端云冒烟脚本、状态卡 |
| `WeFlow`（Windows 微信托管） | 微信消息事件 + 安全草稿承接 | 设备节点契约、事件桥 |
| `ai-ui-admin-vue3aa`（Web） | 设备治理 + 任务下发 + 运营可观察 | 动态菜单、API 封装 |
| `social-media-web-automation`（社媒） | 线索采集 + 人工确认草稿（不入 MQ，仅产出种子） | 草稿生成器、统计字段 |

> 社媒仓库在本轮只承担「种子制造 + 人工确认队列」，不直接参与端云 MQ；社媒产物通过
> `claw/device/{id}/execute` 通用 command 下发，避免双写。

---

## 2. 接口契约（HTTP）

### 2.1 设备节点通用（云端 → 端侧）

云端统一用 `POST /claw/device/{deviceId}/execute` 下发 `command` + `mode`，端侧只
认 command 协议，不绑类型。`command` 取值集合由云端枚举，端侧按 `command` 选择能力。

| command | 方向 | 端侧 capability | 风险 | 安全边界 |
| --- | --- | --- | --- | --- |
| `wechat.message.prepare_text` | outbound | `wechat.message.prepare_text` | medium | 仅预填草稿，不发送；需 session 白名单 |
| `wechat.message.send_text` | outbound | `wechat.message.send_text` | high | 强制降级为人工确认草稿，**默认 externalSendAllowed=false** |
| `wechat.message.receive` | inbound | `wechat.message.receive` | low | 上报微信消息事件，**cloudReportOnly=true** |
| `pokeclaw.tool.execute` | outbound | `wechat.command.receipt`（契约名复用） | low | 真机执行需 ADB 在线；失败回传可重试 |
| `pokeclaw.health.snapshot` | inbound | `wechat.health.query`（契约名复用） | low | 心跳附带，无副作用 |

> 端侧能力表同时使用 `wechat.*` 命名族：PokeClaw 与 WeFlow 共用同一份 `capability`
> 集合，便于云端以 `command → capability` 单一映射做鉴权与降级判定。

### 2.2 云端 HTTP 端点（端口 48080）

冒烟脚本与四端共同遵守的端点集合：

| 端点 | 方法 | 鉴权 | 用途 | 已验证 |
| --- | --- | --- | --- | --- |
| `/admin-api/actuator/health` | GET | 无 | 健康总览 | ✅ r1–r3 连续 3 次 |
| `/api/claw-device/register` | POST | 无 | 设备首次注册 | ✅ r8 / r9 |
| `/api/claw-device/heartbeat` | POST | DeviceToken | 心跳 + 取 `pendingTaskCount` | ✅ r8 / r9 |
| `/api/claw-device/devices/{deviceId}/pending-tasks` | GET | DeviceToken | 拉取待执行任务 | ✅ r8 |
| `/api/claw-device/tasks/{taskUuid}/result` | POST | DeviceToken + 签名 | 任务结果回传 | ✅ r8 / r9 |
| `/api/claw-device/token/refresh` | POST | 无 | 令牌刷新 | ✅ r8 |
| `/claw/device/list` | GET | Admin | 设备分页 | ✅ r35 |
| `/claw/device/{id}/execute` | POST | Admin | 任务下发 | ✅ r20/r26 |
| `/claw/device/{id}/tasks` | GET | Admin | 任务历史 | ✅ r35 |
| `/claw/overview/dashboard` | GET | Admin | 三主线总览 | ✅ r37 |
| `/dyq/device-node/runtime-safety` | GET | 无 | 端侧安全契约查询 | ✅ r18 |

签名头（三端共用）：

```
X-Claw-Device-Id: <deviceId>
X-Claw-Timestamp: <unix_millis>
X-Claw-Nonce:     <random>
X-Claw-Signature: <hmac_sha256(secret, "{ts}\n{nonce}\n{body}")>
```

签名规则见 `dyq-module-claw/.../security/ClawDeviceSignatureFilter.java` 与
`PokeClaw/scripts/dyq3-endcloud-smoke.sh` 已对齐实现。

### 2.3 端侧 HTTP 端点（端内/端云间）

| 端 | 端点 | 用途 | 状态 |
| --- | --- | --- | --- |
| WeFlow | `GET /health` | 节点存活 | ✅ |
| WeFlow | `GET /listener/events` | 微信事件流 | ✅ |
| WeFlow | `POST /wechat/prepare-text` | 预填草稿 | ✅ r15 |
| WeFlow | `POST /dyq/device-node/command-result/preview` | 命令回执预览 | ✅ r15 |
| PokeClaw | `POST /api/claw-device/*`（云端） | 端云契约由云端决定 | ✅ r8 |

---

## 3. 事件流（云端 MQ 拓扑）

云端 MQ 拓扑在 `dyq-module-claw-api/.../constants/ClawMqConstants.java` 已固化，
本契约不重写命名，只约束**每条 MQ 链路的语义、payload 形态、消费者**。

| Exchange | Routing | Queue | 生产者 | 消费者 | 事件 payload 关键字段 |
| --- | --- | --- | --- | --- | --- |
| `dyq.claw.feedback.exchange` | `dyq.claw.feedback.collect` | `dyq.claw.feedback.collect.queue` | 端侧 result 桥接 | 反馈/统计 | `taskUuid`, `deviceId`, `status`, `evidenceUrls[]`, `modelUsed`, `executionTimeMs` |
| `dyq.claw.prm.exchange` | `dyq.claw.prm.evaluate` | `dyq.claw.prm.evaluate.queue` | result 接收后 | PRM 评估 Worker | `taskUuid`, `toolCalls[]`, `result` |
| `dyq.claw.prm.exchange` | `dyq.claw.prm.evaluate.dlq` | `dyq.claw.prm.evaluate.dlq.queue` | PRM 失败 | DLQ 监控 | 同上 + `errorCode` |
| `dyq.claw.evolution.exchange` | `dyq.claw.evolution.notify` | `dyq.claw.evolution.notify.queue` | PRM 评估通过 | 技能进化 Worker | `skillVersion`, `evidence[]` |
| `dyq.claw.training.exchange` | `dyq.claw.training.callback` | `dyq.claw.training.callback.queue` | Python 训练回调 | 训练管理 | `taskUuid`, `status`, `artifactUrl` |
| `dyq.claw.outbox.ack.exchange` | `dyq.claw.outbox.ack` | `dyq.claw.outbox.ack.queue` | 消费端处理成功后 | `ClawMqOutboxAckConsumer` 置 ACKED | `outboxId`, `consumerGroup` |
| `dyq.claw.outbox.ack.exchange` | `dyq.claw.outbox.ack.dlq` | `dyq.claw.outbox.ack.dlq.queue` | outbox 失败 | DLQ 监控 | 同上 + `errorCode` |

> **新增约束（r66 起）**：result → feedback 必须先过 outbox 模式，再由 ACK 通道
> 回写 ACKED；DLQ 出现必须由 `ClawOpsController` 暴露的运维接口可见。

事件 envelope（WeFlow 内部消费，**不**走云端 MQ）：

```json
{
  "schemaVersion": "2026-05-15",
  "eventType": "receive | sendResult | error",
  "eventId": "<stable sha256>",
  "nodeId": "weflow-local-winwechat-001",
  "occurredAt": "<iso8601>",
  "payload": { "direction": "inbound|outbound|internal", "capability": "...", "requestId": "...", "taskUuid": "..." }
}
```

该 envelope 用于 WeFlow 内部 `DyqEventBridge`，**不**直接投递到云端 MQ；WeFlow 通过
`submit_wechat_event_report` 把 envelope 翻译成 result 通道的 payload 再上行。

---

## 4. 数据表与字段（云端）

核心表已在 `dyq-module-claw/.../db/V20260512__claw_device_tables.sql` 和
`V20260522__claw_device_audit_log.sql` 固化。本契约只补充**集成所需的最小字段**：

| 表 | 关键字段 | 集成意义 |
| --- | --- | --- |
| `claw_device` | `device_id`, `public_key`, `device_token`, `status`, `current_task_id`, `skill_version`, `tenant_id` | 设备身份 + 鉴权 + 任务在飞状态 |
| `claw_device_task` | `task_uuid`, `command`, `mode`, `priority`, `source`, `status`, `result`, `evidence_urls`, `model_used`, `execution_time_ms`, `tool_calls`, `tenant_id` | 任务流转 + 端侧结果回写 |
| `claw_device_audit_log` | `device_id`, `action`, `result_code`, `request_id`, `signature`, `occurred_at` | 签名审计 + DLQ 追因 |

**业务链一致性规则**：

1. 一个 `claw_device_task` 同一时刻只能属于一个 `device_id`，不允许跨设备共享 `taskUuid`。
2. `evidence_urls[]` 必须是端侧可访问 URL（云端不落地原图，只存引用）。
3. `tool_calls` 是 JSON 数组，每条至少含 `name, args, result, started_at, ended_at`。
4. `result` 不允许写入真实账号密码 / 真实聊天原文，可写入「会话/消息结构化字段」；
   真实聊天内容由端侧把持（WeFlow 默认 `cloudReportOnly=true`）。
5. `tenant_id` 由管理后台登录后下发，与 `claw_device.tenant_id` 必须一致，否则视为
   跨租户越权并写 `claw_device_audit_log`。

> 上述规则为 r66 阶段约束；不引入 DDL 变更，仅在应用层校验与文档化。

---

## 5. 证据字段（端侧回传）

端侧回传 result 必须满足下列最小字段集合，云端据此判断是否写表 / 进 MQ / 进 DLQ：

```json
{
  "taskUuid": "uuid",
  "status": "SUCCESS | FAILED | RUNNING | CANCELLED",
  "result": "<string, 自由文本，长度 < 64KB>",
  "errorMessage": "<string, 可空>",
  "executionTimeMs": 12345,
  "toolCalls": [ { "name": "...", "args": {...}, "result": "...", "startedAt": "...", "endedAt": "..." } ],
  "evidenceUrls": [ "https://.../evidence-1.png" ],
  "modelUsed": "deepseek-v4pro | glm-5.1 | ..."
}
```

`status` 与端侧本地 `ClawDeviceTaskStatusEnum` 一一对应。

WeFlow 专有证据字段（**写 result 之前**由 `dyq_event_bridge` 注入 envelope）：

```json
{
  "wechat": {
    "sessionName": "...",
    "externalId": "...",
    "tags": ["source:xhs", "intent:high", "priority:high"],
    "lastMessage": "...",
    "intentScore": 0.92
  },
  "safety": {
    "externalActionAllowed": false,
    "requiresHumanConfirmation": true,
    "sendActionExecuted": false,
    "manualTakeoverRequired": true
  }
}
```

PokeClaw 专有证据字段（可选）：

```json
{
  "adb": { "deviceSerial": "...", "isOnline": true, "lastAdbAt": "..." },
  "ui":  { "screenshot": "https://.../ui.png", "ocr": "..." }
}
```

---

## 6. 集成级业务场景（端到端可演示）

下列 4 个场景是「跨端集成」的最小演示单元；每一项都对应一段**最小演示脚本**入口
（见 `demo/` 目录）。

### 场景 A：C1 主后端冒烟（健康 / register / heartbeat）

- 入口：`/root/paperclip-work/paperclip/scripts/c1_claw_device_smoke.py`
- 跨端：仅云端
- 验收：HTTP 200 + 业务码 0；输出 `summary.json`

### 场景 B：P1/PokeClaw 端云冒烟（Mock + 真实 48080）

- 入口：`/mnt/e/code/PokeClaw/scripts/dyq3-endcloud-smoke.sh`
- 跨端：云端 + PokeClaw 端侧契约
- 验收：register / heartbeat / pending / signed result 全链路
- 可选 `ADMIN_SEED_TASK=1` 触发管理后台任务下发

### 场景 C：W1/WeFlow 设备节点 + 安全草稿

- 入口：`/mnt/d/work/code/WeFlow/scripts/weflow-dyq-device-register.py` +
  `test_weflow_dyq_safe_draft.py`
- 跨端：云端 + WeFlow 端侧契约 + 事件桥
- 验收：register / heartbeat / admin execute / pending / safeDraft / signed result
- 安全边界：`externalActionAllowed=false`、`sendActionExecuted=false`

### 场景 D：S1/S2 社媒线索 → WeFlow 安全草稿

- 入口：`/mnt/d/work/code/social-media-web-automation/tests/weflow-lead-handoff.test.ts`
  + `live-room-lead-handoff.test.ts`
- 跨端：社媒 + 云端 + WeFlow
- 验收：社媒种子 → `claw/device/{id}/execute` 通用 command → pending → safeDraft → result
- 安全边界：仅生成草稿，**不**自动评论 / 私信 / 关注 / 点赞

> 场景 A–D 在 QC3-01 阶段由 `dyq-qc-e2e` 串成一条端到端验收脚本，本轮只固化契约。

---

## 7. 跨端一致性约束（硬红线）

下列红线四端必须共同遵守，违反任意一条即视为越权并写审计：

1. **不真实外发**：WeFlow 端云间任何回执，**禁止**写入真实微信原文 / 真实账号密码 /
   真实头像 / 真实手机号。
2. **不强推**：所有集成脚本只读 + 写本地 Paperclip 状态目录，不 push、不发远端 PR。
3. **不改大架构**：不替换 Claw 现有 `claw_device` 表 / `ClawDeviceService` /
   签名过滤器；本轮只新增/补充契约与脚本。
4. **任务唯一性**：`taskUuid` 由云端生成，跨端不可重新生成；同一任务 result 多次回传
   必须幂等（以 `taskUuid + status + executionTimeMs` 判重）。
5. **租户隔离**：跨租户越权访问 / 跨设备访问任务，云端返回 HTTP 403/401 且写
   `claw_device_audit_log`。
6. **MQ DLQ 必暴露**：PRM 评估 / Outbox ACK 两条 DLQ 必须在 `ClawOpsController`
   可见，否则视为集成未完成。
7. **人工确认优先**：所有 `wechat.message.send_text` 与 S1/S2 草稿必须经过人工确认
   队列，**禁止**直接 `success` 落库。

---

## 8. 风险与回滚

| 风险 | 影响 | 回滚 / 收敛手段 |
| --- | --- | --- |
| 端侧能力表 `wechat.*` 命名与真实微信 API 误用 | 端云字段歧义 | 命名仅作为契约 code，不与真实微信 HTTP API 字段绑定；端侧映射在 `dyq_device_node_contract.py` |
| 跨租户 `tenant_id` 漂移 | 任务串租户 | 应用层校验 + 审计表记录违规 |
| WeFlow `externalSendAllowed` 误改 true | 真实外发风险 | 本轮不开放任何写入路径；`runtime_safety_status` 接口声明强制 false |
| 任务重复回传 | MQ 重复消费 | 幂等键 `taskUuid+status+executionTimeMs` 在 result 服务层先查后写 |
| DLQ 增长不可见 | 集成失败无声 | `ClawOpsController` 暴露 DLQ 计数；`ACCEPTANCE_MATRIX` 第 7 行验收 |

---

## 9. 后续卡依赖关系（不在本轮执行）

| 卡 | 依赖本契约的条款 | 备注 |
| --- | --- | --- |
| C3-01 | §2 HTTP + §3 MQ + §4 表 | 任务编排 + MQ 解耦 |
| P3-01 | §2.1 端点 + §5 证据字段 | 端侧任务领取 + 截图证据 |
| W3-01 | §3 envelope + §5 WeFlow 字段 | 事件转任务 + 安全草稿队列 |
| WEB3-01 | §2.3 + §6 场景 D | 三端监控入口 |
| QC3-01 | §6 全场景 | 端到端验收矩阵 |

---

## 10. 结论

本契约为 r66 阶段「商业化闭环二阶段」的**唯一集成参照**。后续四张执行卡各自开发、
各自冒烟，但跨端集成时必须以本契约的接口字段、事件流、证据字段、安全边界为基准。
本轮不写任何业务代码、不动 DDL，只把现有四端能力凝成可被 5 个仓库同时消费的一张图。
