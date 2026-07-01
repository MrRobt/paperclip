# 自我解决推进 Agent 团队 — 综合计划

> 日期：2026-06-30
> 状态：架构方案，进入分阶段实施
> 关联计划（前置基线，不可重复定义）：
> - `2026-05-26-skills-cli-catalog-contract.md` — Skills catalog 契约
> - `2026-06-05-cmpaa-121-self-console-phase2-product-plan.md` — 自家控制台二阶段：团队模式、单人单高优、六件套门禁
> - `2026-06-05-cmpaa-122-dispatch-architecture.md` — 调度二阶段架构：状态机分离、恢复链降噪、条件唤醒
> - `2026-06-08-paperclip-agent-delivery-system-full-realtime-plan.md` — 完整实时交付系统：诊断、草稿、模型健康、完成证据
> - `2026-06-09-agent-legion-autonomous-delivery-system.md` — Agent 军团自主交付（Phase 0–7）

---

## 0. 为什么还需要这份计划

前述 5 份计划合计已经把"派活 → 执行 → 复审 → 验收 → 纠偏"的人机协同闭环做到了产品级。剩下的 gap 是 **"自我解决"** —— 系统在不依赖人类干预的前提下，把一个产品级目标从 `planning` 推到 `completed` 的能力。三件事前序计划都没覆盖：

1. **硬验证取代 LLM 自评**。当前 `legion.tasks.ts:108 verify` 路由让 LLM 读 task + handoffs + verificationCriteria 自由文本，自己判过没过。对编程团队而言这等同于"开发者说写完了"。
2. **跨 run 的记忆与自我修正**。每次 heartbeat 拿到的是同一个空 prompt，没有"上次我们改 billing 失败因为 X"这类组织记忆。
3. **自修改的安全回路**。Agent 能改自己的 prompt / skill / 流程，但没有 eval-as-gate，错误改动会沉默生效。

加上"系统提示词 + Harness 工程"两层 meta 调整，这就是本计划的范围。

---

## 1. 北极星（Strategic North Star）

### 1.1 终态定义

> 一个 Paperclip company 收到一段自然语言目标（"为新增 OAuth 登录能力补全 E2E 测试"），能在 **不触碰 board 用户** 的前提下，完成：分解 → 调度 → 执行 → 硬验证 → 自动合入 → 复盘沉淀，且 **自我评估每一次失败并把学到的写回组织记忆**。

### 1.2 可测量验收（Kill switches）

| 指标 | 当前基线 | 目标态 |
|:---|:---|:---|
| P2 issue 无人工触碰关单率 | 估算 <30% | ≥90% |
| 单任务（1–3 工日）平均关单墙钟时长 | 不确定 | ≤30 分钟 |
| 硬验证首次通过率 | 0%（LLM 自评） | ≥85% |
| 跨 run 经验复用次数（agent 读到 postmortem 并采用） | 0 | ≥30% 任务命中至少一条 |
| 自修改 proposal 落地后 eval 红→绿转化 | 0% | ≥70% 红→绿，0% 静默回退 |
| Board 用户被叫醒频率（每天） | 任意 | P3 及以下 ≤2 次/天 |

### 1.3 边界（Non-goals for now）

- 跨 company 记忆共享（公司隔离是产品核心，先严守）。
- 取代 board 决策（hire/terminate/大额预算仍人工）。
- 自修改 verification harness 本身（这是安全边界）。
- 跨编程语言栈的通用 E2E（先聚焦 ts/js + python，其余靠 plugin）。

---

## 2. 系统提示词调整（System Prompt）

三层都要动：**Paperclip 运行时 agent**、**Skills catalog**、**Claude Code 开发期**。当前 `goal-decomposer.ts:22` 的 `DECOMPOSE_SYSTEM_PROMPT` 仍然是中文硬编码、要求模糊（"验收：..."自由文本），这是第一处要改的。

### 2.1 Paperclip 运行时 Agent 提示词

#### A. 替换 `DECOMPOSE_SYSTEM_PROMPT`（`server/src/services/goal-decomposer.ts:22`）

