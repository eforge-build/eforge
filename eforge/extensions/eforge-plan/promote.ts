import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, relative } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { resolveProjectLocalStoragePath, type InputTransformContext } from '../../../packages/extension-sdk/src/index.js';
import { normalizeBuildSource } from '../../../packages/input/src/index.js';
import { extractMarkdownSections, type BacklogEpic, type BacklogItem, type BacklogStatus } from './backlog-domain.js';
import { readBacklogEpic, readBacklogItem, updateBacklogItemFrontmatter } from './markdown-store.js';
import { upsertPromotedSessionPlan } from './trace-store.js';

export interface SynthesisInput {
  item: BacklogItem;
  epic?: BacklogEpic | null;
  cwd: string;
  session?: string;
  promotedAt?: string;
  profile?: 'errand' | 'excursion' | 'expedition' | null;
}

export interface PromotionResult {
  itemId: string;
  session: string;
  sessionPlanPath: string;
  buildSource: string;
  status: BacklogStatus;
}

const REQUIRED_DIMENSIONS = ['scope', 'acceptance-criteria', 'assumptions-and-validation'];
const OPTIONAL_DIMENSIONS = ['context', 'design-decisions', 'dependency-context'];

export function generateSessionId(item: BacklogItem, now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  return `${date}-${slugify(item.id || item.title)}`;
}

export function synthesizeSessionPlanMarkdown(input: SynthesisInput): string {
  const session = input.session ?? generateSessionId(input.item);
  const frontmatter = {
    session,
    topic: input.item.title,
    status: 'ready',
    planning_type: 'feature',
    planning_depth: 'focused',
    required_dimensions: REQUIRED_DIMENSIONS,
    optional_dimensions: OPTIONAL_DIMENSIONS,
    skipped_dimensions: [],
    open_questions: [],
    profile: input.profile ?? null,
    eforge_plan: {
      source_item_id: input.item.id,
      source_epic_id: input.item.epic ?? input.epic?.id,
    },
  };
  return `---\n${stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd()}\n---\n${synthesizePlanBody(input.item, input.epic)}`;
}

export function synthesizeBuildSourceMarkdown(input: SynthesisInput): string {
  const sessionPlan = synthesizeSessionPlanMarkdown(input);
  const session = input.session ?? generateSessionId(input.item);
  const sourcePath = resolveProjectLocalStoragePath({ cwd: input.cwd, segments: ['session-plans', `${session}.md`] });
  return normalizeBuildSource({ sourcePath, content: sessionPlan }).content;
}

export async function promoteBacklogItem(input: {
  cwd: string;
  itemId: string;
  status?: Extract<BacklogStatus, 'active' | 'planned'>;
  session?: string;
  profile?: 'errand' | 'excursion' | 'expedition' | null;
}): Promise<PromotionResult> {
  const item = await requireBacklogItem(input.cwd, input.itemId);
  const epic = item.epic ? await readBacklogEpic(input.cwd, item.epic) : null;
  const root = resolveProjectLocalStoragePath({ cwd: input.cwd, segments: ['session-plans'] });
  await mkdir(root, { recursive: true });
  const { session, sessionPlanPath } = resolvePromotionTarget(input.cwd, item, input.session);
  const sessionPlan = synthesizeSessionPlanMarkdown({ cwd: input.cwd, item, epic, session, profile: input.profile });
  await writeFile(sessionPlanPath, sessionPlan, { encoding: 'utf-8', flag: 'wx' });
  const status = input.status ?? 'active';
  const updated = new Date().toISOString();
  await updateBacklogItemFrontmatter(input.cwd, item.id, {
    status,
    updated,
    eforge_plan: {
      ...(item.eforge_plan ?? {}),
      promoted_session: session,
      promoted_session_path: relative(input.cwd, sessionPlanPath),
      promoted_at: updated,
    },
  });
  await upsertPromotedSessionPlan(input.cwd, item.id, {
    session,
    path: sessionPlanPath,
    status: 'ready',
    promotedAt: updated,
  }, item.epic);
  return {
    itemId: item.id,
    session,
    sessionPlanPath,
    buildSource: normalizeBuildSource({ sourcePath: sessionPlanPath, content: sessionPlan }).content,
    status,
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
  const item = await readBacklogItem(ctx.cwd, id);
  if (!item) return null;
  const epic = item.epic ? await readBacklogEpic(ctx.cwd, item.epic) : null;
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

async function requireBacklogItem(cwd: string, itemId: string): Promise<BacklogItem> {
  const item = await readBacklogItem(cwd, itemId);
  if (!item) throw new Error(`Backlog item not found: ${itemId}`);
  return item;
}

function resolvePromotionTarget(cwd: string, item: BacklogItem, explicitSession?: string): { session: string; sessionPlanPath: string } {
  const baseSession = explicitSession ?? generateSessionId(item);
  for (let index = 0; index < 100; index += 1) {
    const session = index === 0 ? baseSession : `${baseSession}-${index + 1}`;
    const sessionPlanPath = resolveProjectLocalStoragePath({ cwd, segments: ['session-plans', `${session}.md`] });
    if (!existsSync(sessionPlanPath)) return { session, sessionPlanPath };
    if (explicitSession) throw new Error(`Session plan already exists for explicit session "${explicitSession}": ${sessionPlanPath}`);
  }
  throw new Error(`Could not allocate a unique session plan path for ${baseSession}`);
}

function synthesizePlanBody(item: BacklogItem, epic?: BacklogEpic | null): string {
  const guidance = readinessGuidance(item);
  const dependencies = item.depends_on.length > 0 ? item.depends_on.map((id) => `- ${id}`).join('\n') : 'No dependencies declared.';
  return [
    `# ${item.title}`,
    '',
    '## Context',
    '',
    extractClaim(item),
    '',
    '## Scope',
    '',
    item.body.trim(),
    '',
    '## Assumptions',
    '',
    guidance.assumptions,
    '',
    '## Design Decisions',
    '',
    firstSection(extractMarkdownSections(item.body), ['Design Decisions']) || 'Use the backlog evidence as the source of truth; keep implementation scoped to this item.',
    '',
    '## Acceptance Criteria',
    '',
    guidance.acceptanceCriteria,
    '',
    '## Source Backlog Evidence',
    '',
    sourceEvidence(item),
    '',
    '## Source Epic Evidence',
    '',
    epic ? `Epic ${epic.id}: ${epic.title}\n\n${epic.body.trim()}` : 'No source epic linked.',
    '',
    '## Dependency Context',
    '',
    dependencies,
    '',
  ].join('\n');
}

function sourceEvidence(item: BacklogItem): string {
  const evidence = firstSection(extractMarkdownSections(item.body), ['Evidence', 'Source Evidence']);
  return [`Backlog item id: ${item.id}`, `Status at handoff: ${item.status}`, evidence || 'No explicit evidence section found in the backlog item.'].join('\n\n');
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
