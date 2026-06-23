import { Type, type Static } from '@sinclair/typebox';
import {
  EforgePlanPlanningBacklogSafeIdSchema,
  EforgePlanPlanningSha256HexSchema,
} from './common.js';
import { type SafeParseResult, safeParseWithSchema } from '../schema-utils.js';

export const BACKLOG_CURATION_MAP_REDUCE_SCHEMA_VERSION = 1 as const;
export const BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION = 'backlog-curation-item-audit-v1' as const;

export const BACKLOG_CURATION_PACKET_MAX_BYTES = 24_000 as const;
export const BACKLOG_CURATION_PACKET_MAX_COUNT = 1_000 as const;
export const BACKLOG_CURATION_CITATIONS_PER_ITEM_MAX = 8 as const;
export const BACKLOG_CURATION_HISTORICAL_HINTS_PER_ITEM_MAX = 8 as const;
export const BACKLOG_CURATION_DIAGNOSTICS_PER_PACKET_MAX = 8 as const;
export const BACKLOG_CURATION_DEPENDENCY_FACTS_PER_ITEM_MAX = 12 as const;
export const BACKLOG_CURATION_RECOMMENDATION_SIGNALS_PER_ITEM_MAX = 8 as const;
export const BACKLOG_CURATION_VALIDATION_ERRORS_MAX = 12 as const;
export const BACKLOG_CURATION_FINDING_MAX_BYTES = 12_000 as const;
export const BACKLOG_CURATION_REDUCER_OUTCOMES_MAX = 1_000 as const;
export const BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES = 140_000 as const;
export const BACKLOG_CURATION_REPAIR_ERROR_MAX_BYTES = 2_000 as const;

const boundedString = (maxLength = 2_000) => Type.String({ maxLength });
const boundedNonEmptyString = (maxLength = 2_000) => Type.String({ minLength: 1, pattern: '\\S', maxLength });

const BoundedJsonScalarSchema = Type.Union([Type.String({ maxLength: 500 }), Type.Number(), Type.Boolean(), Type.Null()]);
const BoundedJsonValue1Schema = Type.Union([
  BoundedJsonScalarSchema,
  Type.Array(BoundedJsonScalarSchema, { maxItems: 20 }),
  Type.Object({}, { additionalProperties: BoundedJsonScalarSchema, maxProperties: 20 }),
]);
const BoundedJsonValue2Schema = Type.Union([
  BoundedJsonScalarSchema,
  Type.Array(BoundedJsonValue1Schema, { maxItems: 20 }),
  Type.Object({}, { additionalProperties: BoundedJsonValue1Schema, maxProperties: 20 }),
]);
const BoundedJsonObjectSchema = Type.Object({}, { additionalProperties: BoundedJsonValue2Schema, maxProperties: 24 });

export const BacklogCurationMapReduceItemPacketPreconditionSchema = Type.Object({
  kind: Type.Literal('item'),
  id: EforgePlanPlanningBacklogSafeIdSchema,
  origin: Type.Optional(Type.Union([Type.Literal('private'), Type.Literal('legacy')])),
  relativePath: Type.Optional(boundedNonEmptyString(500)),
  bodySha256: EforgePlanPlanningSha256HexSchema,
  sourceFingerprint: EforgePlanPlanningSha256HexSchema,
  updated: Type.Optional(Type.String({ maxLength: 120 })),
  recordSha256: EforgePlanPlanningSha256HexSchema,
}, { additionalProperties: false });

export const BacklogCurationMapReduceRuntimeIdentitySchema = Type.Object({
  provider: boundedNonEmptyString(120),
  modelId: boundedNonEmptyString(200),
  agentProfile: Type.Optional(Type.String({ maxLength: 200 })),
}, { additionalProperties: false });

export const BacklogCurationMapReduceDiagnosticSchema = Type.Object({
  code: boundedNonEmptyString(160),
  severity: Type.Union([Type.Literal('info'), Type.Literal('warning'), Type.Literal('error')]),
  message: Type.Optional(boundedString(800)),
  path: Type.Optional(boundedString(300)),
}, { additionalProperties: false });

export const BacklogCurationMapReduceCapDiagnosticSchema = Type.Object({
  code: boundedNonEmptyString(160),
  cap: Type.Integer({ minimum: 0 }),
  observed: Type.Integer({ minimum: 0 }),
  retained: Type.Integer({ minimum: 0 }),
  message: Type.Optional(boundedString(800)),
}, { additionalProperties: false });

