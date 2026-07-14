import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareClaudeConfigSeed } from "./claude-config.js";

describe("prepareClaudeConfigSeed", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (!dir) continue;
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  function createEnv(root: string, sourceDir: string): NodeJS.ProcessEnv {
    return {
      HOME: root,
      PAPERCLIP_HOME: path.join(root, "paperclip-home"),
      PAPERCLIP_INSTANCE_ID: "test-instance",
      CLAUDE_CONFIG_DIR: sourceDir,
    };
  }

  /** Narrows the nullable seed result for cases that must produce a directory. */
  function seededDir(value: string | null): string {
    if (value === null) throw new Error("expected a Claude config seed directory, got null");
    return value;
  }

  it("returns null when the shared config dir has nothing worth seeding", async () => {
    // Guards a real regression path: on SSH the remote box may already hold a
    // working ~/.claude. If the Paperclip host has no credentials to seed we
    // must NOT point CLAUDE_CONFIG_DIR at an empty managed dir, or we would
    // break a previously working setup. Returning null keeps the remote's own
    // config in play.
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-claude-config-empty-"));
    cleanupDirs.push(root);
    const sourceDir = path.join(root, "claude-source");
    await fs.mkdir(sourceDir, { recursive: true });

    const onLog = vi.fn(async () => {});
    const env = createEnv(root, sourceDir);

    await expect(prepareClaudeConfigSeed(env, onLog, "company-1")).resolves.toBeNull();
  });

  it("reuses the same snapshot path when the seeded files are unchanged", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-claude-config-seed-"));
    cleanupDirs.push(root);
    const sourceDir = path.join(root, "claude-source");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, "settings.json"), JSON.stringify({ theme: "light" }), "utf8");

    const onLog = vi.fn(async () => {});
    const env = createEnv(root, sourceDir);

    const first = seededDir(await prepareClaudeConfigSeed(env, onLog, "company-1"));
    const second = seededDir(await prepareClaudeConfigSeed(env, onLog, "company-1"));

    expect(first).toBe(second);
    await expect(fs.readFile(path.join(first, "settings.json"), "utf8"))
      .resolves.toBe(JSON.stringify({ theme: "light" }));
  });

  it("keeps an existing snapshot intact when the seeded files change", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-claude-config-race-"));
    cleanupDirs.push(root);
    const sourceDir = path.join(root, "claude-source");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, "settings.json"), JSON.stringify({ theme: "light" }), "utf8");

    const onLog = vi.fn(async () => {});
    const env = createEnv(root, sourceDir);
    const first = seededDir(await prepareClaudeConfigSeed(env, onLog, "company-1"));

    await fs.writeFile(path.join(sourceDir, "settings.json"), JSON.stringify({ theme: "dark" }), "utf8");
    const second = seededDir(await prepareClaudeConfigSeed(env, onLog, "company-1"));

    expect(second).not.toBe(first);
    await expect(fs.readFile(path.join(first, "settings.json"), "utf8"))
      .resolves.toBe(JSON.stringify({ theme: "light" }));
    await expect(fs.readFile(path.join(second, "settings.json"), "utf8"))
      .resolves.toBe(JSON.stringify({ theme: "dark" }));
  });
});
