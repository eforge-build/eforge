import type { PlanningAtomGraph } from './atom-graph.js';
import { classifyEvidenceCandidate } from './evidence-hygiene.js';
import { utf8ByteLength } from './source-analysis.js';
import type { SharedPlanningBrief } from './shared-brief-contracts.js';
import type { SourceLocalizationConfidence, SourceLocalizationStatus } from './source-localization-contracts.js';

export type PlanningSourceEvidenceStatus = 'materialized' | 'missing' | 'non-actionable' | 'directory' | 'too-large' | 'read-error' | 'budget-exceeded';

export interface PlanningSourceEvidenceLimits { maxFilesTotal: number; maxFilesPerAtom: number; maxBytesTotal: number; maxBytesPerFile: number; maxExcerptBytesPerFile: number; maxEvidenceBytesPerAtom: number; maxPriorityEvidenceBytesPerAtom: number }
export interface PlanningSourceEvidenceLocalizationMetadata { localizationNeedIds?: string[]; localizationStatus?: SourceLocalizationStatus; localizationConfidence?: SourceLocalizationConfidence; candidateRank?: number; ownershipRationale?: string; budgetNotes?: string[]; accountedByteLength?: number }
export interface PlanningSourceEvidenceRecord extends PlanningSourceEvidenceLocalizationMetadata { path: string; status: PlanningSourceEvidenceStatus; referencedByAtomIds: string[]; primaryAtomId?: string; shared: boolean; deliveredToAtomIds: string[]; byteLength?: number; excerptByteLength?: number; contentExcerpt?: string; reason?: string; error?: string; priority?: boolean; budgetAtomIds?: string[] }
export interface PlanningSourceEvidenceBundle { graphId: string; sourceHash: string; records: PlanningSourceEvidenceRecord[]; byAtomId: Record<string, string[]>; bytesByAtomId?: Record<string, number>; filesByAtomId?: Record<string, number>; totalBytes: number; limits: PlanningSourceEvidenceLimits; validationErrors: string[] }
export interface ValidatePlanningSourceEvidenceBundleInput { graph: PlanningAtomGraph; sharedBrief: SharedPlanningBrief; bundle: PlanningSourceEvidenceBundle; limits?: PlanningSourceEvidenceLimits }
export type PlanningSourceEvidenceValidation = { ok: true; errors: [] } | { ok: false; errors: string[] };

export const DEFAULT_PLANNING_SOURCE_EVIDENCE_LIMITS: PlanningSourceEvidenceLimits = { maxFilesTotal: 40, maxFilesPerAtom: 8, maxBytesTotal: 80_000, maxBytesPerFile: 200_000, maxExcerptBytesPerFile: 8_000, maxEvidenceBytesPerAtom: 20_000, maxPriorityEvidenceBytesPerAtom: 40_000 };

export function validatePlanningSourceEvidenceBundle(input: ValidatePlanningSourceEvidenceBundleInput): PlanningSourceEvidenceValidation {
  const limits = input.limits ?? input.bundle.limits ?? DEFAULT_PLANNING_SOURCE_EVIDENCE_LIMITS;
  const errors: string[] = [...input.bundle.validationErrors];
  const atomIds = new Set(input.graph.atoms.map((atom) => atom.atomId));
  const ownership = new Map(input.sharedBrief.evidenceOwnership.map((entry) => [entry.path, entry]));
  if (input.bundle.graphId !== input.graph.graphId) errors.push(`source evidence graph mismatch:${input.bundle.graphId}->${input.graph.graphId}`);
  if (input.bundle.sourceHash !== input.graph.sourceHash) errors.push(`source evidence source mismatch:${input.bundle.sourceHash}->${input.graph.sourceHash}`);
  if (input.bundle.totalBytes > limits.maxBytesTotal) errors.push(`source evidence total budget exceeded:${input.bundle.totalBytes}`);
  validateRecords(input.bundle.records, ownership, atomIds, limits, errors);
  validateByAtom(input.bundle, atomIds, ownership, errors);
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors: [...new Set(errors)].sort() };
}

