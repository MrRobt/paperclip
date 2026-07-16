# Auditable Agent Delivery V1 / 可审计智能体交付系统

Date: 2026-06-06

## Positioning

Paperclip should evolve from a task board plus agent runtime into a **可审计的智能体交付系统**: work can be decomposed, state is trustworthy, blockers are resolvable, model channels can recover, evidence can be rechecked, the UI is Chinese-first, and the full run chain is observable.

This plan accepts the complete improvement direction from the product review and organizes it into implementable slices.

## Accepted principles

1. **状态分层**: never treat `issue.status` alone as proof of work. Platform state, process state, output state, and verification state must be visible separately.
2. **证据优先**: comments are communication and audit context; evidence is a first-class delivery object.
3. **阻塞分级**: strong blockers stop execution/state transitions, not supplemental comments or evidence uploads. Weak and hint blockers should support supervised override.
4. **评论不丢**: failed writes must preserve draft content locally and, where possible, in a server-side pending write queue.
5. **模型可自愈**: every agent should have an observable primary/fallback/status-only model channel policy with recovery history.
6. **工作区防呆**: tasks must know their repo, branch, cwd, and allowed file scope before an agent runs.
7. **交接结构化**: current owner, next owner, handoff conditions, and required evidence should be explicit fields, not buried in comments.
8. **主控内置**: supervisor mode should summarize, identify stuck work, dispatch the next owner, and produce Chinese short reports without external polling loops.
9. **中文优先**: default UI, system notifications, agent templates, acceptance templates, and error output are Chinese-first. Technical terms are shown as 中文解释（original term） when needed.
10. **全链路可观测**: every state change, wake, model switch, blocker suppression, evidence upload, and verification decision must be auditable.

## Target model

### 1. Layered state

Add derived and/or persisted state slices around an issue:

| State slice | Examples | Purpose |
|---|---|---|
| Platform state | `backlog`, `todo`, `blocked`, `done` | Board workflow state |
| Process state | `queued`, `running`, `idle`, `stale`, `crashed` | Whether an agent/runtime is actually active |
| Output state | `no_output`, `activity_only`, `partial_output`, `has_artifact`, `has_commit` | Whether the run produced inspectable work |
| Verification state | `unverified`, `evidence_attached`, `verified`, `rejected` | Whether delivery can be rechecked |

### 2. First-class evidence

Introduce an evidence surface that can link to comments, runs, work products, attachments, commands, screenshots, logs, API responses, and commits.

Minimum fields:

```ts
IssueEvidence = {
  id: string;
  companyId: string;
  issueId: string;
  kind: "commit" | "command" | "log" | "screenshot" | "artifact" | "api_response" | "manual_note";
  sourceRunId: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  summary: string;
  uri: string | null;
  metadata: Record<string, unknown>;
  redactionStatus: "not_needed" | "pending" | "redacted";
  verificationStatus: "unverified" | "verified" | "rejected";
  createdAt: Date;
  updatedAt: Date;
}
```

Completion gates:

- Code tasks require commit/diff evidence plus a verification command.
- UI tasks should require screenshot evidence when visually inspectable.
- API tasks should require test output or API response evidence.
- `done` without evidence should be impossible or downgraded to `in_review`/`evidence_required` depending on workflow policy.

### 3. Blocker grading

Blockers need explicit policy instead of one generic blocked state.

| Grade | Blocks | Allows |
|---|---|---|
| Strong blocker | resume, checkout, execution wakeups, automatic state transition | comments, evidence, supervisor downgrade request |
| Weak blocker | automatic execution | comments, evidence, manual supervisor continue |
| Hint blocker | nothing | warning and audit annotation |

Suggested fields:

```ts
IssueBlockerPolicy = {
  grade: "strong" | "weak" | "hint";
  ownerType: "agent" | "user" | "board" | "external" | "unknown";
  ownerId: string | null;
  unblockCondition: string | null;
  allowsEvidenceWrites: boolean;
  allowsCommentWrites: boolean;
  allowsSupervisorOverride: boolean;
  staleAt: Date | null;
}
```

