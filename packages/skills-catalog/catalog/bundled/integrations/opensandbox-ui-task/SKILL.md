---
name: opensandbox-ui-task
description: Run browser-based UI checks inside OpenSandbox sandboxes with Playwright, screenshots, traces, and page interaction evidence. Use when the user asks to open a web page, validate UI flows, run Playwright, capture screenshots, verify selectors, test login/navigation, use sandbox or OpenSandbox, or collect browser artifacts from a disposable sandbox.
key: paperclipai/bundled/integrations/opensandbox-ui-task
recommendedForRoles:
  - devops
  - engineer
  - qa
  - designer
tags:
  - opensandbox
  - sandbox
  - integration
  - playwright
  - ui-task
---

# OpenSandbox UI Task

Use the MCP tools from this plugin as the browser execution layer. Keep the workflow explicit: create the sandbox, wait for readiness, open the page, collect browser artifacts, then delete the sandbox.

Read [references/opensandbox-workflow.md](references/opensandbox-workflow.md) before running a task. Read [references/playwright-recipes.md](references/playwright-recipes.md) when the user asks for screenshots, browser smoke checks, or scripted UI validation.

## Workflow

1. Check `opensandbox_health` first when the server URL or API key might be missing.
2. Create the sandbox with `opensandbox_create_sandbox`.
3. Wait for a ready state with `opensandbox_wait_sandbox`.
4. Upload a custom Playwright script only when selectors, login, assertions, or fixtures are needed.
5. Use `opensandbox_run_playwright` for browser checks.
6. Download screenshots, traces, logs, or generated files with `opensandbox_download_file`.
7. If supporting commands are needed, keep them minimal or switch to `opensandbox-task-runner`.
8. Delete the sandbox with `opensandbox_delete_sandbox` unless the user explicitly wants to keep it alive for follow-up debugging.

## Operating Rules

- Prefer a sandbox image that already contains the runtime you need. For UI tests, prefer an image with `node`, browsers, and `playwright` preinstalled.
- Keep artifacts inside a predictable directory such as `/workspace/opensandbox-artifacts`.
- When the UI test is simple, omit a custom script and let `opensandbox_run_playwright` generate the default screenshot smoke test.
- When the UI test needs selectors, login flows, or assertions, provide a full Playwright script through the tool input.
- If the command should continue after the initial tool call, run it with `background: true` and then poll `opensandbox_get_command_logs`.
- Do not leave long-lived sandboxes behind unless the user asked for a persistent debugging session.

## Request Patterns

Use this skill when the user says things like:

- "Use OpenSandbox to test this web page."
- "Run Playwright in an isolated environment."
- "Collect screenshots and logs from a disposable browser environment."
- "Open this page and verify the login flow."
- "Capture browser evidence for this feature."

## Default Playbook

For a fresh UI smoke test:

1. `opensandbox_create_sandbox` with a browser-capable image.
2. `opensandbox_wait_sandbox`.
3. `opensandbox_run_playwright` with `targetUrl`.
4. `opensandbox_download_file` for the screenshot.
5. `opensandbox_delete_sandbox`.

For service startup, build, or command-only tasks, use `opensandbox-task-runner` or `opensandbox-project-acceptance`.

## Resources

- `references/opensandbox-workflow.md`: control-plane, execd, and task flow notes
- `references/playwright-recipes.md`: practical Playwright patterns for smoke checks and richer UI scripts
- `scripts/playwright-smoke-template.mjs`: minimal custom Playwright script template for upload-and-run flows
