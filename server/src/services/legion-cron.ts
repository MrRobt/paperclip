import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { tasks } from "@paperclipai/db";
import { taskSchedulerService } from "./task-scheduler.js";

export interface LegionHeartbeatResult {
  dispatched: string[];
  assignedToAgent: Array<typeof tasks.$inferSelect>;
}

export async function handleLegionHeartbeat(agentId: string, db: Db): Promise<void> {
  await legionHeartbeatHandler(agentId, db);
}

export async function legionHeartbeatHandler(agentId: string, db: Db): Promise<LegionHeartbeatResult> {
  const scheduler = taskSchedulerService(db);
  const dispatchResult = await scheduler.tick();

  const assignedToAgent = dispatchResult.dispatched.length === 0
    ? []
    : await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.assigneeAgentId, agentId), inArray(tasks.id, dispatchResult.dispatched)));

  if (assignedToAgent.length > 0) {
    console.info("legion heartbeat assigned tasks", {
      agentId,
      taskIds: assignedToAgent.map((task) => task.id),
    });
  }

  return {
    dispatched: dispatchResult.dispatched,
    assignedToAgent,
  };
}
