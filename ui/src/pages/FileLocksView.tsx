/**
 * Phase 18 of doc/plans/2026-07-01-orchestrator-control-plane.md.
 *
 * `/file-locks` — file-level lock inspector. Lists every active
 * exclusive + shared lock across the company; groups by file path so
 * conflicts surface at a glance.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "@/i18n";
import { Lock } from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { useToastActions } from "../context/ToastContext";
import { orchestratorApi, type FileLockRow } from "../api/orchestrator";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function FileLocksViewPage() {
  const { t } = useTranslation();
  const { selectedCompanyId } = useCompany();
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();

  const [taskFilter, setTaskFilter] = useState("");
  const [fileFilter, setFileFilter] = useState("");

  const locksQuery = useQuery({
    queryKey: ["file-locks", selectedCompanyId, taskFilter, fileFilter],
    queryFn: () =>
      orchestratorApi.listFileLocks({
        taskId: taskFilter || undefined,
        filePath: fileFilter || undefined,
      }),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
  });

  const grouped = useMemo(() => groupByFile(locksQuery.data ?? []), [locksQuery.data]);

  const releaseMutation = useMutation({
    mutationFn: (input: { taskId: string; files?: string[]; reason?: string }) =>
      orchestratorApi.releaseFileLocks(input),
    onSuccess: (result) => {
      pushToast({
        title: t("fileLocks.releaseSucceeded"),
        body: t("fileLocks.releaseCount", { count: result.released.length }),
        tone: "success",
      });
      queryClient.invalidateQueries({ queryKey: ["file-locks"] });
    },
    onError: (err) => {
      pushToast({
        title: t("fileLocks.releaseFailed"),
        body: err instanceof Error ? err.message : String(err),
        tone: "error",
      });
    },
  });

  if (!selectedCompanyId) {
    return (
      <div className="p-6">
        <EmptyState icon={Lock} message={t("fileLocks.noCompanySelected")} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t("fileLocks.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("fileLocks.subtitle")}</p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t("fileLocks.filterTask")}</span>
          <Input
            value={taskFilter}
            onChange={(e) => setTaskFilter(e.target.value)}
            placeholder={t("fileLocks.taskIdPlaceholder")}
            className="w-72"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t("fileLocks.filterFile")}</span>
          <Input
            value={fileFilter}
            onChange={(e) => setFileFilter(e.target.value)}
            placeholder={t("fileLocks.filePathPlaceholder")}
            className="w-96"
          />
        </label>
        <Button
          variant="outline"
          onClick={() => {
            setTaskFilter("");
            setFileFilter("");
          }}
        >
          {t("fileLocks.clearFilters")}
        </Button>
      </div>

      {locksQuery.isLoading ? (
        <PageSkeleton variant="list" />
      ) : grouped.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          {t("fileLocks.empty")}
        </div>
      ) : (
        <ul className="space-y-3">
          {grouped.map(({ filePath, locks }) => {
            const conflict = locks.some((l) => l.lockType === "exclusive") && locks.length > 1;
            return (
              <li key={filePath} className="rounded-lg border bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-sm">{filePath}</code>
                      {conflict ? (
                        <span className="rounded border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs text-rose-700">
                          {t("fileLocks.conflict")}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {t("fileLocks.holders", { count: locks.length })}
                    </div>
                  </div>
                </div>
                <div className="mt-3 divide-y">
                  {locks.map((lock) => (
                    <LockRow
                      key={lock.id}
                      lock={lock}
                      onRelease={(reason) =>
                        releaseMutation.mutate({
                          taskId: lock.taskId,
                          files: [lock.filePath],
                          reason,
                        })
                      }
                    />
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function LockRow({ lock, onRelease }: { lock: FileLockRow; onRelease: (reason: string) => void }) {
  const tone =
    lock.lockType === "exclusive"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-blue-50 text-blue-700 border-blue-200";
  const expiresAt = new Date(lock.expiresAt);
  const expired = expiresAt.getTime() < Date.now();
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="flex items-center gap-3 text-sm">
        <span className={cn("rounded border px-2 py-0.5 text-xs", tone)}>{lock.lockType}</span>
        <code className="font-mono text-xs text-muted-foreground">{lock.taskId}</code>
        <code className="font-mono text-xs text-muted-foreground">{lock.agentId}</code>
        {expired ? (
          <span className="rounded border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs text-rose-700">
            expired
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          expires {expiresAt.toLocaleString()}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onRelease("manual_release")}
        >
          Release
        </Button>
      </div>
    </div>
  );
}

interface FileGroup {
  filePath: string;
  locks: FileLockRow[];
}

function groupByFile(rows: FileLockRow[]): FileGroup[] {
  const map = new Map<string, FileLockRow[]>();
  for (const row of rows) {
    if (!map.has(row.filePath)) map.set(row.filePath, []);
    map.get(row.filePath)!.push(row);
  }
  return Array.from(map.entries())
    .map(([filePath, locks]) => ({ filePath, locks }))
    .sort((a, b) => a.filePath.localeCompare(b.filePath));
}