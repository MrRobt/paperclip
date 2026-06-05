import { describe, expect, it } from "vitest";

import {
  findHighPriorityAssignmentConflicts,
  normalizeRecoveryGroupKey,
  scoreCompletionEvidence,
  summarizeLatestCompletionEvidence,
} from "./dispatch-gates.js";

describe("dispatch gates", () => {
  it("按源任务合并同类自动恢复单，忽略不同运行指纹", () => {
    const first = normalizeRecoveryGroupKey({
      companyId: "company-1",
      sourceIssueId: "issue-1",
      recoveryKind: "stranded_issue_recovery",
      fingerprint: "run-a",
      cause: "process_lost",
    });
    const second = normalizeRecoveryGroupKey({
      companyId: "company-1",
      sourceIssueId: "issue-1",
      recoveryKind: "stranded_issue_recovery",
      fingerprint: "run-b",
      cause: "timeout",
    });

    expect(second).toBe(first);
  });

  it("普通恢复分组保留指纹以区分不同根因", () => {
    const first = normalizeRecoveryGroupKey({
      companyId: "company-1",
      sourceIssueId: "issue-1",
      recoveryKind: "missing_disposition",
      fingerprint: "comment-a",
    });
    const second = normalizeRecoveryGroupKey({
      companyId: "company-1",
      sourceIssueId: "issue-1",
      recoveryKind: "missing_disposition",
      fingerprint: "comment-b",
    });

    expect(second).not.toBe(first);
  });

  it("排除恢复单后检测同一成员多个高优活跃主任务", () => {
    const conflicts = findHighPriorityAssignmentConflicts({
      candidate: {
        id: "issue-2",
        identifier: "CMPAA-2",
        assigneeAgentId: "agent-1",
        status: "in_progress",
        priority: "critical",
      },
      assignedIssues: [
        {
          id: "issue-1",
          identifier: "CMPAA-1",
          assigneeAgentId: "agent-1",
          status: "todo",
          priority: "high",
        },
        {
          id: "recovery-1",
          identifier: "CMPAA-9",
          assigneeAgentId: "agent-1",
          status: "in_progress",
          priority: "critical",
          originKind: "stranded_issue_recovery",
          originId: "issue-8",
        },
      ],
    });

    expect(conflicts.map((issue) => issue.identifier)).toEqual(["CMPAA-1"]);
  });

  it("识别完成评论六件套并返回可复审状态", () => {
    const score = scoreCompletionEvidence(`改动摘要：完成恢复处置
分支：dev
提交号：无代码提交
验证命令：pnpm test
验证结果：通过
下游复验口径：按源任务复验`);

    expect(score.status).toBe("ready_for_review");
    expect(score.missingFields).toEqual([]);
  });

  it("汇总评论时选择证据最完整的一条", () => {
    const best = summarizeLatestCompletionEvidence([
      { id: "comment-1", body: "改动摘要：只有摘要" },
      {
        id: "comment-2",
        body: "改动摘要：完成\n分支：dev\n提交号：abc\n验证命令：pnpm test\n验证结果：通过\n下游复验口径：复验",
      },
    ]);

    expect(best.commentId).toBe("comment-2");
    expect(best.status).toBe("ready_for_review");
  });
});
