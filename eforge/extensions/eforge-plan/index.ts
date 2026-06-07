import {
  Type,
  defineConsoleContribution,
  defineConsoleWorkstation,
  defineEforgeExtension,
  defineExtensionAction,
  defineExtensionDeepLink,
  defineIntegrationCommand,
  type EventHookContext,
} from '../../../packages/extension-sdk/src/index.js';
import { extractMarkdownSections } from './backlog-domain.js';
import { listBoard, renderBoardMarkdown } from './board-actions.js';
import {
  readBacklogEpic,
  readBacklogItem,
  updateBacklogItemFrontmatter,
  writeBacklogEpic,
  writeBacklogItem,
} from './markdown-store.js';
import { applyLifecycleEvent } from './lifecycle.js';
import { fetchEforgePlanInputSource, promoteBacklogItem } from './promote.js';
import { toJsonSafeObject } from './json-safe.js';
import { sessionPlanActions } from './session-plan-actions.js';
// --- eforge:region plan-01-recommendations ---
import { recommendationActions } from './recommendation-actions.js';
// --- eforge:endregion plan-01-recommendations ---
import { ActionObjectOutputSchema, BoardActionInputSchema } from './schema.js';

const BoardInput = BoardActionInputSchema;
const CaptureInput = Type.Object({
  id: Type.Optional(Type.String()), title: Type.String(), claim: Type.String(), evidence: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Array(Type.String())), priority: Type.Optional(Type.String()), epic: Type.Optional(Type.String()),
  dependsOn: Type.Optional(Type.Array(Type.String())), acceptanceCriteria: Type.Optional(Type.String()),
});
const EpicInput = Type.Object({ id: Type.Optional(Type.String()), title: Type.String(), body: Type.Optional(Type.String()), status: Type.Optional(Type.String()), priority: Type.Optional(Type.String()), tags: Type.Optional(Type.Array(Type.String())) });
const UpdateInput = Type.Object({
  id: Type.String(), status: Type.Optional(Type.String()), priority: Type.Optional(Type.String()), tags: Type.Optional(Type.Array(Type.String())),
  evidenceNotes: Type.Optional(Type.String()), recheckNotes: Type.Optional(Type.String()), dependsOn: Type.Optional(Type.Array(Type.String())), epic: Type.Optional(Type.String()),
});
const PromoteInput = Type.Object({ itemId: Type.String(), status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('planned')])), session: Type.Optional(Type.String()), profile: Type.Optional(Type.Union([Type.Literal('errand'), Type.Literal('excursion'), Type.Literal('expedition')])) });
const ActionObjectOutput = ActionObjectOutputSchema;

const captureItem = defineExtensionAction({
  id: 'capture-item', title: 'Capture backlog item', description: 'Create a project-local .backlog item.',
  inputSchema: CaptureInput, outputSchema: ActionObjectOutput, sideEffects: ['local-write'],
  async handler(input, ctx) {
    const id = await resolveNewItemId(ctx.cwd, input.id, input.title);
    const now = new Date().toISOString();
    const body = [`# ${input.title}`, '', '## Claim', '', input.claim, '', '## Evidence', '', input.evidence ?? 'No evidence recorded yet.', '', '## Acceptance Criteria', '', input.acceptanceCriteria ?? 'Missing acceptance criteria: add concrete, verifiable done conditions before build handoff.', ''].join('\n');
    const item = await writeBacklogItem(ctx.cwd, { id, status: 'candidate', priority: input.priority, tags: input.tags ?? [], depends_on: input.dependsOn ?? [], epic: input.epic, created: now, updated: now, body });
    return toJsonSafeObject({ itemId: item.id, status: item.status, path: `.backlog/items/${item.id}.md` });
  },
});

