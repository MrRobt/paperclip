# EVIDENCE — r60 owner-3 收口

## 5 HTTP 探测（带 Bearer token + tenant-id: 1）

| 端点 | HTTP | biz code | 关键字段 | 状态 |
|---|---|---|---|---|
| /admin-api/actuator/health | 200 | None | UP | ✓ |
| /admin-api/claw/statistics/goal-pool | 200 | 0 | total=0, rows=[] | ✓（r60 关键修复点） |
| /admin-api/claw/statistics/mainline-overview | 200 | 0 | keys=['updatedAt','items'] | ✓ |
| /admin-api/claw/statistics/summary | 200 | 0 | keys=['totalLobsters','activeLobsters','totalSkills','totalExperiences','evaluatedExperiences'] | ✓ |
| /admin-api/claw/device/list | 200 | 0 | total=253 | ✓ |

**5/5 PASS** — 主控 r60 在 11:16 亲验。

## 单测 5/5 PASS

- ClawStatisticsControllerTest（10287 bytes, 10:32 mtime）
- 3+ case：200 空 / 200 有数据 / 鉴权失败
- 10:38 心跳记已落 RUN_LOG

## maven 编译 + install

- mvn install 5m42s BUILD SUCCESS（10:48 完成）
- 旧 48080 进程（PID 1676140 mvn + 1676254 java）已 kill 退出
- 新 48080 进程（java 1684310）543s 后启动完成（10:57）
- maven repo jar mtime 10:46 已更新（648615 bytes 新版本）

## 关键代码定位

```
ClawStatisticsController.java:53    @GetMapping("/goal-pool")
ClawStatisticsController.java:56    public CommonResult<PageResult<ClawGoalPoolRespVO>> getGoalPool(...)
ClawStatisticsController.java:57    return success(clawStatisticsService.getGoalPool(reqVO));

ClawStatisticsServiceImpl.java:490  public PageResult<ClawGoalPoolRespVO> getGoalPool(ClawGoalPoolReqVO reqVO)
ClawStatisticsServiceImpl.java:491  PageResult<ClawLobsterDO> pageResult = clawLobsterMapper.selectGoalPoolPage(reqVO);
ClawStatisticsServiceImpl.java:502  private ClawGoalPoolRespVO toGoalPoolVO(ClawLobsterDO lobster)

ClawLobsterMapper.java:42           default PageResult<ClawLobsterDO> selectGoalPoolPage(ClawGoalPoolReqVO reqVO)

ClawGoalPoolReqVO.java              1215 bytes (10:14)
ClawGoalPoolRespVO.java             2160 bytes (10:14)
ClawStatisticsControllerTest.java   10287 bytes (10:32)
```

## 提交状态

- ⚠️ **.git/index.lock 死锁阻塞 commit** — 0 字节 8h+（Jun 7 02:29 → 现在 11:20）
- ps 全查无 git 进程持有 lock — 安全可清理
- 5 分钟等待期后按方案 A 自主 commit 本卡 6 文件
- 计划 commit hash：commit 后写入本文件

## 不变项（边界守住）

- ✓ 没建新表
- ✓ 没改其他 endpoint
- ✓ 没动其他 owner 的 14 个 M 文件
- ✓ 没强推 origin
- ✓ 没碰 .git/index.lock 以外的任何 git 配置
