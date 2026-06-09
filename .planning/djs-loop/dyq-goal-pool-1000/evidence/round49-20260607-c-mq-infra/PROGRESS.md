# Round 49 2026-06-07 TC-MQ 3 (MQ/Infra 异步幂等与跨模块解耦) 收口

## 目标
聚焦 C1.4 / C1.6：MQ 异步任务、幂等 DDL、跨模块低耦合基础设施。

## 工作区
- /mnt/e/code/dyq (branch: dev)
- 不强推、不删 stash、不重启 48080、不动 dyq git (stale index.lock 02:29)

## 进程状态（07:38 复核）
- 48080 端口：actuator=000 (未 LISTEN)
- mvn/spring-boot 子进程：PID 1640422 / 1641553 / 1659555 仍存活（主控 r48 明令禁止 kill）
- 启动失败根因（/tmp/dyq-server-r40.log 07:01）：
  - `csMessageServiceImpl` 注入 `webSocketHandler` 报 BeanNotOfRequiredTypeException
  - 期望 `CsConversationWebSocketHandler`，实际拿到 `WebSocketSessionHandlerDecorator`
  - 该根因属 `dyq-module-cs-conversation` owner 的代码层，不在本卡 scope
- dyq-module-accountmarket-biz 编译期缺 `AccountMarketSocialDeviceBindTypeEnum/StatusEnum`（本次新增已写入 ?? 未跟踪）

## 完成范围（已落代码，未 commit）

### 1. 幂等 DDL（任务要求 ≥1 个）
- `dyq-module-accountmarket/dyq-module-accountmarket-biz/src/main/resources/sql/V20260607__account_market_social_device.sql`
- 使用 `CREATE TABLE IF NOT EXISTS`（Flyway 幂等迁移）
- 表 `account_market_social_device`：社交账号 ↔ 小龙虾设备 绑定（养号下发 + 审计）
- 主键 + 3 索引（tenant / social_account / device） + 软删 + 租户列

### 2. MQ 异步任务（C1.4 / C1.5 / C1.6）
- 新增 `dyq-module-claw/.../dal/dataobject/mq/ClawMqOutboxDO.java`（MQ Outbox 模式落地，事件可重发）
- 重写 `ClawEventPublisher.java`（75 行）→ 标准化 MQ 事件 producer
- 配套：`ClawMqConstants.java`（10 行新增）+ `ClawDeviceProperties.java`（6 行新增）
- Mappers：
  - `ClawDeviceMapper.java`（37 行新增，设备状态查询）
  - `ClawDeviceTaskMapper.java`（62 行新增，任务派发/心跳/结果回传）
  - `ClawExperienceMapper.java`（15 行新增，经验统计）

### 3. 跨模块解耦（market ↔ claw 解耦）
- 新增包 `dyq-module-accountmarket/.../enums/AccountMarketSocialDeviceBindTypeEnum.java`（主/备/临时绑定）
- 新增包 `dyq-module-accountmarket/.../enums/AccountMarketSocialDeviceStatusEnum.java`（有效/解绑）
- 新增包 `dyq-module-accountmarket/.../controller/admin/socialdevice/` + `service/socialdevice/` + `dal/dataobject/socialdevice/` + `dal/mysql/socialdevice/`
- 新增包 `dyq-module-claw/.../api/market/`（claw → market 跨模块 API 客户端封装，避免直接依赖实现类）
- `dyq-module-accountmarket/.../enums/ErrorCodeConstants.java`（M，新增跨模块错误码）
- `dyq-module-accountmarket/.../pom.xml`（M，依赖传递）
- 注：market 侧 controller/service/dal/enum 全部以 ??（未跟踪）新增，无 M 修改

### 4. 业务层（C1.4 / C2.1-C2.5）
- `ClawStatisticsController.java`（80 行改，mainline-overview 端点对齐）
- `ClawStatisticsService.java` / `ClawStatisticsServiceImpl.java`（49 + 575 行扩展主体，含经验/等级/进化统计）
- `ClawExperienceDO.java`（6 行新增字段）
- `ClawDeviceService.java` / `ClawDeviceServiceImpl.java`（18 + 54 行改，设备治理闭环）
- `ClawDeviceTaskStatusEnum.java`（6 行改，状态机调整）
- 单测：`ClawDeviceServiceTest.java`（153 行扩展）+ `ClawExperienceServiceTest.java`（3 行新增）
- VO：`ClawDeviceSummaryRespVO.java` + `ClawMainlineOverviewRespVO.java`（未跟踪 ??，本次新增）

## 提交号
**未提交。** 原因：
- 48080 spring-boot:run 子进程被 mvn install/test 阻塞，bean 注入错误与 accountmarket 枚举编译错误反复打断工具链
- r47/r48/r49 主控连续 5 次重申 5 分钟内无新动作立即 kanban_complete，禁止重开 mvn 工具链
- 不在 master cron kill spring-boot 进程（r48 硬红线）
- 改文件未进 stash（r47 硬红线）
- 完整 diff 落 evidence，r49 之后由主控 + 新 worker 接力提交 / 拆片

## 验证状态
- `mvn -pl dyq-server test`：未跑（工具链阻塞 + 主控禁止）
- `curl /admin-api/actuator/health`：未跑（48080 进程未正常启动）
- `git log --oneline -5`：本地 dev 分支最近提交保持 `0067c9b5e / b94ef4afd / 58be31d8f / c82fab7d3 / ef7bf616e`

## 改动文件清单
详见同目录 `CHANGED_FILES.txt`（git status --short 限定 dyq-module-claw/ dyq-module-accountmarket/）。
