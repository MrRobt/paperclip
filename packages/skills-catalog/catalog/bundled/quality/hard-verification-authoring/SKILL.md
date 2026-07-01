---
name: hard-verification-authoring
description: Author a structured verification_spec for a Paperclip Legion task so the verification-runner can execute real commands (tests, typecheck, lint, build, file-exists, http-probe, custom-exit-zero) and produce ground-truth evidence instead of LLM self-judgment.
key: paperclipai/bundled/quality/hard-verification-authoring
recommendedForRoles:
  - engineer
  - qa
  - pm
tags:
  - verification
  - acceptance
  - automation
  - legion
---

# Hard Verification Authoring

Write a `verification_spec` that a machine can execute. The verification-runner ignores prose; only the structured `checks` array produces ground-truth pass/fail.

## When to use

- A new task is being added to a Legion goal and needs acceptance criteria.
- An existing task was rejected because its `verification_criteria` was free-text "验收:..." and the server-side zod check refused it.
- You are reviewing a task and want to upgrade soft criteria ("looks correct") into hard ones ("test X passes with exit 0").
- A goal has failed verification repeatedly and you suspect the spec itself is the problem.

## When not to use

- The change is a typo or docs-only. No verification needed; mark `verification_spec: null` and let the goal close via reviewer.
- The task is exploratory / spike work where the output is "we learned something" — surface it as a `findings` document, not a `verification_spec`.
- The deliverable cannot be checked by command (e.g. "design feels right"). For that, attach an artifact and write `file-exists` + a reviewer-only note.

## The seven check kinds

Pick the smallest set that proves the task is done. Each check is independent; failures short-circuit the run.

| Kind | When to use | Required fields |
|:---|:---|:---|
| `run-tests` | Run the project's test command for this scope (e.g. `pnpm test`, `vitest run path/...`). | `command`, `expectedExit` (usually 0), optional `cwd`, `timeoutSec` (default 60). |
| `typecheck` | Run the typecheck (`tsc --noEmit`, `pyright`, `mypy`). | `command`, `expectedExit`. |
| `lint` | Run the linter (`eslint`, `ruff`). | `command`, `expectedExit`. |
| `build` | Produce a build artifact (`pnpm build`, `go build`). | `command`, `expectedExit`. |
| `file-exists` | An artifact file must be present after the task. | `path`. |
| `http-probe` | A live endpoint must respond (health check, contract test). | `method`, `url`, `expectStatus`, optional `expectBodyContains`. |
| `custom-exit-zero` | Catch-all for "this script exits 0 when done". | `command`, optional `cwd`, `timeoutSec`. |

## Authoring rules

1. **One concrete command per check.** Don't chain with `&&` if a separate check makes the failure clearer.
2. **Use the project's own scripts.** Prefer `pnpm test` over a hand-rolled `node ./scripts/run-tests.js`. Project scripts already encode conventions.
3. **Set `cwd` only when it differs from the task's worktree root.** Relative paths in `cwd` resolve against the worktree.
4. **`timeoutSec` defaults to 60.** Tests longer than that belong in CI, not in the local verify loop. Set explicit `timeoutSec` only when the command genuinely needs more headroom and you have measured it.
5. **For HTTP probes, include `expectBodyContains` only when status alone is ambiguous.** Don't put the whole response body in there.
6. **Never use `file-exists` to check the existence of source files that pre-existed the task.** It only proves something the agent *produced* is on disk.
7. **`rationale` (optional) explains to humans why these checks prove the task is done.** The runner ignores it; the goal archive shows it.

## Output shape

The decomposer emits tasks with `verification_spec` embedded; if you are patching an existing task directly:

```json
{
  "rationale": "Typecheck + targeted test prove the helper is correctly typed and behaves on the empty list.",
  "checks": [
    {
      "kind": "typecheck",
      "command": "pnpm -w tsc --noEmit",
      "cwd": "packages/shared",
      "expectedExit": 0,
      "timeoutSec": 120
    },
    {
      "kind": "run-tests",
      "command": "pnpm vitest run packages/shared/src/__tests__/helper.test.ts",
      "expectedExit": 0,
      "timeoutSec": 90
    },
    {
      "kind": "file-exists",
      "path": "packages/shared/src/helper.ts"
    }
  ]
}
```

## Verification flow

1. Author the `verification_spec` as part of the task draft.
2. Call `paperclipai verify <taskId>` (or the equivalent route in tests) to dry-run it once before the agent commits.
3. If a check is wrong, fix it; do not weaken it to make it pass. A spec that "always passes" is worse than no spec.
4. After the agent's run, `POST /api/legion/tasks/:id/verify` re-executes the same spec; the LLM can only summarize, never override.

## Anti-patterns

- "Looks good to me" as a check kind. The runner doesn't accept prose; write `lint` or `file-exists` instead.
- `expectedExit: 1` to "prove the code rejected an invalid input." If that's the intent, write a real `run-tests` case for the rejection.
- `http-probe` against a public URL the agent doesn't control (e.g. `https://example.com`). It will pass for the wrong reasons.
- `custom-exit-zero: "echo done"`. Equivalent to no check at all — the runner will mark the task done on a one-line echo.
- Mixing runtime concerns into the spec (`timeoutSec: 9999`). The runner caps at `MAX_OUTPUT_BYTES` and will truncate verbose output; keep commands focused.