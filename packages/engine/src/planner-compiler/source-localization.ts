import type { PlanningAtomGraph, PlanningAtom } from './atom-graph.js';
import { classifyEvidenceCandidate, evidenceSlug, normalizeEvidenceValue } from './evidence-hygiene.js';
import type { PlanningCriterionAspect } from './coverage-accounting.js';
import type { RepositoryIndex, RepositoryIndexFile } from './repository-index.js';
import { deriveRepositoryIndex } from './repository-index.js';
import { inferInterfaceKeys, inferSubsystemHints, stableSlug } from './source-analysis.js';
import type { SourceInventory } from './source-inventory.js';
import { normalizeSourceLocalizationInputs, validateSourceLocalizationBundle, type SourceLocalizationBundle, type SourceLocalizationCandidate, type SourceLocalizationConfidence, type SourceLocalizationDiagnostic, type SourceLocalizationHint, type SourceLocalizationInputHints, type SourceLocalizationLimits, type SourceLocalizationNeed, type SourceLocalizationNeedKind, type SourceLocalizationRecord, type SourceLocalizationStatus } from './source-localization-contracts.js';

export interface DeriveSourceLocalizationInput { cwd: string; inventory?: SourceInventory; graph?: PlanningAtomGraph; aspects?: PlanningCriterionAspect[]; hints?: SourceLocalizationInputHints; limits?: Partial<SourceLocalizationLimits>; index?: RepositoryIndex }

