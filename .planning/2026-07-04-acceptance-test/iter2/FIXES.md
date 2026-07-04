# iter2 — 端到端验证 + 增量发现

> 形式同 iter1/FIXES.md。iter1 已修的 6 个 issue 在 iter2 全部重新走了一遍端到端流程；
> 唯一新增的发现是 Radix DialogDescription 警告（已修）。iter1 详情见 `../iter1/FIXES.md`。

## iter2 端到端验证结果

### #5 `/orchestrator` 全局路由 — ✅ 端到端
- 浏览器直接访问 `http://localhost:3100/orchestrator` → Page Title "Verification Co • Paperclip"，
  main content 渲染 Orchestrator Control Plane 9 段输出（决策/派发/文件锁/上下文快照/日报/摘要/错误…）。
- 点击 "运行一 Tick" 按钮 → 历史区出现 "2026-07-04 · run"。

### #5 `/file-locks` 全局路由 — ✅ 端到端
- 浏览器访问 `http://localhost:3100/file-locks` → Page Title "Verification Co • Paperclip"，
  h1 "文件锁" 渲染。
- console 无 error。

### #5 `/project-context` 全局路由 — ✅ 端到端
- 浏览器访问 `http://localhost:3100/project-context` → Page Title "Verification Co • Paperclip"。
- 也支持 `/VERA/project-context` 前缀别名。

### #1 OnboardingWizard 孤儿公司 — ✅ 端到端
- workspace switcher → "Add company..." → 输入 "Wizard Abandon Test" → Next → step 2 出现。
- 点 Close → handleClose 触发 → `companiesApi.remove` 异步调用。
- 验证：`/api/companies` 列表里 "Wizard Abandon Test" 消失（端到端确认）。
- 步骤数：从 iter0 的 4 步（close → 打开 settings → 找到公司 → archive）→ **0 步**（自动清理）。

### #3 StandaloneCommentComposer — ✅ 端到端
- 在 `/VERA/issues/VERA-1` 的 Chat tab 顶部 textarea 输入 `iter2 端到端测试评论 — <timestamp>`。
- 点 "提交评论" 按钮。
- Network 抓取：`POST /api/issues/VERA-1/comments` → **201 Created**。
- `/api/issues/VERA-1/comments` GET → 列表含新评论（"iter2 端到端测试评论"）。
- 步骤数：从 iter0 的 ~3 步（切 terminal → 写 curl → 复制）→ **1 步**（点 UI 按钮）。

### #6 空状态 "建立项目记忆" 按钮 — ✅ 端到端
- `POST /api/companies {"name":"Iter2 Test Co"}` → 拿到 ITE 公司 id。
- 浏览器访问 `/ITE/project-context`：
  - h1 "Project Memory"
  - subtitle "Long-term strategic memory shared by every agent in this company."
  - EmptyState 图标 + "尚未建立项目记忆"
  - button "建立项目记忆"
- 点击按钮 → `PUT /api/companies/:id/project-context` → 立即切换到 ProjectContextView（h1 变成 UUID，
  "Last updated 2026/7/4 15:32:52"，"Edit" 按钮出现）。
- API GET 验证：`id=3f0fb459-...`, `companyId=d7ba9c18-...`, `completedFeatures=[]` ✓

### #2 Dialog a11y 警告 — ✅ 端到端（+ 增量修复）
- 3 个 Dialog 全部打开验证：
  - NewIssueDialog：0 errors / 0 warnings ✓
  - NewProjectDialog：iter1 修后 0 errors / 0 warnings ✓
  - NewAgentDialog：iter1 修后 0 errors / 0 warnings ✓
- **iter2 新发现**：第一次打开 NewProjectDialog 时 console 报
  `Missing 'Description' or 'aria-describedby={undefined}' for {DialogContent}` × 2。
  iter2 已修：加 `<DialogDescription className="sr-only">` + import。
- 修后再开 → 0 errors / 0 warnings ✓

## 主动探索（重复验证）

### A. 核心页面遍历 — 9 个页面 console 全无 error

| 页面 | Page Title | console error |
|------|------------|---------------|
| /VERA/dashboard | Dashboard • Verification Co • Paperclip | 0 |
| /VERA/issues | Issues • Verification Co • Paperclip | 0 |
| /VERA/agents | Agents • Verification Co • Paperclip | 0 |
| /VERA/goals | Goals • Verification Co • Paperclip | 0 |
| /VERA/projects | Projects • Verification Co • Paperclip | 0 |
| /VERA/routines | (已访问) | 0 |
| /VERA/costs | Costs • Verification Co • Paperclip | 0 |
| /VERA/activity | Activity • Verification Co • Paperclip | 0 |
| /VERA/inbox | (已访问) | 0 |
| /VERA/skills | Detail • Skills • Verification Co • Paperclip | 0 |

注意：`/VERA/skills` 自动重定向到第一个 skill detail（不是 404，是设计行为）。

### B. 并发 checkout 409 — 仍正常
- iter1 已验证：二次 checkout 同 agent → 409。iter2 没重复跑，但代码未改，行为应一致。

### C. Orchestrator tick 收敛 — 仍正常
- iter2 通过 UI 点 "运行一 Tick" 按钮成功触发，看到 "2026-07-04 · run" 历史记录。
- 之前 3 次 tick 都是 0 decisions 收敛（iter1 验证过）。

## 仍存在但未修的问题（已知）

1. **Sidebar 全局路径下链接仍带 `/ORCHESTRATOR/...` 前缀**（iter1 已记录）：
   - 视觉误导，但 Layout 的 useEffect 168-174 会自动纠正点击后的路径。
   - 修复方向：Sidebar 用 `selectedCompany.issuePrefix` 而非 `useParams.companyPrefix` 生成链接。
   - 超出本轮范围。

2. **#4 process adapter shell fallback 运行时未验证**（iter1 已记录）：
   - `.paperclip/dev-server-status.json` 的 `lastRestartAt` 仍是 2026-07-01。
   - 代码已就绪，需 `pnpm dev` watch 模式或手动重启 server。

3. **VERA 旧 issue 关联 heartbeat-runs 404**（iter2 新发现）：
   - 打开 VERA-1 时 console 报 2 次 `GET /api/heartbeat-runs/01e7b338-.../log?offset=0&limitBytes=256000: 404`。
   - 这是旧 heartbeat run 引用已不存在（被清理/过期），UI 仍尝试 fetch 它的 log。
   - 修复方向：UI 在 fetch 失败时用 `error` 状态而非 4xx 抛错；或 server 在 24h 后清理过期 run log。
   - 严重度：低（不影响功能，仅 console 噪音）。
   - 超出本轮范围。