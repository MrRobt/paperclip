# EVIDENCE — env-blocker owner 卡: csMessageServiceImpl 注入修复

时间锚: 2026-06-07 08:42 +0800
宿主: WSL (192.168.x.x → 127.0.0.1:48080)
收口依据: 主控 r51 收口指令 + r51 worker 实际执行结果 + 本轮 r52 owner 二次核验

## 1. 修复代码证据 (r51 实际改动)

文件: `/mnt/e/code/dyq/dyq-module-cs/dyq-module-cs-conversation/dyq-module-cs-conversation-biz/src/main/java/com/douyouqu/dyq/module/cs/conversation/service/message/CsMessageServiceImpl.java`

```
5:  import com.douyouqu.dyq.module.cs.conversation.config.CsConversationWebSocketHandler;
...
32:  @Resource
35:  @Resource
38:  @Resource
45:   * 后，{@link Resource#name()} 与字段名双重保险对齐到 {@code csConversationWebSocketHandler}）。
47:  @Resource(name = "csConversationWebSocketHandler")
48:  private CsConversationWebSocketHandler csConversationWebSocketHandler;
...
145: csConversationWebSocketHandler.sendToConversation(conversationId, wsMsg);
182: csConversationWebSocketHandler.sendToAgent(agentId, msg);
```

**验收点**: 第 48 行字段名 = `@Resource` 的 bean 名 (`csConversationWebSocketHandler`), 二者严格一致, 避免 Spring 装饰后类型错位。
**测试**: 5/5 反射契约测试 PASS (r51 实际产出, 报告已落)。

## 2. 启动证据 — 48080 真在跑

```
$ ss -ltnp | grep ':48080'
LISTEN 0 100 *:48080 *:* users:(("java",pid=1668136,fd=1149))

$ ps -p 1668136 -o pid,etime,stat
    PID     ELAPSED STAT
1668136       33:26 Sl
```

- 进程: Java 17, ELAPSED 33 分钟, 状态 Sl (多线程, 等待 IO)
- 启动日志关键词: `Tomcat started on port 48080` + `Started DyqServerApplication in 541.266 seconds`
- **关键**: r40/r44 旧日志报"Tomcat started"是 StatFilter 误判, 实际 application bootstrap 未完成; r51 真实把 ApplicationContext 拉起 + Tomcat 收到端口

## 3. 健康检查证据

```
$ curl -s -o /tmp/health.json -w "code=%{http_code}\n" http://127.0.0.1:48080/admin-api/actuator/health
code=200

$ python3 -c "import json;d=json.load(open('/tmp/health.json'));print('overall:',d['status']);print('components:',sorted(d['components'].keys()))"
overall: UP
components: ['db', 'diskSpace', 'ping', 'rabbit', 'redis', 'sandbox', 'ssl']
```

7 个 component 全 UP, application 启动链完整。

## 4. 业务接口证据 (r51 主控亲核验)

- `/admin-api/actuator/health` → 200 全 UP
- `/admin-api/system/auth/login` → 200 code=0, 拿到 accessToken (32 字符)
- `/admin-api/claw/statistics/summary` → 200 code=0 (8 字段: totalLobsters/activeLobsters/totalSkills/...)
- `/admin-api/claw/device/list` → 200 code=0 (list+total)

**结论**: r51 csMessageServiceImpl 注入修复 100% 生效, 48080 真实在跑且业务接口全部可调用。

## 5. 范围外说明 — mainline-overview 500

- 接口: `/admin-api/claw/statistics/mainline-overview` → `NoResourceFoundException: No static resource admin-api/claw/statistics/mainline-overview`
- 真实根因 (主控 r51 已确认): 工作树 mainline-overview 编码未提交
- 当前 dev HEAD = `0067c9b5e feat(小龙虾运行态冒烟): 新增48080设备端闭环验证脚本`
- mainline-overview 合入在后续 commit `64dd35e00` 之后, 当前编译产物不含
- 验证: `grep "mainline-overview" /tmp/dyq-server-r49.log` 只有 preHandle/afterCompletion, 未注册 controller 路径
- **owner 卡不追**, 留 r51/r52 后续派独立 coder 卡补编码

## 6. 工作树状态 (不操作, 仅记录)

```
$ git log --oneline -5
0067c9b5e feat(小龙虾运行态冒烟): 新增48080设备端闭环验证脚本
b94ef4afd fix(健康检查): 修复开发环境主后端健康误判
58be31d8f feat(claw): 合入设备链路核心逻辑，含Mapper/Service/Job/VO
c82fab7d3 merge: 合入远程dev设备任务闭环
ef7bf616e docs(audit): 补充设备链路脱敏门禁本轮审计报告

$ git status --short (摘前 10 条)
 M dyq-module-accountmarket/.../ErrorCodeConstants.java
 M dyq-module-accountmarket/dyq-module-accountmarket-biz/pom.xml
 M dyq-module-claw/.../ClawMqConstants.java
 M dyq-module-claw/.../ClawDeviceProperties.java
 M dyq-module-claw/.../ClawStatisticsController.java
 M dyq-module-claw/.../ClawExperienceDO.java
 M dyq-module-claw/.../ClawDeviceMapper.java
 M dyq-module-claw/.../ClawDeviceTaskMapper.java
 M dyq-module-claw/.../ClawExperienceMapper.java
 M dyq-module-claw/.../ClawDeviceTaskStatusEnum.java
```

**本卡未动 git** — 严格遵守 r51 收口指令"不要强推、不要动 git (stale index.lock 02:29+ 仍 5h+ 不碰)"。

## 7. 边界遵守

- 未重启 PID 1640422/1659816 (r48 主控后台拉起的进程, 保留为后续 mainline-overview 编码验证)
- 未删他人 stash
- 未触碰 stale index.lock
- 未操作 48080 进程本身 (它就是修复结果, 让它继续跑)
- 未对外发起真实网络触达

## 8. 收口结论

owner 卡 t_2d7b4bbe scope 100% 完成:
- ✅ CsMessageServiceImpl 注入修复 (字段重命名 + @Resource 双重保险)
- ✅ 48080 spring-boot:run 真实起来 (33min ELAPSED, 全 UP)
- ✅ 5/5 反射契约测试 PASS
- ✅ 4 个真接口 200 响应
- ✅ 3 份证据文件 (本目录 IMPLEMENTATION_PLAN.md / EVIDENCE.md / RUN_LOG.md)
- ⚠️ mainline-overview 500 范围外, 已记录真实根因待后续卡

**owner 卡可完成, 等待 TQC t_968faf75 在 9 parents 全 done 后 auto-promote。**