export const BacklogCurationMapReduceDependencyFactSchema = Type.Object({
  id: EforgePlanPlanningBacklogSafeIdSchema,
  relationship: Type.Union([Type.Literal('open-dependency'), Type.Literal('closed-dependency'), Type.Literal('missing-dependency')]),
  status: Type.Optional(Type.String({ maxLength: 80 })),
  title: Type.Optional(boundedString(300)),
}, { additionalProperties: false });

export const BacklogCurationMapReduceCitationSchema = Type.Object({
  kind: Type.Union([Type.Literal('implementation'), Type.Literal('product-surface'), Type.Literal('supporting'), Type.Literal('current-source')]),
  source: boundedNonEmptyString(200),
  confidence: Type.Optional(Type.String({ maxLength: 80 })),
  path: Type.Optional(boundedString(400)),
  excerpt: Type.Optional(boundedString(1_000)),
  matchedBy: Type.Optional(Type.Array(Type.String({ maxLength: 120 }), { maxItems: 12 })),
}, { additionalProperties: false });

export const BacklogCurationMapReduceHistoricalHintSchema = Type.Object({
  source: boundedNonEmptyString(200),
  closureAuthority: Type.Literal(false),
  intent: Type.Optional(Type.String({ maxLength: 120 })),
  confidence: Type.Optional(Type.String({ maxLength: 80 })),
  citation: Type.Optional(boundedString(600)),
  evidence: Type.Optional(boundedString(1_000)),
  path: Type.Optional(boundedString(400)),
}, { additionalProperties: false });

export const BacklogCurationMapReduceRecommendationSignalSchema = Type.Object({
  source: boundedNonEmptyString(200),
  ref: Type.Optional(Type.String({ maxLength: 160 })),
  signal: boundedString(1_000),
}, { additionalProperties: false });

export const BacklogCurationMapReduceGlobalContextSchema = Type.Object({
  schemaVersion: Type.Literal(BACKLOG_CURATION_MAP_REDUCE_SCHEMA_VERSION),
  purpose: Type.Literal('backlog-curation-map-reduce'),
  sourceFingerprint: EforgePlanPlanningSha256HexSchema,
  generatedAt: Type.Optional(Type.String()),
  curationGuidance: Type.Array(boundedString(1_200), { maxItems: 8 }),
  caps: Type.Object({}, { additionalProperties: Type.Number() }),
  itemCount: Type.Integer({ minimum: 0, maximum: BACKLOG_CURATION_PACKET_MAX_COUNT }),
  openItemIds: Type.Array(EforgePlanPlanningBacklogSafeIdSchema, { maxItems: BACKLOG_CURATION_PACKET_MAX_COUNT }),
  roadmapSummaries: Type.Array(BoundedJsonObjectSchema, { maxItems: 20 }),
  dependencySummaries: Type.Array(BoundedJsonObjectSchema, { maxItems: 50 }),
  recommendationSummaries: Type.Array(BoundedJsonObjectSchema, { maxItems: 50 }),
  redraftSummary: Type.Optional(BoundedJsonObjectSchema),
  diagnostics: Type.Array(BacklogCurationMapReduceDiagnosticSchema, { maxItems: 40 }),
}, { additionalProperties: false });

export const BacklogCurationMapReduceItemPacketSchema = Type.Object({
  schemaVersion: Type.Literal(BACKLOG_CURATION_MAP_REDUCE_SCHEMA_VERSION),
  kind: Type.Literal('item'),
  sourceFingerprint: EforgePlanPlanningSha256HexSchema,
  itemId: EforgePlanPlanningBacklogSafeIdSchema,
  itemTitle: boundedString(300),
  metadata: BoundedJsonObjectSchema,
  precondition: BacklogCurationMapReduceItemPacketPreconditionSchema,
  bodySha256: EforgePlanPlanningSha256HexSchema,
  recordSha256: EforgePlanPlanningSha256HexSchema,
  sectionSummaries: Type.Array(Type.Object({ heading: boundedString(160), text: boundedString(2_000) }, { additionalProperties: false }), { maxItems: 12 }),
  dependencyFacts: Type.Array(BacklogCurationMapReduceDependencyFactSchema, { maxItems: BACKLOG_CURATION_DEPENDENCY_FACTS_PER_ITEM_MAX }),
  currentSourceCitations: Type.Array(BacklogCurationMapReduceCitationSchema, { maxItems: BACKLOG_CURATION_CITATIONS_PER_ITEM_MAX }),
  historicalHints: Type.Array(BacklogCurationMapReduceHistoricalHintSchema, { maxItems: BACKLOG_CURATION_HISTORICAL_HINTS_PER_ITEM_MAX }),
  recommendationSignals: Type.Array(BacklogCurationMapReduceRecommendationSignalSchema, { maxItems: BACKLOG_CURATION_RECOMMENDATION_SIGNALS_PER_ITEM_MAX }),
  diagnostics: Type.Array(BacklogCurationMapReduceCapDiagnosticSchema, { maxItems: BACKLOG_CURATION_DIAGNOSTICS_PER_PACKET_MAX }),
}, { additionalProperties: false });

