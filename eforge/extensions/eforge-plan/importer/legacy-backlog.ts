import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractMarkdownSections, normalizeBacklogEpic, normalizeBacklogItem } from '../backlog-domain.js';
import { parseMarkdownRecord } from '../markdown-store.js';
import type { Collector, LegacyBacklogItemRecord, LegacyEpicRecord } from './types.js';
import { addDiagnostic } from './diagnostics.js';
import { canonicalJson, projectRelative, sha256 } from './stable.js';

export const collectLegacyBacklog: Collector = (cwd, graph) => {
  if (graph.include.includes('epics')) collectKind(cwd, graph, 'epics');
  if (graph.include.includes('backlog')) collectKind(cwd, graph, 'items');
};

function collectKind(cwd: string, graph: Parameters<Collector>[1], kind: 'items' | 'epics'): void {
  const roots = [join(cwd, '.eforge/storage/extensions/eforge-plan/backlog', kind), join(cwd, '.backlog', kind)];
  const byId = new Map<string, { path: string; origin: string }[]>();
  for (const root of roots) if (existsSync(root)) for (const name of readdirSync(root).filter((n) => n.endsWith('.md'))) {
    const path = join(root, name); const rel = projectRelative(cwd, path);
    let raw: string;
    try { raw = readFileSync(path, 'utf8'); }
    catch (error) { addDiagnostic(graph, 'unreadable-artifact', `Could not read ${kind} Markdown record ${name}.`, { path: rel, severity: 'error', details: { error: error instanceof Error ? error.message : String(error) } }); continue; }
    try {
      const id = parseMarkdownRecord(raw).frontmatter.id;
      if (typeof id === 'string' && id.trim()) byId.set(id, [...(byId.get(id) ?? []), { path, origin: root.includes('/.backlog/') ? 'legacy-backlog' : 'private-markdown' }]);
      else addDiagnostic(graph, 'unsupported-legacy-payload', `${kind} Markdown record lacks a usable id.`, { path: rel, severity: 'error' });
    } catch (error) { addDiagnostic(graph, 'unsupported-legacy-payload', `Could not parse ${kind} Markdown record ${name}.`, { path: rel, severity: 'error', details: { error: error instanceof Error ? error.message : String(error) } }); }
  }
  const selectedIds = new Set([...byId.keys()]);
  for (const [id, entries] of [...byId].sort()) {
    if (entries.length > 1) addDiagnostic(graph, 'duplicate-id', `Duplicate ${kind} id "${id}"; private Markdown wins when present.`, { ref: id, details: { paths: entries.map((e) => projectRelative(cwd, e.path)) } });
    const selected = entries.find((e) => e.origin === 'private-markdown') ?? entries[0]!;
    try { addRecord(cwd, graph, kind, selected.path, selected.origin, selectedIds); }
    catch (error) { addDiagnostic(graph, 'unsupported-legacy-payload', `Could not import ${kind} record ${id}: ${error instanceof Error ? error.message : String(error)}`, { ref: id, path: projectRelative(cwd, selected.path), severity: 'error' }); }
  }
}

function sections(body: string) { return [...extractMarkdownSections(body)].map(([sectionName, content]) => ({ sectionName, content, contentSha256: sha256(content) })); }
function addRecord(cwd: string, graph: Parameters<Collector>[1], kind: 'items' | 'epics', path: string, origin: string, selectedIds: Set<string>): void {
  const raw = readFileSync(path, 'utf8'); const parsed = parseMarkdownRecord(raw); const rel = projectRelative(cwd, path);
  const recordSha256 = sha256(canonicalJson({ frontmatter: parsed.frontmatter, body: parsed.body })); const bodySha256 = sha256(parsed.body);
  if (kind === 'epics') {
    const e = normalizeBacklogEpic(parsed.frontmatter, parsed.body);
    const rec: LegacyEpicRecord = { epic: { id: e.id, title: e.title, body: e.body, userStatus: e.status, priority: e.priority, source: e.source, createdAt: e.created, updatedAt: e.updated, lastCheckedAt: e.last_checked, staleAfter: e.stale_after, frontmatter: parsed.frontmatter as never, bodySha256, recordSha256, importOrigin: origin, importPath: rel }, tags: e.tags, sections: sections(e.body) };
    graph.epics.push(rec); graph.searchDirty.push({ documentType: 'epic', documentId: e.id, reason: 'legacy-import' }); return;
  }
  const item = normalizeBacklogItem(parsed.frontmatter, parsed.body);
  const deps = item.depends_on.map((dependencyRef) => { const resolvedDependencyItemId = selectedIds.has(dependencyRef) ? dependencyRef : undefined; if (!resolvedDependencyItemId) addDiagnostic(graph, 'orphan-ref', `Item ${item.id} depends on missing item ${dependencyRef}.`, { ref: dependencyRef, path: rel }); return { dependencyRef, dependencyStatus: resolvedDependencyItemId ? 'open' as const : 'missing' as const, resolvedDependencyItemId, sourcePath: rel }; });
  const epicId = item.epic && graph.epics.some((e) => e.epic.id === item.epic) ? item.epic : undefined;
  const rec: LegacyBacklogItemRecord = { item: { id: item.id, title: item.title, body: item.body, userStatus: item.status, priority: item.priority, source: item.source, createdAt: item.created, updatedAt: item.updated, lastCheckedAt: item.last_checked, staleAfter: item.stale_after, epicRef: item.epic, epicId, frontmatter: parsed.frontmatter as never, bodySha256, recordSha256, importOrigin: origin, importPath: rel }, tags: item.tags, sections: sections(item.body), dependencies: deps };
  graph.items.push(rec); graph.searchDirty.push({ documentType: 'backlog_item', documentId: item.id, reason: 'legacy-import' });
}
