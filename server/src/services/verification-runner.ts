import { spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { performance } from "node:perf_hooks";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { tasks, taskVerifications, type TaskVerificationEvidence, type TaskVerificationSpec, type TaskVerificationSummary } from "@paperclipai/db";

/**
 * Default per-check timeout (seconds). Each kind can override via its own
 * `timeoutSec` field. Keep small to avoid scheduler stalls — long-running
 * test suites should run inside CI, not the local verify loop.
 */
const DEFAULT_TIMEOUT_SEC = 60;

/**
 * Maximum size of captured stdout/stderr per check, in bytes. Anything
 * larger is truncated to keep `task_verifications.evidence` bounded.
 */
const MAX_OUTPUT_BYTES = 16 * 1024;

const SUPPORTED_KINDS = new Set([
  "run-tests",
  "typecheck",
  "lint",
  "build",
  "file-exists",
  "http-probe",
  "custom-exit-zero",
]);

export interface VerifyOptions {
  /** Override cwd for command-based checks. Defaults to task worktree root. */
  worktreeCwd?: string;
  /** Free-form notes attached to the verification row (audit trail). */
  notes?: string;
  /** When true, persist the verification to task_verifications. Default true. */
  persist?: boolean;
}

export interface VerifyResult {
  /** Aggregate from exit codes — source of truth. */
  passed: boolean;
  /** Structured per-check evidence. */
  evidence: TaskVerificationEvidence;
  /** LLM interpretation of evidence. Null when short-circuited on hard fail. */
  llmSummary: TaskVerificationSummary | null;
  /** Database row id when persisted. */
  verificationId: string | null;
}

/**
 * Parse a `verification_spec` blob. Returns a structured spec or throws
 * with a list of every problem found (so the caller can return all issues
 * to the LLM in one shot rather than discovering them serially).
 */
export function parseVerificationSpec(value: unknown): {
  ok: true;
  spec: TaskVerificationSpec;
} | {
  ok: false;
  errors: string[];
} {
  const errors: string[] = [];
  if (value == null) {
    return { ok: false, errors: ["verification_spec is required"] };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["verification_spec must be an object with `checks`"] };
  }
  const root = value as Partial<TaskVerificationSpec>;
  if (!Array.isArray(root.checks) || root.checks.length === 0) {
    return { ok: false, errors: ["verification_spec.checks must be a non-empty array"] };
  }
  const checks = [] as TaskVerificationSpec["checks"];
  root.checks.forEach((raw, index) => {
    const location = `checks[${index}]`;
    if (typeof raw !== "object" || raw == null) {
      errors.push(`${location} must be an object`);
      return;
    }
    const candidate = raw as { kind?: unknown } & Record<string, unknown>;
    const kind = candidate.kind;
    if (typeof kind !== "string" || !SUPPORTED_KINDS.has(kind)) {
      errors.push(`${location}.kind must be one of: ${Array.from(SUPPORTED_KINDS).join(", ")}`);
      return;
    }
    const parsed = validateCheck(location, kind, candidate);
    if ("error" in parsed) {
      errors.push(parsed.error);
      return;
    }
    checks.push(parsed.check as TaskVerificationSpec["checks"][number]);
  });
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    spec: {
      checks,
      rationale: typeof root.rationale === "string" ? root.rationale : undefined,
    },
  };
}

