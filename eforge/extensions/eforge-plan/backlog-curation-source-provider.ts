import { buildBacklogCurationSource } from './backlog-curation-source.js';

export async function buildSource(context: { cwd: string; signal: AbortSignal }): Promise<{ sourceText: string }> {
  const source = await buildBacklogCurationSource(context.cwd, undefined, { signal: context.signal });
  return { sourceText: source.sourceText };
}
