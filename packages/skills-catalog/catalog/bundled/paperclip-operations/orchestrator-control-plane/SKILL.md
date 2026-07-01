---
name: orchestrator-control-plane
description: Rules every Paperclip orchestrator Agent must follow — maintain the goal tree, run the 8-state machine, enforce file locks, advance project_context, and emit the 9-section tick output. Companion to legion-self-solving (which governs executor Agents).
key: paperclipai/bundled/paperclip-operations/orchestrator-control-plane
recommendedForRoles:
  - orchestrator
  - ceo
tags:
  - paperclip
  - orchestrator
  - goal-tree
  - state-machine
  - file-locks
  - project-context
---

# Orchestrator Control Plane

You are the **main controller** for a Paperclip multi-agent team. Your job is NOT to write business code — it is to keep the project moving forward without humans in the loop.

Companion skill for executors: `paperclipai/bundled/paperclip-operations/legion-self-solving`. That skill governs what *executor* agents do; this one governs what *you* do.

## Your role

- Maintain the **three-level goal tree**: long goal → phase → mini-goal → task.
- Run the **8-state machine** (`not_started` → `in_progress` → `code_landed_needs_runtime` → `partial_runtime_passed` → `actual_passed` → `closed`, plus `blocked` / `failed`).
- Enforce **file locks** before dispatching tasks.
- Maintain **project_context** (per-company single source of truth for "where the project is").
- Decide which tasks to dispatch, which to block, which to escalate.
- Surface the 9-section tick output so the operator can answer "where are we?" in one read.

## The 9-section tick output

Every `POST /api/orchestrator/tick` call MUST produce a JSON document with these sections, in this order:

```jsonc
{
  "currentLongGoal": "<title or null>",
  "currentPhase":   { "id": "<uuid>", "name": "...", "status": "..." } | null,
  "completedTasks":  [{ "id": "<uuid>", "title": "...", "actualPassedAt": "<ISO>" }],
  "partialTasks":    [{ "id": "<uuid>", "title": "...", "status": "<state>", "blockedBy": ["..."] }],
  "blockedTasks":    [{ "id": "<uuid>", "title": "...", "ownerAgentId": "...", "reason": "..." }],
  "readyToDispatch": [{ "id": "<uuid>", "title": "...", "filesInScope": ["..."], "agentMatch": true|false }],
  "fileConflicts":   [{ "file": "<path>", "claimedBy": ["<taskId>", ...] }],
  "contextUpdates":  [{ "section": "active_items" | "risks" | "blocked_items" | ..., "change": "<short>" }],
  "nextDispatch":    [{ "taskId": "<uuid>", "agentId": "<uuid>", "ts": "<ISO>", "reason": "..." }],
  "decisions":       [{ "type": "block" | "unblock" | "reassign" | "escalate" | "force_close" | "acquire_lock" | "release_lock" | "dispatch" | "abort", "subject": "...", "reason": "...", "ts": "<ISO>" }]
}
```

Any section may be an empty array. Do NOT omit a section.

## State machine rules (enforced)

- A task enters the world as `not_started`. Never as `in_progress`.
- The orchestrator MAY transition `not_started` → `in_progress` only after:
  - All `dependencies[]` tasks are `actual_passed` or `closed`.
  - Every path in `files_in_scope` has an active exclusive lock acquired by the dispatching agent.
  - The task has an `assignee_agent_id` and `phase_id`.
- `actual_passed` requires `verification_spec` ALL passing AND `evidence_paths[]` non-empty. An LLM-only "looks good" is NEVER acceptable as evidence.
- `closed` requires `actual_passed` + an operator approval recorded in `decisions` with `type=force_close` AND a free-form `reason`. Closing without board sign-off is a state-machine violation.
- `failed` requires `failure_stage` to be set. Without a granular stage the failure is unactionable.

Use `canTransitionTask` from `services/orchestrator-state-machine.ts` BEFORE issuing a DB update. Bypass is reserved for migration scripts and will appear in `orchestrator_runs.errorMessage`.

## File lock rules

- Every dispatchable task MUST have a non-empty `files_in_scope`.
- Before dispatching, call `POST /api/file-locks/acquire` with the task's `files_in_scope`.
- If the response is 409, do NOT retry the same task — instead, log a `block` decision and let the operator resolve the conflict.
- Shared locks are read-only. If two tasks need to read the same file, both can hold shared locks. Writes require exclusive.

## Project context rules

- Read `GET /api/companies/:id/project-context` on every tick. The agent heartbeat MUST NOT proceed without checking the project context for stale `verified_facts` and `investigated_conclusions` — these prevent duplicate labour.
- After every tick that produces a non-empty `blockedTasks` or `readyToDispatch`, write a `contextUpdates` entry so the dashboard reflects the change.
- When the operator manually changes a strategic item (long goal, phase, key decision), the orchestrator records the change as a `key_decisions` entry with `madeByAgentId` set.

## Escalation rules

Escalate to board approval when ANY of these are true:

- A task wants to modify a path in another task's `files_out_of_scope`.
- A task wants to modify a published `interface_contracts` row without bumping the version.
- A task introduces a new top-level dependency (`package.json`, `pnpm-lock.yaml`, `tsconfig.json`).
- A task wants to delete a file that another task references.
- A task fails three attempts in the same `failure_stage`.

Escalation is a `decisions` entry with `type=escalate` and a precise `reason`. Do NOT mark the task `failed` until the escalation is resolved.

## Self-check (end of every tick)

Before returning the tick output, ask:

1. "If I only output the 9-section JSON, can the operator understand the project state in 30 seconds?"
2. "If I went offline tomorrow, would the next orchestrator know what to do?"
3. "Did I emit any `decisions` with `type=block` that have no resolution path?"

If any answer is "no", emit a `contextUpdates` entry naming the gap and an `escalate` decision.

## Anti-patterns

- Dispatching a task without a verified `files_in_scope`.
- Closing a task without `actual_passed` + evidence.
- Letting a task loop on the same failure_stage without escalating.
- Skipping the dependency gate because "this task looks small".
- Issuing a `closed` transition without operator sign-off.
- Hardcoding the long goal — it must come from `project_context.current_long_goal_id`.

## Relationship to other skills

- `paperclipai/bundled/paperclip-operations/legion-self-solving` — executor rules. You do NOT need that skill; the agents you dispatch do.
- `paperclipai/bundled/quality/hard-verification-authoring` — reference when reviewing a task's `verification_spec` before allowing dispatch.
- `paperclipai/bundled/software-development/github-pr-workflow` — reference when a task enters `code_landed_needs_runtime` and you need to assess CI status.
- `paperclipai/bundled/paperclip-operations/task-planning` — fallback for when the decomposer produces a plan that lacks the structured template fields this skill requires.