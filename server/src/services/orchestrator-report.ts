import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  orchestratorRuns,
  projectContext,
  tasks,
  type OrchestratorRunStatus,
} from "@paperclipai/db";

/**
 * Phase 23 of doc/plans/2026-07-01-orchestrator-control-plane.md.
 *
 * Render the orchestrator's daily report as Markdown. The UI fetches
 * the latest run's `dailyReport` column and renders it via
 * react-markdown; here we generate the body.
 *
 * Markdown shape (intentionally boring — operators read this on phones):
 *   # Daily Report — 2026-07-01
 *   ## Long goal
 *   <title>
 *   ## Phase
 *   <phase name + status>
 *   ## Completed today
 *   - <task>
 *   ## In progress
 *   - <task> (status, owner)
 *   ## Blocked
 *   - <task> — reason
 *   ## File conflicts resolved
 *   - <file>
 *   ## Next dispatch
 *   - <task> → <agent> — reason
 *   ## Decisions
 *   - <type>: <subject> — reason
 */

export interface DailyReportInput {
  companyId: string;
  /** ISO date (YYYY-MM-DD) — defaults to today UTC. */
  reportDate?: string;
  /** Optional explicit run id; default picks the latest successful run. */
  runId?: string;
}

export interface DailyReport {
  runId: string;
  reportDate: string;
  markdown: string;
  html: string;
}

export function orchestratorReportService(db: Db) {
  return {
    async generate(input: DailyReportInput): Promise<DailyReport | null> {
      const reportDate = input.reportDate ?? new Date().toISOString().slice(0, 10);

      // Pick the latest run; prefer today's successful run if one exists.
      const dayStart = new Date(`${reportDate}T00:00:00.000Z`);
      const today = await db
        .select()
        .from(orchestratorRuns)
        .where(
          and(
            eq(orchestratorRuns.companyId, input.companyId),
            gte(orchestratorRuns.startedAt, dayStart),
            eq(orchestratorRuns.status, "succeeded"),
          ),
        )
        .orderBy(desc(orchestratorRuns.startedAt))
        .limit(1);
      const run = today[0]
        ?? (await db
          .select()
          .from(orchestratorRuns)
          .where(eq(orchestratorRuns.companyId, input.companyId))
          .orderBy(desc(orchestratorRuns.startedAt))
          .limit(1))[0];
      if (!run) return null;

      const decisions = (run.decisions as Array<Record<string, unknown>> | null) ?? [];
      const dispatches = (run.dispatches as Array<Record<string, unknown>> | null) ?? [];
      const fileLockActions = (run.fileLockActions as Array<Record<string, unknown>> | null) ?? [];

      const ctx = await db
        .select()
        .from(projectContext)
        .where(eq(projectContext.companyId, input.companyId))
        .limit(1);
      const context = ctx[0] ?? null;

      // Pull the task ids mentioned in dispatches so we can label them.
      const taskIds = Array.from(
        new Set(
          dispatches
            .map((d) => typeof d.taskId === "string" ? d.taskId : null)
            .filter((id): id is string => id !== null),
        ),
      );
      const taskRows = taskIds.length > 0
        ? await db
            .select({ id: tasks.id, title: tasks.title, status: tasks.status, assigneeAgentId: tasks.assigneeAgentId })
            .from(tasks)
            .where(sql`${tasks.id} = ANY(${taskIds})`)
        : [];
      const taskById = new Map(taskRows.map((t) => [t.id, t]));

      const markdown = renderMarkdown({
        reportDate,
        runId: run.id,
        runStatus: run.status as OrchestratorRunStatus,
        longGoal: extractTitle(context?.completedFeatures) ?? null,
        phase: null, // populated by the caller via project_context if needed
        decisions,
        dispatches,
        fileLockActions,
        taskById,
        contextSnapshot: run.contextSnapshot as Record<string, unknown> | null,
      });

      // We return plain markdown + a sanitised HTML preview. The HTML
      // here is the bare-minimum Markdown→HTML conversion that runs in
      // the server (no React, no DOM); the UI re-renders through
      // react-markdown so this HTML is only used for the email/clipboard
      // export path.
      const html = markdownToHtml(markdown);

      return {
        runId: run.id,
        reportDate,
        markdown,
        html,
      };
    },

    async persistDailyReport(runId: string, markdown: string): Promise<void> {
      await db
        .update(orchestratorRuns)
        .set({ dailyReport: markdown, updatedAt: new Date() })
        .where(eq(orchestratorRuns.id, runId));
    },
  };
}

