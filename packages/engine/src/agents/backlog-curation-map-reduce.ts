import { createHash } from 'node:crypto';
import type { TObject } from '@sinclair/typebox';
import {
  BACKLOG_CURATION_FINDING_MAX_BYTES,
  BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION,
  BACKLOG_CURATION_PACKET_MAX_BYTES,
  BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES,
  BACKLOG_CURATION_REPAIR_ERROR_MAX_BYTES,
  BACKLOG_CURATION_VALIDATION_ERRORS_MAX,
  BacklogCurationMapReduceFindingSubmissionSchema,
  BacklogCurationMapReduceItemPacketSchema,
  safeParseBacklogCurationMapReduceFinding,
  safeParseBacklogCurationMapReduceReducerInput,
  safeParseWithSchema,
  type BacklogCurationMapReduceFinding,
  type BacklogCurationMapReduceItemPacket,
  type BacklogCurationMapReduceReducerInput,
  type BacklogCurationMapReduceRuntimeIdentity,
  type EforgePlanPlanningDraftResult,
} from '@eforge-build/client';
import type { AgentHarness, CustomTool, SdkPassthroughConfig } from '../harness.js';
import { pickSdkOptions } from '../harness.js';
import { DEFAULT_TIER_MAX_TURNS } from '../config.js';
import { isAlwaysYieldedAgentEvent, type EforgeEvent } from '../events.js';
import { loadPrompt } from '../prompts.js';
import {
  boundedRejectionMessage,
  createPlanningDraftSubmitTool,
  createPlanningProgressTool,
  planningDraftResultSchemaYaml,
  PLANNING_DRAFT_SUBMIT_TOOL_NAME,
  PLANNING_PROGRESS_TOOL_NAME,
  type EforgePlanPlanningProgressCallback,
  type PlanningDraftResultValidator,
} from './extension-planning-submit-tools.js';

export type BacklogCurationReducerValidationCallback = (result: EforgePlanPlanningDraftResult) => string[] | undefined | Promise<string[] | undefined>;

export interface BacklogCurationItemAuditTaskOptions extends SdkPassthroughConfig {
  harness: AgentHarness;
  cwd: string;
  packet: BacklogCurationMapReduceItemPacket;
  runtimeIdentity?: BacklogCurationMapReduceRuntimeIdentity;
  verbose?: boolean;
  abortController?: AbortController;
  maxTurns?: number;
  taskId?: string;
  onProgress?: EforgePlanPlanningProgressCallback;
}

export interface BacklogCurationReducerTaskOptions extends SdkPassthroughConfig {
  harness: AgentHarness;
  cwd: string;
  reducerInput: BacklogCurationMapReduceReducerInput;
  requestedOutputSections?: string[];
  verbose?: boolean;
  abortController?: AbortController;
  maxTurns?: number;
  taskId?: string;
  onProgress?: EforgePlanPlanningProgressCallback;
  validateResult?: BacklogCurationReducerValidationCallback;
  repair?: { enabled?: boolean; maxErrors?: number; maxErrorBytes?: number };
}

interface ReducerAttemptResult {
  submitted?: EforgePlanPlanningDraftResult;
  errors: string[];
}

const ITEM_AUDIT_SUBMIT_TOOL_NAME = 'submit_eforge_plan_backlog_item_finding';

function itemAuditSubmissionSchema(): TObject {
  return BacklogCurationMapReduceFindingSubmissionSchema;
}

