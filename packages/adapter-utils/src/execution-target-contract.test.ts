import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as ssh from "./ssh.js";
import {
  adapterExecutionTargetSupportsManagedConfig,
  ensureAdapterExecutionTargetCommandResolvable,
  type AdapterExecutionTarget,
} from "./execution-target.js";
import type { RunProcessResult } from "./server-utils.js";

/**
 * The behaviour every remote execution target owes an adapter, regardless of transport.
 *
 * SSH quietly failed two of these for a long time: it never received a credential seed (so every
 * worker box had to be logged into by hand) and its command check short-circuited on the *local*
 * ssh binary, reporting a CLI that was absent from the remote host as "executable". Sandbox
 * passed both. Nothing caught the divergence, because the existing driver contract only covers
 * lease acquire/release — not what happens once an adapter actually runs against the target.
 *
 * The cases below are a `Record` keyed by transport on purpose: adding a transport to
 * `AdapterExecutionTarget` without teaching it these behaviours is a compile error here. The
 * contract has to be impossible to skip, not merely easy to remember.
 */
type RemoteTransport = Extract<AdapterExecutionTarget, { kind: "remote" }>["transport"];

interface ArrangedTarget {
  target: AdapterExecutionTarget;
  /** Everything the transport was actually asked to run on the target. */
  probedCommands: string[];
  /** Env the call must be made with — some transports need a local client on PATH. */
  env: NodeJS.ProcessEnv;
}

interface RemoteTargetContract {
  /** Stubs the transport so the agent CLI is reported as `outcome`, and records every probe. */
  arrange(outcome: "installed" | "missing"): Promise<ArrangedTarget>;
}

const cleanupDirs: string[] = [];

/** A PATH containing a stub `ssh`, so the local-client check passes without a real one. */
async function pathWithStubSsh(): Promise<NodeJS.ProcessEnv> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "paperclip-contract-ssh-"));
  cleanupDirs.push(dir);
  const sshPath = path.join(dir, "ssh");
  await writeFile(sshPath, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(sshPath, 0o755);
  return { PATH: dir };
}

const REMOTE_TARGET_CONTRACT: Record<RemoteTransport, RemoteTargetContract> = {
  ssh: {
    arrange: async (outcome) => {
      const probedCommands: string[] = [];

      vi.spyOn(ssh, "runSshCommand").mockImplementation(async (_spec, remoteCommand) => {
        probedCommands.push(remoteCommand);
        if (outcome === "installed") {
          return { stdout: "/usr/local/bin/claude\n", stderr: "" };
        }
        throw Object.assign(new Error("non-zero exit"), { code: 1, stdout: "", stderr: "" });
      });

      return {
        target: {
          kind: "remote",
          transport: "ssh",
          remoteCwd: "/home/agent/workspace",
          spec: {
            host: "worker.example.test",
            port: 22,
            username: "agent",
            remoteCwd: "/home/agent/workspace",
            remoteWorkspacePath: "/home/agent/workspace",
            privateKey: null,
            knownHosts: null,
            strictHostKeyChecking: false,
          },
        },
        probedCommands,
        env: await pathWithStubSsh(),
      };
    },
  },

  sandbox: {
    arrange: async (outcome) => {
      const probedCommands: string[] = [];

      return {
        target: {
          kind: "remote",
          transport: "sandbox",
          providerKey: "contract-provider",
          remoteCwd: "/workspace",
          runner: {
            execute: async (input): Promise<RunProcessResult> => {
              probedCommands.push([input.command, ...(input.args ?? [])].join(" "));
              return {
                exitCode: outcome === "installed" ? 0 : 1,
                signal: null,
                timedOut: false,
                stdout: outcome === "installed" ? "/usr/local/bin/claude\n" : "",
                stderr: "",
                pid: null,
                startedAt: new Date().toISOString(),
              };
            },
          },
        },
        probedCommands,
        env: {},
      };
    },
  },
};

describe.each(Object.keys(REMOTE_TARGET_CONTRACT) as RemoteTransport[])(
  "remote execution target contract: %s",
  (transport) => {
    const contract = REMOTE_TARGET_CONTRACT[transport];

    afterEach(async () => {
      vi.restoreAllMocks();
      while (cleanupDirs.length > 0) {
        const dir = cleanupDirs.pop();
        if (!dir) continue;
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    });

    it("can be handed the operator's CLI credentials", async () => {
      // Without this the agent starts on the target with no auth at all and the operator has
      // to log into every box by hand — which is exactly what SSH forced on them.
      const { target } = await contract.arrange("installed");

      expect(adapterExecutionTargetSupportsManagedConfig(target)).toBe(true);
    });

    it("asks the target itself whether the agent CLI is installed", async () => {
      const { target, probedCommands, env } = await contract.arrange("installed");

      await ensureAdapterExecutionTargetCommandResolvable("claude", target, "/tmp/local", env, {
        installCommand: null,
      });

      // A check that never leaves the Paperclip host cannot know anything about the target.
      expect(probedCommands.join("\n")).toMatch(/command -v .*claude/);
    });

    it("reports a CLI that is missing on the target as missing", async () => {
      const { target, env } = await contract.arrange("missing");

      await expect(
        ensureAdapterExecutionTargetCommandResolvable("claude", target, "/tmp/local", env, {
          installCommand: null,
        }),
      ).rejects.toThrow(/not installed or not on PATH/i);
    });
  },
);
