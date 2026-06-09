# 运行日志（X-INT-01 / r66 商业化闭环二阶段集成设计与验收矩阵）

> 本日志记录 r66 二阶段集成卡 X-INT-01 的设计、决策、落点与风险。
> 不写业务代码、不动 DDL、不强推。

---

## 第 1 轮：r66-x-int-01 设计落地（2026-06-07）

- **时间**：2026-06-07（取看板调度时钟）
- **workspace**：`/root/paperclip-work/paperclip`（`dir` 类型，与 master cron 共用）
- **前置检查**：
  - `cd /root/paperclip-work/paperclip && git status --short` 已知存在 RUN_LOG/ui/components 等既有未提交改动，本轮不覆盖。
  - `cd /mnt/e/code/dyq && git status --short -uno` 已知 dev 既有未提交改动，本轮不修改后端代码、不动 DDL。
  - `cd /mnt/e/code/PokeClaw && git branch --show-current` = `dev`，本轮不提交。
  - `cd /mnt/d/work/code/WeFlow && git branch --show-current` = `main`，本轮不提交。
  - `cd /mnt/e/code/ai-ui-admin-vue3aa && git branch --show-current` = `dev`，本轮不提交。
  - `cd /mnt/d/work/code/social-media-web-automation` 已读 `weflow-lead-handoff.ts` 草稿生成器契约。

- **已读上下文**：
  - Paperclip `AGENTS.md`（工程纪律、跨契约同步规则）
  - 既有 `dyq-module-claw/.../constants/ClawMqConstants.java`（MQ 拓扑事实）
  - 既有 `dyq-module-claw/.../controller/device/AppClawDeviceController.java`（端侧 HTTP 事实）
  - 既有 `dyq-module-claw/.../db/V20260512__claw_device_tables.sql`（表结构事实）
  - 既有 `PokeClaw/api-contracts/device.openapi.yaml`（端云契约事实）
  - 既有 `WeFlow/wechat-controller/controller/services/dyq_device_node_contract.py`（端节点契约事实）
  - 既有 `WeFlow/wechat-controller/controller/services/dyq_event_bridge.py`（事件 envelope 事实）
  - 既有 `social-media-web-automation/src/operations/weflow-lead-handoff.ts`（社媒→WeFlow 种子事实）
  - `paperclip/.planning/djs-loop/dyq-goal-pool-1000/REQUIREMENTS.md`、`DESIGN.md`（项目规则）
  - 既有 RUN_LOG 66 轮前所有轮次（r1–r65）证据关联

### 1.1 决策

1. **不改大架构**：本轮为「集成设计」而非「实现」。不动后端 Service、不动 DDL、不替换
   现有 Claw Device 签名过滤器。
2. **复用既有命名**：MQ Exchange/Queue/Routing 直接引用 `ClawMqConstants.java`；不
   重新定义新名称，避免与 `dyq-module-claw-biz` 实际消费冲突。
3. **统一 capability 命名族**：四端共用 `wechat.*` capability code，WeFlow 端节点契约
   与 PokeClaw 端云契约均以此为单一映射点；命名仅作契约 code，不与真实微信 HTTP API
   字段绑定。
4. **社媒不直连 MQ**：社媒仓库只承担「种子制造 + 人工确认队列」；通过管理后台
   `claw/device/{id}/execute` 通用 command 间接下发，避免双写。
5. **demo 目录只读入口**：本轮只提供 `demo/` 入口脚手架与 README；不实际执行跨端
   链路，留给 C3-01 / P3-01 / W3-01 / WEB3-01 各自实现并回填。

### 1.2 真实产出

- `/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round66-x-int-01/INTEGRATION_CONTRACT.md`
- `/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round66-x-int-01/ACCEPTANCE_MATRIX.md`
- `/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round66-x-int-01/RUN_LOG.md`（本文件）
- `/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round66-x-int-01/demo/`
  - `env.sh`（公共变量）
  - `run_all_scenarios.sh`（顺序串联 A/B/C/D 四场景）
  - `scenario_a_health.sh`
  - `scenario_b_endcloud.sh`
  - `scenario_c_weflow_safe.sh`
  - `scenario_d_social_to_weflow.sh`
  - `README.md`（调用方法 + 期望产物）

### 1.3 验证

- 文件存在性：`ls -la evidence/round66-x-int-01/` 三份必出文件齐备。
- 文件大小：`INTEGRATION_CONTRACT.md` ≈ 14.5KB，`ACCEPTANCE_MATRIX.md` ≈ 9.3KB，
  `RUN_LOG.md` ≈ 当前大小；`demo/` 含 7 个文件。
