export type TeamHealthAgent = {
  id: string;
  name: string;
  status: string;
  adapterType?: string | null;
};

export type TeamHealthIssue = {
  id: string;
  identifier?: string | null;
  title: string;
  status: string;
  priority?: string | null;
  assigneeAgentId?: string | null;
  originKind?: string | null;
  updatedAt?: string | Date | null;
  workProducts?: unknown[] | null;
};

export type TeamHealthRun = {
  id: string;
  agentId: string;
  issueId?: string | null;
  status: string;
  livenessState?: string | null;
  livenessReason?: string | null;
  outputSilence?: { level?: string | null; silenceAgeMs?: number | null } | null;
};

export type TeamHealthEvidence = {
  issueId: string;
  identifier: string;
  title: string;
  status: string;
  priority: string | null;
  updatedAt: string | Date | null;
  kind: "work_product" | "useful_run" | "status_progress";
};

export type TeamHealthNoiseHint = {
  issueId?: string | null;
  runId?: string | null;
  identifier?: string | null;
  title: string;
  reason: string;
};

export type TeamHealthRow = {
  agentId: string;
  agentName: string;
  adapterType: string | null;
  paperclipStatus: string;
  runtimeState: "idle" | "running" | "warning" | "critical";
  liveRunCount: number;
  highPriorityLoad: number;
  openIssueCount: number;
  effectiveEvidenceCount: number;
  noiseCount: number;
  violatesOneHighPriority: boolean;
  recentEvidence: TeamHealthEvidence[];
  noiseHints: TeamHealthNoiseHint[];
};

export type TeamHealthSummary = {
  totalAgents: number;
  activeRuntimeAgents: number;
  criticalAgents: number;
  oneHighPriorityViolations: number;
  effectiveEvidenceCount: number;
  noiseCount: number;
};

export type IssueEvidenceNoiseSummary = {
  closureState: "closed" | "open";
  usefulEvidenceCount: number;
  runtimeSignalCount: number;
  noiseCount: number;
  hints: string[];
};

const CLOSED_STATUSES = new Set(["done", "cancelled"]);
const ACTIVE_RUN_STATUSES = new Set(["running", "queued"]);
const HIGH_PRIORITY = new Set(["high", "urgent", "critical"]);

function issueIdentifier(issue: TeamHealthIssue): string {
  return issue.identifier ?? issue.id.slice(0, 8);
}

function isOpenIssue(issue: TeamHealthIssue): boolean {
  return !CLOSED_STATUSES.has(issue.status);
}

function isHighPriorityIssue(issue: TeamHealthIssue): boolean {
  return isOpenIssue(issue) && HIGH_PRIORITY.has(String(issue.priority ?? "").toLowerCase());
}

function isRecoveryNoiseIssue(issue: TeamHealthIssue): boolean {
  const text = `${issue.originKind ?? ""} ${issue.title ?? ""}`.toLowerCase();
  return text.includes("recovery")
    || text.includes("recover stalled")
    || text.includes("stranded")
    || text.includes("watchdog")
    || text.includes("恢复")
    || text.includes("打转");
}

function isNoisyRun(run: TeamHealthRun): boolean {
  const reason = String(run.livenessReason ?? "").toLowerCase();
  const silenceLevel = String(run.outputSilence?.level ?? "").toLowerCase();
  return run.livenessState === "waiting"
    || silenceLevel === "critical"
    || reason.includes("recovery")
    || reason.includes("process_lost")
    || reason.includes("compact")
    || reason.includes("silence");
}

function runEvidenceKind(run: TeamHealthRun): TeamHealthEvidence["kind"] | null {
  if (run.livenessState === "useful") return "useful_run";
  return null;
}

function compareEvidence(a: TeamHealthEvidence, b: TeamHealthEvidence): number {
  const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
  const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
  return bTime - aTime;
}