const BacklogCurationMapReduceFindingProperties = {
  schemaVersion: Type.Literal(BACKLOG_CURATION_MAP_REDUCE_SCHEMA_VERSION),
  itemId: EforgePlanPlanningBacklogSafeIdSchema,
  sourceFingerprint: EforgePlanPlanningSha256HexSchema,
  packetSha256: EforgePlanPlanningSha256HexSchema,
  bodySha256: EforgePlanPlanningSha256HexSchema,
  promptVersion: boundedNonEmptyString(120),
  runtimeIdentity: BacklogCurationMapReduceRuntimeIdentitySchema,
  disposition: Type.Union([Type.Literal('change'), Type.Literal('recheck'), Type.Literal('skip'), Type.Literal('needs-input')]),
  summary: boundedString(2_000),
  rationale: boundedString(3_000),
  citations: Type.Array(BacklogCurationMapReduceCitationSchema, { maxItems: BACKLOG_CURATION_CITATIONS_PER_ITEM_MAX }),
  recommendationSignals: Type.Array(BacklogCurationMapReduceRecommendationSignalSchema, { maxItems: BACKLOG_CURATION_RECOMMENDATION_SIGNALS_PER_ITEM_MAX }),
  diagnostics: Type.Array(BacklogCurationMapReduceDiagnosticSchema, { maxItems: BACKLOG_CURATION_DIAGNOSTICS_PER_PACKET_MAX }),
} as const;

export const BacklogCurationMapReduceFindingSchema = Type.Object(BacklogCurationMapReduceFindingProperties, { additionalProperties: false });

export const BacklogCurationMapReduceFindingSubmissionSchema = Type.Object({
  ...BacklogCurationMapReduceFindingProperties,
  runtimeIdentity: Type.Optional(BacklogCurationMapReduceRuntimeIdentitySchema),
}, { additionalProperties: false });

export function safeParseBacklogCurationMapReduceFinding(value: unknown): SafeParseResult<BacklogCurationMapReduceFinding> {
  const parsed = safeParseWithSchema(BacklogCurationMapReduceFindingSchema, value);
  if (!parsed.success) return parsed;
  const bytes = utf8ByteLength(JSON.stringify(parsed.data));
  if (bytes <= BACKLOG_CURATION_FINDING_MAX_BYTES) return parsed;
  return semanticError('', `Finding is ${bytes} bytes; cap is ${BACKLOG_CURATION_FINDING_MAX_BYTES}.`);
}

export function isBacklogCurationMapReduceFinding(value: unknown): value is BacklogCurationMapReduceFinding {
  return safeParseBacklogCurationMapReduceFinding(value).success;
}

const outcomeBase = {
  schemaVersion: Type.Literal(BACKLOG_CURATION_MAP_REDUCE_SCHEMA_VERSION),
  itemId: EforgePlanPlanningBacklogSafeIdSchema,
  sourceFingerprint: EforgePlanPlanningSha256HexSchema,
  packetSha256: Type.Optional(EforgePlanPlanningSha256HexSchema),
  bodySha256: Type.Optional(EforgePlanPlanningSha256HexSchema),
  diagnostics: Type.Array(BacklogCurationMapReduceDiagnosticSchema, { maxItems: BACKLOG_CURATION_DIAGNOSTICS_PER_PACKET_MAX }),
} as const;

