/**
 * Phase 30 — bar chart of orchestrator output section fill-rate.
 */
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ResponsiveContainer,
} from "recharts";
import { ChartCard } from "./ChartCard";

interface SectionCoverageChartProps {
  data: Record<string, number>; // section name -> % filled
  title: string;
  subtitle?: string;
  noDataLabel?: string;
}

// 标签映射：英文 key -> 中文/繁中展示名
const SECTION_LABELS: Record<string, { zh: string; zhTW: string }> = {
  decisions: { zh: "决策", zhTW: "決策" },
  dispatches: { zh: "派发", zhTW: "派發" },
  fileLockActions: { zh: "文件锁", zhTW: "檔案鎖" },
  contextSnapshot: { zh: "上下文快照", zhTW: "上下文快照" },
  dailyReport: { zh: "日报", zhTW: "日報" },
  summary: { zh: "摘要", zhTW: "摘要" },
  errorMessage: { zh: "错误", zhTW: "錯誤" },
};

function getLabel(key: string, locale: string = "zh-CN"): string {
  if (locale === "zh-TW") return SECTION_LABELS[key]?.zhTW ?? key;
  return SECTION_LABELS[key]?.zh ?? key;
}

export function SectionCoverageChart({
  data,
  title,
  subtitle,
  noDataLabel = "暂无数据",
}: SectionCoverageChartProps) {
  const entries = Object.entries(data);
  // 简单按 locale 推断，线上使用 i18n 时可注入 locale
  const chartData = entries.map(([key, value]) => ({
    name: getLabel(key, "zh-CN"),
    key,
    value,
  }));

  return (
    <ChartCard title={title} subtitle={subtitle}>
      {entries.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
          {noDataLabel}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
            <YAxis
              tick={{ fontSize: 10 }}
              stroke="hsl(var(--muted-foreground))"
              domain={[0, 100]}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              labelStyle={{ fontSize: 11 }}
              formatter={(v) => [`${v}%`, "覆盖率"]}
            />
            <Bar dataKey="value" radius={[3, 3, 0, 0]}>
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={`hsl(var(--primary) / ${0.4 + (entry.value / 100) * 0.6})`}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}