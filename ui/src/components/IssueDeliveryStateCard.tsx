import type { IssueDeliveryState } from "@paperclipai/shared";
import { Check, Clock, FileCheck2, PackageCheck, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

const PROCESS_LABELS: Record<IssueDeliveryState["processState"], string> = {
  not_started: "未开始",
  running: "运行中",
  stale: "疑似空转",
  waiting_for_review: "待评审",
  blocked: "已阻塞",
  completed: "已完成",
  cancelled: "已取消",
};

const OUTPUT_LABELS: Record<IssueDeliveryState["outputState"], string> = {
  no_output: "无产出",
  activity_only: "仅有活动",
  has_evidence: "已有证据",
};

const VERIFICATION_LABELS: Record<IssueDeliveryState["verificationState"], string> = {
  unverified: "未验收",
  evidence_attached: "待验收",
  evidence_required: "缺证据",
  verified: "已验收",
};

function toneForDeliveryState(state: IssueDeliveryState) {
  if (state.verificationState === "verified") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200";
  if (state.verificationState === "evidence_required" || state.processState === "stale") return "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200";
  if (state.processState === "blocked") return "border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-200";
  return "border-border bg-muted/35 text-foreground";
}

function StatePill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-current/15 bg-background/45 px-2 py-0.5 text-[11px] font-medium">
      <span className="text-current/70">{label}</span>
      <span>{value}</span>
    </span>
  );
}

export function IssueDeliveryStateCard({ state, className }: { state: IssueDeliveryState | null | undefined; className?: string }) {
  if (!state) return null;

  return (
    <section
      data-testid="issue-delivery-state-card"
      className={cn("rounded-lg border px-3 py-2.5 text-sm", toneForDeliveryState(state), className)}
      aria-label="交付状态"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 font-medium">
            <Workflow className="h-4 w-4 shrink-0" />
            <span>交付状态</span>
          </div>
          <p className="text-xs leading-5 text-current/80">{state.summary}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <StatePill label="进程" value={PROCESS_LABELS[state.processState]} />
          <StatePill label="产出" value={OUTPUT_LABELS[state.outputState]} />
          <StatePill label="验收" value={VERIFICATION_LABELS[state.verificationState]} />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-current/75">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          平台状态：{state.platformStatus.replace(/_/g, " ")}
        </span>
        <span className="inline-flex items-center gap-1">
          {state.hasCompletionEvidence ? <Check className="h-3 w-3" /> : <FileCheck2 className="h-3 w-3" />}
          完成证据：{state.hasCompletionEvidence ? `${state.evidenceWorkProductCount} 条` : "缺失"}
        </span>
        {state.evidenceWorkProductCount > 0 ? (
          <span className="inline-flex items-center gap-1">
            <PackageCheck className="h-3 w-3" />
            可复验 work product（工作产物）已绑定
          </span>
        ) : null}
      </div>
    </section>
  );
}
