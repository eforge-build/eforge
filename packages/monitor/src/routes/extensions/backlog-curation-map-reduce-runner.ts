import { createHash } from 'node:crypto';
import {
  BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION,
  BACKLOG_CURATION_MAP_REDUCE_SCHEMA_VERSION,
  BACKLOG_CURATION_PACKET_MAX_BYTES,
  parseEforgePlanPlanningDraftResult,
  safeParseBacklogCurationMapReduceFinding,
  safeParseBacklogCurationMapReduceReducerInput,
  safeParseBacklogCurationMapReduceSourceBundle,
  safeParseWithSchema,
  BacklogCurationMapReduceFindingSchema,
  BacklogCurationMapReduceItemPacketSchema,
  EforgePlanPlanningDraftResultSchema,
  type BacklogCurationMapReduceFinding,
  type BacklogCurationMapReduceItemOutcome,
  type BacklogCurationMapReduceItemPacket,
  type BacklogCurationMapReduceReducerInput,
  type BacklogCurationMapReduceRuntimeIdentity,
  type BacklogCurationMapReduceSourceBundle,
  type EforgePlanPlanningDraftInput,
  type EforgePlanPlanningDraftResult,
  type ExtensionAgentTaskBacklogCurationProgress,
} from '@eforge-build/client';
import type { AgentHarness, CustomTool, SdkPassthroughConfig } from '@eforge-build/engine/harness';
import type { ToolbeltSummary } from '@eforge-build/engine/agent-runtime-registry';
import type { AgentRole } from '@eforge-build/engine/events';
import type { AgentTaskRegistration } from '@eforge-build/engine/extensions/index';
import { runResolvedAgentTask } from '@eforge-build/engine/agents/resolved-agent-task';
import type { ExtensionAgentTaskOwner } from './agent-task-store.js';
// --- eforge:region backlog-curation-map-reduce-runner ---
export interface BacklogCurationMapReduceProviderHooks {
  readBacklogCurationItemAuditCache?: (input: CacheKeyInput) => Promise<CacheReadResult>;
  writeBacklogCurationItemAuditCache?: (input: CacheKeyInput & { finding: BacklogCurationMapReduceFinding }) => Promise<unknown>;
  defaultBacklogCurationItemAuditPromptVersion?: () => string;
  buildBacklogCurationReducerInput?: (globalContext: BacklogCurationMapReduceSourceBundle['globalContext'], outcomes: readonly BacklogCurationMapReduceItemOutcome[], generatedAt?: string) => BacklogCurationMapReduceReducerInput;
  validateBacklogCurationPlanningDraftResult?: (cwd: string, result: EforgePlanPlanningDraftResult, context: { sourceFingerprint: string }) => Promise<string[]> | string[];
}
export interface BacklogCurationAgentTaskContributionHandle {
  contribution: AgentTaskRegistration;
  owner: ExtensionAgentTaskOwner;
  promptTemplate: string;
}

export interface EforgePlanPlanningProgressUpdate {
  currentSection?: string;
  coveredSections?: string[];
  remainingSections?: string[];
  message?: string;
}

export interface BacklogCurationMapReduceRunnerOptions extends SdkPassthroughConfig {
  cwd: string;
  taskId: string;
  input: EforgePlanPlanningDraftInput;
  harness: AgentHarness;
  resolvedHarness?: 'claude-sdk' | 'pi';
  harnessSource?: 'tier';
  sourceBundle: BacklogCurationMapReduceSourceBundle;
  providerHooks: BacklogCurationMapReduceProviderHooks;
  runtimeIdentity: BacklogCurationMapReduceRuntimeIdentity;
  itemAuditContribution: BacklogCurationAgentTaskContributionHandle;
  reducerContribution: BacklogCurationAgentTaskContributionHandle;
  itemAuditConcurrency?: number;
  abortController: AbortController;
  progress: (message: string) => Promise<void>;
  activity?: (message: string) => Promise<void>;
  backlogCurationProgress?: (progress: ExtensionAgentTaskBacklogCurationProgress) => Promise<void>;
  sectionProgress: (update: EforgePlanPlanningProgressUpdate) => Promise<void>;
}

interface CacheKeyInput {
  cwd: string;
  sourceFingerprint?: string;
  itemId?: string;
  packetSha256?: string;
  bodySha256?: string;
  promptVersion?: string;
  runtimeIdentity?: BacklogCurationMapReduceRuntimeIdentity;
}

type CacheReadResult = { hit: true; finding: BacklogCurationMapReduceFinding } | { hit: false; reason?: string };

async function emitActivity(options: BacklogCurationMapReduceRunnerOptions, message: string): Promise<void> {
  await (options.activity ?? options.progress)(message);
}

export function isBacklogCurationMapReduceBundle(value: unknown): value is BacklogCurationMapReduceSourceBundle {
  return safeParseBacklogCurationMapReduceSourceBundle(value).success;
}

