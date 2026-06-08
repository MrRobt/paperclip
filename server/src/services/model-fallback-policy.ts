import type { ModelHealthSummary } from "./model-health.js";

export interface ModelFallbackOption {
  adapterType: string;
  modelId: string | null;
  priority: number;
  budgetAllowed: boolean;
  requiresApproval?: boolean;
}

export interface ModelFallbackDecision {
  action: "none" | "retry_primary" | "fallback" | "pause_and_escalate";
  target: ModelFallbackOption | null;
  reason: string;
}

export function chooseModelFallbackPolicy(input: {
  health: ModelHealthSummary;
  fallbackOptions: readonly ModelFallbackOption[];
  budgetHardStopped: boolean;
  approvalRequiredForFallback: boolean;
}): ModelFallbackDecision {
  if (input.budgetHardStopped) {
    return {
      action: "pause_and_escalate",
      target: null,
      reason: "预算硬停已触发，禁止自动重试或降级，需转人工处理。",
    };
  }

  if (input.health.recommendedAction === "use_primary") {
    return { action: "none", target: null, reason: "主模型健康，继续使用当前通道。" };
  }

  if (input.health.recommendedAction === "retry_primary") {
    return { action: "retry_primary", target: null, reason: "模型通道轻微降级，先重试主通道。" };
  }

  const candidates = input.fallbackOptions
    .filter((option) => option.budgetAllowed)
    .filter((option) => !(input.approvalRequiredForFallback || option.requiresApproval))
    .sort((a, b) => a.priority - b.priority);

  if (input.health.recommendedAction === "fallback_model" && candidates[0]) {
    return {
      action: "fallback",
      target: candidates[0],
      reason: "主模型失败率较高，选择预算允许且无需审批的备用通道。",
    };
  }

  return {
    action: "pause_and_escalate",
    target: null,
    reason: "没有安全可自动执行的备用模型，生成恢复动作并转主控处理。",
  };
}
