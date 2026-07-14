import { logger } from "../middleware/logger.js";

// Sandbox provisioning (e2b/daytona/modal boot, image pull) is far slower than an agent
// start, so the stale escape hatch is correspondingly longer than the agent-start lock's.
const ENVIRONMENT_LEASE_LOCK_STALE_MS = 120_000;
const leaseLocksByEnvironment = new Map<string, { promise: Promise<void>; startedAtMs: number }>();

async function waitForEnvironmentLeaseLock(
  environmentId: string,
  lock: { promise: Promise<void>; startedAtMs: number },
) {
  const elapsedMs = Date.now() - lock.startedAtMs;
  const remainingMs = ENVIRONMENT_LEASE_LOCK_STALE_MS - elapsedMs;
  if (remainingMs <= 0) {
    logger.warn({ environmentId, staleMs: elapsedMs }, "environment lease lock stale; continuing lease acquire");
    return;
  }

  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  await Promise.race([
    lock.promise,
    new Promise<void>((resolve) => {
      timeout = setTimeout(() => {
        timedOut = true;
        resolve();
      }, remainingMs);
    }),
  ]);
  if (timeout) clearTimeout(timeout);

  if (timedOut) {
    logger.warn(
      { environmentId, staleMs: ENVIRONMENT_LEASE_LOCK_STALE_MS },
      "environment lease lock timed out; continuing lease acquire",
    );
  }
}

/**
 * Serialize lease acquisition per environment.
 *
 * A reuse-enabled sandbox environment is backed by a single sandbox, and the lease row that
 * marks it busy is only written *after* the provider round-trip. Without this lock two runs
 * can both observe a free environment and both be handed the same sandbox.
 */
export async function withEnvironmentLeaseLock<T>(environmentId: string, fn: () => Promise<T>) {
  const previous = leaseLocksByEnvironment.get(environmentId);
  const waitForPrevious = previous ? waitForEnvironmentLeaseLock(environmentId, previous) : Promise.resolve();
  const run = waitForPrevious.then(fn);
  const marker = run.then(
    () => undefined,
    () => undefined,
  );
  leaseLocksByEnvironment.set(environmentId, { promise: marker, startedAtMs: Date.now() });
  try {
    return await run;
  } finally {
    if (leaseLocksByEnvironment.get(environmentId)?.promise === marker) {
      leaseLocksByEnvironment.delete(environmentId);
    }
  }
}