function validateCheck(
  location: string,
  kind: string,
  raw: Record<string, unknown>,
): { check: TaskVerificationSpec["checks"][number] } | { error: string } {
  switch (kind) {
    case "run-tests":
    case "typecheck":
    case "lint":
    case "build":
    case "custom-exit-zero": {
      if (typeof raw.command !== "string" || raw.command.trim().length === 0) {
        return { error: `${location}.command is required for kind=${kind}` };
      }
      const check = {
        kind,
        command: raw.command.trim(),
        cwd: typeof raw.cwd === "string" ? raw.cwd : undefined,
        expectedExit: kind === "custom-exit-zero" ? 0 : typeof raw.expectedExit === "number" ? raw.expectedExit : 0,
        timeoutSec: typeof raw.timeoutSec === "number" && raw.timeoutSec > 0 ? Math.round(raw.timeoutSec) : undefined,
      } as TaskVerificationSpec["checks"][number];
      return { check };
    }
    case "file-exists": {
      if (typeof raw.path !== "string" || raw.path.trim().length === 0) {
        return { error: `${location}.path is required for kind=file-exists` };
      }
      return { check: { kind, path: raw.path.trim() } };
    }
    case "http-probe": {
      const method = raw.method;
      if (method !== "GET" && method !== "POST" && method !== "PUT" && method !== "DELETE") {
        return { error: `${location}.method must be GET, POST, PUT, or DELETE` };
      }
      if (typeof raw.url !== "string" || !/^https?:\/\//.test(raw.url)) {
        return { error: `${location}.url must be an http(s) URL` };
      }
      if (typeof raw.expectStatus !== "number" || raw.expectStatus < 100 || raw.expectStatus > 599) {
        return { error: `${location}.expectStatus must be a 3-digit HTTP status number` };
      }
      const check: TaskVerificationSpec["checks"][number] = {
        kind,
        method,
        url: raw.url,
        expectStatus: raw.expectStatus,
        expectBodyContains: typeof raw.expectBodyContains === "string" ? raw.expectBodyContains : undefined,
        timeoutSec: typeof raw.timeoutSec === "number" && raw.timeoutSec > 0 ? Math.round(raw.timeoutSec) : undefined,
      };
      return { check };
    }
    default:
      return { error: `${location}.kind=${kind} is not supported` };
  }
}

/**
 * Execute a single check and capture structured evidence. Throws only on
 * programmer errors (unsupported kind); runtime failures are encoded in
 * the returned evidence so the runner can keep going for the rest.
 */
async function runCheck(
  check: TaskVerificationSpec["checks"][number],
  worktreeCwd: string | undefined,
): Promise<TaskVerificationEvidence["checks"][number]> {
  const startedAt = performance.now();

  try {
    if (check.kind === "file-exists") {
      const target = resolvePath(worktreeCwd ?? process.cwd(), check.path);
      try {
        await access(target);
        const info = await stat(target);
        return {
          kind: check.kind,
          path: target,
          passed: true,
          exitCode: 0,
          stdoutTail: `exists (${info.isFile() ? "file" : info.isDirectory() ? "directory" : "other"}, ${info.size} bytes)`,
          stderrTail: "",
          durationMs: Math.round(performance.now() - startedAt),
        };
      } catch (err) {
        return {
          kind: check.kind,
          path: target,
          passed: false,
          exitCode: null,
          stdoutTail: "",
          stderrTail: err instanceof Error ? err.message : String(err),
          durationMs: Math.round(performance.now() - startedAt),
        };
      }
    }

    if (check.kind === "http-probe") {
      const timeoutSec = check.timeoutSec ?? DEFAULT_TIMEOUT_SEC;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutSec * 1000);
      try {
        const response = await fetch(check.url, {
          method: check.method,
          signal: controller.signal,
        });
        const body = await response.text();
        const bodyMatch =
          typeof check.expectBodyContains === "string"
            ? body.includes(check.expectBodyContains)
            : true;
        const passed = response.status === check.expectStatus && bodyMatch;
        return {
          kind: check.kind,
          method: check.method,
          url: check.url,
          passed,
          exitCode: response.status,
          stdoutTail: truncate(body),
          stderrTail: bodyMatch ? "" : `expected body to contain: ${check.expectBodyContains}`,
          durationMs: Math.round(performance.now() - startedAt),
        };
      } catch (err) {
        return {
          kind: check.kind,
          method: check.method,
          url: check.url,
          passed: false,
          exitCode: null,
          stdoutTail: "",
          stderrTail: err instanceof Error ? err.message : String(err),
          durationMs: Math.round(performance.now() - startedAt),
          errorMessage: err instanceof Error ? err.name : "fetch-error",
        };
      } finally {
        clearTimeout(timer);
      }
    }

    // Command-based checks (run-tests / typecheck / lint / build /
    // custom-exit-zero). All carry `command`; some carry optional
    // `cwd` / `timeoutSec` / `expectedExit`.
    const cwd = check.cwd ? resolvePath(worktreeCwd ?? process.cwd(), check.cwd) : worktreeCwd;
    const timeoutSec = check.timeoutSec ?? DEFAULT_TIMEOUT_SEC;
    const expectedExit = "expectedExit" in check ? check.expectedExit : 0;
    return await runCommand(check.command, cwd, timeoutSec, expectedExit, startedAt);
  } catch (err) {
    return {
      kind: check.kind,
      passed: false,
      exitCode: null,
      stdoutTail: "",
      stderrTail: err instanceof Error ? err.message : String(err),
      durationMs: Math.round(performance.now() - startedAt),
      errorMessage: err instanceof Error ? err.name : "runner-error",
    };
  }
}

