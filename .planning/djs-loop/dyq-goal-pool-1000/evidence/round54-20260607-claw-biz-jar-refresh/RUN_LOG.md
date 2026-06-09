# RUN_LOG — r54 dyq-module-claw-biz maven repo jar refresh

任务：t_ce2d7705 【env-blocker-2】dyq-module-claw-biz maven repo jar 旧版本不含 mainline-overview 路由
run id：22
worker pid：1677485
时间窗口：2026-06-07 09:04 → 10:09 +0800
工作目录：/mnt/e/code/dyq（dev 分支）
maven repo：/mnt/d/apache-maven-3.6.3-bin/repo
应用：dyq-server :48080

## 时间戳日志

| 步骤 | 动作 | 时间戳 | 结果 |
|---|---|---|---|
| 1 | 接收 kanban 派发（r53 入口） | 09:04 | 任务进入 running |
| 2 | 接到 r53 主控路径派发（kill→install→restart→5 探测） | 09:04 | 完整 root cause + 5 步执行清单下发 |
| 3 | r54 第一次 worker（pid 1671628）跑 30min 卡在 .planning 调研 | 09:04-09:35 | 主控 force reclaim 关闭 run 20 |
| 4 | r54 第二次 worker（pid 1672935）派发 | 09:35 | 跑 -DskipTests 被父 pom <skipTests>false</skipTests> 字面量覆盖 |
| 5 | 切到 -Dmaven.test.skip=true 绕过 test 编译/运行 | 09:42 | 强跳 test compile + test run |
| 6 | mvn install -pl dyq-module-claw/dyq-module-claw-biz -am -Dmaven.test.skip=true | 09:42-09:49 | 6m3s BUILD SUCCESS |
| 7 | maven repo jar mtime 校验 | 09:49 | Jun 7 09:49 / 640597 bytes（新版本已落） |
| 8 | 重启 dyq-server（mvn -pl dyq-server -DskipTests spring-boot:run） | 09:49-09:58 | 9min 完成 Started DyqServerApplication in 543.701s + Tomcat 48080 LISTEN |
| 9 | 主控 r56 亲核验 5 业务接口 | 10:01 | 4/5 PASS：mainline-overview 200 code=0（r53 500 修复确认）；summary/device-list/actuator 200；goal-pool 500（不在本卡 scope） |
| 10 | r56 强收口派发 | 10:01 | 确认任务已完成，TQC (t_968faf75) auto-promote 就绪 |
| 11 | 接收 r57 worker pid 1677485 派发（落 3 个 evidence 文件 + kanban_complete） | 10:02 | 当前执行 |
| 12 | 校验 ss -tlnp 48080 + repo jar mtime + git HEAD | 10:09 | 48080 java PID 1676254 LISTEN ✓ / jar 09:49 ✓ / git HEAD=0067c9b5e 无变更 ✓ |
| 13 | 写 RUN_LOG.md / EVIDENCE.md / STATUS.txt 到 evidence 目录 | 10:09 | 当前 |

## 关键路径

- dyq-module-claw-biz target/classes：/mnt/e/code/dyq/dyq-module-claw/dyq-module-claw-biz/target/classes/com/douyouqu/dyq/module/claw/controller/admin/statistics/ClawStatisticsController.class（Jun 7 07:22 新版，含 getMainlineOverview）
- maven repo jar：/mnt/d/apache-maven-3.6.3-bin/repo/com/douyouqu/boot/dyq-module-claw-biz/2.4.1-jdk17-SNAPSHOT/dyq-module-claw-biz-2.4.1-jdk17-SNAPSHOT.jar（Jun 7 09:49 640597 bytes 新版）
- 应用启动日志：/tmp/dyq-server-r54.log（grep "Started DyqServerApplication" = in 543.701 seconds）
- 当前 48080 进程：java PID 1676254（etime 09:18 起 LISTEN 至今）
