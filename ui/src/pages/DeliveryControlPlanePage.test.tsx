// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { DeliveryControlPlanePage } from "./DeliveryControlPlanePage";

const mockApi = vi.hoisted(() => ({
  getDiagnostics: vi.fn(),
  getCommentDrafts: vi.fn(),
  getModelHealth: vi.fn(),
  replayCommentDraft: vi.fn(),
  replayCommentDraftBatch: vi.fn(),
  wakeAgents: vi.fn(),
  resolveRecoveryAction: vi.fn(),
  downgradeBlockerPolicy: vi.fn(),
}));
const mockSetBreadcrumbs = vi.hoisted(() => vi.fn());
const mockCompanyState = vi.hoisted(() => ({ selectedCompanyId: "company-1" as string | null }));

vi.mock("@/api/deliveryControlPlane", () => ({ deliveryControlPlaneApi: mockApi }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: mockSetBreadcrumbs }) }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: mockCompanyState.selectedCompanyId }) }));
vi.mock("@/lib/router", () => ({
  Link: ({ children, to, className }: { children: React.ReactNode; to: string; className?: string }) => <a href={to} className={className}>{children}</a>,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function clickButton(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes(label));
  expect(button, `button ${label}`).toBeTruthy();
  button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("DeliveryControlPlanePage", () => {
  let container: HTMLDivElement;

  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN");
    container = document.createElement("div");
    document.body.appendChild(container);
    mockCompanyState.selectedCompanyId = "company-1";
    mockApi.getDiagnostics.mockResolvedValue({
      summary: {
        headline: "控制面诊断 2 项：健康 1，可疑 0，阻塞 1，静默停滞 1。",
        counts: { total: 2, healthy: 1, suspicious: 0, blocked: 1, stalled: 1, critical: 1 },
        criticalIssueIds: ["issue-1"],
      },
      diagnostics: [
        {
          issueId: "issue-1",
          identifier: "PAP-1",
          title: "补齐交付证据",
          issueStatus: "blocked",
          assigneeAgentId: "agent-1",
          liveness: "blocked",
          severity: "critical",
          executionStatus: "lost",
          evidenceStatus: "insufficient",
          recoveryStatus: "active",
          blockerStatus: "hard",
          nextAction: "执行或复核恢复动作。",
          nextOwnerType: "agent",
          nextOwnerId: "agent-1",
          reasons: ["已有恢复动作待处理"],
          evidence: { workProductCount: 0, recoveryActionCount: 1, runId: "run-1" },
        },
      ],
      modelHealthSummaries: [{ adapterType: "claude", modelId: "sonnet", status: "degraded", healthScore: 62, recommendedAction: "fallback_model", totalEvents: 5, failureEvents: 2, timeoutEvents: 1, rateLimitedEvents: 1, fallbackAppliedEvents: 1, averageLatencyMs: 1200, recentErrorKinds: ["rate_limit"] }],
    });
    mockApi.getCommentDrafts.mockResolvedValue({
      drafts: [{ id: "draft-1", issueId: "issue-1", body: "完成证据草稿", replayStatus: "pending", replayAttemptCount: 0, createdAt: "2026-06-08T00:00:00Z" }],
    });
    mockApi.getModelHealth.mockResolvedValue({
      summaries: [{ adapterType: "codex", modelId: null, status: "healthy", healthScore: 95, recommendedAction: "use_primary", totalEvents: 2, failureEvents: 0, timeoutEvents: 0, rateLimitedEvents: 0, fallbackAppliedEvents: 0, averageLatencyMs: 800, recentErrorKinds: [] }],
      events: [],
    });
    mockApi.replayCommentDraft.mockResolvedValue({ replayedCommentId: "comment-1" });
    mockApi.replayCommentDraftBatch.mockResolvedValue({ results: [] });
    mockApi.wakeAgents.mockResolvedValue({ results: [] });
    mockApi.resolveRecoveryAction.mockResolvedValue({ action: { id: "action-1", status: "resolved" } });
    mockApi.downgradeBlockerPolicy.mockResolvedValue({ policy: { id: "policy-1", level: "soft" } });
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders all delivery control plane sections and wires core actions", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await act(async () => {
      root.render(<QueryClientProvider client={queryClient}><DeliveryControlPlanePage /></QueryClientProvider>);
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("实时交付控制台");
    expect(container.textContent).toContain("健康总览");
    expect(container.textContent).toContain("风险事项");
    expect(container.textContent).toContain("评论草稿队列");
    expect(container.textContent).toContain("恢复动作");
    expect(container.textContent).toContain("模型健康");
    expect(container.textContent).toContain("证据完整度");
    expect(container.textContent).toContain("PAP-1");
    expect(container.querySelector('a[href="/issues/issue-1"]')?.textContent).toContain("PAP-1");

    await act(async () => clickButton(container, "一键唤醒"));
    await flushReact();
    expect(mockApi.wakeAgents).toHaveBeenCalledWith("company-1", expect.objectContaining({ agentIds: ["agent-1"] }));

    await act(async () => clickButton(container, "重放全部草稿"));
    await flushReact();
    expect(mockApi.replayCommentDraftBatch).toHaveBeenCalledWith("company-1", expect.objectContaining({ draftIds: ["draft-1"] }));

    await act(async () => clickButton(container, "重放草稿"));
    await flushReact();
    expect(mockApi.replayCommentDraft).toHaveBeenCalledWith("draft-1", { force: true });

    await act(async () => clickButton(container, "执行恢复动作"));
    await flushReact();
    expect(mockApi.resolveRecoveryAction).toHaveBeenCalledWith("issue-1", expect.objectContaining({ outcome: "restored" }));

    await act(async () => clickButton(container, "阻塞降级"));
    await flushReact();
    expect(mockApi.downgradeBlockerPolicy).toHaveBeenCalledWith("issue-1", expect.objectContaining({ targetLevel: "soft" }));

    const callsBeforeRefresh = mockApi.getDiagnostics.mock.calls.length;
    await act(async () => clickButton(container, "刷新"));
    await flushReact();
    expect(mockApi.getDiagnostics.mock.calls.length).toBeGreaterThan(callsBeforeRefresh);

    await act(async () => root.unmount());
  });
});