const upsertEpic = defineExtensionAction({
  id: 'upsert-epic', title: 'Upsert backlog epic', description: 'Create or update a project-local .backlog epic without item membership lists.',
  inputSchema: EpicInput, outputSchema: ActionObjectOutput, sideEffects: ['local-write'],
  async handler(input, ctx) {
    const id = input.id ?? slugify(input.title);
    const now = new Date().toISOString();
    const existing = await readBacklogEpic(ctx.cwd, id);
    const body = input.body ?? (existing ? undefined : `# ${input.title}\n\n`);
    const epic = await writeBacklogEpic(ctx.cwd, { id, status: normalizedStatus(input.status, 'candidate'), priority: input.priority, tags: input.tags ?? [], updated: now, body });
    return toJsonSafeObject({ epicId: epic.id, status: epic.status, path: `.backlog/epics/${epic.id}.md` });
  },
});

const updateItem = defineExtensionAction({
  id: 'update-item', title: 'Update backlog item', description: 'Update item metadata while preserving Markdown body content.',
  inputSchema: UpdateInput, outputSchema: ActionObjectOutput, sideEffects: ['local-write'],
  async handler(input, ctx) {
    const updates: Record<string, unknown> = { updated: new Date().toISOString() };
    if (input.status !== undefined) updates.status = normalizedStatus(input.status, 'candidate');
    if (input.priority !== undefined) updates.priority = input.priority;
    if (input.tags !== undefined) updates.tags = input.tags;
    if (input.dependsOn !== undefined) updates.depends_on = input.dependsOn;
    if (input.epic !== undefined) updates.epic = input.epic;
    if (input.evidenceNotes !== undefined) updates.evidence_notes = input.evidenceNotes;
    if (input.recheckNotes !== undefined) updates.recheck_notes = input.recheckNotes;
    const item = await updateBacklogItemFrontmatter(ctx.cwd, input.id, updates);
    return toJsonSafeObject({ itemId: item.id, status: item.status });
  },
});

const promoteItem = defineExtensionAction({
  id: 'promote-item', title: 'Promote backlog item', description: 'Write a session plan and trace evidence for a backlog item.',
  inputSchema: PromoteInput, outputSchema: ActionObjectOutput, sideEffects: ['local-write'],
  async handler(input, ctx) { return toJsonSafeObject(await promoteBacklogItem({ cwd: ctx.cwd, itemId: input.itemId, status: input.status ?? 'active', session: input.session, profile: input.profile ?? null })); },
});

