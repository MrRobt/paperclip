import { useEffect, useMemo, useState } from "react";
import { useParams } from "@/lib/router";
import { goalsApi } from "@/api/goals";
import { legionApi, type LegionTask } from "@/api/legion";
import { useCompany } from "@/context/CompanyContext";
import type { Goal } from "@paperclipai/shared";

function parseList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
  } catch {}
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function statusColor(status: string): string {
  if (status === "done") return "#16a34a";
  if (status === "in_progress") return "#2563eb";
  if (status === "failed") return "#dc2626";
  return "#94a3b8";
}

function TaskDag({ tasks }: { tasks: LegionTask[] }) {
  const positions = tasks.map((task, index) => ({ task, x: 40 + (index % 3) * 260, y: 40 + Math.floor(index / 3) * 140 }));
  const byId = new Map(positions.map((pos) => [pos.task.id, pos]));
  const height = Math.max(220, 120 + Math.ceil(tasks.length / 3) * 140);
  return (
    <svg className="w-full rounded-lg border border-border bg-card" height={height} role="img" aria-label="Task dependency DAG">
      <defs><marker id="legion-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#64748b" /></marker></defs>
      {positions.flatMap(({ task, x, y }) => parseList(task.dependencies).map((depId) => {
        const dep = byId.get(depId);
        if (!dep) return null;
        return <line key={`${depId}-${task.id}`} x1={dep.x + 180} y1={dep.y + 32} x2={x} y2={y + 32} stroke="#64748b" strokeWidth="2" markerEnd="url(#legion-arrow)" />;
      }))}
      {positions.map(({ task, x, y }) => (
        <g key={task.id}>
          <rect x={x} y={y} width="190" height="64" rx="10" fill={statusColor(task.status)} opacity="0.92" />
          <text x={x + 12} y={y + 26} fill="white" fontSize="13" fontWeight="600">{task.title.slice(0, 24)}</text>
          <text x={x + 12} y={y + 48} fill="white" fontSize="11">{task.status} · {task.id.slice(0, 12)}</text>
        </g>
      ))}
    </svg>
  );
}

export function GoalDecompose() {
  const { goalId } = useParams<{ goalId: string }>();
  const { selectedCompany } = useCompany();
  const [goal, setGoal] = useState<Goal | null>(null);
  const [description, setDescription] = useState("");
  const [tasks, setTasks] = useState<LegionTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!goalId) return;
    void Promise.all([goalsApi.get(goalId), legionApi.getGoalTasks(goalId)]).then(([loadedGoal, loadedTasks]) => {
      setGoal(loadedGoal);
      setDescription(loadedGoal.description ?? "");
      setTasks(loadedTasks);
    }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [goalId]);

  const companyId = goal?.companyId ?? selectedCompany?.id ?? "";

  async function decompose() {
    if (!goalId || !companyId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await legionApi.decomposeGoal(companyId, goalId, description);
      const resultTasks = (result.tasks ?? result.taskList ?? []) as LegionTask[];
      setTasks(resultTasks.length > 0 ? resultTasks : await legionApi.getGoalTasks(goalId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="text-sm text-muted-foreground">Legion Goal</div>
        <h1 className="mt-1 text-2xl font-semibold">{goal?.title ?? "Goal decomposition"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{goal?.description ?? "Loading goal..."}</p>
      </div>
      {error ? <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      <div className="rounded-lg border border-border bg-card p-5">
        <label className="text-sm font-medium">目标描述</label>
        <textarea className="mt-2 min-h-36 w-full rounded-md border border-input bg-background p-3 text-sm" value={description} onChange={(event) => setDescription(event.target.value)} />
        <button className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60" disabled={loading || !description.trim()} onClick={() => void decompose()}>{loading ? "拆解中..." : "拆解"}</button>
      </div>
      {loading ? <div className="h-56 animate-pulse rounded-lg bg-muted" /> : null}
      {!loading && tasks.length > 0 ? <><TaskDag tasks={tasks} /><div className="overflow-hidden rounded-lg border border-border"><table className="w-full text-sm"><thead className="bg-muted"><tr><th className="p-3 text-left">任务</th><th className="p-3 text-left">技能</th><th className="p-3 text-left">依赖</th><th className="p-3 text-left">状态</th><th className="p-3 text-left">操作</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.id} className="border-t border-border"><td className="p-3"><div className="font-medium">{task.title}</div><div className="text-xs text-muted-foreground">{task.estimatedDuration ?? "?"} min</div></td><td className="p-3">{parseList(task.requiredSkills).join(", ") || "-"}</td><td className="p-3">{parseList(task.dependencies).join(", ") || "-"}</td><td className="p-3"><span style={{ backgroundColor: statusColor(task.status) }} className="rounded px-2 py-1 text-xs text-white">{task.status}</span></td><td className="p-3"><button className="rounded border px-2 py-1" onClick={() => void legionApi.updateTaskStatus(task.id, "done").then((updated) => setTasks((current) => current.map((item) => item.id === updated.id ? updated : item)))}>完成</button></td></tr>)}</tbody></table></div></> : null}
    </div>
  );
}
