import { resolveEforgePlanStorePath } from '../sqlite/index.js';
import { applyLegacyImportGraph } from './apply-import.js';
import { collectLegacyImportGraph } from './collect.js';
import { toPublicImportReport } from './diagnostics.js';
import type { PlanningStoreImportReport, RunPlanningStoreImportOptions } from './types.js';

export async function runPlanningStoreImport(cwd: string, options: RunPlanningStoreImportOptions = {}): Promise<PlanningStoreImportReport> {
  const dryRun = options.dryRun ?? true;
  const graph = await collectLegacyImportGraph(cwd, options);
  const storePath = resolveEforgePlanStorePath(cwd);
  if (dryRun) return toPublicImportReport(graph, { dryRun, applied: false, replacedExisting: false, storePath, diagnosticLimit: options.diagnosticLimit });
  const result = applyLegacyImportGraph(cwd, graph, { replaceExisting: options.replaceExisting });
  return toPublicImportReport(graph, { dryRun, applied: true, replacedExisting: result.replacedExisting, storePath, diagnosticLimit: options.diagnosticLimit });
}