export function resolveBacklogCurationMapReduceProviderHooks(moduleExports: Record<string, unknown>): BacklogCurationMapReduceProviderHooks {
  return {
    readBacklogCurationItemAuditCache: functionExport(moduleExports, 'readBacklogCurationItemAuditCache'),
    writeBacklogCurationItemAuditCache: functionExport(moduleExports, 'writeBacklogCurationItemAuditCache'),
    defaultBacklogCurationItemAuditPromptVersion: functionExport(moduleExports, 'defaultBacklogCurationItemAuditPromptVersion'),
    buildBacklogCurationReducerInput: functionExport(moduleExports, 'buildBacklogCurationReducerInput'),
    validateBacklogCurationPlanningDraftResult: functionExport(moduleExports, 'validateBacklogCurationPlanningDraftResult'),
  };
}

export function buildBacklogCurationRuntimeIdentity(config: SdkPassthroughConfig & { harness?: string; tier?: string; maxTurns?: number }, toolbeltSummary: ToolbeltSummary): BacklogCurationMapReduceRuntimeIdentity {
  const modelId = typeof config.model?.id === 'string' && config.model.id.length > 0 ? config.model.id : 'default-model';
  const provider = [String(config.harness ?? 'unknown-harness'), config.model?.provider].filter((entry): entry is string => typeof entry === 'string' && entry.length > 0).join(':');
  const profileParts = [
    config.tier !== undefined ? `tier=${config.tier}` : undefined,
    toolbeltSummary.toolbelt !== undefined ? `toolbelt=${toolbeltSummary.toolbelt ?? 'none'}` : undefined,
    config.maxTurns !== undefined ? `maxTurns=${config.maxTurns}` : undefined,
    config.effort !== undefined ? `effort=${config.effort}` : undefined,
    config.thinking?.type !== undefined ? `thinking=${config.thinking.type}` : undefined,
  ].filter((entry): entry is string => entry !== undefined);
  const agentProfile = profileParts.join(';').slice(0, 200);
  return { provider: provider || 'unknown-harness', modelId, ...(agentProfile.length > 0 && { agentProfile }) };
}

export async function runBacklogCurationMapReduceTask(options: BacklogCurationMapReduceRunnerOptions): Promise<EforgePlanPlanningDraftResult> {
  throwIfAborted(options.abortController.signal);
  const bundle = parseSourceBundle(options.sourceBundle);
  const progressTracker = createBacklogCurationProgressTracker(options, bundle);
  await emitActivity(options, 'Preparing map/reduce packets');
  await emitActivity(options, 'Preparing curation source');
  await progressTracker.emit();
  await emitActivity(options, `Built ${bundle.packets.length} item packets`);
  const promptVersion = options.providerHooks.defaultBacklogCurationItemAuditPromptVersion?.() ?? BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION;
  await emitActivity(options, 'Scanning item audit cache');
  const cached = await resolveCacheAndMisses(options, bundle.packets, promptVersion, progressTracker);
  progressTracker.setCacheCounts(cached.hits, cached.misses);
  await progressTracker.emit();
  await emitActivity(options, `Item audit cache scan complete: ${cached.hits} hits, ${cached.misses} misses`);
  await emitActivity(options, `Cache hits ${cached.hits}, misses ${cached.misses}`);
  await emitActivity(options, `Cache hit aggregate: ${cached.hits}`);
  await emitActivity(options, `Cache miss aggregate: ${cached.misses}`);
  await emitActivity(options, `Auditing ${cached.missPackets.length} item packets`);
  const audited = await auditMisses(options, cached.missPackets, promptVersion, cached.outcomes.length, bundle.packets.length, progressTracker);
  throwIfAborted(options.abortController.signal);
  const outcomes = [...bundle.degradedOutcomes, ...cached.outcomes, ...audited];
  await emitActivity(options, `Reducing ${outcomes.length} item outcomes`);
  const reducerInput = buildReducerInput(options, bundle, outcomes);
  await emitActivity(options, 'Running backlog curation reducer');
  await emitActivity(options, 'Validating curation draft');
  return await runReducer(options, reducerInput, outcomes);
}

type BacklogCurationProgressItem = ExtensionAgentTaskBacklogCurationProgress['items'][number];

interface BacklogCurationProgressTracker {
  emit: () => Promise<void>;
  setCacheCounts: (hits: number, misses: number) => void;
  markRunning: (packet: BacklogCurationMapReduceItemPacket) => Promise<void>;
  markOutcome: (outcome: BacklogCurationMapReduceItemOutcome) => Promise<void>;
}

