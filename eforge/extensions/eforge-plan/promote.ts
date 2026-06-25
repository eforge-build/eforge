import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { resolveProjectLocalStoragePath, type InputTransformContext } from '@eforge-build/extension-sdk';
import { normalizeBuildSource } from '@eforge-build/input';
import {
  blockerRiskProjection,
  dependencyProjection,
  extractMarkdownSections,
  orderedSourceReferenceSummaries,
  type BacklogEpic,
  type BacklogItem,
  type BacklogStatus,
} from './backlog-domain.js';
import { readBacklogEpic, readBacklogItem, updateBacklogItemFrontmatter } from './markdown-store.js';
import { backlogItemRowToDomain, epicRowToDomain, readCanonicalBacklogItem, readCanonicalEpic } from './canonical/backlog-records.js';
import { assertRecommendationSelectionActionable, type AgentTaskReader } from './recommendation-actionability.js';
import { syncSessionPlanArtifact } from './canonical/session-plan-records.js';
import { resolvePromotionSelection, type PromotionSelection } from './promotion-selection.js';
import { createTraceSidecar, readTraceSidecar, writeTraceSidecar } from './trace-store.js';

export interface SynthesisInput {
  item: BacklogItem;
  epic?: BacklogEpic | null;
  cwd: string;
  session?: string;
  promotedAt?: string;
  profile?: 'errand' | 'excursion' | 'expedition' | null;
}

export interface SelectionSynthesisInput {
  items: BacklogItem[];
  epics?: BacklogEpic[];
  epicIds?: string[];
  cwd: string;
  title?: string;
  session?: string;
  profile?: 'errand' | 'excursion' | 'expedition' | null;
  recommendationRef?: string;
  recommendation?: PromotionSelection['recommendationGroup'] | PromotionSelection['recommendationItem'];
  recommendationAssumptions?: string[];
}

export interface PromotionResult {
  itemId: string;
  session: string;
  sessionPlanPath: string;
  buildSource: string;
  status: BacklogStatus;
}

export interface PromotionSelectionResult {
  itemIds: string[];
  epicIds: string[];
  session: string;
  sessionPlanPath: string;
  buildSource: string;
  status: Extract<BacklogStatus, 'active' | 'planned'>;
  profile: 'errand' | 'excursion' | 'expedition' | null;
  recommendationRef?: string;
  sources: PromotionSelection['sources'];
  epics: PromotionSelection['epicSources'];
}

const REQUIRED_DIMENSIONS = ['scope', 'acceptance-criteria', 'assumptions-and-validation'];
const OPTIONAL_DIMENSIONS = ['context', 'design-decisions', 'dependency-context'];

export function generateSessionId(item: BacklogItem, now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  return `${date}-${slugify(item.id || item.title)}`;
}

export function generateSelectionSessionId(items: readonly BacklogItem[], now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  const seed = items.length === 1 ? items[0]!.id || items[0]!.title : `${items[0]?.id ?? 'selection'}-and-${items.length - 1}-more`;
  return `${date}-${slugify(seed)}`;
}

export function synthesizeSessionPlanMarkdown(input: SynthesisInput): string {
  const session = input.session ?? generateSessionId(input.item);
  return synthesizeSelectionSessionPlanMarkdown({
    cwd: input.cwd,
    items: [input.item],
    epics: input.epic ? [input.epic] : [],
    title: input.item.title,
    session,
    profile: input.profile,
  });
}

export function synthesizeSelectionSessionPlanMarkdown(input: SelectionSynthesisInput): string {
  if (input.items.length === 0) throw new Error('Cannot synthesize a promotion session plan without selected backlog items.');
  const session = input.session ?? generateSelectionSessionId(input.items);
  const itemIds = input.items.map((item) => item.id);
  const epicIds = [...new Set(input.epicIds ?? (input.epics ?? []).map((epic) => epic.id))];
  const frontmatter = {
    session,
    topic: input.title ?? (input.items.length === 1 ? input.items[0]!.title : `Promote ${input.items.length} backlog items`),
    status: 'ready',
    planning_type: 'feature',
    planning_depth: 'focused',
    required_dimensions: REQUIRED_DIMENSIONS,
    optional_dimensions: OPTIONAL_DIMENSIONS,
    skipped_dimensions: [],
    open_questions: [],
    profile: input.profile ?? null,
    eforge_plan: {
      source_item_ids: itemIds,
      source_epic_ids: epicIds,
      ...(input.recommendationRef !== undefined && { source_recommendation_ref: input.recommendationRef }),
      ...(itemIds.length === 1 && { source_item_id: itemIds[0] }),
      ...(epicIds.length === 1 && { source_epic_id: epicIds[0] }),
    },
  };
  return `---\n${stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd()}\n---\n${synthesizeSelectionPlanBody(input)}`;
}

