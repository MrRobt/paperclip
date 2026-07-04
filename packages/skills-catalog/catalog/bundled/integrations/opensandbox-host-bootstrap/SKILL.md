---
name: opensandbox-host-bootstrap
description: Prepare or repair a remote Linux host for OpenSandbox usage. Use when the user provides server credentials or asks Codex/Claude to install, start, verify, or troubleshoot an OpenSandbox server on a remote machine before running sandboxed tasks, UI tests, project acceptance checks, or agent workloads.
key: paperclipai/bundled/integrations/opensandbox-host-bootstrap
recommendedForRoles:
  - devops
  - engineer
  - qa
tags:
  - opensandbox
  - sandbox
  - integration
  - bootstrap
---

# OpenSandbox Host Bootstrap

Use this skill when OpenSandbox itself is not ready yet. The goal is to turn a reachable Linux host into a reusable OpenSandbox control plane, then return a verified base URL.

## Workflow

1. Collect host, SSH user, and credential source from the user or runtime context.
2. Do not persist secrets in this repository, shell history snippets, docs, commits, or evidence files.
3. Call `opensandbox_bootstrap_remote_host` with the host details.
4. Verify the returned base URL with `opensandbox_health`.
5. If health fails, inspect the remote service log path returned by the tool before retrying.
6. Report the base URL, config path, log path, and whether authentication is enabled.

## Operating Rules

- Prefer key-based SSH when available; use passwords only as transient runtime input.
- Treat server credentials, API keys, SSH keys, and private repository tokens as secrets.
- Do not install project-specific dependencies here. This skill only prepares OpenSandbox and its base runtime dependencies.
- If Docker is unavailable after bootstrap, stop and report the host-level blocker.
- If the host is already running OpenSandbox, run health checks before changing anything.

## Expected Evidence

- OpenSandbox base URL
- `opensandbox_health` result
- Remote config path
- Remote log path
- Any remaining host-level blocker

## References

- `references/bootstrap-checklist.md`: concise checks for install, health, and failure handling