export async function* runBacklogCurationItemAuditTask(
  options: BacklogCurationItemAuditTaskOptions,
): AsyncGenerator<EforgeEvent, BacklogCurationMapReduceFinding> {
  const packet = validatePacket(options.packet);
  const packetSha256 = sha256Json(packet);
  let submitted: BacklogCurationMapReduceFinding | undefined;
  const submitTool = createItemAuditSubmitTool(packet, packetSha256, options.runtimeIdentity, (finding) => { submitted = finding; });
  const progressTool = createPlanningProgressTool(options.onProgress);
  const prompt = await loadPrompt('eforge-plan-backlog-curation-item-audit', {
    itemId: packet.itemId,
    sourceFingerprint: packet.sourceFingerprint,
    packetSha256,
    promptVersion: BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION,
    runtimeIdentityJson: JSON.stringify(options.runtimeIdentity ?? null, null, 2),
    runtimeIdentityInstruction: options.runtimeIdentity === undefined
      ? 'Runtime identity was not provided by the server; include a valid `runtimeIdentity` in your submission.'
      : 'Runtime identity is server-owned; do not submit this field.',
    packetJson: JSON.stringify(packet, null, 2),
    submitTool: options.harness.effectiveCustomToolName(ITEM_AUDIT_SUBMIT_TOOL_NAME),
    progressTool: options.harness.effectiveCustomToolName(PLANNING_PROGRESS_TOOL_NAME),
  }, options.promptAppend);

  for await (const event of options.harness.run({
    prompt,
    cwd: options.cwd,
    maxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.planning,
    tools: 'read-only',
    customTools: [submitTool, progressTool],
    abortSignal: options.abortController?.signal,
    ...sdkOptionsWithCustomTools(options, [ITEM_AUDIT_SUBMIT_TOOL_NAME, PLANNING_PROGRESS_TOOL_NAME]),
  }, 'planner', options.taskId)) {
    if (isAlwaysYieldedAgentEvent(event) || options.verbose) yield event;
  }

  if (submitted === undefined) {
    throw new Error(`backlog curation item audit did not call ${options.harness.effectiveCustomToolName(ITEM_AUDIT_SUBMIT_TOOL_NAME)}.`);
  }
  return submitted;
}

export async function* runBacklogCurationReducerTask(
  options: BacklogCurationReducerTaskOptions,
): AsyncGenerator<EforgeEvent, EforgePlanPlanningDraftResult> {
  const reducerInput = validateReducerInput(options.reducerInput);
  const first = yield* runReducerAttempt(options, reducerInput, undefined);
  if (first.submitted !== undefined) return first.submitted;

  const repairEnabled = options.repair?.enabled ?? true;
  if (!repairEnabled) return boundedNeedsInputPlanningResult(first.errors, 'Reducer submission failed validation.');

  const repairErrors = boundValidationErrors(first.errors, options.repair?.maxErrors, options.repair?.maxErrorBytes);
  const second = yield* runReducerAttempt(options, reducerInput, repairErrors);
  if (second.submitted !== undefined) return second.submitted;
  return boundedNeedsInputPlanningResult([...repairErrors, ...second.errors], 'Reducer repair submission failed validation.');
}

export async function* runBacklogCurationReducerRepairTask(
  options: BacklogCurationReducerTaskOptions,
): AsyncGenerator<EforgeEvent, EforgePlanPlanningDraftResult> {
  return yield* runBacklogCurationReducerTask({ ...options, repair: { ...options.repair, enabled: true } });
}

export function boundedNeedsInputPlanningResult(errors: string[], rationale: string): EforgePlanPlanningDraftResult {
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

export function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf-8');
}

