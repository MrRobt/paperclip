# 纸夹智能体交付系统验收证据

状态：进行中

## 一、计划阶段证据

- 已读取：`AGENTS.md`
- 已读取：`doc/GOAL.md`
- 已读取：`doc/SPEC-implementation.md`
- 已读取：`package.json`
- 已读取：`docs/plans/paperclip-service-liveness-self-healing-technical-plan.md`
- 已执行：`pwd && git status --short && git branch --show-current && git log --oneline -3`
- 已确认：当前分支为 `dev`
- 已确认：工作区存在大量历史未提交文件，本任务不清理、不重置、不删除。

## 二、待填实现证据

### 里程碑一：数据库基础

- [x] 新表文件清单：
  - `packages/db/src/schema/issue_comment_drafts.ts`
  - `packages/db/src/schema/issue_blocker_policies.ts`
  - `packages/db/src/schema/control_plane_diagnostic_snapshots.ts`
  - `packages/db/src/schema/model_health_events.ts`
  - `packages/db/src/schema/index.ts`
- [x] 迁移文件清单：`packages/db/src/migrations/0095_whole_madripoor.sql`
- [x] 数据库包类型检查结果：`pnpm --filter @paperclipai/db typecheck` 通过。
- [ ] 相关单元测试结果。

### 里程碑二：服务端核心服务

- [ ] 诊断聚合服务测试结果。
- [ ] 评论草稿服务测试结果。
- [ ] 阻塞策略服务测试结果。
- [ ] 模型健康服务测试结果。
- [ ] 证据闸门测试结果。

### 里程碑三：接口和活动日志

- [x] 新接口路由测试结果：评论草稿、阻塞策略、模型健康已有相关服务单测证据；批量唤醒路由已补路由测试用例，当前环境因缺 `pnpm/corepack` 与 `sqlite3` 原生绑定无法完成运行，类型检查通过。
- [ ] 跨公司访问拦截测试结果。
- [x] 活动日志写入验证：评论草稿、阻塞策略、模型健康探测、批量唤醒均已接入写动作活动日志。
- [x] 接口文档更新证据：已补评论草稿、阻塞策略、模型健康、批量唤醒 OpenAPI 注册。

### 里程碑四：心跳、恢复与后台任务

- [ ] 心跳评论失败生成草稿证据。
- [ ] 静默运行生成恢复动作证据。
- [ ] 模型失败生成健康事件证据。
- [ ] 安全草稿重放证据。

### 里程碑五：前端控制台

- [ ] 页面截图或真浏览器验证结果。
- [ ] 风险事项表展示证据。
- [ ] 草稿重放操作证据。
- [ ] 恢复动作操作证据。
- [ ] 模型健康面板展示证据。

### 里程碑六：全链路验收

- [ ] `pnpm -r typecheck` 结果。
- [ ] `pnpm test:run` 结果。
- [ ] `pnpm build` 结果。
- [ ] 如适用：`pnpm test:e2e` 结果。
- [ ] 提交号或未提交原因。

## 三、完成定义

不得只凭智能体自报完成。必须有：

1. 代码文件清单。
2. 数据库迁移清单。
3. 接口清单。
4. 页面入口清单。
5. 测试命令和结果。
6. 真浏览器或接口验证证据。
7. 工作区改动范围说明。
8. 提交号或未提交原因。