function createBacklogCurationProgressTracker(options: BacklogCurationMapReduceRunnerOptions, bundle: BacklogCurationMapReduceSourceBundle): BacklogCurationProgressTracker {
  const items = new Map<string, BacklogCurationProgressItem>();
  for (const packet of bundle.packets) items.set(packet.itemId, { itemId: packet.itemId, ...(packet.itemTitle !== undefined && { title: packet.itemTitle }), status: 'pending' });
  for (const outcome of bundle.degradedOutcomes) items.set(outcome.itemId, itemFromOutcome(outcome));
  let cacheHits = 0;
  let misses = 0;
  const emit = async () => {
    if (options.backlogCurationProgress === undefined) return;
    const snapshotItems = [...items.values()];
    const completed = snapshotItems.filter((item) => item.status === 'cache-hit' || item.status === 'completed' || item.status === 'failed' || item.status === 'cancelled').length;
    const running = snapshotItems.filter((item) => item.status === 'running').length;
    await options.backlogCurationProgress({
      total: snapshotItems.length,
      cacheHits,
      misses,
      running,
      completed,
      remaining: Math.max(0, snapshotItems.length - completed - running),
      items: snapshotItems,
    });
  };
  return {
    emit,
    setCacheCounts: (hits, missCount) => { cacheHits = hits; misses = missCount; },
    markRunning: async (packet) => {
      const current = items.get(packet.itemId);
      items.set(packet.itemId, { ...current, itemId: packet.itemId, ...(packet.itemTitle !== undefined && { title: packet.itemTitle }), status: 'running', startedAt: new Date().toISOString() });
      await emit();
    },
    markOutcome: async (outcome) => {
      items.set(outcome.itemId, itemFromOutcome(outcome, items.get(outcome.itemId)));
      await emit();
    },
  };
}

function itemFromOutcome(outcome: BacklogCurationMapReduceItemOutcome, previous?: BacklogCurationProgressItem): BacklogCurationProgressItem {
  const finding = 'finding' in outcome ? outcome.finding : undefined;
  return {
    ...previous,
    itemId: outcome.itemId,
    status: outcomeStatus(outcome),
    outcome: outcome.outcome,
    ...(finding?.verdict !== undefined && { verdict: finding.verdict }),
    ...(finding?.summary !== undefined && { summary: finding.summary }),
    ...(previous?.startedAt !== undefined && { startedAt: previous.startedAt }),
    completedAt: new Date().toISOString(),
  };
}

function outcomeStatus(outcome: BacklogCurationMapReduceItemOutcome): BacklogCurationProgressItem['status'] {
  if (outcome.outcome === 'cache-hit') return 'cache-hit';
  if (outcome.outcome === 'audited-finding') return 'completed';
  if (outcome.outcome === 'cancelled') return 'cancelled';
  return 'failed';
}

async function resolveCacheAndMisses(options: BacklogCurationMapReduceRunnerOptions, packets: readonly BacklogCurationMapReduceItemPacket[], promptVersion: string, progressTracker: BacklogCurationProgressTracker): Promise<{ hits: number; misses: number; outcomes: BacklogCurationMapReduceItemOutcome[]; missPackets: BacklogCurationMapReduceItemPacket[] }> {
  const outcomes: BacklogCurationMapReduceItemOutcome[] = [];
  const missPackets: BacklogCurationMapReduceItemPacket[] = [];
  let hits = 0;
  for (const packet of packets) {
    throwIfAborted(options.abortController.signal);
    const packetSha256 = sha256Json(packet);
    const key = cacheKey(options, packet, packetSha256, promptVersion);
    let cache: CacheReadResult = { hit: false, reason: 'no-cache-hook' };
    try {
      cache = await options.providerHooks.readBacklogCurationItemAuditCache?.(key) ?? cache;
    } catch {
      cache = { hit: false, reason: 'cache-read-failed' };
    }
    if (cache.hit) {
      hits += 1;
      const outcome = outcomeFromFinding('cache-hit', cache.finding);
      outcomes.push(outcome);
      await progressTracker.markOutcome(outcome);
    } else {
      missPackets.push(packet);
    }
  }
  return { hits, misses: missPackets.length, outcomes, missPackets };
}

async function auditMisses(options: BacklogCurationMapReduceRunnerOptions, packets: readonly BacklogCurationMapReduceItemPacket[], promptVersion: string, completedBefore: number, totalPackets: number, progressTracker: BacklogCurationProgressTracker): Promise<BacklogCurationMapReduceItemOutcome[]> {
  if (packets.length === 0) return [];
  const concurrency = itemAuditConcurrency(options.itemAuditConcurrency);
  const outcomes = new Array<BacklogCurationMapReduceItemOutcome>(packets.length);
  let nextIndex = 0;
  let completed = completedBefore;
  await Promise.all(Array.from({ length: Math.min(concurrency, packets.length) }, async () => {
    while (nextIndex < packets.length) {
      const index = nextIndex;
      nextIndex += 1;
      const packet = packets[index]!;
      await progressTracker.markRunning(packet);
      outcomes[index] = await auditOnePacket(options, packet, promptVersion);
      await progressTracker.markOutcome(outcomes[index]!);
      completed += 1;
      await options.progress(`Audited ${Math.min(completed, totalPackets)}/${totalPackets} items`);
    }
  }));
  return outcomes;
}