```text
You are a staff architect. Decompose the goal into an executable task DAG.

Hard requirements:
1. Each task MUST have a `verification_spec` — a structured list of executable
   checks. The only accepted check kinds are:
     - run-tests: { command, cwd, expectedExit }
     - typecheck: { command, cwd, expectedExit }
     - lint: { command, cwd, expectedExit }
     - build: { command, cwd, expectedExit }
     - file-exists: { path }
     - http-probe: { method, url, expectStatus, expectBodyContains? }
     - custom-exit-zero: { command, cwd, timeoutSec }
   Free-text "验收：..." is FORBIDDEN. Decompose fails closed if any task lacks
   a parseable verification_spec.
2. Each task's `required_skills` MUST be a subset of the company skill catalog.
3. Each task MUST list its dependencies by **task id** within the same goal.
   Cross-goal dependencies are not allowed.
4. Default to parallel where the verification_spec is independent. Avoid serial
   chains unless one task produces a handoff the next consumes.
5. Estimated duration in minutes. Anything above 240 MUST be split.

Return JSON. No prose. Schema enforced by zod on the server side.
```

#### B. 替换 verify 提示词（`server/src/routes/legion.tasks.ts:121`）

```text
You are a release engineer reviewing structured verification evidence.

Inputs you will receive:
- task (description, dependencies, handoffs)
- verification_evidence: list of { kind, command, exit_code, stdout_tail, stderr_tail, duration_ms }
- hard_verification_passed: boolean — derived from exit codes; you cannot override it.

Rules:
1. If hard_verification_passed === false → output passed=false and quote the failing
   check verbatim. Do NOT summarize the failure as "agent said it worked".
2. If hard_verification_passed === true → summarize WHY each check succeeded in
   one sentence each. Quote key output excerpts.
3. Output JSON {passed, summary, issues[]}.
```

#### C. 新增自描述："为什么我失败"的提示词（在 `legion-monitor.handleTimeouts` 触发重试时注入）

```text
This is attempt N of {max_attempts}. Previous attempts failed with:
- attempts[].verification_evidence (structured)
- attempts[].verification_summary (LLM interpretation)
- attempts[].commit_hash, branch, changed_files

Required of you this attempt:
1. Read the prior failure before doing anything.
2. State a one-paragraph hypothesis of the root cause.
3. Make the SMALLEST change that addresses the root cause, not a redo.
4. If the failing check is environmental (missing tool, wrong cwd), fix the
   environment and re-run before touching code.
```

### 2.2 Skills catalog 调整

复用 `packages/skills-catalog/catalog/bundled/` 的目录结构与 frontmatter 契约（`2026-05-26-skills-cli-catalog-contract.md` 已有强校验），新增三个 skill：

#### A. `bundled/quality/hard-verification-authoring/`

```yaml
---
name: hard-verification-authoring
description: Author a verification_spec for a task so it can be evaluated by command exit codes, not human review.
key: paperclipai/bundled/quality/hard-verification-authoring
recommendedForRoles: [engineer, qa]
tags: [verification, acceptance, automation]
---
```

要点：
- 何时用 / 何时不用。
- 七种 check kind 的选择矩阵（见 2.1.A）。
- 反模式："人工 review 通过"、"看起来对"、"code reviewer 同意"。
- 与 `qa-acceptance` skill 的区别：这个产出 `verification_spec`（机器可读），qa-acceptance 产出 Given/When/Then（人可读）。

#### B. `bundled/paperclip-operations/legion-self-solving/`

```yaml
---
name: legion-self-solving
description: Rules every Paperclip agent must follow when working inside a Legion goal loop — fail closed, run hard verification, log postmortems.
key: paperclipai/bundled/paperclip-operations/legion-self-solving
recommendedForRoles: [engineer, reviewer, qa, pm]
tags: [paperclip, legion, self-solving, safety]
---
```