export function synthesizeBuildSourceMarkdown(input: SynthesisInput): string {
  const sessionPlan = synthesizeSessionPlanMarkdown(input);
  const session = input.session ?? generateSessionId(input.item);
  const sourcePath = resolveSessionPlanPath(input.cwd, session);
  return normalizeBuildSource({ sourcePath, content: sessionPlan }).content;
}

export async function promoteBacklogItem(input: {
  cwd: string;
  itemId: string;
  status?: Extract<BacklogStatus, 'active' | 'planned'>;
  session?: string;
  profile?: 'errand' | 'excursion' | 'expedition' | null;
  agentTasks?: AgentTaskReader;
}): Promise<PromotionResult> {
  const selection = await promoteBacklogSelection({ cwd: input.cwd, itemIds: [input.itemId], status: input.status, session: input.session, profile: input.profile, agentTasks: input.agentTasks });
  return {
    itemId: selection.itemIds[0]!,
    session: selection.session,
    sessionPlanPath: selection.sessionPlanPath,
    buildSource: selection.buildSource,
    status: selection.status,
  };
}

export async function promoteBacklogSelection(input: {
  cwd: string;
  itemIds?: string[];
  epicId?: string;
  recommendationRef?: string;
  status?: Extract<BacklogStatus, 'active' | 'planned'>;
  session?: string;
  profile?: 'errand' | 'excursion' | 'expedition' | null;
  title?: string;
  agentTasks?: AgentTaskReader;
}): Promise<PromotionSelectionResult> {
  const selection = await resolvePromotionSelection(input);
  if (input.itemIds !== undefined) await assertRecommendationSelectionActionable(input.cwd, selection.itemIds, input.agentTasks);
  const root = resolveSessionPlanRoot(input.cwd);
  await mkdir(root, { recursive: true });
  const { session, sessionPlanPath } = resolveSelectionPromotionTarget(input.cwd, selection.items, selection.session);
  const sessionPlan = synthesizeSelectionSessionPlanMarkdown({
    cwd: input.cwd,
    items: selection.items,
    epics: selection.epics,
    epicIds: selection.epicIds,
    title: selection.title,
    session,
    profile: selection.profile,
    recommendationRef: selection.recommendationRef,
    recommendation: selection.recommendationGroup ?? selection.recommendationItem,
    recommendationAssumptions: selection.recommendationModel?.rationaleAndAssumptions,
  });
  await writeFile(sessionPlanPath, sessionPlan, { encoding: 'utf-8', flag: 'wx' });
  const updated = new Date().toISOString();
  syncSessionPlanArtifact(input.cwd, { session, path: sessionPlanPath, content: sessionPlan, status: 'ready', profile: selection.profile, sourceItemIds: selection.itemIds, sourceEpicIds: selection.epicIds, sourceRecommendationRef: selection.recommendationRef, provenance: 'promotion', updatedAt: updated });
  await Promise.all(selection.itemIds.map(async (itemId) => {
    await updateBacklogItemFrontmatter(input.cwd, itemId, { status: selection.status });
    const item = selection.items.find((candidate) => candidate.id === itemId);
    const trace = await readTraceSidecar(input.cwd, itemId) ?? createTraceSidecar(itemId, item?.epic);
    trace.promotedSessionPlans = [...trace.promotedSessionPlans.filter((entry) => entry.session !== session), { session, path: sessionPlanPath, status: 'ready', promotedAt: updated }];
    await writeTraceSidecar(input.cwd, trace);
  }));
  return {
    itemIds: selection.itemIds,
    epicIds: selection.epicIds,
    session,
    sessionPlanPath,
    buildSource: normalizeBuildSource({ sourcePath: sessionPlanPath, content: sessionPlan }).content,
    status: selection.status,
    profile: selection.profile,
    ...(selection.recommendationRef !== undefined && { recommendationRef: selection.recommendationRef }),
    sources: selection.sources,
    epics: selection.epicSources,
  };
}