export function sha256Json(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function assertBacklogCurationItemPacketCaps(packet: BacklogCurationMapReduceItemPacket): BacklogCurationMapReduceItemPacket {
  return validatePacket(packet);
}

export function assertBacklogCurationReducerInputCaps(input: BacklogCurationMapReduceReducerInput): BacklogCurationMapReduceReducerInput {
  return validateReducerInput(input);
}

export const createBoundedBacklogCurationReducerNeedsInputResult = boundedNeedsInputPlanningResult;

function createItemAuditSubmitTool(
  packet: BacklogCurationMapReduceItemPacket,
  packetSha256: string,
  runtimeIdentity: BacklogCurationMapReduceRuntimeIdentity | undefined,
  accept: (finding: BacklogCurationMapReduceFinding) => void,
): CustomTool {
  let accepted = false;
  return {
    name: ITEM_AUDIT_SUBMIT_TOOL_NAME,
    description: 'Submit the compact backlog curation finding for the single supplied item packet. This is the only accepted output channel.',
    inputSchema: itemAuditSubmissionSchema(),
    handler: async (input: unknown) => {
      const submission = safeParseWithSchema(itemAuditSubmissionSchema(), input);
      if (!submission.success) return `Submission rejected: ${boundedRejectionMessage(submission.error.message)}\nFix the finding and call ${ITEM_AUDIT_SUBMIT_TOOL_NAME} again.`;
      const effectiveRuntimeIdentity = runtimeIdentity ?? submission.data.runtimeIdentity;
      const parsed = safeParseBacklogCurationMapReduceFinding({ ...submission.data, runtimeIdentity: effectiveRuntimeIdentity });
      if (!parsed.success) return `Submission rejected: ${boundedRejectionMessage(parsed.error.message)}\nFix the finding and call ${ITEM_AUDIT_SUBMIT_TOOL_NAME} again.`;
      const mismatch = validateFindingAgainstPacket(parsed.data, packet, packetSha256);
      if (mismatch !== undefined) return mismatch;
      if (accepted) return `Submission rejected: ${boundedRejectionMessage('A backlog curation item finding has already been accepted for this packet.')}`;
      accepted = true;
      accept(parsed.data);
      return 'Backlog curation item finding submitted successfully.';
    },
  };
}

function validateFindingAgainstPacket(
  finding: BacklogCurationMapReduceFinding,
  packet: BacklogCurationMapReduceItemPacket,
  packetSha256: string,
): string | undefined {
  const errors = [
    finding.sourceFingerprint === packet.sourceFingerprint ? undefined : `sourceFingerprint mismatch: expected ${packet.sourceFingerprint}.`,
    finding.itemId === packet.itemId ? undefined : `itemId mismatch: expected ${packet.itemId}.`,
    finding.packetSha256 === packetSha256 ? undefined : `packetSha256 mismatch: expected ${packetSha256}.`,
    finding.bodySha256 === packet.bodySha256 ? undefined : `bodySha256 mismatch: expected ${packet.bodySha256}.`,
    finding.promptVersion === BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION ? undefined : `promptVersion mismatch: expected ${BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION}.`,
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
  const bytes = jsonByteLength(parsed.data);
  if (bytes > BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES) throw new Error(`Backlog curation reducer input is ${bytes} bytes; cap is ${BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES}.`);
  return parsed.data;
}

async function* runReducerAttempt(
  options: BacklogCurationReducerTaskOptions,
  reducerInput: BacklogCurationMapReduceReducerInput,
  repairErrors: string[] | undefined,
): AsyncGenerator<EforgeEvent, ReducerAttemptResult> {
  const validation: PlanningDraftResultValidator = async (result) => options.validateResult?.(result);
  const submitState = createPlanningDraftSubmitTool({ validate: validation, successMessage: 'Backlog curation reducer result submitted successfully.' });
  const progressTool = createPlanningProgressTool(options.onProgress);
  const reducerInputJson = JSON.stringify(sanitizeReducerPromptInput(reducerInput), null, 2);
  if (jsonByteLength(reducerInputJson) > BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES) {
    throw new Error(`Backlog curation reducer prompt input exceeds ${BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES} bytes after sanitization.`);
  }
  const prompt = await loadPrompt('eforge-plan-backlog-curation-reducer', {
    reducerInputJson,
    requestedOutputSections: options.requestedOutputSections?.join(', ') ?? 'backlogCurationDraft, recommendations',
    validationErrors: JSON.stringify(repairErrors ?? [], null, 2),
    submitTool: options.harness.effectiveCustomToolName(PLANNING_DRAFT_SUBMIT_TOOL_NAME),
    progressTool: options.harness.effectiveCustomToolName(PLANNING_PROGRESS_TOOL_NAME),
    resultSchema: planningDraftResultSchemaYaml(),
  }, options.promptAppend);

  for await (const event of options.harness.run({
    prompt,
    cwd: options.cwd,
    maxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.planning,
    tools: 'none',
    customTools: [submitState.tool, progressTool],
    abortSignal: options.abortController?.signal,
    ...sdkOptionsWithCustomTools(options, [PLANNING_DRAFT_SUBMIT_TOOL_NAME, PLANNING_PROGRESS_TOOL_NAME]),
  }, 'planner', repairErrors === undefined ? options.taskId : `${options.taskId ?? 'backlog-curation-reducer'}:repair`)) {
    if (isAlwaysYieldedAgentEvent(event) || options.verbose) yield event;
  }

  const errors = submitState.getRejections();
  if (submitState.getSubmitted() === undefined && errors.length === 0) {
    errors.push(`Reducer did not call ${options.harness.effectiveCustomToolName(PLANNING_DRAFT_SUBMIT_TOOL_NAME)}.`);
  }
  return { submitted: submitState.getSubmitted(), errors };
}

function sdkOptionsWithCustomTools(options: SdkPassthroughConfig & { harness: AgentHarness }, customToolNames: string[]): Partial<SdkPassthroughConfig> {
  const effective = customToolNames.map((name) => options.harness.effectiveCustomToolName(name));
  const allowedTools = options.allowedTools === undefined ? undefined : [...new Set([...options.allowedTools, ...effective])];
  return pickSdkOptions({
    model: options.model,
    thinking: options.thinking,
    effort: options.effort,
    maxBudgetUsd: options.maxBudgetUsd,
    fallbackModel: options.fallbackModel,
    allowedTools,
    disallowedTools: options.disallowedTools,
    phase: options.phase,
    stage: options.stage,
  });
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
  const sanitized = stripBlockedReducerPromptKeys(value);
  return compactReducerPromptInput(sanitized);
}

function stripBlockedReducerPromptKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripBlockedReducerPromptKeys);
  if (value === null || typeof value !== 'object') return value;
  const blockedKeys = new Set(['gitDelta', 'fullImplementationAudit', 'rawEvidence', 'rawBody', 'bodyMarkdown', 'fullBody']);
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !blockedKeys.has(key))
    .map(([key, child]) => [key, stripBlockedReducerPromptKeys(child)] as const);
  return Object.fromEntries(entries);
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
    checkedPaths: compactCheckedPaths(value.checkedPaths),
    summary: typeof value.summary === 'string' ? truncateText(value.summary, 500) : value.summary,
    rationale: typeof value.rationale === 'string' ? truncateText(value.rationale, 900) : value.rationale,
    citations: compactCitations(value.citations),
    recommendationSignals: compactRecommendationSignals(value.recommendationSignals),
    diagnostics: compactDiagnostics(value.diagnostics, 4),
  };
}

