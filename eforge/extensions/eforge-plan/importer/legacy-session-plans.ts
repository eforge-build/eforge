import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { getReadinessDetail, parseSessionPlan } from '@eforge-build/input';
import { parseMarkdownRecord } from '../markdown-store.js';
import type { Collector } from './types.js';
import { addDiagnostic } from './diagnostics.js';
import { asString, asStringArray, compactText, projectRelative, sha256 } from './stable.js';

export const collectLegacySessionPlans: Collector = (cwd, graph) => {
  if (!graph.include.includes('sessionPlans')) return;
  const root = join(cwd, '.eforge/session-plans');
  if (!existsSync(root)) return;
  for (const name of readdirSync(root).filter((n) => n.endsWith('.md')).sort()) {
    const path = join(root, name); const rel = projectRelative(cwd, path);
    try {
      const raw = readFileSync(path, 'utf8'); const parsed = parseMarkdownRecord(raw); const plan = parseSessionPlan(raw); const ep = (parsed.frontmatter.eforge_plan ?? {}) as Record<string, unknown>;
      const session = asString(parsed.frontmatter.session) ?? basename(name, '.md');
      const itemRefs = [...asStringArray(ep.source_item_ids), ...asStringArray(ep.source_item_id)];
      const epicRefs = [...asStringArray(ep.source_epic_ids), ...asStringArray(ep.source_epic_id)];
      const sourceRecommendationRef = asString(ep.source_recommendation_ref); const promotedAt = asString(ep.promoted_at);
      const provenance = sourceRecommendationRef ? 'recommendation-lane-plan' : 'selected-promote';
      graph.sessionPlans.push({
        plan: { session, path: rel, topic: asString(parsed.frontmatter.topic) ?? asString((plan as unknown as { topic?: unknown }).topic), status: asString(parsed.frontmatter.status), planningType: asString(parsed.frontmatter.planning_type) ?? asString(parsed.frontmatter.type), planningDepth: asString(parsed.frontmatter.planning_depth) ?? asString(parsed.frontmatter.depth), profile: asString(parsed.frontmatter.profile), agentProfile: asString(parsed.frontmatter.agent_profile), eforgeSessionId: asString(parsed.frontmatter.eforge_session) ?? asString(parsed.frontmatter.eforge_session_id), submittedAt: asString(parsed.frontmatter.submitted_at), createdAt: asString(parsed.frontmatter.created), updatedAt: asString(parsed.frontmatter.updated), summaryText: summary(parsed.body), artifactBodyHash: sha256(parsed.body), frontmatter: parsed.frontmatter as never, readinessSummary: getReadinessDetail(plan) as never, importOrigin: 'session-plan-markdown', importPath: rel },
        itemLinks: itemRefs.map((itemRef, sequence) => ({ itemRef, itemId: graph.items.some((i) => i.item.id === itemRef) ? itemRef : undefined, role: 'source', provenance, sourceRecommendationRef, promotedAt, sequence })),
        epicLinks: epicRefs.map((epicRef, sequence) => ({ epicRef, epicId: graph.epics.some((e) => e.epic.id === epicRef) ? epicRef : undefined, role: 'source', provenance, sourceRecommendationRef, promotedAt, sequence })),
      });
      graph.searchDirty.push({ documentType: 'session_plan', documentId: session, reason: 'legacy-import' });
    } catch (error) { addDiagnostic(graph, 'unsupported-legacy-payload', `Could not parse session plan ${name}: ${error instanceof Error ? error.message : String(error)}`, { path: rel, severity: 'error' }); }
  }
};

function summary(body: string): string | undefined {
  for (const heading of ['Executive Summary', 'Context']) { const m = new RegExp(`## ${heading}\\s+([\\s\\S]*?)(?:\\n## |$)`).exec(body); const s = compactText(m?.[1]); if (s) return s; }
  return compactText(body.split(/\n\s*\n/).find((p) => p.trim() && !p.trim().startsWith('#')));
}
