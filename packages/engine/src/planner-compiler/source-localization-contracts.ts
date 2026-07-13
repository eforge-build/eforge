export type SourceLocalizationNeedKind = 'literal-path' | 'directory' | 'subsystem' | 'interface' | 'symbol' | 'keyword' | 'manifest' | 'entrypoint' | 'docs' | 'test' | 'config' | 'command' | 'route' | 'api' | 'ui' | 'extension' | 'consumer-surface';
export type SourceLocalizationStatus = 'resolved' | 'partial' | 'unresolved' | 'ignored' | 'budget-exceeded';
export type SourceLocalizationConfidence = 'high' | 'medium' | 'low';
type SourceLocalizationDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface SourceLocalizationDiagnostic { code: string; message: string; severity: SourceLocalizationDiagnosticSeverity; needId?: string; path?: string }
export interface SourceLocalizationCandidate { path: string; confidence: SourceLocalizationConfidence; score: number; reason: string; signals: string[] }
export interface SourceLocalizationNeed { id: string; kind: SourceLocalizationNeedKind; query: string; criterionIds: string[]; aspectIds: string[]; subsystemHints: string[]; interfaceKeys: string[]; assignedAtomIds: string[]; source: 'criterion' | 'inventory' | 'atom' | 'project-hint'; witnessPaths: string[]; newFileIntent: boolean }
export interface SourceLocalizationRecord { needId: string; kind: SourceLocalizationNeedKind; query: string; status: SourceLocalizationStatus; candidateFiles: SourceLocalizationCandidate[]; confidence: SourceLocalizationConfidence; reason: string; linkedCriterionIds: string[]; linkedAspectIds: string[]; assignedAtomIds: string[]; diagnostics: SourceLocalizationDiagnostic[]; budgetNotes: string[]; source?: SourceLocalizationNeed['source']; subsystemHints?: string[]; interfaceKeys?: string[] }
export interface SourceLocalizationBundle { sourceHash?: string; graphId?: string; records: SourceLocalizationRecord[]; byAtomId: Record<string, string[]>; diagnostics: SourceLocalizationDiagnostic[]; limits: SourceLocalizationLimits; indexDiagnostics: SourceLocalizationDiagnostic[] }
export interface SourceLocalizationHint { needId?: string; kind: SourceLocalizationNeedKind; query: string; paths?: string[]; keywords?: string[]; subsystemHints?: string[]; interfaceKeys?: string[]; criterionIds?: string[]; aspectIds?: string[]; atomIds?: string[]; newFile?: boolean }
export interface SourceLocalizationInputHints { ignorePrefixes?: string[]; ignoreGlobs?: string[]; projectHints?: SourceLocalizationHint[] }
export interface SourceLocalizationLimits { maxIndexedFiles: number; maxCandidateFilesPerNeed: number; maxSurfaceCandidatesPerNeed: number; maxDirectoryExpansionFiles: number; maxBytesPerScannedFile: number; maxTotalScannedBytes: number }
interface NormalizedSourceLocalizationInputs { hints: SourceLocalizationInputHints; limits: SourceLocalizationLimits; diagnostics: SourceLocalizationDiagnostic[] }

export const DEFAULT_SOURCE_LOCALIZATION_LIMITS: SourceLocalizationLimits = {
  maxIndexedFiles: 10_000,
  maxCandidateFilesPerNeed: 12,
  maxSurfaceCandidatesPerNeed: 3,
  maxDirectoryExpansionFiles: 20,
  maxBytesPerScannedFile: 64_000,
  maxTotalScannedBytes: 2_000_000,
};

const SOURCE_LOCALIZATION_LIMIT_MAXIMA: SourceLocalizationLimits = {
  maxIndexedFiles: 100_000,
  maxCandidateFilesPerNeed: 100,
  maxSurfaceCandidatesPerNeed: 100,
  maxDirectoryExpansionFiles: 500,
  maxBytesPerScannedFile: 1_000_000,
  maxTotalScannedBytes: 50_000_000,
};
const SOURCE_LOCALIZATION_NEED_KINDS = new Set<SourceLocalizationNeedKind>(['literal-path', 'directory', 'subsystem', 'interface', 'symbol', 'keyword', 'manifest', 'entrypoint', 'docs', 'test', 'config', 'command', 'route', 'api', 'ui', 'extension', 'consumer-surface']);
const MAX_HINT_ITEMS = 100;
const MAX_HINT_STRING_LENGTH = 1_000;

export function normalizeSourceLocalizationInputs(hints?: SourceLocalizationInputHints, limits?: Partial<SourceLocalizationLimits>): NormalizedSourceLocalizationInputs {
  const diagnostics: SourceLocalizationDiagnostic[] = [];
  return { hints: normalizeHints(hints, diagnostics), limits: normalizeLimits(limits, diagnostics), diagnostics };
}

function normalizeLimits(limits: Partial<SourceLocalizationLimits> | undefined, diagnostics: SourceLocalizationDiagnostic[]): SourceLocalizationLimits {
  const result = { ...DEFAULT_SOURCE_LOCALIZATION_LIMITS };
  for (const key of Object.keys(result) as Array<keyof SourceLocalizationLimits>) {
    const value = limits?.[key];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value <= 0) diagnostics.push({ code: 'invalid-localization-limit', message: `${key} must be a positive integer.`, severity: 'error' });
    else if (value > SOURCE_LOCALIZATION_LIMIT_MAXIMA[key]) diagnostics.push({ code: 'invalid-localization-limit', message: `${key} must be <= ${SOURCE_LOCALIZATION_LIMIT_MAXIMA[key]}.`, severity: 'error' });
    else result[key] = value;
  }
  return result;
}

