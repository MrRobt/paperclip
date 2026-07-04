---
name: opensandbox-task-runner
description: Run isolated non-UI tasks inside OpenSandbox sandboxes. Use when the user wants disposable command execution, scripts, builds, tests, file transformations, artifact collection, log capture, or safe task execution without using the local host environment.
key: paperclipai/bundled/integrations/opensandbox-task-runner
recommendedForRoles:
  - devops
  - engineer
  - qa
tags:
  - opensandbox
  - sandbox
  - integration
  - task-runner
---

# OpenSandbox Task Runner

Use this skill for command-first work. It is intentionally not browser-specific; choose `opensandbox-ui-task` only when the task requires Playwright, screenshots, selectors, or page interaction.

## Workflow

1. Check `opensandbox_health` when server configuration may be missing or stale.
2. Create a sandbox with an image that already contains the needed runtime.
3. Wait for readiness with `opensandbox_wait_sandbox`.
4. Upload scripts, fixtures, or source bundles only when needed.
5. Run commands with `opensandbox_run_command`.
6. For long-running commands, use background execution and poll logs when supported.
7. Write important outputs under `/workspace/opensandbox-artifacts`.
8. Download artifacts with `opensandbox_download_file`.
9. Delete the sandbox unless the user explicitly asks to keep it for debugging.

## Command Evidence Pattern

OpenSandbox command output can be sparse on some server versions. Prefer evidence that survives stream gaps:

- write stdout/stderr to files
- emit a small JSON summary file
- save build logs under `/workspace/opensandbox-artifacts`
- download the exact artifact or log used for the conclusion

## Failure Handling

- If sandbox creation fails, check image, timeout, and resource limits before retrying.
- If command logs are empty, verify with file side effects before declaring failure.
- If package installation is required, capture the install log separately from the task log.
- If credentials are needed for private dependencies, ask for a runtime-safe credential path; do not commit it.

## References

- `references/task-evidence.md`: artifact naming and evidence conventions