async function auditOnePacket(options: BacklogCurationMapReduceRunnerOptions, packet: BacklogCurationMapReduceItemPacket, promptVersion: string): Promise<BacklogCurationMapReduceItemOutcome> {
  throwIfAborted(options.abortController.signal);
  const packetSha256 = sha256Json(packet);
  const parsedPacket = safeParseWithSchema(BacklogCurationMapReduceItemPacketSchema, packet);
  if (!parsedPacket.success) return invalidFindingOutcome(packet, [parsedPacket.error.message]);
  const byteLength = Buffer.byteLength(JSON.stringify(parsedPacket.data), 'utf-8');
  if (byteLength > BACKLOG_CURATION_PACKET_MAX_BYTES) return oversizedPacketOutcome(parsedPacket.data, packetSha256, byteLength);
  try {
    const result = await runRegisteredContributionTask({
      options,
      handle: options.itemAuditContribution,
      input: { packet, runtimeIdentity: options.runtimeIdentity, promptVersion },
      outputSchema: BacklogCurationMapReduceFindingSchema,
      promptLabel: `extension agent task ${options.itemAuditContribution.contribution.id}`,
      taskId: `${options.taskId}:${packet.itemId}`,
      stage: 'extension-agent-task:item-audit',
    });
    const normalizedFinding = isRecord(result) ? { ...result, runtimeIdentity: options.runtimeIdentity } : result;
    const parsedFinding = safeParseBacklogCurationMapReduceFinding(normalizedFinding);
    if (!parsedFinding.success) return invalidFindingOutcome(packet, parsedFinding.error.errors.map((error) => `${error.path}: ${error.message}`));
    const outcome = outcomeFromFinding('audited-finding', parsedFinding.data);
    try {
      await options.providerHooks.writeBacklogCurationItemAuditCache?.({ ...cacheKey(options, packet, packetSha256, promptVersion), finding: parsedFinding.data });
    } catch {
      outcome.diagnostics = [...outcome.diagnostics, { code: 'cache-write-failed', severity: 'warning', message: 'Item audit cache write failed; keeping audited finding.' }];
    }
    return outcome;
  } catch (error) {
    if (options.abortController.signal.aborted) throwIfAborted(options.abortController.signal);
    return failureOutcome(packet, packetSha256, error);
  }
}

function buildReducerInput(options: BacklogCurationMapReduceRunnerOptions, bundle: BacklogCurationMapReduceSourceBundle, outcomes: readonly BacklogCurationMapReduceItemOutcome[]): BacklogCurationMapReduceReducerInput {
  const reducerInput = options.providerHooks.buildBacklogCurationReducerInput?.(bundle.globalContext, outcomes, bundle.generatedAt)
    ?? { ...bundle.reducerInput, outcomes: [...outcomes] };
  const parsed = safeParseBacklogCurationMapReduceReducerInput(reducerInput);
  if (!parsed.success) throw new Error(`Invalid backlog curation reducer input: ${parsed.error.message}`);
  return parsed.data;
}

async function runReducer(options: BacklogCurationMapReduceRunnerOptions, reducerInput: BacklogCurationMapReduceReducerInput, sourceOutcomes: readonly BacklogCurationMapReduceItemOutcome[]): Promise<EforgePlanPlanningDraftResult> {
  const first = await runReducerAttempt(options, reducerInput, sourceOutcomes, undefined, `${options.taskId}:reducer`);
  if (first.errors.length === 0) return first.result;
  throwIfAborted(options.abortController.signal);
  const repairErrors = boundValidationErrors(first.errors);
  await emitActivity(options, 'Running reducer repair attempt');
  const second = await runReducerAttempt(options, reducerInput, sourceOutcomes, repairErrors, `${options.taskId}:reducer:repair`);
  if (second.errors.length === 0) return second.result;
  const omissions = terminalOmissionsForVisibility(reducerInput, sourceOutcomes);
  return omissionNeedsInputPlanningResult(omissions, [...repairErrors, ...second.errors], 'Reducer repair submission failed validation.');
}

