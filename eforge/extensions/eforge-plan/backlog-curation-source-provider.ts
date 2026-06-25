import { safeParseWithSchema } from '@eforge-build/client';
import { ExtensionActionInputValidationError } from '@eforge-build/extension-sdk';
import { buildBacklogCurationSource, writeBacklogCurationSourcePreviewMetadata } from './backlog-curation-source.js';
import { validateBacklogCurationPlanningDraftResult } from './backlog-curation-apply.js';
import { ItemAuditConcurrencySchema } from './backlog-curation-schemas.js';
import type { BacklogCurationMapReduceSourceBundle } from '@eforge-build/client';

type BacklogCurationSourceProviderActivityCallback = (message: string) => Promise<void> | void;

type BacklogCurationSourceProviderContext = {
  cwd: string;
  signal: AbortSignal;
  input?: { itemAuditConcurrency?: unknown; redraft?: unknown };
  progress?: BacklogCurationSourceProviderActivityCallback;
  activity?: BacklogCurationSourceProviderActivityCallback;
};

export {
  buildBacklogCurationItemAuditCacheKey,
  defaultBacklogCurationItemAuditPromptVersion,
  readBacklogCurationItemAuditCache,
  resolveBacklogCurationItemAuditCachePath,
  writeBacklogCurationItemAuditCache,
} from './backlog-curation-item-audit-cache.js';

export {
  buildBacklogCurationReducerInput,
} from './backlog-curation-packets.js';

export {
  validateBacklogCurationPlanningDraftResult,
};

export async function buildSource(context: BacklogCurationSourceProviderContext): Promise<{ sourceText: string; backlogCurationMapReduce: BacklogCurationMapReduceSourceBundle }> {
  const itemAuditConcurrency = parseSourceProviderItemAuditConcurrency(context.input?.itemAuditConcurrency);
  const redraft = parseSourceProviderRedraft(context.input?.redraft);
  const source = await buildBacklogCurationSource(context.cwd, redraft, {
    signal: context.signal,
    ...(itemAuditConcurrency !== undefined && { itemAuditConcurrency }),
    ...(context.progress !== undefined && { progress: context.progress }),
    ...(context.activity !== undefined && { activity: context.activity }),
  });
  await writeBacklogCurationSourcePreviewMetadata(context.cwd, source);
  await emitSourceProviderActivity(context, 'Finished source metadata preview write');
  return { sourceText: source.sourceText, backlogCurationMapReduce: source.backlogCurationMapReduce };
}

async function emitSourceProviderActivity(context: BacklogCurationSourceProviderContext, message: string): Promise<void> {
  try {
    await (context.progress ?? context.activity)?.(message);
  } catch {
    // Source-provider milestones are best-effort and must not fail curation.
  }
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