export async function fetchEforgePlanInputSource(id: string, ctx?: InputTransformContext): Promise<string | null> {
  if (!ctx?.cwd) {
    return [
      '# eforge-plan input source requires runtime context',
      '',
      '`eforge://input/eforge-plan/<itemId>` must be resolved by eforge input preprocessing so the adapter receives `ctx.cwd`.',
      'This adapter intentionally does not read from `process.cwd()`.',
    ].join('\n');
  }
  const canonicalItem = readCanonicalBacklogItem(ctx.cwd, id);
  const item = canonicalItem !== undefined ? backlogItemRowToDomain(canonicalItem) : await readBacklogItem(ctx.cwd, id);
  if (!item) return null;
  const canonicalEpic = item.epic ? readCanonicalEpic(ctx.cwd, item.epic) : undefined;
  const epic = canonicalEpic !== undefined ? epicRowToDomain(canonicalEpic) : item.epic ? await readBacklogEpic(ctx.cwd, item.epic) : null;
  return synthesizeBuildSourceMarkdown({ cwd: ctx.cwd, item, epic, session: `direct-${slugify(item.id)}` });
}

export function readinessGuidance(item: BacklogItem): { assumptions: string; acceptanceCriteria: string } {
  const sections = extractMarkdownSections(item.body);
  const assumptions = firstSection(sections, ['Assumptions', 'Assumptions and Validation']);
  const acceptance = firstSection(sections, ['Acceptance Criteria']);
  return {
    assumptions: assumptions || 'Missing assumptions: state key assumptions and validation risks before implementation.',
    acceptanceCriteria: acceptance || 'Missing acceptance criteria: add concrete, verifiable done conditions before build handoff.',
  };
}

// Promoted session plans are built-in eforge workflow artifacts consumed by the engine,
// not private extension-owned metadata, so they intentionally remain under `.eforge/session-plans/`.
function resolveSessionPlanRoot(cwd: string): string {
  return resolveProjectLocalStoragePath({ cwd, segments: ['session-plans'] });
}

function resolveSessionPlanPath(cwd: string, session: string): string {
  return resolveProjectLocalStoragePath({ cwd, segments: ['session-plans', `${session}.md`] });
}

function resolveSelectionPromotionTarget(cwd: string, items: readonly BacklogItem[], explicitSession?: string): { session: string; sessionPlanPath: string } {
  const baseSession = explicitSession ?? generateSelectionSessionId(items);
  for (let index = 0; index < 100; index += 1) {
    const session = index === 0 ? baseSession : `${baseSession}-${index + 1}`;
    const sessionPlanPath = resolveSessionPlanPath(cwd, session);
    if (!existsSync(sessionPlanPath)) return { session, sessionPlanPath };
    if (explicitSession) throw new Error(`Session plan already exists for explicit session "${explicitSession}": ${sessionPlanPath}`);
  }
  throw new Error(`Could not allocate a unique session plan path for ${baseSession}`);
}

function synthesizeSelectionPlanBody(input: SelectionSynthesisInput): string {
  const title = input.title ?? (input.items.length === 1 ? input.items[0]!.title : `Promote ${input.items.length} backlog items`);
  return [
    `# ${title}`,
    '',
    '## Context',
    '',
    input.items.map(extractClaim).join('\n\n'),
    '',
    '## Scope',
    '',
    input.items.map((item) => `### ${item.id}: ${item.title}\n\n${item.body.trim()}`).join('\n\n'),
    '',
    '## Assumptions',
    '',
    assumptionsGuidance(input),
    '',
    '## Design Decisions',
    '',
    designDecisionGuidance(input.items),
    '',
    '## Acceptance Criteria',
    '',
    acceptanceCriteriaGuidance(input.items),
    '',
    '## Source Backlog Evidence',
    '',
    input.items.map(sourceEvidence).join('\n\n'),
    '',
    '## Source Epic Evidence',
    '',
    sourceEpicEvidence(input.epics ?? []),
    '',
    '## Dependency Context',
    '',
    dependencyContext(input.items),
    '',
    '## Recommendation Context',
    '',
    recommendationContext(input),
    '',
  ].join('\n');
}

