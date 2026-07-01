import type {
  TaskAcceptanceCriteria,
  TaskIOMap,
  TaskRetryStrategy,
  TaskVerificationSpec,
} from "@paperclipai/db";

/**
 * Phase 16/19 of doc/plans/2026-07-01-orchestrator-control-plane.md.
 *
 * Renders the structured task template that the orchestrator injects
 * into `tasks.description` for every newly-dispatched task. The template
 * carries the 9 required fields (objective / non-objectives / inputs /
 * outputs / files_in_scope / files_out_of_scope / acceptance / evidence
 * / downstream_owner) into the agent's heartbeat context.
 */

export interface TaskTemplateInput {
  objective: string;
  nonObjectives?: string[];
  inputs?: TaskIOMap;
  outputs?: TaskIOMap;
  filesInScope?: string[];
  filesOutOfScope?: string[];
  acceptanceCriteria?: TaskAcceptanceCriteria;
  verificationSpec?: TaskVerificationSpec;
  evidencePaths?: string[];
  evidenceSummary?: string;
  downstreamOwnerAgentId?: string | null;
  retryStrategy?: TaskRetryStrategy;
}

export function renderTaskTemplate(input: TaskTemplateInput): string {
  const sections: string[] = [];
  sections.push(`# Task brief\n`);

  sections.push(`## Objective\n${input.objective}\n`);

  if (input.nonObjectives && input.nonObjectives.length > 0) {
    sections.push(`## Non-objectives\n${input.nonObjectives.map((n) => `- ${n}`).join("\n")}\n`);
  }

  if (input.inputs && input.inputs.inputs.length > 0) {
    sections.push(`## Inputs\n${input.inputs.inputs.map((i) => `- [${i.kind}] ${i.ref}${i.note ? ` — ${i.note}` : ""}`).join("\n")}\n`);
  }

  if (input.outputs && input.outputs.outputs.length > 0) {
    sections.push(`## Outputs\n${input.outputs.outputs.map((o) => `- [${o.kind}] ${o.ref}${o.note ? ` — ${o.note}` : ""}`).join("\n")}\n`);
  }

  if (input.filesInScope && input.filesInScope.length > 0) {
    sections.push(`## Files you may modify\n${input.filesInScope.map((f) => `- \`${f}\``).join("\n")}\n`);
  }

  if (input.filesOutOfScope && input.filesOutOfScope.length > 0) {
    sections.push(`## Files you must NOT modify\n${input.filesOutOfScope.map((f) => `- \`${f}\``).join("\n")}\n`);
  }

  if (input.acceptanceCriteria && input.acceptanceCriteria.bullets.length > 0) {
    const rationale = input.acceptanceCriteria.rationale ? `\n${input.acceptanceCriteria.rationale}\n` : "";
    sections.push(`## Acceptance (human-readable)\n${rationale}${input.acceptanceCriteria.bullets.map((b) => `- ${b}`).join("\n")}\n`);
  }

  if (input.verificationSpec) {
    sections.push(`## Acceptance (machine-verifiable)\n\`\`\`json\n${JSON.stringify(input.verificationSpec, null, 2)}\n\`\`\`\n`);
  }

  if (input.evidencePaths && input.evidencePaths.length > 0) {
    sections.push(`## Evidence you must produce\n${input.evidencePaths.map((e) => `- \`${e}\``).join("\n")}\n`);
  }

  if (input.evidenceSummary) {
    sections.push(`## Evidence summary\n${input.evidenceSummary}\n`);
  }

  if (input.downstreamOwnerAgentId) {
    sections.push(`## Next owner\n\`${input.downstreamOwnerAgentId}\` — pass handoffs to this agent when this task closes.\n`);
  }

  if (input.retryStrategy) {
    sections.push(
      `## Retry strategy\n- backoff: ${input.retryStrategy.backoffSec}s\n- max attempts: ${input.retryStrategy.maxAttempts}${input.retryStrategy.fallbackTaskId ? `\n- fallback task: \`${input.retryStrategy.fallbackTaskId}\`` : ""}\n`,
    );
  }

  sections.push(`## State machine\nnot_started → in_progress → code_landed_needs_runtime → actual_passed (or failed/closed)\n`);

  return sections.join("\n");
}

/**
 * Pure helper: validate that the minimum required fields are present
 * before the orchestrator is allowed to dispatch a task. Used as a
 * guard inside `services/orchestrator.ts`.
 */
export function validateTaskTemplate(input: TaskTemplateInput): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!input.objective || input.objective.trim().length === 0) errors.push("objective is required");
  if (!input.filesInScope || input.filesInScope.length === 0) {
    errors.push("filesInScope must list at least one path (drives file lock acquisition)");
  }
  if (!input.acceptanceCriteria || input.acceptanceCriteria.bullets.length === 0) {
    errors.push("acceptanceCriteria.bullets must have at least one entry");
  }
  if (!input.verificationSpec) {
    errors.push("verificationSpec is required (machine-verifiable checks; free-text 验收 is forbidden)");
  }
  if (!input.evidencePaths || input.evidencePaths.length === 0) {
    errors.push("evidencePaths must list at least one path that proves actual_passed");
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}