export const BacklogCurationMapReduceItemOutcomeSchema = Type.Union([
  Type.Object({ ...outcomeBase, outcome: Type.Literal('cache-hit'), finding: BacklogCurationMapReduceFindingSchema }, { additionalProperties: false }),
  Type.Object({ ...outcomeBase, outcome: Type.Literal('audited-finding'), finding: BacklogCurationMapReduceFindingSchema }, { additionalProperties: false }),
  Type.Object({ ...outcomeBase, outcome: Type.Literal('oversized-packet'), byteLength: Type.Integer({ minimum: 0 }), byteCap: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }),
  Type.Object({ ...outcomeBase, outcome: Type.Literal('item-agent-failure'), error: boundedString(BACKLOG_CURATION_REPAIR_ERROR_MAX_BYTES) }, { additionalProperties: false }),
  Type.Object({ ...outcomeBase, outcome: Type.Literal('invalid-finding'), validationErrors: Type.Array(boundedString(400), { maxItems: BACKLOG_CURATION_VALIDATION_ERRORS_MAX }) }, { additionalProperties: false }),
  Type.Object({ ...outcomeBase, outcome: Type.Literal('cancelled'), reason: Type.Optional(boundedString(400)) }, { additionalProperties: false }),
]);

/** Use at item-outcome consumer boundaries; also enforces nested finding byte caps. */
export function safeParseBacklogCurationMapReduceItemOutcome(value: unknown): SafeParseResult<BacklogCurationMapReduceItemOutcome> {
  const parsed = safeParseWithSchema(BacklogCurationMapReduceItemOutcomeSchema, value);
  if (!parsed.success) return parsed;
  return validateOutcomeFinding(parsed.data, 'finding');
}

export const BacklogCurationMapReduceReducerInputSchema = Type.Object({
  schemaVersion: Type.Literal(BACKLOG_CURATION_MAP_REDUCE_SCHEMA_VERSION),
  sourceFingerprint: EforgePlanPlanningSha256HexSchema,
  generatedAt: Type.Optional(Type.String()),
  globalContext: BacklogCurationMapReduceGlobalContextSchema,
  outcomes: Type.Array(BacklogCurationMapReduceItemOutcomeSchema, { maxItems: BACKLOG_CURATION_REDUCER_OUTCOMES_MAX }),
  diagnostics: Type.Array(BacklogCurationMapReduceDiagnosticSchema, { maxItems: 40 }),
}, { additionalProperties: false });

/** Use at reducer-input consumer boundaries; also enforces nested finding byte caps. */
export function safeParseBacklogCurationMapReduceReducerInput(value: unknown): SafeParseResult<BacklogCurationMapReduceReducerInput> {
  const parsed = safeParseWithSchema(BacklogCurationMapReduceReducerInputSchema, value);
  if (!parsed.success) return parsed;
  const fingerprintResult = validateReducerInputFingerprints(parsed.data, '');
  if (!fingerprintResult.success) return fingerprintResult;
  for (const [index, outcome] of parsed.data.outcomes.entries()) {
    const findingResult = validateOutcomeFinding(outcome, `outcomes/${index}/finding`);
    if (!findingResult.success) return findingResult;
  }
  return parsed;
}

export const BacklogCurationMapReduceSourceBundleSchema = Type.Object({
  schemaVersion: Type.Literal(BACKLOG_CURATION_MAP_REDUCE_SCHEMA_VERSION),
  sourceFingerprint: EforgePlanPlanningSha256HexSchema,
  generatedAt: Type.Optional(Type.String()),
  globalContext: BacklogCurationMapReduceGlobalContextSchema,
  packets: Type.Array(BacklogCurationMapReduceItemPacketSchema, { maxItems: BACKLOG_CURATION_PACKET_MAX_COUNT }),
  degradedOutcomes: Type.Array(BacklogCurationMapReduceItemOutcomeSchema, { maxItems: BACKLOG_CURATION_PACKET_MAX_COUNT }),
  reducerInput: BacklogCurationMapReduceReducerInputSchema,
}, { additionalProperties: false });

/** Use at source-bundle consumer boundaries; also enforces nested finding byte caps. */
export function safeParseBacklogCurationMapReduceSourceBundle(value: unknown): SafeParseResult<BacklogCurationMapReduceSourceBundle> {
  const parsed = safeParseWithSchema(BacklogCurationMapReduceSourceBundleSchema, value);
  if (!parsed.success) return parsed;
  const fingerprintResult = validateSourceBundleFingerprints(parsed.data);
  if (!fingerprintResult.success) return fingerprintResult;
  const coverageResult = validateSourceBundleItemCoverage(parsed.data);
  if (!coverageResult.success) return coverageResult;
  for (const [index, outcome] of parsed.data.degradedOutcomes.entries()) {
    const findingResult = validateOutcomeFinding(outcome, `degradedOutcomes/${index}/finding`);
    if (!findingResult.success) return findingResult;
  }
  const reducerResult = safeParseBacklogCurationMapReduceReducerInput(parsed.data.reducerInput);
  if (!reducerResult.success) return prefixSafeParseError(reducerResult, 'reducerInput');
  return parsed;
}

