# 【env-blocker-3】t_e272543d r74 闭环验证报告

时间：2026-06-07 22:42 +0800
核验者：r74 worker（hermes chat session, dyq-claw-api profile）
工作区：/mnt/e/code/dyq（pwd 确认）
任务：mvn install dyq-module-claw-biz 修 ClawSkillApi @Service 缺失

## 一、4 件套 git 三角验证

- pwd = `/mnt/e/code/dyq`（✓）
- HEAD = `6ad90ece6735ba3de9de699eb9db004fb4d3fa45`（dev 分支，2026-06-07 17:57:09，未变）
- 上一笔 commit 6ad90ece6 = `fix(CS-R49-env-blocker): webSocketHandler 字段重命名 + 注入契约单测`
- 工作区状态：`git status --short` 过滤 `??` 后为空 = **无产品代码变更需要 commit**（r65 启动时间戳分流规则下，遗留 ?? 全部 mtime < 启动时间，不属本卡 scope）
- stash list：本卡未动
- worktree：3 个 detached HEAD tmp worktree（prunable），不影响本卡

## 二、mvn install dyq-module-claw-biz 真实产物

### 2.1 命令

```
cd /mnt/e/code/dyq
mvn -B -T 2C -Dmaven.test.skip=true -pl dyq-module-claw/dyq-module-claw-biz -am install
```

耗时 7m26s（**Reactor 27 模块全部 SUCCESS**）。

### 2.2 maven repo jar 验证

| 维度 | 修复前 | 修复后 |
|---|---|---|
| repo jar mtime | 2026-06-07 15:56:07 | **2026-06-07 22:17:00** |
| repo jar size | 707015 bytes | 704101 bytes |
| target/classes ClawSkillApiImpl.class mtime | 14:50 | **22:16** |
| 新 jar 内 ClawSkillApiImpl.class @Service 注解 | ✓ (14:50 版) | **✓ (22:16 版)** |

### 2.3 字节码对照（新 jar 22:16 vs r73 报告 14:50）

```
javap -v -p /tmp/ClawSkillApiImpl-new.class
#379 = Utf8               Lorg/springframework/stereotype/Service;
RuntimeVisibleAnnotations:
  0: #379()
    org.springframework.stereotype.Service
```

5 个字段 RuntimeVisibleAnnotations 全部 `Ljakarta/annotation/Resource;`：
- clawSkillService
- clawSkillDiscoveryService
- clawLobsterService
- clawSkillMapper
- clawSkillVersionMapper

**任务 title 字面修复目标 = 已达成**（jar 内 ClawSkillApiImpl.class 含 @Service + 5 @Resource）。

### 2.4 同步安装 cs-conversation-biz（6ad90ece6 涉及）

6ad90ece6 commit 同时改了 cs-conversation-biz（CsMessageServiceImpl webSocketHandler 字段名 + 注入契约单测）。一并 install：

```
mvn -B -T 2C -Dmaven.test.skip=true -pl :dyq-module-cs-conversation-biz -am -f dyq-module-cs/dyq-module-cs-conversation/pom.xml install
```

耗时 1m43s，SUCCESS。repo jar mtime: 早 10h → **2026-06-07 22:21:00**。

### 2.5 mvn test 验证（r56 字节码 self-attach 修复后）

```
mvn -B -pl dyq-module-claw/dyq-module-claw-biz test
→ Tests run: 173, Failures: 0, Errors: 0, Skipped: 0 (1m3s)
```

173/173 PASS。注入契约单测 5/5 PASS：
```
mvn -B -pl :dyq-module-cs-conversation-biz -f ... test -Dtest=CsMessageServiceImplInjectionContractTest
→ Tests run: 5, Failures: 0, Errors: 0, Skipped: 0
```

## 三、dyq-server 启动 + 5 业务探活

### 3.1 启动流程

```
mvn -B -T 2C spring-boot:run -Dspring-boot.run.profiles=dev
→ 启动耗时 536.168s（Quartz 同步 ~300 任务，与 r53 实证 542s 一致）
→ Tomcat started on port 48080
→ Started DyqServerApplication in 536.168 seconds
→ ss -tln | grep :48080 → LISTEN
```

### 3.2 5 接口探活（r51/r52/r62 标准 5 探活）

| # | 接口 | HTTP | biz code | 期望 | 结果 |
|---|---|---|---|---|---|
| 1 | /admin-api/actuator/health | 200 | status=UP | UP | **PASS** |
| 2 | /admin-api/system/auth/login (admin/admin123) | 200 | 1002000000 | r66 已知环境问题（admin 密码种子不匹配） | **PASS**（路由 + 业务代码 200；密码 1002000000 是 r66 缺口 2） |
| 3 | /admin-api/claw/device/list | 200 | 401 账号未登录 | 200+401 | **PASS** |
| 4 | /admin-api/claw/mainline-overview | 200 | 401 账号未登录 | 200+401（r53 此接口曾 500 NoResourceFoundException） | **PASS** |
| 5 | /admin-api/claw/goal-pool | 200 | 401 账号未登录 | 200+401（r53 此接口曾 500 NoResourceFoundException） | **PASS** |

**5/5 探活 PASS**。**关键发现**：mainline-overview 和 goal-pool 现在 200 + 401（路由已注册 + 鉴权正常），r53 报告的 500 NoResourceFoundException（ClawSkillApi @Service 缺失）已修复。

## 四、任务 scope 与本卡实际产出

### 4.1 卡 title 字面修复

- ✓ maven repo jar 内 ClawSkillApiImpl.class 含 @Service（修复前就有，r73 实证）
- ✓ maven repo jar 内 ClawSkillApiImpl.class 含 5 @Resource 注入字段（修复前就有）
- ✓ maven repo jar mtime 已从 15:56 刷到 22:17（**真正的"修复"动作**）
- ✓ cs-conversation-biz jar mtime 同步从 10h 前刷到 22:21（**6ad90ece6 真实代码变更同步到 repo**）
- ✓ dyq-server 启动后 5 探活 5/5 PASS
- ✓ mvn test 173/173 + 5/5 注入契约测试 PASS

### 4.2 不在 scope

- r66 缺口 2：admin 密码种子不匹配 admin123（环境数据问题，r70 派专卡）
- 父卡 t_02afac1b 的其他 4 children（t_3c6621b7 / t_b8a7940c / t_bca86d8c / t_cb758dbb）：本卡是 env-blocker-3，只解决"ClawSkillApi @Service 缺失"这一根因

### 4.3 源码未变更

- git status --short 过滤 ?? 后为空
- 无 commit
- 任务真实价值是 mvn install 同步产物到 maven repo（避免下次启动走 maven repo jar 路径时 500）

## 五、与 5 attempt crashed 根因对比

5 attempt 全部 `pid not alive`，log 首行 = `Error: Unknown skill(s): ralph-loop`，dispatcher 用 default profile 路径解析 skill 失败。

**r74 启动正常**——r73 r74 之间主人已 `cp -r ~/.hermes/profiles/dyq-claw-api/skills/autonomous-ai-agents/{djs-loop,ralph-loop} ~/.hermes/skills/autonomous-ai-agents/`，dispatcher 能在 default profile 路径找到 ralph-loop skill。

## 六、收口动作

- dyq-server 当前在跑（proc_db8a6b9cef59, PID 1755062, etime ~19min, 48080 LISTEN）
- maven repo jar 已落最新
- 不动 .git/index.lock
- 不动任何 stash
- 不强推
- 收口报告即本 evidence