export function sourceEvidenceRecordsForAtom(bundle: PlanningSourceEvidenceBundle | undefined, atomId: string): PlanningSourceEvidenceRecord[] {
  if (!bundle) return [];
  const paths = new Set(bundle.byAtomId[atomId] ?? []);
  return bundle.records.filter((record) => paths.has(record.path)).map((record) => recordForAtom(record, atomId));
}

function validateRecords(records: PlanningSourceEvidenceRecord[], ownership: Map<string, SharedPlanningBrief['evidenceOwnership'][number]>, atomIds: Set<string>, limits: PlanningSourceEvidenceLimits, errors: string[]): void {
  validateUnique('source evidence record', records.map((record) => record.path), errors);
  for (const record of records) {
    const owned = ownership.get(record.path);
    if (!owned) errors.push(`source evidence path not in ownership:${record.path}`);
    if (record.status === 'materialized' && !classifyEvidenceCandidate(record.path).actionable) errors.push(`non-actionable evidence materialized:${record.path}`);
    if (record.status === 'materialized' && record.contentExcerpt === undefined) errors.push(`materialized evidence missing excerpt:${record.path}`);
    if (record.status !== 'materialized' && record.contentExcerpt !== undefined) errors.push(`non-materialized evidence has excerpt:${record.path}`);
    if ((record.excerptByteLength ?? 0) > limits.maxExcerptBytesPerFile || utf8ByteLength(record.contentExcerpt ?? '') > limits.maxExcerptBytesPerFile) errors.push(`source evidence excerpt budget exceeded:${record.path}`);
    for (const atomId of [...record.referencedByAtomIds, ...record.deliveredToAtomIds, ...(record.budgetAtomIds ?? [])]) if (!atomIds.has(atomId)) errors.push(`source evidence unknown atom:${record.path}:${atomId}`);
    if (record.primaryAtomId && !record.referencedByAtomIds.includes(record.primaryAtomId)) errors.push(`source evidence primary does not reference path:${record.path}:${record.primaryAtomId}`);
    if (record.shared && record.status === 'materialized' && record.primaryAtomId && !sameStringList(record.deliveredToAtomIds, [record.primaryAtomId])) errors.push(`shared evidence delivered outside primary atom:${record.path}`);
  }
}

function validateByAtom(bundle: PlanningSourceEvidenceBundle, atomIds: Set<string>, ownership: Map<string, SharedPlanningBrief['evidenceOwnership'][number]>, errors: string[]): void {
  for (const [atomId, paths] of Object.entries(bundle.byAtomId)) {
    if (!atomIds.has(atomId)) errors.push(`source evidence byAtom unknown atom:${atomId}`);
    for (const path of paths) {
      const owned = ownership.get(path);
      if (!owned) errors.push(`source evidence byAtom unknown path:${atomId}:${path}`);
      else if (!owned.referencedByAtomIds.includes(atomId)) errors.push(`source evidence byAtom atom does not reference path:${atomId}:${path}`);
    }
  }
}

function recordForAtom(record: PlanningSourceEvidenceRecord, atomId: string): PlanningSourceEvidenceRecord {
  if (record.deliveredToAtomIds.includes(atomId)) return cloneRecord(record);
  const { contentExcerpt: _contentExcerpt, ...withoutExcerpt } = record;
  return cloneRecord(withoutExcerpt);
}

function cloneRecord(record: PlanningSourceEvidenceRecord): PlanningSourceEvidenceRecord {
  return {
    ...record,
    referencedByAtomIds: [...record.referencedByAtomIds],
    deliveredToAtomIds: [...record.deliveredToAtomIds],
    ...(record.localizationNeedIds ? { localizationNeedIds: [...record.localizationNeedIds] } : {}),
    ...(record.budgetNotes ? { budgetNotes: [...record.budgetNotes] } : {}),
    ...(record.budgetAtomIds ? { budgetAtomIds: [...record.budgetAtomIds] } : {}),
  };
}

function validateUnique(kind: string, ids: string[], errors: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) errors.push(`${kind} duplicated:${id}`);
    seen.add(id);
  }
}

function sameStringList(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}
