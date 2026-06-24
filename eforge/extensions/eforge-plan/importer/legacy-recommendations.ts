import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { summarizeRecommendations } from '../recommendations-store.js';
import type { Collector } from './types.js';
import { addDiagnostic } from './diagnostics.js';
import { asString, canonicalJson, projectRelative, sha256, stableId } from './stable.js';

export const collectLegacyRecommendations: Collector = (cwd, graph) => {
  if (!graph.include.includes('recommendations')) return;
  const path = join(cwd, '.eforge/storage/extensions/eforge-plan/recommendations/current.json'); if (!existsSync(path)) return;
  const rel = projectRelative(cwd, path); let model: Record<string, unknown>;
  try { model = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; } catch (e) { addDiagnostic(graph, 'unsupported-legacy-payload', 'Could not parse recommendation current.json.', { path: rel, severity: 'error', details: { error: String(e) } }); return; }
  const rawHash = sha256(canonicalJson(model)); const runId = `legacy-recommendations:${rawHash}`;
  graph.recommendationRun = { runId, sourceFingerprint: rawHash, createdAt: asString(model.generatedAt) ?? asString(model.createdAt), appliedAt: asString(model.appliedAt), lastRefreshedBy: asString(model.lastRefreshedBy), isCurrent: true, rawModel: model as never, summary: safeSummary(model), freshness: readStatus(cwd) as never, importOrigin: 'legacy-recommendations', importPath: rel };
  laneOne(graph, runId, 'activeWork', model.activeWork); laneOne(graph, runId, 'readyCandidates', model.readyCandidates); laneOne(graph, runId, 'recommendedNextSequence', model.recommendedNextSequence);
  for (const [i, group] of array(model.safeParallelizableGroups).entries()) { const o = object(group); addLane(graph, runId, 'safeParallelizableGroup', asString(o.id) ?? `group-${i}`, array(o.itemIds).map(String), 'member', i, o); for (const epic of array(o.epicIds)) stale(graph, String(epic), 'Unknown recommendation epic ref', rel); }
  for (const [i, chain] of array(model.blockedChains).entries()) { const o = object(chain); const laneId = stableId('recommendation-lane', { runId, kind: 'blockedChain', i }); const items = [...array(o.itemIds).map((ref, sequence) => item(graph, String(ref), 'blocked', sequence, rel)), ...array(o.blockedBy).map((ref, sequence) => item(graph, String(ref), 'blocker', sequence, rel))]; graph.recommendationLanes.push({ lane: { laneId, runId, laneKind: 'blockedChain', laneRef: asString(o.id) ?? `chain-${i}`, title: asString(o.title), sequence: i, rationale: asString(o.rationale) }, items }); }
  for (const lane of graph.recommendationLanes.filter((entry) => entry.lane.runId === runId)) graph.searchDirty.push({ documentType: 'recommendation', documentId: lane.lane.laneId, reason: 'legacy-import' });
};
function laneOne(graph: Parameters<Collector>[1], runId: string, kind: 'activeWork' | 'readyCandidates' | 'recommendedNextSequence', value: unknown) { for (const [i, entry] of array(value).entries()) { const o = object(entry); const ref = asString(o.itemId) ?? asString(o.id) ?? String(entry); addLane(graph, runId, kind, ref, [ref], 'member', i, o); } }
function addLane(graph: Parameters<Collector>[1], runId: string, kind: 'activeWork' | 'readyCandidates' | 'recommendedNextSequence' | 'safeParallelizableGroup', laneRef: string, refs: string[], role: 'member', sequence: number, raw: Record<string, unknown>) { graph.recommendationLanes.push({ lane: { laneId: stableId('recommendation-lane', { runId, kind, laneRef }), runId, laneKind: kind, laneRef, title: asString(raw.title), sequence, profile: asString(raw.profile), rationale: asString(raw.rationale) }, items: refs.map((ref, i) => item(graph, ref, role, i, 'recommendations/current.json')) }); }
function item(graph: Parameters<Collector>[1], ref: string, role: 'member' | 'blocked' | 'blocker', sequence: number, path: string) { const known = graph.items.find((i) => i.item.id === ref); if (!known) stale(graph, ref, 'Unknown recommendation item ref', path); else if (['shipped', 'stale', 'superseded'].includes(known.item.userStatus)) stale(graph, ref, 'Closed recommendation item ref', path); return { itemRef: ref, role, itemId: known?.item.id, sequence }; }
function stale(graph: Parameters<Collector>[1], ref: string, message: string, path: string) { addDiagnostic(graph, 'stale-recommendation-ref', `${message}: ${ref}.`, { ref, path }); }
function array(v: unknown): unknown[] { return Array.isArray(v) ? v : []; } function object(v: unknown): Record<string, unknown> { return v && typeof v === 'object' ? v as Record<string, unknown> : {}; }
function safeSummary(model: Record<string, unknown>) { try { return summarizeRecommendations(model as never) as never; } catch { return { lanes: Object.keys(model) }; } }
function readStatus(cwd: string) { const p = join(cwd, '.eforge/storage/extensions/eforge-plan/recommendations/status.json'); if (!existsSync(p)) return undefined; try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return { unreadable: true }; } }