export function buildTeamHealthRows(input: {
  agents: TeamHealthAgent[];
  issues: TeamHealthIssue[];
  liveRuns: TeamHealthRun[];
}): TeamHealthRow[] {
  const issuesByAgent = new Map<string, TeamHealthIssue[]>();
  for (const issue of input.issues) {
    if (!issue.assigneeAgentId) continue;
    const bucket = issuesByAgent.get(issue.assigneeAgentId) ?? [];
    bucket.push(issue);
    issuesByAgent.set(issue.assigneeAgentId, bucket);
  }

  const runsByAgent = new Map<string, TeamHealthRun[]>();
  for (const run of input.liveRuns) {
    if (!ACTIVE_RUN_STATUSES.has(run.status)) continue;
    const bucket = runsByAgent.get(run.agentId) ?? [];
    bucket.push(run);
    runsByAgent.set(run.agentId, bucket);
  }

  const issueById = new Map(input.issues.map((issue) => [issue.id, issue]));

  return [...input.agents]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((agent) => {
      const agentIssues = issuesByAgent.get(agent.id) ?? [];
      const openIssues = agentIssues.filter(isOpenIssue);
      const highPriorityLoad = agentIssues.filter(isHighPriorityIssue).length;
      const activeRuns = runsByAgent.get(agent.id) ?? [];
      const hasCritical = activeRuns.some((run) => String(run.outputSilence?.level ?? "") === "critical");
      const hasWarning = activeRuns.some((run) => run.livenessState === "waiting" || run.livenessState === "stale");
      const runtimeState: TeamHealthRow["runtimeState"] = hasCritical
        ? "critical"
        : hasWarning
          ? "warning"
          : activeRuns.length > 0
            ? "running"
            : "idle";

      const recentEvidence: TeamHealthEvidence[] = [];
      const evidenceIssueIds = new Set<string>();
      const noiseHints: TeamHealthNoiseHint[] = [];

      for (const issue of agentIssues) {
        if ((issue.workProducts?.length ?? 0) > 0) {
          recentEvidence.push({
            issueId: issue.id,
            identifier: issueIdentifier(issue),
            title: issue.title,
            status: issue.status,
            priority: issue.priority ?? null,
            updatedAt: issue.updatedAt ?? null,
            kind: "work_product",
          });
          evidenceIssueIds.add(issue.id);
        }
        if (issue.status === "done" || issue.status === "in_review") {
          recentEvidence.push({
            issueId: issue.id,
            identifier: issueIdentifier(issue),
            title: issue.title,
            status: issue.status,
            priority: issue.priority ?? null,
            updatedAt: issue.updatedAt ?? null,
            kind: "status_progress",
          });
          evidenceIssueIds.add(issue.id);
        }
        if (isRecoveryNoiseIssue(issue)) {
          noiseHints.push({
            issueId: issue.id,
            identifier: issueIdentifier(issue),
            title: issue.title,
            reason: "恢复链或看门狗类任务，需和真实交付证据分开看",
          });
        }
      }

      for (const run of activeRuns) {
        const linkedIssue = run.issueId ? issueById.get(run.issueId) : null;
        const evidenceKind = runEvidenceKind(run);
        if (evidenceKind && linkedIssue) {
          recentEvidence.push({
            issueId: linkedIssue.id,
            identifier: issueIdentifier(linkedIssue),
            title: linkedIssue.title,
            status: linkedIssue.status,
            priority: linkedIssue.priority ?? null,
            updatedAt: linkedIssue.updatedAt ?? null,
            kind: evidenceKind,
          });
          evidenceIssueIds.add(linkedIssue.id);
        }
        if (isNoisyRun(run)) {
          noiseHints.push({
            issueId: linkedIssue?.id ?? run.issueId ?? null,
            runId: run.id,
            identifier: linkedIssue ? issueIdentifier(linkedIssue) : null,
            title: linkedIssue?.title ?? `Run ${run.id.slice(0, 8)}`,
            reason: run.livenessReason ?? "运行态等待或沉默，可能是恢复链噪声",
          });
        }
      }

      const dedupedEvidence = [...new Map(recentEvidence.map((item) => [item.issueId, item])).values()]
        .sort(compareEvidence)
        .slice(0, 4);

      return {
        agentId: agent.id,
        agentName: agent.name,
        adapterType: agent.adapterType ?? null,
        paperclipStatus: agent.status,
        runtimeState,
        liveRunCount: activeRuns.length,
        highPriorityLoad,
        openIssueCount: openIssues.length,
        effectiveEvidenceCount: evidenceIssueIds.size,
        noiseCount: noiseHints.length,
        violatesOneHighPriority: highPriorityLoad > 1,
        recentEvidence: dedupedEvidence,
        noiseHints: noiseHints.slice(0, 4),
      };
    });
}

