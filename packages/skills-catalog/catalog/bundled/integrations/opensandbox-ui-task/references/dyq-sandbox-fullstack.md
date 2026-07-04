# DYQ Sandbox Full-Stack

Use this flow when the user wants the DYQ backend and the `ai-ui-admin-vue3aa` frontend to run inside one OpenSandbox sandbox.

## Scope

- Backend repo path: `/workspace/dyq`
- Frontend repo path: `/workspace/ai-ui-admin-vue3aa`
- Backend runtime: Java 17, Maven, Spring Boot
- Frontend runtime: Node 22, pnpm, Vite + Vue 3

This flow assumes the frontend repository is available separately from the backend checkout.

## Pre-requisites

The sandbox must be able to reach:

- MySQL
- Redis
- RabbitMQ

The bootstrap scripts install toolchains only. They do not provision those services inside the sandbox.

## Recommended Sandbox Image

Use a Debian or Ubuntu based image so the bootstrap script can install packages with `apt-get`.

Recommended approach:

1. Create a sandbox from a base Linux image.
2. Upload or bind-mount the DYQ repository into `/workspace/dyq`.
3. Upload or bind-mount the `ai-ui-admin-vue3aa` repository into `/workspace/ai-ui-admin-vue3aa`.
4. Run `scripts/bootstrap-dyq-sandbox.sh /workspace`.
5. Provide Spring connection env vars or config overrides.
6. Run backend and frontend launch scripts.

## Script Set

- `scripts/bootstrap-dyq-sandbox.sh`
- `scripts/start-dyq-backend.sh`
- `scripts/start-dyq-frontend.sh`
- `scripts/start-dyq-fullstack.sh`

## Example Command Sequence

```bash
bash /workspace/opensandbox-orchestrator/scripts/bootstrap-dyq-sandbox.sh /workspace
bash /workspace/opensandbox-orchestrator/scripts/start-dyq-fullstack.sh /workspace
```

## Runtime Defaults

- Backend profile: `test`
- Backend port: `48080`
- Frontend mode: `test`
- Frontend port: `48000`
- Frontend host: `0.0.0.0`
- Logs: `/workspace/.sandbox-logs/`

## Expected Evidence

After startup, collect:

- backend log tail
- frontend log tail
- listening ports
- one UI smoke check against the frontend URL
