/**
 * Phase 30 — KPI card: "X days with daily_report / Y days total".
 */
import { ChartCard } from "./ChartCard";

interface DailyReportCoverageCardProps {
  daysWithReport: number;
  daysTotal: number;
  title: string;
  subtitle?: string;
  noDataLabel?: string;
}

export function DailyReportCoverageCard({
  daysWithReport,
  daysTotal,
  title,
  subtitle,
  noDataLabel = "暂无数据",
}: DailyReportCoverageCardProps) {
  const pct = daysTotal > 0 ? Math.round((daysWithReport / daysTotal) * 100) : 0;

  return (
    <ChartCard title={title} subtitle={subtitle}>
      {daysTotal === 0 ? (
        <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
          {noDataLabel}
        </div>
      ) : (
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold tabular-nums text-foreground">{daysWithReport}</span>
          <span className="text-sm text-muted-foreground">/ {daysTotal} 天</span>
          <span className="ml-auto text-xs text-muted-foreground">({pct}%)</span>
        </div>
      )}
    </ChartCard>
  );
}