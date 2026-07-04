import type { AdapterExecutionContext, AdapterExecutionResult } from "../types.js";
import {
  asString,
  asNumber,
  asStringArray,
  parseObject,
  buildPaperclipEnv,
  buildInvocationEnvForLogs,
  ensurePathInEnv,
  resolveCommandForLogs,
  runChildProcess,
} from "../utils.js";

// Windows/POSIX builtins like `echo`, `dir`, `cd` are not standalone
// executables — spawn() fails with ENOENT. When the bare command can't be
// resolved, transparently re-run through the platform shell so users can
// paste familiar shell commands without remembering to prefix `cmd /c`.
function isMissingExecutable(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: string }).code === "ENOENT");
}

function shellWrappedCommand(
  command: string,
  args: string[],
): { command: string; args: string[] } {
  if (process.platform === "win32") {
    // /d skips AutoRun; /s preserves quotes verbatim; /c runs and exits.
    const quoted = args.map((a) => (/\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");
    const combined = quoted ? `${command} ${quoted}` : command;
    return { command: "cmd.exe", args: ["/d", "/s", "/c", combined] };
  }
  const combined = [command, ...args]
    .map((a) => (/[\s"'\\$`]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))
    .join(" ");
  return { command: "/bin/sh", args: ["-c", combined] };
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, config, onLog, onMeta } = ctx;
  const command = asString(config.command, "");
  if (!command) throw new Error("Process adapter missing command");

  const args = asStringArray(config.args);
  const cwd = asString(config.cwd, process.cwd());
  const envConfig = parseObject(config.env);
  const env: Record<string, string> = { ...buildPaperclipEnv(agent) };
  for (const [k, v] of Object.entries(envConfig)) {
    if (typeof v === "string") env[k] = v;
  }
  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });
  const resolvedCommand = await resolveCommandForLogs(command, cwd, runtimeEnv);
  const loggedEnv = buildInvocationEnvForLogs(env, {
    runtimeEnv,
    includeRuntimeKeys: ["HOME"],
    resolvedCommand,
  });

  const timeoutSec = asNumber(config.timeoutSec, 0);
  const graceSec = asNumber(config.graceSec, 15);

  if (onMeta) {
    await onMeta({
      adapterType: "process",
      command: resolvedCommand,
      cwd,
      commandArgs: args,
      env: loggedEnv,
    });
  }

  let proc: Awaited<ReturnType<typeof runChildProcess>>;
  try {
    proc = await runChildProcess(runId, command, args, {
      cwd,
      env,
      timeoutSec,
      graceSec,
      onLog,
    });
  } catch (err) {
    if (!isMissingExecutable(err)) throw err;
    // Bare command not on PATH — try once more through the platform shell
    // so builtins (`echo`, `dir`, ...) and PATH-less scripts still work.
    const wrapped = shellWrappedCommand(command, args);
    proc = await runChildProcess(runId, wrapped.command, wrapped.args, {
      cwd,
      env,
      timeoutSec,
      graceSec,
      onLog,
    });
  }

  if (proc.timedOut) {
    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: true,
      errorMessage: `Timed out after ${timeoutSec}s`,
    };
  }

  if ((proc.exitCode ?? 0) !== 0) {
    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: false,
      errorMessage: `Process exited with code ${proc.exitCode ?? -1}`,
      resultJson: {
        stdout: proc.stdout,
        stderr: proc.stderr,
      },
    };
  }

  return {
    exitCode: proc.exitCode,
    signal: proc.signal,
    timedOut: false,
    resultJson: {
      stdout: proc.stdout,
      stderr: proc.stderr,
    },
  };
}
