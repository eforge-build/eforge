/**
 * @eforge-build/input — reusable input-artifact protocols for eforge.
 *
 * ## Session Plans
 *
 * Session plans are Markdown files in `.eforge/session-plans/` that accumulate
 * decisions during a structured planning conversation. They are project-local
 * and compile to ordinary build source for the engine queue via
 * `sessionPlanToBuildSource` or the boundary helper `normalizeBuildSource`.
 * The bundled session-planning workflow adapter exposes the same project-local
 * boundary as domain operations without importing daemon client contracts.
 *
 * ## Boundary normalization
 *
 * `normalizeBuildSource` is the single chokepoint for session-plan handling:
 * if a source path matches `.eforge/session-plans/<name>.md`, it parses the plan
 * and converts it to ordinary build source. Other paths pass through unchanged.
 *
 * ## Extension-aware preprocessing
 *
 * `preprocessBuildSource` lets callers resolve extension-registered input
 * source references and apply PRD enrichers while preserving provenance.
 */

// ---------------------------------------------------------------------------
// Session plan exports
// ---------------------------------------------------------------------------

export {
  // Schema
  sessionPlanFrontmatterSchema,

  // Parse / serialize
  parseSessionPlan,
  serializeSessionPlan,

  // List
  listSessionPlans,
  listActiveSessionPlans,

  // Dimension helpers
  selectDimensions,
  checkReadiness,
  getReadinessDetail,
  getSessionPlanDimensionSpec,
  migrateBooleanDimensions,

  // Mutation helpers
  createSessionPlan,
  setSessionPlanSection,
  skipDimension,
  unskipDimension,
  setSessionPlanStatus,
  setSessionPlanDimensions,

  // Path resolution and I/O
  resolveSessionPlanStorageRoot,
  resolveSessionPlanPath,
  loadSessionPlan,
  writeSessionPlan,

  // Build source compilation
  sessionPlanToBuildSource,

  // Boundary normalization
  normalizeBuildSource,
} from './session-plan.js';

export type {
  SessionPlanStatus,
  PlanningType,
  PlanningDepth,
  PlanningProfile,
  SkippedDimension,
  SessionPlanFrontmatter,
  SessionPlan,
  SessionPlanListEntry,
  ListSessionPlansOpts,
  ListActiveSessionPlansOpts,
  CreateSessionPlanOpts,
  SetSessionPlanStatusMetadata,
  SetSessionPlanDimensionsOpts,
  SessionPlanDimensionSpec,
  ResolveSessionPlanPathOpts,
  LoadSessionPlanOpts,
  WriteSessionPlanOpts,
  NormalizeBuildSourceInput,
  NormalizeBuildSourceResult,
} from './session-plan.js';

export {
  validateSessionPlanCreationDraftReadiness,
} from './session-plan-creation-draft.js';

export type {
  SessionPlanCreationDraftReadinessInput,
  SessionPlanCreationDraftReadinessValidation,
  SessionPlanCreationDraftSection,
  SessionPlanCreationDraftSkippedDimension,
} from './session-plan-creation-draft.js';

// ---------------------------------------------------------------------------
// Session plan-set exports (read-only)
// ---------------------------------------------------------------------------

export {
  // Constants / schemas
  SESSION_PLAN_SET_MANIFEST_FILENAME,
  SESSION_PLAN_SET_STATUSES,
  SESSION_PLAN_SET_STRATEGIES,
  SESSION_PLAN_SET_CHILD_KINDS,
  sessionPlanSetStatusSchema,
  sessionPlanSetStrategySchema,
  sessionPlanSetChildKindSchema,
  sessionPlanSetExternalRefSchema,
  sessionPlanSetChildSchema,
  sessionPlanSetManifestSchema,

  // Manifest parse / serialize
  parseSessionPlanSetManifest,
  serializeSessionPlanSetManifest,

  // Path resolution
  resolveSessionPlanSetsRoot,
  resolveSessionPlanSetDir,
  resolveSessionPlanSetManifestPath,
  resolveSessionPlanSetAnchorPath,
  resolveSessionPlanSetChildPath,

  // List / load
  listSessionPlanSets,
  loadSessionPlanSet,

  // Validation / summary
  validateSessionPlanSet,
  validateLoadedSessionPlanSet,
  summarizeSessionPlanSet,
} from './session-plan-set.js';

export type {
  SessionPlanSetStatus,
  SessionPlanSetStrategy,
  SessionPlanSetChildKind,
  SessionPlanSetExternalRef,
  SessionPlanSetChild,
  SessionPlanSetManifest,
  SessionPlanSetListEntry,
  SessionPlanSetAnchorLoad,
  SessionPlanSetChildLoad,
  SessionPlanSetLoadResult,
  SessionPlanSetDiagnosticCode,
  SessionPlanSetDiagnostic,
  SessionPlanSetChildValidationSummary,
  SessionPlanSetChildSummary,
  SessionPlanSetAnchorSummary,
  SessionPlanSetSummary,
  SessionPlanSetValidationResult,
  ResolveSessionPlanSetDirOpts,
  ResolveSessionPlanSetAnchorPathOpts,
  ResolveSessionPlanSetChildPathOpts,
  ListSessionPlanSetsOpts,
  LoadSessionPlanSetOpts,
  ValidateSessionPlanSetOpts,
} from './session-plan-set.js';

// ---------------------------------------------------------------------------
// Session planning workflow adapter exports
// ---------------------------------------------------------------------------

export {
  SESSION_PLANNING_WORKFLOW_ADAPTER_DESCRIPTOR,
  SessionPlanReadinessError,
  isSessionPlanReadinessError,
  createSessionPlanningWorkflowAdapter,
} from './session-planning-workflow.js';

export type {
  SessionPlanReadinessDetail,
  SessionPlanningListEntry,
  SessionPlanningCreateAndWriteOptions,
  SessionPlanningSetSectionOptions,
  SessionPlanningSkipDimensionOptions,
  SessionPlanningSetStatusOptions,
  SessionPlanningSelectDimensionsOptions,
  SessionPlanningLoadResult,
  SessionPlanningCreateResult,
  SessionPlanningMutationResult,
  SessionPlanningSetStatusResult,
  SessionPlanningMigrateLegacyResult,
  SessionPlanningWorkflowAdapter,
} from './session-planning-workflow.js';

// ---------------------------------------------------------------------------
// Acceptance criteria quality exports
// ---------------------------------------------------------------------------

export {
  analyzeAcceptanceCriteriaItem,
  analyzeAcceptanceCriteria,
  analyzeAcceptanceCriteriaInBody,
  formatAcDiagnostics,
} from './acceptance-criteria-quality.js';

export type {
  AcDiagnostic,
  AcQualityResult,
} from './acceptance-criteria-quality.js';

// ---------------------------------------------------------------------------
// Extension-aware preprocessing exports
// ---------------------------------------------------------------------------

export {
  // Main preprocessing helper
  preprocessBuildSource,

  // Reference parser
  parseInputSourceReference,

  // Fatal error class
  FatalPreprocessingError,
} from './extension-normalize.js';

export type {
  // Structural registration types
  InputSourceRegistrationLike,
  PrdEnricherRegistrationLike,

  // Provenance event types
  InputSourceFetchedEvent,
  InputSourceFailedEvent,
  PrdEnricherAppliedEvent,
  PrdEnricherFailedEvent,
  PreprocessingProvenanceEvent,

  // Result types
  PreprocessingProvenance,
  PreprocessingResult,
  PreprocessBuildSourceOpts,

  // Reference parser type
  InputSourceReference,
} from './extension-normalize.js';
