// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./AppErrorBoundary";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;

function ThrowingChild({ message }: { message: string }) {
  throw new Error(message);
}

function renderBoundary(message: string) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  act(() => {
    root?.render(
      <AppErrorBoundary>
        <ThrowingChild message={message} />
      </AppErrorBoundary>,
    );
  });

  return container;
}

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

describe("AppErrorBoundary", () => {
  it("renders a Chinese no-permission hint instead of a blank page for 403 errors", () => {
    const node = renderBoundary("Request failed with status code 403");

    expect(node.textContent).toContain("页面加载失败");
    expect(node.textContent).toContain("无权限访问当前公司页面");
    expect(node.textContent).toContain("请切换公司或联系管理员开通权限");
  });

  it("renders an archived-company hint for archived company route errors", () => {
    const node = renderBoundary("Company is archived and readonly");

    expect(node.textContent).toContain("公司已归档");
    expect(node.textContent).toContain("当前公司处于只读归档状态");
  });
});
