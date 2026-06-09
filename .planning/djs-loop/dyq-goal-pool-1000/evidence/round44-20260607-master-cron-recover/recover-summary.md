# Round44 主控 DB 二次修复 + 任务图重派

时间：2026-06-07 05:48 +0800
触发：05:48 cron 主控检测到 default board db 二次 corruption
工具：hermes kanban

## 损坏证据
- `/root/.hermes/kanban.db`: 损坏 (sqlite integrity_check error 11)
- 备份旋转：.corrupt.20260607_054800.bak (与 054631/054632/054653 同字节 278528)

## 恢复步骤
1. 旋转损坏 db
2. `hermes kanban init` 重建 default board
3. 重建 10 张二级任务图
4. 24 个 link 操作
5. archive 7 张孤儿卡
6. 9 个 dispatcher spawn 的新 worker 派发到 t_76dcfaf8/t_e1d06efd/t_d3a551ca/t_cc8e238c/t_c0cda541/t_268bac49/t_047931ef/t_d91a0d0c/t_72a3badc
7. T0/t_f34d0b72 kanban_complete

## 任务图 ID
- T0 = t_f34d0b72 (主控, done)
- TC = t_76dcfaf8 (C层后端, dyq-claw-api, running)
- TC-API = t_e1d06efd (C1.1-C1.6 真接口契约, dyq-claw-api, running)
- TC-DEV = t_d3a551ca (C2.1-C2.5 设备治理, dyq-claw-device, running)
- TC-MQ = t_cc8e238c (MQ/Infra, dyq-mq-infra, running)
- TWEB = t_c0cda541 (前端三主线, dyq-web-admin, running)
- TP = t_268bac49 (P1/P2, pokeclaw-agent, running)
- TW = t_047931ef (W1/W2, weflow-agent, running)
- TS12 = t_d91a0d0c (S1/S2 社媒, social-agent, running)
- TS34 = t_72a3badc (S3.3/S4 AI 客服, social-agent, running)
- TQC = t_968faf75 (QC, dyq-qc-api, todo 等依赖)

## 当前孤儿 worker (7 个)
- 1593106 dyq-web-admin t_5fad3897 (旧 t_xxx 不存在)
- 1593108 weflow-agent t_59fcdffb
- 1602621 social-agent t_6ae23b41
- 1603255 dyq-claw-api t_d3ae9b1d
- 1603256 dyq-claw-device t_c7779586
- 1604081 social-agent t_65c58e5c
- 1573292 dyq-mq-infra t_9e936924

策略：自然消亡（按 kanban-orchestrator skill 指引，不要 kill -9 避免损坏 dispatcher state）。

## 新派发 worker (9 个)
- 1606774 my-profile t_f34d0b72 (T0 已被主控 kanban_complete)
- 1607175 dyq-claw-api t_76dcfaf8
- 1607176 dyq-claw-api t_e1d06efd
- 1607177 dyq-claw-device t_d3a551ca
- 1607178 dyq-mq-infra t_cc8e238c
- 1607179 dyq-web-admin t_c0cda541
- 1607180 pokeclaw-agent t_268bac49
- 1607181 weflow-agent t_047931ef
- 1607182 social-agent t_d91a0d0c
- 1607183 social-agent t_72a3badc

## 硬红线
- 未删除远端修改
- 未泄露密钥
- 未绕过平台风控
- 未触碰系统盘

## 目标树覆盖
- C1.1-C1.6 / C2.1-C2.5 → TC-API / TC-DEV
- P1.1-P1.5 / P2.1-P2.4 → TP
- W1.1-W1.4 / W2.1-W2.4 → TW
- S1.1-S1.3 / S2.1-S2.3 → TS12
- S3.3 / S4.1-S4.2 → TS34
- S1.4 / S2.4 / S3.1 / S3.2 / S3.4 / S4.3 / S4.4 → TQC 缺卡建议
