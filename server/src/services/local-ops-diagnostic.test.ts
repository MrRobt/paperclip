import { describe, expect, it } from "vitest";

import {
  buildDiagnosticSummary,
  buildSuggestedActions,
  parseListeningPorts,
  summarizeIssueQueue,
  summarizeLiveRuns,
  summarizePorts,
} from "./local-ops-diagnostic.js";

describe("local ops diagnostic helpers", () => {
  it("解析监听端口并忽略无效行", () => {
    const records = parseListeningPorts(`
LISTEN 0      511        127.0.0.1:3101      0.0.0.0:*    users:(("node",pid=101,fd=23))
LISTEN 0      128          0.0.0.0:5173      0.0.0.0:*    users:(("vite",pid=202,fd=11))
LISTEN 0      128             [::]:48080        [::]:*    users:(("java",pid=303,fd=99))
invalid line
`);

    expect(records).toEqual([
      { port: 3101, raw: 'LISTEN 0      511        127.0.0.1:3101      0.0.0.0:*    users:(("node",pid=101,fd=23))' },
      { port: 5173, raw: 'LISTEN 0      128          0.0.0.0:5173      0.0.0.0:*    users:(("vite",pid=202,fd=11))' },
      { port: 48080, raw: 'LISTEN 0      128             [::]:48080        [::]:*    users:(("java",pid=303,fd=99))' },
    ]);
  });

  it("汇总队列压力、关键运行和端口异常，生成主控可读摘要", () => {
    const runSummary = summarizeLiveRuns([
      {
        id: "run-1",
        issueId: "issue-1",
        agentName: "自家运维阿稳",
        status: "running",
        adapterType: "codex_local",
        livenessState: "waiting",
        livenessReason: "process_lost after server restart",
        nextAction: "inspect session",
        outputSilence: { level: "critical", silenceAgeMs: 1_500_000 },
      },
      {
        id: "run-2",
        issueId: "issue-2",
        agentName: "值班前端",
        status: "queued",
        adapterType: "claude_local",
        livenessState: "queued",
        outputSilence: { level: "ok", silenceAgeMs: 0 },
      },
    ]);
    const portSummary = summarizePorts(
      [
        { port: 3101, name: "paperclip" },
        { port: 5173, name: "前端调试" },
      ],
      parseListeningPorts('LISTEN 0 128 127.0.0.1:5173 0.0.0.0:* users:(("vite",pid=202,fd=11))'),
    );
    const queueSummary = summarizeIssueQueue([
      { status: "todo", priority: "high", assigneeAgentId: "agent-1" },
      { status: "blocked", priority: "high", assigneeAgentId: "agent-2" },
      { status: "backlog", priority: "critical", assigneeAgentId: null },
      { status: "in_progress", priority: "medium", assigneeAgentId: "agent-3" },
    ]);

    expect(runSummary.counts).toMatchObject({ queued: 1, running: 1, critical: 1 });
    expect(queueSummary).toEqual({
      openAssigned: 3,
      blocked: 1,
      backlogHighPriority: 1,
      todo: 1,
      inProgress: 1,
    });

    const summary = buildDiagnosticSummary({
      health: { status: "ok", version: "2026.428.0" },
      runSummary,
      portSummary,
      queueSummary,
    });

    expect(summary.headline).toContain("1 个关键长运行沉默");
    expect(summary.highlights.join("\n")).toContain("3101/paperclip 未监听");
    expect(summary.highlights.join("\n")).toContain("高优积压 1");

    const actions = buildSuggestedActions({ runSummary, portSummary, queueSummary });
    expect(actions.join("\n")).toContain("3101 未监听");
    expect(actions.join("\n")).toContain("process_lost");
    expect(actions.join("\n")).toContain("高优 backlog");
  });
});
