// --- eforge:region backlog-curation-agent-tasks ---
import { createHash } from 'node:crypto';
import {
  BACKLOG_CURATION_FINDING_MAX_BYTES,
  BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION,
  BACKLOG_CURATION_PACKET_MAX_BYTES,
  BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES,
  BACKLOG_CURATION_REPAIR_ERROR_MAX_BYTES,
  BACKLOG_CURATION_VALIDATION_ERRORS_MAX,
  BacklogCurationMapReduceFindingSchema,
  BacklogCurationMapReduceFindingSubmissionSchema,
  BacklogCurationMapReduceItemPacketSchema,
  BacklogCurationMapReduceReducerInputSchema,
  BacklogCurationMapReduceRuntimeIdentitySchema,
  EforgePlanPlanningDraftResultSchema,
  safeParseBacklogCurationMapReduceFinding,
  safeParseBacklogCurationMapReduceReducerInput,
  safeParseWithSchema,
  type BacklogCurationMapReduceFinding,
  type BacklogCurationMapReduceItemPacket,
  type BacklogCurationMapReduceReducerInput,
  type BacklogCurationMapReduceRuntimeIdentity,
  type EforgePlanPlanningDraftResult,
} from '@eforge-build/client';
import { Type, defineExtensionAgentTaskContribution, type ExtensionAgentTaskContribution, type ExtensionAgentTaskCustomTool, type ExtensionAgentTaskResolverContext } from '@eforge-build/extension-sdk';
import {
  boundedRejectionMessage,
  createPlanningDraftSubmitTool,
  createPlanningProgressTool,
  planningDraftResultSchemaYaml,
  PLANNING_DRAFT_SUBMIT_TOOL_NAME,
  PLANNING_PROGRESS_TOOL_NAME,
  type PlanningDraftResultValidator,
} from './planning-agent-tools.js';

export const BACKLOG_ITEM_AUDIT_TASK_ID = 'backlog-item-audit' as const;
export const BACKLOG_REDUCER_TASK_ID = 'backlog-reducer' as const;
export const ITEM_AUDIT_SUBMIT_TOOL_NAME = 'submit_eforge_plan_backlog_item_finding' as const;

const ITEM_AUDIT_PROMPT_ASSET = 'prompts/eforge-plan-backlog-curation-item-audit.md' as const;
const REDUCER_PROMPT_ASSET = 'prompts/eforge-plan-backlog-curation-reducer.md' as const;