### 4. Comment drafts and pending writes

Client requirements:

- autosave composer drafts by issue;
- do not clear drafts until the server confirms the write;
- expose copy/retry/save actions on failure;
- preserve submitted body when network or blocker errors occur.

Server-side queue target:

```ts
PendingCommentWrite = {
  id: string;
  companyId: string;
  issueId: string;
  actorType: "user" | "agent" | "system";
  actorId: string | null;
  body: string;
  intendedAction: "comment" | "resume_comment" | "evidence_comment";
  lastError: string | null;
  retryable: boolean;
  status: "pending" | "written" | "cancelled" | "failed";
  createdAt: Date;
  updatedAt: Date;
}
```

### 5. Model channel self-healing

Each agent should expose model channel health:

```ts
ModelChannelState = {
  primary: string;
  fallback: string | null;
  cheap: string | null;
  statusOnly: string | null;
  current: string;
  health: "healthy" | "rate_limited" | "failing" | "cooling_down";
  lastFailure: string | null;
  cooldownUntil: Date | null;
}
```

Operations:

- automatic fallback on adapter/rate-limit failure;
- batch switch model channel;
- batch reset to primary;
- audit every switch with reason and affected runs.

### 6. Workspace scope guardrails

Each issue should have an execution scope before invocation:

```ts
ExecutionScope = {
  repoId: string | null;
  branch: string | null;
  cwd: string | null;
  allowedPaths: string[];
  forbiddenPaths: string[];
  requiredBaseRef: string | null;
  expectedRemote: string | null;
}
```

Agent startup must verify repo, remote, branch, cwd, dirty state, and file scope before execution.

### 7. Structured handoff

A handoff should be a structured object:

```ts
IssueHandoff = {
  currentOwnerType: "agent" | "user" | "board";
  currentOwnerId: string | null;
  nextOwnerType: "agent" | "user" | "board" | "none";
  nextOwnerId: string | null;
  handoffReason: string;
  handoffCondition: string | null;
  requiredEvidenceKinds: string[];
}
```

Default Chinese six-part output:

```md
【结论】
【改动文件】
【验证结果】
【残留风险】
【下一步】
【证据】
```

### 8. Built-in supervisor mode

Supervisor mode should provide:

- stuck-work detection;
- idle/no-output run detection;
- blocker triage;
- next-owner dispatch;
- batch wake/reset/model-switch actions;
- every-round Chinese short report;
- evidence and verification gap summary.

## Iteration slices

### Phase 1: Stop the loop

- Preserve failed comment drafts.
- Keep strong blockers from blocking evidence/comment writes.
- Add structured Chinese server errors.
- Split visible process/output/verification labels from platform status.
- Add batch reset, batch model switch, and batch wake controls.

### Phase 2: Evidence-first completion

- Add evidence entity.
- Require evidence for completion.
- Add structured verification commands.
- Support screenshot/log/API-response uploads with redaction state.
- Enforce the Chinese six-part completion template.

### Phase 3: Supervisor built-in

- Add supervisor cockpit.
- Add stuck-work detection.
- Add next-owner dispatch.
- Generate Chinese round reports.
- Remind on idle, timeout, no-output, no-evidence, and verification gaps.

### Phase 4: Productization and Chinese-first UX

- Full UI localization.
- Full template localization.
- Structured server error catalog.
- Chinese onboarding.
- Team role and issue templates.

## Acceptance criteria

- A blocked issue can accept comments and evidence without accidentally waking blocked work.
- A completed issue always links to evidence that a reviewer can re-run or inspect.
- The UI can show whether work is running, idle, producing output, waiting for verification, or actually done.
- The supervisor can answer: “谁卡住了，为什么，下一步谁处理，需要什么证据？”
- Operators can recover a failed comment, failed model channel, or stuck run without leaving Paperclip.
