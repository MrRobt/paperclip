# iter1 — 修复前后步骤数 / 失败次数 / UX 差异

> 同一动作序列：**建公司 → 选 process 适配器（echo）→ 触发 heartbeat → 留下 issue 评论 → 访问 /orchestrator /project-context**

## 1. 路径 #1：建公司 → 走完 onboarding 向导 → 触发 process adapter

| 阶段 | iter0（修复前） | iter1（修复后） |
|------|----------------|----------------|
| 在 workspace switcher 点 "Add company..." | ✅ | ✅ |
| step1 填名 + Next → 偷偷创建孤儿公司 | 已创建 | ✅ 仍创建（必要） |
| 在 step2 右上角 X 关闭向导 | ✅ | ✅ |
| **结果** | workspace 多一个 "VER" 孤儿 | ✅ 自动 DELETE，列表保持原状 |
| 创建 process adapter agent (echo) | ✅ | ✅ |
| invoke heartbeat | ❌ ENOENT（用户得手动改 `cmd /c echo`） | ❌ ENOENT（fallback 需 server 重启，**仍未生效**） |
| invoke heartbeat（用 `cmd /c echo hello`） | ✅ | ✅ |

**iter1 步骤数**：与 iter0 相同（向导关闭 1 步）。**额外手动清理**：0（iter0 需要去 Settings 手动 archive）。

## 2. 路径 #2：issue 评论

| 阶段 | iter0 | iter1 |
|------|-------|-------|
| 进入 issue 详情页 | Chat tab | Chat tab |
| 在 Chat composer 输入 + Send | ❌ 写入 AI chat thread，**不是** issue_comments | 同左（不破坏现有 chat） |
| 找到"添加评论"入口 | ❌ 无（需用 curl） | ✅ Chat tab 顶部独立 textarea + "提交评论" + `⌘/Ctrl+Enter` |
| 提交评论步骤数 | 切到 terminal + curl | **1 步**（在 UI 内） |

**iter1 步骤数**：从 ~3 步（切 terminal → 写 curl → 复制粘贴） → **1 步**（在 UI 内点提交）。
**失败次数**：0（`addComment.mutateAsync` + optimistic update 链路已在用）。

## 3. 路径 #3：访问全局控制台

| 阶段 | iter0 | iter1 |
|------|-------|-------|
| 点击 sidebar "主控控制台" | ❌ 跳 `/orchestrator` → NOT FOUND | ✅ 加载 Orchestrator Control Plane 9 段输出 |
| 访问 `/orchestrator` URL 直接 | ❌ NOT FOUND | ✅ 渲染（+ sidebar 自动纠正 prefix 到 VERA） |
| 访问 `/VERA/orchestrator` URL | ✅ 可用 | ✅ 仍可用（前缀别名保留） |

**iter1 步骤数**：从 1 步（NOT FOUND 后人工改 URL）→ **0 步**（直接可用）。

## 4. 路径 #4：空 project-context 引导

| 阶段 | iter0 | iter1 |
|------|-------|-------|
| 新公司访问 `/project-context` | 只有"尚未建立项目记忆" + 无 title | ✅ h1 "Project Memory" + subtitle + "建立项目记忆" 按钮 |
| 建立首条 context | curl PUT `/api/companies/:id/project-context` | 点"建立项目记忆"按钮（1 步） |
| Page Title | `Paperclip` | `Verification Co • Paperclip`（正确） |

**iter1 步骤数**：~3 步（curl PUT）→ **1 步**（点按钮）。

## 5. 路径 #5：Radix a11y 警告

| 阶段 | iter0 | iter1 |
|------|-------|-------|
| 打开 New Issue 对话框 | console.warn 1 条 | 无 |
| 打开 New Project 对话框 | console.warn 1 条 | 无 |
| 打开 New Agent 对话框 | console.warn 1 条 | 无 |

**iter1 步骤数**：N/A（a11y，无用户操作步骤），但 console 噪音降低 100%。

## 6. 主动探索（无 issue 的正确行为）

### 并发 checkout 409

| 阶段 | 行为 |
|------|------|
| 同一 issue、同一 agent、连续 2 次 checkout | 第 1 次 HTTP 200，第 2 次 HTTP 409 (`Issue checkout conflict`) |
| `services/issue-assignment-wakeup.ts` 保护 | ✅ 工作正常 |

### Orchestrator tick 收敛

| 阶段 | 行为 |
|------|------|
| 连续 3 次 tick，无 ready tasks | 每次独立 runId，0 decisions、0 dispatches、0 fileConflicts、0 readyToDispatch |
| 9 段输出齐 | ✅ `currentLongGoal` / `currentPhase` / `completedTasks` / 等 |

## 7. 总体数字

| 指标 | iter0 | iter1 | Δ |
|------|-------|-------|---|
| 用户需要手动的"补救步骤"总数（建公司后清理 / curl 评论 / 改 URL） | 6 步/场景 | 0–1 步/场景 | **-83%** |
| 浏览器 console 警告（每次打开 3 个对话框） | 3 条 × N 次 | 0 | **-100%** |
| NOT FOUND 错误（全局页面） | 3 个 URL 都中 | 0 | **-100%** |
| Echo 适配器直接可用 | ❌ | ❌（代码已加，待 server restart） | **n/a（运行时未验证）** |
| 数据完整性孤儿 | 1/向导关闭 | 0/向导关闭 | **-100%** |
| 空状态首次建立成本 | curl PUT | UI 按钮 | **-67%** |
| 新增 console error 数（本次修复引入） | — | 0 | **0** |
| 新阻塞 | — | dev server 未 watch，#4 fallback 待 server restart | 1 |

## 8. 新阻塞

1. **`pnpm dev` 当前会话不是 watch 模式**：`.paperclip/dev-server-status.json` 的
   `lastRestartAt = 2026-07-01T08:41:16` 表明 server 未在监听文件变更。
   Issue #4 的 fallback 代码已写但未在运行时验证；需 `pnpm dev` 重启或单独重启 server。
2. **Sidebar 在 `/orchestrator` 全局路径下的链接仍带 `/ORCHESTRATOR/...`**：
   Layout 内的 `useEffect` 168-174 会自动纠正点击后的路径（因为 `companyPrefix !== matchedCompany.issuePrefix`），
   所以视觉误导但功能正确。优化方向：Sidebar 用 `selectedCompany.issuePrefix` 替代 `useParams.companyPrefix`
   生成链接（已在 `Sidebar.tsx` import selectedCompany 但没看到使用），但这超出 #5 修复范围，留作下一轮。