export const BacklogCurationItemAuditTaskInputSchema = Type.Object({
  packet: BacklogCurationMapReduceItemPacketSchema,
  runtimeIdentity: Type.Optional(BacklogCurationMapReduceRuntimeIdentitySchema),
  promptVersion: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const BacklogCurationReducerTaskInputSchema = Type.Object({
  reducerInput: BacklogCurationMapReduceReducerInputSchema,
  requestedOutputSections: Type.Optional(Type.Array(Type.String())),
  validationErrors: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: false });

export interface BacklogCurationItemAuditTaskInput {
  packet: BacklogCurationMapReduceItemPacket;
  runtimeIdentity?: BacklogCurationMapReduceRuntimeIdentity;
  promptVersion?: string;
}

export interface BacklogCurationReducerTaskInput {
  reducerInput: BacklogCurationMapReduceReducerInput;
  requestedOutputSections?: string[];
  validationErrors?: string[];
}

interface ItemAuditResolverContext extends ExtensionAgentTaskResolverContext<BacklogCurationItemAuditTaskInput> {}

interface ReducerResolverContext extends ExtensionAgentTaskResolverContext<BacklogCurationReducerTaskInput> {
  validateResult?: PlanningDraftResultValidator;
}

export function resolveBacklogItemAuditAgentTask(ctx: ItemAuditResolverContext): {
  prompt: string;
  variables: Record<string, string>;
  run: { role: 'planner'; toolsPreset: 'read-only'; tools: ExtensionAgentTaskCustomTool[] };
  getResult: () => BacklogCurationMapReduceFinding | undefined;
  missingResultMessage: string;
} {
  const packet = validatePacket(ctx.input.packet);
  const packetSha256 = sha256Json(packet);
  const promptVersion = ctx.input.promptVersion ?? BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION;
  let submitted: BacklogCurationMapReduceFinding | undefined;
  const submitTool = createItemAuditSubmitTool(packet, packetSha256, promptVersion, ctx.input.runtimeIdentity, (finding) => { submitted = finding; });
  const progressTool = createPlanningProgressTool(ctx.onProgress);
  const effectiveToolName = ctx.effectiveCustomToolName ?? ((name: string) => name);
  return {
    prompt: '',
    variables: {
      itemId: packet.itemId,
      sourceFingerprint: packet.sourceFingerprint,
      packetSha256,
      promptVersion,
      runtimeIdentityJson: JSON.stringify(ctx.input.runtimeIdentity ?? null, null, 2),
      runtimeIdentityInstruction: ctx.input.runtimeIdentity === undefined
        ? 'Runtime identity was not provided by the server; include a valid `runtimeIdentity` in your submission.'
        : 'Runtime identity is server-owned; do not submit this field.',
      packetJson: JSON.stringify(packet, null, 2),
      submitTool: effectiveToolName(ITEM_AUDIT_SUBMIT_TOOL_NAME),
      progressTool: effectiveToolName(PLANNING_PROGRESS_TOOL_NAME),
    },
    run: { role: 'planner', toolsPreset: 'read-only', tools: [submitTool, progressTool] },
    getResult: () => submitted,
    missingResultMessage: `backlog curation item audit did not call ${effectiveToolName(ITEM_AUDIT_SUBMIT_TOOL_NAME)}.`,
  };
}

export function resolveBacklogReducerAgentTask(ctx: ReducerResolverContext): {
  prompt: string;
  variables: Record<string, string>;
  run: { role: 'planner'; toolsPreset: 'none'; tools: ExtensionAgentTaskCustomTool[] };
  getResult: () => EforgePlanPlanningDraftResult | undefined;
  missingResultMessage: string;
} {
  const reducerInput = validateReducerInput(ctx.input.reducerInput);
  const submitState = createPlanningDraftSubmitTool({ validate: ctx.validateResult, successMessage: 'Backlog curation reducer result submitted successfully.' });
  const progressTool = createPlanningProgressTool(ctx.onProgress);
  const reducerInputJson = JSON.stringify(sanitizeReducerPromptInput(reducerInput), null, 2);
  if (jsonByteLength(reducerInputJson) > BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES) {
    throw new Error(`Backlog curation reducer prompt input exceeds ${BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES} bytes after sanitization.`);
  }
  const effectiveToolName = ctx.effectiveCustomToolName ?? ((name: string) => name);
  return {
    prompt: '',
    variables: {
      reducerInputJson,
      requestedOutputSections: ctx.input.requestedOutputSections?.join(', ') ?? 'backlogCurationDraft, recommendations',
      validationErrors: JSON.stringify(ctx.input.validationErrors ?? [], null, 2),
      submitTool: effectiveToolName(PLANNING_DRAFT_SUBMIT_TOOL_NAME),
      progressTool: effectiveToolName(PLANNING_PROGRESS_TOOL_NAME),
      resultSchema: planningDraftResultSchemaYaml(),
    },
    run: { role: 'planner', toolsPreset: 'none', tools: [submitState.tool, progressTool] },
    getResult: submitState.getSubmitted,
    missingResultMessage: `Reducer did not call ${effectiveToolName(PLANNING_DRAFT_SUBMIT_TOOL_NAME)}.`,
  };
}

export function createBoundedBacklogCurationReducerNeedsInputResult(errors: string[], rationale: string): EforgePlanPlanningDraftResult {
  const boundedErrors = boundValidationErrors(errors);
  return {
    summary: 'Backlog curation reducer needs input before a safe draft can be produced.',
    assumptionsOpenQuestions: boundedErrors,
    decision: 'needs-input',
    clarificationQuestions: [{
      question: 'Review the backlog curation reducer validation errors and decide how to proceed.',
      why: boundedErrors[0] ?? 'The reducer could not produce a valid planning result after one repair attempt.',
    }],
    rationale: `${rationale} ${boundedErrors[0] ?? 'No accepted reducer submission was produced.'}`,
  };
}

export function boundBacklogCurationReducerValidationErrors(errors: string[], maxErrors: number = BACKLOG_CURATION_VALIDATION_ERRORS_MAX, maxBytes: number = BACKLOG_CURATION_REPAIR_ERROR_MAX_BYTES): string[] {
  return boundValidationErrors(errors, maxErrors, maxBytes);
}

export function sha256Json(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf-8');
}

function createItemAuditSubmitTool(
  packet: BacklogCurationMapReduceItemPacket,
  packetSha256: string,
  promptVersion: string,
  runtimeIdentity: BacklogCurationMapReduceRuntimeIdentity | undefined,
  accept: (finding: BacklogCurationMapReduceFinding) => void,
): ExtensionAgentTaskCustomTool {
  let accepted = false;
  return {
    name: ITEM_AUDIT_SUBMIT_TOOL_NAME,
    description: 'Submit the compact backlog curation finding for the single supplied item packet. This is the only accepted output channel.',
    inputSchema: BacklogCurationMapReduceFindingSubmissionSchema,
    handler: async (input: unknown) => {
      const submission = safeParseWithSchema(BacklogCurationMapReduceFindingSubmissionSchema, input);
      if (!submission.success) return `Submission rejected: ${boundedRejectionMessage(submission.error.message)}\nFix the finding and call ${ITEM_AUDIT_SUBMIT_TOOL_NAME} again.`;
      const effectiveRuntimeIdentity = runtimeIdentity ?? submission.data.runtimeIdentity;
      const parsed = safeParseBacklogCurationMapReduceFinding({ ...submission.data, runtimeIdentity: effectiveRuntimeIdentity });
      if (!parsed.success) return `Submission rejected: ${boundedRejectionMessage(parsed.error.message)}\nFix the finding and call ${ITEM_AUDIT_SUBMIT_TOOL_NAME} again.`;
      const mismatch = validateFindingAgainstPacket(parsed.data, packet, packetSha256, promptVersion);
      if (mismatch !== undefined) return mismatch;
      if (accepted) return `Submission rejected: ${boundedRejectionMessage('A backlog curation item finding has already been accepted for this packet.')}`;
      accepted = true;
      accept(parsed.data);
      return 'Backlog curation item finding submitted successfully.';
    },
  } as ExtensionAgentTaskCustomTool;
}

function validateFindingAgainstPacket(finding: BacklogCurationMapReduceFinding, packet: BacklogCurationMapReduceItemPacket, packetSha256: string, promptVersion: string): string | undefined {
  const errors = [
    finding.sourceFingerprint === packet.sourceFingerprint ? undefined : `sourceFingerprint mismatch: expected ${packet.sourceFingerprint}.`,
    finding.itemId === packet.itemId ? undefined : `itemId mismatch: expected ${packet.itemId}.`,
    finding.packetSha256 === packetSha256 ? undefined : `packetSha256 mismatch: expected ${packetSha256}.`,
    finding.bodySha256 === packet.bodySha256 ? undefined : `bodySha256 mismatch: expected ${packet.bodySha256}.`,
    finding.promptVersion === promptVersion ? undefined : `promptVersion mismatch: expected ${promptVersion}.`,
    ...validateCurrentSourceFindingShape(finding),
    jsonByteLength(finding) <= BACKLOG_CURATION_FINDING_MAX_BYTES ? undefined : `finding JSON exceeds ${BACKLOG_CURATION_FINDING_MAX_BYTES} bytes.`,
  ].filter((entry): entry is string => entry !== undefined);
  if (errors.length === 0) return undefined;
  return `Submission rejected: ${boundedRejectionMessage(errors.join('\n'))}\nFix the finding and call ${ITEM_AUDIT_SUBMIT_TOOL_NAME} again.`;
}

function validateCurrentSourceFindingShape(finding: BacklogCurationMapReduceFinding): string[] {
  const errors = [
    finding.verdict === undefined ? 'verdict is required for current-source item audit findings.' : undefined,
    (finding.checkedPaths?.length ?? 0) === 0 ? 'checkedPaths must include at least one source path inspected by the read-only item audit.' : undefined,
  ];
  if (finding.verdict === 'shipped' || finding.verdict === 'superseded') {
    const roles = new Set(finding.closureEvidenceRoles ?? []);
    if (!roles.has('implementation') && !roles.has('replacement')) errors.push('shipped/superseded findings require implementation or replacement closureEvidenceRoles.');
    if (!roles.has('product-surface')) errors.push('shipped/superseded findings require product-surface closureEvidenceRoles.');
  }
  return errors.filter((entry): entry is string => entry !== undefined);
}

function validatePacket(packet: BacklogCurationMapReduceItemPacket): BacklogCurationMapReduceItemPacket {
  const parsed = safeParseWithSchema(BacklogCurationMapReduceItemPacketSchema, packet);
  if (!parsed.success) throw new Error(`Invalid backlog curation item packet: ${parsed.error.message}`);
  const bytes = jsonByteLength(parsed.data);
  if (bytes > BACKLOG_CURATION_PACKET_MAX_BYTES) throw new Error(`Backlog curation item packet is ${bytes} bytes; cap is ${BACKLOG_CURATION_PACKET_MAX_BYTES}.`);
  return parsed.data;
}

function validateReducerInput(input: BacklogCurationMapReduceReducerInput): BacklogCurationMapReduceReducerInput {
  const parsed = safeParseBacklogCurationMapReduceReducerInput(input);
  if (!parsed.success) throw new Error(`Invalid backlog curation reducer input: ${parsed.error.message}`);
  return parsed.data;
}

function boundValidationErrors(errors: string[], maxErrors: number = BACKLOG_CURATION_VALIDATION_ERRORS_MAX, maxBytes: number = BACKLOG_CURATION_REPAIR_ERROR_MAX_BYTES): string[] {
  const bounded = errors.slice(0, maxErrors).map((error) => boundedRejectionMessage(error, Math.max(80, Math.floor(maxBytes / Math.max(1, Math.min(errors.length, maxErrors))))));
  return bounded.length > 0 ? bounded : ['Reducer did not produce an accepted planning result.'];
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sanitizeReducerPromptInput(value: unknown): unknown {
  return compactReducerPromptInput(stripBlockedReducerPromptKeys(value));
}

function stripBlockedReducerPromptKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripBlockedReducerPromptKeys);
  if (value === null || typeof value !== 'object') return value;
  const blockedKeys = new Set(['gitDelta', 'fullImplementationAudit', 'rawEvidence', 'rawBody', 'bodyMarkdown', 'fullBody']);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !blockedKeys.has(key))
    .map(([key, child]) => [key, stripBlockedReducerPromptKeys(child)]));
}

