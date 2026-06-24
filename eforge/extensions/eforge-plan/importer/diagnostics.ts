import { MAX_IMPORT_DIAGNOSTIC_LIMIT, type ImportDiagnostic, type ImportDiagnosticCode, type ImportDiagnosticSeverity, type LegacyImportGraph, type PlanningStoreImportReport } from './types.js';
import { canonicalJson, stableId } from './stable.js';

export function diagnostic(input: Omit<ImportDiagnostic, 'diagnosticId'> & { diagnosticId?: string }): ImportDiagnostic {
  const base = { severity: input.severity, code: input.code, message: input.message, ref: input.ref, path: input.path, details: input.details };
  return { ...base, diagnosticId: input.diagnosticId ?? stableDiagnosticId(base) };
}
export function stableDiagnosticId(input: Omit<ImportDiagnostic, 'diagnosticId'>): string { return stableId('import-diagnostic', input); }
export function addDiagnostic(graph: LegacyImportGraph, code: ImportDiagnosticCode, message: string, opts: { severity?: ImportDiagnosticSeverity; ref?: string; path?: string; details?: ImportDiagnostic['details'] } = {}): void { graph.diagnostics.push(diagnostic({ severity: opts.severity ?? 'warning', code, message, ref: opts.ref, path: opts.path, details: opts.details })); }
export function sortDiagnostics(diags: readonly ImportDiagnostic[]): ImportDiagnostic[] { return [...diags].sort((a, b) => canonicalJson([a.code, a.path, a.ref, a.message]).localeCompare(canonicalJson([b.code, b.path, b.ref, b.message]))); }
export function toPublicImportReport(graph: LegacyImportGraph, input: { dryRun: boolean; applied: boolean; replacedExisting: boolean; storePath: string; diagnosticLimit?: number }): PlanningStoreImportReport {
  const diagnostics = sortDiagnostics(graph.diagnostics);
  const limit = Math.min(MAX_IMPORT_DIAGNOSTIC_LIMIT, Math.max(0, Math.trunc(input.diagnosticLimit ?? 50)));
  return { schemaVersion: 1, dryRun: input.dryRun, applied: input.applied, replacedExisting: input.replacedExisting, storePath: input.storePath, include: graph.include, sourceFingerprint: graph.sourceFingerprint, counts: graph.counts, diagnosticCount: diagnostics.length, diagnostics: diagnostics.slice(0, limit), diagnosticsOmitted: Math.max(0, diagnostics.length - limit) };
}
