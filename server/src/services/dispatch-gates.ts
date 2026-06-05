export const HIGH_PRIORITY_ISSUE_PRIORITIES = ["high", "critical"] as const;
export const ACTIVE_WORK_ISSUE_STATUSES = ["todo", "in_progress"] as const;

export type HighPriorityIssuePriority = (typeof HIGH_PRIORITY_ISSUE_PRIORITIES)[number];
export type ActiveWorkIssueStatus = (typeof ACTIVE_WORK_ISSUE_STATUSES)[number];

export type DispatchGateIssue = {
  id: string;
  identifier?: string | null;
  title?: string | null;
  status: string;
  priority: string;
  assigneeAgentId?: string | null;
  originKind?: string | null;
  originId?: string | null;
};

export type CompletionEvidenceField =
  | "changeSummary"
  | "branch"
  | "commit"
  | "verificationCommand"
  | "verificationResult"
  | "downstreamReview";

export type CompletionEvidenceScore = {
  score: number;
  status: "insufficient" | "needs_evidence" | "ready_for_review";
  fields: Record<CompletionEvidenceField, boolean>;
  missingFields: CompletionEvidenceField[];
};

export type ProductivityReviewCooldownDecision = {
  allowed: boolean;
  reason: "allowed" | "refresh_cooldown" | "refresh_comment_limit";
  nextAllowedAt: Date | null;
};

const FIELD_WEIGHTS: Record<CompletionEvidenceField, number> = {
  changeSummary: 20,
  branch: 10,
  commit: 15,
  verificationCommand: 20,
  verificationResult: 20,
  downstreamReview: 15,
};

const FIELD_PATTERNS: Record<CompletionEvidenceField, RegExp[]> = {
  changeSummary: [/改动摘要\s*[:：]/i, /完成内容\s*[:：]/i, /变更摘要\s*[:：]/i],
  branch: [/分支\s*[:：]/i, /当前分支\s*[:：]/i],
  commit: [/提交号\s*[:：]/i, /提交\s*(?:号|哈希|散列)\s*[:：]/i, /commit\s*[:：]/i, /无代码提交/i],
  verificationCommand: [/验证命令\s*[:：]/i, /测试命令\s*[:：]/i, /复验命令\s*[:：]/i],
  verificationResult: [/验证结果\s*[:：]/i, /测试结果\s*[:：]/i, /结果\s*[:：].*(?:通过|失败|成功|已跑)/i],
  downstreamReview: [/下游复验口径\s*[:：]/i, /复验口径\s*[:：]/i, /复审口径\s*[:：]/i],
};

export function isHighPriorityIssue(issue: Pick<DispatchGateIssue, "priority">) {
  return (HIGH_PRIORITY_ISSUE_PRIORITIES as readonly string[]).includes(issue.priority);
}

export function isActiveWorkIssue(issue: Pick<DispatchGateIssue, "status">) {
  return (ACTIVE_WORK_ISSUE_STATUSES as readonly string[]).includes(issue.status);
}

export function isRecoveryIssue(issue: Pick<DispatchGateIssue, "originKind" | "originId">) {
  return Boolean(
    issue.originId &&
      typeof issue.originKind === "string" &&
      (issue.originKind.includes("recovery") || issue.originKind.includes("productivity_review")),
  );
}

export function findHighPriorityAssignmentConflicts(input: {
  candidate: DispatchGateIssue;
  assignedIssues: readonly DispatchGateIssue[];
}) {
  const { candidate, assignedIssues } = input;
  if (!candidate.assigneeAgentId || !isHighPriorityIssue(candidate) || !isActiveWorkIssue(candidate)) return [];
  if (isRecoveryIssue(candidate)) return [];

  return assignedIssues.filter((issue) =>
    issue.id !== candidate.id &&
    issue.assigneeAgentId === candidate.assigneeAgentId &&
    isHighPriorityIssue(issue) &&
    isActiveWorkIssue(issue) &&
    !isRecoveryIssue(issue),
  );
}

export function summarizeHighPriorityGate(input: {
  candidate: DispatchGateIssue;
  assignedIssues: readonly DispatchGateIssue[];
}) {
  const conflicts = findHighPriorityAssignmentConflicts(input);
  return {
    allowed: conflicts.length === 0,
    reason: conflicts.length === 0 ? null : "agent_already_has_high_priority_issue",
    conflictIssueIds: conflicts.map((issue) => issue.id),
    conflictIdentifiers: conflicts.map((issue) => issue.identifier ?? issue.id),
  };
}

export function scoreCompletionEvidence(body: string): CompletionEvidenceScore {
  const fields = Object.fromEntries(
    (Object.keys(FIELD_WEIGHTS) as CompletionEvidenceField[]).map((field) => [
      field,
      FIELD_PATTERNS[field].some((pattern) => pattern.test(body)),
    ]),
  ) as Record<CompletionEvidenceField, boolean>;
  const score = (Object.keys(FIELD_WEIGHTS) as CompletionEvidenceField[]).reduce(
    (total, field) => total + (fields[field] ? FIELD_WEIGHTS[field] : 0),
    0,
  );
  const missingFields = (Object.keys(fields) as CompletionEvidenceField[]).filter((field) => !fields[field]);
  return {
    score,
    status: score >= 80 ? "ready_for_review" : score >= 60 ? "needs_evidence" : "insufficient",
    fields,
    missingFields,
  };
}

export function summarizeLatestCompletionEvidence(
  comments: readonly { id: string; body: string; createdAt?: Date | string | null }[],
) {
  let best: ({ commentId: string; createdAt?: Date | string | null } & CompletionEvidenceScore) | null = null;
  for (const comment of comments) {
    const scored = scoreCompletionEvidence(comment.body);
    if (!best || scored.score > best.score) {
      best = { commentId: comment.id, createdAt: comment.createdAt, ...scored };
    }
  }
  return best ?? {
    commentId: null,
    createdAt: null,
    ...scoreCompletionEvidence(""),
  };
}

export function normalizeRecoveryGroupKey(input: {
  companyId: string;
  sourceIssueId: string;
  recoveryKind: string;
  fingerprint?: string | null;
  cause?: string | null;
}) {
  const cause = (input.cause ?? "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 160);
  const recoveryKind = input.recoveryKind.trim();
  const isSourceScopedRecovery = recoveryKind === "stranded_issue_recovery";
  const fingerprint = isSourceScopedRecovery ? "source" : input.fingerprint?.trim() || `cause:${cause}`;
  return `${input.companyId}:${input.sourceIssueId}:${recoveryKind}:${fingerprint}`;
}

export function shouldRefreshProductivityReview(input: {
  now: Date;
  lastRefreshAt?: Date | string | null;
  refreshIntervalMs: number;
  refreshCommentCount: number;
  maxRefreshComments: number;
}): ProductivityReviewCooldownDecision {
  if (input.refreshCommentCount >= input.maxRefreshComments) {
    return { allowed: false, reason: "refresh_comment_limit", nextAllowedAt: null };
  }
  const lastRefreshAt = input.lastRefreshAt ? new Date(input.lastRefreshAt) : null;
  if (!lastRefreshAt || Number.isNaN(lastRefreshAt.getTime())) {
    return { allowed: true, reason: "allowed", nextAllowedAt: null };
  }
  const nextAllowedAt = new Date(lastRefreshAt.getTime() + input.refreshIntervalMs);
  if (input.now.getTime() < nextAllowedAt.getTime()) {
    return { allowed: false, reason: "refresh_cooldown", nextAllowedAt };
  }
  return { allowed: true, reason: "allowed", nextAllowedAt: null };
}
