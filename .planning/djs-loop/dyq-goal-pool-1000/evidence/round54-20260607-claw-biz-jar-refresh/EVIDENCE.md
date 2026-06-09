# EVIDENCE — r54 dyq-module-claw-biz maven repo jar refresh

任务：t_ce2d7705
验收口径：4/5 业务接口通过（mainline-overview 从 r53 500 修复为 200 code=0；goal-pool 500 不在本卡 scope）

## 5 业务接口探测结果（主控 r56 亲核验 + Bearer token + tenant-id: 1）

| 接口 | HTTP | biz code | 结果 | 说明 |
|---|---|---|---|---|
| /admin-api/actuator/health | 200 | status=UP | PASS | 存活探针 |
| /admin-api/system/auth/login | 200 | code=0 | PASS | 真实拿到 accessToken |
| /admin-api/claw/statistics/summary | 200 | code=0 | PASS | 老接口稳定 |
| /admin-api/claw/device/list | 200 | code=0 | PASS | 253 台设备（含 r40-r44 coder 测试设备） |
| /admin-api/claw/statistics/mainline-overview | 200 | code=0 | **PASS（关键修复点）** | r53 持续 500 → 本轮 200，r51 NoResourceFoundException 解决 |
| /admin-api/claw/statistics/goal-pool | 500 | code=500 | NOT IN SCOPE | controller 内未实现该 endpoint（不属本 maven repo jar refresh 卡） |

汇总：**4/5 PASS**（goal-pool 500 由 r57 独立 owner 卡处理）

## maven repo jar 校验

```
ls -la /mnt/d/apache-maven-3.6.3-bin/repo/com/douyouqu/boot/dyq-module-claw-biz/2.4.1-jdk17-SNAPSHOT/dyq-module-claw-biz-2.4.1-jdk17-SNAPSHOT.jar
-rwxrwxrwx 1 zlg02 zlg02 640597 Jun  7 09:49 .../dyq-module-claw-biz-2.4.1-jdk17-SNAPSHOT.jar
```

- mtime：Jun 7 09:49 ✓（旧版本 Jun 6 16:19 已替换）
- size：640597 bytes（新版）
- 路径类型：/mnt/d/apache-maven-3.6.3-bin/repo（与父 pom <repositories> 一致）

## dyq-server 启动证据

- 启动方式：mvn -pl dyq-server -DskipTests spring-boot:run
- 启动耗时：约 9 分钟
- 启动完成日志：/tmp/dyq-server-r54.log
  ```
  grep "Started DyqServerApplication" /tmp/dyq-server-r54.log
  → Started DyqServerApplication in 543.701 seconds
  ```
- Tomcat 端口：48080 LISTEN
  ```
  ss -tlnp 2>/dev/null | grep 48080
  → LISTEN 0 100 *:48080 *:* users:(("java",pid=1676254,fd=1149))
  ```

## git 状态

```
git -C /mnt/e/code/dyq log -1 --oneline
→ 0067c9b5e feat(小龙虾运行态冒烟): 新增48080设备端闭环验证脚本
```

git HEAD=0067c9b5e（dev HEAD 干净），本卡未修改任何源码。

## root cause（主控 r51/r52/r53/r54 四轮已 100% 锁定）

- 现象：/admin-api/claw/statistics/mainline-overview 持续 500，错误日志 NoResourceFoundException: No static resource admin-api/claw/statistics/mainline-overview
- 根因：maven repo 旧 jar（Jun 6 16:19 568360 bytes）不含 mainline 字符串字面量，spring-boot 启动加载旧 jar → preHandle 接 URL 后无 controller 命中 → 走 NoResourceFoundException
- target/classes/ClawStatisticsController.class（Jun 7 07:22 2775 bytes）已含 getMainlineOverview 方法
- 修复：mvn install 把新 jar 装进 maven repo + spring-boot:run 重启 48080
- 不修改任何源代码

## 严禁项执行情况

- ✗ 不修改任何源码（mvn install + restart 已足够）
- ✗ 不动 .git/index.lock（CLAUDE.md §19 红线）
- ✗ 不重启 48080 之前先停旧 java 进程
- ✗ 不裸 curl 探测（用 Bearer token + tenant-id: 1）
- ✗ 不省略 mvn install 步骤
