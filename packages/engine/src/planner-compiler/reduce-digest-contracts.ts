import { Type } from '@sinclair/typebox';
import { TEST_OWNERSHIP_VALUES, TestOwnershipSchema, type TestOwnership } from '@eforge-build/client';
import { utf8ByteLength } from './source-analysis.js';

const boundedString = (maxLength: number): ReturnType<typeof Type.String> => Type.String({ maxLength });

export const PLANNING_MODULE_DOCS_WORK_VALUES = ['none', 'sync-existing', 'author-new'] as const;
export const PLANNING_MODULE_TEST_WORK_VALUES = ['none', 'exercise-existing', 'author-new'] as const;
export const PLANNING_MODULE_TEST_OWNERSHIP_VALUES = TEST_OWNERSHIP_VALUES;
export const PLANNING_MODULE_REVIEW_DEPTH_VALUES = ['light', 'standard', 'heavy'] as const;
export type PlanningModuleDocsWork = (typeof PLANNING_MODULE_DOCS_WORK_VALUES)[number];
export type PlanningModuleTestWork = (typeof PLANNING_MODULE_TEST_WORK_VALUES)[number];
export type PlanningModuleTestOwnership = TestOwnership;
export type PlanningModuleReviewDepth = (typeof PLANNING_MODULE_REVIEW_DEPTH_VALUES)[number];
export const PlanningModuleDocsWorkSchema = Type.Union(PLANNING_MODULE_DOCS_WORK_VALUES.map((value) => Type.Literal(value)));
export const PlanningModuleTestWorkSchema = Type.Union(PLANNING_MODULE_TEST_WORK_VALUES.map((value) => Type.Literal(value)));
export const PlanningModuleTestOwnershipSchema = TestOwnershipSchema;
export const PlanningModuleReviewDepthSchema = Type.Union(PLANNING_MODULE_REVIEW_DEPTH_VALUES.map((value) => Type.Literal(value)));

// Shared structured-submission prompt rules for model-authored plan intent.
// Interpolated by both the atom planner and reducer prompts so the two cannot drift.
export const PLANNING_MODULE_DOCS_WORK_PROMPT_RULE = 'Set docsWork on each module candidate: "author-new" when the module\'s criteria call for new documentation artifacts (derives doc-author and doc-sync build stages), "sync-existing" when existing docs reference behavior or interfaces the module changes (derives doc-sync), "none" or omitted when there is no documentation impact.';
export const PLANNING_MODULE_TEST_WORK_PROMPT_RULE = 'Set testWork on each module candidate: "author-new" when its criteria require new tests, "exercise-existing" when existing tests must be kept green without new authoring, and "none" when no test work is needed. Also set exactly one testOwnership: "builder" when implementation and its tests are one cohesive change, "test-writer" only for an independently owned test-authoring stage, or "existing-only" when no new tests may be authored. A separate test module requires an independently buildable ownership boundary and explicit rationale in its description.';
export const PLANNING_MODULE_REVIEW_INTENT_PROMPT_RULE = 'Set reviewDepth to "light", "standard", or "heavy" and provide reviewRationale grounded in concrete risk. Small criterion counts, test wording, and dependency-root status are not by themselves reasons to split work or select heavy review.';
export const PLANNING_MODULE_WORK_DIGEST_MIRROR_RULE = 'Mirror each module candidate\'s docsWork, testWork, testOwnership, reviewDepth, and reviewRationale declarations onto the reduceDigest.modules entry with the same moduleId so downstream reducers retain them.';

/**
 * Pick the strongest of two work declarations. Strength follows the order of the
 * declared value arrays (later entries are stronger, e.g. author-new > sync-existing > none).
 */
export function strongestWorkDeclaration<T extends string>(allowed: readonly T[], a: T | undefined, b: T | undefined): T | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return allowed.indexOf(b) > allowed.indexOf(a) ? b : a;
}

export const REDUCE_DIGEST_LIMITS = {
  summaryBytes: 1_200,
  fragmentIntentBytes: 700,
  modulePurposeBytes: 700,
  validationExpectationBytes: 700,
  reviewRationaleBytes: 1_000,
  issueSummaryBytes: 700,
} as const;

