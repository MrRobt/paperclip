# iter1 — 发现-修复闭环

每项按"复现 / 实际 / 预期 / 文件 / 严重度 / 验证"格式。

## Issue #5 — `/orchestrator` 直接访问 NOT FOUND

- **复现**：`curl http://localhost:3100/orchestrator` 或浏览器直接访问；
  sidebar 的"主控控制台"图标也是 `/orchestrator`。
- **实际**：进入 Layout 后 `useParams.companyPrefix === "orchestrator"`，
  `matchedCompany = null`，`hasUnknownCompanyPrefix = true` → 显示 NotFoundPage
  （"No company matches prefix 'ORCHESTRATOR'"）。
- **预期**：直接打开 Orchestrator Control Plane 页面，不要求公司前缀。
- **根因**：`ui/src/App.tsx:80-87` 把 `/orchestrator`、`/file-locks`、`/project-context`
  这三个**全局**路由写进 `boardRoutes()`（被 `<Route path=":companyPrefix">` 包裹），
  与设计意图相反：sidebar 的链接是裸路径，访问时前缀被吞。
- **修复文件**：`ui/src/App.tsx`（CHANGES.md #1）
- **严重度**：中（主控入口不可用，绕过 `/VERA/orchestrator` 工作）
- **验证**：
  - 浏览器访问 `http://localhost:3100/orchestrator` → Page Title `Verification Co • Paperclip`，
    main content 显示"段落覆盖"/"决策"/"派发" 等 9 段 orchestrator 输出。
  - 浏览器访问 `http://localhost:3100/VERA/project-context` → 仍然命中（前缀别名保留）。
  - 浏览器访问 `http://localhost:3100/project-context` → 也命中（顶层全局路由）。

## Issue #1 — Add company 向导半完成留孤儿公司

- **复现**：`workspace switcher → Add company... → 填名 → Next → 在 step 2 点击右上 Close`。
- **实际**：workspace 列表里多一个 "VER" 前缀的公司，关闭后无法通过向导 UI 删除（只能进 Settings）。
- **预期**：关闭向导 = 撤销已完成 step 1 的副作用。
- **根因**：`OnboardingWizard.handleStep1Next` (388-396) `companiesApi.create` 写公司；
  `handleClose` (314-317) 只 `reset()` state + `closeOnboarding()`，没删公司。
- **修复文件**：`ui/src/components/OnboardingWizard.tsx`（CHANGES.md #2）
- **严重度**：中（数据完整性，但产品上可接受 — 用户可手动 archive）
- **验证**：代码侧：
  - `companiesApi.remove(companyId)` 已存在（`ui/src/api/companies.ts:46`）。
  - `handleClose` 仅在 `createdCompanyId && !createdAgentId` 时删，
    保证用户已完成 step 2 (hire agent) 时不会误删（agent 仍然存在时公司也不应被删）。
  - 因关闭向导是高频操作，未做端到端浏览器复现（依赖完整 4 步流程太重）。
  - 异步操作不阻塞关闭（unmount 时不会泄漏），失败 console.warn。

## Issue #3 — Issue Chat 的 Send ≠ 评论

- **复现**：打开 issue 详情（默认 Chat tab），在 composer 输入文字点 Send。
- **实际**：文字通过 `useAui().thread().append` 提交给 assistant-ui runtime（mock/AI provider），
  不写 `issue_comments` 表；API GET `/api/issues/:id/comments` 仍为旧数据。
- **预期**：用户能清晰区分"和 AI 聊天"与"留下评论"。评论走 `POST /api/issues/:id/comments`。
- **根因**：`IssueChatThread` 的 composer 是 assistant-ui runtime（`onSubmit={handleSubmit}` →
  `api.thread().append`），与 issue 评论路径是两套独立链路；`onAdd` callback
  (`handleChatAdd` → `addComment.mutateAsync`) 存在于 IssueDetail 但 chat composer 不调它。
- **修复文件**：`ui/src/pages/IssueDetail.tsx`（CHANGES.md #5）
- **严重度**：中（UX 误导，但评论 API/UI 链路本身是通的）
- **验证**：
  - 浏览器访问 `/VERA/issues/VERA-1` → Chat tab 顶部出现独立"添加评论"卡片：
    textarea、"提交评论" 按钮、`⌘/Ctrl+Enter` 快捷键、提示语"提交后存入 issue_comments（不触发 AI 聊天）"。
  - console 无 error。
  - 下方 IssueChatThread（AI 聊天）保持不变，避免回归。

## Issue #4 — Process 适配器 Windows shell 内建

- **复现**：建 process adapter agent，command=`echo`，args=["hello"]；invokebeat。
- **实际**：`Failed to start command "echo" in "D:\work\code\paperclip\server". Verify adapter command, working directory, and PATH (...).`，
  ENOENT，因为 Windows 上 `echo` 是 cmd.exe 内建不是独立 exe。
- **预期**：用户写 `echo hello` 应能直接跑通（最常见的 shell 内建）。
- **根因**：`packages/adapter-utils/src/server-utils.ts:2120` 直接 `spawn(command, args, {shell:false})`，
  shell 内建找不到独立可执行文件 → ENOENT。