export default defineEforgeExtension((eforge) => {
  if (typeof eforge.registerAction !== 'function') return;
  eforge.registerAction(listBoard);
  eforge.registerAction(captureItem);
  eforge.registerAction(upsertEpic);
  eforge.registerAction(updateItem);
  eforge.registerAction(promoteItem);
  eforge.registerAction(renderBoardMarkdown);
  // --- eforge:region plan-01-recommendations ---
  for (const action of recommendationActions) eforge.registerAction(action);
  // --- eforge:endregion plan-01-recommendations ---
  for (const action of sessionPlanActions) eforge.registerAction(action);
  eforge.registerInputSource({ name: 'eforge-plan', description: 'Compile .backlog items into ordinary eforge build-source Markdown.', fetch: fetchEforgePlanInputSource });
  eforge.registerConsoleContribution(defineConsoleContribution({
    id: 'board', title: 'eforge-plan board', description: 'Declarative System surface for project-local backlog curation.',
    blocks: [
      { rendererId: 'markdown', title: 'Board summary', content: 'Use **Render board** to display the current derived kanban board from `.backlog`.' },
      { rendererId: 'status-badge', title: 'Lifecycle linkage', content: 'Trace sidecars enabled', status: 'active' },
      { rendererId: 'action-button', title: 'List board data', content: 'Return current board JSON.', action: { actionId: 'list-board' } },
      { rendererId: 'action-button', title: 'Render board', content: 'Show current board Markdown', action: { actionId: 'render-board-markdown' } },
      { rendererId: 'action-form', title: 'Promote item', content: 'Promote a backlog item to `.eforge/session-plans/<session>.md`.', action: { actionId: 'promote-item', inputDefaults: { status: 'active' } } },
      { rendererId: 'action-form', title: 'Capture item', content: 'Capture a candidate backlog item.', action: { actionId: 'capture-item' } },
      { rendererId: 'action-form', title: 'Update item', content: 'Update backlog item metadata.', action: { actionId: 'update-item' } },
    ],
  }));
  eforge.registerConsoleWorkstation(defineConsoleWorkstation({
    id: 'planning-workstation',
    title: 'eforge-plan planning workstation',
    description: 'Extension-owned planning workstation for backlog board data, flat session plans, and session plan sets.',
    allowedActions: [
      'list-board',
      'render-board-markdown',
      // --- eforge:region plan-01-recommendations ---
      'get-recommendations',
      'put-recommendations',
      // --- eforge:endregion plan-01-recommendations ---
      'list-planning-artifacts',
      'show-session-plan',
      'show-session-plan-set',
      'create-session-plan',
      'set-session-plan-section',
      'select-session-plan-dimensions',
      'check-session-plan-readiness',
      'set-session-plan-ready',
      'update-session-plan-metadata',
      'handoff-session-plan',
    ],
    frameBundle: { root: 'workstation-assets/plans', entrypoint: 'index.js', styles: ['style.css'], browserSdkVersion: 1 },
  }));
  eforge.registerIntegrationCommand(defineIntegrationCommand({ id: 'render-board', label: 'Render eforge-plan board', inputSchema: BoardInput, action: { actionId: 'render-board-markdown' } }));
  eforge.registerIntegrationCommand(defineIntegrationCommand({ id: 'promote-item', label: 'Promote eforge-plan item', inputSchema: PromoteInput, action: { actionId: 'promote-item' } }));
  eforge.registerDeepLink(defineExtensionDeepLink({ id: 'board', label: 'Open eforge-plan board', action: { actionId: 'render-board-markdown' } }));
  eforge.registerDeepLink(defineExtensionDeepLink({ id: 'promote', label: 'Promote eforge-plan item', action: { actionId: 'promote-item' } }));
  for (const pattern of ['enqueue:start', 'enqueue:complete', 'queue:prd:start', 'queue:prd:complete', 'session:start', 'session:end', 'landing:complete', 'landing:auto-merge:complete'] as const) {
    eforge.onEvent(pattern, async (event, ctx) => { await applyLifecycleEvent(await resolveHookCwd(ctx), event); });
  }
});

function normalizedStatus(value: string | undefined, fallback: 'candidate') {
  if (value === undefined) return fallback;
  if (['candidate', 'planned', 'active', 'shipped', 'stale', 'superseded'].includes(value)) return value as 'candidate' | 'planned' | 'active' | 'shipped' | 'stale' | 'superseded';
  throw new Error(`Invalid backlog status "${value}". Expected candidate, planned, active, shipped, stale, or superseded.`);
}

async function resolveNewItemId(cwd: string, explicitId: string | undefined, title: string): Promise<string> {
  if (explicitId !== undefined) {
    if (await readBacklogItem(cwd, explicitId)) throw new Error(`Backlog item "${explicitId}" already exists.`);
    return explicitId;
  }
  const base = slugify(title);
  for (let index = 0; ; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`;
    if (!(await readBacklogItem(cwd, candidate))) return candidate;
  }
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'backlog-item';
}

async function resolveHookCwd(ctx: EventHookContext): Promise<string> {
  const result = await ctx.exec.run(process.execPath, ['-e', 'process.stdout.write(process.cwd())']);
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || 'Failed to resolve lifecycle hook cwd.');
  return result.stdout.trim();
}

export async function loadItemSectionsForDisplay(cwd: string, itemId: string): Promise<Record<string, string>> {
  const item = await readBacklogItem(cwd, itemId);
  return item ? Object.fromEntries(extractMarkdownSections(item.body)) : {};
}

