import {
  BACKLOG_CURATION_CITATIONS_PER_ITEM_MAX,
  BACKLOG_CURATION_DEPENDENCY_FACTS_PER_ITEM_MAX,
  BACKLOG_CURATION_DIAGNOSTICS_PER_PACKET_MAX,
  BACKLOG_CURATION_HISTORICAL_HINTS_PER_ITEM_MAX,
  BACKLOG_CURATION_MAP_REDUCE_SCHEMA_VERSION,
  BACKLOG_CURATION_PACKET_MAX_BYTES,
  BACKLOG_CURATION_PACKET_MAX_COUNT,
  BACKLOG_CURATION_RECOMMENDATION_SIGNALS_PER_ITEM_MAX,
  BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES,
  type BacklogCurationMapReduceCapDiagnostic,
  type BacklogCurationMapReduceCitation,
  type BacklogCurationMapReduceDependencyFact,
  type BacklogCurationMapReduceDiagnostic,
  type BacklogCurationMapReduceGlobalContext,
  type BacklogCurationMapReduceFinding,
  type BacklogCurationMapReduceHistoricalHint,
  type BacklogCurationMapReduceItemOutcome,
  type BacklogCurationMapReduceItemPacket,
  type BacklogCurationMapReduceRecommendationSignal,
  type BacklogCurationMapReduceReducerInput,
  type BacklogCurationMapReduceSourceBundle,
} from '@eforge-build/client';
import { canonicalJson, sha256 } from './markdown-store-support.js';

// --- eforge:region packet-builders ---
interface PacketBuildResult {
  packet?: BacklogCurationMapReduceItemPacket;
  degradedOutcome?: BacklogCurationMapReduceItemOutcome;
}

export function buildBacklogCurationMapReduceSourceBundle(source: Record<string, unknown>): BacklogCurationMapReduceSourceBundle {
  const sourceFingerprint = stringValue(source.sourceFingerprint);
  if (!sourceFingerprint) throw new Error('Backlog curation source is missing sourceFingerprint.');
  const generatedAt = typeof source.generatedAt === 'string' ? source.generatedAt : undefined;
  const itemRecords = arrayOfRecords(source.openItems);
  if (itemRecords.length > BACKLOG_CURATION_PACKET_MAX_COUNT) throw new Error(`Backlog curation source has ${itemRecords.length} open items; cap is ${BACKLOG_CURATION_PACKET_MAX_COUNT}.`);
  const results = itemRecords.map((item) => buildBacklogCurationItemPacket(source, item, sourceFingerprint));
  const packets = results.flatMap((result) => result.packet === undefined ? [] : [result.packet]);
  const degradedOutcomes = results.flatMap((result) => result.degradedOutcome === undefined ? [] : [result.degradedOutcome]);
  const globalContext = buildBacklogCurationGlobalContext(source, sourceFingerprint, itemRecords, generatedAt);
  const reducerInput = buildBacklogCurationReducerInput(globalContext, degradedOutcomes, generatedAt);
  return { schemaVersion: BACKLOG_CURATION_MAP_REDUCE_SCHEMA_VERSION, sourceFingerprint, ...(generatedAt !== undefined && { generatedAt }), globalContext, packets, degradedOutcomes, reducerInput };
}

export function buildBacklogCurationGlobalContext(source: Record<string, unknown>, sourceFingerprint: string, openItems: readonly Record<string, unknown>[], generatedAt?: string): BacklogCurationMapReduceGlobalContext {
  return {
    schemaVersion: BACKLOG_CURATION_MAP_REDUCE_SCHEMA_VERSION,
    purpose: 'backlog-curation-map-reduce',
    sourceFingerprint,
    ...(generatedAt !== undefined && { generatedAt }),
    curationGuidance: guidanceLines(source.curationGuidance),
    caps: exportedCaps(),
    itemCount: openItems.length,
    openItemIds: openItems.map((item) => String(item.id)).filter(Boolean),
    roadmapSummaries: summarizeRoadmap(source.roadmapContext),
    dependencySummaries: summarizeDependencies(arrayOfRecords(source.dependencyDetails)),
    recommendationSummaries: summarizeRecommendations(source.recommendations),
    ...(source.redraft !== undefined && { redraftSummary: summarizeRedraft(source.redraft) }),
    diagnostics: globalDiagnostics(source),
  };
}

