# iter1 — 改动清单

每项含：文件 · 风险等级 · 改动理由 · 是否需要 dev server 重启验证

## 1. ui/src/App.tsx

**风险**：中
**改动理由**：修复 Issue #5。`/orchestrator`、`/file-locks`、`/project-context` 三个
全局页面之前被放进 `boardRoutes()`（即被 `<Route path=":companyPrefix" element={<Layout />}>` 包裹），
导致裸 URL 访问时被解释成 `companyPrefix="orchestrator"` → 命中 NotFoundPage。

**改动**：
- 把这三个路由从 `boardRoutes()` 中挪到顶层 `<Routes>`，各自用 `<Layout />` 包裹，
  这样 sidebar 仍渲染但 `:companyPrefix` 不需要。
- 同时在 `boardRoutes()` 保留这三个路由作为前缀别名（`/VERA/orchestrator` 等），
  防止移除后原本用前缀访问的旧链接断掉。

**重启需要**：否（vite HMR 自动热重载）

## 2. ui/src/components/OnboardingWizard.tsx

**风险**：中（行为变化：半完成向导关闭会删公司）
**改动理由**：修复 Issue #1。`handleStep1Next` 在第 1 步 `Next` 就 `POST /api/companies`，
但 `handleClose` 只 `reset()` state — 关闭向导后孤儿公司留在 workspace switcher。

**改动**：
- `handleClose` 增加：如果 `createdCompanyId` 已存在且 `createdAgentId` 还没设
  （用户没完成 step 2 = 没有 hire agent），异步 `companiesApi.remove(orphanedCompanyId)`，
  然后再 `reset()` + `closeOnboarding()`。
- 失败时仅 console.warn，不阻塞关闭（用户可手动 archive）。

**重启需要**：否（vite HMR）

## 3. ui/src/components/NewIssueDialog.tsx + NewProjectDialog.tsx + NewAgentDialog.tsx

**风险**：低（仅加一个 `<DialogTitle className="sr-only" />`）
**改动理由**：修复 Issue #2。三个对话框原本把 `showCloseButton={false}` 的同时又没用 `DialogTitle`，
Radix Dialog 会输出 a11y 警告（每次打开都重复），并阻止 screen reader 读标题。

**改动**：在 `<DialogContent>` 紧跟一个 `<DialogTitle className="sr-only">{...}</DialogTitle>`，
再补 import。同时确认 3 个文件都加 `DialogTitle` 到 dialog import 列表。

**重启需要**：否（vite HMR）

## 4. ui/src/pages/ProjectContextView.tsx

**风险**：低
**改动理由**：修复 Issue #6。空状态只显示一个 `<EmptyState />` 缺 title，并且无引导"建立"按钮。

**改动**：
- 抽出独立 `ProjectContextEmpty` 组件：加 `h1 "Project Memory"` + subtitle +
  EmptyState + "建立项目记忆" 按钮（`useMutation` 调 `putProjectContext({companyId, nextPriority:"", completedFeatures:[]})`）。
- `selectedCompanyId` 解构补回（修改过程中误删，已修复）。

**重启需要**：否（vite HMR）

## 5. ui/src/pages/IssueDetail.tsx

**风险**：低（新增独立 inline 表单，不影响现有 ChatThread）
**改动理由**：修复 Issue #3。Chat tab 默认显示，composer 的 Send 走 `useAui().thread().append`（AI 聊天），
与"添加评论"混淆；评论走 `POST /api/issues/:id/comments`。

**改动**：
- 在 `IssueDetailChatTab` 顶部、`<IssueChatThread />` 之前插入 `<StandaloneCommentComposer onAdd={onAdd} />`。
- 新组件：textarea + "提交评论" 按钮 + `⌘/Ctrl+Enter` 快捷键 + 提示语
  "提交后存入 issue_comments（不触发 AI 聊天）"。
- 复用 `handleChatAdd` → `addComment.mutateAsync`（即 `issuesApi.addComment`）。

**重启需要**：否（vite HMR）

## 6. server/src/adapters/process/execute.ts

**风险**：中（server 行为变化，spawn 失败时会重试一次）
**改动理由**：修复 Issue #4。Windows 下 `echo`、`dir`、`cd` 是 cmd.exe 内建命令，
Node.js `spawn` 直接调会 ENOENT。用户得手动写 `cmd /c echo ...` 才能跑。

**改动**：
- 新增 `isMissingExecutable(err)`（检查 err.code === "ENOENT"）。
- 新增 `shellWrappedCommand(command, args)`：Win 返回 `cmd.exe /d /s /c "<full>"`，
  POSIX 返回 `/bin/sh -c "<full>"`，对含空白/引号的参数加引号转义。
- `execute()` 用 try/catch 包 `runChildProcess`：若 `ENOENT`，自动用 shell 包装重试一次。
- 失败信息保留原 PATH 提示，但解决了"必须懂 cmd /c 才能用 echo"的入门阻力。

**重启需要**：是（tsx watch 监测文件变更才重启 server；本会话 dev runner 未在 watch，
故未在运行时验证；逻辑单元测试可独立验证 `shellWrappedCommand` 引号转义。）

## 总结

| # | 文件 | 类型 | 风险 | HMR |
|---|------|------|------|-----|
| 1 | ui/src/App.tsx | 路由结构 | 中 | ✅ |
| 2 | ui/src/components/OnboardingWizard.tsx | 行为 | 中 | ✅ |
| 3 | NewIssueDialog/NewProjectDialog/NewAgentDialog | a11y | 低 | ✅ |
| 4 | ui/src/pages/ProjectContextView.tsx | UI/状态 | 低 | ✅ |
| 5 | ui/src/pages/IssueDetail.tsx | UI | 低 | ✅ |
| 6 | server/src/adapters/process/execute.ts | spawn fallback | 中 | ❌ server restart |

未触碰：pnpm-lock.yaml、git commit/push（按规则保持工作树 dirty）。