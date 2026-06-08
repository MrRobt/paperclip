import { timingSafeEqual } from "node:crypto";
import net from "node:net";
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { and, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { heartbeatRuns, instanceUserRoles, invites } from "@paperclipai/db";
import type { DeploymentExposure, DeploymentMode } from "@paperclipai/shared";
import { readPersistedDevServerStatus, toDevServerHealthStatus, writeDevServerRestartRequest } from "../dev-server-status.js";
import { logger } from "../middleware/logger.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { serverVersion } from "../version.js";

function shouldExposeFullHealthDetails(
  actorType: "none" | "board" | "agent" | null | undefined,
  deploymentMode: DeploymentMode,
) {
  if (deploymentMode !== "authenticated") return true;
  return actorType === "board" || actorType === "agent";
}

function hasDevServerStatusToken(providedToken: string | undefined) {
  const expectedToken = process.env.PAPERCLIP_DEV_SERVER_STATUS_TOKEN?.trim();
  const token = providedToken?.trim();
  if (!expectedToken || !token) return false;

  const expected = Buffer.from(expectedToken);
  const provided = Buffer.from(token);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

function parseDiagnosticPorts(raw: unknown) {
  const fallback = [3101, 3100, 5173, 4173];
  if (typeof raw !== "string" || raw.trim().length === 0) return fallback;
  const ports = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65_535);
  return ports.length > 0 ? Array.from(new Set(ports)) : fallback;
}

async function probeLocalPort(port: number, timeoutMs = 500) {
  return await new Promise<{ port: number; open: boolean; error?: string }>((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (open: boolean, error?: string) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve({ port, open, ...(error ? { error } : {}) });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false, "timeout"));
    socket.once("error", (error) => finish(false, (error as NodeJS.ErrnoException).code ?? error.message));
  });
}

async function countRows(db: Db, query: ReturnType<typeof sql>) {
  const result = await db.execute(query) as unknown as Array<Record<string, unknown>>;
  return Number(result[0]?.count ?? 0);
}