export function buildBacklogCurationReducerInput(globalContext: BacklogCurationMapReduceGlobalContext, outcomes: readonly BacklogCurationMapReduceItemOutcome[], generatedAt?: string): BacklogCurationMapReduceReducerInput {
  const diagnostics: BacklogCurationMapReduceDiagnostic[] = [];
  const reducer: BacklogCurationMapReduceReducerInput = {
    schemaVersion: BACKLOG_CURATION_MAP_REDUCE_SCHEMA_VERSION,
    sourceFingerprint: globalContext.sourceFingerprint,
    ...(generatedAt !== undefined && { generatedAt }),
    globalContext: cloneGlobalContext(globalContext),
    outcomes: [...outcomes],
    diagnostics,
  };
  const bytes = byteLength(reducer);
  if (bytes <= BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES) return reducer;

  diagnostics.push({ code: 'reducer-input-byte-cap-exceeded', severity: 'warning', message: `Reducer input is ${bytes} bytes; cap is ${BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES}.` });
  shrinkReducerGlobalContext(reducer.globalContext, reducer, diagnostics);
  reducer.outcomes = prioritizeReducerOutcomes(outcomes).map((entry) => compactReducerOutcomeForCap(entry.outcome));
  if (byteLength(reducer) <= BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES) return reducer;

  selectReducerOutcomesUnderCap(reducer, outcomes, diagnostics);
  return reducer;
}

function cloneGlobalContext(globalContext: BacklogCurationMapReduceGlobalContext): BacklogCurationMapReduceGlobalContext {
  return JSON.parse(JSON.stringify(globalContext)) as BacklogCurationMapReduceGlobalContext;
}

function shrinkReducerGlobalContext(
  globalContext: BacklogCurationMapReduceGlobalContext,
  reducer: BacklogCurationMapReduceReducerInput,
  diagnostics: BacklogCurationMapReduceDiagnostic[],
): void {
  const truncationDiagnostic: BacklogCurationMapReduceDiagnostic = { code: 'reducer-input-global-context-truncated', severity: 'warning', message: 'Reducer global context was truncated to fit the byte cap.' };
  if (!diagnostics.some((diagnostic) => diagnostic.code === truncationDiagnostic.code)) diagnostics.push(truncationDiagnostic);
  const halve = <T>(entries: T[]): void => { entries.splice(Math.floor(entries.length / 2)); };
  const arrays = [
    globalContext.openItemIds,
    globalContext.recommendationSummaries,
    globalContext.dependencySummaries,
    globalContext.roadmapSummaries,
    globalContext.curationGuidance,
    globalContext.diagnostics,
  ];
  while (byteLength(reducer) > BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES && arrays.some((entries) => entries.length > 0)) {
    const largest = arrays.filter((entries) => entries.length > 0).sort((left, right) => byteLength(right) - byteLength(left))[0];
    halve(largest);
  }
  if (byteLength(reducer) > BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES) {
    delete globalContext.redraftSummary;
  }
}

// --- eforge:region backlog-curation-terminal-omissions ---
interface PrioritizedReducerOutcome { outcome: BacklogCurationMapReduceItemOutcome; originalIndex: number; priority: number }

const PROTECTED_TERMINAL_OMITTED_CODE = 'reducer-input-protected-terminal-omitted' as const;
const REDUCER_DIAGNOSTICS_MAX = 40, REDUCER_DIAGNOSTIC_MESSAGE_MAX_LENGTH = 800;

type TerminalVerdict = 'shipped' | 'superseded';

interface NamedTerminalOmission { itemId: string; verdict: TerminalVerdict }

function selectReducerOutcomesUnderCap(
  reducer: BacklogCurationMapReduceReducerInput,
  sourceOutcomes: readonly BacklogCurationMapReduceItemOutcome[],
  diagnostics: BacklogCurationMapReduceDiagnostic[],
): void {
  const prioritized = prioritizeReducerOutcomes(sourceOutcomes).map((entry) => ({ ...entry, outcome: compactReducerOutcomeForCap(entry.outcome) }));
  const observed = sourceOutcomes.length;
  const droppedDiagnostic: BacklogCurationMapReduceDiagnostic = { code: 'reducer-input-outcomes-dropped', severity: 'warning', message: `Reducer input outcomes were semantically pruned to fit the byte cap; observed ${observed}, retained pending. Protected terminal findings are retained first; omitted protected terminals are named separately.` };
  diagnostics.push(droppedDiagnostic);
  let omittedTerminals = new Set<string>();
  const maxAttempts = prioritized.length + 2;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    resetTerminalOmissionDiagnostics(diagnostics);
    diagnostics.push(...terminalOmissionDiagnostics(prioritized, omittedTerminals, REDUCER_DIAGNOSTICS_MAX - diagnostics.length));
    const selectedIndexes = fitPrioritizedOutcomes(reducer, prioritized);
    if (!terminalOmissionDiagnosticsFit(reducer, prioritized, omittedTerminals)) break;
    const nextOmittedTerminals = omittedProtectedTerminalKeys(prioritized, selectedIndexes);
    if (setsEqual(omittedTerminals, nextOmittedTerminals)) break;
    omittedTerminals = nextOmittedTerminals;
  }
  if (reducer.outcomes.length < observed) {
    droppedDiagnostic.message = `Reducer input outcomes were semantically pruned to fit the byte cap; observed ${observed}, retained ${reducer.outcomes.length}. Protected terminal findings are retained first; omitted protected terminals are named separately.`;
  } else {
    diagnostics.splice(diagnostics.indexOf(droppedDiagnostic), 1);
  }
}