function validateSourceBundleItemCoverage(bundle: BacklogCurationMapReduceSourceBundle): SafeParseResult<BacklogCurationMapReduceSourceBundle> {
  const coveredCount = bundle.packets.length + bundle.degradedOutcomes.length;
  if (coveredCount > BACKLOG_CURATION_PACKET_MAX_COUNT) return semanticError('', `packets plus degradedOutcomes cover ${coveredCount} items; cap is ${BACKLOG_CURATION_PACKET_MAX_COUNT}.`);
  if (bundle.globalContext.itemCount !== bundle.globalContext.openItemIds.length) return semanticError('globalContext/itemCount', `itemCount must match openItemIds length ${bundle.globalContext.openItemIds.length}.`);
  if (coveredCount !== bundle.globalContext.itemCount) return semanticError('', `packets plus degradedOutcomes cover ${coveredCount} items; expected ${bundle.globalContext.itemCount}.`);

  const expectedIds = new Set(bundle.globalContext.openItemIds);
  if (expectedIds.size !== bundle.globalContext.openItemIds.length) return semanticError('globalContext/openItemIds', 'openItemIds must not contain duplicate item ids.');
  const seen = new Set<string>();
  for (const [index, packet] of bundle.packets.entries()) {
    const duplicatePath = addCoveredItem(seen, expectedIds, packet.itemId, `packets/${index}/itemId`);
    if (duplicatePath !== undefined) return duplicatePath;
  }
  for (const [index, outcome] of bundle.degradedOutcomes.entries()) {
    const duplicatePath = addCoveredItem(seen, expectedIds, outcome.itemId, `degradedOutcomes/${index}/itemId`);
    if (duplicatePath !== undefined) return duplicatePath;
  }
  return { success: true, data: bundle };
}

function addCoveredItem(seen: Set<string>, expectedIds: Set<string>, itemId: string, path: string): SafeParseResult<never> | undefined {
  if (!expectedIds.has(itemId)) return semanticError(path, 'item id is not present in globalContext.openItemIds.');
  if (seen.has(itemId)) return semanticError(path, 'item id is duplicated across packets and degradedOutcomes.');
  seen.add(itemId);
  return undefined;
}

function validateOutcomeFinding<T extends BacklogCurationMapReduceItemOutcome>(outcome: T, path: string): SafeParseResult<T> {
  if (outcome.outcome !== 'cache-hit' && outcome.outcome !== 'audited-finding') return { success: true, data: outcome };
  const finding = safeParseBacklogCurationMapReduceFinding(outcome.finding);
  if (!finding.success) return prefixSafeParseError(finding, path);
  if (outcome.finding.sourceFingerprint !== outcome.sourceFingerprint) return semanticError(`${path}/sourceFingerprint`, `sourceFingerprint must match ${outcome.sourceFingerprint}.`);
  return { success: true, data: outcome };
}

function validateReducerInputFingerprints(input: BacklogCurationMapReduceReducerInput, basePath: string): SafeParseResult<BacklogCurationMapReduceReducerInput> {
  const prefix = basePath ? `${basePath}/` : '';
  if (input.globalContext.sourceFingerprint !== input.sourceFingerprint) return semanticError(`${prefix}globalContext/sourceFingerprint`, `sourceFingerprint must match ${input.sourceFingerprint}.`);
  for (const [index, outcome] of input.outcomes.entries()) {
    if (outcome.sourceFingerprint !== input.sourceFingerprint) return semanticError(`${prefix}outcomes/${index}/sourceFingerprint`, `sourceFingerprint must match ${input.sourceFingerprint}.`);
    if ((outcome.outcome === 'cache-hit' || outcome.outcome === 'audited-finding') && outcome.finding.sourceFingerprint !== input.sourceFingerprint) {
      return semanticError(`${prefix}outcomes/${index}/finding/sourceFingerprint`, `sourceFingerprint must match ${input.sourceFingerprint}.`);
    }
  }
  return { success: true, data: input };
}

