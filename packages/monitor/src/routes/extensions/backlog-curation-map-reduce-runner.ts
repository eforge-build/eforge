import { createHash } from 'node:crypto';
import {
  BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION,
  BACKLOG_CURATION_MAP_REDUCE_SCHEMA_VERSION,
  BACKLOG_CURATION_PACKET_MAX_BYTES,
  BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES,
  parseEforgePlanPlanningDraftResult,
  safeParseBacklogCurationMapReduceFinding,
  safeParseBacklogCurationMapReduceReducerInput,
  safeParseBacklogCurationMapReduceSourceBundle,
  safeParseWithSchema,
  BacklogCurationMapReduceItemPacketSchema,
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
import type { AgentHarness, SdkPassthroughConfig } from '@eforge-build/engine/harness';
import type { ToolbeltSummary } from '@eforge-build/engine/agent-runtime-registry';
import type { EforgePlanPlanningProgressUpdate } from '@eforge-build/engine/agents/extension-planning-task';

// --- eforge:region backlog-curation-map-reduce-runner ---
export interface BacklogCurationMapReduceProviderHooks {
  readBacklogCurationItemAuditCache?: (input: CacheKeyInput) => Promise<CacheReadResult>;
  writeBacklogCurationItemAuditCache?: (input: CacheKeyInput & { finding: BacklogCurationMapReduceFinding }) => Promise<unknown>;
  defaultBacklogCurationItemAuditPromptVersion?: () => string;
  buildBacklogCurationReducerInput?: (globalContext: BacklogCurationMapReduceSourceBundle['globalContext'], outcomes: readonly BacklogCurationMapReduceItemOutcome[], generatedAt?: string) => BacklogCurationMapReduceReducerInput;
  validateBacklogCurationPlanningDraftResult?: (cwd: string, result: EforgePlanPlanningDraftResult, context: { sourceFingerprint: string }) => Promise<string[]> | string[];
}

export interface BacklogCurationMapReduceRunnerOptions extends SdkPassthroughConfig {
  cwd: string;
  taskId: string;
  input: EforgePlanPlanningDraftInput;
  harness: AgentHarness;
  sourceBundle: BacklogCurationMapReduceSourceBundle;
  providerHooks: BacklogCurationMapReduceProviderHooks;
  runtimeIdentity: BacklogCurationMapReduceRuntimeIdentity;
  itemAuditConcurrency?: number;
  abortController: AbortController;
  progress: (message: string) => Promise<void>;
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
  await options.progress('Preparing curation source');
  await progressTracker.emit();
  await options.progress(`Built ${bundle.packets.length} item packets`);
  const promptVersion = options.providerHooks.defaultBacklogCurationItemAuditPromptVersion?.() ?? BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION;
  const cached = await resolveCacheAndMisses(options, bundle.packets, promptVersion, progressTracker);
  progressTracker.setCacheCounts(cached.hits, cached.misses);
  await progressTracker.emit();
  await options.progress(`Cache hits ${cached.hits}, misses ${cached.misses}`);
  const audited = await auditMisses(options, cached.missPackets, promptVersion, cached.outcomes.length, bundle.packets.length, progressTracker);
  throwIfAborted(options.abortController.signal);
  const outcomes = [...bundle.degradedOutcomes, ...cached.outcomes, ...audited];
  await options.progress(`Reducing ${outcomes.length} item outcomes`);
  const reducerInput = buildReducerInput(options, bundle, outcomes);
  await options.progress('Validating curation draft');
  return await runReducer(options, reducerInput);
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
    const { runBacklogCurationItemAuditTask } = await import('@eforge-build/engine/agents/backlog-curation-map-reduce');
    const task = runBacklogCurationItemAuditTask({ ...options, packet, taskId: `${options.taskId}:${packet.itemId}`, phase: 'standalone', stage: 'extension-agent-task:item-audit', onProgress: options.sectionProgress });
    let next = await task.next();
    while (!next.done) next = await task.next();
    const normalizedFinding = isRecord(next.value) ? { ...next.value, runtimeIdentity: options.runtimeIdentity } : next.value;
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
  const bytes = Buffer.byteLength(JSON.stringify(parsed.data), 'utf-8');
  if (bytes > BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES) throw new Error(`Backlog curation reducer input is ${bytes} bytes; cap is ${BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES}.`);
  return parsed.data;
}

async function runReducer(options: BacklogCurationMapReduceRunnerOptions, reducerInput: BacklogCurationMapReduceReducerInput): Promise<EforgePlanPlanningDraftResult> {
  const { runBacklogCurationReducerTask } = await import('@eforge-build/engine/agents/backlog-curation-map-reduce');
  const task = runBacklogCurationReducerTask({
    ...options,
    reducerInput,
    requestedOutputSections: options.input.requestedOutputSections,
    taskId: `${options.taskId}:reducer`,
    phase: 'standalone',
    stage: 'extension-agent-task:reducer',
    onProgress: options.sectionProgress,
    validateResult: async (result) => validateReducerResult(options, result),
    repair: { enabled: true },
  });
  let next = await task.next();
  while (!next.done) next = await task.next();
  return parseEforgePlanPlanningDraftResult(JSON.parse(JSON.stringify(next.value)));
}

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
