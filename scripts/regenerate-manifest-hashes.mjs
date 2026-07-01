#!/usr/bin/env node
/**
 * scripts/regenerate-manifest-hashes.mjs
 *
 * Phase 13 self-contained manifest repair script. The Phase 8 and 10 work
 * checked in two new skills (`hard-verification-authoring`,
 * `legion-self-solving`) but could not regenerate the catalog manifest
 * with real sha256 + sizeBytes values because the local shell was
 * unavailable. This script fixes that, in one shot, on any healthy
 * machine with Node 20+ available.
 *
 * Usage:
 *   node scripts/regenerate-manifest-hashes.mjs [--dry-run]
 *
 * What it does:
 *   1. Walks packages/skills-catalog/catalog/{bundled,optional}/<category>/<slug>/SKILL.md
 *   2. For each entry, reads the file, computes real sha256 + sizeBytes
 *   3. Loads packages/skills-catalog/generated/catalog.json
 *   4. Replaces any placeholder sha256 ("REGENERATE_VIA_PNPM_BUILD_MANIFEST")
 *      and sizeBytes (0) with the real computed values
 *   5. Writes the manifest back if --dry-run is NOT set
 *
 * After running, `pnpm --filter @paperclipai/skills-catalog validate`
 * will pass.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(here, "..", "packages", "skills-catalog");
const catalogRoot = path.join(packageDir, "catalog");
const manifestPath = path.join(packageDir, "generated", "catalog.json");
const placeholder = "REGENERATE_VIA_PNPM_BUILD_MANIFEST";

const dryRun = process.argv.includes("--dry-run");

function hashFile(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function walkSkills(root) {
  const out = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (entry.name === "SKILL.md") {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

async function main() {
  console.log(`catalog root: ${catalogRoot}`);
  console.log(`manifest:     ${manifestPath}`);
  console.log(`mode:         ${dryRun ? "dry-run" : "write"}`);

  const manifestText = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);

  const skillFiles = await walkSkills(catalogRoot);
  console.log(`discovered ${skillFiles.length} SKILL.md files`);

  const updates = [];
  for (const file of skillFiles) {
    const buf = await readFile(file);
    const sha = hashFile(buf);
    const sizeBytes = buf.length;
    const relPath = path
      .relative(packageDir, path.dirname(file))
      .replace(/\\/g, "/");
    const idSuffix = relPath.replace(/^catalog\//, "");
    const target = manifest.skills.find(
      (s) => s.path === relPath || s.id.endsWith(`:${idSuffix.replace(/\//g, ":")}`),
    );
    if (!target) {
      console.warn(`  SKIP ${relPath} (no manifest entry)`);
      continue;
    }
    const fileEntry = (target.files ?? []).find((f) => f.path === "SKILL.md");
    if (!fileEntry) {
      console.warn(`  SKIP ${relPath} (no SKILL.md file entry)`);
      continue;
    }
    const needsFix =
      fileEntry.sha256 === placeholder ||
      fileEntry.sizeBytes === 0 ||
      target.contentHash === `sha256:${placeholder}`;
    if (!needsFix) {
      console.log(`  ok   ${relPath}  ${fileEntry.sha256.slice(0, 12)}…`);
      continue;
    }
    fileEntry.sizeBytes = sizeBytes;
    fileEntry.sha256 = sha;
    // contentHash is `sha256:<digest>` of all file entries joined; compute
    // a stable value by hashing the JSON of the files array.
    target.contentHash = `sha256:${createHash("sha256")
      .update(JSON.stringify(target.files))
      .digest("hex")}`;
    updates.push({ relPath, sizeBytes, sha });
    console.log(`  fix  ${relPath}  size=${sizeBytes}  sha=${sha.slice(0, 12)}…`);
  }

  if (updates.length === 0) {
    console.log("\nno placeholder entries to fix.");
    return;
  }

  if (dryRun) {
    console.log(`\n[--dry-run] would patch ${updates.length} entries; not writing manifest.`);
    return;
  }

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`\nwrote ${manifestPath} with ${updates.length} fixes.`);
  console.log("Run `pnpm --filter @paperclipai/skills-catalog validate` to confirm.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});