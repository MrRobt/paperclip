# Playwright Recipes

## Fast Screenshot Smoke Test

Use `opensandbox_run_playwright` with only:

- `sandboxId`
- `targetUrl`

The MCP server will generate a script that:

- launches Chromium
- opens the target URL
- logs the final page title and URL
- saves a full-page screenshot

Download the screenshot with `opensandbox_download_file`.

## Custom Script Pattern

Provide `script` when the task needs selectors, login, or assertions.

Use this structure:

```javascript
import { chromium, expect } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(process.env.TARGET_URL, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Login" }).click();
await expect(page.getByText("Dashboard")).toBeVisible();
await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
await browser.close();
```

## Recommended Artifact Paths

- Screenshot: `/workspace/opensandbox-artifacts/page.png`
- Extra logs: `/workspace/opensandbox-artifacts/run.log`
- Trace archive: `/workspace/opensandbox-artifacts/trace.zip`

Keep artifact paths stable so download steps stay predictable.