function fitPrioritizedOutcomes(reducer: BacklogCurationMapReduceReducerInput, prioritized: readonly PrioritizedReducerOutcome[]): Set<number> {
  const selected = new Set<number>();
  reducer.outcomes = [];
  for (const entry of prioritized) {
    reducer.outcomes.push(entry.outcome);
    if (byteLength(reducer) <= BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES) selected.add(entry.originalIndex);
    else reducer.outcomes.pop();
  }
  return selected;
}

function prioritizeReducerOutcomes(outcomes: readonly BacklogCurationMapReduceItemOutcome[]): PrioritizedReducerOutcome[] {
  return outcomes.map((outcome, originalIndex) => ({ outcome, originalIndex, priority: reducerOutcomePriority(outcome) }))
    .sort((left, right) => left.priority - right.priority || left.originalIndex - right.originalIndex || left.outcome.itemId.localeCompare(right.outcome.itemId));
}

function reducerOutcomePriority(outcome: BacklogCurationMapReduceItemOutcome): number {
  if (isProtectedTerminalOutcome(outcome)) return 0;
  if ((outcome.outcome === 'cache-hit' || outcome.outcome === 'audited-finding') && outcome.finding.disposition === 'change') return 1;
  if ((outcome.outcome === 'cache-hit' || outcome.outcome === 'audited-finding') && (outcome.finding.disposition === 'needs-input' || outcome.finding.verdict === 'needs-product-input')) return 2;
  if (outcome.outcome === 'cache-hit' || outcome.outcome === 'audited-finding') {
    if (outcome.finding.verdict === 'partial' || outcome.finding.verdict === 'still-needed' || outcome.finding.verdict === 'stale-invalid') return 3;
    if ((outcome.finding.recommendationSignals?.length ?? 0) > 0) return 4;
    return 5;
  }
  if (outcome.outcome === 'invalid-finding' || outcome.outcome === 'item-agent-failure') return 6;
  if (outcome.outcome === 'oversized-packet') return 7;
  return 8;
}

function isProtectedTerminalOutcome(outcome: BacklogCurationMapReduceItemOutcome): boolean {
  if (outcome.outcome !== 'cache-hit' && outcome.outcome !== 'audited-finding') return false;
  return outcome.finding.disposition === 'change' && isTerminalVerdict(outcome.finding.verdict);
}

function isTerminalVerdict(value: unknown): value is TerminalVerdict {
  return value === 'shipped' || value === 'superseded';
}

function compactReducerOutcomeForCap(outcome: BacklogCurationMapReduceItemOutcome): BacklogCurationMapReduceItemOutcome {
  const base = {
    schemaVersion: outcome.schemaVersion,
    outcome: outcome.outcome,
    itemId: outcome.itemId,
    sourceFingerprint: outcome.sourceFingerprint,
    ...(outcome.packetSha256 !== undefined && { packetSha256: outcome.packetSha256 }),
    ...(outcome.bodySha256 !== undefined && { bodySha256: outcome.bodySha256 }),
    diagnostics: compactReducerDiagnostics(outcome.diagnostics, 2),
  };
  if (outcome.outcome === 'cache-hit' || outcome.outcome === 'audited-finding') return { ...base, finding: compactFindingForReducerCap(outcome.finding, isProtectedTerminalOutcome(outcome)) } as BacklogCurationMapReduceItemOutcome;
  if (outcome.outcome === 'item-agent-failure') return { ...base, error: boundText(outcome.error, 400) } as BacklogCurationMapReduceItemOutcome;
  if (outcome.outcome === 'invalid-finding') return { ...base, validationErrors: outcome.validationErrors.slice(0, 4).map((error) => boundText(error, 180)) } as BacklogCurationMapReduceItemOutcome;
  if (outcome.outcome === 'oversized-packet') return { ...base, byteLength: outcome.byteLength, byteCap: outcome.byteCap } as BacklogCurationMapReduceItemOutcome;
  return { ...base, ...(outcome.reason !== undefined && { reason: boundText(outcome.reason, 180) }) } as BacklogCurationMapReduceItemOutcome;
}

function compactFindingForReducerCap(finding: BacklogCurationMapReduceFinding, protectedTerminal: boolean): BacklogCurationMapReduceFinding {
  const citationLimit = protectedTerminal ? 6 : 3;
  return {
    schemaVersion: finding.schemaVersion,
    itemId: finding.itemId,
    sourceFingerprint: finding.sourceFingerprint,
    packetSha256: finding.packetSha256,
    bodySha256: finding.bodySha256,
    promptVersion: boundText(finding.promptVersion, 120),
    runtimeIdentity: compactRuntimeIdentity(finding.runtimeIdentity),
    disposition: finding.disposition,
    ...(finding.verdict !== undefined && { verdict: finding.verdict }),
    ...(finding.closureEvidenceRoles !== undefined && { closureEvidenceRoles: finding.closureEvidenceRoles.slice(0, protectedTerminal ? 8 : 4) }),
    checkedPaths: compactReducerCheckedPaths(finding.checkedPaths, protectedTerminal ? 8 : 4),
    summary: boundText(finding.summary, protectedTerminal ? 700 : 300),
    rationale: boundText(finding.rationale, protectedTerminal ? 1_000 : 400),
    citations: compactReducerCitations(finding.citations, citationLimit),
    recommendationSignals: protectedTerminal ? [] : finding.recommendationSignals.slice(0, 2).map((signal) => ({ source: boundText(signal.source, 120), ...(signal.ref !== undefined && { ref: boundText(signal.ref, 100) }), signal: boundText(signal.signal, 180) })),
    diagnostics: compactReducerDiagnostics(finding.diagnostics, protectedTerminal ? 2 : 1),
  };
}

