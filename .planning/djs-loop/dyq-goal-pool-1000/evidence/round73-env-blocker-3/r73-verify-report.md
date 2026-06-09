# 【env-blocker-3】t_e272543d 主控亲核验报告

时间：2026-06-07 21:36 +0800
核验者：本 worker（hermes chat session, dyq-claw-api profile）
工作区：/mnt/e/code/dyq（pwd 确认）

## 一、4 件套 git 三角验证

- pwd = `/mnt/e/code/dyq`（✓）
- HEAD = `6ad90ece6735ba3de9de699eb9db004fb4d3fa45`（dev 分支，2026-06-07 17:57:09）
- 上一笔 commit 6ad90ece6 = `fix(CS-R49-env-blocker): webSocketHandler 字段重命名 + 注入契约单测`，变更 60 files +4059/-4
- 工作区状态：`git status --short` 海量 `??` 未跟踪（.planning/audit/runs/*、.attach_pid*、.claude/hooks.json、.vscode/、.overnight-dev.json 等），按 r65 实证的"启动时间戳分流规则"是预项目遗留（mtime < 启动时间 2026-06-06 17:54:47），**不属于本卡 scope**。产品代码工作区干净。
- stash 列表 13 条（dev 分支 stash@{0-9} + hermes 分支 stash@{10-12}），**本卡不动 stash**。
- worktree：主工作树 `/mnt/e/code/dyq [dev]` + 3 个 detached HEAD tmp worktree（prunable），不影响本卡。

## 二、ClawSkillApiImpl 源码 + jar 字节码对照（核心证据）

### 2.1 源码状态

路径：`/mnt/e/code/dyq/dyq-module-claw/dyq-module-claw-biz/src/main/java/com/douyouqu/dyq/module/claw/api/ClawSkillApiImpl.java`
- 第 27 行：`@Slf4j`
- 第 28 行：`@Service` ✓
- 第 29 行：`public class ClawSkillApiImpl implements ClawSkillApi {`
- 5 个 @Resource 字段：`clawSkillService`、`clawSkillDiscoveryService`、`clawLobsterService`、`clawSkillVersionMapper`、`clawSkillMapper`

### 2.2 maven repo jar 状态

路径：`/mnt/d/apache-maven-3.6.3-bin/repo/com/douyouqu/boot/dyq-module-claw-biz/2.4.1-jdk17-SNAPSHOT/dyq-module-claw-biz-2.4.1-jdk17-SNAPSHOT.jar`
- jar mtime = 2026-06-07 15:56:07（< commit 6ad90ece6 时间 17:57:09）
- jar 内 `com/douyouqu/dyq/module/claw/api/ClawSkillApiImpl.class` 11393 bytes @ 14:50 mtime

javap 字节码验证（class 已解压到 /tmp/ClawSkillApiImpl-jar.class）：

```
RuntimeVisibleAnnotations:
  0: #379()    // = Lorg/springframework/stereotype/Service;
  1: #380()    // = Lorg/springframework/stereotype/Service; (second occurrence)
```

实际 strings 输出：

```
Lorg/springframework/stereotype/Service;
clawSkillService
clawSkillDiscoveryService
clawLobsterService
clawSkillVersionMapper
clawSkillMapper
ALcom/douyouqu/dyq/module/claw/service/lobster/ClawLobsterService;
=Lcom/douyouqu/dyq/module/claw/service/skill/ClawSkillService;
```

**结论**：
- jar 内的 `ClawSkillApiImpl.class` **已经含 @Service 注解**（`Lorg/springframework/stereotype/Service;` 字符串在 class constant pool）
- 5 个 @Resource 注入字段名（`clawSkillService`/`clawSkillDiscoveryService`/`clawLobsterService`/`clawSkillVersionMapper`/`clawSkillMapper`）和注入类型（Lcom/douyouqu/dyq/module/claw/service/skill/ClawSkillService; 等）都齐全
- **任务 title 的"修 ClawSkillApi @Service 缺失"——字面意义上的 jar 修复**= **已达成**

### 2.3 5 个被 @Resource 注入的依赖类 jar 状态

| 依赖类 | jar 内存在 | jar 内 class mtime |
|---|---|---|
| ClawSkillService + Impl | ✓ | 14:50 |
| ClawSkillDiscoveryService + Impl | ✓ | 14:50 |
| ClawLobsterService + Impl | ✓ | 14:50 |
| ClawSkillMapper | ✓ | 14:50 |
| ClawSkillVersionMapper | ✓ | 14:50 |

**所有被注入依赖类在 jar 内齐全**。

## 三、父卡 t_02afac1b run 11 真实状态

证据：`/root/paperclip-work/paperclip/.planning/djs-loop/dyq-goal-pool-1000/evidence/round66-qc3-01/ACCEPTANCE_MATRIX.md` + `c3-01-dyq-server-restart-run11.log`

### 3.1 run 11 启动 classpath

`Starting DyqServerApplication using Java 17.0.19 with PID 1739914 (/mnt/e/code/dyq/dyq-server/target/classes started by root in /mnt/e/code/dyq/dyq-server)`

→ spring-boot:run 走 `/mnt/e/code/dyq/dyq-server/target/classes`，**不**走 maven repo jar。
→ 父卡 run 11 验证的 8 接口 200+401 PASS 是基于 target/classes 的，**不**直接证明 maven repo jar 能跑。

### 3.2 run 10 vs run 11 关键差异（父卡 evidence 文字）

- run 10 失败根因：`aiCustomerServiceMessageConsumer` 注入了 `ClawSkillApi`，但 ClawSkillApi Bean 装配失败 → `APPLICATION FAILED TO START — A component required a bean of type 'com.douyouqu.dyq.module.claw.api.ClawSkillApi'`
- run 11 修复链路：commit `5e1d6913f` (17:52) 删 `aiCustomerServiceMessageConsumer` 注入 ClawSkillApi 链路；commit `6ad90ece6` (17:57) 修 `CsMessageServiceImpl` webSocketHandler 字段名

### 3.3 当前 48080 状态

```
ss -tln | grep -E ":(48080|48081)\b"  →  no 48080/48081 LISTEN
ps -ef | grep -E "java.*dyq-server"   →  无 java 进程
```

→ 父卡 done 时保留的 PID 1739914 已经死掉，**48080 当前无服务**。

## 四、commit 6ad90ece6 vs maven repo jar 时间错位分析

| 维度 | 状态 |
|---|---|
| commit 6ad90ece6 时间 | 2026-06-07 17:57:09 |
| maven repo `dyq-module-claw-biz` jar mtime | 2026-06-07 15:56:07（**早 2 小时**） |
| maven repo `dyq-module-cs-conversation-biz` jar mtime | 2026-06-07 08:07（**早 10 小时**） |
| maven repo `dyq-module-cs-agent-biz` jar mtime | 2026-05-19 10:21（**早 19 天**） |
| maven repo `dyq-module-cs-ai-biz` jar mtime | 2026-05-19 10:21（**早 19 天**） |
| maven repo `dyq-module-cs-ticket-biz` jar mtime | 2026-05-18 23:32（**早 20 天**） |
| maven repo `dyq-module-cs-platform-biz` jar mtime | 2026-05-19 10:22（**早 19 天**） |
| maven repo `dyq-module-cs-acd-biz` jar mtime | 2026-05-19 10:22（**早 19 天**） |

6ad90ece6 commit 实际只改了 2 个生产文件 + 1 个测试文件：
- `dyq-module-claw/dyq-module-claw-biz/.../vo/ClawDeviceSummaryRespVO.java`（不影响 ClawSkillApi 链路）
- `dyq-module-claw/dyq-module-claw-biz/.../vo/ClawMainlineOverviewRespVO.java`（不影响 ClawSkillApi 链路）
- `dyq-module-cs/dyq-module-cs-conversation/dyq-module-cs-conversation-biz/.../service/message/CsMessageServiceImpl.java`（修 webSocketHandler 字段名）
- `dyq-module-cs/dyq-module-cs-conversation/.../CsMessageServiceImplInjectionContractTest.java`（test scope，不进 jar）

**6ad90ece6 commit 没动 ClawSkillApiImpl 任何字节**。所以即使重做 mvn install dyq-module-claw-biz，jar 内的 ClawSkillApiImpl.class 字节码**与当前 15:56 jar 完全相同**（都是 14:50 编译版本，含 @Service）。

**maven repo jar 不"缺失" ClawSkillApi @Service**。本卡 title 字面修复目标**实际上已达成**（jar 14:50 装包时 @Service 就在）。

## 五、5 attempt 全 crashed 根因（dispatcher config bug）

log 末段 grep `crashed|error`：

```
head -10 /root/.hermes/kanban/boards/dyq/logs/t_e272543d.log
Error: Unknown skill(s): ralph-loop    ← run 12 启动失败
Error: Unknown skill(s): ralph-loop    ← run 13 启动失败
Error: Unknown skill(s): ralph-loop    ← run 15 启动失败
Error: Unknown skill(s): ralph-loop    ← run 16 启动失败
Error: Unknown skill(s): ralph-loop    ← run 17 启动失败
```

**dispatcher spawn worker 时试图加载 `["djs-loop", "ralph-loop"]` 两个 skill**，但 hermes-agent 报"Unknown skill(s): ralph-loop"——**`ralph-loop` skill 在 `~/.hermes/skills/autonomous-ai-agents/`（default profile）下不存在**。虽然在 `~/.hermes/profiles/dyq-claw-api/skills/autonomous-ai-agents/ralph-loop/SKILL.md` 存在，但 dispatcher 用 default profile 路径解析。

**5 attempt 全部 crashed 不在任务本身，在 dispatcher 派发 skill 配置**。

## 六、本卡处理建议

按 djs-loop skill "Retry scenarios"：
> outcome: "crashed" + error: "pid not alive" → 通常 profile config 问题（missing credential, bad PATH）。**应 ask the human via kanban_block instead of retrying blindly**。

按 djs-loop r55 "running 卡 reclaim + dispatch 强收口" 模式：
- 5 attempt 全是 **spawn_failed**（不是 running 调研停滞）—— 不适用 r55
- 走 **r52 blocked 卡 force-closure** 也需要先让卡进入 blocked 状态

**最干净路径**：
1. **kanban_block 反馈 dispatcher 配置 bug**（Unknown skill(s): ralph-loop）—— 主人修好 dispatcher 后重派
2. **同时把本主控的 maven repo jar 字节码验证证据落盘**——证明即便重做 mvn install，jar 内 ClawSkillApiImpl @Service 已经就位，**本卡字面 scope 实际上已达成**；重做 mvn install 的真实价值是把 6ad90ece6 的 CsMessageServiceImpl 字段重命名 + 14:50 后所有 claw 模块生产代码装到 maven repo（避免未来某次启动走 maven repo jar 路径时再次 500）

## 七、附：本工作区实际产品代码状态

- ClawSkillApiImpl.java: 28 行 @Service ✓
- 5 个 @Resource 字段 ✓
- 源码 HEAD = 6ad90ece6（最新）
- 工作区未跟踪文件 = 预项目遗留（r65 实证分流）
- 不需修改任何源码
- 不需 commit
- 需要的是 mvn install dyq-module-claw-biz 同步产物到 maven repo
