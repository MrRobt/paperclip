export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmResponse {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

type HermesChatResponse = {
  content?: unknown;
  message?: { content?: unknown };
  choices?: Array<{ message?: { content?: unknown }; text?: unknown }>;
  usage?: {
    inputTokens?: unknown;
    outputTokens?: unknown;
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
  };
};

const HERMES_BASE_URL = process.env.HERMES_GATEWAY_URL ?? "http://127.0.0.1:18765";

function buildMockDecomposition(goalDescription: string): LlmResponse {
  const trimmedGoal = goalDescription.trim() || "实现产品目标";
  return {
    content: JSON.stringify({
      title: trimmedGoal.length > 80 ? `${trimmedGoal.slice(0, 77)}...` : trimmedGoal,
      tasks: [
        {
          title: "梳理需求与验收标准",
          description: `明确目标范围、用户场景、边界条件和验收口径。验收：形成包含范围、非目标、验收标准和风险列表的需求说明，并获得相关方确认。`,
          requiredSkills: ["review"],
          dependencies: [],
          estimatedDuration: 60,
        },
        {
          title: "设计技术方案与数据模型",
          description: "基于需求设计接口、数据结构、权限和错误处理策略。验收：方案文档覆盖接口契约、数据模型、迁移方案和回滚策略。",
          requiredSkills: ["backend"],
          dependencies: ["梳理需求与验收标准"],
          estimatedDuration: 90,
        },
        {
          title: "实现后端服务与 API",
          description: "实现核心业务逻辑、持久化和 HTTP API。验收：接口可按方案创建、查询和更新核心数据，并对无效输入返回明确错误。",
          requiredSkills: ["backend"],
          dependencies: ["设计技术方案与数据模型"],
          estimatedDuration: 180,
        },
        {
          title: "实现前端交互入口",
          description: "实现用户触发目标流程、查看结果和错误提示的界面。验收：用户可在界面提交目标并查看任务拆解结果、加载态和失败态。",
          requiredSkills: ["frontend"],
          dependencies: ["设计技术方案与数据模型"],
          estimatedDuration: 150,
        },
        {
          title: "补充自动化测试与回归验证",
          description: "覆盖关键服务、路由、权限和失败降级路径。验收：新增测试覆盖成功、参数缺失、权限拒绝和 LLM 降级场景，且测试套件通过。",
          requiredSkills: ["testing"],
          dependencies: ["实现后端服务与 API", "实现前端交互入口"],
          estimatedDuration: 120,
        },
      ],
    }),
    usage: {
      inputTokens: 0,
      outputTokens: 0,
    },
  };
}

function getLastUserMessage(messages: LlmMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
}

function extractResponse(payload: HermesChatResponse): LlmResponse | null {
  const content =
    payload.choices?.[0]?.message?.content ??
    payload.choices?.[0]?.text ??
    payload.message?.content ??
    payload.content;

  if (typeof content !== "string" || content.trim().length === 0) {
    return null;
  }

  const inputTokens = payload.usage?.inputTokens ?? payload.usage?.prompt_tokens;
  const outputTokens = payload.usage?.outputTokens ?? payload.usage?.completion_tokens;

  return {
    content,
    usage:
      typeof inputTokens === "number" || typeof outputTokens === "number"
        ? {
            inputTokens: typeof inputTokens === "number" ? inputTokens : 0,
            outputTokens: typeof outputTokens === "number" ? outputTokens : 0,
          }
        : undefined,
  };
}

async function postJson(url: string, body: unknown): Promise<LlmResponse | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as HermesChatResponse;
    return extractResponse(payload);
  } catch (err) {
    console.warn(`LLM request failed for ${url}:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 通过 Hermes 网关调用 LLM。
 * Hermes gateway 默认在 http://127.0.0.1:18765 提供 HTTP API。
 * 如果网关或端点不可用，返回结构化 mock 结果以便开发测试。
 */
export async function callLlm(messages: LlmMessage[], model = "hermes-default"): Promise<LlmResponse> {
  const requestBody = { model, messages };
  const endpointCandidates = [`${HERMES_BASE_URL}/chat`, `${HERMES_BASE_URL}/v1/chat/completions`];

  for (const endpoint of endpointCandidates) {
    const response = await postJson(endpoint, requestBody);
    if (response) {
      return response;
    }
  }

  return buildMockDecomposition(getLastUserMessage(messages).replace(/^目标：/, ""));
}