const SURFACE_KINDS = new Set<SourceLocalizationNeedKind>(['manifest', 'entrypoint', 'docs', 'test', 'config', 'command', 'route', 'api', 'ui', 'extension', 'consumer-surface']);
const SURFACE_PATTERNS: Array<[SourceLocalizationNeedKind, RegExp]> = [
  ['manifest', /\bmanifest\b|package\.json|pyproject|cargo\.toml/i],
  ['entrypoint', /\bentrypoint\b|\bmain\b|\bexports?\b/i],
  ['docs', /\bdocs?\b|\breadme\b|\bguide\b/i],
  ['test', /\b(?:tests?|specs?|fixtures?)\b/i],
  ['config', /\b(?:config(?:uration)?|settings|options)\b/i],
  ['command', /\b(?:command|cli|handler)s?\b/i],
  ['route', /\b(?:route|router|endpoint)s?\b/i],
  ['api', /\bapi\b|\/api\//i],
  ['ui', /\b(?:ui|component|view|page|screen)s?\b/i],
  ['extension', /\b(?:plugin|extension|contribution|hook)s?\b/i],
  ['consumer-surface', /\bconsumer\b|\buser-facing\b|\bpublic\s+surface\b/i],
];
const BROAD_ROOTS = new Set(['.', '', 'src', 'lib', 'test', 'tests', 'docs', 'packages', 'apps', 'services']);

export async function deriveSourceLocalization(input: DeriveSourceLocalizationInput): Promise<SourceLocalizationBundle> {
  const normalized = normalizeSourceLocalizationInputs(input.hints, input.limits);
  const limits = normalized.limits;
  const normalizedInput = { ...input, hints: normalized.hints, limits };
  const index = input.index ?? await deriveRepositoryIndex({ cwd: input.cwd, hints: normalized.hints, limits });
  const needs = deriveSourceLocalizationNeeds(normalizedInput);
  const records = needs.map((need) => resolveNeed(need, index, limits));
  const bundle: SourceLocalizationBundle = { sourceHash: input.inventory?.sourceHash ?? input.graph?.sourceHash, graphId: input.graph?.graphId, records: records.sort((a, b) => a.needId.localeCompare(b.needId)), byAtomId: byAtom(records), diagnostics: [...normalized.diagnostics, ...records.flatMap((record) => record.diagnostics), ...index.diagnostics], limits, indexDiagnostics: index.diagnostics };
  const validation = validateSourceLocalizationBundle(bundle);
  return validation.ok ? bundle : { ...bundle, diagnostics: [...bundle.diagnostics, ...validation.errors.map((message) => ({ code: 'localization-validation', message, severity: 'error' as const }))] };
}

export function deriveSourceLocalizationNeeds(input: Pick<DeriveSourceLocalizationInput, 'inventory' | 'graph' | 'aspects' | 'hints'>): SourceLocalizationNeed[] {
  const hints = normalizeSourceLocalizationInputs(input.hints).hints;
  const needs: SourceLocalizationNeed[] = [];
  for (const criterion of input.inventory?.criteria ?? []) {
    const aspectIds = aspectIdsForCriterion(criterion.id, input.aspects);
    for (const evidencePath of criterion.evidencePaths) needs.push(need(`criterion-${criterion.id}-path-${evidenceSlug(evidencePath)}`, classifyEvidenceCandidate(evidencePath).kind === 'directory' ? 'directory' : 'literal-path', evidencePath, [criterion.id], aspectIds, criterion.subsystemHints, criterion.interfaceKeys, [], 'criterion'));
    for (const key of criterion.interfaceKeys) needs.push(need(`criterion-${criterion.id}-interface-${stableSlug(key)}`, 'interface', key, [criterion.id], aspectIds, criterion.subsystemHints, criterion.interfaceKeys, [], 'criterion'));
    for (const kind of surfaceKindsForText(criterion.text)) needs.push(need(`criterion-${criterion.id}-surface-${kind}`, kind, kind, [criterion.id], aspectIds, criterion.subsystemHints, criterion.interfaceKeys, [], 'criterion'));
    for (const subsystem of criterion.subsystemHints.filter((hint) => hint !== 'general')) needs.push(need(`criterion-${criterion.id}-subsystem-${stableSlug(subsystem)}`, 'subsystem', subsystem, [criterion.id], aspectIds, [subsystem], criterion.interfaceKeys, [], 'criterion'));
  }
  for (const globalNeed of input.inventory?.globalLocalizationNeeds ?? []) needs.push(need(`inventory-${globalNeed.id}`, globalNeed.kind, globalNeed.query, globalNeed.criterionIds, [], globalNeed.subsystemHints, globalNeed.interfaceKeys, [], 'inventory'));
  for (const candidate of input.inventory?.evidenceCandidates.filter((item) => item.actionable) ?? []) needs.push(need(`inventory-evidence-${evidenceSlug(candidate.value)}`, candidate.kind === 'directory' ? 'directory' : 'literal-path', candidate.value, [], [], inferSubsystemHints(candidate.value), inferInterfaceKeys(candidate.value), [], 'inventory'));
  for (const hint of hints.projectHints ?? []) needs.push(...hintNeeds(hint));
  const assigned = assignNeedsToAtoms(attachHintWitnesses(dedupeNeeds(needs), hints.projectHints ?? []), input.graph);
  return assigned.length > 0 ? assigned : atomFallbackNeeds(input.graph);
}

export function assignNeedsToAtoms(needs: SourceLocalizationNeed[], graph?: PlanningAtomGraph): SourceLocalizationNeed[] {
  if (!graph) return needs;
  return needs.map((item) => ({ ...item, assignedAtomIds: [...new Set([...item.assignedAtomIds, ...graph.atoms.filter((atom) => needMatchesAtom(item, atom)).map((atom) => atom.atomId)])].sort() }));
}

function resolveNeed(need: SourceLocalizationNeed, index: RepositoryIndex, limits: SourceLocalizationLimits): SourceLocalizationRecord {
  const diagnostics: SourceLocalizationDiagnostic[] = [];
  const scored = scoreNeed(need, index, limits, diagnostics).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const cap = candidateCapForNeed(need, limits);
  const capped = dedupeCandidates(scored).slice(0, cap);
  if (scored.length > capped.length) diagnostics.push({ code: SURFACE_KINDS.has(need.kind) ? 'surface-candidate-budget' : 'candidate-budget', message: `Candidate list capped at ${cap}.`, severity: 'info', needId: need.id });
  const status = recordStatus(need, capped, diagnostics);
  return { needId: need.id, kind: need.kind, query: need.query, status, candidateFiles: capped, confidence: confidenceFor(capped[0]?.score ?? 0), reason: capped[0]?.reason ?? (diagnostics[0]?.message ?? 'no repository signal'), linkedCriterionIds: [...need.criterionIds], linkedAspectIds: [...need.aspectIds], assignedAtomIds: [...need.assignedAtomIds], diagnostics, budgetNotes: budgetNotes(index, limits, scored.length, cap), source: need.source, subsystemHints: [...need.subsystemHints], interfaceKeys: [...need.interfaceKeys] };
}

/**
 * Surface-kind needs match files by classification, not name, so on any real
 * repo they would otherwise sweep in every file of that class (every config,
 * every doc, ...). Cap them to the top-scored few - affinity overlap already
 * boosts genuinely related files. Literal-path/directory/interface/subsystem/
 * symbol/keyword needs stay at the general candidate budget.
 */
function candidateCapForNeed(need: SourceLocalizationNeed, limits: SourceLocalizationLimits): number {
  return SURFACE_KINDS.has(need.kind) ? Math.min(limits.maxSurfaceCandidatesPerNeed, limits.maxCandidateFilesPerNeed) : limits.maxCandidateFilesPerNeed;
}

function scoreNeed(need: SourceLocalizationNeed, index: RepositoryIndex, limits: SourceLocalizationLimits, diagnostics: SourceLocalizationDiagnostic[]): SourceLocalizationCandidate[] {
  const witnesses = witnessCandidates(need, index, diagnostics);
  const query = normalizeEvidenceValue(need.query);
  if (need.kind === 'literal-path') return [...witnesses, ...literalCandidates(query, index)];
  if (need.kind === 'directory') return [...witnesses, ...directoryCandidates(need, query, index, limits, diagnostics)];
  const manifestEntrypointTargets = new Set(index.files.flatMap((file) => file.manifestEntrypoints));
  return [...witnesses, ...index.files.flatMap((file) => scoreFileForNeed(file, need, manifestEntrypointTargets))];
}

/**
 * Witness paths are repository files the exploration agent confirmed while
 * investigating this need. Index membership is the honesty check: an indexed
 * witness resolves the need at literal-path strength, an unindexed one is
 * reported and contributes nothing.
 */
function witnessCandidates(need: SourceLocalizationNeed, index: RepositoryIndex, diagnostics: SourceLocalizationDiagnostic[]): SourceLocalizationCandidate[] {
  return need.witnessPaths.flatMap((path) => {
    const matches = literalCandidates(normalizeEvidenceValue(path), index)
      .map((item) => candidate(item.path, item.score, 'exploration-confirmed witness path', [...item.signals, 'witness-path']));
    if (matches.length === 0) diagnostics.push({ code: 'witness-path-unindexed', message: `Witness path ${path} is not in the repository index.`, severity: 'warning', needId: need.id, path });
    return matches;
  });
}

function literalCandidates(query: string, index: RepositoryIndex): SourceLocalizationCandidate[] {
  const normalized = query.replace(/\/$/, '');
  return index.files.flatMap((file) => file.path === normalized ? [candidate(file.path, 100, 'literal path match', ['literal-path'])] : file.path.endsWith(`/${normalized}`) ? [candidate(file.path, 82, 'literal path suffix match', ['literal-path-suffix'])] : []);
}

function directoryCandidates(need: SourceLocalizationNeed, query: string, index: RepositoryIndex, limits: SourceLocalizationLimits, diagnostics: SourceLocalizationDiagnostic[]): SourceLocalizationCandidate[] {
  const dir = query.replace(/\/$/, '');
  if (BROAD_ROOTS.has(dir) && need.interfaceKeys.length === 0 && need.subsystemHints.length === 0) {
    diagnostics.push({ code: 'broad-directory', message: `Directory ${dir || '.'} is too broad without narrowing context.`, severity: 'warning', needId: need.id, path: dir || '.' });
    return [];
  }
  const inside = index.files.filter((file) => file.path === dir || file.path.startsWith(`${dir}/`));
  if (inside.length > limits.maxDirectoryExpansionFiles) diagnostics.push({ code: 'directory-expansion-budget', message: `Directory expansion capped at ${limits.maxDirectoryExpansionFiles} files.`, severity: 'info', needId: need.id, path: dir });
  return inside.map((file) => {
    const contextScore = contextOverlap(file, need) * 8;
    const surfaceScore = file.surfaces.includes('manifest') || file.surfaces.includes('entrypoint') ? 8 : 0;
    return candidate(file.path, 58 + contextScore + surfaceScore, 'directory expansion', ['directory-expansion', ...matchedSignals(file, need)]);
  }).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limits.maxDirectoryExpansionFiles);
}

