# TC-DEV 2: C2.1-C2.5 设备治理闭环

## 目标
聚焦 C2.1-C2.5 设备治理闭环：
- 设备 register / heartbeat / pending task / result callback
- 任务状态机（pending → running → success/fail/timeout/offline）
- 设备上下线治理

## 范围
本轮聚焦 **当前闭环的空白点**：
1. 枚举缺 OFFLINE / TIMEOUT 两个终态
2. Service 缺 markOfflineDevices（心跳超时批量下线）/ timeoutStaleTasks（ASSIGNED/RUNNING 超时关单）两个核心方法
3. 缺定时任务驱动：ClawDeviceOfflineJob + ClawDeviceTaskTimeoutJob
4. 测试覆盖需要补这俩新方法的单测
5. mvn -pl dyq-server test 通过；curl /admin-api/claw/device/list 至少 1 台

## 已有基础（不动）
- ClawDeviceServiceImpl.register / heartbeat / refreshToken / createTask / getPendingTasks / submitTaskResult 已完整
- ClawDeviceMapper.selectOfflineCandidates + batchOffline 已实现
- ClawDeviceTaskMapper.revertAssignedTasksOfOfflineDevices 已实现
- ClawDeviceController 已有 /claw/device/list / {deviceId} / {deviceId}/execute / {deviceId}/tasks / {deviceId}/status 五个端点

## 不做（避免 scope creep）
- 不重做 register/heartbeat 接口契约
- 不重做经验包自动沉淀（已实现且有测）
- 不补技能同步（Phase 2）
- 不做 E2E 浏览器验收（本轮做后端闭环 + 单测 + curl）
