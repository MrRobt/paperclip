---
name: legion-self-solving
description: Rules every Paperclip Legion agent must follow — fail-closed verification, structured postmortems, eval-gated self-modification, never assume "looks correct".
key: paperclipai/bundled/paperclip-operations/legion-self-solving
recommendedForRoles:
  - engineer
  - qa
  - reviewer
  - pm
tags:
  - paperclip
  - legion
  - self-solving
  - safety
  - verification
---

# Legion Self-Solving

The Legion loop is only as good as the discipline of its individual agents. This skill is auto-loaded by every Paperclip-resident agent so the entire team shares the same rules for what "done" means and how to learn from failure.

## The six rules

### 1. Never declare a task done without hard verification

A task is done when its `verification_spec` (see `paperclipai/bundled/quality/hard-verification-authoring`) executes and every check passes. "I wrote the function and it looks right" is not verification. "I ran `pnpm test` and got exit 0" is verification. Use `paperclipai verify <taskId>` to dry-run the spec before committing code; the route `POST /api/legion/tasks/:id/verify` runs the same checks at the end of a run.

### 2. Read the prior failure before retrying

If a task is in `verification_failed` or `failed` and you are the next attempt, the description will contain a `[prior failure context]` block. Read it first. State a one-paragraph hypothesis of the root cause. Make the **smallest** change that addresses it, not a redo. If the failing check is environmental (missing tool, wrong cwd), fix the environment first.

### 3. Always write a postmortem — pass or fail

After every attempt, call `paperclipai memory record` (or POST to `/api/companies/<id>/memory/postmortems`) with:

- `root_cause_class` — one of `logic | env | tool | flaky | ambiguity | unknown`
- `fix_summary` — one paragraph
- `files_touched[]`, `commit_hash`, `branch_name`, `pr_url` when available
- `lessons[]` — up to 3 short bullets the next decomposer should see

A passing task with no lessons is wasted organizational memory. A failing task with no postmortem is a repeat failure waiting to happen.

### 4. Never edit a skill in place

Skill / prompt modifications are gated by `paperclipai skill propose <path>` (Phase 11). The proposal runs the eval suite, captures baseline vs proposed pass-rates, and waits for board approval. **Direct edits to `packages/skills-catalog/catalog/**/*.md` are rejected by the strict-mode server.**

If you need to change how you behave, route through the proposal. If you cannot route through the proposal, that is itself a signal — surface it to the board.

### 5. Use handoffs for cross-agent context

When a task produces an artifact that downstream tasks consume, record a `handoff` (via the `handoffs` table — see `services/handoff-service.ts`). The scheduler's DAG gate will block the downstream task until the upstream task's handoff is `status='ready'`. This is how parallel tasks stay race-free.

### 6. Escalate when stuck, don't thrash

A task that has reached `attempts == maxAttempts` without passing must surface to the board via the `failed` status. Do NOT re-dispatch the same agent with the same prompt; that is the failure mode the `legion-monitor` retry-with-context hook exists to break. If you genuinely believe a 4th attempt will work, the proper action is a `paperclipai skill propose` to update the prompt — not a silent retry.

## When to use

This skill is loaded automatically by every Paperclip agent on heartbeat. You do not need to opt in. The only time you reference it by name is when you are writing documentation, a new skill, or debugging an agent that has violated one of the six rules.

## When not to use

- You are a board user / human operator, not an agent. This skill is for in-loop agents.
- You are debugging the legion runtime itself (a server engineer). Then read `services/{goal-decomposer,verification-runner,legion-ci-watcher,legion-merge,goal-progress,memory}.ts` directly.

## Verification flow you will repeat

1. Receive task heartbeat with `[prior failure context]` (if retrying) and task `verification_spec`.
2. Read the spec. If absent, stop and ask — the decomposer should have emitted one.
3. Implement the change. Run the spec checks yourself via `paperclipai verify <taskId>` before committing.
4. Commit, push, open PR (or rely on `legion-git.createPullRequest`).
5. Wait for CI to go green; `legion-ci-watcher` polls every 5s.
6. `legion-merge` auto-merges when `auto_merge=true` and required checks pass.
7. `goal-progress.tickGoal` advances the parent goal's status when all tasks in the level are terminal and the verification aggregate passes.
8. Write the postmortem.

## Anti-patterns

- "The PR is open, mark me done." → Blocked by Phase 9: `legion-merge` must succeed first.
- "I'll add the postmortem later." → Forgotten; agent must call `memory record` before status flips.
- "The test passed in my head." → Not a check. Run `pnpm vitest run` or write a real `verification_spec` check.
- "Let me just edit this skill file directly." → Blocked by Phase 11 strict mode; you will lose the change on next sync.
- "I'll skip this verification check, it's overkill." → Strip the check from the spec, not from the run.

## Relationship to other skills

- `paperclipai/bundled/quality/hard-verification-authoring` — how to author the spec this skill enforces.
- `paperclipai/bundled/quality/qa-acceptance` — manual acceptance for human review surfaces; complements but does not replace hard verification.
- `paperclipai/bundled/software-development/github-pr-workflow` — the PR shape required before `legion-merge` will accept a PR.
- `paperclipai/bundled/paperclip-operations/task-planning` — the planning frame this skill descends from; Legion tasks are a structured subset.