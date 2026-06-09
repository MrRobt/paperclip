import { callLlm, type LlmMessage } from "./llm-client.js";
import type { Db } from "@paperclipai/db";
import { goals, tasks } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { randomId } from "@paperclipai/shared";

export interface DecomposedTask {
  title: string;
  description: string;
  requiredSkills: string[];
  dependencies: string[];
  estimatedDuration: number;
}

export interface DecompositionResult {
  title: string;
  tasks: DecomposedTask[];
}

const VALID_SKILLS = new Set(["frontend", "backend", "database", "devops", "testing", "review"]);

const DECOMPOSE_SYSTEM_PROMPT = `你是一个高级架构师。请将以下产品目标拆解为可执行的任务列表。

要求：
1. 每个任务必须可独立完成、有明确验收标准
2. 任务之间标注依赖关系（A 完成后 B 才能开始）
3. 每个任务分配到以下技能标签之一：["frontend", "backend", "database", "devops", "testing", "review"]
4. 考虑任务并行可能性：无依赖的任务可以并行执行
5. 每个任务的 description 必须包含验收标准（用"验收："开头）

请按以下 JSON 格式输出（不要有其他内容）：
{
  "title": "目标标题",
  "tasks": [
    {
      "title": "任务标题",
      "description": "详细描述，包含验收标准",
      "requiredSkills": ["frontend"],
      "dependencies": [],
      "estimatedDuration": 60
    }
  ]
}`;

function stripJsonFence(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function normalizeTask(input: unknown, index: number): DecomposedTask {
  const task = input as Partial<DecomposedTask>;
  const title = typeof task.title === "string" && task.title.trim() ? task.title.trim() : `任务 ${index + 1}`;
  const rawDescription = typeof task.description === "string" ? task.description.trim() : "";
  const description = rawDescription.includes("验收：")
    ? rawDescription
    : `${rawDescription || title}。验收：完成该任务并通过人工或自动化检查。`;
  const skills = Array.isArray(task.requiredSkills) ? task.requiredSkills : [];
  const requiredSkills = skills
    .filter((skill): skill is string => typeof skill === "string" && VALID_SKILLS.has(skill))
    .slice(0, 3);
  const dependencies = Array.isArray(task.dependencies)
    ? task.dependencies.filter((dependency): dependency is string => typeof dependency === "string" && dependency.trim().length > 0)
    : [];
  const estimatedDuration =
    typeof task.estimatedDuration === "number" && Number.isFinite(task.estimatedDuration) && task.estimatedDuration > 0
      ? Math.round(task.estimatedDuration)
      : 60;

  return {
    title,
    description,
    requiredSkills: requiredSkills.length > 0 ? requiredSkills : ["backend"],
    dependencies,
    estimatedDuration,
  };
}

function parseDecomposition(content: string, goalDescription: string): DecompositionResult {
  try {
    const parsed = JSON.parse(stripJsonFence(content)) as Partial<DecompositionResult>;
    const taskInputs = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    const normalizedTasks = taskInputs.map((task, index) => normalizeTask(task, index));
    if (normalizedTasks.length > 0) {
      return {
        title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : goalDescription,
        tasks: normalizedTasks,
      };
    }
  } catch (err) {
    console.warn("Failed to parse LLM decomposition, using local fallback:", err instanceof Error ? err.message : err);
  }

  return {
    title: goalDescription,
    tasks: [
      {
        title: "梳理目标与验收标准",
        description: "明确目标范围、成功指标、风险和交付物。验收：产出可执行需求说明并确认验收标准。",
        requiredSkills: ["review"],
        dependencies: [],
        estimatedDuration: 60,
      },
      {
        title: "实现核心能力",
        description: "根据需求完成核心服务、接口和数据持久化。验收：核心流程可运行，错误路径有明确处理。",
        requiredSkills: ["backend"],
        dependencies: ["梳理目标与验收标准"],
        estimatedDuration: 180,
      },
      {
        title: "验证与交付",
        description: "补充测试并执行端到端验证。验收：关键路径测试通过，交付说明包含验证结果。",
        requiredSkills: ["testing"],
        dependencies: ["实现核心能力"],
        estimatedDuration: 90,
      },
    ],
  };
}

export function goalDecomposerService(db: Db) {
  return {
    /**
     * 将目标拆解为任务 DAG。
     * 1. 调用 LLM 生成任务列表
     * 2. 写入 tasks 表
     * 3. 更新 goals 表任务统计和状态
     * 4. 返回结果
     */
    decompose: async (
      companyId: string,
      goalId: string,
      goalDescription: string,
    ): Promise<{ goalId: string; taskCount: number; tasks: DecomposedTask[] }> => {
      const messages: LlmMessage[] = [
        { role: "system", content: DECOMPOSE_SYSTEM_PROMPT },
        { role: "user", content: `目标：${goalDescription}` },
      ];

      const llmResponse = await callLlm(messages);
      const result = parseDecomposition(llmResponse.content, goalDescription);

      const titleToId: Record<string, string> = {};
      for (const task of result.tasks) {
        titleToId[task.title] = `task_${randomId()}`;
      }

      const insertedTasks: DecomposedTask[] = [];
      for (const task of result.tasks) {
        const taskId = titleToId[task.title] as string;
        const dependencyIds = task.dependencies.map((dependency) => titleToId[dependency] || dependency);

        await db.insert(tasks).values({
          id: taskId,
          goalId,
          title: task.title,
          description: task.description,
          status: "todo",
          priority: 3,
          dependencies: JSON.stringify(dependencyIds),
          requiredSkills: JSON.stringify(task.requiredSkills),
          estimatedDuration: task.estimatedDuration,
          verificationCriteria: JSON.stringify([task.description]),
          attempts: 0,
          maxAttempts: 3,
        });

        insertedTasks.push(task);
      }

      await db
        .update(goals)
        .set({
          status: "executing",
          totalTasks: result.tasks.length,
          updatedAt: new Date(),
        })
        .where(eq(goals.id, goalId));

      return {
        goalId,
        taskCount: result.tasks.length,
        tasks: insertedTasks,
      };
    },
  };
}
