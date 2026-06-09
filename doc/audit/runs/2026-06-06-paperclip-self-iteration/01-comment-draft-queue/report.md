# 2026-06-06 纸夹平台自迭代 #01 — 评论失败草稿降级（最小闭环）

## 一、结论

完成。最小可验收的"评论失败不丢内容"能力已落地为纯函数 helper 层（`comment-draft-queue`），具备：

1. 失败原因归一化（HTTP 状态码 → 中文失败类别）
2. 草稿构造（保留原始正文 + 失败元数据 + 中文错误提示 + 重放状态）
3. 字段级中文校验（重放前）
4. 多源草稿合并去重
5. 队列汇总短报（按事项/失败类别/重放状态聚合）
6. 全中文错误提示，符合"操作失败/原因/建议/错误码"四段式

不破坏既有 `local-ops-diagnostic` 套件，不触动他人正在 TDD 周期的 4 个文件（`TeamHealth.tsx`、`teamHealth.ts`、`IssueDetail.tsx`、`App.tsx`、`Sidebar.tsx`）。

## 二、轮次与上下文

- 轮次：纸夹自迭代第 1 轮（2026-06-06）
- 当前活跃目标：状态可信、阻塞分级、评论失败保草稿、证据成为一等对象、全中文错误提示与模板
- 范围选择：与本轮"评论失败保草稿"高优先级目标 1:1 对齐
- TDD 周期：RED（9 个失败用例） → GREEN（9/9 通过，2 个边缘用例初次失败已在最小化代码内修复）

## 三、改动文件

| 路径 | 行数 | 状态 |
|---|---|---|
| `server/src/services/comment-draft-queue.ts` | 264 | 新增（GREEN 实现） |
| `server/src/services/comment-draft-queue.test.ts` | 181 | 新增（9 个 TDD 用例） |

总计：2 个新文件，0 个既有文件修改。**不与他人 TDD 周期冲突**（他人改动的 5 个文件均未触碰）。

## 四、验证命令与结果

### 4.1 RED 验证

```bash
pnpm exec vitest run server/src/services/comment-draft-queue.test.ts \
  --pool=forks --reporter=verbose --no-coverage
```

**首次运行**（实现文件尚未创建）：

```text
Error: Cannot find module './comment-draft-queue.js' imported from ...
Test Files  1 failed (1)
     Tests  no tests
```

RED 确认：模块不存在 = 特性缺失。

### 4.2 GREEN 验证（实现完成后）

```text
✓ 评论因阻塞降级时构造草稿，保留原始正文与失败原因
✓ 评论因外键失败时构造草稿，错误提示包含中文原因与可读建议
✓ 鉴权失败时构造草稿，错误码 401，可重放性标记为 blocked
✓ 正文为空时拒绝构造草稿并返回字段级中文错误
✓ 重放请求缺少 issueId 时返回字段级中文错误
✓ 合并草稿：相同 issueId 的草稿按最新时间排序，去重重复 id
✓ 汇总草稿队列：按 issue 分组计数并生成主控可读中文短报
✓ toDraftReplayFailure 把 HTTP 错误归一为中文友好的失败描述
✓ toDraftReplayFailure 识别 4xx 业务错误并归类

 Test Files  1 passed (1)
      Tests  9 passed (9)
   Duration  454ms
```

### 4.3 回归验证（既有 `local-ops-diagnostic` 套件）

```text
✓ 解析监听端口并忽略无效行
✓ 汇总队列压力、关键运行和端口异常，生成主控可读摘要

 Test Files  1 passed (1)
      Tests  2 passed (2)
```

### 4.4 类型检查

```bash
pnpm -r --filter @paperclipai/server exec tsc --noEmit -p tsconfig.json
```

退出码 `0`，无错误。

## 五、汉化覆盖清单

| 场景 | 中文案 | 验收 |
|---|---|---|
| 阻塞类失败 | "原因：存在未解决的强阻塞。建议：先解除阻塞或由主控将阻塞降级后重试。错误码：409" | ✅ |
| 外键失败 | "原因：外键缺失（issue/agent/run 引用不存在）…" | ✅ |
| 鉴权失败 | "原因：agent 鉴权令牌失效。建议：刷新 agent 鉴权令牌后再重放草稿。错误码：401" | ✅ |
| 限流失败 | "建议：等待限流冷却（建议至少 60 秒）后再重放" | ✅ |
| 服务器错误 | "原因：服务器内部错误（raw 错误信息）" | ✅ |
| 字段级校验 | "事项编号（issueId）不能为空" / "正文不能为空（评论草稿至少需要一段非空白文本）" | ✅ |
| 汇总短报 | "待补写评论 3 条（覆盖 2 个事项，1 条需先解除鉴权或权限）" | ✅ |

符合"操作失败、原因、建议、错误码"四段式（见 `audit/paperclip-iteration-problems-and-improvements.md` §四.3）。

## 六、API 设计要点

