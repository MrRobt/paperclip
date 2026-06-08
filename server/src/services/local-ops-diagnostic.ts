export interface DiagnosticOutputSilence {
  level?: string | null;
  silenceAgeMs?: number | null;
  suspicionThresholdMs?: number | null;
  criticalThresholdMs?: number | null;
}

export interface DiagnosticLiveRun {
  id: string;
  issueId?: string | null;
  agentId?: string | null;
  agentName?: string | null;
  status?: string | null;
  adapterType?: string | null;
  livenessState?: string | null;
  livenessReason?: string | null;
  nextAction?: string | null;
  outputSilence?: DiagnosticOutputSilence | null;
}

export interface DiagnosticRunAlert {
  runId: string;
  issueId: string | null;
  agentName: string | null;
  status: string | null;
  adapterType: string | null;
  level: string;
  silenceMinutes: number | null;
  livenessState: string | null;
  livenessReason: string | null;
  nextAction: string | null;
}

export interface PortInspectionTarget {
  port: number;
  name: string;
}

export interface ListeningPortRecord {
  port: number;
  raw: string;
}

export interface DiagnosticIssueQueueItem {
  status?: string | null;
  priority?: string | null;
  assigneeAgentId?: string | null;
}

export interface DiagnosticIssueQueueSummary {
  openAssigned: number;
  blocked: number;
  backlogHighPriority: number;
  todo: number;
  inProgress: number;
}

export interface DiagnosticSummary {
  headline: string;
  highlights: string[];
}

export function msToMinutes(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.round((value / 60_000) * 10) / 10;
}

export function parseListeningPorts(raw: string): ListeningPortRecord[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/(?:\[::\]|\*|(?:\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]+):(\d+)\b/);
      if (!match) return [];
      const port = Number.parseInt(match[1] ?? "", 10);
      if (!Number.isFinite(port)) return [];
      return [{ port, raw: line }];
    });
}

function severityRank(level: string | null | undefined) {
  switch (level) {
    case "critical":
      return 3;
    case "suspicious":
      return 2;
    case "snoozed":
      return 1;
    default:
      return 0;
  }
}

export function summarizeLiveRuns(runs: DiagnosticLiveRun[]) {
  const counts = {
    total: runs.length,
    queued: 0,
    running: 0,
    suspicious: 0,
    critical: 0,
    snoozed: 0,
  };

  const alerts: DiagnosticRunAlert[] = [];
  for (const run of runs) {
    if (run.status === "queued") counts.queued += 1;
    if (run.status === "running") counts.running += 1;

    const level = run.outputSilence?.level ?? null;
    if (level === "suspicious") counts.suspicious += 1;
    if (level === "critical") counts.critical += 1;
    if (level === "snoozed") counts.snoozed += 1;

    if (level === "suspicious" || level === "critical") {
      alerts.push({
        runId: run.id,
        issueId: run.issueId ?? null,
        agentName: run.agentName ?? null,
        status: run.status ?? null,
        adapterType: run.adapterType ?? null,
        level,
        silenceMinutes: msToMinutes(run.outputSilence?.silenceAgeMs),
        livenessState: run.livenessState ?? null,
        livenessReason: run.livenessReason ?? null,
        nextAction: run.nextAction ?? null,
      });
    }
  }

  alerts.sort((left, right) => {
    const byLevel = severityRank(right.level) - severityRank(left.level);
    if (byLevel !== 0) return byLevel;
    return (right.silenceMinutes ?? 0) - (left.silenceMinutes ?? 0);
  });

  return { counts, alerts };
}

export function summarizePorts(targets: PortInspectionTarget[], listening: ListeningPortRecord[]) {
  return targets.map((target) => {
    const matches = listening.filter((item) => item.port === target.port).map((item) => item.raw);
    return {
      ...target,
      listening: matches.length > 0,
      listeners: matches,
    };
  });
}