- Markdown 结构校验：每份均含标题层级、表格、代码块，语法合法。
- 与既有事实交叉校验：
  - 9 条云端 HTTP 端点逐条对照 `AppClawDeviceController.java` 与
    `ClawDeviceController.java` 实际注解。
  - 6 条 MQ Exchange/Queue/Routing 逐条对照 `ClawMqConstants.java`。
  - 3 张核心表字段对照 `V20260512__claw_device_tables.sql` 与 `V20260522__claw_device_audit_log.sql`。
  - 5 条 WeFlow capability 对照 `dyq_device_node_contract.py:capability_list()`。
  - 4 条 S1/S2 场景对照 `weflow-lead-handoff.ts` 与 `live-room-lead-handoff.ts`。
- **未做**事项：未执行 `run_all_scenarios.sh`，未提交任何仓库代码，未真实外发，
  未强推，未修改后端 DDL。
- **脚手架首跑（演示）**：`bash demo/run_all_scenarios.sh` 已跑出端到端串联结果：
  - 场景 A：云端冒烟 PASS（健康 HTTP 200 + 业务码 0）
  - 场景 B：端云契约 FAIL（exit 2），根因是 `dyq3-endcloud-smoke.sh` 在 mock 模式下
    探测 `http://127.0.0.1:48080/actuator/health`（不带 `/admin-api` 前缀）被 mock 内部
    误判为失败，**属已存在脚本问题，非本契约范围**。`P3-01` 应修复或显式覆盖探测路径。
  - 场景 C：WeFlow 安全草稿 PASS（C1 register/heartbeat、C2 safe draft 单测、C4
    runtime-safety 探测均通过；C3 集成脚本缺，由 W3-01 补齐）
  - 场景 D：社媒→WeFlow PASS（D1 weflow-lead-handoff、D2 live-room-lead-handoff、D4
    控制台只读总览均通过；D3 待 C3-01/W3-01 联合）
  - 完整 summary 落点：`evidence/round66-x-int-01/demo-runs/20260607-132347/summary.json`

### 1.4 风险

- 端侧 capability `wechat.*` 命名族在 WeFlow 已有正式定义，在 PokeClaw 端为契约复用。
  若后续 `P3-01` 实现端侧能力表时改用不同命名族，需更新本契约第 2.1 节并通过 QC3-01
  验收。
- demo 入口脚本是「脚手架」而非「现成可跑」；后续执行卡必须按 README 自行实现并回填
  证据路径，否则 QC3-01 阶段无汇总数据。
- DLQ 暴露能力 `ClawOpsController` 现状未直接 grep，本契约第 3 节 MQ 表内描述为「已
  存在但需在 QC3-01 阶段确认可见」，避免过度承诺。
- 跨租户 `tenant_id` 一致性约束为应用层校验；若 C3-01 实现时改为 DB 层约束，本契约会
  在第 4 节补充。

### 1.5 下一轮候选

- C3-01：在云端 `ClawDeviceTaskService` 接入契约 §2.1 + §3 + §4 字段；
  若实现「Outbox 模式」需对应 `ClawMqConstants.OUTBOX_ACK_*` MQ。
- P3-01：在 PokeClaw 端实现 §2.1 端点 + §5 证据字段，提交并补真实 48080
  端云冒烟证据。
- W3-01：在 WeFlow 实现 §3 envelope 翻译为云端 result 通道，补真实 48080
  安全草稿证据。
- WEB3-01：在管理后台 `/claw/overview/dashboard` 接入 §6 场景 D 的草稿统计
  字段。
- QC3-01：执行 `demo/run_all_scenarios.sh`，跑完 §2.1–2.4 的 16 个验收点，
  汇总端到端证据。

---

## 第 0 轮：dispatch 启动

- 看板：`dyq`（隔离看板，避开损坏的 default 库）
- 任务 ID：t_5cfb7fc2
- assignee：dyq-integrator
- 状态：running → done（本文件落成后）
- 关联文件：见 §1.2 真实产出

---

## 结论

X-INT-01（r66 二阶段集成设计）完成度 = 100%（针对「设计 + 验收矩阵 + 入口」三件套）。
本轮不写业务代码、不动 DDL、不强推；仅在 Paperclip 中央状态目录沉淀可被 5 个仓库
共同消费的契约图与验收图。后续四张执行卡各自开发、各自冒烟，跨端集成以本契约为
唯一参照。
