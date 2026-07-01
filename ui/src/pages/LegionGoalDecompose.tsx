import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Bot, CheckCircle2, XCircle, RefreshCw, Loader2 } from "lucide-react";
import { legionApi, type LegionTask } from "@/api/legion";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { MarkdownView } from "@/components/MarkdownView";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";

function statusLabel(status: string) {
  const map: Record<string, string> = { todo: "待做", in_progress: "进行中", done: "完成", failed: "失败", blocked: "阻塞" };
  return map[status] ?? status;
}
function statusTone(status: string) {
  const map: Record<string, string> = {
    todo: "bg-gray-100 dark:bg-gray-800",
    in_progress: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
    done: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
    failed: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
    blocked: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
  };
  return map[status] ?? "bg-gray-100";
}
function parseSkills(skills: string | null): string[] {
  if (!skills) return [];
  try { return JSON.parse(skills) } catch { return []; }
}
function parseDeps(deps: string | null): string[] {
  if (!deps) return [];
  try { return JSON.parse(deps) } catch { return []; }
}
function statusDot(status: string) {
  const map: Record<string, string> = {
    todo: "bg-gray-400", in_progress: "bg-blue-500", done: "bg-green-500", failed: "bg-red-500", blocked: "bg-amber-500",
  };
  return map[status] ?? "bg-gray-400";
}

export function LegionGoalDecomposePage() {
  const { goalId } = useParams<{ goalId: string }>();
  const [searchParams] = useSearchParams();
  const companyId = searchParams.get("companyId") ?? "";
  const { setBreadcrumbs } = useBreadcrumbs();
  const { t } = useTranslation();
  const [description, setDescription] = useState("");

  useEffect(() => {
    setBreadcrumbs([{ label: "目标拆解" }]);
  }, [setBreadcrumbs]);

  const { data: tasksData, isLoading } = useQuery({
    queryKey: ["legion-goal-tasks", goalId],
    queryFn: () => {
      if (!goalId) throw new Error("no goalId");
      return legionApi.getGoalTasks(goalId);
    },
    enabled: !!goalId,
  });

  const tasks = tasksData ?? [];

  useEffect(() => {
    if (tasks.length > 0 && !description) {
      const first = tasks[0];
      setDescription(first.goal?.description ?? "");
    }
  }, [tasks, description]);

  const decomposeMutation = useMutation({
    mutationFn: () => {
      if (!goalId) throw new Error("no goalId");
      return legionApi.decomposeGoal(companyId, goalId, description);
    },
  });

  if (isLoading) return <PageSkeleton />;
  if (!tasks.length) return (
    <div className="p-6">
      <EmptyState icon={Bot} message="暂无任务，输入目标描述并点击拆解" />
    </div>
  );

  const taskTitles = new Map(tasks.map(t => [t.id, t.title]));

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* 顶部输入区 */}
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-lg font-semibold">目标拆解 — {tasks[0]?.goal?.title ?? goalId}</h2>
          <Button size="sm" variant="outline" onClick={() => decomposeMutation.mutate()} disabled={decomposeMutation.isPending || !description.trim()}>
            重新拆解
          </Button>
        </div>
        <textarea
          className="w-full rounded border border-border bg-background px-3 py-2 text-sm resize-none"
          rows={2}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="输入目标描述..."
        />
      </div>

      {/* DAG 图 */}
      <div className="border-b border-border p-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-3">任务依赖图</h3>
        <div className="space-y-2">
          {tasks.map((task, idx) => {
            const deps = parseDeps(task.dependencies);
            return (
              <div key={task.id} className="flex items-center gap-3 text-sm">
                <span className={cn("w-2 h-2 rounded-full flex-shrink-0", statusDot(task.status))} />
                <span className={cn("w-20 text-xs font-mono text-muted-foreground", idx === 0 ? "font-bold text-foreground" : "")}>{idx + 1}.</span>
                <span className={cn("flex-1 font-medium px-2 py-1 rounded text-xs", statusTone(task.status))}>{task.title}</span>
                <span className="text-xs text-muted-foreground w-8">约{task.estimatedDuration ?? 60}min</span>
                {deps.length > 0 && (
                  <span className="text-xs text-muted-foreground">← {deps.map(id => taskTitles.get(id) ?? id).join(", ")}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 任务列表 */}
      <div className="flex-1 p-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-3">任务列表 ({tasks.length})</h3>
        <div className="space-y-2">
          {tasks.map((task, idx) => (
            <div key={task.id} className={cn("rounded-lg border p-4", statusTone(task.status).replace("/30", "/10"))}>
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <span className={cn("w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0", statusDot(task.status), "text-white")}>{idx + 1}</span>
                  <div>
                    <div className="font-medium">{task.title}</div>
                    <MarkdownView source={task.description ?? ""} className="text-xs text-muted-foreground mt-1" />
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {parseSkills(task.requiredSkills).map(s => (
                        <span key={s} className="inline-flex rounded border border-border bg-muted px-1.5 py-0.5 text-xs">{s}</span>
                      ))}
                      <span className="text-xs text-muted-foreground">依赖: {parseDeps(task.dependencies).length}</span>
                    </div>
                  </div>
                </div>
                <span className={cn("text-xs px-2 py-0.5 rounded flex-shrink-0", statusTone(task.status))}>{statusLabel(task.status)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}