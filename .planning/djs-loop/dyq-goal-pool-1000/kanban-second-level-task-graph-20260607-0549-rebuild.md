# C/P/W/S 二级 Kanban 任务图重建记录（并发纠偏）

时间：2026-06-07 05:49:18 +0800
核验时间：2026-06-07 05:50 后
主控任务：t_f34d0b72
目标树：/root/paperclip-work/paperclip/doc/plans/2026-06-06-dyq-paperclip-goals-hermes-takeover.md
原始图：/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/kanban-second-level-task-graph-20260607-0409.md

## 结论

本次手动执行与 05:48 后台 r44 主控重建发生并发重叠。

权威可执行图不是本文最初创建的 7 张简化卡，而是 r44 已创建并派发的 10 张二级卡：

```text
t_f34d0b72 目标池总控（已完成）
├─ TC  t_76dcfaf8：C层后端 Claw C1/C2 运行态接口与设备治理闭环（dyq-claw-api，运行中）
│  ├─ TAPI t_e1d06efd：C1.1-C1.6 真接口契约（dyq-claw-api，运行中）
│  ├─ TDEV t_d3a551ca：设备治理/能力注册（dyq-claw-device）
│  ├─ TMQ  t_cc8e238c：MQ 解耦与任务状态回传（dyq-mq-infra）
│  ├─ TWEB t_c0cda541：Web 管理台可见验收（dyq-web-admin，运行中）
│  ├─ TP   t_268bac49：PokeClaw 端云任务与截图证据闭环（pokeclaw-agent，运行中）
│  └─ TW   t_047931ef：WeFlow 设备节点与安全草稿闭环（weflow-agent，运行中）
│      └─ TS12 t_d91a0d0c：社媒线索到 WeFlow 安全草稿与人工确认队列（social-agent，运行中）
├─ TS34 t_72a3badc：AI 客服、账号矩阵与设备绑定契约
└─ TQC  t_968faf75：C/P/W/S 覆盖率与真实闭环复核（待依赖完成）
```

## 并发产生但已归档的简化重复卡

以下 7 张简化重复卡均已归档，不作为执行入口：

- t_92e74ef8
- t_b4e6c6a2
- t_ceff0df7
- t_bf06cb78
- t_e30f0f97
- t_dada8d26
- t_2a67f011

## 当前执行口径

1. 后续只跟踪 r44 权威 10 卡，不再使用本轮简化 7 卡。
2. 权威图已经由 t_f34d0b72 的评论记录：05:48 数据库二次损坏恢复、孤儿 worker 自然消亡、10 张卡重建、24 个父子 link、48080 真接口验证。
3. 已核验到多张权威卡处于运行中：t_76dcfaf8、t_e1d06efd、t_c0cda541、t_268bac49、t_047931ef、t_d91a0d0c。
4. 后续主控/巡检应优先读取权威任务卡和 round43/round44 证据目录，避免重复派发。

## 关键验收口径保持不变

1. 每张执行卡必须输出：目标编号、真实产出、验证命令、证据路径、提交号或未提交原因、阻塞点。
2. 测试只是证据，不能替代业务可感知交付；必须说明用户/运营能看到什么。
3. C/P/W/S 不允许孤立交付：至少证明云端、端侧、前端或人工确认队列之一可见。
4. 真实外部触达全部默认人工确认；不得自动评论、私信、关注、点赞、真实微信发送。
5. 涉及 DYQ 后端必须遵守模块边界：跨模块优先 api/MQ，禁止跨模块 Service 强注入；DDL 幂等。
6. 前端验收必须尽量真浏览器；看不到菜单先查动态菜单权限，不把入口缺失误判为页面不存在。