export function summarizeTeamHealth(rows: TeamHealthRow[]): TeamHealthSummary {
  return rows.reduce<TeamHealthSummary>(
    (summary, row) => ({
      totalAgents: summary.totalAgents + 1,
      activeRuntimeAgents: summary.activeRuntimeAgents + (row.runtimeState !== "idle" ? 1 : 0),
      criticalAgents: summary.criticalAgents + (row.runtimeState === "critical" ? 1 : 0),
      oneHighPriorityViolations: summary.oneHighPriorityViolations + (row.violatesOneHighPriority ? 1 : 0),
      effectiveEvidenceCount: summary.effectiveEvidenceCount + row.effectiveEvidenceCount,
      noiseCount: summary.noiseCount + row.noiseCount,
    }),
    {
      totalAgents: 0,
      activeRuntimeAgents: 0,
      criticalAgents: 0,
      oneHighPriorityViolations: 0,
      effectiveEvidenceCount: 0,
      noiseCount: 0,
    },
  );
}

export function summarizeIssueEvidenceNoise(input: {
  issue: TeamHealthIssue;
  liveRuns: TeamHealthRun[];
  workProductCount?: number;
}): IssueEvidenceNoiseSummary {
  const usefulEvidenceCount =
    (input.workProductCount ?? input.issue.workProducts?.length ?? 0)
    + (input.issue.status === "done" || input.issue.status === "in_review" ? 1 : 0)
    + input.liveRuns.filter((run) => runEvidenceKind(run)).length;
  const runtimeSignalCount = input.liveRuns.filter((run) => ACTIVE_RUN_STATUSES.has(run.status)).length;
  const noiseReasons = new Set<string>();

  if (isRecoveryNoiseIssue(input.issue)) {
    noiseReasons.add("恢复链/看门狗来源：需要确认是否只是恢复打转，而不是业务交付闭环");
  }
  for (const run of input.liveRuns) {
    if (!isNoisyRun(run)) continue;
    if (run.outputSilence?.level === "critical") {
      noiseReasons.add("运行输出长时间沉默：先看真实产出，不把心跳存活当完成");
    } else if (run.livenessState === "waiting") {
      noiseReasons.add("运行态处于等待：可能是卡确认或恢复链等待");
    } else {
      noiseReasons.add(run.livenessReason ?? "运行信号更像噪声，需要和有效证据分层");
    }
  }

  const hints: string[] = [];
  if (usefulEvidenceCount > 0) hints.push("真实闭环：存在工作产物、评审/完成状态或有用运行信号");
  if (runtimeSignalCount > 0) hints.push("运行状态：当前或近期有执行信号，但需结合产物判断");
  hints.push(...noiseReasons);
  if (usefulEvidenceCount === 0 && runtimeSignalCount === 0 && noiseReasons.size === 0) {
    hints.push("暂无可见交付证据或活跃运行信号");
  }

  return {
    closureState: input.issue.status === "done" || input.issue.status === "cancelled" ? "closed" : "open",
    usefulEvidenceCount,
    runtimeSignalCount,
    noiseCount: noiseReasons.size,
    hints,
  };
}