async function runReducerAttempt(options: BacklogCurationMapReduceRunnerOptions, reducerInput: BacklogCurationMapReduceReducerInput, sourceOutcomes: readonly BacklogCurationMapReduceItemOutcome[], validationErrors: string[] | undefined, taskId: string): Promise<{ result: EforgePlanPlanningDraftResult; errors: string[] }> {
  let result: EforgePlanPlanningDraftResult;
  try {
    const rawResult = await runRegisteredContributionTask({
      options,
      handle: options.reducerContribution,
      input: { reducerInput, requestedOutputSections: options.input.requestedOutputSections, validationErrors: validationErrors ?? [] },
      outputSchema: EforgePlanPlanningDraftResultSchema,
      promptLabel: `extension agent task ${options.reducerContribution.contribution.id}`,
      taskId,
      stage: validationErrors === undefined ? 'extension-agent-task:reducer' : 'extension-agent-task:reducer-repair',
    });
    result = ensureTerminalOmissionVisibility(parseEforgePlanPlanningDraftResult(JSON.parse(JSON.stringify(rawResult))), reducerInput, sourceOutcomes);
  } catch (err) {
    if (options.abortController.signal.aborted) throwIfAborted(options.abortController.signal);
    const message = errorMessage(err);
    const omissions = terminalOmissionsForVisibility(reducerInput, sourceOutcomes);
    return { result: omissionNeedsInputPlanningResult(omissions, [message], 'Reducer submission failed validation.'), errors: [message] };
  }

  await emitActivity(options, validationErrors === undefined ? 'Validating reducer draft' : 'Validating repaired reducer draft');

  try {
    const errors = await validateReducerResult(options, result) ?? [];
    return { result, errors };
  } catch (err) {
    if (options.abortController.signal.aborted) throwIfAborted(options.abortController.signal);
    const message = errorMessage(err);
    const omissions = terminalOmissionsForVisibility(reducerInput, sourceOutcomes);
    return { result: omissionNeedsInputPlanningResult(omissions, [message], 'Reducer submission failed validation.'), errors: [message] };
  }
}

// --- eforge:region backlog-curation-terminal-omissions ---
function ensureTerminalOmissionVisibility(result: EforgePlanPlanningDraftResult, reducerInput: BacklogCurationMapReduceReducerInput, sourceOutcomes: readonly BacklogCurationMapReduceItemOutcome[]): EforgePlanPlanningDraftResult {
  const omissions = terminalOmissionsForVisibility(reducerInput, sourceOutcomes);
  const messages = chunkTerminalOmissionMessages(omissions);
  if (omissions.length === 0) return result;
  const draft = (result as { backlogCurationDraft?: { needsInput?: unknown[] } }).backlogCurationDraft;
  if (draft === undefined || !Array.isArray(draft.needsInput)) return omissionNeedsInputPlanningResult(omissions, [], 'Reducer input omitted protected terminal findings.');
  const next = JSON.parse(JSON.stringify(result)) as EforgePlanPlanningDraftResult & { backlogCurationDraft: { needsInput: Array<Record<string, unknown>> }; assumptionsOpenQuestions: string[] };
  const existingKeys = new Set(next.backlogCurationDraft.needsInput.map((entry) => `${String(entry.id ?? '')}:${String(entry.reason ?? '')}`));
  for (const omission of omissions) {
    const reason = `Protected terminal ${omission.verdict} finding omitted by reducer byte cap; split curation or rerun a smaller selection before applying closures.`, key = `${omission.itemId}:${reason}`;
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    next.backlogCurationDraft.needsInput.push({ kind: 'item', id: omission.itemId, question: `Review omitted ${omission.verdict} terminal curation candidate for ${omission.itemId}.`, reason });
  }
  next.assumptionsOpenQuestions = [...next.assumptionsOpenQuestions, ...messages].slice(0, 20);
  return parseEforgePlanPlanningDraftResult(next);
}

function omissionNeedsInputPlanningResult(omissions: readonly { itemId: string; verdict: 'shipped' | 'superseded' }[], validationErrors: string[], rationale: string): EforgePlanPlanningDraftResult {
  if (omissions.length === 0) return boundedNeedsInputPlanningResult(validationErrors, rationale);
  const omissionMessages = chunkTerminalOmissionMessages(omissions), boundedErrors = validationErrors.length > 0 ? boundValidationErrors(validationErrors) : [], assumptionsOpenQuestions = [...omissionMessages, ...boundedErrors];
  return { summary: 'Backlog curation reducer needs input before a safe draft can be produced.', assumptionsOpenQuestions, decision: 'needs-input', clarificationQuestions: [{ question: 'Review omitted protected terminal curation candidates before applying terminal closures.', why: omissionMessages[0] ?? 'Reducer byte caps omitted protected terminal findings.' }], rationale: `${rationale} ${omissionMessages[0] ?? 'Protected terminal findings were omitted by reducer byte caps.'}` };
}

function chunkTerminalOmissionMessages(omissions: readonly { itemId: string; verdict: 'shipped' | 'superseded' }[]): string[] {
  const prefix = 'Protected terminal findings omitted by reducer byte caps; split curation or review before applying terminal closures: ';
  const chunks: string[] = [];
  let names: string[] = [];
  for (const omission of omissions) {
    const candidateName = `${omission.itemId}:${omission.verdict}`;
    const candidateNames = [...names, candidateName];
    if (`${prefix}${candidateNames.join(', ')}`.length <= 1_800) names = candidateNames;
    else {
      if (names.length > 0) chunks.push(`${prefix}${names.join(', ')}`);
      names = [candidateName];
    }
  }
  if (names.length > 0) chunks.push(`${prefix}${names.join(', ')}`);
  return chunks;
}

