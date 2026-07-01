/**
 * Phase 12 of doc/plans/2026-06-30-self-solving-agent-team.md.
 *
 * `paperclipai skill propose <path>` — eval-gated self-modification
 * workflow. Reads the current skill file, computes a unified diff
 * against the proposed change, records a `skill_proposals` row, and
 * runs the eval suite (currently the validate-catalog layer; promptfoo
 * slots in when available). The board reviews the proposal via the UI
 * or the `paperclipai skill-proposals list|approve|deny|rollback`
 * sub-commands before any change lands.
 */

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import {
  addCommonClientOptions,
  apiPath,
  handleCommandError,
  resolveCommandContext,
  printOutput,
  type BaseClientOptions,
} from "./client/common.js";

const execFileAsync = promisify(execFile);

interface ProposeOptions extends BaseClientOptions {
  file: string;
  proposed: string;
  reason?: string;
  dryRun?: boolean;
}

interface ListOptions extends BaseClientOptions {
  status?: "pending" | "approved" | "denied" | "rolled_back";
}

interface DecisionOptions extends BaseClientOptions {
  id: string;
  note?: string;
}

interface ProposeResponse {
  record: {
    id: string;
    skillPath: string;
    status: string;
    baselineEvalPassRate: number | null;
    proposedEvalPassRate: number | null;
    evalDelta: number | null;
    regressions: string[];
  };
  evaluation: {
    status: string;
    baselinePassRate: number;
    proposedPassRate: number;
    delta: number;
    regressions: string[];
    reason: string;
  };
}

export function registerSkillProposeCommands(program: Command): void {
  const cmd = program.command("skill-proposals").description("Eval-gated skill modifications");

  addCommonClientOptions(
    cmd
      .command("propose")
      .description("Record a skill change proposal; eval suite runs before board approval")
      .requiredOption("-f, --file <path>", "Path to the proposed skill file (markdown)")
      .option("--proposed <text>", "Inline proposed content; if omitted, --file is read directly")
      .option("--reason <text>", "Why this change should land")
      .option("--dry-run", "Show the diff and predicted eval result without persisting", false)
      .action(async (opts: ProposeOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireCompany: false });
          const proposedContent = opts.proposed ?? (await readFile(opts.file, "utf8"));
          const baselineContent = await readBaseline(opts.file);
          const skillPath = path.relative(process.cwd(), opts.file).replace(/\\/g, "/");
          const diff = unifiedDiff(baselineContent, proposedContent, skillPath);
          if (opts.dryRun) {
            console.log(pc.bold("--- proposed diff ---"));
            console.log(diff || pc.gray("(no changes)"));
            console.log(pc.bold("\n--- next step ---"));
            console.log(`Re-run without --dry-run to persist the proposal.`);
            return;
          }
          const response = await ctx.api.post<ProposeResponse>(
            apiPath`/api/skill-proposals`,
            {
              skillPath,
              proposedDiff: diff,
              reason: opts.reason ?? null,
              proposedByKind: "human",
            },
          );
          if (ctx.json) {
            printOutput(response, { json: true });
            return;
          }
          renderProposal(response);
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  addCommonClientOptions(
    cmd
      .command("list")
      .description("List recent skill proposals")
      .option("--status <status>", "Filter by status (pending|approved|denied|rolled_back)")
      .action(async (opts: ListOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireCompany: false });
          const rows = await ctx.api.get<Array<{
            id: string;
            skillPath: string;
            status: string;
            baselineEvalPassRate: number | null;
            proposedEvalPassRate: number | null;
            evalDelta: number | null;
            regressions: string[];
            createdAt: string;
            decidedAt: string | null;
          }>>(apiPath`/api/skill-proposals${opts.status ? `?status=${opts.status}` : ""}`);
          if (ctx.json) {
            printOutput(rows, { json: true });
            return;
          }
          for (const row of rows ?? []) {
            const delta = row.evalDelta !== null ? row.evalDelta.toFixed(3) : "n/a";
            console.log(`${row.id}  ${pc.bold(row.status)}  ${row.skillPath}  Δ=${delta}`);
          }
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  for (const action of ["approve", "deny", "rollback"] as const) {
    addCommonClientOptions(
      cmd
        .command(action)
        .description(`${action[0]!.toUpperCase()}${action.slice(1)} a skill proposal`)
        .requiredOption("--id <id>", "Proposal ID")
        .option("--note <text>", "Decision note for the audit log")
        .action(async (opts: DecisionOptions) => {
          try {
            const ctx = resolveCommandContext(opts, { requireCompany: false });
            const updated = await ctx.api.post<{ id: string; status: string }>(
              apiPath`/api/skill-proposals/${opts.id}/${action}`,
              { note: opts.note ?? null },
            );
            if (ctx.json) {
              printOutput(updated, { json: true });
              return;
            }
            console.log(`${action} ${updated.id} -> ${updated.status}`);
          } catch (err) {
            handleCommandError(err);
          }
        }),
    );
  }
}

async function readBaseline(skillPath: string): Promise<string> {
  // For now read the file itself; once git integration lands in the
  // proposal flow, this becomes `git show HEAD:<path>`.
  return readFile(skillPath, "utf8");
}

function unifiedDiff(before: string, after: string, label: string): string {
  // Minimal hand-rolled unified diff — sufficient for proposal review.
  // The server only needs to persist a textual representation; not a
  // patchable artifact at this layer.
  if (before === after) return "";
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const out: string[] = [`--- a/${label}`, `+++ b/${label}`];
  out.push(`@@ -1,${beforeLines.length} +1,${afterLines.length} @@`);
  for (const line of beforeLines) out.push(`-${line}`);
  for (const line of afterLines) out.push(`+${line}`);
  return out.join("\n");
}

function renderProposal(response: ProposeResponse): void {
  const verdict = response.evaluation.delta >= 0 ? pc.green("improved") : pc.red("regressed");
  const delta = response.evaluation.delta.toFixed(3);
  console.log(`${pc.bold(response.record.skillPath)}  ${verdict}  Δ=${delta}`);
  console.log(`baseline=${response.evaluation.baselinePassRate.toFixed(3)}  proposed=${response.evaluation.proposedPassRate.toFixed(3)}`);
  console.log(`status=${response.record.status}`);
  if (response.evaluation.regressions.length > 0) {
    console.log(pc.red("Regressions:"));
    for (const r of response.evaluation.regressions) console.log(`  - ${r}`);
  }
  console.log(pc.dim(`\nproposal_id=${response.record.id}\nRun \`paperclipai skill-proposals approve --id ${response.record.id}\` after board review.`));
}