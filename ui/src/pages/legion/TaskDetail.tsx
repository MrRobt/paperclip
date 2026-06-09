import { useEffect, useState } from "react";
import { legionApi, type LegionHandoff, type LegionTask } from "@/api/legion";

function parseList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
  } catch {}
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function TaskDetail({ task, tasks, onClose }: { task: LegionTask | null; tasks: LegionTask[]; onClose: () => void }) {
  const [handoffs, setHandoffs] = useState<LegionHandoff[]>([]);
  const [activeTab, setActiveTab] = useState<"detail" | "handoffs" | "logs">("detail");

  useEffect(() => {
    if (!task) return;
    setActiveTab("detail");
    void legionApi.getTaskHandoffs(task.id).then(setHandoffs).catch(() => setHandoffs([]));
  }, [task]);

  if (!task) return null;
  const dependencies = parseList(task.dependencies);
  const dependents = tasks.filter((candidate) => parseList(candidate.dependencies).includes(task.id));

  return (
    <aside className="fixed bottom-0 right-0 top-0 z-40 w-[440px] overflow-auto border-l border-border bg-background p-5 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div><div className="text-xs text-muted-foreground">{task.id}</div><h2 className="mt-1 text-xl font-semibold">{task.title}</h2></div>
        <button className="rounded border px-2 py-1 text-sm" onClick={onClose}>关闭</button>
      </div>
      <div className="mt-4 flex gap-2 border-b border-border">
        {(["detail", "handoffs", "logs"] as const).map((tab) => <button key={tab} className={`px-3 py-2 text-sm ${activeTab === tab ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`} onClick={() => setActiveTab(tab)}>{tab === "detail" ? "详情" : tab === "handoffs" ? "交接记录" : "状态日志"}</button>)}
      </div>
      {activeTab === "detail" ? <div className="mt-4 space-y-4 text-sm">
        <section><h3 className="font-medium">基本信息</h3><p className="mt-1 text-muted-foreground">{task.description || "无描述"}</p><p className="mt-2 text-xs text-muted-foreground">创建：{new Date(task.createdAt).toLocaleString()} · 更新：{new Date(task.updatedAt).toLocaleString()}</p></section>
        <section><h3 className="font-medium">依赖关系</h3><p className="mt-1">依赖：{dependencies.join(", ") || "无"}</p><p className="mt-1">被依赖：{dependents.map((item) => item.id).join(", ") || "无"}</p></section>
        <section><h3 className="font-medium">技能要求</h3><div className="mt-2 flex flex-wrap gap-2">{parseList(task.requiredSkills).map((skill) => <span key={skill} className="rounded bg-muted px-2 py-1 text-xs">{skill}</span>)}{parseList(task.requiredSkills).length === 0 ? <span className="text-muted-foreground">无</span> : null}</div></section>
        <section><h3 className="font-medium">验收标准</h3><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{task.verificationCriteria || "未配置"}</p></section>
      </div> : null}
      {activeTab === "handoffs" ? <div className="mt-4 space-y-3">{handoffs.length === 0 ? <p className="text-sm text-muted-foreground">暂无交接记录</p> : handoffs.map((handoff) => <div key={handoff.id} className="rounded border border-border p-3 text-sm"><div className="font-medium">{handoff.artifactType}: {handoff.artifactPath}</div><p className="mt-1 text-muted-foreground">{handoff.summary}</p><div className="mt-2 text-xs text-muted-foreground">{new Date(handoff.createdAt).toLocaleString()} · {handoff.status}</div></div>)}</div> : null}
      {activeTab === "logs" ? <div className="mt-4 space-y-2 text-sm"><div className="rounded border border-border p-3">创建任务：{new Date(task.createdAt).toLocaleString()}</div><div className="rounded border border-border p-3">当前状态：{task.status}</div>{task.completedAt ? <div className="rounded border border-border p-3">完成：{new Date(task.completedAt).toLocaleString()}</div> : null}{task.verificationResult ? <pre className="whitespace-pre-wrap rounded border border-border p-3 text-xs">{task.verificationResult}</pre> : null}</div> : null}
    </aside>
  );
}
