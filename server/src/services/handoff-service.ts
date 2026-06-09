import { or, desc, eq, ilike } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { handoffs } from "@paperclipai/db";
import { randomId } from "@paperclipai/shared";

export type Handoff = typeof handoffs.$inferSelect;

export type HandoffArtifactType = "code" | "document" | "test" | "other";

export interface RecordHandoffInput {
  taskId: string;
  fromAgentId?: string;
  toAgentId: string;
  artifactType: HandoffArtifactType;
  artifactPath: string;
  artifactSummary: string;
}

export function handoffService(db: Db): {
  recordHandoff(input: RecordHandoffInput): Promise<Handoff>;
  getTaskHandoffs(taskId: string): Promise<Handoff[]>;
  getAgentHandoffs(agentId: string): Promise<Handoff[]>;
} {
  return {
    async recordHandoff(input: RecordHandoffInput): Promise<Handoff> {
      const contract = JSON.stringify({
        fromAgentId: input.fromAgentId ?? null,
        toAgentId: input.toAgentId,
      });

      return db
        .insert(handoffs)
        .values({
          id: `handoff_${randomId()}`,
          taskId: input.taskId,
          artifactType: input.artifactType,
          artifactPath: input.artifactPath,
          summary: input.artifactSummary,
          contract,
          consumedBy: input.toAgentId,
          status: "ready",
        })
        .returning()
        .then((rows) => rows[0]);
    },

    async getTaskHandoffs(taskId: string): Promise<Handoff[]> {
      return db.select().from(handoffs).where(eq(handoffs.taskId, taskId)).orderBy(desc(handoffs.createdAt));
    },

    async getAgentHandoffs(agentId: string): Promise<Handoff[]> {
      return db
        .select()
        .from(handoffs)
        .where(or(eq(handoffs.consumedBy, agentId), ilike(handoffs.contract, `%\"fromAgentId\":\"${agentId}\"%`)))
        .orderBy(desc(handoffs.createdAt));
    },
  };
}
