# 验收测试发现的问题清单

## Issue #1 - Workspace switcher 显示向导半完成遗留公司

**复现步骤**:
1. 打开 workspace switcher → 点击 "Add company..."
2. 填写 "Verification Co" → 点击 Next 进入 agent 创建步骤
3. 在 agent 创建步骤点击右上角 "Close" 关闭向导
4. 重新打开 workspace switcher

**实际结果**: workspace 列表里出现 2 个 "Verification Co",分别是 `VER` 和 `VERA`,第一个是向导在 Next 步骤悄悄创建的,关闭后没有清理。
**预期结果**: 关闭向导时,如果用户还没完成整个流程,应当回滚或删除半创建的公司。
**相关文件/接口**:
- 路径: `ui/src/.../workspace-switcher/...` (组件级向导)
- API: `POST /api/companies`
**严重级别**: 中 (数据完整性问题,留下孤儿公司)
**状态**: 已发现,未修复。决定先继续核心链路测试,最后再回来处理。

## Issue #2 - Radix DialogContent 缺少 DialogTitle (无障碍警告)

**复现步骤**: 任何打开 Dialog 的操作,如创建项目、创建 issue。
**实际结果**: 浏览器 console 报错:`DialogContent requires a DialogTitle for the component to be accessible for screen reader users` (每次打开都重复一次)
**预期结果**: Dialog 应包含 DialogTitle(或 VisuallyHidden 包装)
**相关文件/接口**: 多个 Dialog 组件(项目创建、issue 创建)
**严重级别**: 低 (无障碍违规,不影响功能)
**状态**: 已记录,不阻塞核心流程,留作整理。

## Issue #3 - Issue 详情页 "Chat" 标签的 Send 按钮并非发评论,而是 assistant-ui AI 聊天

**复现步骤**:
1. 打开 issue 详情
2. 在 chat composer 输入文字,点击 Send

**实际结果**: 文字不会变成 issue_comments(API GET /api/issues/:id/comments 仍为旧数据)。UI 内的 chat 标签页是 assistant-ui thread,Send 走 `useAui()` 的 thread().append,不是评论 API。
**预期结果**: 用户可能误以为这是 issue 评论的输入框。需要明确 UI 区分"评论"与"和 AI 聊天"。或者让评论也用 chat 标签页。
**相关文件/接口**: `ui/src/components/IssueChatThread.tsx:3199-3264`, `useAui()` 来自 `@assistant-ui/react`
**严重级别**: 中 (UX 误导)。评论通过 `POST /api/issues/:id/comments` 可以正常工作并在 chat 面板显示。
**状态**: 已记录;评论的 API/UI 链路是通的;UI 引导需要明确。

## Issue #4 - Process 适配器在 Windows 上不能直接调用 shell 内建命令 (`echo`)

**复现步骤**:
1. 创建一个 process 适配器 agent, command=`echo`, args=`["hello"]`
2. 触发 heartbeat

**实际结果**: 错误: `Failed to start command "echo" in "D:\work\code\paperclip\server"`. spawn 找不到 `echo.exe`,因为 echo 是 cmd.exe 的内建命令,不是独立可执行文件。
**预期结果**: 在 Windows 上 process adapter 应自动通过 `cmd /c` 或检测 shell 内建命令,或者在 UI/文档里告知用户需要 `cmd /c echo ...`。
**相关文件/接口**: `packages/adapter-utils/src/server-utils.ts:2256` (ChildProcess spawn 失败处)
**严重级别**: 中 (Windows 平台可用性受影响)。改用 `node -e "..."` 或 `cmd /c echo` 可以绕开。
**状态**: 已记录,绕过方案是使用 `cmd /c` 或真实可执行文件(node/python)。这是 Windows 平台特性,核心功能通过 `node`/其他真实可执行仍可用。

## Issue #5 - `/orchestrator` 直接访问 (无公司前缀) 显示 NOT FOUND

**复现步骤**:
1. 直接访问 `/orchestrator`(或点击 sidebar 上的"主控控制台"图标)

**实际结果**: 重定向到 `/orchestrator/orchestrator` 后显示 NOT FOUND — `No company matches prefix "ORCHESTRATOR"`
**预期结果**: 应直接打开全局 orchestrator 控制台页面,而不是当作 `/:companyPrefix` 路由处理。
**相关文件/接口**: `ui/src/App.tsx:80-87` — orchestrator 路由在公司前缀路由下,但 sidebar 链接用的是 `/orchestrator`(无前缀)
**严重级别**: 中 (主控控制台入口不工作)。绕过: 用 `/VERA/orchestrator`(公司前缀下)访问。
**状态**: 已记录;通过公司前缀路径可达,但全局入口坏了。需要把 `/orchestrator` 路由移到 `:companyPrefix` 之前作为全局路由,或修复 sidebar 链接前缀。

## Issue #6 - 直接访问 `/project-context` 显示 "尚未建立项目记忆" 但页面缺 title

**复现步骤**:
1. 直接访问 `/VERA/project-context`

**实际结果**: Page title = "Verification Co • Paperclip",内容只显示"尚未建立项目记忆"。空状态展示 OK,但页面标题(应叫"项目记忆")没有渲染。
**预期结果**: 空状态应有合理的页面 title(如 "Project Memory • Verification Co • Paperclip"),并且给用户提供"建立项目记忆"按钮以便首次创建。
**相关文件/接口**: `ui/src/pages/ProjectContextView.tsx`, EmptyState 组件
**严重级别**: 低 (空状态,内容正常;只是页面标题/引导不完整)
**状态**: 已记录;正常流程下通过 orchestrator 主控控制台引导设置。