interface RenderInput {
  reportDate: string;
  runId: string;
  runStatus: OrchestratorRunStatus;
  longGoal: string | null;
  phase: { id: string; name: string; status: string } | null;
  decisions: Array<Record<string, unknown>>;
  dispatches: Array<Record<string, unknown>>;
  fileLockActions: Array<Record<string, unknown>>;
  taskById: Map<string, { id: string; title: string; status: string; assigneeAgentId: string | null }>;
  contextSnapshot: Record<string, unknown> | null;
}

function renderMarkdown(input: RenderInput): string {
  const out: string[] = [];
  out.push(`# Daily Report — ${input.reportDate}`);
  out.push("");
  out.push(`_run \`${input.runId}\` · status ${input.runStatus}_`);
  out.push("");
  if (input.longGoal) {
    out.push(`## Long goal`);
    out.push(input.longGoal);
    out.push("");
  }
  if (input.phase) {
    out.push(`## Phase`);
    out.push(`**${input.phase.name}** (${input.phase.status})`);
    out.push("");
  }

  // Group decisions by type.
  const decisionsByType = new Map<string, Array<{ subject: string; reason: string }>>();
  for (const d of input.decisions) {
    const type = typeof d.type === "string" ? d.type : "unknown";
    const subject = typeof d.subject === "string" ? d.subject : "?";
    const reason = typeof d.reason === "string" ? d.reason : "";
    if (!decisionsByType.has(type)) decisionsByType.set(type, []);
    decisionsByType.get(type)!.push({ subject, reason });
  }
  if (decisionsByType.size > 0) {
    out.push(`## Decisions`);
    for (const [type, items] of decisionsByType) {
      out.push(`### ${type} (${items.length})`);
      for (const it of items) {
        out.push(`- \`${it.subject}\` — ${it.reason}`);
      }
      out.push("");
    }
  }

  if (input.dispatches.length > 0) {
    out.push(`## Dispatched today`);
    for (const d of input.dispatches) {
      const taskId = typeof d.taskId === "string" ? d.taskId : "?";
      const agentId = typeof d.agentId === "string" ? d.agentId : "?";
      const reason = typeof d.reason === "string" ? d.reason : "";
      const task = input.taskById.get(taskId);
      const label = task ? `**${task.title}** (\`${taskId}\`)` : `\`${taskId}\``;
      out.push(`- ${label} → \`${agentId}\` — ${reason}`);
    }
    out.push("");
  }

  if (input.fileLockActions.length > 0) {
    const acquires = input.fileLockActions.filter((a) => a.action === "acquire");
    const releases = input.fileLockActions.filter((a) => a.action === "release");
    if (acquires.length > 0 || releases.length > 0) {
      out.push(`## File-lock actions`);
      for (const a of acquires) {
        out.push(`- acquire \`${a.filePath}\` for task \`${a.taskId}\``);
      }
      for (const a of releases) {
        out.push(`- release \`${a.filePath}\` from task \`${a.taskId}\``);
      }
      out.push("");
    }
  }

  return out.join("\n");
}

function extractTitle(features: unknown): string | null {
  if (Array.isArray(features)) {
    const first = features[0];
    if (first && typeof first === "object" && "name" in first && typeof (first as { name: unknown }).name === "string") {
      return (first as { name: string }).name;
    }
  }
  return null;
}

/**
 * Minimal Markdown → HTML for the export path. The UI uses react-markdown
 * for the live preview; this is only for `Clipboard.writeText` / email
 * share. We render only the subset the orchestrator emits: headings,
 * paragraphs, lists, inline code, bold/italic, blank lines.
 *
 * NOT a general-purpose Markdown parser. Do not feed user input.
 */
function markdownToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("### ")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
    } else if (line.startsWith("## ")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    } else if (line.startsWith("# ")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
    } else if (line.startsWith("- ")) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inlineMd(line.slice(2))}</li>`);
    } else if (line.length === 0) {
      if (inList) { out.push("</ul>"); inList = false; }
    } else {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<p>${inlineMd(line)}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineMd(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
}