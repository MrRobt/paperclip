# r66 主控 cron 目标树自扩充

- 时间：2026-06-07 14:30 +0800
- 主控：my-profile
- 触发条件：r64 15/15 done；r65 看板稳态；主人"目标树自扩充规则"指令生效
- 基础设施现状亲核验：
  - 48080 LISTEN：java PID 1684310 10:59 启动，mvn 父 PID 1684215
  - dyq git HEAD：clean working tree（r53 提交已收口）
  - dyq-module-claw-biz maven repo jar：含 mainline-overview / goal-pool / device/list / summary 全套 controller（r58 修复后）
  - 5 探活：actuator/summary/login/device-list/mainline-overview/goal-pool 6/6 PASS 旁证
  - 多仓库 working tree：dyq/WeFlow/社媒/PokeClaw 全部干净

## 一、缺口分析（基于目标树 75 目标/393 问题现状）

| 维度 | 目标树现状 | 看板覆盖 | 缺口 |
|---|---|---|---|
| C1 阶段1（基础设施） | 6 子目标 | TC + TC-API + TC-DEV + TC-MQ 全 done | 闭环 |
| C2 阶段2（核心能力商业化） | 5 子目标 C2.1-C2.5 全 planned | **0 卡** | **缺口 5** |
| P1 阶段1（端云通信） | 5 子目标 | TP done | 闭环 |
| P2 阶段2（端侧任务执行） | 4 子目标 P2.1-P2.4 全 planned | **0 卡** | **缺口 4** |
| W1 阶段1（微信接入） | 4 子目标 | TW done | 闭环 |
| W2 阶段2（AI思考与安全回复） | 4 子目标 W2.1-W2.4 全 planned | **0 卡** | **缺口 4** |
| S 阶段2（截流）S2.1 关键词 | 1 子目标 | 0 卡 | 缺口 1 |
| S 阶段1（运营）S1.4 数据反馈 | 1 子目标 | 0 卡 | 缺口 1 |
| S 阶段3（商城）S3.1 上架 S3.2 定价 S3.4 售后 | 3 子目标 | S3.3 AI客服 done by TS34 | 缺口 3 |
| S 阶段4（养号）S4.3 原创发布 S4.4 风控 | 2 子目标 | 0 卡 | 缺口 2 |

## 二、本轮 r66 派发策略（克制原则：单轮 ≤ 6 卡）

按"泳道并发、泳道内串行、集成串行"原则，本轮 6 张卡覆盖 C2/P2/W2 三个垂直执行 + S 缺口 1 张 + 集成 1 张。所有卡都是真实业务接口/真页面/真设备可见闭环，不写空文档。

| 编号 | 标题 | 成员 | 父卡 | 业务价值 | 影响仓库 |
|---|---|---|---|---|---|
| r66-C2.1 | C2.1 云端任务编排状态机落库闭环 | dyq-claw-api | T0 | Claw 任务创建→分配→追踪→完成→回传 5 步 API | dyq-module-claw-biz |
| r66-C2.3 | C2.3 经验沉淀接口与证据包关联 | dyq-claw-api | T0 | 端云执行结果/错误/截图/日志入库 + 关联查询 | dyq-module-claw-biz |
| r66-P2.1 | P2.1 端侧任务领取与动作执行适配 | pokeclaw-agent | T0 | PokeClaw pending-tasks 真实领取 → 本地动作执行 | PokeClaw Android |
| r66-W2.2 | W2.2 GUI 安全发送与回执 | weflow-agent | T0 | WeFlow GUI 桌面运行标记 + 退出键真实执行 | WeFlow |
| r66-S1.4 | S1.4 数据反馈与内容优化 | social-agent | T0 | 自动化运营效果数据采集 + 内容优化建议 | 社媒 web automation |
| r66-INT-1 | r66 跨泳道集成 + 5 接口 QC 验证 | dyq-integrator | T0 | 6 张新卡收口后 5 接口验证 + 跨端联调验收 | paperclip-work + 各仓 |

## 三、验收口径（每张卡通用）

1. 改动文件可被 `git status --short` 列出
2. 真实接口 200 / 真实页面打开 / 真实设备运行（不接受 mock 自我闭环）
3. 证据落盘 `/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round66-*/`
4. IMPLEMENTATION_PLAN.md / RUN_LOG.md 状态更新
5. 安全边界：defaultSend=false / externalActionAllowed=false / requiresHumanConfirmation=true
6. 不重启 48080（如果必须重启 → 派独立 owner 卡，不在 r66 卡里做）

## 四、禁止事项

- 不强推 / 不删远端 / 不泄露密钥 / 不破坏系统盘
- 不真实外发微信/私信/评论（所有外部触达保持人工确认）
- 不绕过 48080 端口冲突（必须先 SIGTERM 旧 java 再 mvn install）
- 不批量清理未提交文件

## 五、下一步 r67 候选

- C2.2 设备节点治理 / C2.4 沙箱降级 / C2.5 MQ 解耦契约
- P2.2 截图证据 / P2.3 失败重试 / P2.4 多设备分发
- W2.1 安全审查链 / W2.3 会话摘要 / W2.4 私域转化
- S 阶段3 商城 S3.1/S3.2/S3.4 + S 阶段4 S4.3/S4.4
- AI 驱动与商业交付阶段

r66 收口后 r67 主控可继续按"缺口优先级"派下一批 6 张卡，2-3 轮内可把 75 目标全部覆盖到二级 Kanban。
