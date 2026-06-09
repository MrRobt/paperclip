# 第37轮证据：Claw 三主线总览真实接口 + PokeClaw 端侧看板复核

- 时间：2026-06-07 03:26:51 +0800
- 任务类型：A泳道后端/Web 泳道内串行 + B泳道 PokeClaw 并发可跑；集成串行验证。
- 凭证读取：已读取 `/mnt/e/code/dyq/.claude/rules/testing-credentials.md`，本轮未写入明文密码或令牌，未进行生产触达。

## 真实产出

1. DYQ 后端：修复 `ClawDeviceServiceImpl` 与 `ClawDeviceServiceTest` 中设备任务状态枚举类型不匹配，恢复 claw 模块测试编译能力。
2. DYQ 后端：保留并验证 Claw 三主线只读总览接口 `/claw/statistics/mainline-overview`，可从 PokeClaw `operator-status.json` 读取设备在线数、端侧契约和可浏览看板入口。
3. Web 管理后台：`src/api/claw/overview.ts` 默认从真实后端总览接口读取，不再默认使用本地 mock；接口测试已通过。
4. PokeClaw：复核第37轮端侧运营看板证据包，确认 `operator-dashboard.md`、`operator-dashboard.html`、`operator-status.json` 可供云端读取。

## 验证命令

- Web：`npm test -- --run src/api/claw/overview.test.ts` → 通过，1 个文件，9 个用例。
- PokeClaw：`./gradlew :app:testDebugUnitTest --tests io.agents.pokeclaw.cloudnode.CloudExecutorNodeContractTest` → 通过。
- DYQ：`mvn -pl dyq-module-claw/dyq-module-claw-biz -Dtest=ClawStatisticsServiceImplTest,ClawStatisticsControllerTest,ClawDeviceServiceTest test -DskipITs -Dcheckstyle.skip` → 通过；实际匹配运行 `ClawDeviceServiceTest`，23 个用例通过。

## 阻塞/风险

- DYQ 仓库存在大量既有未跟踪审计目录；本轮只改 5 个已跟踪 claw 文件，未清理未知文件。
- 后端统计接口相关测试类当前未发现对应文件名，后续应补专门的三主线总览服务/控制器测试。
- PokeClaw 当前 ADB 在线设备数为 0，本轮证据仍是端侧本地样例看板，不伪装真机验收。
