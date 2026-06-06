// @vitest-environment jsdom

import type { IssueDeliveryState } from "@paperclipai/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IssueDeliveryStateCard } from "./IssueDeliveryStateCard";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function state(overrides: Partial<IssueDeliveryState> = {}): IssueDeliveryState {
  return {
    platformStatus: "in_progress",
    processState: "stale",
    outputState: "no_output",
    verificationState: "unverified",
    hasCompletionEvidence: false,
    evidenceWorkProductCount: 0,
    evidenceWorkProductIds: [],
    summary: "事项标记为进行中，但没有活动运行，疑似空转。",
    ...overrides,
  };
}

describe("IssueDeliveryStateCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders layered delivery state in Chinese", () => {
    act(() => root.render(<IssueDeliveryStateCard state={state()} />));

    expect(container.querySelector('[data-testid="issue-delivery-state-card"]')).not.toBeNull();
    expect(container.textContent).toContain("交付状态");
    expect(container.textContent).toContain("事项标记为进行中，但没有活动运行，疑似空转。");
    expect(container.textContent).toContain("进程");
    expect(container.textContent).toContain("疑似空转");
    expect(container.textContent).toContain("产出");
    expect(container.textContent).toContain("无产出");
    expect(container.textContent).toContain("验收");
    expect(container.textContent).toContain("未验收");
    expect(container.textContent).toContain("完成证据：缺失");
  });

  it("shows verified evidence counts", () => {
    act(() => root.render(<IssueDeliveryStateCard state={state({
      platformStatus: "done",
      processState: "completed",
      outputState: "has_evidence",
      verificationState: "verified",
      hasCompletionEvidence: true,
      evidenceWorkProductCount: 2,
      evidenceWorkProductIds: ["wp-1", "wp-2"],
      summary: "已完成，且已绑定可复验交付证据。",
    })} />));

    expect(container.textContent).toContain("已验收");
    expect(container.textContent).toContain("完成证据：2 条");
    expect(container.textContent).toContain("可复验 work product（工作产物）已绑定");
  });
});