export const REDUCE_DIGEST_PROMPT_BUDGETING = {
  minReduceFanIn: 2,
  inputBudgetShareNumerator: 1,
  inputBudgetShareDenominator: 2,
} as const;

export interface DeriveReduceDigestTotalByteLimitInput { maxReducePromptBytes: number; minReduceFanIn?: number }
export interface MinimumReduceDigestPromptByteLengthInput { sourceId: string; sourceKind: PlanningReduceDigestSourceKind; criterionIds: string[]; aspectIds: string[]; status?: PlanningReduceDigestStatus }

export function deriveReduceDigestTotalByteLimit(input: DeriveReduceDigestTotalByteLimitInput): number {
  const fanIn = Math.max(1, input.minReduceFanIn ?? REDUCE_DIGEST_PROMPT_BUDGETING.minReduceFanIn);
  const inputBudget = Math.floor((input.maxReducePromptBytes * REDUCE_DIGEST_PROMPT_BUDGETING.inputBudgetShareNumerator) / REDUCE_DIGEST_PROMPT_BUDGETING.inputBudgetShareDenominator);
  return Math.max(1, Math.floor(inputBudget / fanIn));
}

export const PlanningReduceDigestFragmentSchema = Type.Object({
  fragmentId: boundedString(160),
  title: boundedString(240),
  intent: boundedString(1_000),
  criterionIds: Type.Array(boundedString(80), { maxItems: 32 }),
  aspectIds: Type.Array(boundedString(240), { maxItems: 64 }),
  dependsOnFragmentIds: Type.Optional(Type.Array(boundedString(160), { maxItems: 16 })),
}, { additionalProperties: false });

export const PlanningReduceDigestModuleSchema = Type.Object({
  moduleId: boundedString(160),
  title: boundedString(240),
  purpose: boundedString(1_000),
  criterionIds: Type.Array(boundedString(80), { maxItems: 32 }),
  aspectIds: Type.Array(boundedString(240), { maxItems: 64 }),
  validationExpectation: Type.Optional(boundedString(1_000)),
  docsWork: Type.Optional(PlanningModuleDocsWorkSchema),
  testWork: Type.Optional(PlanningModuleTestWorkSchema),
  testOwnership: Type.Optional(PlanningModuleTestOwnershipSchema),
  reviewDepth: Type.Optional(PlanningModuleReviewDepthSchema),
  reviewRationale: Type.Optional(boundedString(1_000)),
  dependsOnModuleIds: Type.Optional(Type.Array(boundedString(160), { maxItems: 16 })),
}, { additionalProperties: false });

