export type SourceLocalizationNeedKind = 'literal-path' | 'directory' | 'subsystem' | 'interface' | 'symbol' | 'keyword' | 'manifest' | 'entrypoint' | 'docs' | 'test' | 'config' | 'command' | 'route' | 'api' | 'ui' | 'extension' | 'consumer-surface';
export type SourceLocalizationStatus = 'resolved' | 'partial' | 'unresolved' | 'ignored' | 'budget-exceeded';
export type SourceLocalizationConfidence = 'high' | 'medium' | 'low';
export type SourceLocalizationDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface SourceLocalizationDiagnostic { code: string; message: string; severity: SourceLocalizationDiagnosticSeverity; needId?: string; path?: string }
export interface SourceLocalizationCandidate { path: string; confidence: SourceLocalizationConfidence; score: number; reason: string; signals: string[] }
export interface SourceLocalizationNeed { id: string; kind: SourceLocalizationNeedKind; query: string; criterionIds: string[]; aspectIds: string[]; subsystemHints: string[]; interfaceKeys: string[]; assignedAtomIds: string[]; source: 'criterion' | 'inventory' | 'atom' | 'project-hint' }
export interface SourceLocalizationRecord { needId: string; kind: SourceLocalizationNeedKind; query: string; status: SourceLocalizationStatus; candidateFiles: SourceLocalizationCandidate[]; confidence: SourceLocalizationConfidence; reason: string; linkedCriterionIds: string[]; linkedAspectIds: string[]; assignedAtomIds: string[]; diagnostics: SourceLocalizationDiagnostic[]; budgetNotes: string[] }
export interface SourceLocalizationBundle { sourceHash?: string; graphId?: string; records: SourceLocalizationRecord[]; byAtomId: Record<string, string[]>; diagnostics: SourceLocalizationDiagnostic[]; limits: SourceLocalizationLimits; indexDiagnostics: SourceLocalizationDiagnostic[] }
export interface SourceLocalizationHint { kind: SourceLocalizationNeedKind; query: string; paths?: string[]; keywords?: string[]; subsystemHints?: string[]; interfaceKeys?: string[]; criterionIds?: string[]; aspectIds?: string[]; atomIds?: string[] }
export interface SourceLocalizationInputHints { ignorePrefixes?: string[]; ignoreGlobs?: string[]; projectHints?: SourceLocalizationHint[] }
export interface SourceLocalizationLimits { maxIndexedFiles: number; maxCandidateFilesPerNeed: number; maxDirectoryExpansionFiles: number; maxBytesPerScannedFile: number; maxTotalScannedBytes: number }

export const DEFAULT_SOURCE_LOCALIZATION_LIMITS: SourceLocalizationLimits = {
  maxIndexedFiles: 10_000,
  maxCandidateFilesPerNeed: 12,
  maxDirectoryExpansionFiles: 20,
  maxBytesPerScannedFile: 64_000,
  maxTotalScannedBytes: 2_000_000,
};

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
