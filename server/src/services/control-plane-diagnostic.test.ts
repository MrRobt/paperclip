import { describe, expect, it } from "vitest";

import { diagnoseControlPlaneIssue, summarizeControlPlaneDiagnostics } from "./control-plane-diagnostic.js";

describe("control plane diagnostic", () => {
  it("非终态事项无运行且无证据时判定静默停滞", () => {
    const diagnosis = diagnoseControlPlaneIssue({
      issue: { id: "i-1", title: "补交付控制台", status: "in_progress", assigneeAgentId: "a-1" },
      now: new Date("2026-06-08T03:00:00.000Z"),
    });

    expect(diagnosis.executionStatus).toBe("none");
    expect(diagnosis.evidenceStatus).toBe("none");
    expect(diagnosis.liveness).toBe("stalled");
    expect(diagnosis.severity).toBe("critical");
    expect(diagnosis.nextAction).toContain("重新唤醒");
  });

  it("强阻塞优先判定为阻塞，但下一步允许旁路补证据", () => {
    const diagnosis = diagnoseControlPlaneIssue({
      issue: { id: "i-2", title: "真实触达审批", status: "blocked", assigneeAgentId: "a-2" },
      blockerPolicies: [{ id: "bp-1", issueId: "i-2", level: "hard", status: "active", reason: "等待人工审批" }],
    });

    expect(diagnosis.blockerStatus).toBe("hard");
    expect(diagnosis.liveness).toBe("blocked");
    expect(diagnosis.nextAction).toContain("强阻塞");
    expect(diagnosis.reasons.join("\n")).toContain("强阻塞");
  });

  it("证据齐全且有运行终态时进入健康可复审状态", () => {
    const diagnosis = diagnoseControlPlaneIssue({
      issue: { id: "i-3", title: "评论草稿重放", status: "in_review", assigneeAgentId: "a-3", executionRunId: "run-1" },
      run: { id: "run-1", status: "succeeded", finishedAt: "2026-06-08T03:00:00.000Z" },
      comments: [
        {
          id: "c-1",
          body: "改动摘要：新增草稿重放。\n分支：dev。\n提交号：abc123。\n验证命令：pnpm test:run。\n验证结果：通过。\n复审口径：前端可按接口重放。",
        },
      ],
    });

    expect(diagnosis.executionStatus).toBe("terminal");
    expect(diagnosis.evidenceStatus).toBe("ready_for_review");
    expect(diagnosis.liveness).toBe("healthy");
    expect(diagnosis.nextAction).toContain("可复审");
  });

  it("运行长时间无输出判定静默停滞", () => {
    const diagnosis = diagnoseControlPlaneIssue({
      issue: { id: "i-4", title: "长运行", status: "in_progress", assigneeAgentId: "a-4", executionRunId: "run-4" },
      run: { id: "run-4", status: "running", lastOutputAt: "2026-06-08T02:00:00.000Z" },
      now: new Date("2026-06-08T03:00:00.000Z"),
      staleAfterMs: 30 * 60_000,
    });

    expect(diagnosis.executionStatus).toBe("running");
    expect(diagnosis.liveness).toBe("stalled");
    expect(diagnosis.reasons).toContain("运行长时间无有效输出");
  });

  it("汇总诊断数量", () => {
    const first = diagnoseControlPlaneIssue({ issue: { id: "i-1", title: "空", status: "todo" } });
    const second = diagnoseControlPlaneIssue({ issue: { id: "i-2", title: "终态", status: "done" } });
    const summary = summarizeControlPlaneDiagnostics([first, second]);

    expect(summary.counts.total).toBe(2);
    expect(summary.counts.healthy).toBe(1);
    expect(summary.counts.critical).toBe(1);
    expect(summary.headline).toContain("控制面诊断 2 项");
  });
});
