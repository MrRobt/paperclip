export {
  createDb,
  getPostgresDataDirectory,
  ensurePostgresDatabase,
  inspectMigrations,
  applyPendingMigrations,
  reconcilePendingMigrationHistory,
  type MigrationState,
  type MigrationHistoryReconcileResult,
  migratePostgresIfEmpty,
  type MigrationBootstrapResult,
  type Db,
} from "./client.js";
export {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
  type EmbeddedPostgresTestDatabase,
  type EmbeddedPostgresTestSupport,
} from "./test-embedded-postgres.js";
export {
  runDatabaseBackup,
  runDatabaseRestore,
  formatDatabaseBackupResult,
  type BackupRetentionPolicy,
  type RunDatabaseBackupOptions,
  type RunDatabaseBackupResult,
  type RunDatabaseRestoreOptions,
} from "./backup-lib.js";
export {
  createEmbeddedPostgresLogBuffer,
  formatEmbeddedPostgresError,
} from "./embedded-postgres-error.js";
export {
  ensureLinuxSharedLibraryAliases,
  prepareEmbeddedPostgresNativeRuntime,
} from "./embedded-postgres-native.js";
export { issueRelations } from "./schema/issue_relations.js";
export { issueReferenceMentions } from "./schema/issue_reference_mentions.js";
export * from "./schema/index.js";

// Phase 8–13 type re-exports. `export *` above does NOT re-export
// TypeScript type aliases; consumers in server/ depend on importing
// these by name. Keep in sync with the type aliases declared in the
// schema modules.
export type {
  TaskVerificationSpec,
  TaskStatus,
  TaskFailureStage,
  TaskAcceptanceCriteria,
  TaskIOMap,
  TaskRetryStrategy,
} from "./schema/tasks.js";
export type {
  GoalStatus,
} from "./schema/goals.js";
export type {
  PhaseStatus,
} from "./schema/phases.js";
export type {
  FileLockType,
} from "./schema/file_locks.js";
export type {
  InterfaceContractKind,
  InterfaceContractStatus,
} from "./schema/interface_contracts.js";
export type {
  ProjectContextFeatureEntry,
  ProjectContextBlockedItem,
  ProjectContextRisk,
  ProjectContextDecision,
  ProjectContextVerifiedFact,
  ProjectContextInvestigatedConclusion,
} from "./schema/project_context.js";
export type {
  RuntimeLeaseStatus,
  RuntimeEnvironmentKind,
} from "./schema/runtime_leases.js";
export type {
  OrchestratorTriggerKind,
  OrchestratorRunStatus,
  OrchestratorDecisionType,
  OrchestratorDecision,
  OrchestratorDispatch,
  OrchestratorFileLockAction,
} from "./schema/orchestrator_runs.js";
export type {
  TaskVerificationEvidence,
  TaskVerificationSummary,
} from "./schema/task_verifications.js";
export type {
  RootCauseClass,
} from "./schema/task_postmortems.js";
export type {
  PrCheckStatus,
  PrCheckConclusion,
} from "./schema/pr_check_runs.js";
export type {
  LegionAutoMergeMethod,
} from "./schema/legion_git_config.js";
export type {
  SkillProposalStatus,
  SkillProposalInitiator,
} from "./schema/skill_proposals.js";
