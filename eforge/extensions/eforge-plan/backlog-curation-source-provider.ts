import { safeParseWithSchema } from '@eforge-build/client';
import { ExtensionActionInputValidationError } from '@eforge-build/extension-sdk';
import { buildBacklogCurationSource, writeBacklogCurationSourcePreviewMetadata } from './backlog-curation-source.js';
// --- eforge:region plan-03-daemon-map-reduce-integration ---
import { validateBacklogCurationPlanningDraftResult } from './backlog-curation-apply.js';
// --- eforge:endregion plan-03-daemon-map-reduce-integration ---
import { ItemAuditConcurrencySchema } from './backlog-curation-schemas.js';
import type { BacklogCurationMapReduceSourceBundle } from '@eforge-build/client';

// --- eforge:region plan-01-curation-packets-cache ---
export {
  buildBacklogCurationItemAuditCacheKey,
  defaultBacklogCurationItemAuditPromptVersion,
  readBacklogCurationItemAuditCache,
  resolveBacklogCurationItemAuditCachePath,
  writeBacklogCurationItemAuditCache,
} from './backlog-curation-item-audit-cache.js';
// --- eforge:endregion plan-01-curation-packets-cache ---

// --- eforge:region plan-03-daemon-map-reduce-integration ---
export {
  buildBacklogCurationReducerInput,
} from './backlog-curation-packets.js';

export {
  validateBacklogCurationPlanningDraftResult,
};
// --- eforge:endregion plan-03-daemon-map-reduce-integration ---

export async function buildSource(context: { cwd: string; signal: AbortSignal; input?: { itemAuditConcurrency?: unknown; redraft?: unknown } }): Promise<{ sourceText: string; backlogCurationMapReduce: BacklogCurationMapReduceSourceBundle }> {
  const itemAuditConcurrency = parseSourceProviderItemAuditConcurrency(context.input?.itemAuditConcurrency);
  const redraft = parseSourceProviderRedraft(context.input?.redraft);
  const source = await buildBacklogCurationSource(context.cwd, redraft, { signal: context.signal, ...(itemAuditConcurrency !== undefined && { itemAuditConcurrency }) });
  await writeBacklogCurationSourcePreviewMetadata(context.cwd, source);
  return { sourceText: source.sourceText, backlogCurationMapReduce: source.backlogCurationMapReduce };
}

function parseSourceProviderItemAuditConcurrency(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const result = safeParseWithSchema(ItemAuditConcurrencySchema, value);
  if (result.success) return result.data;
  throw new ExtensionActionInputValidationError('Invalid backlog curation source itemAuditConcurrency.', result.error.errors.map((error) => ({ path: `itemAuditConcurrency${error.path}`, message: error.message })));
}

function parseSourceProviderRedraft(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new ExtensionActionInputValidationError('Invalid backlog curation source redraft context.', [{ path: 'redraft', message: 'redraft must be an object when provided.' }]);
}