要点（精炼版）：
1. Never call a task done without reading the structured `verification_evidence`.
2. If you cannot express your completion as a verification_spec, escalate.
3. Before opening a PR, the `github-pr-workflow` skill applies.
4. After each attempt (success or failure), write a `task_postmortem` via
   `paperclipai memory record`. Required fields: root_cause_class, fix_summary,
   commit_hash, files_touched, lessons (≤3 bullets).
5. Skill / prompt modifications: must go through `paperclipai skill propose`
   (eval-as-gate) — never edit a skill file in place.

#### C. `bundled/paperclip-operations/goal-decomposition/`

包装现有 decomposer 行为为 skill，让"如何拆"成为可教学的模式而不是埋在 service 里的硬编码 prompt。

### 2.3 Claude Code（开发期）提示词调整

仓库根 `CLAUDE.md` 刚已落地。在此之上增加一条项目级 subsection：

```md
## Paperclip-specific working rules

- When touching Legion components (`server/src/services/{goal-decomposer,
  task-scheduler, legion-*}.ts`, `routes/legion.*.ts`, `migrations/0096_*`–
  `0099_*`), verify hard: `pnpm db:migrate && pnpm --filter
  @paperclipai/server typecheck && pnpm --filter @paperclipai/server test`.
  The harness depends on these contracts; do not relax them without a plan.
- When changing skill catalog (`packages/skills-catalog/catalog/`), regenerate
  the manifest in the same commit: `pnpm --filter @paperclipai/skills-catalog
  build:manifest`. CI runs validate; out-of-sync manifests break the build.
- When writing agent prompts, follow the `paperclipai skill propose` flow
  (eval-as-gate), not direct edits. See doc/plans/2026-06-30 §2.4.
- Use codegraph (`codegraph_context`, `codegraph_trace`) for any "how does X
  work" question before grep. This codebase has a high structural complexity.
- Do NOT edit `pnpm-lock.yaml`. CI owns it.
```

另外对全局 harness 的建议（落到用户级 `~/.claude/CLAUDE.md` 或 OMC 设置）：

```md
## harness rule additions for Paperclip development

- After every non-trivial edit, run the smallest targeted verification:
  - schema change → `pnpm db:check:migrations`
  - server service → `pnpm --filter @paperclipai/server test <pattern>`
  - ui page → `pnpm --filter @paperclipai/ui test <pattern>`
  - skill catalog → `pnpm --filter @paperclipai/skills-catalog validate`
  Reserve repo-wide `pnpm typecheck && pnpm test` for PR-ready handoff.
- When proposing plan-level changes, write to `doc/plans/YYYY-MM-DD-<slug>.md`
  before coding. One plan, one PR cluster.
```

---

## 3. Harness 工程调整（Harness Engineering）

"Harness" 指 agent 工作环境的工具链与门禁。需要新增 5 个能力，均与现有 service / route 一一对应。

### 3.1 验证 Harness：`paperclipai verify <taskId>`

**位置**：`cli/src/commands/verify.ts` + `server/src/services/verification-runner.ts`

**职责**：
- 读取 task 的 `verification_spec`（见 §4.1 schema）
- 在隔离 worktree 中并行执行所有 check，捕获 `{kind, command, exit_code, stdout_tail, stderr_tail, duration_ms}`
- 写入 `task_verifications` 表（一等公民，可重放、可对比）
- 返回 `VerificationReport` JSON

**对应 route**：`POST /api/tasks/:id/verify` 改为调 verification-runner，把硬结果 + LLM 解释分离。

### 3.2 回放 Harness：`paperclipai run replay <runId>`

**位置**：`cli/src/commands/replay.ts` + `server/src/services/run-replay.ts`

**职责**：
- 从 `heartbeat_runs` + `task_verifications` + `handoffs` 重建 workspace 状态
- 在新 worktree 重放同一 task，可用不同 model / prompt
- 输出 diff：与原 run 的 verify 结果对比

**用途**：prompt 迭代、eval 编写、postmortem 自动生成（"这次重放也失败了 → 确认是 root cause"）。

### 3.3 Eval-as-Gate Harness：`paperclipai skill propose <path>`

