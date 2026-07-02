import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { classifyEvidenceCandidate } from './evidence-hygiene.js';
import { utf8ByteLength } from './source-analysis.js';
import { DEFAULT_PLANNING_SOURCE_EVIDENCE_LIMITS, validatePlanningSourceEvidenceBundle, type PlanningSourceEvidenceBundle, type PlanningSourceEvidenceLimits, type PlanningSourceEvidenceRecord, type PlanningSourceEvidenceStatus } from './source-evidence-contracts.js';
import type { PlanningAtomGraph } from './atom-graph.js';
import type { PlanningEvidenceOwnership, SharedPlanningBrief } from './shared-brief-contracts.js';

export interface MaterializePlanningSourceEvidenceInput { cwd: string; graph: PlanningAtomGraph; sharedBrief: SharedPlanningBrief; limits?: Partial<PlanningSourceEvidenceLimits> }

export async function materializePlanningSourceEvidence(input: MaterializePlanningSourceEvidenceInput): Promise<PlanningSourceEvidenceBundle> {
  const limits = { ...DEFAULT_PLANNING_SOURCE_EVIDENCE_LIMITS, ...(input.limits ?? {}) };
  const state = { totalBytes: 0, filesByAtom: new Map<string, number>(), bytesByAtom: new Map<string, number>() };
  const records: PlanningSourceEvidenceRecord[] = [];
  for (const [index, ownership] of rankOwnershipForMaterialization(input.sharedBrief.evidenceOwnership).entries()) {
    records.push(index >= limits.maxFilesTotal ? budgetRecord(ownership, 'max-files-total') : await materializeOne(input.cwd, ownership, limits, state));
  }
  const bundle: PlanningSourceEvidenceBundle = { graphId: input.graph.graphId, sourceHash: input.graph.sourceHash, records: records.sort((a, b) => a.path.localeCompare(b.path)), byAtomId: buildByAtom(records), bytesByAtomId: mapToSortedRecord(state.bytesByAtom), filesByAtomId: mapToSortedRecord(state.filesByAtom), totalBytes: state.totalBytes, limits, validationErrors: [] };
  const validation = validatePlanningSourceEvidenceBundle({ graph: input.graph, sharedBrief: input.sharedBrief, bundle, limits });
  return { ...bundle, validationErrors: validation.ok ? [] : validation.errors };
}

/**
 * When file and byte budgets bind, they must keep the highest-value evidence,
 * not the alphabetically-first: ownership order is path-sorted, so iterating
 * it directly materializes docs/config sweep-ins while src/ and test/ files
 * (alphabetically late) starve - fatal once a single-atom graph funnels every
 * path into one per-atom budget. Criterion-linked paths win, then localization
 * confidence, then candidate rank, then wider atom reach. Output records are
 * re-sorted by path, so only budget contention order changes.
 */
function rankOwnershipForMaterialization(ownership: PlanningEvidenceOwnership[]): PlanningEvidenceOwnership[] {
  const confidenceRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return [...ownership].sort((a, b) =>
    Number(b.criterionLinked === true) - Number(a.criterionLinked === true)
    || (confidenceRank[a.localizationConfidence ?? ''] ?? 3) - (confidenceRank[b.localizationConfidence ?? ''] ?? 3)
    || (a.candidateRank ?? Number.MAX_SAFE_INTEGER) - (b.candidateRank ?? Number.MAX_SAFE_INTEGER)
    || b.referencedByAtomIds.length - a.referencedByAtomIds.length
    || a.path.localeCompare(b.path));
}