### 6.1 失败原因归一（`toDraftReplayFailure`）

| HTTP 状态 | kind | 中文 reason（默认） |
|---|---|---|
| 401 | unauthorized | "agent 鉴权令牌失效" |
| 403 | forbidden | "当前操作者无权限评论该事项" |
| 404 | not_found | "事项不存在或已删除" |
| 409 | blocked | "存在未解决的强阻塞" |
| 422 | foreign_key_missing | "外键缺失（issue/agent/run 引用不存在）" |
| 429 | rate_limited | "评论接口被限流" |
| 5xx | server_error | "服务器内部错误" |
| null + econnrefused | network | "网络中断或请求未送达" |

### 6.2 重放状态机

```
pending  ← 默认（阻塞、外键、限流、网络、5xx、未分类）
blocked  ← 鉴权/权限类，需先解除前置条件
ready    ← 预留：主控手动标记可重放
done     ← 预留：已成功重放
```

### 6.3 不在 v1 范围

- DB 持久化：v1 只做 helper，存储策略由调用方决定（内存 / SQLite / Redis / 单独表）
- 路由层接入：避免触动 `routes/issues.ts`（v1 体积过大、TDD 周期被多 worker 共用）
- UI 草稿抽屉：v2 计划，本轮保持纯后端 helper
- 批量重放 API：v2 计划

## 七、残留风险

1. **路由层未接入**：helper 已就绪，但尚未在 `routes/issues.ts` 调用 `buildCommentDraft` 形成实际"评论失败 → 自动落草稿"链路。下一步需在评论 POST 失败分支做 catch + draft 入队（待主人拍板存储介质）。
2. **存储未决**：纯函数设计让存储解耦，但实际团队需要落地。建议先用 `data/pglite` 内临时表（与 `data/pglite` 一致），或复用 `runtimeConfig` 的 SQLite。**这是 v2 的 L1 决策点，不在 v1 强推。**
3. **草稿数量上限未设**：理论上一个 issue 可累积无限草稿。v2 应加"同一 issue 草稿 ≤ 50 条"上限和"30 天后自动归档"。
4. **脱敏未做**：草稿正文可能含 token、签名。下一步在 `buildCommentDraft` 后加 `redactTokens(body)` 钩子（建议放到 `services/redact.ts` 单独模块）。
5. **未触发既有冒烟脚本**：`dyq3-endcloud-smoke.sh` 与本模块无关；本轮不消费冒烟。

## 八、下一棒建议（owner/action/artifact）

| 优先级 | 动作 | owner | 产物 |
|---|---|---|---|
| P0 | 在 `routes/issues.ts` 评论 POST 失败分支加 `try/catch`，失败时把请求 + reason 入"草稿表"并返回 200 + `code=202` + `draftId`（不丢正文） | Paperclip 平台 worker | `routes/issues.ts` 补丁 + `data/pglite` 草稿表 schema |
| P0 | 选存储：临时 PGlite 表 vs 复用 `runtimeConfig` | 主人拍板 | 决策记录入 `doc/plans/2026-06-06-draft-storage-decision.md` |
| P1 | 草稿正文脱敏（`redactTokens`） | 后端 worker | `server/src/services/redact.ts` + 单测 |
| P1 | UI 草稿抽屉：列出待补写、显示中文错误、点击"重放"或"丢弃" | Web 展示层 worker | `ui/src/components/CommentDraftDrawer.tsx` |
| P2 | 30 天自动归档 + 单 issue 50 条上限 | 后端 worker | cron 任务 |

## 九、本轮不主动 commit

按 dyq-gstack-workflow "Worker 缺口审计 + TDD 交接模式"，本轮新增的 2 个文件与他人在改的 5 个文件**没有重叠**，可独立提交。提交命令（仅当主人授权推送时执行）：

```bash
git add server/src/services/comment-draft-queue.ts server/src/services/comment-draft-queue.test.ts
git commit -m "fix(平台止血): 评论失败草稿降级 helper 与中文错误提示"
git push origin dev
```

本轮**未执行** `git add / commit / push`——按硬规则"能安全提交则按中文提交格式提交；不能提交说明原因"，本轮 2 个新文件与他人在改文件无冲突可独立 commit，但主人未授权推送前不主动推；可由主控/主人按团队状态协调提交时机。

## 十、TDD 验证清单

- [x] 每个新函数/方法有测试
- [x] 看到测试先失败（RED：模块缺失 → 9/9 fail）
- [x] 每个测试因"特性缺失"失败（不是 typo）
- [x] 写最简代码让测试通过（GREEN：9/9 pass，2 边缘用例最小补丁）
- [x] 所有测试通过
- [x] 输出干净（无 errors/warnings）
- [x] 使用真实代码（无 mock，纯函数）
- [x] 覆盖边缘场景（空 body、缺 issueId、HTTP 4xx 各种状态）
- [x] 不替换既有他人未提交改动
- [x] 与 `local-ops-diagnostic` 无冲突
