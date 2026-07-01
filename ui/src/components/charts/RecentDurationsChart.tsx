/**
 * Phase 30 — bar chart of recent run durations (last 50 runs).
 */
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { ChartCard } from "./ChartCard";

interface RecentDurationsChartProps {
  durationsMs: number[];
  title: string;
  subtitle?: string;
  noDataLabel?: string;
}

function msToLabel(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatDuration(ms: number): string {
  return msToLabel(ms);
}

export function RecentDurationsChart({
  durationsMs,
  title,
  subtitle,
  noDataLabel = "暂无数据",
}: RecentDurationsChartProps) {
  // 分成 10 个 bucket 的直方图
  const buckets = buildHistogram(durationsMs, 10);

  return (
    <ChartCard title={title} subtitle={subtitle}>
      {durationsMs.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
          {noDataLabel}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={buckets} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10 }}
              stroke="hsl(var(--muted-foreground))"
              interval="preserveStartEnd"
            />
            <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              labelStyle={{ fontSize: 11 }}
              formatter={(v) => [`${v} 次`, "运行次数"]}
            />
            <Bar dataKey="count" radius={[3, 3, 0, 0]}>
              {buckets.map((_, index) => (
                <Cell key={`cell-${index}`} fill="hsl(var(--primary) / 0.7)" />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

function buildHistogram(values: number[], bucketCount: number): Array<{ label: string; count: number }> {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ label: formatDuration(min), count: values.length }];

  const bucketSize = (max - min) / bucketCount;
  const buckets: Array<{ label: string; count: number }> = Array.from({ length: bucketCount }, (_, i) => ({
    label: formatDuration(min + bucketSize * i),
    count: 0,
  }));

  for (const v of values) {
    let idx = Math.floor((v - min) / bucketSize);
    if (idx >= bucketCount) idx = bucketCount - 1;
    if (idx < 0) idx = 0;
    buckets[idx].count++;
  }

  return buckets;
}