function compactReducerPromptInput(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.outcomes) || !isRecord(value.globalContext)) return value;
  return {
    schemaVersion: value.schemaVersion,
    sourceFingerprint: value.sourceFingerprint,
    generatedAt: value.generatedAt,
    globalContext: compactReducerGlobalContext(value.globalContext),
    outcomes: value.outcomes.map(compactReducerOutcome),
    diagnostics: compactDiagnostics(value.diagnostics, 20),
  };
}

function compactReducerGlobalContext(value: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: value.schemaVersion,
    purpose: value.purpose,
    sourceFingerprint: value.sourceFingerprint,
    generatedAt: value.generatedAt,
    curationGuidance: compactStringArray(value.curationGuidance, 6, 500),
    caps: value.caps,
    itemCount: value.itemCount,
    openItemIds: value.openItemIds,
    roadmapSummaries: compactObjectArray(value.roadmapSummaries, 10, 300),
    dependencySummaries: compactObjectArray(value.dependencySummaries, 30, 300),
    recommendationSummaries: compactObjectArray(value.recommendationSummaries, 30, 300),
    redraftSummary: compactJsonValue(value.redraftSummary, 300),
    diagnostics: compactDiagnostics(value.diagnostics, 20),
  };
}

function compactReducerOutcome(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const compact: Record<string, unknown> = {
    schemaVersion: value.schemaVersion,
    outcome: value.outcome,
    itemId: value.itemId,
    sourceFingerprint: value.sourceFingerprint,
    packetSha256: value.packetSha256,
    bodySha256: value.bodySha256,
    diagnostics: compactDiagnostics(value.diagnostics, 4),
  };
  if (isRecord(value.finding)) compact.finding = compactFindingForReducerPrompt(value.finding);
  if (typeof value.error === 'string') compact.error = truncateText(value.error, 500);
  if (Array.isArray(value.validationErrors)) compact.validationErrors = compactStringArray(value.validationErrors, BACKLOG_CURATION_VALIDATION_ERRORS_MAX, 300);
  if (typeof value.reason === 'string') compact.reason = truncateText(value.reason, 300);
  if (typeof value.byteLength === 'number') compact.byteLength = value.byteLength;
  if (typeof value.byteCap === 'number') compact.byteCap = value.byteCap;
  return compact;
}