function terminalOmissionsForVisibility(reducerInput: BacklogCurationMapReduceReducerInput, sourceOutcomes: readonly BacklogCurationMapReduceItemOutcome[]): Array<{ itemId: string; verdict: 'shipped' | 'superseded' }> {
  const retained = new Set(reducerInput.outcomes.map((outcome) => outcome.itemId));
  const omissions = [...terminalOmissionsFromReducerInput(reducerInput), ...sourceOutcomes.flatMap((outcome) => protectedTerminalOmissionFromOutcome(outcome, retained) ?? [])];
  const byKey = new Map(omissions.map((omission) => [`${omission.itemId}:${omission.verdict}`, omission]));
  return [...byKey.values()].sort((left, right) => left.itemId.localeCompare(right.itemId) || left.verdict.localeCompare(right.verdict));
}

function terminalOmissionsFromReducerInput(reducerInput: BacklogCurationMapReduceReducerInput): Array<{ itemId: string; verdict: 'shipped' | 'superseded' }> {
  return reducerInput.diagnostics.flatMap((diagnostic) => {
    if (diagnostic.code !== 'reducer-input-protected-terminal-omitted') return [];
    const fromPath = parseTerminalOmissionPath(diagnostic.path);
    if (fromPath !== undefined) return [fromPath];
    const fromChunk = parseTerminalOmissionMessage(diagnostic.message);
    if (fromChunk.length > 0) return fromChunk;
    const message = diagnostic.message ?? '';
    const verdict = message.includes('superseded') ? 'superseded' : message.includes('shipped') ? 'shipped' : undefined;
    const itemId = /(?:for|candidate:?|:)\s+([A-Za-z0-9_.:\-]+)/.exec(message)?.[1];
    return verdict !== undefined && itemId !== undefined ? [{ itemId, verdict }] : [];
  });
}

function parseTerminalOmissionMessage(message: string | undefined): Array<{ itemId: string; verdict: 'shipped' | 'superseded' }> {
  return (message?.match(/[A-Za-z0-9_.:-]+:(?:shipped|superseded)/g) ?? []).flatMap((entry) => {
    const separator = entry.lastIndexOf(':'), itemId = entry.slice(0, separator), verdict = entry.slice(separator + 1);
    return verdict === 'shipped' || verdict === 'superseded' ? [{ itemId, verdict }] : [];
  });
}

function protectedTerminalOmissionFromOutcome(outcome: BacklogCurationMapReduceItemOutcome, retained: Set<string>): { itemId: string; verdict: 'shipped' | 'superseded' } | undefined {
  if (retained.has(outcome.itemId) || (outcome.outcome !== 'cache-hit' && outcome.outcome !== 'audited-finding')) return undefined;
  const verdict = outcome.finding.verdict;
  return outcome.finding.disposition === 'change' && (verdict === 'shipped' || verdict === 'superseded') ? { itemId: outcome.itemId, verdict } : undefined;
}

function parseTerminalOmissionPath(path: string | undefined): { itemId: string; verdict: 'shipped' | 'superseded' } | undefined {
  const parts = path?.split('/') ?? [], verdict = parts.at(-1), itemId = parts.length >= 3 ? parts.slice(1, -1).join('/') : undefined;
  return (verdict === 'shipped' || verdict === 'superseded') && itemId !== undefined && itemId.length > 0 ? { itemId, verdict } : undefined;
}

// --- eforge:endregion backlog-curation-terminal-omissions ---

async function validateReducerResult(options: BacklogCurationMapReduceRunnerOptions, result: EforgePlanPlanningDraftResult): Promise<string[] | undefined> {
  const hook = options.providerHooks.validateBacklogCurationPlanningDraftResult;
  if (hook === undefined) return undefined;
  const expectedSourceFingerprint = options.sourceBundle.sourceFingerprint;
  const backlogCurationDraft = (result as { backlogCurationDraft?: { sourceFingerprint?: string } }).backlogCurationDraft;
  if (backlogCurationDraft !== undefined && backlogCurationDraft.sourceFingerprint !== expectedSourceFingerprint) {
    return [`backlogCurationDraft.sourceFingerprint must match ${expectedSourceFingerprint}.`];
  }
  const errors = await hook(options.cwd, result, { sourceFingerprint: expectedSourceFingerprint });
  const bounded = errors.slice(0, 12).map((error) => error.replace(/\s+/g, ' ').trim()).filter(Boolean).map((error) => error.slice(0, 500));
  return bounded.length > 0 ? bounded : undefined;
}

function parseSourceBundle(value: unknown): BacklogCurationMapReduceSourceBundle {
  const parsed = safeParseBacklogCurationMapReduceSourceBundle(value);
  if (!parsed.success) throw new Error(`Invalid backlog curation map/reduce source bundle: ${parsed.error.message}`);
  return parsed.data;
}

