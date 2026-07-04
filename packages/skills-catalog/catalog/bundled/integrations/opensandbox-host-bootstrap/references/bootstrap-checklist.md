# Host Bootstrap Checklist

Use this checklist after `opensandbox_bootstrap_remote_host`.

## Verify

- OpenSandbox server listens on the returned host and port.
- `opensandbox_health` succeeds against the returned base URL.
- Docker is installed and usable by the OpenSandbox process.
- The config path and log path are known.

## Common Failures

- SSH authentication fails: ask for the correct key, password, or user.
- Docker daemon unavailable: fix host service before sandbox creation.
- Port blocked: change OpenSandbox port or host firewall rules.
- API key mismatch: update local `OPENSANDBOX_API_KEY` or server config.

## Report

Return the base URL, whether auth is enabled, and the exact remaining blocker if bootstrap is incomplete.
