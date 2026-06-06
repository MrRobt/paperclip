const BASE = "/api";

function formatChineseApiError(status: number, body: unknown): string {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : null;
  const rawError = typeof record?.["error"] === "string" ? record["error"] : null;
  const operation = typeof record?.["operation"] === "string" ? record["operation"] : null;
  const reason = typeof record?.["reason"] === "string" ? record["reason"] : rawError;
  const suggestion = typeof record?.["suggestion"] === "string"
    ? record["suggestion"]
    : "请保留当前草稿，检查事项状态、阻塞项或权限后重试。";
  const code = typeof record?.["errorCode"] === "string" || typeof record?.["errorCode"] === "number"
    ? record["errorCode"]
    : status;

  return [
    `操作失败：${operation ?? rawError ?? "请求未完成"}。`,
    `原因：${reason ?? `服务器返回 ${status}。`}`,
    `建议：${suggestion}`,
    `错误码：${code}`,
  ].join("\n");
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? undefined);
  const body = init?.body;
  if (!(body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${BASE}${path}`, {
    headers,
    credentials: "include",
    ...init,
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    throw new ApiError(
      formatChineseApiError(res.status, errorBody),
      res.status,
      errorBody,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  postForm: <T>(path: string, body: FormData) =>
    request<T>(path, { method: "POST", body }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
