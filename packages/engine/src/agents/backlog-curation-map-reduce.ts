import { createHash } from 'node:crypto';
import {
  BACKLOG_CURATION_FINDING_MAX_BYTES,
  BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION,
  BACKLOG_CURATION_PACKET_MAX_BYTES,
  BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES,
  BACKLOG_CURATION_REPAIR_ERROR_MAX_BYTES,
  BACKLOG_CURATION_VALIDATION_ERRORS_MAX,
  BacklogCurationMapReduceFindingSchema,
  BacklogCurationMapReduceItemPacketSchema,
  safeParseBacklogCurationMapReduceFinding,
  safeParseBacklogCurationMapReduceReducerInput,
  safeParseWithSchema,
  type BacklogCurationMapReduceFinding,
  type BacklogCurationMapReduceItemPacket,
  type BacklogCurationMapReduceReducerInput,
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

export async function* runBacklogCurationItemAuditTask(
  options: BacklogCurationItemAuditTaskOptions,
): AsyncGenerator<EforgeEvent, BacklogCurationMapReduceFinding> {
  const packet = validatePacket(options.packet);
  const packetSha256 = sha256Json(packet);
  let submitted: BacklogCurationMapReduceFinding | undefined;
  const submitTool = createItemAuditSubmitTool(packet, packetSha256, (finding) => { submitted = finding; });
  const progressTool = createPlanningProgressTool(options.onProgress);
  const prompt = await loadPrompt('eforge-plan-backlog-curation-item-audit', {
    itemId: packet.itemId,
    sourceFingerprint: packet.sourceFingerprint,
    packetSha256,
    promptVersion: BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION,
    packetJson: JSON.stringify(packet, null, 2),
    submitTool: options.harness.effectiveCustomToolName(ITEM_AUDIT_SUBMIT_TOOL_NAME),
    progressTool: options.harness.effectiveCustomToolName(PLANNING_PROGRESS_TOOL_NAME),
  }, options.promptAppend);

  for await (const event of options.harness.run({
    prompt,
    cwd: options.cwd,
    maxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.planning,
    tools: 'none',
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
  accept: (finding: BacklogCurationMapReduceFinding) => void,
): CustomTool {
  let accepted = false;
  return {
    name: ITEM_AUDIT_SUBMIT_TOOL_NAME,
    description: 'Submit the compact backlog curation finding for the single supplied item packet. This is the only accepted output channel.',
    inputSchema: BacklogCurationMapReduceFindingSchema,
    handler: async (input: unknown) => {
      const parsed = safeParseBacklogCurationMapReduceFinding(input);
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
    jsonByteLength(finding) <= BACKLOG_CURATION_FINDING_MAX_BYTES ? undefined : `finding JSON exceeds ${BACKLOG_CURATION_FINDING_MAX_BYTES} bytes.`,
  ].filter((entry): entry is string => entry !== undefined);
  if (errors.length === 0) return undefined;
  return `Submission rejected: ${boundedRejectionMessage(errors.join('\n'))}\nFix the finding and call ${ITEM_AUDIT_SUBMIT_TOOL_NAME} again.`;
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
  if (Array.isArray(value)) return value.map(sanitizeReducerPromptInput);
  if (value === null || typeof value !== 'object') return value;
  const blockedKeys = new Set(['gitDelta', 'fullImplementationAudit', 'rawEvidence', 'rawBody', 'bodyMarkdown', 'fullBody']);
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !blockedKeys.has(key))
    .map(([key, child]) => [key, sanitizeReducerPromptInput(child)] as const);
  return Object.fromEntries(entries);
}