function compactFindingForReducerPrompt(value: Record<string, unknown>): Record<string, unknown> {
  const protectedTerminal = value.disposition === 'change' && (value.verdict === 'shipped' || value.verdict === 'superseded');
  return {
    schemaVersion: value.schemaVersion,
    itemId: value.itemId,
    sourceFingerprint: value.sourceFingerprint,
    packetSha256: value.packetSha256,
    bodySha256: value.bodySha256,
    promptVersion: value.promptVersion,
    disposition: value.disposition,
    verdict: value.verdict,
    closureEvidenceRoles: value.closureEvidenceRoles,
    checkedPaths: compactCheckedPaths(value.checkedPaths, protectedTerminal ? 10 : 8),
    summary: typeof value.summary === 'string' ? truncateText(value.summary, protectedTerminal ? 800 : 500) : value.summary,
    rationale: typeof value.rationale === 'string' ? truncateText(value.rationale, protectedTerminal ? 1_200 : 900) : value.rationale,
    citations: compactCitations(value.citations, protectedTerminal ? 8 : 6),
    recommendationSignals: protectedTerminal ? [] : compactRecommendationSignals(value.recommendationSignals),
    diagnostics: compactDiagnostics(value.diagnostics, protectedTerminal ? 2 : 4),
  };
}