**位置**：`cli/src/commands/skill-propose.ts` + `server/src/services/skill-proposal.ts` + `packages/skills-catalog/scripts/eval.ts`（新建）

**职责**：
- 把 skill 改动隔离到 worktree
- 跑 `pnpm --filter @paperclipai/skills-catalog validate`
- 跑 `evals/promptfoo` 套件（含 agent-decisions eval）
- 出具 `SkillProposalReport`：基线 vs 提议的 pass-rate delta
- 落入 `skill_proposals` 表，等 board 一键 approve/deny
- 拒绝 0-delta 的 proposal（"改完了没效果 = 别改"）

**对应 route**：`POST /api/skills/propose`、`GET /api/skills/proposals`、`POST /api/skills/proposals/:id/approve`。

### 3.4 记忆 Harness：`paperclipai memory {record,query}`

**位置**：`cli/src/commands/memory.ts` + `server/src/services/memory.ts` + 新表 `task_postmortems`

**Schema**（`packages/db/src/schema/task_postmortems.ts`）：
- `id`, `company_id`, `repo_path`, `module_path`（最具体前缀）
- `root_cause_class`（enum：`logic | env | tool | flaky | ambiguity | unknown`）
- `fix_summary` (text)
- `commit_hash`, `files_touched` (text[])
- `lessons` (text[])
- `vector_embedding`（pgvector 或简单 tag-based 检索起步）
- `created_at`

**检索策略**：decomposer 收到新 goal 时，查同 company + 同 repo + 同 module 的最近 N 条 postmortem，作为 few-shot context 注入。

### 3.5 Sandbox / 治理 Harness

| 既有 | 补强 |
|:---|:---|
| `paperclipai worktree init` | 加 `--skill-proposal` 模式，与 §3.3 联动 |
| `legionGitConfig.auto_pr` | 加 `required_checks` (text[])、`auto_merge` (bool) |
| worktree env 变量 | 加 `PAPERCLIP_VERIFICATION_REQUIRED=1`（默认开启） |
| 既有 `--no-seed` | 加 `--no-live-execution` 模式：允许跑 verify 但禁调 adapter |
| `LICENSE` + 既有 secrets strict mode | 加 `PAPERCLIP_SKILL_PROPOSAL_DENY_REGEX` 防止危险 prompt 改动 |

---

## 4. 分阶段实施路线（Phase 8–11）

Phase 0–7 由 `2026-06-09-agent-legion-autonomous-delivery-system.md` 与 `2026-06-08-...realtime-plan.md` 承担，本计划仅追加 **Phase 8–11**。

### Phase 8：硬验证闭环（Self-Solving 的地板）

**范围**：
1. DB schema 升级：`tasks.verification_criteria TEXT` → `tasks.verification_spec JSONB` + 新表 `task_verifications`
2. `server/src/services/verification-runner.ts` + CLI `paperclipai verify`
3. `server/src/routes/legion.tasks.ts:108 verify` 改写：先跑硬命令，再让 LLM 解释
4. `services/legion-monitor.ts` 的 `checkRetriableFailures` 改为读 `task_verifications.last` 决定重试，并写入 attempt context
5. 替换 `DECOMPOSE_SYSTEM_PROMPT` 与 verify 提示词（§2.1.A、B）
6. 新增 skill `hard-verification-authoring`（§2.2.A）

**新建迁移**：`packages/db/src/migrations/0100_verification_spec.sql`
```sql
ALTER TABLE tasks RENAME COLUMN verification_criteria TO verification_spec_legacy;
ALTER TABLE tasks ADD COLUMN verification_spec JSONB;
CREATE TABLE task_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL,
  evidence JSONB NOT NULL,
  llm_summary text,
  passed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_verifications_task_attempt_idx ON task_verifications(task_id, attempt_number DESC);
```

**成功标准**：
- 任意 P2 task 能在 `<task-id>` 通过 `paperclipai verify` 拿到结构化报告
- LLM verify 不再是 ground truth，硬命令 exit ≠0 必导致 `passed=false`
- `legion-monitor` 在重试时把上次 `evidence` + `llm_summary` 注入新 attempt 的心跳 context

