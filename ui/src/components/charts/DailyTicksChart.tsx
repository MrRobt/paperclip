/**
 * Phase 30 — line chart of daily tick counts (total + successful/failed overlay).
 */
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { ChartCard } from "./ChartCard";

interface DailyTicksChartProps {
  data: Array<{ date: string; total: number; successful: number; failed: number }>;
  title: string;
  subtitle?: string;
  noDataLabel?: string;
}

export function DailyTicksChart({
  data,
  title,
  subtitle,
  noDataLabel = "暂无数据",
}: DailyTicksChartProps) {
  return (
    <ChartCard title={title} subtitle={subtitle}>
      {data.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
          {noDataLabel}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              tickFormatter={(v: string) => v.slice(5)}
              stroke="hsl(var(--muted-foreground))"
            />
            <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              labelStyle={{ fontSize: 11 }}
              itemStyle={{ fontSize: 11 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line
              type="monotone"
              dataKey="total"
              name="总计"
              stroke="hsl(var(--primary))"
              strokeWidth={1.5}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="successful"
              name="成功"
              stroke="#22c55e"
              strokeWidth={1.5}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="failed"
              name="失败"
              stroke="#ef4444"
              strokeWidth={1.5}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}