export const PlanningReduceDigestIssueSchema = Type.Object({
  issueId: boundedString(160),
  kind: Type.Union([Type.Literal('conflict'), Type.Literal('gap')]),
  title: boundedString(240),
  summary: boundedString(1_000),
  criterionIds: Type.Array(boundedString(80), { maxItems: 32 }),
  aspectIds: Type.Array(boundedString(240), { maxItems: 64 }),
  sourceIds: Type.Optional(Type.Array(boundedString(160), { maxItems: 32 })),
  representationRequired: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export const PlanningReduceDigestSchema = Type.Object({
  sourceId: boundedString(160),
  sourceKind: Type.Union([Type.Literal('atom'), Type.Literal('reduce')]),
  status: Type.Union([Type.Literal('completed'), Type.Literal('skipped'), Type.Literal('failed'), Type.Literal('incomplete')]),
  summary: boundedString(1_500),
  criterionIds: Type.Array(boundedString(80), { maxItems: 64 }),
  aspectIds: Type.Array(boundedString(240), { maxItems: 128 }),
  fragments: Type.Optional(Type.Array(PlanningReduceDigestFragmentSchema, { maxItems: 16 })),
  modules: Type.Optional(Type.Array(PlanningReduceDigestModuleSchema, { maxItems: 16 })),
  issues: Type.Optional(Type.Array(PlanningReduceDigestIssueSchema, { maxItems: 16 })),
}, { additionalProperties: false });

export type PlanningReduceDigestSourceKind = 'atom' | 'reduce';
export type PlanningReduceDigestStatus = 'completed' | 'skipped' | 'failed' | 'incomplete';
export interface PlanningReduceDigestFragment { fragmentId: string; title: string; intent: string; criterionIds: string[]; aspectIds: string[]; dependsOnFragmentIds?: string[] }
export interface PlanningReduceDigestModule { moduleId: string; title: string; purpose: string; criterionIds: string[]; aspectIds: string[]; validationExpectation?: string; docsWork?: PlanningModuleDocsWork; testWork?: PlanningModuleTestWork; testOwnership?: PlanningModuleTestOwnership; reviewDepth?: PlanningModuleReviewDepth; reviewRationale?: string; dependsOnModuleIds?: string[] }
export interface PlanningReduceDigestIssue { issueId: string; kind: 'conflict' | 'gap'; title: string; summary: string; criterionIds: string[]; aspectIds: string[]; sourceIds?: string[]; representationRequired?: boolean }
export interface PlanningReduceDigest { sourceId: string; sourceKind: PlanningReduceDigestSourceKind; status: PlanningReduceDigestStatus; summary: string; criterionIds: string[]; aspectIds: string[]; fragments?: PlanningReduceDigestFragment[]; modules?: PlanningReduceDigestModule[]; issues?: PlanningReduceDigestIssue[] }

export interface ValidatePlanningReduceDigestInput { digest: PlanningReduceDigest; expectedSourceId?: string; expectedSourceKind?: PlanningReduceDigestSourceKind; allowedCriterionIds?: string[]; allowedAspectIds?: string[]; maxTotalBytes?: number; maxPromptBytes?: number }

export function validatePlanningReduceDigest(input: ValidatePlanningReduceDigestInput): string[] {
  const errors: string[] = [];
  const { digest } = input;
  if (input.expectedSourceId && digest.sourceId !== input.expectedSourceId) errors.push(`reduce digest source mismatch:${digest.sourceId}->${input.expectedSourceId}`);
  if (input.expectedSourceKind && digest.sourceKind !== input.expectedSourceKind) errors.push(`reduce digest kind mismatch:${digest.sourceKind}->${input.expectedSourceKind}`);
  if (input.maxTotalBytes !== undefined) validateBytes('reduce digest total', digest.sourceId, JSON.stringify(digest), input.maxTotalBytes, errors);
  if (input.maxPromptBytes !== undefined) validateBytes('reduce digest prompt', digest.sourceId, reduceDigestPromptText(digest), input.maxPromptBytes, errors);
  validateBytes('reduce digest summary', digest.sourceId, digest.summary, REDUCE_DIGEST_LIMITS.summaryBytes, errors);
  validateLinkedIds('reduce digest', digest.sourceId, digest.criterionIds, digest.aspectIds, input, errors);
  for (const fragment of digest.fragments ?? []) {
    validateBytes('reduce digest fragment intent', fragment.fragmentId, fragment.intent, REDUCE_DIGEST_LIMITS.fragmentIntentBytes, errors);
    validateLinkedIds('reduce digest fragment', fragment.fragmentId, fragment.criterionIds, fragment.aspectIds, input, errors);
  }
  for (const module of digest.modules ?? []) {
    validateBytes('reduce digest module purpose', module.moduleId, module.purpose, REDUCE_DIGEST_LIMITS.modulePurposeBytes, errors);
    if (module.validationExpectation) validateBytes('reduce digest module validation', module.moduleId, module.validationExpectation, REDUCE_DIGEST_LIMITS.validationExpectationBytes, errors);
    if (module.reviewRationale) validateBytes('reduce digest module review rationale', module.moduleId, module.reviewRationale, REDUCE_DIGEST_LIMITS.reviewRationaleBytes, errors);
    if (module.reviewDepth !== undefined && !module.reviewRationale?.trim()) errors.push(`reduce digest module review depth requires rationale:${module.moduleId}`);
    validateLinkedIds('reduce digest module', module.moduleId, module.criterionIds, module.aspectIds, input, errors);
  }
  for (const issue of digest.issues ?? []) {
    validateBytes('reduce digest issue summary', issue.issueId, issue.summary, REDUCE_DIGEST_LIMITS.issueSummaryBytes, errors);
    validateLinkedIds('reduce digest issue', issue.issueId, issue.criterionIds, issue.aspectIds, input, errors);
  }
  return errors.sort();
}

export function coercePlanningReduceDigest(value: Record<string, unknown>): PlanningReduceDigest {
  const sourceKind = value.sourceKind === 'atom' || value.sourceKind === 'reduce' ? value.sourceKind : undefined;
  const status = value.status === 'completed' || value.status === 'skipped' || value.status === 'failed' || value.status === 'incomplete' ? value.status : undefined;
  if (!sourceKind || !status) throw new Error('reduce digest contains invalid sourceKind or status');
  return {
    sourceId: requiredString(value.sourceId, 'reduce digest source id'),
    sourceKind,
    status,
    summary: requiredString(value.summary, 'reduce digest summary'),
    criterionIds: stringArrayValue(value.criterionIds),
    aspectIds: stringArrayValue(value.aspectIds),
    ...(arrayValue(value.fragments).length > 0 ? { fragments: arrayValue(value.fragments).map(coerceDigestFragment) } : {}),
    ...(arrayValue(value.modules).length > 0 ? { modules: arrayValue(value.modules).map(coerceDigestModule) } : {}),
    ...(arrayValue(value.issues).length > 0 ? { issues: arrayValue(value.issues).map(coerceDigestIssue) } : {}),
  };
}

export function reduceDigestPromptText(digest: PlanningReduceDigest): string {
  return JSON.stringify(digest, null, 2);
}

export function reduceDigestPromptByteLength(digest: PlanningReduceDigest): number {
  return utf8ByteLength(reduceDigestPromptText(digest));
}

export function minimumReduceDigestPromptByteLength(input: MinimumReduceDigestPromptByteLengthInput): number {
  return reduceDigestPromptByteLength({
    sourceId: input.sourceId,
    sourceKind: input.sourceKind,
    status: input.status ?? 'completed',
    summary: 'x',
    criterionIds: nonEmptyOrFallback(input.criterionIds, 'ac-budget'),
    aspectIds: nonEmptyOrFallback(input.aspectIds, 'ac-budget:general:general'),
  });
}

export function clonePlanningReduceDigest(digest: PlanningReduceDigest): PlanningReduceDigest {
  return {
    ...digest,
    criterionIds: [...digest.criterionIds],
    aspectIds: [...digest.aspectIds],
    fragments: digest.fragments?.map((fragment) => ({ ...fragment, criterionIds: [...fragment.criterionIds], aspectIds: [...fragment.aspectIds], dependsOnFragmentIds: fragment.dependsOnFragmentIds ? [...fragment.dependsOnFragmentIds] : undefined })),
    modules: digest.modules?.map((module) => ({ ...module, criterionIds: [...module.criterionIds], aspectIds: [...module.aspectIds], dependsOnModuleIds: module.dependsOnModuleIds ? [...module.dependsOnModuleIds] : undefined })),
    issues: digest.issues?.map((issue) => ({ ...issue, criterionIds: [...issue.criterionIds], aspectIds: [...issue.aspectIds], sourceIds: issue.sourceIds ? [...issue.sourceIds] : undefined })),
  };
}

function coerceDigestFragment(value: unknown): PlanningReduceDigestFragment {
  const record = objectValue(value, 'reduce digest fragment');
  return { fragmentId: requiredString(record.fragmentId, 'reduce digest fragment id'), title: stringValue(record.title) ?? '', intent: requiredString(record.intent, 'reduce digest fragment intent'), criterionIds: stringArrayValue(record.criterionIds), aspectIds: stringArrayValue(record.aspectIds), ...(stringArrayValue(record.dependsOnFragmentIds).length > 0 ? { dependsOnFragmentIds: stringArrayValue(record.dependsOnFragmentIds) } : {}) };
}

function coerceDigestModule(value: unknown): PlanningReduceDigestModule {
  const record = objectValue(value, 'reduce digest module');
  const docsWork = optionalLiteralValue(record.docsWork, PLANNING_MODULE_DOCS_WORK_VALUES, 'reduce digest module docsWork');
  const testWork = optionalLiteralValue(record.testWork, PLANNING_MODULE_TEST_WORK_VALUES, 'reduce digest module testWork');
  const testOwnership = optionalLiteralValue(record.testOwnership, PLANNING_MODULE_TEST_OWNERSHIP_VALUES, 'reduce digest module testOwnership');
  const reviewDepth = optionalLiteralValue(record.reviewDepth, PLANNING_MODULE_REVIEW_DEPTH_VALUES, 'reduce digest module reviewDepth');
  return { moduleId: requiredString(record.moduleId, 'reduce digest module id'), title: stringValue(record.title) ?? '', purpose: requiredString(record.purpose, 'reduce digest module purpose'), criterionIds: stringArrayValue(record.criterionIds), aspectIds: stringArrayValue(record.aspectIds), ...(stringValue(record.validationExpectation) !== undefined ? { validationExpectation: stringValue(record.validationExpectation) } : {}), ...(docsWork !== undefined ? { docsWork } : {}), ...(testWork !== undefined ? { testWork } : {}), ...(testOwnership !== undefined ? { testOwnership } : {}), ...(reviewDepth !== undefined ? { reviewDepth } : {}), ...(stringValue(record.reviewRationale) !== undefined ? { reviewRationale: stringValue(record.reviewRationale) } : {}), ...(stringArrayValue(record.dependsOnModuleIds).length > 0 ? { dependsOnModuleIds: stringArrayValue(record.dependsOnModuleIds) } : {}) };
}

function coerceDigestIssue(value: unknown): PlanningReduceDigestIssue {
  const record = objectValue(value, 'reduce digest issue');
  const kind = record.kind === 'conflict' || record.kind === 'gap' ? record.kind : undefined;
  if (!kind) throw new Error('reduce digest issue has invalid kind');
  return { issueId: requiredString(record.issueId, 'reduce digest issue id'), kind, title: stringValue(record.title) ?? '', summary: requiredString(record.summary, 'reduce digest issue summary'), criterionIds: stringArrayValue(record.criterionIds), aspectIds: stringArrayValue(record.aspectIds), ...(stringArrayValue(record.sourceIds).length > 0 ? { sourceIds: stringArrayValue(record.sourceIds) } : {}), ...(record.representationRequired === true ? { representationRequired: true } : {}) };
}

function validateBytes(kind: string, id: string, value: string, maxBytes: number, errors: string[]): void {
  if (utf8ByteLength(value) > maxBytes) errors.push(`${kind} budget exceeded:${id}`);
}

function validateLinkedIds(kind: string, id: string, criterionIds: string[], aspectIds: string[], input: ValidatePlanningReduceDigestInput, errors: string[]): void {
  if (criterionIds.length === 0 || aspectIds.length === 0) errors.push(`${kind} must link criteria and aspects:${id}`);
  for (const criterionId of criterionIds) if (input.allowedCriterionIds && !input.allowedCriterionIds.includes(criterionId)) errors.push(`${kind} unknown criterion:${id}:${criterionId}`);
  for (const aspectId of aspectIds) if (input.allowedAspectIds && !input.allowedAspectIds.includes(aspectId)) errors.push(`${kind} unknown aspect:${id}:${aspectId}`);
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new Error(`${label} contains invalid object`);
}

function arrayValue(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
// Fail closed on present-but-invalid values: silently dropping a declaration would
// degrade toward fewer derived verification stages with no diagnostic.
function optionalLiteralValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T | undefined {
  if (value === undefined) return undefined;
  if (allowed.includes(value as T)) return value as T;
  throw new Error(`${label} contains invalid value`);
}
function stringValue(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function stringArrayValue(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
function requiredString(value: unknown, label: string): string {
  const text = stringValue(value);
  if (text === undefined) throw new Error(`Missing ${label}`);
  return text;
}

function nonEmptyOrFallback(values: string[], fallback: string): string[] {
  const filtered = values.filter((value) => value.trim().length > 0);
  return filtered.length > 0 ? filtered : [fallback];
}
