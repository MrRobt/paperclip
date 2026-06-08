import { describe, expect, it } from "vitest";

import { summarizeModelHealth } from "./model-health.js";
import { chooseModelFallbackPolicy } from "./model-fallback-policy.js";

describe("model health", () => {
  it("无失败事件时判定健康并继续使用主通道", () => {
    const summary = summarizeModelHealth({
      adapterType: "codex_local",
      modelId: "glm-5.1",
      events: [
        { adapterType: "codex_local", modelId: "glm-5.1", eventType: "probe_result", latencyMs: 1200 },
      ],
    });

    expect(summary.status).toBe("healthy");
    expect(summary.healthScore).toBe(100);
    expect(summary.recommendedAction).toBe("use_primary");
    expect(summary.averageLatencyMs).toBe(1200);
  });

  it("限流导致降级时建议备用模型", () => {
    const summary = summarizeModelHealth({
      adapterType: "codex_local",
      modelId: "expensive-model",
      events: [
        { adapterType: "codex_local", modelId: "expensive-model", eventType: "rate_limited", errorKind: "限流" },
        { adapterType: "codex_local", modelId: "expensive-model", eventType: "probe_result", latencyMs: 1000 },
      ],
    });

    expect(summary.status).toBe("degraded");
    expect(summary.recommendedAction).toBe("fallback_model");
    expect(summary.recentErrorKinds).toEqual(["限流"]);
  });

  it("预算硬停时禁止自动降级并转人工", () => {
    const health = summarizeModelHealth({
      adapterType: "codex_local",
      modelId: "m1",
      events: [
        { adapterType: "codex_local", modelId: "m1", eventType: "model_error", errorKind: "模型错误" },
        { adapterType: "codex_local", modelId: "m1", eventType: "timeout", errorKind: "超时" },
        { adapterType: "codex_local", modelId: "m1", eventType: "adapter_error", errorKind: "适配器错误" },
      ],
    });

    const decision = chooseModelFallbackPolicy({
      health,
      fallbackOptions: [{ adapterType: "codex_local", modelId: "cheap", priority: 1, budgetAllowed: true }],
      budgetHardStopped: true,
      approvalRequiredForFallback: false,
    });

    expect(decision.action).toBe("pause_and_escalate");
    expect(decision.reason).toContain("预算硬停");
  });

  it("选择预算允许且无需审批的备用模型", () => {
    const health = summarizeModelHealth({
      adapterType: "codex_local",
      modelId: "m1",
      events: [
        { adapterType: "codex_local", modelId: "m1", eventType: "timeout", errorKind: "超时" },
        { adapterType: "codex_local", modelId: "m1", eventType: "timeout", errorKind: "超时" },
        { adapterType: "codex_local", modelId: "m1", eventType: "model_error", errorKind: "模型错误" },
      ],
    });

    const decision = chooseModelFallbackPolicy({
      health,
      fallbackOptions: [
        { adapterType: "codex_local", modelId: "needs-approval", priority: 1, budgetAllowed: true, requiresApproval: true },
        { adapterType: "codex_local", modelId: "cheap", priority: 2, budgetAllowed: true },
      ],
      budgetHardStopped: false,
      approvalRequiredForFallback: false,
    });

    expect(decision.action).toBe("fallback");
    expect(decision.target?.modelId).toBe("cheap");
  });
});