function compactRuntimeIdentity(value: BacklogCurationMapReduceFinding['runtimeIdentity']): BacklogCurationMapReduceFinding['runtimeIdentity'] {
  return { provider: boundText(value.provider, 120), modelId: boundText(value.modelId, 200), ...(value.agentProfile !== undefined && { agentProfile: boundText(value.agentProfile, 200) }) };
}

function compactReducerCitations(citations: BacklogCurationMapReduceFinding['citations'], maxItems: number): BacklogCurationMapReduceFinding['citations'] {
  return [...citations]
    .sort((left, right) => reducerCitationPriority(left) - reducerCitationPriority(right))
    .slice(0, maxItems)
    .map((citation) => ({
      kind: citation.kind,
      source: boundText(citation.source, 200),
      ...(citation.confidence !== undefined && { confidence: boundText(citation.confidence, 80) }),
      ...(citation.path !== undefined && { path: boundText(citation.path, 260) }),
      ...(citation.excerpt !== undefined && { excerpt: boundText(citation.excerpt, 260) }),
      ...(citation.matchedBy !== undefined && { matchedBy: citation.matchedBy.slice(0, 4).map((entry) => boundText(entry, 80)) }),
    }));
}

function reducerCitationPriority(citation: BacklogCurationMapReduceCitation): number {
  if (citation.kind === 'implementation' || citation.matchedBy?.includes('replacement') === true) return 0;
  if (citation.kind === 'product-surface') return 2;
  if (citation.kind === 'supporting') return 3;
  if (citation.kind === 'current-source') return 4;
  return 9;
}

function compactReducerCheckedPaths(paths: BacklogCurationMapReduceFinding['checkedPaths'], maxItems: number): NonNullable<BacklogCurationMapReduceFinding['checkedPaths']> {
  return (paths ?? []).slice(0, maxItems).map((entry) => ({ path: boundText(entry.path, 260), ...(entry.reason !== undefined && { reason: boundText(entry.reason, 180) }) }));
}

function compactReducerDiagnostics(diagnostics: readonly BacklogCurationMapReduceDiagnostic[], maxItems: number): BacklogCurationMapReduceDiagnostic[] {
  return diagnostics.slice(0, maxItems).map((diagnostic) => ({ code: boundText(diagnostic.code, 160), severity: diagnostic.severity, ...(diagnostic.message !== undefined && { message: boundText(diagnostic.message, 220) }), ...(diagnostic.path !== undefined && { path: boundText(diagnostic.path, 180) }) }));
}

function omittedProtectedTerminalKeys(prioritized: readonly PrioritizedReducerOutcome[], selectedIndexes: Set<number>): Set<string> {
  return new Set(prioritized.filter((entry) => !selectedIndexes.has(entry.originalIndex) && isProtectedTerminalOutcome(entry.outcome)).map(terminalKey));
}

function terminalOmissionDiagnostics(prioritized: readonly PrioritizedReducerOutcome[], omitted: Set<string>, availableSlots: number): BacklogCurationMapReduceDiagnostic[] {
  const omissions = namedTerminalOmissions(prioritized, omitted);
  if (omissions.length === 0) return [];
  const chunks = chunkTerminalOmissionNames(omissions, availableSlots);
  if (chunks === undefined) throwCannotFitTerminalOmissions(omissions);
  return chunks.map((chunk, index) => ({ code: PROTECTED_TERMINAL_OMITTED_CODE, severity: 'warning' as const, message: `Protected terminal findings omitted by reducer byte caps: ${chunk.join(', ')}.`, path: `outcomes/protected-terminal-omissions/${index + 1}` }));
}

function namedTerminalOmissions(prioritized: readonly PrioritizedReducerOutcome[], omitted: Set<string>): NamedTerminalOmission[] {
  return prioritized.flatMap((entry) => {
    const outcome = entry.outcome;
    if (!omitted.has(terminalKey(entry)) || (outcome.outcome !== 'cache-hit' && outcome.outcome !== 'audited-finding')) return [];
    const verdict = outcome.finding.verdict;
    if (outcome.finding.disposition !== 'change' || !isTerminalVerdict(verdict)) return [];
    return [{ itemId: outcome.itemId, verdict }];
  });
}

