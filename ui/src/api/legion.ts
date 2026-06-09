import { api } from "./client";

export interface LegionTask {
  id: string;
  goalId: string;
  title: string;
  description: string | null;
  status: string;
  priority: number | null;
  dependencies: string | null;
  requiredSkills: string | null;
  estimatedDuration: number | null;
  assigneeAgentId: string | null;
  verificationCriteria: string | null;
  attempts: number | null;
  maxAttempts: number | null;
  verificationResult: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  goal?: { id: string; title: string; description: string | null; companyId: string; status: string };
}

export interface LegionHandoff {
  id: string;
  taskId: string;
  artifactType: string;
  artifactPath: string;
  summary: string | null;
  contract: string | null;
  status: string | null;
  consumedBy: string | null;
  createdAt: string;
  consumedAt: string | null;
}

export interface LegionHealth {
  goals: { total: number; executing: number; completed: number; failed: number };
  tasks: { total: number; todo: number; inProgress: number; done: number; failed: number; timedOut: number };
  agents: { total: number; active: number };
}

export const legionApi = {
  decomposeGoal: (companyId: string, goalId: string, description: string) =>
    api.post<{ tasks?: LegionTask[]; taskList?: LegionTask[]; [key: string]: unknown }>("/goals/decompose", { companyId, goalId, description }),
  getGoalTasks: (goalId: string) => api.get<LegionTask[]>(`/goals/${goalId}/tasks`),
  listTasks: (companyId?: string) => api.get<LegionTask[]>(`/legion/tasks${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""}`),
  getTask: (taskId: string) => api.get<LegionTask>(`/tasks/${taskId}`),
  updateTaskStatus: (taskId: string, status: string) => api.patch<LegionTask>(`/tasks/${taskId}/status`, { status }),
  verifyTask: (taskId: string) => api.post<{ task: LegionTask; verification: unknown }>(`/tasks/${taskId}/verify`, {}),
  reassignTask: (taskId: string, agentId: string) => api.post<LegionTask>(`/tasks/${taskId}/reassign`, { agentId }),
  getTaskHandoffs: (taskId: string) => api.get<LegionHandoff[]>(`/tasks/${taskId}/handoffs`),
  getLegionHealth: () => api.get<LegionHealth>("/legion/health"),
};