**预估工时**：4–5 天

### Phase 9：DAG 派发门禁 + CI/合入闭环

**范围**：
1. `server/src/services/task-scheduler.ts`：`tick()` 读 `tasks.verification_spec.dependencies` + `handoffs.status='ready'`，未满足不派发
2. `server/src/services/legion-ci-watcher.ts`：轮询 `gh pr checks <branch>`，记录到 `pr_check_runs` 表
3. `server/src/services/legion-merge.ts`：所有 required check 绿 → 自动 `gh pr merge --squash --delete-branch`
4. `legionGitConfig` 增加 `required_checks` / `auto_merge` 字段（迁移 0101）
5. goal 状态机推进器：`services/goal-progress.ts`，所有 task 终态 → goal 进入 `verifying` → 全过 → `completed`

**新建迁移**：`0101_legion_ci_config.sql`、`0102_pr_check_runs.sql`

**成功标准**：
- 两个并行 task + handoff 依赖时，下游必在上游 `consumed_by` 后才派发
- PR 绿后 ≤30s 自动合入，branch 自动删除
- Goal `verifying → completed` 由聚合判定，不依赖 board 写状态

**预估工时**：5–6 天

### Phase 10：多层级拆解 + 跨 run 记忆

**范围**：
1. `server/src/services/goal-decomposer.ts`：新增 `decomposeRecursive`，检测 coarse task（estimated_duration > 240 或 description 长度 > X），递归创建子 goal
2. `packages/db/src/migrations/0103_task_postmortems.sql` + `server/src/services/memory.ts`
3. CLI `paperclipai memory {record,query}`
4. `legion-self-solving` skill（§2.2.B）写入所有 agent 默认 skill 列表
5. decomposer 接 memory：构造 prompt 前查同 repo+module 最近 N 条 postmortem，注入 few-shot

**新建表**：`task_postmortems`（见 §3.4）

**成功标准**：
- "实现用户登录" 这种粗目标能自动产生子 goal → 子子 task 三层
- 同一 repo 第二次做相似任务，decomposer 输出里 ≥30% 任务引用了既有 postmortem
- 任意 task 失败/成功后必落一条 postmortem（scheduler hook 强制）

**预估工时**：6–7 天

### Phase 11：自修改 + Eval Gate

**范围**：
1. `packages/skills-catalog/scripts/eval.ts`：把 `evals/promptfoo` 套件与 skills catalog 关联（每个 skill 一组 case）
2. `server/src/services/skill-proposal.ts` + CLI `paperclipai skill propose`
3. 新表 `skill_proposals`（迁移 0104）
4. `legion-self-solving` skill 第 5 条强制：所有 skill / prompt 改动走 propose 流程
5. Dashboard 面板：自修改事件流、eval 红→绿率、proposal 落地率

**新建迁移**：`0104_skill_proposals.sql`

**成功标准**：
- 任意 skill 文件的修改必须经 proposal，否则 server 拒绝启动该 skill（feature flag：strict mode 默认开）
- 一次端到端：agent 提议 `github-pr-workflow` 加一条 "如何处理 force-push" → eval 跑过 → board 一键 approve → manifest 更新 → 后续 PR 工作流命中率提升

**预估工时**：7–9 天（含 eval 套件编写）

---

## 5. 跨阶段约束与一致性

### 5.1 数据迁移纪律

- 沿用 `packages/db/src/check-migration-numbering.ts`：必须连续，不允许跳号
- 每次新增 `0100+` 迁移必须在 commit message 显式说明 schema 变化
- `verification_spec_legacy` 列保留 1 个版本（Phase 8），下个版本删

### 5.2 Prompt 与代码同源

- DECOMPOSE_SYSTEM_PROMPT、verify prompt、retry prompt 改为引用 skill 名，不再硬编码在 `.ts` 里
- 改 prompt 等同于改 skill → 走 Phase 11 的 propose 流程

### 5.3 Test 纪律

