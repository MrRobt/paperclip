import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, CheckCircle2, XCircle, RefreshCw, AlertTriangle, Clock } from "lucide-react";
import { legionApi, type LegionTask, type LegionHealth } from "@/api/legion";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { MarkdownView } from "@/components/MarkdownView";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useCompany } from "@/context/CompanyContext";
import { useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";

function statusIcon(status: string) {
  const map: Record<string, React.ReactNode> = {
    todo: <Clock className="w-4 h-4 text-muted-foreground" />,
    in_progress: <Bot className="w-4 h-4 text-blue-500" />,
    done: <CheckCircle2 className="w-4 h-4 text-green-500" />,
    failed: <XCircle className="w-4 h-4 text-red-500" />,
    blocked: <AlertTriangle className="w-4 h-4 text-amber-500" />,
  };
  return map[status] ?? <Clock className="w-4 h-4" />;
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    todo: "待做", in_progress: "进行中", done: "已完成",
    failed: "失败", blocked: "阻塞",
  };
  return map[status] ?? status;
}

function statusTone(status: string) {
  const map: Record<string, string> = {
    todo: "border-border", in_progress: "border-blue-500/40 bg-blue-500/10",
    done: "border-emerald-500/40 bg-emerald-500/10",
    failed: "border-red-500/40 bg-red-500/10",
    blocked: "border-amber-500/40 bg-amber-500/10",
  };
  return map[status] ?? "border-border";
}

function parseSkills(skills: string | null): string[] {
  if (!skills) return [];
  try { return JSON.parse(skills) } catch { return []; }
}

function parseDeps(deps: string | null): string[] {
  if (!deps) return [];
  try { return JSON.parse(deps) } catch { return []; }
}

