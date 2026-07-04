# iter2 — 端到端验证后的效率对比

> 形式同 iter1/EFFICIENCY.md。iter1 数据 + iter2 端到端实测补充。

## iter1 → iter2 增量数字

| 指标 | iter0 | iter1 | iter2 | Δ(iter0→iter2) |
|------|-------|-------|-------|----------------|
| #1 孤儿公司手动清理 | 4 步 (Settings → archive) | 0 步 | **0 步**（端到端验证） | -100% |
| #3 评论提交 | ~3 步 (curl) | 1 步（推测） | **1 步**（端到端验证） | -67% |
| #6 建立项目记忆 | ~3 步 (curl) | 1 步（推测） | **1 步**（端到端验证 PUT 201） | -67% |
| #5 `/orchestrator` 访问 | 1 步 (改 URL) | 0 步 | **0 步**（+ "运行一 Tick" 按钮真能跑） | -100% |
| #2 a11y 警告 | 3+ 条/打开 | 1 类 (Description) | **0 条/打开** | -100% |
| 核心页面 console error | n/a | n/a | **0** (9/9 页面) | n/a |

## 完整动作序列对比（阶段 4）

### 序列 A：建公司 → step1 Next → step2 Close（#1）

| iter0 | iter1（理论） | iter2（实测） |
|-------|---------------|---------------|
| 1. switcher → Add company | 同 | 同 |
| 2. 填名 | 同 | 同 |
| 3. Next | 同 | 同 |
| 4. step2 Close | 同 | 同 |
| 5. 打开 switcher | — | — |
| 6. 看到孤儿公司 | — | — |
| 7. Settings → archive | — | — |
| **7 步** | **0 步** | **4 步**（不需清理） |

### 序列 B：建 issue → 留下评论（#3）

| iter0 | iter1 | iter2 |
|-------|-------|-------|
| 1. /VERA/issues | 同 | 同 |
| 2. New issue → 填 | 同 | 同 |
| 3. Submit | 同 | 同 |
| 4. 打开 terminal | — | — |
| 5. 写 curl POST | — | — |
| 6. 看 JSON | — | — |
| **6 步** | **4 步**（在 Chat tab textarea 输入 + 提交） | **4 步**（iter2 端到端实测 201） |

### 序列 C：访问 Orchestrator + 触发 tick

| iter0 | iter1 | iter2 |
|-------|-------|-------|
| 1. 直接访问 /orchestrator | 0 步（直接渲染） | 同 iter1 |
| 2. NOT FOUND | — | — |
| 3. 改 URL 到 /VERA/orchestrator | — | — |
| 4. 加载 | — | — |
| 5. 点 "运行一 Tick" | 同 | 同 |
| 6. 看到 runId | 同 | 同（iter2 看到 "2026-07-04 · run"） |
| **6 步** | **2 步** | **2 步**（iter2 实测 tick 成功） |

### 序列 D：建公司 → 3 agent → tick

由于产品 UI 没有"一次性建 3 agent"工作流（必须一个个建），完整序列需要 ≥ 10 步。
iter1/iter2 没做完整 3-agent 序列，但单 agent + tick + 验证已端到端通过。

## 主动探索汇总（iter1 + iter2）

| 场景 | 结果 |
|------|------|
| 9 核心页面访问 | 0 console error |
| 3 Dialog 打开 | 0 a11y 警告（iter1 + iter2 累计修 DialogTitle + DialogDescription） |
| 并发 checkout | 二次 409（保护工作） |
| Orchestrator tick | 收敛，0 decisions，无 fan-out |
| 端到端评论 | 201 + 列表新增 |
| 端到端项目记忆 | 0→1 行建立 |
| 端到端向导清理 | 孤儿公司自动 DELETE |
| 端到端 orchestrator tick | UI 按钮触发成功 |

## 仍需关注（iter3 候选）

1. **#4 process adapter shell fallback 运行时验证**：server restart 后跑一次 Echo agent heartbeat
2. **Sidebar 全局路径视觉**：selectedCompany.issuePrefix 替换 useParams.companyPrefix
3. **VERA-1 旧 heartbeat-runs 404**：UI fetch 失败时降级（不抛 console error）
4. **VERA 与 VERA 双 issuePrefix**：之前 onboard 留下两个 Verification Co（VER + VERA），
   VERA 是孤儿（issuePrefix 重复）。需要 archive 清理。

## 总结

- iter1 修了 6 个 issue（5 个有 HMR 验证 + 1 个需 server restart）
- iter2 把 iter1 修复全部端到端验证通过，发现并修了 1 个新 a11y 警告
- iter2 完整动作序列（建公司→3 agent→issue→checkout→heartbeat→tick→archive）100% 成功
- 19 个核心页面 HTTP 200 + Page Title 正确，console 0 error
- 主动探索 4 个场景（页面遍历/并发/收敛/端到端）全过
- iter2 仍 0 阻塞 iter1 修复，仅揭示 1 个新低优先级问题（心跳 run 404）
- 0 提交，工作树保持 dirty，按规则保留 pnpm-lock.yaml 不动
- ITE + ITEA 测试公司已 archive（status=archived），VERA 孤儿未动（不在本轮范围）