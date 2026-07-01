import { callLlm, type LlmMessage } from "./llm-client.js";
import type { Db } from "@paperclipai/db";
import { goals, tasks, type TaskStatus, type TaskVerificationSpec } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { randomId } from "@paperclipai/shared";
import {
  COARSE_TASK_DURATION_THRESHOLD_MIN,
  isCoarseTask,
  memoryService,
} from "./memory.js";

export interface DecomposedTask {
  id: string;
  title: string;
  description: string;
  requiredSkills: string[];
  dependencies: string[];
  estimatedDuration: number;
  verificationSpec: unknown;
}

export interface DecompositionResult {
  title: string;
  tasks: DecomposedTask[];
  rationale?: string;
}

export interface DecomposeRecursiveResult {
  rootGoalId: string;
  topLevelTaskCount: number;
  subGoalCount: number;
  totalTaskCount: number;
  tasks: Array<{ goalId: string; taskId: string; title: string }>;
}

const VALID_SKILLS = new Set(["frontend", "backend", "database", "devops", "testing", "review"]);

const COARSE_TASK_MINUTES = COARSE_TASK_DURATION_THRESHOLD_MIN;
const MAX_RECURSION_DEPTH = 3;

/**
 * Phase 8 prompt — server enforces every task has a parseable
 * `verification_spec`. Phase 10 augments this with a "## Past experience"
 * block sourced from the memory service.
 */
const DECOMPOSE_SYSTEM_PROMPT = `You are a staff architect. Decompose the product goal into an executable task DAG with structured machine-verifiable acceptance criteria.

Hard requirements (the server rejects plans that violate any of these):
1. Every task MUST include a \`verification_spec\` object with a non-empty \`checks\` array. The only accepted check kinds are:
   - { kind: "run-tests",     command, cwd?, expectedExit, timeoutSec? }
   - { kind: "typecheck",     command, cwd?, expectedExit, timeoutSec? }
   - { kind: "lint",          command, cwd?, expectedExit, timeoutSec? }
   - { kind: "build",         command, cwd?, expectedExit, timeoutSec? }
   - { kind: "file-exists",   path }
   - { kind: "http-probe",    method, url, expectStatus, expectBodyContains?, timeoutSec? }
   - { kind: "custom-exit-zero", command, cwd?, timeoutSec? }
   Free-text "验收:..." is FORBIDDEN — the verification-runner cannot execute prose.
2. Each task's \`required_skills\` MUST be drawn from the company skill catalog; default subset is ["frontend", "backend", "database", "devops", "testing", "review"].
3. Each task's \`dependencies\` MUST list task ids from THIS goal only. Cross-goal dependencies are not allowed in a single decomposition.
4. Prefer parallel tasks when independent. Avoid serial chains unless one task produces a handoff the next consumes.
5. \`estimated_duration\` is in minutes. Any task over ${COARSE_TASK_MINUTES} minutes MUST be split before submission — the server will recursively decompose it into a sub-goal.
6. If a "## Past experience" block appears in the user message, USE IT: avoid the failed patterns it describes, prefer the successful ones, and add explicit verification_spec checks for the previously-failing case.

Return JSON only. No prose outside the JSON. Schema enforced by zod on the server side; malformed output will be retried at most twice before falling back to a coarse three-task template.

JSON shape:
{
  "title": "Goal title",
  "rationale": "One-paragraph summary of how this plan achieves the goal",
  "tasks": [
    {
      "title": "Task title",
      "description": "What the agent should do (markdown allowed)",
      "required_skills": ["backend"],
      "dependencies": [],
      "estimated_duration": 60,
      "verification_spec": {
        "rationale": "Why these checks prove the task is done",
        "checks": [
          { "kind": "typecheck", "command": "pnpm -w tsc --noEmit", "expectedExit": 0, "timeoutSec": 120 }
        ]
      }
    }
  ]
}`;