function chunkTerminalOmissionNames(omissions: readonly NamedTerminalOmission[], availableSlots: number): string[][] | undefined {
  if (availableSlots <= 0) return undefined;
  const prefix = 'Protected terminal findings omitted by reducer byte caps: ';
  const chunks: string[][] = [];
  let current: string[] = [];
  for (const omission of omissions) {
    const name = `${omission.itemId}:${omission.verdict}`;
    const candidate = [...current, name];
    if (`${prefix}${candidate.join(', ')}.`.length <= REDUCER_DIAGNOSTIC_MESSAGE_MAX_LENGTH) current = candidate;
    else {
      if (current.length === 0 || chunks.length >= availableSlots) return undefined;
      chunks.push(current);
      current = [name];
      if (`${prefix}${name}.`.length > REDUCER_DIAGNOSTIC_MESSAGE_MAX_LENGTH) return undefined;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks.length <= availableSlots ? chunks : undefined;
}

function terminalOmissionDiagnosticsFit(reducer: BacklogCurationMapReduceReducerInput, prioritized: readonly PrioritizedReducerOutcome[], omitted: Set<string>): boolean {
  if (byteLength(reducer) <= BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES) return true;
  throwCannotFitTerminalOmissions(namedTerminalOmissions(prioritized, omitted));
}

function throwCannotFitTerminalOmissions(omissions: readonly NamedTerminalOmission[]): never {
  throw new Error(`Reducer input cannot fit named protected terminal omissions under ${BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES} bytes; omitted candidates: ${omissions.map((omission) => `${omission.itemId}:${omission.verdict}`).join(', ')}.`);
}

function terminalKey(entry: PrioritizedReducerOutcome): string { return `${entry.originalIndex}:${entry.outcome.itemId}`; }

function resetTerminalOmissionDiagnostics(diagnostics: BacklogCurationMapReduceDiagnostic[]): void {
  for (let index = diagnostics.length - 1; index >= 0; index -= 1) {
    if (diagnostics[index]?.code === PROTECTED_TERMINAL_OMITTED_CODE) diagnostics.splice(index, 1);
  }
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const entry of left) if (!right.has(entry)) return false;
  return true;
}
// --- eforge:endregion backlog-curation-terminal-omissions ---

export function buildBacklogCurationItemPacket(source: Record<string, unknown>, item: Record<string, unknown>, sourceFingerprint: string): PacketBuildResult {
  const itemId = stringValue(item.id) ?? 'unknown-item';
  const precondition = normalizePrecondition(item.precondition, itemId, sourceFingerprint);
  const diagnostics: BacklogCurationMapReduceCapDiagnostic[] = [];
  const packet: BacklogCurationMapReduceItemPacket = {
    schemaVersion: BACKLOG_CURATION_MAP_REDUCE_SCHEMA_VERSION,
    kind: 'item',
    sourceFingerprint,
    itemId,
    itemTitle: boundText(stringValue(item.title) ?? itemId, 300),
    metadata: itemMetadata(item),
    precondition,
    bodySha256: precondition.bodySha256,
    recordSha256: precondition.recordSha256 ?? precondition.bodySha256,
    sectionSummaries: boundedSectionSummaries(recordValue(item.sections), diagnostics),
    dependencyFacts: boundedDependencyFacts(arrayOfRecords(source.dependencyDetails).filter((detail) => detail.itemId === itemId), diagnostics),
    currentSourceCitations: boundedCurrentSourceCitations(source, itemId, diagnostics),
    historicalHints: boundedHistoricalHints(source, itemId, diagnostics),
    recommendationSignals: boundedRecommendationSignals(source.recommendations, itemId, diagnostics),
    diagnostics,
  };
  const bytes = byteLength(packet);
  if (bytes <= BACKLOG_CURATION_PACKET_MAX_BYTES) return { packet };
  return { degradedOutcome: buildOversizedPacketOutcome(packet, bytes) };
}

export function computeBacklogCurationPacketSha256(packet: BacklogCurationMapReduceItemPacket): string {
  return sha256(canonicalJson(packet));
}

export function validateBacklogCurationPacketCaps(packet: BacklogCurationMapReduceItemPacket): BacklogCurationMapReduceCapDiagnostic[] {
  const diagnostics: BacklogCurationMapReduceCapDiagnostic[] = [];
  addCountDiagnostic(diagnostics, 'dependency-facts-cap', packet.dependencyFacts.length, BACKLOG_CURATION_DEPENDENCY_FACTS_PER_ITEM_MAX, packet.dependencyFacts.length);
  addCountDiagnostic(diagnostics, 'current-source-citations-cap', packet.currentSourceCitations.length, BACKLOG_CURATION_CITATIONS_PER_ITEM_MAX, packet.currentSourceCitations.length);
  addCountDiagnostic(diagnostics, 'historical-hints-cap', packet.historicalHints.length, BACKLOG_CURATION_HISTORICAL_HINTS_PER_ITEM_MAX, packet.historicalHints.length);
  addCountDiagnostic(diagnostics, 'recommendation-signals-cap', packet.recommendationSignals.length, BACKLOG_CURATION_RECOMMENDATION_SIGNALS_PER_ITEM_MAX, packet.recommendationSignals.length);
  addCountDiagnostic(diagnostics, 'packet-diagnostics-cap', packet.diagnostics.length, BACKLOG_CURATION_DIAGNOSTICS_PER_PACKET_MAX, packet.diagnostics.length);
  return diagnostics;
}

export function buildOversizedPacketOutcome(packet: BacklogCurationMapReduceItemPacket, byteLengthValue = byteLength(packet)): BacklogCurationMapReduceItemOutcome {
  return {
    schemaVersion: BACKLOG_CURATION_MAP_REDUCE_SCHEMA_VERSION,
    outcome: 'oversized-packet',
    itemId: packet.itemId,
    sourceFingerprint: packet.sourceFingerprint,
    packetSha256: computeBacklogCurationPacketSha256(packet),
    bodySha256: packet.bodySha256,
    byteLength: byteLengthValue,
    byteCap: BACKLOG_CURATION_PACKET_MAX_BYTES,
    diagnostics: [{ code: 'packet-byte-cap-exceeded', severity: 'warning', message: `Packet for ${packet.itemId} is ${byteLengthValue} bytes; cap is ${BACKLOG_CURATION_PACKET_MAX_BYTES}.` }],
  };
}

export function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf-8');
}

