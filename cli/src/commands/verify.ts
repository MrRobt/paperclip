/**
 * Phase 12 of doc/plans/2026-06-30-self-solving-agent-team.md.
 *
 * `paperclipai verify <taskId>` — operator / agent entry point to the
 * verification-runner service. Calls `POST /api/legion/tasks/:id/verify`
 * and prints the structured evidence + LLM summary. The hard pass/fail
 * is determined server-side from exit codes; this CLI never overrides
 * that signal — it only renders it.
 */

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

interface VerifyOptions extends BaseClientOptions {
  taskId: string;
  cwd?: string;
  notes?: string;
  skipLlmSummary?: boolean;
}

interface VerifyResponse {
  passed: boolean;
  evidence: {
    checks: Array<{
      kind: string;
      command?: string | null;
      path?: string | null;
      url?: string | null;
      passed: boolean;
      exitCode: number | null;
      stdoutTail: string;
      stderrTail: string;
      durationMs: number;
      errorMessage?: string | null;
    }>;
    hardPassed: boolean;
    totalDurationMs: number;
  };
  llmSummary: {
    passed: boolean;
    summary: string;
    issues: string[];
  } | null;
  verificationId: string | null;
}

export function registerVerifyCommand(program: Command): void {
  const verify = program
    .command("verify")
    .description("Verify a Legion task by running its structured verification_spec")
    .argument("<taskId>", "Task ID to verify");

  addCommonClientOptions(verify)
    .option("--cwd <path>", "Override cwd for command-based checks (defaults to task worktree root)")
    .option("--notes <text>", "Audit notes attached to the verification row")
    .option("--skip-llm-summary", "Skip the LLM interpretive summary; hard result only", false)
    .action(async (taskId: string, opts: Omit<VerifyOptions, "taskId">) => {
      try {
        const ctx = resolveCommandContext(opts, { requireCompany: false });
        const response = await ctx.api.post<VerifyResponse>(
          apiPath`/api/legion/tasks/${taskId}/verify`,
          {
            worktreeCwd: opts.cwd,
            notes: opts.notes,
            skipLlmSummary: opts.skipLlmSummary,
          },
        );
        if (!response) {
          throw new Error("No verify response returned by server");
        }
        if (ctx.json) {
          printOutput(response, { json: true });
          return;
        }
        renderHuman(response);
        if (!response.passed) {
          process.exitCode = 1;
        }
      } catch (err) {
        handleCommandError(err);
      }
    });
}

function renderHuman(response: VerifyResponse): void {
  const verdict = response.passed ? pc.green("PASS") : pc.red("FAIL");
  console.log(`${verdict}  total ${response.evidence.totalDurationMs}ms`);
  for (const check of response.evidence.checks) {
    const label = check.command ?? check.path ?? check.url ?? check.kind;
    const status = check.passed ? pc.green("✓") : pc.red("✗");
    const exit = check.exitCode !== null ? `exit ${check.exitCode}` : "no-exit";
    console.log(`  ${status} ${check.kind.padEnd(16)} ${label}  (${exit}, ${check.durationMs}ms)`);
    if (!check.passed) {
      const tail = (check.stderrTail || check.stdoutTail || "").trim();
      if (tail) {
        for (const line of tail.split(/\r?\n/).slice(0, 5)) {
          console.log(`      ${pc.gray(line)}`);
        }
      }
    }
  }
  if (response.llmSummary) {
    console.log("");
    console.log(pc.bold("Summary"));
    console.log(`  ${response.llmSummary.summary}`);
    if (response.llmSummary.issues.length > 0) {
      console.log(pc.bold("Issues"));
      for (const issue of response.llmSummary.issues) {
        console.log(`  - ${issue}`);
      }
    }
  }
  if (response.verificationId) {
    console.log(pc.dim(`\nverification_id=${response.verificationId}`));
  }
}