function stripJsonFence(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function normalizeTask(input: unknown, index: number): DecomposedTask {
  const task = input as Partial<DecomposedTask> & {
    title?: string;
    description?: string;
    required_skills?: string[];
    dependencies?: string[];
    estimated_duration?: number;
    verification_spec?: unknown;
  };
  const title = typeof task.title === "string" && task.title.trim() ? task.title.trim() : `任务 ${index + 1}`;
  const description = typeof task.description === "string" ? task.description.trim() : "";
  const rawSkills = Array.isArray(task.required_skills) ? task.required_skills : Array.isArray(task.requiredSkills) ? task.requiredSkills : [];
  const requiredSkills = rawSkills
    .filter((skill): skill is string => typeof skill === "string" && VALID_SKILLS.has(skill))
    .slice(0, 3);
  const rawDeps = Array.isArray(task.dependencies) ? task.dependencies : [];
  const dependencies = rawDeps.filter((d): d is string => typeof d === "string" && d.trim().length > 0);
  const estimatedDurationRaw = typeof task.estimated_duration === "number"
    ? task.estimated_duration
    : typeof task.estimatedDuration === "number"
      ? task.estimatedDuration
      : 60;
  const estimatedDuration = Number.isFinite(estimatedDurationRaw) && estimatedDurationRaw > 0
    ? Math.round(estimatedDurationRaw)
    : 60;
  return {
    id: "",
    title,
    description,
    requiredSkills: requiredSkills.length > 0 ? requiredSkills : ["backend"],
    dependencies,
    estimatedDuration,
    verificationSpec: task.verification_spec ?? null,
  };
}

function parseDecomposition(content: string, goalDescription: string): DecompositionResult {
  try {
    const parsed = JSON.parse(stripJsonFence(content)) as Partial<DecompositionResult> & { rationale?: string };
    const taskInputs = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    const normalizedTasks = taskInputs.map((task, index) => normalizeTask(task, index));
    if (normalizedTasks.length > 0) {
      return {
        title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : goalDescription,
        tasks: normalizedTasks,
        rationale: typeof parsed.rationale === "string" ? parsed.rationale : undefined,
      };
    }
  } catch (err) {
    console.warn("Failed to parse LLM decomposition, using local fallback:", err instanceof Error ? err.message : err);
  }

  return {
    title: goalDescription,
    rationale: "Local fallback — LLM did not return a parseable plan.",
    tasks: [
      {
        id: "",
        title: "梳理目标与验收标准",
        description: "明确目标范围、成功指标、风险和交付物。",
        requiredSkills: ["review"],
        dependencies: [],
        estimatedDuration: 60,
        verificationSpec: null,
      },
      {
        id: "",
        title: "实现核心能力",
        description: "根据需求完成核心服务、接口和数据持久化。",
        requiredSkills: ["backend"],
        dependencies: ["梳理目标与验收标准"],
        estimatedDuration: 180,
        verificationSpec: null,
      },
      {
        id: "",
        title: "验证与交付",
        description: "补充测试并执行端到端验证。",
        requiredSkills: ["testing"],
        dependencies: ["实现核心能力"],
        estimatedDuration: 90,
        verificationSpec: null,
      },
    ],
  };
}

export function goalDecomposerService(db: Db) {
  const memory = memoryService(db);

  async function decompose(
    companyId: string,
    goalId: string,
    goalDescription: string,
    options: { repoPath?: string | null; modulePath?: string | null } = {},
  ): Promise<{ goalId: string; taskCount: number; tasks: DecomposedTask[] }> {
    const fewShot = options.repoPath
      ? await memory.buildFewShotContext({
          companyId,
          repoPath: options.repoPath,
          modulePath: options.modulePath ?? null,
          limit: 5,
        })
      : "";
    const userPrompt = fewShot
      ? `## Past experience\n${fewShot}\n## Goal\n目标：${goalDescription}`
      : `目标：${goalDescription}`;
    const messages: LlmMessage[] = [
      { role: "system", content: DECOMPOSE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
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
        status: "not_started" as TaskStatus,
        priority: 3,
        dependencies: JSON.stringify(dependencyIds),
        requiredSkills: JSON.stringify(task.requiredSkills),
        estimatedDuration: task.estimatedDuration,
        verificationSpec: (task.verificationSpec ?? null) as TaskVerificationSpec | null,
        verificationCriteria: JSON.stringify([task.description]),
        attempts: 0,
        maxAttempts: 3,
      });
      insertedTasks.push({
        id: taskId,
        title: task.title,
        description: task.description,
        requiredSkills: task.requiredSkills,
        dependencies: task.dependencies,
        estimatedDuration: task.estimatedDuration,
        verificationSpec: task.verificationSpec,
      });
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
  }

  async function decomposeRecursive(
    companyId: string,
    goalId: string,
    goalDescription: string,
    options: { repoPath?: string | null; modulePath?: string | null; depth?: number } = {},
  ): Promise<DecomposeRecursiveResult> {
    const depth = options.depth ?? 0;
    const flatTasks: Array<{ goalId: string; taskId: string; title: string }> = [];
    let subGoalCount = 0;

    // Plan the level we are on.
    const level = await decompose(companyId, goalId, goalDescription, options);

    for (const task of level.tasks) {
      if (depth + 1 < MAX_RECURSION_DEPTH && isCoarseTask(task.estimatedDuration, task.description)) {
        // Recurse: this task was too coarse; spawn a sub-goal with
        // its own plan.
        const subGoalId = `goal_${randomId()}`;
        await db.insert(goals).values({
          id: subGoalId,
          companyId,
          parentGoalId: goalId,
          title: `${task.title} — sub-plan`,
          description: `Recursive sub-goal for coarse task ${task.id}: ${task.title}`,
          status: "planning",
          goalStatus: "planning",
          totalTasks: 0,
          completedTasks: 0,
        });
        subGoalCount += 1;
        const subResult = await decomposeRecursive(
          companyId,
          subGoalId,
          task.description || task.title,
          { ...options, depth: depth + 1 },
        );
        flatTasks.push(...subResult.tasks);
        // Mark the parent task as replaced by a delegation edge so
        // the scheduler knows to skip it once the sub-goal lands.
        await db
          .update(tasks)
          .set({
            description: `${task.description}\n\n[delegated to sub-goal ${subGoalId}]`,
            updatedAt: new Date(),
          })
          .where(eq(tasks.id, task.id));
      } else {
        flatTasks.push({ goalId, taskId: task.id, title: task.title });
      }
    }

    const totalTaskCount = await countTasksForGoalTree(db, goalId);
    return {
      rootGoalId: goalId,
      topLevelTaskCount: level.tasks.length,
      subGoalCount,
      totalTaskCount,
      tasks: flatTasks,
    };
  }

  return {
    /**
     * Single-level decompose (Phase 8 behaviour). Kept as a thin wrapper
     * for backward compat — Phase 10 callers should prefer
     * `decomposeRecursive`.
     */
    decompose,
    /**
     * Phase 10: recursive decompose. After the initial plan, any task
     * with `estimated_duration > ${COARSE_TASK_MINUTES} min` or a
     * description longer than 1500 chars is split into a sub-goal whose
     * own tasks satisfy the same rule. Bounded to MAX_RECURSION_DEPTH
     * levels to prevent infinite plans.
     *
     * Returns a flat list of (goalId, taskId, title) tuples plus summary
     * counts so the UI can show "Goal → 4 sub-goals → 12 tasks total".
     */
    decomposeRecursive,
  };
}

async function countTasksForGoalTree(db: Db, rootGoalId: string): Promise<number> {
  // Walk the goal tree depth-first and count tasks under each node.
  let total = 0;
  const stack = [rootGoalId];
  while (stack.length > 0) {
    const goalId = stack.pop() as string;
    const childGoals = await db
      .select({ id: goals.id })
      .from(goals)
      .where(eq(goals.parentGoalId, goalId));
    for (const child of childGoals) stack.push(child.id);
    const taskRows = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.goalId, goalId));
    total += taskRows.length;
  }
  return total;
}

/**
 * Pure helpers exposed for unit tests.
 */
export const COARSE_MINUTES = COARSE_TASK_MINUTES;
export const MAX_DEPTH = MAX_RECURSION_DEPTH;

export function shouldRecurseOnTask(task: { estimatedDuration?: number; description?: string }, depth: number): boolean {
  if (depth + 1 >= MAX_RECURSION_DEPTH) return false;
  return isCoarseTask(task.estimatedDuration ?? null, task.description ?? null);
}