function runCommand(
  command: string,
  cwd: string | undefined,
  timeoutSec: number,
  expectedExit: number,
  startedAt: number,
): Promise<TaskVerificationEvidence["checks"][number]> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let child;
    try {
      child = spawn(command, {
        cwd,
        shell: true,
        env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({
        kind: "command",
        command,
        cwd: cwd ?? undefined,
        passed: false,
        exitCode: null,
        stdoutTail: "",
        stderrTail: err instanceof Error ? err.message : String(err),
        durationMs: Math.round(performance.now() - startedAt),
        errorMessage: "spawn-error",
      });
      return;
    }
    const finish = (passed: boolean, exitCode: number | null, errorMessage?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        kind: "command",
        command,
        cwd: cwd ?? undefined,
        passed,
        exitCode,
        stdoutTail: truncate(stdout),
        stderrTail: truncate(stderr),
        durationMs: Math.round(performance.now() - startedAt),
        errorMessage,
      });
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore — process may already be dead
      }
      finish(false, null, `timeout after ${timeoutSec}s`);
    }, timeoutSec * 1000);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > MAX_OUTPUT_BYTES * 4) {
        stdout = stdout.slice(-MAX_OUTPUT_BYTES * 4);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > MAX_OUTPUT_BYTES * 4) {
        stderr = stderr.slice(-MAX_OUTPUT_BYTES * 4);
      }
    });
    child.on("error", (err) => {
      finish(false, null, err.message);
    });
    child.on("exit", (code) => {
      finish(code === expectedExit, code);
    });
  });
}

function truncate(value: string): string {
  if (value.length <= MAX_OUTPUT_BYTES) return value;
  const head = value.slice(0, Math.floor(MAX_OUTPUT_BYTES / 2));
  const tail = value.slice(-Math.floor(MAX_OUTPUT_BYTES / 2));
  return `${head}\n...[truncated ${value.length - MAX_OUTPUT_BYTES} bytes]...\n${tail}`;
}

/**
 * Verify a task. Loads its `verification_spec`, executes every check, and
 * persists a `task_verifications` row. The `passed` aggregate is derived
 * purely from exit codes / probe results — the LLM (if invoked) can only
 * summarize, never override.
 *
 * Callers that want LLM interpretation should pass the returned `evidence`
 * into `summarizeVerification()`.
 */