function normalizePrecondition(value: unknown, itemId: string, sourceFingerprint: string): BacklogCurationMapReduceItemPacket['precondition'] {
  const record = recordValue(value);
  const bodySha256 = stringValue(record.bodySha256) ?? sha256('');
  const recordSha256 = stringValue(record.recordSha256) ?? bodySha256;
  return {
    kind: 'item',
    id: stringValue(record.id) ?? itemId,
    ...(record.origin === 'private' || record.origin === 'legacy' ? { origin: record.origin } : {}),
    ...(typeof record.relativePath === 'string' && record.relativePath.length > 0 && { relativePath: record.relativePath }),
    bodySha256,
    sourceFingerprint,
    ...(typeof record.updated === 'string' && { updated: record.updated }),
    recordSha256,
  };
}

function itemMetadata(item: Record<string, unknown>): BacklogCurationMapReduceItemPacket['metadata'] {
  return compactObject({
    status: boundOptional(item.status, 80),
    priority: boundOptional(item.priority, 80),
    tags: arrayOfStrings(item.tags).slice(0, 20).map((tag) => boundText(tag, 120)),
    depends_on: arrayOfStrings(item.depends_on).slice(0, 20).map((id) => boundText(id, 200)),
    epic: boundOptional(item.epic, 200),
    updated: boundOptional(item.updated, 120),
    last_checked: boundOptional(item.last_checked, 120),
    stale_after: boundOptional(item.stale_after, 120),
    evidence_notes: boundOptional(item.evidence_notes, 500),
    recheck_notes: boundOptional(item.recheck_notes, 500),
  }) as BacklogCurationMapReduceItemPacket['metadata'];
}

function boundedSectionSummaries(sections: Record<string, unknown>, diagnostics: BacklogCurationMapReduceCapDiagnostic[]) {
  const entries = Object.entries(sections).sort(([left], [right]) => left.localeCompare(right));
  const retained = entries.slice(0, 8).map(([heading, text]) => ({ heading: boundText(heading, 160), text: boundText(String(text), 800) }));
  addCountDiagnostic(diagnostics, 'section-summary-count-cap', entries.length, 8, retained.length);
  return retained;
}

function boundedDependencyFacts(details: readonly Record<string, unknown>[], diagnostics: BacklogCurationMapReduceCapDiagnostic[]): BacklogCurationMapReduceDependencyFact[] {
  const facts = details.flatMap((detail) => [
    ...dependencyEntries(detail.openDependsOn, 'open-dependency'),
    ...dependencyEntries(detail.closedDependsOn, 'closed-dependency'),
    ...dependencyEntries(detail.missingDependsOn, 'missing-dependency'),
  ]);
  const retained = facts.slice(0, BACKLOG_CURATION_DEPENDENCY_FACTS_PER_ITEM_MAX);
  addCountDiagnostic(diagnostics, 'dependency-facts-count-cap', facts.length, BACKLOG_CURATION_DEPENDENCY_FACTS_PER_ITEM_MAX, retained.length);
  return retained;
}

function dependencyEntries(value: unknown, relationship: BacklogCurationMapReduceDependencyFact['relationship']): BacklogCurationMapReduceDependencyFact[] {
  return arrayOfRecords(value).map((entry) => ({
    id: stringValue(entry.id) ?? 'unknown',
    relationship,
    ...(typeof entry.status === 'string' && { status: boundText(entry.status, 80) }),
    ...(typeof entry.title === 'string' && { title: boundText(entry.title, 300) }),
  }));
}

