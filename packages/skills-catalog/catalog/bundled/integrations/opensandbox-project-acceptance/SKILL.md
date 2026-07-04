---
name: opensandbox-project-acceptance
description: Run project-level acceptance checks inside OpenSandbox. Use when the user wants to validate a backend, frontend, full-stack app, service startup, test-environment configuration, smoke APIs, logs, screenshots, or acceptance evidence in a disposable sandbox before merging or deploying.
key: paperclipai/bundled/integrations/opensandbox-project-acceptance
recommendedForRoles:
  - devops
  - engineer
  - qa
  - pm
tags:
  - opensandbox
  - sandbox
  - integration
  - acceptance
---

# OpenSandbox Project Acceptance

Use this skill for feature acceptance, service startup checks, and full-stack validation. It coordinates `opensandbox-task-runner` and, when needed, `opensandbox-ui-task`.

## Workflow

1. Identify the project roots, startup commands, expected ports, and environment profile.
2. Choose or create a sandbox image with the required runtime versions.
3. Upload source bundles or clone repositories using runtime-provided credentials.
4. Install dependencies only when caches or prebuilt images are unavailable.
5. Start services in the background and redirect logs to `/workspace/opensandbox-artifacts/logs`.
6. Poll health endpoints, ports, or process logs until the app is ready.
7. Run API smoke checks or project test commands.
8. If a browser flow is required, switch to `opensandbox-ui-task` for Playwright or screenshot evidence.
9. Download logs, summaries, screenshots, and generated reports.
10. Delete the sandbox unless the user asks to keep it for investigation.

## Acceptance Evidence

Always produce evidence that another engineer can inspect:

- startup command and environment profile
- service URLs or proxied endpoints
- health/API response summaries
- relevant logs
- screenshots or traces for UI checks
- known gaps and follow-up actions

## Boundaries

- Keep this skill project-agnostic. Put project-specific scripts and docs in the target project repository.
- Do not store server passwords, repository tokens, database passwords, or API keys in this plugin.
- Prefer test or staging configuration unless the user explicitly authorizes production.
- If a dependency requires private network access, report that as an environment requirement.

## References

- `references/project-acceptance-flow.md`: reusable service startup and evidence checklist
