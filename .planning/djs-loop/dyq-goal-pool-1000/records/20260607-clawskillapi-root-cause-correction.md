# 2026-06-07 ClawSkillApi 根因误判事故记录

时间：2026-06-07 18:48 +0800
记录人：小黑（djs-loop 主控 cron）

## 结论

QC3-01 worker (run 10, 18:31-18:48) 报 dyq-server 启动失败根因为
"ClawSkillApi @Service 实现类缺失"，**主控 r71 复核判定该归因错误**。

实际 jar 内 `ClawSkillApiImpl.class` 已存在，字节码层 RuntimeVisibleAnnotations
`org.springframework.stereotype.Service` 完整，class 也在 dyq-server classpath 中。
Spring 容器启动失败的真实根因在更上游的注入链中（被 FailureAnalyzer 简化为
"最深依赖"展示），不是 ClawSkillApi 类本身缺失。

## 现场证据（主控亲验）

### maven repo jar 状态

- jar 路径：`/mnt/d/apache-maven-3.6.3-bin/repo/com/douyouqu/boot/dyq-module-claw-biz/2.4.1-jdk17-SNAPSHOT/dyq-module-claw-biz-2.4.1-jdk17-SNAPSHOT.jar`
- jar 大小：707015 bytes
- jar mtime：2026-06-07 15:56:07
- class 路径：`com/douyouqu/dyq/module/claw/api/ClawSkillApiImpl.class`
- class 大小：11393 bytes
- class mtime：2026-06-07 14:50（**比 jar 自身 mtime 早 1 小时 6 分钟**）

### class 字节码验证（javap -v 关键片段）

```
public class com.douyouqu.dyq.module.claw.api.ClawSkillApiImpl
       implements com.douyouqu.dyq.module.claw.api.ClawSkillApi
...
SourceFile: "ClawSkillApiImpl.java"
RuntimeVisibleAnnotations:
  0: #379()
    org.springframework.stereotype.Service
```

类级别 @Service 注解完整，Spring 应该识别为 bean。

### classpath 验证

PID 1721739 的 java -cp 含：
- `/mnt/e/code/dyq/dyq-server/target/classes:...`
- `.../dyq-module-claw-biz-2.4.1-jdk17-SNAPSHOT.jar` ✅

### Spring 扫描范围验证

DyqServerApplication.java 关键代码：
```java
@SpringBootApplication(
    scanBasePackages = {"${dyq.info.base-package}.server", "${dyq.info.base-package}.module",
                        "${dyq.info.base-package}.framework", "${dyq.info.base-package}.workflow",
                        "org.jeecg", "org.quartz"}
)
```

`com.douyouqu.dyq.module` 在扫描范围内。

### 启动日志

```
2026-06-07 15:26:24.033  WARN
  Exception encountered during context initialization - cancelling refresh attempt:
  org.springframework.beans.factory.BeanCreationException:
  Error creating bean with name 'aiCustomerServiceMessageConsumer':
  Injection of resource dependencies failed
...
APPLICATION FAILED TO START
Description:
A component required a bean of type 'com.douyouqu.dyq.module.claw.api.ClawSkillApi'
that could not be found.
```

## 疑点

Spring 启动失败只报告了"最深依赖 ClawSkillApi not found"，
**没有打印完整 stack trace 显示 ClawSkillApi 的创建者是谁、为什么没找到**。
可能是：
1. 注入链上游 bean（clawLobsterService / clawSkillService / clawSkillDiscoveryService /
   clawSkillMapper / clawSkillVersionMapper）创建失败；
2. Spring 在重打包的 jar 中扫到了 class 但因 jar 自身 mtime 错位（class 14:50, jar 15:56）
   触发了某种扫描跳过（可能性低，Spring 一般以 jar 内 class 为准）；
3. classpath 里有多个 ClawSkillApiImpl 但只有一个被 Spring 选中，其它冲突。

## 修复建议（r72 派发 owner 卡参考）

1. **必做路径**：
   - `kill -TERM 1721739`（先停旧 java 进程）
   - `mvn -pl dyq-module-claw-biz -am -DskipTests install`（重做 maven repo jar）
   - `ls -la /mnt/d/apache-maven-3.6.3-bin/repo/.../dyq-module-claw-biz-2.4.1-jdk17-SNAPSHOT.jar` 验 mtime 已变
   - `mvn spring-boot:run` 重启 dyq-server
   - 5 接口探活（actuator/login/device-list/mainline-overview/goal-pool）

2. **可选路径**（必做路径失败时）：
   - `mvn spring-boot:run -Dspring-boot.run.jvmArguments="-Dlogging.level.org.springframework=DEBUG"`
     拿完整 stack trace，确认注入链上游 bean 名
   - `grep -rln "@Service\|@Component" /mnt/e/code/dyq/dyq-module-claw-biz` 列出所有
     Service/Component 类，确认 14:50 之后是否有新增未 install 的 Service
   - `find /mnt/d/apache-maven-3.6.3-bin/repo -name "dyq-module-claw-biz*.jar" -newer
     /mnt/e/code/dyq/dyq-module-claw-biz/target/classes/com/douyouqu/dyq/module/claw/api/ClawSkillApiImpl.class`
     确认 maven repo jar 是否比 target/classes 旧

3. **避免陷阱**：
   - 不要再次报"ClawSkillApi @Service 缺失"作为根因（已证伪）
   - 不要只复制 FailureAnalyzer 简化输出，要拿真实 stack
   - 不要跳过 mvn install 步骤（target/classes 已含新 class，但 maven repo jar 缺）

## 教训

**r62/r66 教训再升级**：
- r62 教训：worker 自报"19 文件未提交"是幻觉
- r66 教训：QC worker 报"ClawSkillApi @Service 缺失"也是错误归因
- 共同模式：worker 看到错误日志的 FailureAnalyzer 简化输出就当根因，**不去读源码 class 字节码、不去查 jar 实际内容、不去打完整 stack trace**

后续派发类似"环境修复" owner 卡时，body 必含：
- 主控亲验的具体 jar 路径 + mtime + class 路径
- 失败日志最后 50 行原文
- "严禁复制 FailureAnalyzer 简化输出当根因，必须先 mvn install + 重启 + 拿完整 stack"