function boundedCurrentSourceCitations(source: Record<string, unknown>, itemId: string, diagnostics: BacklogCurationMapReduceCapDiagnostic[]): BacklogCurationMapReduceCitation[] {
  const auditItems = arrayOfRecords(recordValue(source.fullImplementationAudit).items);
  const auditItem = auditItems.find((entry) => entry.itemId === itemId);
  const sourceFirst = recordValue(auditItem?.sourceFirstResult);
  const citations = arrayOfRecords(sourceFirst.citations).map(projectCitation);
  const evidenceCitations = arrayOfRecords(auditItem?.evidence).map(projectEvidenceCitation);
  const retained = [...citations, ...evidenceCitations].slice(0, BACKLOG_CURATION_CITATIONS_PER_ITEM_MAX);
  addCountDiagnostic(diagnostics, 'current-source-citations-count-cap', citations.length + evidenceCitations.length, BACKLOG_CURATION_CITATIONS_PER_ITEM_MAX, retained.length);
  return retained;
}

function projectCitation(value: Record<string, unknown>): BacklogCurationMapReduceCitation {
  return {
    kind: citationKind(value.kind),
    source: boundText(stringValue(value.source) ?? 'current-source', 200),
    ...(typeof value.confidence === 'string' && { confidence: boundText(value.confidence, 80) }),
    ...(typeof value.path === 'string' && { path: boundText(value.path, 400) }),
    ...(typeof value.excerpt === 'string' && { excerpt: boundText(value.excerpt, 1_000) }),
    ...(Array.isArray(value.matchedBy) && { matchedBy: value.matchedBy.map((entry) => boundText(String(entry), 120)).slice(0, 12) }),
  };
}

function projectEvidenceCitation(value: Record<string, unknown>): BacklogCurationMapReduceCitation {
  return projectCitation({ kind: 'current-source', source: value.source, confidence: value.confidence, path: value.path, excerpt: value.excerpt, matchedBy: value.matchedBy });
}

function citationKind(value: unknown): BacklogCurationMapReduceCitation['kind'] {
  return value === 'implementation' || value === 'product-surface' || value === 'supporting' ? value : 'current-source';
}

function boundedHistoricalHints(source: Record<string, unknown>, itemId: string, diagnostics: BacklogCurationMapReduceCapDiagnostic[]): BacklogCurationMapReduceHistoricalHint[] {
  const auditItems = arrayOfRecords(recordValue(source.fullImplementationAudit).items);
  const hints = arrayOfRecords(auditItems.find((entry) => entry.itemId === itemId)?.historicalHints)
    .concat(arrayOfRecords(source.shippedEvidenceCandidates).filter((entry) => entry.itemId === itemId))
    .concat(arrayOfRecords(recordValue(source.gitDelta).affectedItemCandidates).filter((entry) => entry.itemId === itemId))
    .map(projectHistoricalHint);
  const retained = hints.slice(0, BACKLOG_CURATION_HISTORICAL_HINTS_PER_ITEM_MAX);
  addCountDiagnostic(diagnostics, 'historical-hints-count-cap', hints.length, BACKLOG_CURATION_HISTORICAL_HINTS_PER_ITEM_MAX, retained.length);
  return retained;
}

function projectHistoricalHint(value: Record<string, unknown>): BacklogCurationMapReduceHistoricalHint {
  return {
    source: boundText(stringValue(value.source) ?? stringValue(value.evidenceSource) ?? stringValue(value.sourceLabel) ?? 'history', 200),
    closureAuthority: false,
    ...(typeof value.intent === 'string' && { intent: boundText(value.intent, 120) }),
    ...(typeof value.confidence === 'string' && { confidence: boundText(value.confidence, 80) }),
    ...(typeof value.citation === 'string' && { citation: boundText(value.citation, 600) }),
    ...(typeof value.evidence === 'string' && { evidence: boundText(value.evidence, 1_000) }),
    ...(typeof value.path === 'string' && { path: boundText(value.path, 400) }),
  };
}

function boundedRecommendationSignals(value: unknown, itemId: string, diagnostics: BacklogCurationMapReduceCapDiagnostic[]): BacklogCurationMapReduceRecommendationSignal[] {
  const record = recordValue(value);
  const model = recordValue(record.modelSummary);
  const signals: Array<{ source: string; ref?: string; signal: string }> = [
    ...arrayOfRecords(model.safeParallelizableGroups).filter((group) => arrayOfStrings(group.itemIds).includes(itemId)).map((group) => ({ source: 'recommendations', ref: stringValue(group.ref), signal: `Parallel group${group.rationale ? `: ${String(group.rationale)}` : ''}` })),
    ...arrayOfStrings(model.recommendedNextItemIds).filter((id) => id === itemId).map(() => ({ source: 'recommendations', signal: 'Recommended next sequence item.' })),
  ];
  const retained = signals.slice(0, BACKLOG_CURATION_RECOMMENDATION_SIGNALS_PER_ITEM_MAX).map((signal) => ({ ...signal, source: boundText(signal.source, 200), ...(signal.ref !== undefined && { ref: boundText(signal.ref, 160) }), signal: boundText(signal.signal, 1_000) }));
  addCountDiagnostic(diagnostics, 'recommendation-signals-count-cap', signals.length, BACKLOG_CURATION_RECOMMENDATION_SIGNALS_PER_ITEM_MAX, retained.length);
  return retained;
}

