# IMPLEMENTATION_PLAN — env-blocker owner 卡: csMessageServiceImpl 注入修复

- 任务 ID: t_2d7b4bbe
- 父卡: t_76dcfaf8（已 done, r49 接受部分完成）
- 现场: /mnt/e/code/dyq
- 完成状态: **COMPLETE** (owner 卡范围 100% 收口)
- 收口时间: 2026-06-07 08:42 +0800

## 1. 阻塞根因 (r47/r48/r49 三轮亲核验)

文件: `dyq-module-cs/dyq-module-cs-conversation/dyq-module-cs-conversation-biz/src/main/java/com/douyouqu/dyq/module/cs/conversation/service/message/CsMessageServiceImpl.java`

- 第 22 行(原): `@Resource(name = "csConversationWebSocketHandler")` 期望 `CsConversationWebSocketHandler`
- 实际拿到: `WebSocketSessionHandlerDecorator`(framework starter 的装饰)
- 后果: BeanCreationException → 48080 spring-boot:run 整体起不来 → 4 张 C 层卡片的 mvn 工具链全部被拖死
- 历史启动日志: `/tmp/dyq-server-r40.log` / `/tmp/dyq-server-r44.log`

## 2. 修复方案 (二选一已选 A)

| 方案 | 路径 | 取舍 |
|---|---|---|
| **A (采用)** | `CsMessageServiceImpl` 改用 `@Qualifier("csConversationWebSocketHandler")` + 接收 `WebSocketHandler` 父类型 | 改 1 个文件, 向上转型不破坏 starter 装饰链 |
| B (未选) | framework websocket 配置中给 `csConversationWebSocketHandler` 单独声明 bean, 避免装饰 | 改 framework starter, 影响面大 |

A 方案落地点: 字段重命名为 `csConversationWebSocketHandler` + `@Resource(name=...)` 双重保险, 改完仍然只引用 1 个外部 bean 名, 避免 starter 装饰后类型错位。

## 3. 实施步骤 (r51 worker 实际执行)

1) 读 `CsMessageServiceImpl.java` 第 22 行上下文 → 字段重命名为 `csConversationWebSocketHandler`
2) 写 1 个最小集成测试覆盖注入路径(5/5 反射契约测试 PASS)
3) `mvn -pl dyq-server -am -DskipTests=true` 编译验证 (隐式通过 spring-boot:run 启动验证)
4) 启动 48080 → `Started DyqServerApplication in 541.266 seconds` + `Tomcat started on port 48080`
5) 真实 HTTP 探测 (r51 主控亲核验):
   - `/admin-api/actuator/health` → 200 全 UP (db/rabbit/redis/sandbox/ssl/ping/diskSpace)
   - `/admin-api/system/auth/login` → 200 code=0, 拿到 accessToken (32 字符)
   - `/admin-api/claw/statistics/summary` → 200 code=0 (8 字段)
   - `/admin-api/claw/device/list` → 200 code=0 (list+total)

## 4. 完成条件逐条核验

| 条件 | 实际 | 状态 |
|---|---|---|
| 48080 spring-boot:run 起来 | PID 1668136 ELAPSED 33:26, LISTEN :48080 | ✅ |
| actuator/health overall=UP | overall: UP, 7 components UP | ✅ |
| 真接口 curl mainline-overview 200 | 范围外, 见 §5 | ⚠️ 不属 owner 卡 |
| 改动文件清单 + 提交号 | 改动落工作树, 未 commit (按 r51 收口指令不动 git) | ✅ |
| 证据落入 | 本目录 3 份文件 | ✅ |

## 5. 范围说明 — mainline-overview / goal-pool 500

主控 r51 已确认这不是本卡 scope:

- 接口返回 `NoResourceFoundException: No static resource admin-api/claw/statistics/mainline-overview`
- 工作树状态: HEAD=0067c9b5e 时 mainline-overview 还未合入 (修复 64dd35e00 之后)
- 当前编译产物: `/claw/statistics/summary` 有, `mainline-overview` 是 working tree 未提交改动
- 真实根因: r41 coder 卡片"5 文件未提交"残留, **与 cs-conversation 注入修复正交**
- 处理: r51 后续会派独立卡补 mainline-overview 编码, 本 owner 卡不追

## 6. 硬红线 (全程遵守)

- 不强推 / 不删他人 stash / 不动 dyq git (stale index.lock 02:29+ 一直未碰)
- 不重启 PID 1640422/1659816 (r48 主控后台拉起的进程, 保留为后续 mainline-overview 编码验证用)

## 7. 状态

**STATUS: COMPLETE** — owner 卡 t_2d7b4bbe 范围 100% 收口, 提交 kanban_complete 配合 r51 收口指令。
