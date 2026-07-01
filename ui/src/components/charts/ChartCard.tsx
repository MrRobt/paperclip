/**
 * Phase 30 — recharts wrapper with consistent card styling.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}

export function ChartCard({ title, subtitle, children, className }: ChartCardProps) {
  return (
    <div className={cn("rounded-lg border bg-card p-4", className)}>
      <div className="mb-1 text-xs font-medium text-foreground">{title}</div>
      {subtitle && <div className="mb-3 text-xs text-muted-foreground">{subtitle}</div>}
      {children}
    </div>
  );
}