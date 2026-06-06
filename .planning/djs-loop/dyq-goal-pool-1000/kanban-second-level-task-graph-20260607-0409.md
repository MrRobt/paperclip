# C/P/W/S 二级 Kanban 任务图

时间：2026-06-07 04:09:13 +0800
主控任务：t_420d7d01
目标树：/root/paperclip-work/paperclip/doc/plans/2026-06-06-dyq-paperclip-goals-hermes-takeover.md
状态目录：/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000

## 结论

已把 75 个目标/393 个问题按 C/P/W/S 分层压缩成可执行二级任务图，并补齐 7 张 Kanban 子卡：6 张执行卡 + 1 张只读复核卡。

执行原则：
- C 层先保证云端中枢、设备治理、任务状态机和证据可见。
- P 层承接手机端侧执行、截图/页面树、结果回传。
- W 层承接个人微信消息托管、安全草稿、GUI 安全发送前置门禁。
- S 层只做商业场景可见闭环，所有外部触达先进入人工确认队列，不自动评论/私信/关注/点赞。
- 前端可视化和 QC 复核作为独立依赖节点，避免后端/端侧自称完成但运营不可见。

## 仓库状态预检

| 仓库 | 分支 | 已跟踪改动摘要 | 调度约束 |
|---|---|---|---|
| /mnt/e/code/dyq | dev | Claw statistics/device/test 相关改动 | 后端执行卡先辨认现有改动，不覆盖；启动 48080 前停旧 Java |
| /mnt/e/code/ai-ui-admin-vue3aa | dev | overview.ts/test 相关改动 | 前端卡先辨认现有改动，不覆盖；必须真浏览器验证 |
| /mnt/e/code/PokeClaw | dev | 无已跟踪改动 | 可推进 P 层，但不得伪装真机/ADB 证据 |
| /mnt/d/work/code/WeFlow | main | 无已跟踪改动 | 正确仓库；禁止使用旧 weflow-wechat-autopilot 作为默认目标 |
| /mnt/d/work/code/social-media-web-automation | main | 无已跟踪改动 | 仅只读采集到人工确认队列，不自动外发 |
| /root/paperclip-work/paperclip | dev | djs-loop状态文档与 UI 文件已有改动 | 本次只新增任务图文档，不覆盖既有文件 |

## 二级任务图

```text
t_420d7d01 目标池总控
├─ C后端 t_e1975f12：C1/C2 Claw运行态接口与设备治理闭环
│  ├─ 前端 t_39d72981：三主线/端侧运行状态管理后台可见验收
│  ├─ P端侧 t_8f7e2593：PokeClaw端云任务领取、执行结果与截图证据闭环
│  ├─ W端侧 t_fc571d76：WeFlow设备节点、消息事件与安全草稿回复闭环
│  │  └─ S运营截流 t_5e72dd88：社媒线索到WeFlow安全草稿与人工确认队列
│  └─ S商城养号 t_e69a429f：AI客服、账号矩阵与设备绑定契约
└─ QC t_24295c13：C/P/W/S覆盖率与真实闭环复核
   └─ 依赖全部执行卡完成后启动
```

## 子卡清单

| 层 | 卡号 | 标题 | 执行者 | 主仓库 | 覆盖目标编号 | 父依赖 |
|---|---|---|---|---|---|---|
| C | t_e1975f12 | C层后端：Claw云端中枢C1/C2运行态接口与设备治理闭环 | coder | /mnt/e/code/dyq | C1.1-C1.6, C2.1-C2.5 | t_420d7d01 |
| 可视化 | t_39d72981 | 前端：三主线/端侧运行状态管理后台可见验收 | fe-dev | /mnt/e/code/ai-ui-admin-vue3aa | C/W/P可视化 | t_420d7d01, t_e1975f12 |
| P | t_8f7e2593 | P层：PokeClaw端云任务领取、执行结果与截图证据闭环 | coder | /mnt/e/code/PokeClaw | P1.1-P1.5, P2.1-P2.4 | t_420d7d01, t_e1975f12 |
| W | t_fc571d76 | W层：WeFlow设备节点、消息事件与安全草稿回复闭环 | coder | /mnt/d/work/code/WeFlow | W1.1-W1.4, W2.1-W2.4 | t_420d7d01, t_e1975f12 |
| S1/S2 | t_5e72dd88 | S层运营/截流：社媒线索到WeFlow安全草稿与人工确认队列 | coder | /mnt/d/work/code/social-media-web-automation | S1.1-S1.3, S2.1-S2.3 | t_420d7d01, t_fc571d76 |
| S3/S4 | t_e69a429f | S层商城/养号：AI客服、账号矩阵与设备绑定契约 | coder | /mnt/e/code/dyq | S3.3, S4.1-S4.2 | t_420d7d01, t_e1975f12, t_8f7e2593 |
| QC | t_24295c13 | QC：C/P/W/S二级任务覆盖率与真实闭环复核 | qc-dev | scratch | 全部二级卡 | 全部执行卡 |