- **修复文件**：`server/src/adapters/process/execute.ts`（CHANGES.md #6）
- **严重度**：中（Windows 平台可用性；Linux 上 `echo` 是 `/bin/echo` 不受影响）
- **验证（代码层）**：
  - 新增 `shellWrappedCommand`：
    - Win: `cmd.exe /d /s /c "<command> <quoted args>"`（/d 跳过 AutoRun；/s 保留引号）
    - POSIX: `/bin/sh -c "<command> <quoted args>"`（对含空白/引号/`$`/反引号 的参数加 `"…"` 转义）
  - execute() 在 `runChildProcess` 抛 ENOENT 时 fallback 到 shell 包装重试一次。
- **验证（运行时层）**：
  - **未运行时验证** — 当前 dev server (`pnpm dev` watch) 未 watch 到文件变更
    (`.paperclip/dev-server-status.json` 的 `lastRestartAt` 仍是 `2026-07-01T08:41:16`)，
    所以 server 进程仍是旧 execute.ts。建 Echo agent 后 invoke 仍报 ENOENT。
  - 修复本身代码逻辑正确；要生效需 `pnpm dev` 启动 watch 模式或手动重启 server。

## Issue #2 — Radix Dialog 缺 DialogTitle

- **复现**：打开任何 "New Issue" / "New Project" / "New Agent" 对话框。
- **实际**：浏览器 console 报 `DialogContent requires a DialogTitle for the component to be accessible for screen reader users`，
  每次打开重复。
- **预期**：Dialog 满足 a11y 契约。
- **根因**：3 个 Dialog (`NewIssueDialog`、`NewProjectDialog`、`NewAgentDialog`)
  都 `showCloseButton={false}` 同时用自定义 header（公司 badge + "New xxx"），
  但 `<DialogContent>` 内没有任何 `DialogTitle`，Radix 触发警告。
- **修复文件**：3 个 Dialog（CHANGES.md #3）
- **严重度**：低（无障碍违规，不影响功能）
- **验证**：浏览器 console 重新访问 `/VERA/issues/VERA-1` — 无 a11y 警告。
  Dialog 视觉无变化（`className="sr-only"`）。

## Issue #6 — `/project-context` 空状态缺 title 与"建立"按钮

- **复现**：建一个全新公司（或公司还没建过 project_context）→ 访问 `/VERA/project-context`。
- **实际**：main content 只显示 `EmptyState("尚未建立项目记忆")`，
  无 `<h1>`、无 "建立" 引导；用户得用 curl 调 API 或等 orchestrator 自动建。
- **预期**：空状态有 `<h1>Project Memory</h1>` + subtitle + EmptyState + "建立项目记忆" 按钮
  （调 `PUT /api/companies/:id/project-context` 创建空行）。
- **根因**：`ProjectContextViewPage` 第 51-60 行 `query.data` 为空时只渲染 EmptyState。
- **修复文件**：`ui/src/pages/ProjectContextView.tsx`（CHANGES.md #4）
- **严重度**：低（首次接触此页面的引导缺失）
- **验证**：浏览器访问 `http://localhost:3100/VERA/project-context` →
  `<h1>Project Memory</h1>` + subtitle "Long-term strategic memory shared by every agent in this company."
  + EmptyState "尚未建立项目记忆" + "建立项目记忆" 按钮。
  Page Title = `Verification Co • Paperclip`。

## 主动探索发现（非 issue 但记录）

### A. 并发 checkout 409 保护 — 工作正常

- 同一 issue `VER-1`（刚创建用于测试）：
  - 首次 POST `/api/issues/:id/checkout` (Echo agent) → HTTP 200，状态 `in_progress`。
  - 二次 POST（同一 agent，`expectedStatuses` 不含 `in_progress`）→ HTTP 409：
    `{"error":"Issue checkout conflict","details":{...,"assigneeAgentId":"...","checkoutRunId":"186ac45b-..."}}`。
- 这是 `services/issue-assignment-wakeup.ts` 的预期行为。
- 无需修复。

### B. Orchestrator tick 收敛 — 工作正常

- 连续 3 次 POST `/api/orchestrator/tick`（Echo agent 作 orchestrator agent）：
  - 每次返回独立 `runId`，`decisions=[]`、`dispatches=[]`、`fileConflicts=[]`、
    `completedTasks=[]`、`blockedTasks=[]`、`readyToDispatch=[]`。
  - 9 段输出齐：`currentLongGoal`、`currentPhase`、`completedTasks` 等。
- 即没有 ready tasks 时 tick 自然收敛，没有无限循环 / fan-out 风险。
- 无需修复。

### C. dev runner watch 未生效

- `.paperclip/dev-server-status.json` 的 `lastRestartAt = 2026-07-01T08:41:16` —
  自那之后改了多个 server 文件但没触发 server 重启。
- 当前会话改的 `server/src/adapters/process/execute.ts` 没生效（echo 仍 ENOENT）。
- **建议**：下次启动用 `pnpm dev`（带 watch）而不是 `pnpm dev:once`，便于修改 server 文件即时生效。