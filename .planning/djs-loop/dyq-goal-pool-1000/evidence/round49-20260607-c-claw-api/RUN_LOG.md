STATUS: IN_PROGRESS (r49 立即 handoff - 30s close)

# r49 立即 handoff — C1.1-C1.6 接口契约已就位 / 不再开 mvn 工具链

[2026-06-07 07:46 +0800] r49 TC-API 子卡 t_e1d06efd 立即 handoff：

## 本卡完成情况

C1.1-C1.6 mainline-overview / device/list / summary 接口契约已在 r48 由父卡 t_76dcfaf8 写完并落 evidence/round48-20260607-c-claw/CHANGED_FILES.txt，本卡 scope 与父卡 100% 重叠（同样 4 个端点 + 同样 2 个 Service）。本卡 readonly 复核工作区确认契约就位：

- ClawStatisticsController 路由 /admin-api/claw/statistics/mainline-overview 与 /summary 已 stub
- ClawStatisticsService.getMainlineOverview() / getStatisticsSummary() 签名 + 主体实现（575 行扩展）已写，读 POKECLAW_OPERATOR_STATUS_PATH → operator-status.json
- ClawDeviceController /admin-api/claw/device/list 与 /admin-api/claw/device/{id}/tasks 路由已 stub
- ClawDeviceService.listDevices / page / dispatchTask / heartbeat / reportResult / pendingTask / resultCallback 签名 + 实现已写
- ClawStatisticsServiceTest（pokeclaw/weflow/summary 多场景）+ ClawDeviceServiceTest（register/heartbeat/result 路径）+ ClawAdminControllerPathPrefixTest 三个单测骨架就位
- ClawDeviceTaskStatusEnum 状态机 pending/running/success/fail/timeout/offline 已对齐
- ClawDeviceProperties / ClawMqConstants / ClawEventPublisher / 3 Mapper / 1 DO / ErrorCode 同步

## 阻塞（不属本卡 scope）

mvn 工具链反复 95+ 分钟受 csMessageServiceImpl webSocketHandler BeanNotOfRequiredTypeException 阻塞（属 dyq-module-cs-conversation owner，不在本卡 scope），加 dyq-module-accountmarket-biz 缺 AccountMarketSocialDeviceBindTypeEnum/StatusEnum 编译失败。父卡 r49 已确认，本卡不再开 mvn 工具链、不再启 48080、不再动 csMessageServiceImpl。

## 验证状态

- mvn -pl dyq-server test：本轮不开（父卡已 5 次重申；本卡同样遵守）
- curl 48080 mainline-overview / device/list / summary：未跑（48080 进程未正常启动）
- 真实设备列表 ≥ 1 台：已 stub 至少 1 台 mock（test 内覆盖）

## 改动文件清单

完整 15 文件列表与 diff 概要落在父卡 evidence：/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round48-20260607-c-claw/CHANGED_FILES.txt
本卡不再冗余复制（与父卡完全重叠）。

## 提交号

**未提交**。原因：mvn 工具链反复阻塞、48080 未 LISTEN、csMessageServiceImpl 根因不在本卡 scope；按主控 r49 硬红线"不推、不动 dyq git、不重启 48080、不修 csMessageServiceImpl"。

## 下一步

主控/owner 把 csMessageServiceImpl 注入与 accountmarket 两个 enum 解决后，本卡对应端点可被新 worker 在 r50+ 重启 mvn -pl dyq-server test 并 curl /admin-api/claw/statistics/mainline-overview 完成验收。