## 目标覆盖矩阵

| 分层 | 已派发目标 | 暂未单独派发但被卡覆盖的目标 |
|---|---|---|
| C | C1.1-C1.6、C2.1-C2.5 | C3/C4 由 C 后端卡输出后续缺卡建议，避免在 C1/C2 未稳定前空转 |
| P | P1.1-P1.5、P2.1-P2.4 | P3/P4 由 P 卡在端侧执行与证据闭环稳定后补二级卡 |
| W | W1.1-W1.4、W2.1-W2.4 | W3/W4 由 W 卡在消息/安全回复闭环稳定后补知识库/商业化卡 |
| S | S1.1-S1.3、S2.1-S2.3、S3.3、S4.1-S4.2 | S1.4、S2.4、S3.1/S3.2/S3.4、S4.3/S4.4 先纳入 QC 缺卡建议，等待基础链路闭环后补卡 |

## 关键验收口径

1. 每张执行卡必须输出：目标编号、真实产出、验证命令、证据路径、提交号或未提交原因、阻塞点。
2. 测试只是证据，不能替代业务可感知交付；必须说明用户/运营能看到什么。
3. C/P/W/S 不允许孤立交付：至少证明云端、端侧、前端或人工确认队列之一可见。
4. 真实外部触达全部默认人工确认；不得自动评论、私信、关注、点赞、真实微信发送。
5. 涉及 DYQ 后端必须遵守模块边界：跨模块优先 api/MQ，禁止跨模块 Service 强注入；DDL 幂等。
6. 前端验收必须尽量真浏览器；看不到菜单先查动态菜单权限，不把入口缺失误判为页面不存在。

## 本轮未直接编码说明

本任务职责是主控拆解与路由，不直接编码。已完成读取目标树、读取项目规则和状态、生成二级任务图、创建 Kanban 子任务。
---

## r44 状态：2026-06-07 05:48 +0800 主控 DB 二次修复后重建

恢复过程见 `/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round44-20260607-master-cron-recover/recover-summary.md`。

任务 ID 映射（用 r44 替换 r40 损坏的 ID）：
| 角色 | r40 ID (已损坏) | r44 ID (本次) | 状态 |
|---|---|---|---|
| T0 主控 | t_bd4d90a4 (旧 done) | t_f34d0b72 | done |
| TC C 后端 | t_b05b9bc0 (旧 running) | t_76dcfaf8 | running |
| TWEB 前端 | t_5fad3897 (旧 todo) | t_c0cda541 | running |
| TP PokeClaw | t_7ddad685 (旧 todo) | t_268bac49 | running |
| TW WeFlow | t_59fcdffb (旧 todo) | t_047931ef | running |
| TS12 社媒 | t_e474c389 (旧 todo) | t_d91a0d0c | running |
| TS34 商城 | t_65c58e5c (旧 todo) | t_72a3badc | running |
| TQC QC | t_33551fd0 (旧 todo) | t_968faf75 | todo (等依赖) |
| TC-API | t_d3ae9b1d (旧 running) | t_e1d06efd | running |
| TC-DEV | t_c7779586 (旧 running) | t_d3a551ca | running |
| TC-MQ | t_9e936924 (旧 running) | t_cc8e238c | running |
