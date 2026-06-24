import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseMarkdownRecord } from '../markdown-store.js';
import type { Collector } from './types.js';
import { addDiagnostic } from './diagnostics.js';
import { asString, compactText, projectRelative, sha256, stableId } from './stable.js';

export const collectLegacyQueue: Collector = (cwd, graph) => {
  if (!graph.include.includes('queue')) return;
  const roots: Array<[string, string]> = [['queued', join(cwd, '.eforge/queue')], ['waiting', join(cwd, '.eforge/queue/waiting')], ['failed', join(cwd, '.eforge/queue/failed')], ['skipped', join(cwd, '.eforge/queue/skipped')]];
  for (const [status, root] of roots) if (existsSync(root)) for (const name of readdirSync(root).filter((n) => n.endsWith('.md')).sort()) readQueue(cwd, graph, root, name, status);
};
function readQueue(cwd: string, graph: Parameters<Collector>[1], root: string, name: string, status: string): void {
  const path = join(root, name); const rel = projectRelative(cwd, path); const prdId = basename(name, '.md');
  try {
    const raw = readFileSync(path, 'utf8'); const parsed = parseMarkdownRecord(raw); const eforgePlan = object(parsed.frontmatter.eforge_plan); const lock = join(cwd, '.eforge/queue-locks', `${prdId}.lock`); const running = existsSync(lock) && /^\d+\s*$/.test(readFileSync(lock, 'utf8'));
    const itemRefs = strings(eforgePlan.source_item_ids ?? eforgePlan.source_item_id); const epicRefs = strings(eforgePlan.source_epic_ids ?? eforgePlan.source_epic_id);
    const fallback = /Backlog item id:\s*([^\s]+)/i.exec(raw)?.[1]; if (fallback && !itemRefs.includes(fallback)) itemRefs.push(fallback);
    const rawSession = asString(parsed.frontmatter.session); const session = rawSession && graph.sessionPlans.some((s) => s.plan.session === rawSession) ? rawSession : undefined;
    if (rawSession && !session) addDiagnostic(graph, 'orphan-ref', `Queue PRD ${prdId} references missing session plan ${rawSession}.`, { ref: rawSession, path: rel });
    graph.queuePrds.push({ prdId, session, sourceId: itemRefs[0] ?? epicRefs[0], sourcePath: rel, externalRef: asString(eforgePlan.source_recommendation_ref), status: running ? 'running' : status, createdAt: asString(parsed.frontmatter.createdAt) ?? asString(parsed.frontmatter.created), updatedAt: asString(parsed.frontmatter.updatedAt) ?? asString(parsed.frontmatter.updated), submittedAt: asString(parsed.frontmatter.submittedAt), statusSummary: compactText(parsed.body, 300), importFingerprint: sha256(raw) });
    for (const itemRef of itemRefs) graph.lifecycleEvidence.push({ evidenceKey: `queue:${prdId}:${itemRef}`, itemRef, itemId: graph.items.some((i) => i.item.id === itemRef) ? itemRef : undefined, queuePrdId: prdId, lifecycleState: running ? 'build' : 'queued', reasonCode: 'queue-prd', evidenceKind: 'queue', status: running ? 'running' : status, links: { path: rel, prdId } as never });
    if (status === 'failed') readRecovery(cwd, graph, prdId, rel, itemRefs);
  } catch (e) { addDiagnostic(graph, 'unreadable-artifact', `Could not read queue artifact ${name}.`, { path: rel, severity: 'error', details: { error: String(e) } }); }
}
function readRecovery(cwd: string, graph: Parameters<Collector>[1], prdId: string, sourcePath: string, itemRefs: string[]) { const path = join(cwd, '.eforge/queue/failed', `${prdId}.recovery.json`); if (!existsSync(path)) return; const rel = projectRelative(cwd, path); try { const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; for (const itemRef of itemRefs) graph.lifecycleEvidence.push({ evidenceKey: stableId('queue-recovery', { prdId, itemRef }), itemRef, itemId: graph.items.some((i) => i.item.id === itemRef) ? itemRef : undefined, queuePrdId: prdId, lifecycleState: raw.acceptedSuccess ? 'shipped' : 'failed', reasonCode: 'queue-recovery', evidenceKind: 'queue-recovery', status: asString(raw.status), summary: compactText(raw.failureSummary ?? raw.summary), links: { path: rel, sourcePath, recovery: raw } as never }); } catch (e) { addDiagnostic(graph, 'unsupported-legacy-payload', `Malformed queue recovery sidecar for ${prdId}.`, { path: rel, severity: 'error', details: { error: String(e) } }); } }
function object(v: unknown): Record<string, unknown> { return v && typeof v === 'object' ? v as Record<string, unknown> : {}; }
function strings(v: unknown): string[] { return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : []; }