export function LegionTasksPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState("");
  const [selectedTask, setSelectedTask] = useState<LegionTask | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "军团任务" }]);
  }, [setBreadcrumbs]);

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["legion-tasks", selectedCompanyId],
    queryFn: () => legionApi.listTasks(selectedCompanyId ?? undefined),
  });

  const { data: health } = useQuery({
    queryKey: ["legion-health", selectedCompanyId],
    queryFn: () => legionApi.getLegionHealth(),
    refetchInterval: 30_000,
  });

  const filtered = filterStatus ? (tasks ?? []).filter(t => t.status === filterStatus) : (tasks ?? []);

  const updateStatusMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: string }) =>
      legionApi.updateTaskStatus(taskId, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["legion-tasks"] }),
  });

  const verifyMutation = useMutation({
    mutationFn: (taskId: string) => legionApi.verifyTask(taskId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["legion-tasks"] }),
  });

  function handleUpdateStatus(task: LegionTask, status: string) {
    updateStatusMutation.mutate({ taskId: task.id, status });
  }

  if (isLoading) return <PageSkeleton />;
  if (!(tasks ?? []).length) return (
    <div className="p-6">
      <EmptyState icon={Bot} message="暂无任务，通过目标拆解创建任务" />
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* 健康状态栏 */}
      {health && (
        <div className="flex gap-3 px-6 py-4 border-b border-border">
          <div className={cn("flex-1 rounded-lg border px-4 py-3", statusTone(health.goals.executing > 0 ? "in_progress" : "todo"))}>
            <div className="text-2xl font-semibold">{health.goals.total}</div>
            <div className="text-xs text-muted-foreground">目标总数</div>
            <div className="text-xs mt-1">执行中 {health.goals.executing} / 完成 {health.goals.completed}</div>
          </div>
          <div className="flex-1 rounded-lg border border-border px-4 py-3">
            <div className="text-2xl font-semibold">{health.tasks.total}</div>
            <div className="text-xs text-muted-foreground">任务总数</div>
            <div className="text-xs mt-1">进行中 {health.tasks.inProgress} / 完成 {health.tasks.done}</div>
          </div>
          <div className="flex-1 rounded-lg border border-border px-4 py-3">
            <div className="text-2xl font-semibold">{health.agents.total}</div>
            <div className="text-xs text-muted-foreground">Agent 总数</div>
            <div className="text-xs mt-1">活跃 {health.agents.active}</div>
          </div>
        </div>
      )}

      {/* 筛选栏 */}
      <div className="flex gap-2 px-6 py-3 border-b border-border items-center">
        {["", "todo", "in_progress", "done", "failed", "blocked"].map(s => (
          <Button
            key={s || "all"}
            size="sm"
            variant={filterStatus === s ? "default" : "outline"}
            onClick={() => setFilterStatus(s)}
          >
            {s ? statusLabel(s) : "全部"}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => queryClient.invalidateQueries({ queryKey: ["legion-tasks"] })}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {/* 任务表格 */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background border-b border-border">
            <tr className="text-left text-muted-foreground">
              <th className="px-4 py-2 font-medium w-10">#</th>
              <th className="px-4 py-2 font-medium">任务</th>
              <th className="px-4 py-2 font-medium w-32">技能</th>
              <th className="px-4 py-2 font-medium w-16 text-center">依赖</th>
              <th className="px-4 py-2 font-medium w-24">状态</th>
              <th className="px-4 py-2 font-medium w-28">Agent</th>
              <th className="px-4 py-2 font-medium w-44 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((task, idx) => (
              <tr
                key={task.id}
                className={cn("border-b border-border cursor-pointer hover:bg-muted/30", selectedTask?.id === task.id && "bg-muted/50")}
                onClick={() => setSelectedTask(selectedTask?.id === task.id ? null : task)}
              >
                <td className="px-4 py-2 text-muted-foreground">{idx + 1}</td>
                <td className="px-4 py-2">
                  <div className="font-medium">{task.title}</div>
                  <MarkdownView source={task.description ?? ""} className="text-xs text-muted-foreground truncate max-w-xs" />
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    {parseSkills(task.requiredSkills).map(s => (
                      <span key={s} className="inline-flex rounded border border-border bg-muted px-1.5 py-0.5 text-xs">{s}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2 text-center text-muted-foreground">{parseDeps(task.dependencies).length}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-1">
                    {statusIcon(task.status)}
                    <span className="text-xs">{statusLabel(task.status)}</span>
                  </div>
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground truncate">{task.assigneeAgentId ?? "—"}</td>
                <td className="px-4 py-2 text-right" onClick={e => e.stopPropagation()}>
                  <div className="flex gap-1 justify-end">
                    <Button size="xs" variant="ghost" onClick={() => handleUpdateStatus(task, "done")} disabled={task.status === "done"}>完成</Button>
                    <Button size="xs" variant="ghost" onClick={() => handleUpdateStatus(task, "failed")}>失败</Button>
                    <Button size="xs" variant="ghost" onClick={() => verifyMutation.mutate(task.id)} disabled={verifyMutation.isPending}>验收</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 详情侧边栏 */}
      {selectedTask && (
        <div className="fixed inset-y-0 right-0 w-[420px] bg-background border-l border-border shadow-xl z-50 overflow-auto p-6" onClick={e => e.stopPropagation()}>
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-semibold">任务详情</h2>
            <Button size="sm" variant="ghost" onClick={() => setSelectedTask(null)}>关闭</Button>
          </div>
          <div className="space-y-4 text-sm">
            <div><span className="text-muted-foreground font-medium">ID:</span> <code className="text-xs">{selectedTask.id}</code></div>
            <div><span className="text-muted-foreground font-medium">标题:</span> {selectedTask.title}</div>
            <div><span className="text-muted-foreground font-medium">描述:</span> {selectedTask.description ?? "—"}</div>
            <div><span className="text-muted-foreground font-medium">技能:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {parseSkills(selectedTask.requiredSkills).map(s => (
                  <span key={s} className="inline-flex rounded border border-border bg-muted px-1.5 py-0.5 text-xs">{s}</span>
                ))}
              </div>
            </div>
            <div><span className="text-muted-foreground font-medium">依赖:</span> {parseDeps(selectedTask.dependencies).join(", ") || "无"}</div>
            <div><span className="text-muted-foreground font-medium">状态:</span> {statusIcon(selectedTask.status)} {statusLabel(selectedTask.status)}</div>
            <div><span className="text-muted-foreground font-medium">尝试:</span> {selectedTask.attempts ?? 0} / {selectedTask.maxAttempts ?? 3}</div>
            <div><span className="text-muted-foreground font-medium">验收标准:</span> {selectedTask.verificationCriteria ?? "—"}</div>
            <div><span className="text-muted-foreground font-medium">验收结果:</span> {selectedTask.verificationResult ?? "未验收"}</div>
            <div><span className="text-muted-foreground font-medium">创建:</span> {new Date(selectedTask.createdAt).toLocaleString()}</div>
          </div>
        </div>
      )}
    </div>
  );
}