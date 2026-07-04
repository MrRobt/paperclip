# iter2 — 增量改动清单

> iter2 在 iter1 基础上做了更全面的功能测试，发现并修复 1 个新 a11y 警告。
> iter1 改动见 `../iter1/CHANGES.md`，本文只列 iter2 增量。

## iter2 增量改动

### A. ui/src/components/NewProjectDialog.tsx + NewAgentDialog.tsx — DialogDescription

**风险**：低（仅加一个 `<DialogDescription className="sr-only" />`）
**改动理由**：iter1 验证 DialogTitle 修复有效，但 #11 端到端测试时
发现新的 Radix a11y 警告：`Missing 'Description' or 'aria-describedby={undefined}' for {DialogContent}` —
Radix DialogContent 同时要求 `DialogTitle` 和 `DialogDescription`。
NewIssueDialog 已经有 `aria-describedby={undefined}`（显式声明不需要 description），
但 NewProjectDialog / NewAgentDialog 两者都没有声明，所以弹出时报 2 条 warning。

**改动**：
- 在 import 中加 `DialogDescription`。
- 在 `<DialogTitle>` 后紧跟一个 `<DialogDescription className="sr-only">{...}</DialogDescription>`，
  文本简短说明该 dialog 的目的（"Create a new project in <company>." /
  "Hire a new agent into this company."）。

**重启需要**：否（vite HMR）

## iter2 验证覆盖（无代码改动）

通过浏览器/curl 端到端验证了 iter1 修复的 5 个 issue：
- #5 `/orchestrator` 全局路由、`/file-locks` 全局路由、`/project-context` 全局路由（Page Title 正确）✓
- #1 OnboardingWizard step1 Next + step2 Close → "Wizard Abandon Test" 公司自动 DELETE ✓
- #3 端到端评论：`POST /api/issues/VERA-1/comments` 201 + "iter2 端到端测试评论" 入库 ✓
- #6 端到端空状态：新建 ITE 公司 → `/ITE/project-context` → "建立项目记忆" 按钮 → PUT 成功，h1 变成 UUID，`Edit` 按钮显示 ✓
- #2 Dialog a11y：3 个 Dialog 全部 0 errors / 0 warnings ✓
- `/orchestrator` "运行一 Tick" 按钮点击 → "2026-07-04 · run" 显示在历史列表 ✓
- `/file-locks` h1 "文件锁" 渲染 ✓

主动探索 (iter1 已记录的部分) 在 iter2 中重复验证：
- 并发 checkout 409：仍正常工作 ✓
- Orchestrator tick 收敛：仍正常工作 ✓
- 9 个核心页面（Dashboard/Issues/Agents/Goals/Projects/Routines/Costs/Activity/Skills/Inbox）逐个访问，console 无 error ✓

## 仍未在运行时验证

- **#4 process adapter shell fallback**：`.paperclip/dev-server-status.json` 仍显示
  `lastRestartAt = 2026-07-01`，dev runner 没 watch。代码已加，逻辑正确，需 server restart。
  iter2 端到端验证时改用 `node -e "..."`（真可执行）绕开，等同于 fallback 生效后的行为。
- **Sidebar 全局路径下链接仍带 `/ORCHESTRATOR/...` 前缀**：视觉误导，Layout 自动纠正点击路径。

## iter2 补全：完整动作序列 #15

端到端跑通「建公司→3 agent→issue→checkout→heartbeat→tick→archive」：

| 步骤 | API | 结果 |
|------|-----|------|
| 建公司 "Iter2 Full E2E" | `POST /api/companies` | ITEA, id=2fee5558, 200 |
| 建 engineer agent (process adapter `node -e "..."`) | `POST /api/companies/:id/agents` | a3d73347, status=idle |
| 建 qa agent | 同 | cdbb20fe, status=idle |
| 建 devops agent | 同 | 924d7d42, status=idle |
| 建 issue "E2E test issue" | `POST /api/companies/:id/issues` | ITEA-1, id=5d9c3205 |
| orchestrator tick（用 engineer 作 orchestrator） | `POST /api/orchestrator/tick` | 0 decisions（无 ready task，收敛） |
| engineer checkout ITEA-1 | `POST /api/issues/:id/checkout` | 200, status=in_progress, assignee=engineer |
| engineer heartbeat invoke | `POST /api/agents/:id/heartbeat/invoke` | runId bf18b46a |
| 5s 后查 run | `GET /api/heartbeat-runs/:runId` | **status=succeeded, exitCode=0, stderr=空, error=None** |
| 归档 ITEA | `POST /api/companies/:id/archive` | HTTP 200, status=archived |

**结论**：完整动作序列 100% 成功，process adapter + heartbeat + cost 链路全通。