async function materializeOne(cwd: string, ownership: PlanningEvidenceOwnership, limits: PlanningSourceEvidenceLimits, state: { totalBytes: number; filesByAtom: Map<string, number>; bytesByAtom: Map<string, number> }): Promise<PlanningSourceEvidenceRecord> {
  const candidate = classifyEvidenceCandidate(ownership.path);
  if (!candidate.actionable) return statusRecord(ownership, 'non-actionable', candidate.reason);
  const resolved = safeResolve(cwd, ownership.path);
  if (!resolved) return statusRecord(ownership, 'non-actionable', 'path-outside-cwd');
  try {
    const info = await lstat(resolved);
    if (info.isSymbolicLink()) return statusRecord(ownership, 'read-error', 'symlinks-are-not-materialized');
    const containedPath = await realPathInsideCwd(cwd, resolved);
    if (!containedPath) return statusRecord(ownership, 'read-error', 'resolved-path-outside-cwd');
    if (info.isDirectory()) return statusRecord(ownership, 'directory', 'directories-are-not-materialized');
    if (!info.isFile()) return statusRecord(ownership, 'read-error', 'not-a-regular-file');
    if (info.size > limits.maxBytesPerFile) return statusRecord(ownership, 'too-large', 'file-byte-size-exceeds-limit', { byteLength: info.size });
    const deliveredToAtomIds = deliveryAtoms(ownership);
    if (deliveredToAtomIds.some((atomId) => (state.filesByAtom.get(atomId) ?? 0) >= limits.maxFilesPerAtom)) return statusRecord(ownership, 'budget-exceeded', 'max-files-per-atom');
    const content = await readFile(containedPath, 'utf8');
    const excerpt = boundedBytes(content, limits.maxExcerptBytesPerFile);
    const excerptByteLength = utf8ByteLength(excerpt);
    if (state.totalBytes + excerptByteLength > limits.maxBytesTotal) return statusRecord(ownership, 'budget-exceeded', 'max-total-evidence-bytes', { byteLength: info.size });
    if (deliveredToAtomIds.some((atomId) => (state.bytesByAtom.get(atomId) ?? 0) + excerptByteLength > limits.maxEvidenceBytesPerAtom)) return statusRecord(ownership, 'budget-exceeded', 'max-evidence-bytes-per-atom', { byteLength: info.size });
    for (const atomId of deliveredToAtomIds) {
      state.filesByAtom.set(atomId, (state.filesByAtom.get(atomId) ?? 0) + 1);
      state.bytesByAtom.set(atomId, (state.bytesByAtom.get(atomId) ?? 0) + excerptByteLength);
    }
    state.totalBytes += excerptByteLength;
    return baseRecord(ownership, 'materialized', { deliveredToAtomIds, byteLength: info.size, excerptByteLength, accountedByteLength: excerptByteLength, budgetNotes: evidenceBudgetNotes(info.size, excerptByteLength, limits), contentExcerpt: excerpt });
  } catch (err) {
    if (isNotFound(err)) return statusRecord(ownership, 'missing', 'file-not-found');
    return statusRecord(ownership, 'read-error', 'read-failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

function buildByAtom(records: PlanningSourceEvidenceRecord[]): Record<string, string[]> {
  const byAtom: Record<string, string[]> = {};
  for (const record of records) {
    for (const atomId of record.referencedByAtomIds) byAtom[atomId] = [...(byAtom[atomId] ?? []), record.path].sort();
  }
  return byAtom;
}

function budgetRecord(ownership: PlanningEvidenceOwnership, reason: string): PlanningSourceEvidenceRecord {
  return statusRecord(ownership, 'budget-exceeded', reason);
}

function statusRecord(ownership: PlanningEvidenceOwnership, status: PlanningSourceEvidenceStatus, reason: string, extra: Partial<PlanningSourceEvidenceRecord> = {}): PlanningSourceEvidenceRecord {
  return baseRecord(ownership, status, { reason, ...extra });
}

function baseRecord(ownership: PlanningEvidenceOwnership, status: PlanningSourceEvidenceStatus, extra: Partial<PlanningSourceEvidenceRecord> = {}): PlanningSourceEvidenceRecord {
  return { path: ownership.path, status, referencedByAtomIds: [...ownership.referencedByAtomIds], ...(ownership.primaryAtomId ? { primaryAtomId: ownership.primaryAtomId } : {}), shared: ownership.shared, deliveredToAtomIds: [], ...localizationMetadata(ownership), ...extra };
}

function localizationMetadata(ownership: PlanningEvidenceOwnership): Partial<PlanningSourceEvidenceRecord> {
  return {
    ...(ownership.localizationNeedIds ? { localizationNeedIds: [...ownership.localizationNeedIds] } : {}),
    ...(ownership.localizationStatus ? { localizationStatus: ownership.localizationStatus } : {}),
    ...(ownership.localizationConfidence ? { localizationConfidence: ownership.localizationConfidence } : {}),
    ...(ownership.candidateRank !== undefined ? { candidateRank: ownership.candidateRank } : {}),
    ...(ownership.ownershipRationale ? { ownershipRationale: ownership.ownershipRationale } : {}),
  };
}

function evidenceBudgetNotes(byteLength: number, excerptByteLength: number, limits: PlanningSourceEvidenceLimits): string[] {
  return [
    `file-bytes:${byteLength}/${limits.maxBytesPerFile}`,
    `excerpt-bytes:${excerptByteLength}/${limits.maxExcerptBytesPerFile}`,
    ...(excerptByteLength < byteLength ? ['excerpt-truncated'] : []),
  ];
}

function mapToSortedRecord(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function deliveryAtoms(ownership: PlanningEvidenceOwnership): string[] {
  return ownership.shared ? (ownership.primaryAtomId ? [ownership.primaryAtomId] : []) : [...ownership.referencedByAtomIds].sort();
}

function safeResolve(cwd: string, candidate: string): string | undefined {
  const root = path.resolve(cwd);
  const resolved = path.resolve(root, candidate);
  return isInsidePath(root, resolved) ? resolved : undefined;
}

async function realPathInsideCwd(cwd: string, resolved: string): Promise<string | undefined> {
  const [rootRealPath, targetRealPath] = await Promise.all([realpath(cwd), realpath(resolved)]);
  return isInsidePath(rootRealPath, targetRealPath) ? targetRealPath : undefined;
}

function isInsidePath(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function boundedBytes(content: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (utf8ByteLength(content) <= maxBytes) return content;
  let result = '';
  let usedBytes = 0;
  for (const char of content) {
    const charBytes = utf8ByteLength(char);
    if (usedBytes + charBytes > maxBytes) break;
    result += char;
    usedBytes += charBytes;
  }
  return result;
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === 'ENOENT';
}
