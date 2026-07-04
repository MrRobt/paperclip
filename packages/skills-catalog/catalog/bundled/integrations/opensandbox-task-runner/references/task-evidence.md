# Task Evidence

Use stable paths so evidence can be downloaded predictably:

- `/workspace/opensandbox-artifacts/summary.json`
- `/workspace/opensandbox-artifacts/stdout.log`
- `/workspace/opensandbox-artifacts/stderr.log`
- `/workspace/opensandbox-artifacts/result.txt`
- `/workspace/opensandbox-artifacts/reports/`

## Summary JSON

Prefer a small machine-readable summary for command tasks:

```json
{
  "command": "npm test",
  "exitCode": 0,
  "startedAt": "2026-07-04T00:00:00Z",
  "finishedAt": "2026-07-04T00:00:10Z",
  "artifacts": ["/workspace/opensandbox-artifacts/stdout.log"]
}
```

## Minimum Evidence

- command run
- exit code or clear success condition
- downloaded artifact path
- cleanup status