function cacheKey(options: BacklogCurationMapReduceRunnerOptions, packet: BacklogCurationMapReduceItemPacket, packetSha256: string, promptVersion: string): CacheKeyInput {
  return { cwd: options.cwd, sourceFingerprint: packet.sourceFingerprint, itemId: packet.itemId, packetSha256, bodySha256: packet.bodySha256, promptVersion, runtimeIdentity: options.runtimeIdentity };
}

function outcomeFromFinding(outcome: 'cache-hit' | 'audited-finding', finding: BacklogCurationMapReduceFinding): BacklogCurationMapReduceItemOutcome {
  return { schemaVersion: BACKLOG_CURATION_MAP_REDUCE_SCHEMA_VERSION, outcome, itemId: finding.itemId, sourceFingerprint: finding.sourceFingerprint, packetSha256: finding.packetSha256, bodySha256: finding.bodySha256, diagnostics: [], finding };
}

function failureOutcome(packet: BacklogCurationMapReduceItemPacket, packetSha256: string, error: unknown): BacklogCurationMapReduceItemOutcome {
  return { schemaVersion: BACKLOG_CURATION_MAP_REDUCE_SCHEMA_VERSION, outcome: 'item-agent-failure', itemId: packet.itemId, sourceFingerprint: packet.sourceFingerprint, packetSha256, bodySha256: packet.bodySha256, diagnostics: [{ code: 'item-agent-failure', severity: 'warning', message: 'Item audit agent failed; reducer will degrade this item.' }], error: errorMessage(error) };
}

function invalidFindingOutcome(packet: BacklogCurationMapReduceItemPacket, validationErrors: string[]): BacklogCurationMapReduceItemOutcome {
  return { schemaVersion: BACKLOG_CURATION_MAP_REDUCE_SCHEMA_VERSION, outcome: 'invalid-finding', itemId: packet.itemId, sourceFingerprint: packet.sourceFingerprint, packetSha256: sha256Json(packet), bodySha256: packet.bodySha256, diagnostics: [{ code: 'invalid-finding', severity: 'warning', message: 'Item audit finding failed validation.' }], validationErrors: validationErrors.slice(0, 12).map((error) => error.slice(0, 400)) };
}

function oversizedPacketOutcome(packet: BacklogCurationMapReduceItemPacket, packetSha256: string, byteLength: number): BacklogCurationMapReduceItemOutcome {
  return { schemaVersion: BACKLOG_CURATION_MAP_REDUCE_SCHEMA_VERSION, outcome: 'oversized-packet', itemId: packet.itemId, sourceFingerprint: packet.sourceFingerprint, packetSha256, bodySha256: packet.bodySha256, diagnostics: [{ code: 'oversized-packet', severity: 'warning', message: 'Item audit packet exceeded the runtime byte cap; reducer will degrade this item.' }], byteLength, byteCap: BACKLOG_CURATION_PACKET_MAX_BYTES };
}

function cancelledOutcome(packet: BacklogCurationMapReduceItemPacket, packetSha256: string): BacklogCurationMapReduceItemOutcome {
  return { schemaVersion: BACKLOG_CURATION_MAP_REDUCE_SCHEMA_VERSION, outcome: 'cancelled', itemId: packet.itemId, sourceFingerprint: packet.sourceFingerprint, packetSha256, bodySha256: packet.bodySha256, diagnostics: [{ code: 'item-audit-cancelled', severity: 'warning' }], reason: 'Task cancelled' };
}

async function runRegisteredContributionTask(options: {
  options: BacklogCurationMapReduceRunnerOptions;
  handle: BacklogCurationAgentTaskContributionHandle;
  input: Record<string, unknown>;
  outputSchema: Parameters<typeof safeParseWithSchema>[0];
  promptLabel: string;
  taskId: string;
  stage: string;
}): Promise<unknown> {
  const parsedInput = safeParseWithSchema(options.handle.contribution.value.inputSchema as Parameters<typeof safeParseWithSchema>[0], options.input);
  if (!parsedInput.success) throw new Error(`Task contribution input failed schema validation: ${parsedInput.error.message}`);
  const resolved = await resolveRegisteredContributionPrompt(options.handle, parsedInput.data as Record<string, unknown>, {
    signal: options.options.abortController.signal,
    effectiveCustomToolName: (name) => options.options.harness.effectiveCustomToolName(name),
    onProgress: options.options.sectionProgress,
  });
  const role = (resolved.run?.role ?? 'planner') as AgentRole;
  const customTools = (resolved.run?.tools ?? options.handle.contribution.value.tools ?? []).map(toCustomTool);
  const task = runResolvedAgentTask({
    ...options.options,
    promptTemplate: resolved.prompt && resolved.prompt.trim().length > 0 ? resolved.prompt : options.handle.promptTemplate,
    variables: resolved.variables,
    promptLabel: options.promptLabel,
    role,
    tools: resolved.run?.toolsPreset ?? 'read-only',
    customTools,
    abortController: options.options.abortController,
    taskId: options.taskId,
    phase: 'standalone',
    stage: options.stage,
    getResult: resolved.getResult ?? (() => undefined),
    missingResultMessage: resolved.missingResultMessage ?? `Task contribution ${options.handle.contribution.id} did not submit a result.`,
  });
  let next = await task.next();
  while (!next.done) next = await task.next();
  const output = JSON.parse(JSON.stringify(next.value));
  const parsedOutput = safeParseWithSchema(options.outputSchema, output);
  if (!parsedOutput.success) throw new Error(`Task contribution output failed schema validation: ${parsedOutput.error.message}`);
  return parsedOutput.data;
}