function scoreFileForNeed(file: RepositoryIndexFile, need: SourceLocalizationNeed, manifestEntrypointTargets: Set<string>): SourceLocalizationCandidate[] {
  const queryTokens = tokenSet(need.query);
  const signals: string[] = [];
  let score = 0;
  if (need.kind === 'manifest' && file.surfaces.includes('manifest')) { signals.push('manifest file'); score += 70; }
  if (need.kind === 'entrypoint' && (file.surfaces.includes('entrypoint') || manifestEntrypointTargets.has(file.path))) { signals.push('entrypoint file'); score += 70; }
  if (SURFACE_KINDS.has(need.kind) && file.surfaces.includes(need.kind)) { signals.push(`${need.kind} surface`); score += 62; }
  if (need.kind === 'interface' && hasAny(file.keywords, [...need.interfaceKeys, need.query].flatMap(tokenSet))) { signals.push('handler/schema/contract naming'); score += 64; }
  if (need.kind === 'subsystem' && hasAny(file.segments.flatMap(tokenSet), need.subsystemHints.flatMap(tokenSet))) { signals.push('subsystem path segment'); score += 58; }
  if ((need.kind === 'symbol' || need.kind === 'keyword') && hasAny(file.keywords, [...queryTokens])) { signals.push('keyword hit'); score += need.kind === 'symbol' ? 60 : 48; }
  const overlaps = contextOverlap(file, need);
  if (overlaps > 0) { signals.push(...matchedSignals(file, need)); score += overlaps * 7; }
  if (hasAny(file.keywords, [...queryTokens])) { signals.push('keyword hit'); score += 10; }
  if (manifestEntrypointTargets.has(file.path)) { signals.push('manifest export'); score += 8; }
  return score > 0 ? [candidate(file.path, score, signals[0] ?? 'repository signal', signals)] : [];
}

