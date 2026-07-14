import { describe, expect, it } from "vitest";
import { buildSshBaseOptionArgs } from "./ssh.js";

describe("buildSshBaseOptionArgs", () => {
  function optionValue(args: string[], key: string): string | null {
    for (let i = 0; i < args.length - 1; i += 1) {
      if (args[i] !== "-o") continue;
      const [name, ...rest] = args[i + 1].split("=");
      if (name === key) return rest.join("=");
    }
    return null;
  }

  it("silences the guaranteed known-hosts warning when host key checking is off", () => {
    // With UserKnownHostsFile=/dev/null ssh re-learns the host key on every
    // connection and prints "Warning: Permanently added ... to the list of known
    // hosts." to stderr every single time. That noise was being reported back to
    // operators as the adapter's failure detail, hiding the real error.
    const args = buildSshBaseOptionArgs({ strictHostKeyChecking: false });

    expect(optionValue(args, "StrictHostKeyChecking")).toBe("no");
    expect(optionValue(args, "UserKnownHostsFile")).toBe("/dev/null");
    expect(optionValue(args, "LogLevel")).toBe("ERROR");
  });

  it("leaves ssh logging at its default when host keys are verified", () => {
    const args = buildSshBaseOptionArgs({ strictHostKeyChecking: true });

    expect(optionValue(args, "StrictHostKeyChecking")).toBe("yes");
    expect(optionValue(args, "UserKnownHostsFile")).toBeNull();
    expect(optionValue(args, "LogLevel")).toBeNull();
  });

  it("always runs non-interactively with a connect timeout", () => {
    for (const strictHostKeyChecking of [true, false]) {
      const args = buildSshBaseOptionArgs({ strictHostKeyChecking });
      expect(optionValue(args, "BatchMode")).toBe("yes");
      expect(optionValue(args, "ConnectTimeout")).toBe("10");
    }
  });
});
