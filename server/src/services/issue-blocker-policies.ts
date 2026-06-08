export type IssueBlockerPolicyLevel = "hard" | "soft" | "notice";
export type IssueBlockerPolicyStatus = "active" | "resolved" | "downgraded" | "cancelled";
export type BlockedOperation = "execute" | "comment" | "attach_evidence" | "diagnose" | "recover";

export interface IssueBlockerPolicyLike {
  id: string;
  issueId: string;
  blockerIssueId?: string | null;
  level: IssueBlockerPolicyLevel;
  status: IssueBlockerPolicyStatus | string;
  reason?: string | null;
}

export interface BlockerPolicyDecision {
  allowed: boolean;
  blockerStatus: "none" | "hard" | "soft" | "notice";
  blockingPolicyIds: string[];
  reasons: string[];
  message: string;
}

const NON_EXECUTION_OPERATIONS = new Set<BlockedOperation>([
  "comment",
  "attach_evidence",
  "diagnose",
  "recover",
]);

export function activeBlockerPolicies(
  policies: readonly IssueBlockerPolicyLike[],
): IssueBlockerPolicyLike[] {
  return policies.filter((policy) => policy.status === "active");
}

export function strongestBlockerStatus(
  policies: readonly IssueBlockerPolicyLike[],
): BlockerPolicyDecision["blockerStatus"] {
  const active = activeBlockerPolicies(policies);
  if (active.some((policy) => policy.level === "hard")) return "hard";
  if (active.some((policy) => policy.level === "soft")) return "soft";
  if (active.some((policy) => policy.level === "notice")) return "notice";
  return "none";
}

export function decideBlockedOperation(input: {
  policies: readonly IssueBlockerPolicyLike[];
  operation: BlockedOperation;
}): BlockerPolicyDecision {
  const active = activeBlockerPolicies(input.policies);
  const blockerStatus = strongestBlockerStatus(active);
  const reasons = active.map((policy) => policy.reason?.trim()).filter((reason): reason is string => Boolean(reason));

  if (blockerStatus === "none") {
    return {
      allowed: true,
      blockerStatus,
      blockingPolicyIds: [],
      reasons,
      message: "无活动阻塞，允许执行。",
    };
  }

  if (input.operation !== "execute" || NON_EXECUTION_OPERATIONS.has(input.operation)) {
    return {
      allowed: true,
      blockerStatus,
      blockingPolicyIds: active.map((policy) => policy.id),
      reasons,
      message: "存在阻塞，但补评论、补证据、补诊断、补恢复动作仍允许执行。",
    };
  }

  if (blockerStatus === "hard") {
    return {
      allowed: false,
      blockerStatus,
      blockingPolicyIds: active.filter((policy) => policy.level === "hard").map((policy) => policy.id),
      reasons,
      message: "存在强阻塞，禁止继续执行推进；允许补评论、补证据、补诊断和创建恢复动作。",
    };
  }

  return {
    allowed: true,
    blockerStatus,
    blockingPolicyIds: active.map((policy) => policy.id),
    reasons,
    message: blockerStatus === "soft" ? "存在弱阻塞，允许旁路补证据和继续低风险推进。" : "存在提示阻塞，仅展示风险，不阻断执行。",
  };
}

export function buildDowngradedBlockerPolicy(input: {
  policy: IssueBlockerPolicyLike;
  targetLevel: IssueBlockerPolicyLevel;
  downgradeReason: string;
}): IssueBlockerPolicyLike & { downgradeReason: string; status: "active" } {
  return {
    ...input.policy,
    level: input.targetLevel,
    status: "active",
    downgradeReason: input.downgradeReason,
  };
}
