# Round44 TS34 商城养号契约草案（r44 索引）

- 任务卡：t_72a3badc
- 任务图定位：r44 重建后 TS34 商城养号（S3.3 / S4.1-S4.2）
- 主仓库：/mnt/e/code/dyq
- 分支：dev
- 时间：2026-06-07 +0800
- 主控：social-agent
- 协同：weflow-agent（W 端）、coder（C 后端卡 t_76dcfaf8）、fe-dev（前端卡 t_c0cda541）、PokeClaw（端卡 t_268bac49）

## 1. 本轮交付

| 子目标 | 草案文档 | Java 契约（claw-api/market） | 编译验证 |
|---|---|---|---|
| S3.3 AI 客服 | S3.3-ai-customer-service-contract.md | `ClawAiCustomerServiceApi` + 3 DTO | mvn -pl dyq-module-claw/dyq-module-claw-api -am compile |
| S4.1 账号矩阵与设备绑定 | S4.1-account-matrix-contract.md | `ClawAccountMatrixApi` + `ClawDeviceBindingApi` + 4 DTO | 同上 |
| S4.2 养号行为脚本库 | S4.2-farm-script-contract.md | 无新增（云端契约由 PokeClaw 卡协调） | — |

## 2. 关键约束

1. **只做草案/人工确认**：本轮不写 `@Service` 实现，不建 cs 模块，不动 DB，不改 MQ。
2. **落点说明**：cs 模块当前不存在，草案暂存 `dyq-module-claw/dyq-module-claw-api/.../api/market/` 子包，主人审查后再决定迁入。
3. **mvn -pl dyq-server test 全通过**：本轮只新增 -api 契约（不参与运行时装配），不会破坏 dyq-server test；保守起见同时跑 `mvn -pl dyq-module-claw-api -am compile` 验证。
4. **并行边界**：本卡只新增 10 个文件，全部在 `dyq-module-claw/dyq-module-claw-api/src/main/java/.../api/market/` 下，**不重叠** coder 卡（t_76dcfaf8）的 9 个文件，也**不重叠** dyq 子任务 t_e1d06efd / t_d3a551ca / t_cc8e238c 的工作区。
5. **安全边界**：所有外部触达保持人工确认（`requiresHumanConfirmation=true` / `sendActionExecuted=false`）。

## 3. 文件清单（绝对路径）

### Java 契约
- /mnt/e/code/dyq/dyq-module-claw/dyq-module-claw-api/src/main/java/com/douyouqu/dyq/module/claw/api/market/ClawAiCustomerServiceApi.java
- /mnt/e/code/dyq/dyq-module-claw/dyq-module-claw-api/src/main/java/com/douyouqu/dyq/module/claw/api/market/ClawAccountMatrixApi.java
- /mnt/e/code/dyq/dyq-module-claw/dyq-module-claw-api/src/main/java/com/douyouqu/dyq/module/claw/api/market/ClawDeviceBindingApi.java
- /mnt/e/code/dyq/dyq-module-claw/dyq-module-claw-api/src/main/java/com/douyouqu/dyq/module/claw/api/market/dto/AiCustomerServiceMessageDTO.java
- /mnt/e/code/dyq/dyq-module-claw/dyq-module-claw-api/src/main/java/com/douyouqu/dyq/module/claw/api/market/dto/AiSuggestionDTO.java
- /mnt/e/code/dyq/dyq-module-claw/dyq-module-claw-api/src/main/java/com/douyouqu/dyq/module/claw/api/market/dto/HumanTakeoverReqDTO.java
- /mnt/e/code/dyq/dyq-module-claw/dyq-module-claw-api/src/main/java/com/douyouqu/dyq/module/claw/api/market/dto/AccountMatrixDTO.java
- /mnt/e/code/dyq/dyq-module-claw/dyq-module-claw-api/src/main/java/com/douyouqu/dyq/module/claw/api/market/dto/AccountBindingReqDTO.java
- /mnt/e/code/dyq/dyq-module-claw/dyq-module-claw-api/src/main/java/com/douyouqu/dyq/module/claw/api/market/dto/DeviceBindingDTO.java
- /mnt/e/code/dyq/dyq-module-claw/dyq-module-claw-api/src/main/java/com/douyouqu/dyq/module/claw/api/market/dto/BindingRiskStateDTO.java

### 证据 / 草案文档
- /root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round44-20260607-s3-s4/README.md（本文件）
- /root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round44-20260607-s3-s4/S3.3-ai-customer-service-contract.md
- /root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round44-20260607-s3-s4/S4.1-account-matrix-contract.md
- /root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round44-20260607-s3-s4/S4.2-farm-script-contract.md
- /root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round44-20260607-s3-s4/mvn-compile-result.txt（待 mvn 跑完后回填）

## 4. 验证口径

- 至少 1 个新接口契约（AI 客服或设备绑定）✅（实际 3 个：AI 客服、账号矩阵、设备绑定）
- mvn -pl dyq-server test 全通过：本轮只改 -api；为保险同时验证 `mvn -pl dyq-module-claw-api -am compile`
- 默认只做草案/人工确认：✅ 无 @Service 实现

## 5. 与 r44 协同方的对接

| 角色 | 卡号 | 期望对接 |
|---|---|---|
| C 后端 | t_76dcfaf8 | 按本草案补 `@Service` 实现 + 单测；从 `ingestWechatMessage` 或 `getAccountWithTasks` 起步 |
| 前端 | t_c0cda541 | 按 `getAccountWithTasks` 实现"按账号看任务"页签；按 S3.3 实现客服工作台 |
| P 端侧 | t_268bac49 | 端侧动作序列引擎实现；按 S4.2 与云端契约对齐 |
| W 端侧 | t_047931ef | WeFlow 微信消息 → CS 入会的 `ingestWechatMessage` 调用方 |
| QC | t_968faf75 | 依赖全部执行卡完成后再启动 |