export function summarizeIssueQueue(items: DiagnosticIssueQueueItem[]): DiagnosticIssueQueueSummary {
  return items.reduce<DiagnosticIssueQueueSummary>(
    (summary, item) => {
      const status = item.status ?? null;
      const priority = item.priority ?? null;
      const hasAssignee = Boolean(item.assigneeAgentId);
      const isOpen = status !== "done" && status !== "cancelled";

      if (isOpen && hasAssignee) summary.openAssigned += 1;
      if (status === "blocked") summary.blocked += 1;
      if (status === "backlog" && (priority === "critical" || priority === "high")) {
        summary.backlogHighPriority += 1;
      }
      if (status === "todo") summary.todo += 1;
      if (status === "in_progress") summary.inProgress += 1;
      return summary;
    },
    {
      openAssigned: 0,
      blocked: 0,
      backlogHighPriority: 0,
      todo: 0,
      inProgress: 0,
    },
  );
}

export function buildDiagnosticSummary(input: {
  health?: { status?: string | null; version?: string | null } | null;
  runSummary: ReturnType<typeof summarizeLiveRuns>;
  portSummary: ReturnType<typeof summarizePorts>;
  queueSummary: DiagnosticIssueQueueSummary;
}): DiagnosticSummary {
  const headlineParts: string[] = [];
  if (input.runSummary.counts.critical > 0) {
    headlineParts.push(`${input.runSummary.counts.critical} 个关键长运行沉默`);
  }
  if (input.runSummary.counts.suspicious > 0) {
    headlineParts.push(`${input.runSummary.counts.suspicious} 个可疑长运行沉默`);
  }
  if (headlineParts.length === 0) {
    headlineParts.push("运行态整体稳定");
  }

  const highlights: string[] = [];
  if (input.health?.status) {
    const versionText = input.health.version ? `（版本 ${input.health.version}）` : "";
    highlights.push(`/api/health=${input.health.status}${versionText}`);
  }

  for (const item of input.portSummary) {
    if (!item.listening) {
      highlights.push(`${item.port}/${item.name} 未监听`);
    }
  }

  if (input.queueSummary.backlogHighPriority > 0) {
    highlights.push(`高优积压 ${input.queueSummary.backlogHighPriority}`);
  }
  if (input.queueSummary.blocked > 0) {
    highlights.push(`阻塞工单 ${input.queueSummary.blocked}`);
  }
  if (input.runSummary.counts.queued > 0) {
    highlights.push(`排队运行 ${input.runSummary.counts.queued}`);
  }
  if (input.runSummary.alerts.length > 0) {
    const topAlert = input.runSummary.alerts[0];
    const owner = topAlert.agentName ?? topAlert.runId;
    const silence = topAlert.silenceMinutes == null ? "" : `，静默 ${topAlert.silenceMinutes} 分钟`;
    highlights.push(`最需处理运行：${owner}${silence}`);
  }

  if (highlights.length === 0) {
    highlights.push("当前未发现异常高危信号");
  }

  return {
    headline: headlineParts.join("，"),
    highlights,
  };
}

export function buildSuggestedActions(input: {
  runSummary: ReturnType<typeof summarizeLiveRuns>;
  portSummary: ReturnType<typeof summarizePorts>;
  queueSummary?: DiagnosticIssueQueueSummary;
}) {
  const actions: string[] = [];
  if (input.portSummary.some((item) => item.port === 3101 && !item.listening)) {
    actions.push("3101 未监听：先重启纸夹服务，再复查 /api/health 与端口监听。");
  }
  if (input.runSummary.counts.critical > 0) {
    actions.push("存在长时间无输出的关键运行：优先查看对应 run 日志，必要时人工取消并重新唤醒。");
  }
  if (input.runSummary.counts.queued > 5) {
    actions.push("排队运行较多：检查是否存在单智能体并发受限、上游阻塞或恢复链打转。");
  }
  if ((input.queueSummary?.backlogHighPriority ?? 0) > 0) {
    actions.push(`高优 backlog 积压 ${input.queueSummary?.backlogHighPriority ?? 0}：优先分配负责人或拆成可执行子任务。`);
  }
  if (input.runSummary.alerts.some((item) => (item.livenessReason ?? "").includes("process_lost"))) {
    actions.push("发现 process_lost 痕迹：重点核查本机长运行会话、终端托管与服务重启时序。");
  }
  if (actions.length === 0) {
    actions.push("当前未发现需要立刻人工介入的高危信号，继续按常规巡检节奏观察。");
  }
  return actions;
}
