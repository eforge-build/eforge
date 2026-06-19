import { safeParseWithSchema } from '@eforge-build/client';
import { ExtensionActionInputValidationError } from '@eforge-build/extension-sdk';
import { buildBacklogCurationSource, writeBacklogCurationSourcePreviewMetadata } from './backlog-curation-source.js';
import { BacklogCurationScanModeSchema, type BacklogCurationScanMode } from './backlog-curation-schemas.js';

export async function buildSource(context: { cwd: string; signal: AbortSignal; input?: { scanMode?: unknown } }): Promise<{ sourceText: string }> {
  const scanMode = parseSourceProviderScanMode(context.input?.scanMode);
  const source = await buildBacklogCurationSource(context.cwd, undefined, { signal: context.signal, ...(scanMode !== undefined && { scanMode }) });
  await writeBacklogCurationSourcePreviewMetadata(context.cwd, source);
  return { sourceText: source.sourceText };
}

function parseSourceProviderScanMode(value: unknown): BacklogCurationScanMode | undefined {
  if (value === undefined) return undefined;
  const result = safeParseWithSchema(BacklogCurationScanModeSchema, value);
  if (result.success) return result.data;
  throw new ExtensionActionInputValidationError('Invalid backlog curation source scanMode.', result.error.errors.map((error) => ({ path: `scanMode${error.path}`, message: error.message })));
}