export function healthRoutes(
  db?: Db,
  opts: {
    deploymentMode: DeploymentMode;
    deploymentExposure: DeploymentExposure;
    authReady: boolean;
    companyDeletionEnabled: boolean;
  } = {
    deploymentMode: "local_trusted",
    deploymentExposure: "private",
    authReady: true,
    companyDeletionEnabled: true,
  },
) {
  const router = Router();

  router.get("/local-ops-diagnostic", async (req, res) => {
    const actorType = "actor" in req ? req.actor?.type : null;
    if (opts.deploymentMode === "authenticated" && actorType !== "board" && actorType !== "agent") {
      res.status(403).json({ error: "authenticated_actor_required" });
      return;
    }

    const ports = parseDiagnosticPorts(req.query.ports);
    const portChecks = await Promise.all(ports.map((port) => probeLocalPort(port)));
    const now = new Date();
    const staleOutputCutoff = new Date(now.getTime() - 20 * 60 * 1000);
    const recentCutoff = new Date(now.getTime() - 6 * 60 * 60 * 1000);

    if (!db) {
      res.json({
        status: "degraded",
        checkedAt: now.toISOString(),
        ports: portChecks,
        process: {
          pid: process.pid,
          uptimeSeconds: Math.round(process.uptime()),
        },
        database: { available: false },
        summary: "数据库不可用，仅返回本机端口和当前服务进程摘要。",
      });
      return;
    }

    try {
      await db.execute(sql`SELECT 1`);
      const [queuedRuns, runningRuns, scheduledRuns, activeIssues, recentAdapterFailures, longRunningNoOutput] = await Promise.all([
        countRows(db, sql`SELECT count(*) FROM heartbeat_runs WHERE status = 'queued'`),
        countRows(db, sql`SELECT count(*) FROM heartbeat_runs WHERE status = 'running'`),
        countRows(db, sql`SELECT count(*) FROM heartbeat_runs WHERE scheduled_retry_at IS NOT NULL AND status IN ('queued', 'running', 'failed', 'timed_out')`),
        countRows(db, sql`SELECT count(*) FROM issues WHERE status IN ('todo', 'backlog', 'in_progress', 'blocked')`),
        countRows(db, sql`SELECT count(*) FROM heartbeat_runs WHERE created_at >= ${recentCutoff} AND (status IN ('failed', 'timed_out') OR error_code IS NOT NULL)`),
        countRows(db, sql`SELECT count(*) FROM heartbeat_runs WHERE status = 'running' AND started_at < ${staleOutputCutoff} AND (last_output_at IS NULL OR last_output_at < ${staleOutputCutoff})`),
      ]);
      const activeRunRows = await db.execute(sql`
        SELECT id, agent_id, status, started_at, last_output_at, process_pid, process_group_id, liveness_state, liveness_reason, next_action
        FROM heartbeat_runs
        WHERE status IN ('queued', 'running')
        ORDER BY created_at DESC
        LIMIT 20
      `) as unknown as Array<Record<string, unknown>>;
      const recentFailureRows = await db.execute(sql`
        SELECT id, agent_id, status, error_code, error, created_at, finished_at
        FROM heartbeat_runs
        WHERE created_at >= ${recentCutoff} AND (status IN ('failed', 'timed_out') OR error_code IS NOT NULL)
        ORDER BY created_at DESC
        LIMIT 10
      `) as unknown as Array<Record<string, unknown>>;

      const recommendations = [
        longRunningNoOutput > 0 ? `${longRunningNoOutput} 个运行超过 20 分钟无输出` : null,
        queuedRuns > 10 ? `任务队列堆积：queued=${queuedRuns}` : null,
        recentAdapterFailures > 0 ? `近 6 小时适配器/运行失败 ${recentAdapterFailures} 次` : null,
        portChecks.some((port) => !port.open) ? "存在本机端口未监听" : null,
      ].filter((item): item is string => typeof item === "string");

      res.json({
        status: recommendations.length > 0 ? "attention" : "ok",
        checkedAt: now.toISOString(),
        ports: portChecks,
        process: {
          pid: process.pid,
          uptimeSeconds: Math.round(process.uptime()),
          nodeVersion: process.version,
        },
        database: { available: true },
        queues: {
          queuedRuns,
          runningRuns,
          scheduledRuns,
          activeIssues,
        },
        longRunningNoOutput,
        recentAdapterFailures,
        activeRuns: activeRunRows,
        recentFailures: recentFailureRows,
        recommendations: recommendations.length > 0
          ? recommendations
          : ["本机服务、队列和最近运行态暂未发现明显异常。"],
      });
    } catch (error) {
      logger.warn({ err: error }, "Local ops diagnostic failed");
      res.status(503).json({
        status: "unhealthy",
        checkedAt: now.toISOString(),
        ports: portChecks,
        error: "local_ops_diagnostic_failed",
      });
    }
  });

  router.post("/dev-server/restart", async (req, res) => {
    const actorType = "actor" in req ? req.actor?.type : null;
    if (opts.deploymentMode === "authenticated" && actorType !== "board") {
      res.status(403).json({ error: "board_access_required" });
      return;
    }

    const persistedDevServerStatus = readPersistedDevServerStatus();
    if (!persistedDevServerStatus) {
      res.status(404).json({ error: "dev_server_supervisor_unavailable" });
      return;
    }

    const restartRequired =
      persistedDevServerStatus.dirty ||
      persistedDevServerStatus.changedPathCount > 0 ||
      persistedDevServerStatus.pendingMigrations.length > 0;
    if (!restartRequired) {
      res.status(409).json({ error: "restart_not_required" });
      return;
    }

    const written = writeDevServerRestartRequest({
      requestedAt: new Date().toISOString(),
      reason: "manual_restart_now",
    });
    if (!written) {
      res.status(404).json({ error: "dev_server_supervisor_unavailable" });
      return;
    }

    res.status(202).json({ status: "restart_requested" });
  });

  router.get("/", async (req, res) => {
    const actorType = "actor" in req ? req.actor?.type : null;
    const exposeFullDetails = shouldExposeFullHealthDetails(
      actorType,
      opts.deploymentMode,
    );
    const exposeDevServerDetails =
      exposeFullDetails || hasDevServerStatusToken(req.get("x-paperclip-dev-server-status-token"));

    if (!db) {
      res.json(
        exposeFullDetails
          ? { status: "ok", version: serverVersion }
          : { status: "ok", deploymentMode: opts.deploymentMode },
      );
      return;
    }

    try {
      await db.execute(sql`SELECT 1`);
    } catch (error) {
      logger.warn({ err: error }, "Health check database probe failed");
      res.status(503).json({
        status: "unhealthy",
        version: serverVersion,
        error: "database_unreachable"
      });
      return;
    }

    let bootstrapStatus: "ready" | "bootstrap_pending" = "ready";
    let bootstrapInviteActive = false;
    if (opts.deploymentMode === "authenticated") {
      const roleCount = await db
        .select({ count: count() })
        .from(instanceUserRoles)
        .where(sql`${instanceUserRoles.role} = 'instance_admin'`)
        .then((rows) => Number(rows[0]?.count ?? 0));
      bootstrapStatus = roleCount > 0 ? "ready" : "bootstrap_pending";

      if (bootstrapStatus === "bootstrap_pending") {
        const now = new Date();
        const inviteCount = await db
          .select({ count: count() })
          .from(invites)
          .where(
            and(
              eq(invites.inviteType, "bootstrap_ceo"),
              isNull(invites.revokedAt),
              isNull(invites.acceptedAt),
              gt(invites.expiresAt, now),
            ),
          )
          .then((rows) => Number(rows[0]?.count ?? 0));
        bootstrapInviteActive = inviteCount > 0;
      }
    }

    const persistedDevServerStatus = readPersistedDevServerStatus();
    let devServer: ReturnType<typeof toDevServerHealthStatus> | undefined;
    if (exposeDevServerDetails && persistedDevServerStatus && typeof (db as { select?: unknown }).select === "function") {
      const instanceSettings = instanceSettingsService(db);
      const experimentalSettings = await instanceSettings.getExperimental();
      const activeRunCount = await db
        .select({ count: count() })
        .from(heartbeatRuns)
        .where(inArray(heartbeatRuns.status, ["queued", "running"]))
        .then((rows) => Number(rows[0]?.count ?? 0));

      devServer = toDevServerHealthStatus(persistedDevServerStatus, {
        autoRestartEnabled: experimentalSettings.autoRestartDevServerWhenIdle ?? false,
        activeRunCount,
      });
    }

    if (!exposeFullDetails) {
      res.json({
        status: "ok",
        deploymentMode: opts.deploymentMode,
        deploymentExposure: opts.deploymentExposure,
        bootstrapStatus,
        bootstrapInviteActive,
        ...(devServer ? { devServer } : {}),
      });
      return;
    }

    res.json({
      status: "ok",
      version: serverVersion,
      deploymentMode: opts.deploymentMode,
      deploymentExposure: opts.deploymentExposure,
      authReady: opts.authReady,
      bootstrapStatus,
      bootstrapInviteActive,
      features: {
        companyDeletionEnabled: opts.companyDeletionEnabled,
      },
      ...(devServer ? { devServer } : {}),
    });
  });

  return router;
}