function compactCitations(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  const priority = new Map<string, number>([['implementation', 0], ['product-surface', 1], ['replacement', 2], ['supporting', 3], ['current-source', 4]]);
  return [...value]
    .filter(isRecord)
    .sort((left, right) => (priority.get(String(left.kind)) ?? 9) - (priority.get(String(right.kind)) ?? 9))
    .slice(0, 6)
    .map((citation) => ({
      kind: citation.kind,
      source: typeof citation.source === 'string' ? truncateText(citation.source, 160) : citation.source,
      confidence: citation.confidence,
      path: typeof citation.path === 'string' ? truncateText(citation.path, 220) : citation.path,
      excerpt: typeof citation.excerpt === 'string' ? truncateText(citation.excerpt, 220) : citation.excerpt,
      matchedBy: Array.isArray(citation.matchedBy) ? compactStringArray(citation.matchedBy, 4, 80) : undefined,
    }));
}

function compactCheckedPaths(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).slice(0, 8).map((entry) => ({
    path: typeof entry.path === 'string' ? truncateText(entry.path, 240) : entry.path,
    reason: typeof entry.reason === 'string' ? truncateText(entry.reason, 180) : entry.reason,
  }));
}

function compactRecommendationSignals(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).slice(0, 3).map((signal) => ({
    source: signal.source,
    ref: signal.ref,
    signal: typeof signal.signal === 'string' ? truncateText(signal.signal, 220) : signal.signal,
  }));
}

function compactDiagnostics(value: unknown, maxItems: number): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).slice(0, maxItems).map((diagnostic) => ({
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
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 24))}…[truncated ${value.length}]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