function normalizeHints(hints: SourceLocalizationInputHints | undefined, diagnostics: SourceLocalizationDiagnostic[]): SourceLocalizationInputHints {
  return {
    ignorePrefixes: normalizePathList(hints?.ignorePrefixes, 'ignorePrefixes', diagnostics),
    ignoreGlobs: normalizePathList(hints?.ignoreGlobs, 'ignoreGlobs', diagnostics),
    projectHints: normalizeProjectHints(hints?.projectHints, diagnostics),
  };
}

function normalizeProjectHints(hints: SourceLocalizationHint[] | undefined, diagnostics: SourceLocalizationDiagnostic[]): SourceLocalizationHint[] {
  if (!hints) return [];
  if (!Array.isArray(hints)) { diagnostics.push({ code: 'invalid-localization-hint', message: 'projectHints must be an array.', severity: 'error' }); return []; }
  if (hints.length > MAX_HINT_ITEMS) diagnostics.push({ code: 'invalid-localization-hint', message: `projectHints is capped at ${MAX_HINT_ITEMS} entries.`, severity: 'error' });
  return hints.slice(0, MAX_HINT_ITEMS).flatMap((hint, index) => {
    if (!hint || typeof hint !== 'object') { diagnostics.push({ code: 'invalid-localization-hint', message: `projectHints[${index}] must be an object.`, severity: 'error' }); return []; }
    if (!SOURCE_LOCALIZATION_NEED_KINDS.has(hint.kind)) { diagnostics.push({ code: 'invalid-localization-hint', message: `projectHints[${index}].kind is invalid.`, severity: 'error' }); return []; }
    const query = normalizeHintString(hint.query, `projectHints[${index}].query`, diagnostics);
    if (!query) return [];
    const needId = hint.needId === undefined ? undefined : normalizeHintString(hint.needId, `projectHints[${index}].needId`, diagnostics);
    return [{
      ...(needId ? { needId } : {}),
      kind: hint.kind,
      query,
      paths: normalizePathList(hint.paths, `projectHints[${index}].paths`, diagnostics),
      keywords: normalizeStringList(hint.keywords, `projectHints[${index}].keywords`, diagnostics),
      subsystemHints: normalizeStringList(hint.subsystemHints, `projectHints[${index}].subsystemHints`, diagnostics),
      interfaceKeys: normalizeStringList(hint.interfaceKeys, `projectHints[${index}].interfaceKeys`, diagnostics),
      criterionIds: normalizeStringList(hint.criterionIds, `projectHints[${index}].criterionIds`, diagnostics),
      aspectIds: normalizeStringList(hint.aspectIds, `projectHints[${index}].aspectIds`, diagnostics),
      atomIds: normalizeStringList(hint.atomIds, `projectHints[${index}].atomIds`, diagnostics),
      ...(hint.newFile === true ? { newFile: true } : {}),
    }];
  });
}

function normalizePathList(values: string[] | undefined, field: string, diagnostics: SourceLocalizationDiagnostic[]): string[] {
  return normalizeStringList(values, field, diagnostics).flatMap((value) => {
    const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/$/, '');
    if (!normalized || normalized.startsWith('/') || normalized.startsWith('../') || normalized.includes('/../') || normalized === '..') {
      diagnostics.push({ code: 'invalid-localization-hint', message: `${field} must contain normalized relative paths/globs.`, severity: 'error', path: value });
      return [];
    }
    return [normalized];
  });
}

function normalizeStringList(values: string[] | undefined, field: string, diagnostics: SourceLocalizationDiagnostic[]): string[] {
  if (!values) return [];
  if (!Array.isArray(values)) { diagnostics.push({ code: 'invalid-localization-hint', message: `${field} must be an array.`, severity: 'error' }); return []; }
  if (values.length > MAX_HINT_ITEMS) diagnostics.push({ code: 'invalid-localization-hint', message: `${field} is capped at ${MAX_HINT_ITEMS} entries.`, severity: 'error' });
  return [...new Set(values.slice(0, MAX_HINT_ITEMS).map((value) => normalizeHintString(value, field, diagnostics)).filter((value): value is string => Boolean(value)))].sort();
}

function normalizeHintString(value: string, field: string, diagnostics: SourceLocalizationDiagnostic[]): string | undefined {
  if (typeof value !== 'string') { diagnostics.push({ code: 'invalid-localization-hint', message: `${field} must be a string.`, severity: 'error' }); return undefined; }
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_HINT_STRING_LENGTH) { diagnostics.push({ code: 'invalid-localization-hint', message: `${field} must be non-empty and at most ${MAX_HINT_STRING_LENGTH} characters.`, severity: 'error' }); return undefined; }
  return normalized;
}

export function validateSourceLocalizationBundle(bundle: SourceLocalizationBundle): { ok: true; errors: [] } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const record of bundle.records) {
    if (seen.has(record.needId)) errors.push(`duplicate localization need:${record.needId}`);
    seen.add(record.needId);
    if (record.candidateFiles.length > bundle.limits.maxCandidateFilesPerNeed) errors.push(`candidate budget exceeded:${record.needId}`);
    for (const candidate of record.candidateFiles) if (!candidate.path || candidate.path.startsWith('/') || candidate.path.includes('..')) errors.push(`invalid candidate path:${record.needId}:${candidate.path}`);
  }
  for (const [atomId, paths] of Object.entries(bundle.byAtomId)) if (paths.some((path) => !bundle.records.some((record) => record.assignedAtomIds.includes(atomId) && record.candidateFiles.some((candidate) => candidate.path === path)))) errors.push(`byAtom contains unassigned path:${atomId}`);
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors: errors.sort() };
}