function assumptionsGuidance(input: SelectionSynthesisInput): string {
  const itemGuidance = input.items.map((item) => `### ${item.id}\n\n${readinessGuidance(item).assumptions}`).join('\n\n');
  const recommendationGuidance = (input.recommendationAssumptions ?? []).length > 0
    ? `\n\nRecommendation assumptions:\n${input.recommendationAssumptions!.map((entry) => `- ${entry}`).join('\n')}`
    : '';
  return `${itemGuidance}${recommendationGuidance}`;
}

function designDecisionGuidance(items: readonly BacklogItem[]): string {
  return items.map((item) => {
    const decision = firstSection(extractMarkdownSections(item.body), ['Design Decisions']) || 'Use the backlog evidence as the source of truth; keep implementation scoped to this item.';
    return `### ${item.id}\n\n${decision}`;
  }).join('\n\n');
}

function acceptanceCriteriaGuidance(items: readonly BacklogItem[]): string {
  return items.map((item) => `### ${item.id}\n\n${readinessGuidance(item).acceptanceCriteria}`).join('\n\n');
}

function sourceEpicEvidence(epics: readonly BacklogEpic[]): string {
  if (epics.length === 0) return 'No source epic linked.';
  return epics.map((epic) => `### ${epic.id}: ${epic.title}\n\nEpic ${epic.id}: ${epic.title}\n\n${epic.body.trim()}`).join('\n\n');
}

function dependencyContext(items: readonly BacklogItem[]): string {
  const projections = dependencyProjection(items);
  const risks = new Map(blockerRiskProjection(items).map((entry) => [entry.itemId, entry]));
  return projections.map((entry) => {
    const risk = risks.get(entry.itemId);
    return [
      `### ${entry.itemId}`,
      '',
      `Depends on: ${entry.dependsOn.length > 0 ? entry.dependsOn.join(', ') : 'No dependencies declared.'}`,
      `Internal dependencies: ${entry.internalDependsOn.length > 0 ? entry.internalDependsOn.join(', ') : 'None.'}`,
      `External dependencies: ${entry.externalDependsOn.length > 0 ? entry.externalDependsOn.join(', ') : 'None.'}`,
      `Blockers: ${risk && risk.blockers.length > 0 ? risk.blockers.join('; ') : 'None declared.'}`,
      `Risks: ${risk && risk.risks.length > 0 ? risk.risks.join('; ') : 'None declared.'}`,
    ].join('\n');
  }).join('\n\n');
}

function recommendationContext(input: SelectionSynthesisInput): string {
  const refs = orderedSourceReferenceSummaries(input.items, input.epics ?? []);
  const lines = [`Selected source order:\n${refs.map((entry) => `- ${entry}`).join('\n')}`];
  if (input.recommendationRef !== undefined) lines.push(`Recommendation ref: ${input.recommendationRef}`);
  if (input.recommendation && 'rationale' in input.recommendation && input.recommendation.rationale) lines.push(`Recommendation rationale: ${input.recommendation.rationale}`);
  if (input.recommendation && 'confidence' in input.recommendation && input.recommendation.confidence) lines.push(`Recommendation confidence: ${input.recommendation.confidence}`);
  return lines.join('\n\n');
}

function sourceEvidence(item: BacklogItem): string {
  const evidence = firstSection(extractMarkdownSections(item.body), ['Evidence', 'Source Evidence']);
  return [`### ${item.id}: ${item.title}`, `Backlog item id: ${item.id}`, `Status at handoff: ${item.status}`, evidence || 'No explicit evidence section found in the backlog item.'].join('\n\n');
}

function extractClaim(item: BacklogItem): string {
  const sections = extractMarkdownSections(item.body);
  return firstSection(sections, ['Claim', 'Problem', 'Context']) || `Implement backlog item ${item.id}: ${item.title}.`;
}

function firstSection(sections: Map<string, string>, names: string[]): string {
  for (const name of names) {
    const value = sections.get(name);
    if (value && value.trim().length > 0) return value.trim();
  }
  return '';
}

function slugify(value: string): string {
  const slug = basename(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'backlog-item';
}