function contextOverlap(file: RepositoryIndexFile, need: SourceLocalizationNeed): number {
  return countOverlap(file.keywords, [...need.subsystemHints, ...need.interfaceKeys].flatMap(tokenSet)) + countOverlap(file.surfaces, [...need.interfaceKeys, ...need.subsystemHints].flatMap(tokenSet));
}

function matchedSignals(file: RepositoryIndexFile, need: SourceLocalizationNeed): string[] {
  const signals: string[] = [];
  if (countOverlap(file.keywords, need.subsystemHints.flatMap(tokenSet)) > 0) signals.push('subsystem keyword');
  if (countOverlap(file.keywords, need.interfaceKeys.flatMap(tokenSet)) > 0) signals.push('interface keyword');
  if (file.surfaces.some((surface) => need.interfaceKeys.includes(surface))) signals.push('surface key');
  return signals;
}

function needMatchesAtom(need: SourceLocalizationNeed, atom: PlanningAtom): boolean {
  if (need.criterionIds.some((id) => atom.criterionIds.includes(id))) return true;
  if (need.assignedAtomIds.includes(atom.atomId)) return true;
  if (overlap(need.subsystemHints, atom.subsystemHints)) return true;
  if (overlap(need.interfaceKeys, atom.interfaceKeys)) return true;
  if (need.kind === 'literal-path' || need.kind === 'directory') return atom.evidencePaths.some((path) => path === need.query || path.startsWith(`${need.query}/`) || need.query.startsWith(`${path}/`));
  return false;
}

