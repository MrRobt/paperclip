import { describe, expect, it } from "vitest";
import { buildTeamHealthRows, summarizeIssueEvidenceNoise, summarizeTeamHealth } from "./teamHealth";

describe("team health projection", () => {
  it("separates paperclip status, live runtime, useful evidence, noise and high-priority overload", () => {
    const rows = buildTeamHealthRows({
      agents: [
        { id: "agent-1", name: "老周", status: "active", adapterType: "hermes_local" },
        { id: "agent-2", name: "小鹿", status: "paused", adapterType: "hermes_local" },
      ],
      issues: [
        {
          id: "issue-1",
          identifier: "CMPAA-1",
          title: "真实交付",
          status: "in_progress",
          priority: "high",
          assigneeAgentId: "agent-1",
          updatedAt: "2026-06-05T10:00:00.000Z",
          workProducts: [{ id: "wp-1" }],
        },
        {
          id: "issue-2",
          identifier: "CMPAA-2",
          title: "恢复链打转",
          status: "blocked",
          priority: "high",
          originKind: "stranded_issue_recovery",
          assigneeAgentId: "agent-1",
          updatedAt: "2026-06-05T10:01:00.000Z",
        },
        {
          id: "issue-3",
          identifier: "CMPAA-3",
          title: "普通任务",
          status: "todo",
          priority: "medium",
          assigneeAgentId: "agent-2",
          updatedAt: "2026-06-05T10:02:00.000Z",
        },
        {
          id: "issue-4",
          identifier: "CMPAA-4",
          title: "已完成闭环",
          status: "done",
          priority: "high",
          assigneeAgentId: "agent-2",
          updatedAt: "2026-06-05T10:03:00.000Z",
        },
      ],
      liveRuns: [
        {
          id: "run-1",
          agentId: "agent-1",
          issueId: "issue-1",
          status: "running",
          livenessState: "useful",
          livenessReason: "Run produced concrete action evidence",
          outputSilence: { level: "ok" },
        },
        {
          id: "run-2",
          agentId: "agent-1",
          issueId: "issue-2",
          status: "running",
          livenessState: "waiting",
          livenessReason: "process_lost recovery loop",
          outputSilence: { level: "critical", silenceAgeMs: 720000 },
        },
      ],
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      agentId: "agent-1",
      paperclipStatus: "active",
      runtimeState: "critical",
      highPriorityLoad: 2,
      violatesOneHighPriority: true,
      effectiveEvidenceCount: 1,
      noiseCount: 2,
    });
    expect(rows[0]?.recentEvidence.map((item) => item.identifier)).toEqual(["CMPAA-1"]);
    expect(rows[0]?.noiseHints.map((item) => item.identifier)).toEqual(["CMPAA-2", "CMPAA-2"]);
    expect(rows[1]).toMatchObject({
      agentId: "agent-2",
      runtimeState: "idle",
      highPriorityLoad: 0,
      violatesOneHighPriority: false,
      effectiveEvidenceCount: 1,
    });
    expect(rows[1]?.recentEvidence.map((item) => item.identifier)).toEqual(["CMPAA-4"]);
  });

  it("summarizes issue evidence density and recovery noise for page level cards", () => {
    const summary = summarizeTeamHealth([
      {
        agentId: "agent-1",
        agentName: "老周",
        adapterType: "hermes_local",
        paperclipStatus: "active",
        runtimeState: "critical",
        liveRunCount: 2,
        highPriorityLoad: 2,
        openIssueCount: 3,
        effectiveEvidenceCount: 1,
        noiseCount: 2,
        violatesOneHighPriority: true,
        recentEvidence: [],
        noiseHints: [],
      },
    ]);

    expect(summary).toEqual({
      totalAgents: 1,
      activeRuntimeAgents: 1,
      criticalAgents: 1,
      oneHighPriorityViolations: 1,
      effectiveEvidenceCount: 1,
      noiseCount: 2,
    });
  });

  it("summarizes issue detail into closure, runtime and noise buckets", () => {
    const summary = summarizeIssueEvidenceNoise({
      issue: {
        id: "issue-2",
        identifier: "CMPAA-2",
        title: "Recover stalled issue CMPAA-1",
        status: "blocked",
        priority: "high",
        originKind: "stranded_issue_recovery",
      },
      workProductCount: 0,
      liveRuns: [
        {
          id: "run-2",
          agentId: "agent-1",
          issueId: "issue-2",
          status: "running",
          livenessState: "waiting",
          livenessReason: "process_lost recovery loop",
          outputSilence: { level: "critical", silenceAgeMs: 720000 },
        },
      ],
    });

    expect(summary).toMatchObject({
      closureState: "open",
      usefulEvidenceCount: 0,
      runtimeSignalCount: 1,
      noiseCount: 2,
    });
    expect(summary.hints.join("\n")).toContain("恢复链/看门狗来源");
    expect(summary.hints.join("\n")).toContain("运行输出长时间沉默");
  });
});