- 每个 Phase 落地必须有：
  - 单测：`server/src/__tests__/verification-runner.test.ts` 等
  - 集成测：端到端 goal → done 流程跑通一个 fixture repo
  - 反向测：故意构造必失败的 verification_spec，断言不静默通过
- 性能预算：`paperclipai verify` P95 ≤ 60s（不含 build/test 自身时长）

### 5.4 文档同步

- `CLAUDE.md` §Worktree-local development 段需追加 "skill proposal 模式"
- `docs/api/issues.md`、`docs/api/agents.md` 补 `verification_spec` / `task_verifications` / `task_postmortems` / `skill_proposals` 字段
- `ROADMAP.md` 把 ⚪ "Enforced Outcomes" 移到 Phase 8 旁边标注 "in flight"

---

## 6. 风险与对策

| 风险 | 影响 | 对策 |
|:---|:---|:---|
| LLM 在 decomposer 里继续出模糊 verification_spec | 硬验证流于形式 | zod schema 服务端强制 reject，错误回 LLM 重写（最多 2 次） |
| 自修改打破既有 skill | 静默回退 | eval 红→绿 + skill_proposals 表审计 + strict mode 默认开 |
| postmortem 噪声 | decomposer context 越长越贵 | 检索后取 top 5，TTL 30 天；超过 N 条触发摘要压缩 |
| CI 慢反馈 | 合入闭环墙钟长 | `legion-ci-watcher` 5s 轮询 + WebSocket 推送，不等下一次 heartbeat |
| 多层拆解爆栈 | 无限递归 | decomposer 硬上限 3 层 + 单层 ≤ 20 task |
| 跨编程语言验证 | 单一 harness 不通 | verification_spec.kind 是字符串，运行时按 kind 路由到具体执行器，先实现 ts/js + python，其余靠 plugin |

---

## 7. 与既有计划的衔接

| Phase | 来源 | 状态 |
|:---|:---|:---|
| 0–6 | `2026-06-09-agent-legion-autonomous-delivery-system.md` | 进行中（迁移 0096–0099 已落地） |
| 实时交付系统 | `2026-06-08-...realtime-plan.md` | 进行中（diagnostic 表、drafts 已存在） |
| 团队模式 / 调度二阶段 | `2026-06-05-cmpaa-121/122` | 进行中 |
| **8（硬验证）** | 本计划 | **已完成**（迁移 0100、verification-runner、verify 路由重写、retry context、tests） |
| **9（DAG + CI 合入）** | 本计划 | **已完成**（迁移 0101/0102、legion-ci-watcher、legion-merge、goal-progress、scheduler DAG gate、tests） |
| **10（多层级 + 记忆）** | 本计划 | **已完成**（迁移 0103、memory service、recursive decomposer、legion-self-solving skill、tests） |
| **11（自修改 + Eval Gate）** | 本计划 | **已完成**（迁移 0104、skill-proposal service、strict-mode loader、tests） |
| **12（可执行性 + 端到端）** | 本计划 | **已完成**（CLI 命令、real eval suite、manifest hard-fail、self-solving-e2e smoke、self-solving routes） |

### 实际落地状态（本会话内完成）

- ✅ **Phase 8** — 9 子任务全部完成。
- ✅ **Phase 9** — 7 子任务全部完成。
- ✅ **Phase 10** — 6 子任务全部完成。
- ✅ **Phase 11** — 5 子任务全部完成。
- ✅ **Phase 12** — 5 子任务全部完成（CLI、real eval、manifest hard-fail、smoke、routes）。
- ✅ **Phase 13** — 2 子任务全部完成（manifest regen 脚本 + 诚实 runbook）。

整个 self-solving 推进 Agent 团队的 6 个新阶段（Phase 8–13）已经全部落地为代码 + schema + 测试 + CLI + smoke 脚本。

不重复定义前序 Phase 已覆盖的 schema / route / 服务。只在本计划描述它们之上的增量与心智模型。

---

## 8. 启动顺序（建议前两周）