function atomFallbackNeeds(graph?: PlanningAtomGraph): SourceLocalizationNeed[] {
  return graph?.atoms.flatMap((atom) => [
    ...atom.evidencePaths.map((path) => need(`atom-${atom.atomId}-path-${evidenceSlug(path)}`, classifyEvidenceCandidate(path).kind === 'directory' ? 'directory' : 'literal-path', path, atom.criterionIds, [], atom.subsystemHints, atom.interfaceKeys, [atom.atomId], 'atom')),
    ...atom.interfaceKeys.map((key) => need(`atom-${atom.atomId}-interface-${stableSlug(key)}`, 'interface', key, atom.criterionIds, [], atom.subsystemHints, atom.interfaceKeys, [atom.atomId], 'atom')),
  ]) ?? [];
}

function hintNeeds(hint: SourceLocalizationHint): SourceLocalizationNeed[] {
  const queries = [hint.query, ...(hint.keywords ?? [])];
  const contextQuery = queries.join(' ');
  const contextSubsystemHints = hint.subsystemHints ?? inferSubsystemHints(contextQuery);
  const contextInterfaceKeys = hint.interfaceKeys ?? inferInterfaceKeys(contextQuery);
  return [
    ...(hint.paths ?? []).map((pathQuery) => need(`project-hint-path-${evidenceSlug(pathQuery)}`, 'literal-path', pathQuery, hint.criterionIds ?? [], hint.aspectIds ?? [], contextSubsystemHints, [...contextInterfaceKeys, hint.kind], hint.atomIds ?? [], 'project-hint')),
    need(`project-hint-${stableSlug(hint.kind)}-${stableSlug(hint.query)}`, hint.kind, hint.query, hint.criterionIds ?? [], hint.aspectIds ?? [], contextSubsystemHints, contextInterfaceKeys, hint.atomIds ?? [], 'project-hint', hint.paths ?? []),
    ...(hint.keywords ?? []).map((keyword) => need(`project-hint-keyword-${stableSlug(keyword)}`, 'keyword', keyword, hint.criterionIds ?? [], hint.aspectIds ?? [], contextSubsystemHints, contextInterfaceKeys, hint.atomIds ?? [], 'project-hint')),
  ];
}

/**
 * A hint that echoes an existing needId with confirmed paths is the
 * exploration agent answering that need directly; attach the paths as
 * witnesses so the need resolves through the evidence instead of requiring
 * the token scorer to re-derive the claim from prose.
 */
function attachHintWitnesses(needs: SourceLocalizationNeed[], hints: SourceLocalizationHint[]): SourceLocalizationNeed[] {
  const witnessesByNeedId = new Map<string, string[]>();
  for (const hint of hints) {
    if (!hint.needId || !hint.paths?.length) continue;
    witnessesByNeedId.set(hint.needId, [...(witnessesByNeedId.get(hint.needId) ?? []), ...hint.paths]);
  }
  if (witnessesByNeedId.size === 0) return needs;
  return needs.map((item) => {
    const witnesses = witnessesByNeedId.get(item.id);
    return witnesses ? { ...item, witnessPaths: [...new Set([...item.witnessPaths, ...witnesses])].sort() } : item;
  });
}

function need(id: string, kind: SourceLocalizationNeedKind, query: string, criterionIds: string[], aspectIds: string[], subsystemHints: string[], interfaceKeys: string[], assignedAtomIds: string[], source: SourceLocalizationNeed['source'], witnessPaths: string[] = []): SourceLocalizationNeed {
  return { id, kind, query, criterionIds: [...new Set(criterionIds)].sort(), aspectIds: [...new Set(aspectIds)].sort(), subsystemHints: [...new Set(subsystemHints.filter(Boolean))].sort(), interfaceKeys: [...new Set(interfaceKeys.filter(Boolean))].sort(), assignedAtomIds: [...new Set(assignedAtomIds)].sort(), source, witnessPaths: [...new Set(witnessPaths.filter(Boolean))].sort() };
}

