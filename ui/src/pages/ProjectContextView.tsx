/**
 * Phase 18 of doc/plans/2026-07-01-orchestrator-control-plane.md.
 *
 * `/project-context` — read-only view of the per-company
 * `project_context` row. Shows current long-goal / phase, completed
 * features, blocked items, risks, key decisions, verified facts.
 *
 * Editable form lives behind a separate route (future work); this
 * page is the operator's read-only inspection surface.
 */

import { useTranslation } from "@/i18n";
import { FileSearch } from "lucide-react";
import { useState } from "react";
import { useCompany } from "../context/CompanyContext";
import { orchestratorApi, type ProjectContextEntry } from "../api/orchestrator";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { MarkdownView } from "../components/MarkdownView";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "../lib/utils";
import { Button } from "@/components/ui/button";

export function ProjectContextViewPage() {
  const { t } = useTranslation();
  const { selectedCompanyId } = useCompany();

  const query = useQuery({
    queryKey: ["project-context", selectedCompanyId],
    queryFn: () => orchestratorApi.getProjectContext(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 30_000,
  });

  if (!selectedCompanyId) {
    return (
      <div className="p-6">
        <EmptyState icon={FileSearch} message={t("projectContext.noCompanySelected")} />
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="p-6">
        <PageSkeleton variant="detail" />
      </div>
    );
  }

  if (!query.data) {
    return (
      <div className="p-6">
        <EmptyState
          icon={FileSearch}
          message={t("projectContext.emptyTitle")}
        />
      </div>
    );
  }

  return <ProjectContextView ctx={query.data} />;
}

function ProjectContextView({ ctx }: { ctx: ProjectContextEntry }) {
  const { selectedCompanyId } = useCompany();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [nextPriority, setNextPriority] = useState(ctx.nextPriority ?? "");
  const [completedJson, setCompletedJson] = useState(JSON.stringify(ctx.completedFeatures ?? [], null, 2));
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      let completedFeatures: unknown = ctx.completedFeatures;
      try {
        if (completedJson.trim()) completedFeatures = JSON.parse(completedJson);
      } catch {
        throw new Error("completedFeatures must be valid JSON");
      }
      return orchestratorApi.putProjectContext({
        companyId: ctx.companyId,
        nextPriority: nextPriority || undefined,
        completedFeatures,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-context", selectedCompanyId] });
      setEditing(false);
      setError(null);
    },
    onError: (e) => setError(e instanceof Error ? e.message : "save failed"),
  });

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{ctx.companyId}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Last updated {new Date(ctx.updatedAt).toLocaleString()}
          </p>
        </div>
        {!editing && (
          <Button onClick={() => { setNextPriority(ctx.nextPriority ?? ""); setCompletedJson(JSON.stringify(ctx.completedFeatures ?? [], null, 2)); setEditing(true); }}>
            Edit
          </Button>
        )}
      </header>

      {editing && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold">Edit project context</h3>
          <div>
            <label className="text-sm font-medium">Next priority</label>
            <input
              value={nextPriority}
              onChange={(e) => setNextPriority(e.target.value)}
              className="mt-1 w-full rounded border bg-background px-3 py-2 text-sm"
              placeholder="e.g. Build /file-locks UI"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Completed features (JSON array)</label>
            <textarea
              value={completedJson}
              onChange={(e) => setCompletedJson(e.target.value)}
              className="mt-1 w-full rounded border bg-background px-3 py-2 text-xs font-mono"
              rows={6}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
            <Button variant="outline" onClick={() => { setEditing(false); setError(null); }} disabled={save.isPending}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Current focus">
          <Field label="long_goal_id" value={ctx.currentLongGoalId} />
          <Field label="phase_id" value={ctx.currentPhaseId} />
          <Field label="next_priority" value={ctx.nextPriority} />
          <Field label="stale_doc_paths" value={ctx.staleDocPaths} />
          <Field label="updated_by_agent_id" value={ctx.updatedByAgentId} />
        </Card>

        <Card title="Strategic state">
          <JsonBlock label="completedFeatures" value={ctx.completedFeatures} />
          <JsonBlock label="partialFeatures" value={ctx.partialFeatures} />
          <JsonBlock label="blockedItems" value={ctx.blockedItems} />
        </Card>

        <Card title="Risks">
          <JsonBlock label="risks" value={ctx.risks} />
        </Card>

        <Card title="Decisions">
          <MarkdownListBlock items={(ctx.keyDecisions as Array<Record<string, unknown>> | null) ?? []} renderItem={(d) => (
            <div className="space-y-1">
              <div className="text-muted-foreground">{d.decision ? <MarkdownView source={String(d.decision)} /> : "—"}</div>
              {d.rationale ? <div className="text-muted-foreground"><MarkdownView source={String(d.rationale)} /></div> : null}
              {d.date ? <div className="text-[10px] text-muted-foreground/70">{String(d.date)}</div> : null}
            </div>
          )} />
        </Card>

        <Card title="Verified facts (no duplicate labour)">
          <MarkdownListBlock items={(ctx.verifiedFacts as Array<Record<string, unknown>> | null) ?? []} renderItem={(d) => (
            <div className="space-y-1">
              <MarkdownView source={String(d.fact ?? "")} />
              {d.evidencePath ? <div className="text-[10px] text-muted-foreground/70">evidence: <code>{String(d.evidencePath)}</code></div> : null}
            </div>
          )} />
        </Card>

        <Card title="Investigated conclusions">
          <MarkdownListBlock items={(ctx.investigatedConclusions as Array<Record<string, unknown>> | null) ?? []} renderItem={(d) => (
            <div className="space-y-1">
              {d.question ? <div className="text-[10px] text-muted-foreground">Q: {String(d.question)}</div> : null}
              <MarkdownView source={String(d.conclusion ?? "")} />
              {d.stillValid === false ? <div className="text-[10px] text-rose-600">invalidated</div> : null}
            </div>
          )} />
        </Card>

        <Card title="Agent collaboration rules">
          <MarkdownListBlock
            items={(
              (ctx.agentCollaborationRules as Array<string | Record<string, unknown>> | null) ?? []
            ).map((r) => (typeof r === "string" ? { _text: r } : r))}
            renderItem={(r) => <MarkdownView source={String(r._text ?? r.rule ?? r.text ?? JSON.stringify(r))} />}
          />
        </Card>
      </div>
    </div>
  );
}

interface MarkdownListBlockProps {
  items: Array<Record<string, unknown>>;
  renderItem: (item: Record<string, unknown>) => React.ReactNode;
}

function MarkdownListBlock({ items, renderItem }: MarkdownListBlockProps) {
  if (items.length === 0) {
    return <div className="text-muted-foreground">—</div>;
  }
  return (
    <ul className="space-y-3">
      {items.map((it, i) => (
        <li key={i} className="rounded border bg-muted/20 p-2">
          {renderItem(it)}
        </li>
      ))}
    </ul>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-4 space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="space-y-1.5 text-xs">{children}</div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-mono", value ? "text-foreground" : "text-muted-foreground italic")}>
        {value ?? "—"}
      </span>
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <pre className="mt-1 overflow-x-auto rounded border bg-muted/30 p-2 text-[11px] leading-relaxed">
        {value == null ? "—" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}