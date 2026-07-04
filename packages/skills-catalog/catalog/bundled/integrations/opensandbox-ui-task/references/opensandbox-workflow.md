# OpenSandbox Workflow

## Control Plane

- `opensandbox_health` verifies the configured base URL and whether an API key is loaded.
- `opensandbox_create_sandbox` talks to the OpenSandbox control plane.
- `opensandbox_wait_sandbox` polls until the sandbox reaches a ready state.
- `opensandbox_delete_sandbox` releases runtime resources.

## Execd Data Plane

The plugin resolves the `execd` endpoint for each sandbox and then calls the runtime APIs through that endpoint.

- Default execd port: `44772`
- Default access mode: `use_server_proxy=true`

Those defaults come from the OpenSandbox `execd` component docs and can be overridden through tool inputs or environment variables.

## Task Flow

For a command-only task:

1. Create the sandbox.
2. Wait for readiness.
3. Upload files if needed.
4. Run the command.
5. Download results.
6. Delete the sandbox.

For a browser task:

1. Use a browser-capable image.
2. Wait for readiness.
3. Optionally upload a custom Playwright script.
4. Run the script with `opensandbox_run_playwright`.
5. Download screenshots, traces, or logs.
6. Delete the sandbox.

## Failure Handling

- If `opensandbox_health` fails, fix `OPENSANDBOX_BASE_URL` or `OPENSANDBOX_API_KEY` first.
- If sandbox creation succeeds but readiness polling never reaches a ready state, inspect the sandbox metadata before retrying.
- If Playwright fails inside the sandbox, verify the image has `node`, a browser runtime, and the `playwright` package.