function compactCitations(value: unknown, maxItems: number): unknown[] {
  if (!Array.isArray(value)) return [];
  return [...value].filter(isRecord).sort((left, right) => citationPriority(left) - citationPriority(right)).slice(0, maxItems).map((citation) => ({
    kind: citation.kind,
    source: typeof citation.source === 'string' ? truncateText(citation.source, 160) : citation.source,
    confidence: citation.confidence,
    path: typeof citation.path === 'string' ? truncateText(citation.path, 220) : citation.path,
    excerpt: typeof citation.excerpt === 'string' ? truncateText(citation.excerpt, 220) : citation.excerpt,
    matchedBy: Array.isArray(citation.matchedBy) ? compactStringArray(citation.matchedBy, 4, 80) : undefined,
  }));
}

function citationPriority(citation: Record<string, unknown>): number {
  if (citation.kind === 'implementation' || (Array.isArray(citation.matchedBy) && citation.matchedBy.includes('replacement'))) return 0;
  if (citation.kind === 'product-surface') return 2;
  if (citation.kind === 'supporting') return 3;
  if (citation.kind === 'current-source') return 4;
  return 9;
}

function compactCheckedPaths(value: unknown, maxItems: number): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).slice(0, maxItems).map((entry) => ({
    path: typeof entry.path === 'string' ? truncateText(entry.path, 240) : entry.path,
    reason: typeof entry.reason === 'string' ? truncateText(entry.reason, 180) : entry.reason,
  }));
}

