import { chromium } from "playwright";

const targetUrl = process.env.TARGET_URL;
if (!targetUrl) {
  throw new Error("TARGET_URL is required.");
}

const screenshotPath = process.env.SCREENSHOT_PATH || "/workspace/opensandbox-artifacts/page.png";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto(targetUrl, { waitUntil: "networkidle" });

console.log(JSON.stringify({
  url: page.url(),
  title: await page.title()
}));

await page.screenshot({
  path: screenshotPath,
  fullPage: true
});

await browser.close();
