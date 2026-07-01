/**
 * Phase 23 of doc/plans/2026-07-01-orchestrator-control-plane.md.
 *
 * Thin wrapper around the project-wide `MarkdownBody` so that new
 * surfaces (orchestrator daily report, doc-page render) get the same
 * issue auto-linking, mermaid support, and code-block copy buttons
 * without re-implementing them.
 */

import { MarkdownBody } from "./MarkdownBody";
import { cn } from "../lib/utils";

export interface MarkdownViewProps {
  source: string;
  className?: string;
}

export function MarkdownView({ source, className }: MarkdownViewProps) {
  return <MarkdownBody className={cn("text-sm", className)}>{source}</MarkdownBody>;
}