1. **W1D1–2** — Phase 8 schema 落地（迁移 0100）、`verification-runner` 单测。
2. **W1D3–5** — verify 路由改写、DECOMPOSE_SYSTEM_PROMPT 替换、`hard-verification-authoring` skill 入 catalog。
3. **W2D1–3** — 重试上下文回流、`legion-self-solving` skill 写 catalog。
4. **W2D4–5** — 端到端跑通"加一个有测试的 helper function" 目标，从 decompose 到 PR 开起来。
5. **W3** — Phase 9：DAG 派发门禁 + legion-ci-watcher + legion-merge + goal-progress。
6. **W4+** — Phase 10（多层级 + 记忆）、Phase 11（自修改 + Eval Gate）、Phase 12（可执行性），按需推进。

启动两周后应该有：硬验证第一次失败不再被 LLM 自评掩盖 + 跨 attempt 上下文回流可见。
启动三周后应该有：PR 自动合入 + goal 状态自动推进 + 失败不再卡死 agent 团队。
启动四周后应该有：跨 run 记忆生效 + 自修改 eval 门禁落地 + CLI 命令 + 端到端 smoke 脚本可执行。

### ⚠️ 诚实声明

**本会话没有任何代码被实际执行。** 本地 shell 环境在所有 bash 调用上挂起（包括 `echo "ok"`、`node --version`），因此无法：

- 应用数据库迁移（0100–0104 已写好但 `pnpm db:migrate` 没跑）
- 重新生成 catalog manifest（`pnpm --filter @paperclipai/skills-catalog build:manifest` 没跑；`generated/catalog.json` 中两条 `REGENERATE_VIA_PNPM_BUILD_MANIFEST` 占位 hash 仍存在）
- 跑测试套件（`pnpm test`、`pnpm --filter @paperclipai/server typecheck` 没跑）
- 跑端到端 smoke（`node scripts/smoke/self-solving-e2e.mjs` 没跑）

所以"自我解决推进 Agent 团队"目标在当前会话内没有被演示，只能由下一位在能跑 shell 的机器上执行完整 runbook 后才算真正落地。

### 在能跑 shell 的机器上的完整 runbook（按顺序执行）

```sh
# 0. 安装依赖
pnpm install

# 1. 应用 5 个新迁移（0100–0104）
pnpm --filter @paperclipai/db check:migrations
pnpm db:migrate

# 2. 修复 catalog manifest 的占位 hash
pnpm catalog:regen
# 等价于：
pnpm --filter @paperclipai/skills-catalog build:manifest

# 3. 验证 manifest 不再含占位
pnpm --filter @paperclipai/skills-catalog validate

# 4. 服务端 typecheck
pnpm --filter @paperclipai/server typecheck
pnpm --filter @paperclipai/ui typecheck

# 5. 跑 Vitest 单测
pnpm test

# 6. 起 dev server
pnpm dev &

# 7. 配置 board 凭证并起公司
pnpm paperclipai onboard --yes
export PAPERCLIP_API_KEY="<onboard 输出的 token>"
export COMPANY_ID="<first company id>"

# 8. 跑端到端 smoke
pnpm smoke:self-solving

# 9. 期望输出：
#    [boot] API http://localhost:3100
#    [health] {"status":"ok"}
#    [decompose] taskCount=3 subGoals=0
#    [dispatch] dispatched count=...
#    [verify] task <uuid>
#    [verify] passed=true checks=2
#    [memory] recording postmortem
#    [memory] recorded <uuid>
#    [memory] query returned N postmortems
#    [proposal] proposing no-op skill change
#    [proposal] id=<uuid> status=pending delta=0
#    [goal-progress] tickGoal
#    [done] PASS goal=<uuid> task=<uuid> postmortem=<uuid> proposal=<uuid>
```

只有当步骤 9 输出 `[done] PASS` 时，本计划的 6 个新阶段（Phase 8–13）才算真正演示了"自我解决推进 Agent 团队"的能力。

### 完成

- ✅ Phase 13 — 2 子任务全部完成（manifest regen 脚本 + 诚实 runbook）。