function dedupeNeeds(needs: SourceLocalizationNeed[]): SourceLocalizationNeed[] {
  const byId = new Map<string, SourceLocalizationNeed>();
  for (const item of needs) {
    const existing = byId.get(item.id);
    byId.set(item.id, existing ? need(item.id, item.kind, item.query, [...existing.criterionIds, ...item.criterionIds], [...existing.aspectIds, ...item.aspectIds], [...existing.subsystemHints, ...item.subsystemHints], [...existing.interfaceKeys, ...item.interfaceKeys], [...existing.assignedAtomIds, ...item.assignedAtomIds], existing.source, [...existing.witnessPaths, ...item.witnessPaths]) : item);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function candidate(path: string, score: number, reason: string, signals: string[]): SourceLocalizationCandidate {
  return { path, score, reason, confidence: confidenceFor(score), signals: [...new Set(signals)].sort() };
}

function dedupeCandidates(candidates: SourceLocalizationCandidate[]): SourceLocalizationCandidate[] {
  const byPath = new Map<string, SourceLocalizationCandidate>();
  for (const item of candidates) {
    const existing = byPath.get(item.path);
    byPath.set(item.path, existing && existing.score >= item.score ? { ...existing, signals: [...new Set([...existing.signals, ...item.signals])].sort() } : item);
  }
  return [...byPath.values()].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

function confidenceFor(score: number): SourceLocalizationConfidence {
  if (score >= 75) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

function recordStatus(need: SourceLocalizationNeed, candidates: SourceLocalizationCandidate[], diagnostics: SourceLocalizationDiagnostic[]): SourceLocalizationStatus {
  // An exploration-confirmed witness is a direct owner confirmation; breadth
  // capping cannot hide a better candidate than an exact witness match, so
  // budget diagnostics must not degrade a witness-resolved need to partial.
  if (candidates[0]?.confidence === 'high' && candidates[0].signals.includes('witness-path')) return 'resolved';
  if (diagnostics.some((item) => item.code.includes('budget'))) return candidates.length > 0 ? 'partial' : 'budget-exceeded';
  if (candidates.length === 0) return diagnostics.some((item) => item.code === 'broad-directory') ? 'ignored' : 'unresolved';
  return candidates[0].confidence === 'low' ? 'partial' : 'resolved';
}

function budgetNotes(index: RepositoryIndex, limits: SourceLocalizationLimits, candidateCount: number, candidateCap: number): string[] {
  return [`indexed-files:${index.files.length}/${limits.maxIndexedFiles}`, `candidate-files:${Math.min(candidateCount, candidateCap)}/${candidateCap}`, `scan-bytes-per-file:${limits.maxBytesPerScannedFile}`, `scan-bytes-total:${limits.maxTotalScannedBytes}`];
}

function byAtom(records: SourceLocalizationRecord[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const record of records) for (const atomId of record.assignedAtomIds) result[atomId] = [...new Set([...(result[atomId] ?? []), ...record.candidateFiles.map((candidate) => candidate.path)])].sort();
  return result;
}

function aspectIdsForCriterion(criterionId: string, aspects?: PlanningCriterionAspect[]): string[] {
  return aspects?.filter((aspect) => aspect.criterionId === criterionId).map((aspect) => aspect.aspectId).sort() ?? [];
}

function surfaceKindsForText(value: string): SourceLocalizationNeedKind[] {
  return SURFACE_PATTERNS.filter(([, pattern]) => pattern.test(value)).map(([kind]) => kind);
}

function tokenSet(value: string): string[] {
  return stableSlug(value).split('-').filter((token) => token.length > 1);
}

function hasAny(values: string[], needles: string[]): boolean { return countOverlap(values, needles) > 0; }
function countOverlap(values: string[], needles: string[]): number { const set = new Set(values.flatMap(tokenSet)); return [...new Set(needles.flatMap(tokenSet))].filter((needle) => set.has(needle)).length; }
function overlap(a: string[], b: string[]): boolean { return a.some((value) => b.includes(value)); }