export async function verifyTask(
  db: Db,
  taskId: string,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const rows = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  const task = rows[0];
  if (!task) {
    throw new Error(`task not found: ${taskId}`);
  }
  if (!task.verificationSpec) {
    throw new Error(`task ${taskId} has no verification_spec — cannot verify`);
  }
  const parsed = parseVerificationSpec(task.verificationSpec);
  if (!parsed.ok) {
    throw new Error(`task ${taskId} verification_spec is invalid: ${parsed.errors.join("; ")}`);
  }
  const startedAt = performance.now();
  const checkResults = [] as TaskVerificationEvidence["checks"];
  for (const check of parsed.spec.checks) {
    // Sequential execution: predictable ordering, easier to debug, and
    // avoids overloading the agent's host while the rest of the system is
    // also busy. Parallelization can come later if P95 latency demands it.
    const result = await runCheck(check, options.worktreeCwd);
    checkResults.push(result);
  }
  const hardPassed = checkResults.every((c) => c.passed);
  const evidence: TaskVerificationEvidence = {
    checks: checkResults,
    hardPassed,
    totalDurationMs: Math.round(performance.now() - startedAt),
  };
  const shouldPersist = options.persist !== false;
  let verificationId: string | null = null;
  if (shouldPersist) {
    const inserted = await db
      .insert(taskVerifications)
      .values({
        taskId,
        attemptNumber: (task.attempts ?? 0) + 1,
        evidence,
        llmSummary: null,
        passed: hardPassed,
        notes: options.notes ?? null,
      })
      .returning({ id: taskVerifications.id });
    verificationId = inserted[0]?.id ?? null;
    // Persist aggregate on the task itself for fast scheduler reads AND
    // emit a human-readable retry digest so the monitor's retry loop can
    // prepend it to the next attempt's description without re-parsing
    // the full evidence JSON.
    const failureDigest = hardPassed
      ? null
      : evidence.checks
          .filter((c) => !c.passed)
          .map((c) => {
            const label = c.command ?? c.path ?? c.url ?? c.kind;
            const tail = c.stderrTail || (c.exitCode !== null ? `exit ${c.exitCode}` : "no exit code");
            return `[${c.kind}: ${label}] ${tail}`.trim();
          })
          .join("\n");
    await db
      .update(tasks)
      .set({
        verificationResult: JSON.stringify({
          hardPassed,
          evidenceId: verificationId,
          failureDigest,
          verifiedAt: new Date().toISOString(),
        }),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));
  }
  return {
    passed: hardPassed,
    evidence,
    llmSummary: null,
    verificationId,
  };
}

/**
 * Build the prompt + payload for the LLM to summarize a verification
 * attempt. The LLM's role is purely interpretive — it can NEVER flip a
 * hard failure into a pass. If `hardPassed` is false, the returned prompt
 * explicitly forbids that.
 */
export function buildVerifySummaryPrompt(evidence: TaskVerificationEvidence): {
  system: string;
  user: string;
} {
  const hardFailures = evidence.checks.filter((c) => !c.passed);
  const system = hardFailures.length === 0
    ? "You are a release engineer reviewing a passing verification. Summarize in one sentence per check why it succeeded; quote key output excerpts. Output JSON {passed:true, summary, issues:[]}."
    : "You are a release engineer reviewing a failed verification. The `hard_passed` flag is false and CANNOT be overridden. Output JSON {passed:false, summary, issues[]}; each issue must quote the failing check's stderr or non-zero exit code verbatim. Do NOT speculate about causes outside the evidence.";
  const user = JSON.stringify(
    {
      hard_passed: evidence.hardPassed,
      checks: evidence.checks.map((c) => ({
        kind: c.kind,
        command: c.command ?? null,
        path: c.path ?? null,
        url: c.url ?? null,
        passed: c.passed,
        exit_code: c.exitCode,
        duration_ms: c.durationMs,
        stdout_tail: c.stdoutTail,
        stderr_tail: c.stderrTail,
        error_message: c.errorMessage ?? null,
      })),
    },
    null,
    2,
  );
  return { system, user };
}

/**
 * Convenience: look up the most recent verification row for a task. Used
 * by the monitor's retry-with-context path so the next attempt can read
 * the previous failure instead of starting from zero.
 */
export async function getLatestVerification(db: Db, taskId: string) {
  const rows = await db
    .select()
    .from(taskVerifications)
    .where(eq(taskVerifications.taskId, taskId))
    .orderBy(sql`${taskVerifications.createdAt} DESC`)
    .limit(1);
  return rows[0] ?? null;
}