function guidanceLines(value: unknown): string[] {
  const instruction = recordValue(value).instruction;
  return [typeof instruction === 'string' ? instruction : 'Audit each open backlog item with current source as the only closure authority.'].map((line) => boundText(line, 1_200));
}

function exportedCaps(): Record<string, number> {
  return {
    packetBytes: BACKLOG_CURATION_PACKET_MAX_BYTES,
    citationsPerItem: BACKLOG_CURATION_CITATIONS_PER_ITEM_MAX,
    historicalHintsPerItem: BACKLOG_CURATION_HISTORICAL_HINTS_PER_ITEM_MAX,
    diagnosticsPerPacket: BACKLOG_CURATION_DIAGNOSTICS_PER_PACKET_MAX,
    dependencyFactsPerItem: BACKLOG_CURATION_DEPENDENCY_FACTS_PER_ITEM_MAX,
    recommendationSignalsPerItem: BACKLOG_CURATION_RECOMMENDATION_SIGNALS_PER_ITEM_MAX,
    reducerInputBytes: BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES,
  };
}

function summarizeRoadmap(value: unknown): Array<Record<string, unknown>> {
  const record = recordValue(value);
  return [record.localSteering, ...arrayOfRecords(record.sharedContextSources), ...arrayOfRecords(record.discoveredContextSources)]
    .map(recordValue)
    .filter((entry) => Object.keys(entry).length > 0)
    .slice(0, 20)
    .map((entry) => compactObject({ kind: boundOptional(entry.kind, 80), role: boundOptional(entry.role, 80), path: boundOptional(entry.path, 400), exists: typeof entry.exists === 'boolean' ? entry.exists : undefined, headings: arrayOfRecords(entry.headings).slice(0, 6).map((heading) => boundText(String(heading.heading ?? heading.text ?? ''), 160)) }));
}

function summarizeDependencies(details: readonly Record<string, unknown>[]): Array<Record<string, unknown>> {
  return details.slice(0, 50).map((detail) => ({
    itemId: boundOptional(detail.itemId, 200),
    open: arrayOfRecords(detail.openDependsOn).length,
    closed: arrayOfRecords(detail.closedDependsOn).length,
    missing: arrayOfRecords(detail.missingDependsOn).length,
  }));
}

function summarizeRecommendations(value: unknown): Array<Record<string, unknown>> {
  const model = recordValue(recordValue(value).modelSummary);
  return [
    ...arrayOfStrings(model.recommendedNextItemIds).slice(0, 20).map((itemId, index) => ({ kind: 'recommended-next', itemId, rank: index + 1 })),
    ...arrayOfRecords(model.safeParallelizableGroups).slice(0, 20).map((group) => ({ kind: 'parallel-group', ref: boundOptional(group.ref, 160), itemIds: arrayOfStrings(group.itemIds).slice(0, 20).map((itemId) => boundText(itemId, 200)) })),
  ];
}

function summarizeRedraft(value: unknown): Record<string, unknown> {
  const redraft = recordValue(value);
  return compactObject({ parentTaskId: boundOptional(redraft.parentTaskId, 200), hasSteering: typeof redraft.steering === 'string', userAnswerCount: arrayOfStrings(redraft.userAnswers).length, previousSummary: boundOptional(redraft.previousSummary, 500) });
}

function globalDiagnostics(source: Record<string, unknown>): BacklogCurationMapReduceDiagnostic[] {
  return [
    ...arrayOfRecords(source.shippedEvidenceDiagnostics),
    ...arrayOfRecords(recordValue(source.gitDelta).diagnostics),
    ...arrayOfRecords(recordValue(source.fullImplementationAudit).diagnostics),
  ].slice(0, 40).map((diagnostic) => ({ code: stringValue(diagnostic.code) ?? 'diagnostic', severity: diagnostic.severity === 'error' || diagnostic.severity === 'warning' ? diagnostic.severity : 'info', ...(typeof diagnostic.message === 'string' && { message: boundText(diagnostic.message, 800) }), ...(typeof diagnostic.path === 'string' && { path: boundText(diagnostic.path, 300) }) }));
}

function addCountDiagnostic(diagnostics: BacklogCurationMapReduceCapDiagnostic[], code: string, observed: number, cap: number, retained: number): void {
  if (observed <= cap || diagnostics.length >= BACKLOG_CURATION_DIAGNOSTICS_PER_PACKET_MAX) return;
  diagnostics.push({ code, observed, cap, retained, message: `${code} retained ${retained} of ${observed}.` });
}

function boundOptional(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 ? boundText(value, max) : undefined;
}

function boundText(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 16))}\n…[truncated]`;
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object' && !Array.isArray(entry)) : [];
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
// --- eforge:endregion packet-builders ---