function compactRecommendationSignals(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).slice(0, 3).map((signal) => ({ source: signal.source, ref: signal.ref, signal: typeof signal.signal === 'string' ? truncateText(signal.signal, 220) : signal.signal }));
}

function compactDiagnostics(value: unknown, maxItems: number): unknown[] {
  if (!Array.isArray(value)) return [];
  const diagnostics = value.filter(isRecord);
  const terminalOmissions = diagnostics.filter((diagnostic) => diagnostic.code === 'reducer-input-protected-terminal-omitted' || diagnostic.code === 'reducer-input-protected-terminal-omitted-too-many');
  const others = diagnostics.filter((diagnostic) => diagnostic.code !== 'reducer-input-protected-terminal-omitted' && diagnostic.code !== 'reducer-input-protected-terminal-omitted-too-many');
  return [...terminalOmissions, ...others].slice(0, maxItems).map((diagnostic) => ({
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: typeof diagnostic.message === 'string' ? truncateText(diagnostic.message, 220) : diagnostic.message,
    path: typeof diagnostic.path === 'string' ? truncateText(diagnostic.path, 180) : diagnostic.path,
  }));
}

function compactObjectArray(value: unknown, maxItems: number, maxStringLength: number): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map((entry) => compactJsonValue(entry, maxStringLength));
}

function compactStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => typeof entry === 'string' ? [truncateText(entry, maxLength)] : []).slice(0, maxItems);
}

function compactJsonValue(value: unknown, maxStringLength: number): unknown {
  if (typeof value === 'string') return truncateText(value, maxStringLength);
  if (Array.isArray(value)) return value.slice(0, 12).map((entry) => compactJsonValue(entry, maxStringLength));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, child]) => [key, compactJsonValue(child, maxStringLength)]));
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 24))}…[truncated ${value.length}]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

type ItemAuditContribution = ExtensionAgentTaskContribution<typeof BacklogCurationItemAuditTaskInputSchema, typeof BacklogCurationMapReduceFindingSchema>;
type ReducerContribution = ExtensionAgentTaskContribution<typeof BacklogCurationReducerTaskInputSchema, typeof EforgePlanPlanningDraftResultSchema>;

export const backlogCurationAgentTasks = [
  defineExtensionAgentTaskContribution({
    id: BACKLOG_ITEM_AUDIT_TASK_ID,
    title: 'Audit one backlog item for eforge-plan curation',
    description: 'Inspect current source with read-only tools and submit one compact source-backed backlog item finding.',
    inputSchema: BacklogCurationItemAuditTaskInputSchema,
    outputSchema: BacklogCurationMapReduceFindingSchema,
    prompt: { kind: 'asset', asset: ITEM_AUDIT_PROMPT_ASSET },
    resolvePrompt: resolveBacklogItemAuditAgentTask,
  }) as ItemAuditContribution,
  defineExtensionAgentTaskContribution({
    id: BACKLOG_REDUCER_TASK_ID,
    title: 'Reduce eforge-plan backlog curation findings',
    description: 'Reduce compact map outcomes into the eforge-plan planning draft result shape without repository tools.',
    inputSchema: BacklogCurationReducerTaskInputSchema,
    outputSchema: EforgePlanPlanningDraftResultSchema,
    prompt: { kind: 'asset', asset: REDUCER_PROMPT_ASSET },
    resolvePrompt: resolveBacklogReducerAgentTask,
  }) as ReducerContribution,
] as const;
// --- eforge:endregion backlog-curation-agent-tasks ---
