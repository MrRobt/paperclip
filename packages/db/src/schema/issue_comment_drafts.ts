import type { IssueCommentAuthorType, IssueCommentMetadata, IssueCommentPresentation } from "@paperclipai/shared";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { issueComments } from "./issue_comments.js";
import { issues } from "./issues.js";

export type IssueCommentDraftFailureKind =
  | "route_error"
  | "authorization_error"
  | "validation_error"
  | "database_error"
  | "comment_gate_blocked"
  | "unknown";

export type IssueCommentDraftReplayStatus = "pending" | "ready" | "blocked" | "done" | "failed";

export const issueCommentDrafts = pgTable(
  "issue_comment_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    authorAgentId: uuid("author_agent_id").references(() => agents.id, { onDelete: "set null" }),
    authorUserId: text("author_user_id"),
    authorType: text("author_type").$type<IssueCommentAuthorType>(),
    createdByRunId: uuid("created_by_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    presentation: jsonb("presentation").$type<IssueCommentPresentation | null>(),
    metadata: jsonb("metadata").$type<IssueCommentMetadata | null>(),
    failureKind: text("failure_kind").$type<IssueCommentDraftFailureKind>().notNull().default("unknown"),
    failureReason: text("failure_reason"),
    httpStatus: integer("http_status"),
    errorMessage: text("error_message"),
    replayStatus: text("replay_status").$type<IssueCommentDraftReplayStatus>().notNull().default("pending"),
    replayAttemptCount: integer("replay_attempt_count").notNull().default(0),
    lastReplayAt: timestamp("last_replay_at", { withTimezone: true }),
    replayedCommentId: uuid("replayed_comment_id").references(() => issueComments.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("issue_comment_drafts_company_status_idx").on(table.companyId, table.replayStatus),
    issueStatusIdx: index("issue_comment_drafts_issue_status_idx").on(table.issueId, table.replayStatus),
    companyCreatedIdx: index("issue_comment_drafts_company_created_idx").on(table.companyId, table.createdAt),
    runIdx: index("issue_comment_drafts_run_idx").on(table.createdByRunId),
  }),
);