function validateSourceBundleFingerprints(bundle: BacklogCurationMapReduceSourceBundle): SafeParseResult<BacklogCurationMapReduceSourceBundle> {
  if (bundle.globalContext.sourceFingerprint !== bundle.sourceFingerprint) return semanticError('globalContext/sourceFingerprint', `sourceFingerprint must match ${bundle.sourceFingerprint}.`);
  for (const [index, packet] of bundle.packets.entries()) {
    if (packet.sourceFingerprint !== bundle.sourceFingerprint) return semanticError(`packets/${index}/sourceFingerprint`, `sourceFingerprint must match ${bundle.sourceFingerprint}.`);
    if (packet.precondition.sourceFingerprint !== bundle.sourceFingerprint) return semanticError(`packets/${index}/precondition/sourceFingerprint`, `sourceFingerprint must match ${bundle.sourceFingerprint}.`);
  }
  for (const [index, outcome] of bundle.degradedOutcomes.entries()) {
    if (outcome.sourceFingerprint !== bundle.sourceFingerprint) return semanticError(`degradedOutcomes/${index}/sourceFingerprint`, `sourceFingerprint must match ${bundle.sourceFingerprint}.`);
    if ((outcome.outcome === 'cache-hit' || outcome.outcome === 'audited-finding') && outcome.finding.sourceFingerprint !== bundle.sourceFingerprint) {
      return semanticError(`degradedOutcomes/${index}/finding/sourceFingerprint`, `sourceFingerprint must match ${bundle.sourceFingerprint}.`);
    }
  }
  if (bundle.reducerInput.sourceFingerprint !== bundle.sourceFingerprint) return semanticError('reducerInput/sourceFingerprint', `sourceFingerprint must match ${bundle.sourceFingerprint}.`);
  const reducerResult = validateReducerInputFingerprints(bundle.reducerInput, 'reducerInput');
  if (!reducerResult.success) return reducerResult;
  return { success: true, data: bundle };
}

function semanticError(path: string, message: string): SafeParseResult<never> {
  return { success: false, error: { message: `${path || '(root)'}: ${message}`, errors: [{ path, message }] } };
}

function utf8ByteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
  return unescape(encodeURIComponent(value)).length;
}

function prefixSafeParseError<T>(result: SafeParseResult<T>, path: string): SafeParseResult<never> {
  if (result.success) return { success: false, error: { message: `${path}: unexpected validation success`, errors: [{ path, message: 'unexpected validation success' }] } };
  const errors = result.error.errors.map((error) => ({ path: `${path}${error.path ? `/${error.path.replace(/^\//, '')}` : ''}`, message: error.message }));
  return { success: false, error: { message: errors.map((error) => `${error.path || '(root)'}: ${error.message}`).join('\n'), errors } };
}

export type BacklogCurationMapReduceItemPacketPrecondition = Static<typeof BacklogCurationMapReduceItemPacketPreconditionSchema>;
export type BacklogCurationMapReduceRuntimeIdentity = Static<typeof BacklogCurationMapReduceRuntimeIdentitySchema>;
export type BacklogCurationMapReduceDiagnostic = Static<typeof BacklogCurationMapReduceDiagnosticSchema>;
export type BacklogCurationMapReduceCapDiagnostic = Static<typeof BacklogCurationMapReduceCapDiagnosticSchema>;
export type BacklogCurationMapReduceDependencyFact = Static<typeof BacklogCurationMapReduceDependencyFactSchema>;
export type BacklogCurationMapReduceCitation = Static<typeof BacklogCurationMapReduceCitationSchema>;
export type BacklogCurationMapReduceHistoricalHint = Static<typeof BacklogCurationMapReduceHistoricalHintSchema>;
export type BacklogCurationMapReduceRecommendationSignal = Static<typeof BacklogCurationMapReduceRecommendationSignalSchema>;
export type BacklogCurationMapReduceGlobalContext = Static<typeof BacklogCurationMapReduceGlobalContextSchema>;
export type BacklogCurationMapReduceItemPacket = Static<typeof BacklogCurationMapReduceItemPacketSchema>;
export type BacklogCurationMapReduceFinding = Static<typeof BacklogCurationMapReduceFindingSchema>;
export type BacklogCurationMapReduceItemOutcome = Static<typeof BacklogCurationMapReduceItemOutcomeSchema>;
export type BacklogCurationMapReduceReducerInput = Static<typeof BacklogCurationMapReduceReducerInputSchema>;
export type BacklogCurationMapReduceSourceBundle = Static<typeof BacklogCurationMapReduceSourceBundleSchema>;
