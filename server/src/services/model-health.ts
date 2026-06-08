export type ModelHealthEventType =
  | "adapter_error"
  | "model_error"
  | "timeout"
  | "rate_limited"
  | "budget_stopped"
  | "fallback_selected"
  | "probe_result";

export interface ModelHealthEventLike {
  adapterType: string;
  modelId?: string | null;
  eventType: ModelHealthEventType | string;
  errorKind?: string | null;
  latencyMs?: number | null;
  fallbackApplied?: boolean | null;
  createdAt?: Date | string | null;
}

export interface ModelHealthSummary {
  adapterType: string;
  modelId: string | null;
  totalEvents: number;
  failureEvents: number;
  timeoutEvents: number;
  rateLimitedEvents: number;
  fallbackAppliedEvents: number;
  averageLatencyMs: number | null;
  healthScore: number;
  status: "healthy" | "degraded" | "unhealthy";
  recommendedAction: "use_primary" | "retry_primary" | "fallback_model" | "pause_and_escalate";
  recentErrorKinds: string[];
}

const FAILURE_EVENT_TYPES = new Set<string>([
  "adapter_error",
  "model_error",
  "timeout",
  "rate_limited",
  "budget_stopped",
]);

export function summarizeModelHealth(input: {
  adapterType: string;
  modelId?: string | null;
  events: readonly ModelHealthEventLike[];
}): ModelHealthSummary {
  const scoped = input.events.filter(
    (event) => event.adapterType === input.adapterType && (event.modelId ?? null) === (input.modelId ?? null),
  );
  const totalEvents = scoped.length;
  const failureEvents = scoped.filter((event) => FAILURE_EVENT_TYPES.has(event.eventType)).length;
  const timeoutEvents = scoped.filter((event) => event.eventType === "timeout").length;
  const rateLimitedEvents = scoped.filter((event) => event.eventType === "rate_limited").length;
  const fallbackAppliedEvents = scoped.filter((event) => event.fallbackApplied).length;
  const latencies = scoped
    .map((event) => event.latencyMs)
    .filter((latency): latency is number => typeof latency === "number" && Number.isFinite(latency) && latency >= 0);
  const averageLatencyMs = latencies.length > 0
    ? Math.round(latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length)
    : null;

  const failureRate = totalEvents === 0 ? 0 : failureEvents / totalEvents;
  const timeoutPenalty = totalEvents === 0 ? 0 : timeoutEvents / totalEvents;
  const rateLimitPenalty = totalEvents === 0 ? 0 : rateLimitedEvents / totalEvents;
  const healthScore = Math.max(0, Math.round(100 - failureRate * 70 - timeoutPenalty * 20 - rateLimitPenalty * 10));
  const status = healthScore >= 80 ? "healthy" : healthScore >= 50 ? "degraded" : "unhealthy";
  const recommendedAction = chooseModelHealthAction({ status, timeoutEvents, rateLimitedEvents, failureEvents });
  const recentErrorKinds = Array.from(
    new Set(
      scoped
        .filter((event) => FAILURE_EVENT_TYPES.has(event.eventType))
        .map((event) => event.errorKind?.trim())
        .filter((kind): kind is string => Boolean(kind)),
    ),
  ).slice(0, 5);

  return {
    adapterType: input.adapterType,
    modelId: input.modelId ?? null,
    totalEvents,
    failureEvents,
    timeoutEvents,
    rateLimitedEvents,
    fallbackAppliedEvents,
    averageLatencyMs,
    healthScore,
    status,
    recommendedAction,
    recentErrorKinds,
  };
}

function chooseModelHealthAction(input: {
  status: ModelHealthSummary["status"];
  timeoutEvents: number;
  rateLimitedEvents: number;
  failureEvents: number;
}): ModelHealthSummary["recommendedAction"] {
  if (input.status === "healthy") return "use_primary";
  if (input.status === "degraded" && input.rateLimitedEvents > 0) return "fallback_model";
  if (input.status === "degraded") return "retry_primary";
  if (input.timeoutEvents > 0 || input.failureEvents >= 3) return "fallback_model";
  return "pause_and_escalate";
}

export function shouldRecordModelHealthEvent(input: {
  eventType: string;
  errorSummary?: string | null;
}): boolean {
  if (FAILURE_EVENT_TYPES.has(input.eventType)) return true;
  if (input.eventType === "fallback_selected") return true;
  return Boolean(input.errorSummary?.trim());
}
