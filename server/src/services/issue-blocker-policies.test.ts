import { describe, expect, it } from "vitest";

import { decideBlockedOperation, strongestBlockerStatus } from "./issue-blocker-policies.js";

const hard = { id: "p-hard", issueId: "i-1", level: "hard" as const, status: "active", reason: "等待人工审批" };
const soft = { id: "p-soft", issueId: "i-1", level: "soft" as const, status: "active", reason: "等待复审但可补证据" };
const notice = { id: "p-notice", issueId: "i-1", level: "notice" as const, status: "active", reason: "风险提示" };

describe("issue blocker policies", () => {
  it("强阻塞禁止执行推进", () => {
    const decision = decideBlockedOperation({ policies: [hard], operation: "execute" });

    expect(decision.allowed).toBe(false);
    expect(decision.blockerStatus).toBe("hard");
    expect(decision.blockingPolicyIds).toEqual(["p-hard"]);
    expect(decision.message).toContain("禁止继续执行推进");
  });

  it("强阻塞不拦截补评论、补证据、补诊断和恢复动作", () => {
    for (const operation of ["comment", "attach_evidence", "diagnose", "recover"] as const) {
      const decision = decideBlockedOperation({ policies: [hard], operation });
      expect(decision.allowed).toBe(true);
      expect(decision.message).toContain("仍允许执行");
    }
  });

  it("弱阻塞允许执行但返回弱阻塞状态", () => {
    const decision = decideBlockedOperation({ policies: [soft], operation: "execute" });

    expect(decision.allowed).toBe(true);
    expect(decision.blockerStatus).toBe("soft");
    expect(decision.message).toContain("弱阻塞");
  });

  it("提示阻塞只展示风险，不阻断执行", () => {
    const decision = decideBlockedOperation({ policies: [notice], operation: "execute" });

    expect(decision.allowed).toBe(true);
    expect(decision.blockerStatus).toBe("notice");
    expect(decision.message).toContain("不阻断执行");
  });

  it("多个阻塞取最强等级，忽略非活动策略", () => {
    expect(strongestBlockerStatus([notice, soft, hard, { ...hard, id: "old", status: "resolved" }])).toBe("hard");
  });
});
