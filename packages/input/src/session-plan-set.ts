/**
 * Public barrel for the read-only session plan-set protocol.
 *
 * A session plan set is a directory under `.eforge/session-plans/<plan-set-id>/`
 * containing a canonical `plan-set.yaml` manifest, an optional umbrella anchor
 * markdown file, and manifest-declared child markdown files. This protocol is
 * read-only: it does not create, mutate, enqueue, or hand off plan sets to the
 * build pipeline, and it does not change `normalizeBuildSource` matching.
 */

export {
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
} from './session-plan-set/schema.js';

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
} from './session-plan-set/schema.js';

export {
  parseSessionPlanSetManifest,
  serializeSessionPlanSetManifest,
} from './session-plan-set/manifest.js';

export {
  resolveSessionPlanSetsRoot,
  resolveSessionPlanSetDir,
  resolveSessionPlanSetManifestPath,
  resolveSessionPlanSetAnchorPath,
  resolveSessionPlanSetChildPath,
} from './session-plan-set/paths.js';

export type {
  ResolveSessionPlanSetDirOpts,
  ResolveSessionPlanSetAnchorPathOpts,
  ResolveSessionPlanSetChildPathOpts,
} from './session-plan-set/paths.js';

export {
  listSessionPlanSets,
  loadSessionPlanSet,
} from './session-plan-set/read.js';

export type {
  ListSessionPlanSetsOpts,
  LoadSessionPlanSetOpts,
} from './session-plan-set/read.js';

export {
  validateSessionPlanSet,
  validateLoadedSessionPlanSet,
  summarizeSessionPlanSet,
} from './session-plan-set/validate.js';

export type { ValidateSessionPlanSetOpts } from './session-plan-set/validate.js';