interface ResolvedRegisteredContributionPrompt {
  prompt?: string;
  variables?: Record<string, string>;
  run?: { role?: string; tools?: Array<CustomTool | ExtensionToolLike>; toolsPreset?: 'coding' | 'read-only' | 'none' };
  getResult?: () => unknown;
  missingResultMessage?: string;
}

interface ExtensionToolLike {
  name: string;
  description: string;
  inputSchema: object;
  handler: (input: unknown) => Promise<string> | string;
}

async function resolveRegisteredContributionPrompt(
  handle: BacklogCurationAgentTaskContributionHandle,
  input: Record<string, unknown>,
  hooks: { signal: AbortSignal; effectiveCustomToolName: (name: string) => string; onProgress: (update: EforgePlanPlanningProgressUpdate) => void | Promise<void> },
): Promise<ResolvedRegisteredContributionPrompt> {
  const resolver = handle.contribution.value.resolvePrompt;
  if (typeof resolver !== 'function') return { variables: stringifyPromptVariables(input), run: { tools: handle.contribution.value.tools?.map(toCustomTool) } };
  const raw = await resolver({ input, extensionName: handle.owner.extensionName, extensionPath: handle.owner.extensionPath, signal: hooks.signal, effectiveCustomToolName: hooks.effectiveCustomToolName, onProgress: hooks.onProgress } as never);
  if (!isRecord(raw)) return { variables: stringifyPromptVariables(input) };
  return {
    ...(typeof raw.prompt === 'string' && { prompt: raw.prompt }),
    variables: isStringRecord(raw.variables) ? raw.variables : stringifyPromptVariables(input),
    ...(isRecord(raw.run) && { run: raw.run as ResolvedRegisteredContributionPrompt['run'] }),
    ...(typeof raw.getResult === 'function' && { getResult: raw.getResult as () => unknown }),
    ...(typeof raw.missingResultMessage === 'string' && { missingResultMessage: raw.missingResultMessage }),
  };
}

function toCustomTool(tool: unknown): CustomTool {
  const candidate = tool as ExtensionToolLike;
  return { name: candidate.name, description: candidate.description, inputSchema: candidate.inputSchema as CustomTool['inputSchema'], handler: async (input: unknown) => String(await candidate.handler(input)) };
}

function stringifyPromptVariables(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function boundedNeedsInputPlanningResult(errors: string[], rationale: string): EforgePlanPlanningDraftResult {
  const boundedErrors = boundValidationErrors(errors);
  return {
    summary: 'Backlog curation reducer needs input before a safe draft can be produced.',
    assumptionsOpenQuestions: boundedErrors,
    decision: 'needs-input',
    clarificationQuestions: [{ question: 'Review the backlog curation reducer validation errors and decide how to proceed.', why: boundedErrors[0] ?? 'The reducer could not produce a valid planning result after one repair attempt.' }],
    rationale: `${rationale} ${boundedErrors[0] ?? 'No accepted reducer submission was produced.'}`,
  };
}

function boundValidationErrors(errors: string[], maxErrors = 12, maxBytes = 2_000): string[] {
  const bounded = errors.slice(0, maxErrors).map((error) => error.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, Math.max(80, Math.floor(maxBytes / Math.max(1, Math.min(errors.length, maxErrors))))));
  return bounded.length > 0 ? bounded : ['Reducer did not produce an accepted planning result.'];
}

function itemAuditConcurrency(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? Math.min(value, 8) : 4;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2_000) || 'Item audit failed.';
}

function sha256Json(value: unknown): string {
  const canonical = (entry: unknown): string => {
    if (Array.isArray(entry)) return `[${entry.map(canonical).join(',')}]`;
    if (entry && typeof entry === 'object') return `{${Object.keys(entry).sort().map((key) => `${JSON.stringify(key)}:${canonical((entry as Record<string, unknown>)[key])}`).join(',')}}`;
    return JSON.stringify(entry);
  };
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function functionExport<T extends (...args: never[]) => unknown>(moduleExports: Record<string, unknown>, name: string): T | undefined {
  return typeof moduleExports[name] === 'function' ? moduleExports[name] as T : undefined;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Backlog curation map/reduce task was aborted.');
}
// --- eforge:endregion backlog-curation-map-reduce-runner ---
