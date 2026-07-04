# Project Acceptance Flow

Use this reference for backend, frontend, and full-stack acceptance in OpenSandbox.

## Inputs

- project root or source archive
- runtime versions
- dependency install command
- service start command
- environment profile
- expected port or health endpoint
- smoke test command or browser target URL

## Service Startup

1. Put logs under `/workspace/opensandbox-artifacts/logs`.
2. Start each service in the background.
3. Poll the expected port or health endpoint.
4. Capture the first relevant startup failure if readiness times out.

## Full-Stack Checks

- backend health endpoint
- frontend dev or preview endpoint
- API request from frontend container context when possible
- browser screenshot when UI validation is required

## Report Template

Include:

- sandbox image
- commands executed
- endpoints checked
- artifacts downloaded
- pass/fail conclusion
- remaining risks
