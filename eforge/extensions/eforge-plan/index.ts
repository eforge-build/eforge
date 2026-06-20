import {
  Type,
  defineConsoleContribution,
  defineConsoleWorkstation,
  defineEforgeExtension,
  defineExtensionAction,
  defineExtensionDeepLink,
  defineIntegrationCommand,
  type EventHookContext,
  type ExtensionAction,
  type TObject,
  type TSchema,
} from '@eforge-build/extension-sdk';
import { extractMarkdownSections } from './backlog-domain.js';
import { listBoard, renderBoardMarkdown } from './board-actions.js';
import { backlogQueryActions } from './backlog-query-actions.js';
import {
  importLegacyBacklog,
  readBacklogEpic,
  readBacklogItem,
  resolveBacklogEpicRelativePath,
  resolveBacklogItemRelativePath,
  updateBacklogItemFrontmatter,
  writeBacklogEpic,
  writeBacklogItem,
} from './markdown-store.js';
import { applyLifecycleEvent } from './lifecycle.js';
import { fetchEforgePlanInputSource, promoteBacklogItem, promoteBacklogSelection } from './promote.js';
import { toJsonSafeObject } from './json-safe.js';
import { sessionPlanActions } from './session-plan-actions.js';
import { recommendationActions } from './recommendation-actions.js';
import { markRecommendationsStaleForBacklogMutation } from './recommendation-status.js';
import { plannerActions } from './planner-actions.js';
import { backlogCurationActions } from './backlog-curation-actions.js';
import { planRevisionActions } from './plan-revision-actions.js';
import { draftPlanUnitActions } from './draft-plan-unit-actions.js';
import { roadmapActions } from './roadmap-actions.js';
import { ActionObjectOutputSchema, BoardActionInputSchema, PromotionSelectionInputSchema, PromotionSelectionOutputSchema } from './schema.js';

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
const PromoteSelectionInput = PromotionSelectionInputSchema;
const PromoteSelectionOutput = PromotionSelectionOutputSchema;
const ActionObjectOutput = ActionObjectOutputSchema;
const BacklogIdInput = Type.String({ minLength: 1, pattern: '^(?!\\.\\.?$)[^/\\\\\\0]+$' });
const ImportLegacyInput = Type.Object({
  kind: Type.Optional(Type.Union([Type.Literal('items'), Type.Literal('epics'), Type.Literal('all')])),
  ids: Type.Optional(Type.Array(BacklogIdInput, { uniqueItems: true })),
}, {
  additionalProperties: false,
  anyOf: [
    { not: { required: ['ids'] } },
    { required: ['ids', 'kind'], properties: { kind: { enum: ['items', 'epics'] } } },
  ],
});
const ImportLegacyKindOutput = Type.Object({
  copied: Type.Array(Type.Object({ id: Type.String(), path: Type.String() }, { additionalProperties: false })),
  skipped: Type.Array(Type.Object({ id: Type.String(), reason: Type.Literal('private-exists') }, { additionalProperties: false })),
}, { additionalProperties: false });
const ImportLegacyOutput = Type.Object({
  schemaVersion: Type.Literal(1),
  items: ImportLegacyKindOutput,
  epics: ImportLegacyKindOutput,
}, { additionalProperties: false });
const PLANNING_WORKSTATION_EFFECTIVE_ID = 'eforge-plan:planning-workstation';
const PLANNING_WORKSTATION_ROUTE = '/console/workstations/eforge-plan%3Aplanning-workstation';
const PLANNING_ENTRY_ACTION_EFFECTIVE_ID = 'eforge-plan:open-planning-entry';
const PLANNING_ENTRY_COMMAND_EFFECTIVE_ID = 'eforge-plan:open-planning-entry';
const PLANNING_ENTRY_DEEP_LINK_EFFECTIVE_ID = 'eforge-plan:planning-workstation';

const PlanningEntryOutput = Type.Object({
  kind: Type.Literal('planning-entry'),
  workstationId: Type.Literal(PLANNING_WORKSTATION_EFFECTIVE_ID),
  workstationUrl: Type.Literal(PLANNING_WORKSTATION_ROUTE),
  integrationCommandId: Type.Literal(PLANNING_ENTRY_COMMAND_EFFECTIVE_ID),
  deepLinkId: Type.Literal(PLANNING_ENTRY_DEEP_LINK_EFFECTIVE_ID),
}, { additionalProperties: false });

const openPlanningEntry = defineExtensionAction({
  id: 'open-planning-entry',
  title: 'Open eforge-plan planning entry',
  description: 'Return generic eforge-plan planning entry metadata for hosts to continue in the planning workstation.',
  inputSchema: Type.Object({}, { additionalProperties: false }),
  outputSchema: PlanningEntryOutput,
  sideEffects: ['none'],
  handler() {
    return {
      kind: 'planning-entry',
      workstationId: PLANNING_WORKSTATION_EFFECTIVE_ID,
      workstationUrl: PLANNING_WORKSTATION_ROUTE,
      integrationCommandId: PLANNING_ENTRY_COMMAND_EFFECTIVE_ID,
      deepLinkId: PLANNING_ENTRY_DEEP_LINK_EFFECTIVE_ID,
    } as const;
  },
});

const captureItem = defineExtensionAction({
  id: 'capture-item', title: 'Capture backlog item', description: 'Create a visible eforge-plan backlog item and write it to private eforge-plan storage.',
  inputSchema: CaptureInput, outputSchema: ActionObjectOutput, sideEffects: ['local-write'],
  async handler(input, ctx) {
    const id = await resolveNewItemId(ctx.cwd, input.id, input.title);
    const now = new Date().toISOString();
    const body = [`# ${input.title}`, '', '## Claim', '', input.claim, '', '## Evidence', '', input.evidence ?? 'No evidence recorded yet.', '', '## Acceptance Criteria', '', input.acceptanceCriteria ?? 'Missing acceptance criteria: add concrete, verifiable done conditions before build handoff.', ''].join('\n');
    const item = await writeBacklogItem(ctx.cwd, { id, status: 'candidate', priority: input.priority, tags: input.tags ?? [], depends_on: input.dependsOn ?? [], epic: input.epic, created: now, updated: now, body });
    await markRecommendationsStaleForBacklogMutation(ctx.cwd, 'capture-item', [item.id]);
    return toJsonSafeObject({ itemId: item.id, status: item.status, path: resolveBacklogItemRelativePath(ctx.cwd, item.id) });
  },
});

const upsertEpic = defineExtensionAction({
  id: 'upsert-epic', title: 'Upsert backlog epic', description: 'Create or update a visible eforge-plan backlog epic in private storage without item membership lists.',
  inputSchema: EpicInput, outputSchema: ActionObjectOutput, sideEffects: ['local-write'],
  async handler(input, ctx) {
    const id = input.id ?? slugify(input.title);
    const now = new Date().toISOString();
    const existing = await readBacklogEpic(ctx.cwd, id);
    const body = input.body ?? (existing ? undefined : `# ${input.title}\n\n`);
    const epic = await writeBacklogEpic(ctx.cwd, { id, status: normalizedStatus(input.status, 'candidate'), priority: input.priority, tags: input.tags ?? [], updated: now, body });
    await markRecommendationsStaleForBacklogMutation(ctx.cwd, 'upsert-epic', [epic.id]);
    return toJsonSafeObject({ epicId: epic.id, status: epic.status, path: resolveBacklogEpicRelativePath(ctx.cwd, epic.id) });
  },
});

const updateItem = defineExtensionAction({
  id: 'update-item', title: 'Update backlog item', description: 'Update visible eforge-plan item metadata in private storage while preserving Markdown body content.',
  inputSchema: UpdateInput, outputSchema: ActionObjectOutput, sideEffects: ['local-write'],
  async handler(input, ctx) {
    const updates: Record<string, unknown> = { updated: new Date().toISOString() };
    if (input.status !== undefined) updates.status = normalizedStatus(input.status, 'candidate');
    if (input.priority !== undefined) updates.priority = input.priority;
    if (input.tags !== undefined) updates.tags = input.tags;
    if (input.dependsOn !== undefined) updates.depends_on = input.dependsOn;
    // Empty string clears the epic link: the undefined value is dropped from
    // frontmatter during serialization rather than written as `epic: ''`.
    if (input.epic !== undefined) updates.epic = input.epic.length > 0 ? input.epic : undefined;
    if (input.evidenceNotes !== undefined) updates.evidence_notes = input.evidenceNotes;
    if (input.recheckNotes !== undefined) updates.recheck_notes = input.recheckNotes;
    const item = await updateBacklogItemFrontmatter(ctx.cwd, input.id, updates);
    await markRecommendationsStaleForBacklogMutation(ctx.cwd, 'update-item', [item.id]);
    return toJsonSafeObject({ itemId: item.id, status: item.status });
  },
});

const promoteItem = defineExtensionAction({
  id: 'promote-item', title: 'Promote backlog item', description: 'Write a session plan, private backlog metadata updates, and trace evidence for a visible eforge-plan backlog item.',
  inputSchema: PromoteInput, outputSchema: ActionObjectOutput, sideEffects: ['local-write'],
  async handler(input, ctx) {
    const result = await promoteBacklogItem({ cwd: ctx.cwd, itemId: input.itemId, status: input.status ?? 'active', session: input.session, profile: input.profile ?? null });
    await markRecommendationsStaleForBacklogMutation(ctx.cwd, 'promote-item', [result.itemId]);
    return toJsonSafeObject(result);
  },
});

const promoteSelection = defineExtensionAction({
  id: 'promote-selection', title: 'Promote backlog selection', description: 'Write one session plan and private storage updates for selected visible eforge-plan backlog items, an epic, or a recommendation ref.',
  inputSchema: PromoteSelectionInput, outputSchema: PromoteSelectionOutput, sideEffects: ['local-write'],
  async handler(input, ctx) {
    const result = await promoteBacklogSelection({
      cwd: ctx.cwd,
      itemIds: input.itemIds,
      epicId: input.epicId,
      recommendationRef: input.recommendationRef,
      session: input.session,
      status: input.status,
      ...(input.profile !== undefined && { profile: input.profile }),
      title: input.title,
    });
    await markRecommendationsStaleForBacklogMutation(ctx.cwd, 'promote-selection', result.itemIds);
    return toJsonSafeObject(result);
  },
});

const importLegacyBacklogAction = defineExtensionAction({
  id: 'import-legacy-backlog',
  title: 'Import legacy backlog',
  description: 'Copy validated legacy .backlog records into private eforge-plan backlog storage without deleting legacy files.',
  inputSchema: ImportLegacyInput,
  outputSchema: ImportLegacyOutput,
  sideEffects: ['local-read', 'local-write'],
  async handler(input, ctx) {
    return toJsonSafeObject(await importLegacyBacklog(ctx.cwd, input));
  },
});

// registerAction infers a single (TInput, TOutput) per call, so a heterogeneous
// array of actions cannot be passed element-by-element while preserving each
// action's input/output schema generics (the handler is contravariant in its
// validated input). Registration is a schema-erased sink: the host re-validates
// every input against the action's own inputSchema at call time, so accepting
// the generic-erased action shape here is safe.
type RegistrableAction = ExtensionAction<TObject, TSchema | undefined>;

function registerActions(
  eforge: { registerAction(action: RegistrableAction): void },
  actions: readonly RegistrableAction[],
): void {
  for (const action of actions) eforge.registerAction(action);
}

export default defineEforgeExtension((eforge) => {
  if (typeof eforge.registerAction !== 'function') return;
  eforge.registerAction(listBoard);
  eforge.registerAction(captureItem);
  eforge.registerAction(upsertEpic);
  eforge.registerAction(updateItem);
  eforge.registerAction(importLegacyBacklogAction);
  eforge.registerAction(openPlanningEntry);
  eforge.registerAction(promoteItem);
  eforge.registerAction(promoteSelection);
  eforge.registerAction(renderBoardMarkdown);
  // Each collection is a tuple of actions with distinct input/output schemas;
  // registration erases those generics (see registerActions), so cast through
  // unknown to the schema-erased element type.
  registerActions(eforge, backlogQueryActions as unknown as readonly RegistrableAction[]);
  registerActions(eforge, recommendationActions as unknown as readonly RegistrableAction[]);
  registerActions(eforge, plannerActions as unknown as readonly RegistrableAction[]);
  registerActions(eforge, backlogCurationActions as unknown as readonly RegistrableAction[]);
  registerActions(eforge, sessionPlanActions as unknown as readonly RegistrableAction[]);
  registerActions(eforge, planRevisionActions as unknown as readonly RegistrableAction[]);
  registerActions(eforge, draftPlanUnitActions as unknown as readonly RegistrableAction[]);
  registerActions(eforge, roadmapActions as unknown as readonly RegistrableAction[]);
  eforge.registerInputSource({ name: 'eforge-plan', description: 'Compile visible private and compatible legacy eforge-plan backlog items into ordinary eforge build-source Markdown.', fetch: fetchEforgePlanInputSource });
  eforge.registerConsoleContribution(defineConsoleContribution({
    id: 'board', title: 'eforge-plan board', description: 'Declarative System surface for project-local visible backlog curation backed by private extension storage.',
    blocks: [
      { rendererId: 'markdown', title: 'Board summary', content: 'Use **Render board** to display the current derived kanban board from visible eforge-plan backlog records.' },
      { rendererId: 'status-badge', title: 'Lifecycle linkage', content: 'Trace sidecars enabled', status: 'active' },
      { rendererId: 'action-button', title: 'List board data', content: 'Return current board JSON.', action: { actionId: 'list-board' } },
      { rendererId: 'action-button', title: 'List compact board data', content: 'Return bounded open-first board JSON with counts and pagination for agents and compact hosts.', action: { actionId: 'list-board-compact' } },
      { rendererId: 'action-button', title: 'Render board', content: 'Show current board Markdown', action: { actionId: 'render-board-markdown' } },
      { rendererId: 'action-form', title: 'Promote item', content: 'Promote a backlog item to `.eforge/session-plans/<session>.md`.', action: { actionId: 'promote-item', inputDefaults: { status: 'active' } } },
      { rendererId: 'action-form', title: 'Promote selection', content: 'Promote selected backlog items, an epic, or a recommendation ref to one session plan.', action: { actionId: 'promote-selection', inputDefaults: { status: 'active' } } },
      { rendererId: 'action-button', title: 'Get recommendations', content: 'Read private recommendation summary data.', action: { actionId: 'get-recommendations' } },
      { rendererId: 'action-button', title: 'Analyze all backlog', content: 'Curate backlog records in default delta mode and refresh recommendations; open the workstation to opt into full implementation audit.', action: { actionId: 'analyze-all-backlog' } },
      { rendererId: 'action-form', title: 'Get backlog item', content: 'Read one compact backlog item detail with sections and lifecycle rows without listing the board.', action: { actionId: 'get-item' } },
      { rendererId: 'action-form', title: 'Get backlog epic', content: 'Read one compact backlog epic detail and paginated item summaries.', action: { actionId: 'get-epic' } },
      { rendererId: 'action-form', title: 'Search backlog items', content: 'Search compact backlog item summaries with bounded output.', action: { actionId: 'search-items' } },
      { rendererId: 'action-form', title: 'Prepare planner context', content: 'Prepare JSON-safe planner evidence without starting a chat runtime.', action: { actionId: 'prepare-planner-context', inputDefaults: { includeRoadmap: true } } },
      { rendererId: 'action-button', title: 'Get roadmap state', content: 'Read local focus and shared/discovered roadmap context.', action: { actionId: 'get-roadmap-state' } },
      { rendererId: 'action-form', title: 'Update roadmap state', content: 'Update private local focus roadmap and shared source configuration.', action: { actionId: 'update-roadmap-state' } },
      { rendererId: 'action-button', title: 'Refresh recommendations', content: 'Start or reuse a bounded recommendation refresh task.', action: { actionId: 'refresh-recommendations' } },
      { rendererId: 'action-form', title: 'Apply planner result', content: 'Apply structured recommendation updates or handoff drafts.', action: { actionId: 'apply-planner-result' } },
      { rendererId: 'action-form', title: 'Start planning agent task', content: 'Prepare bounded context and start a daemon-owned planning draft task.', action: { actionId: 'start-planning-agent-task', inputDefaults: { includeRoadmap: true } } },
      { rendererId: 'action-form', title: 'Get planning agent task', content: 'Read daemon-owned planning task status and result preview data.', action: { actionId: 'get-planning-agent-task' } },
      { rendererId: 'action-form', title: 'Preview backlog curation task', content: 'Validate a completed backlog-curation task on demand before applying it.', action: { actionId: 'preview-backlog-curation-task' } },
      { rendererId: 'action-form', title: 'Cancel planning agent task', content: 'Cancel a running daemon-owned planning draft task.', action: { actionId: 'cancel-planning-agent-task' } },
      { rendererId: 'action-form', title: 'Remove planning agent task', content: 'Dismiss a non-running daemon-owned planning task from the workflow list.', action: { actionId: 'remove-planning-agent-task' } },
      { rendererId: 'action-form', title: 'Apply planning agent task result', content: 'Apply only selected generated recommendations, handoff drafts, or session-plan sections.', action: { actionId: 'apply-planning-agent-task-result' } },
      { rendererId: 'action-button', title: 'Open planning workstation', content: 'Return the generic planning entry URL for the eforge-plan workstation.', action: { actionId: 'open-planning-entry' } },
      { rendererId: 'action-form', title: 'Capture item', content: 'Capture a candidate backlog item.', action: { actionId: 'capture-item' } },
      { rendererId: 'action-form', title: 'Update item', content: 'Update backlog item metadata.', action: { actionId: 'update-item' } },
      { rendererId: 'action-form', title: 'Import legacy backlog', content: 'Copy selected legacy .backlog records into private eforge-plan storage.', action: { actionId: 'import-legacy-backlog', inputDefaults: { kind: 'all' } } },
      { rendererId: 'action-form', title: 'Fork recommendation to draft unit', content: 'Create an editable draft plan unit from a recommendation safe-to-parallelize lane.', action: { actionId: 'fork-recommendation-to-draft-unit' } },
      { rendererId: 'action-form', title: 'Create draft unit', content: 'Create a user-authored draft plan unit from hand-picked backlog items.', action: { actionId: 'create-draft-unit' } },
      { rendererId: 'action-button', title: 'List draft units', content: 'List all draft plan units newest-first.', action: { actionId: 'list-draft-units' } },
      { rendererId: 'action-form', title: 'Get draft unit', content: 'Read one draft plan unit by id.', action: { actionId: 'get-draft-unit' } },
      { rendererId: 'action-form', title: 'Update draft unit', content: 'Edit a draft plan unit: rename, set intent or profile, add/remove/reorder items.', action: { actionId: 'update-draft-unit' } },
      { rendererId: 'action-form', title: 'Delete draft unit', content: 'Delete a draft plan unit.', action: { actionId: 'delete-draft-unit' } },
      { rendererId: 'action-form', title: 'Promote draft unit', content: 'Promote a draft plan unit plan-first into one session plan.', action: { actionId: 'promote-draft-unit', inputDefaults: { status: 'active' } } },
      { rendererId: 'action-form', title: 'Merge draft units', content: 'Combine several draft plan units into one; returns a dependency advisory.', action: { actionId: 'merge-draft-units' } },
      { rendererId: 'action-form', title: 'Split draft unit', content: 'Peel a subset of a draft plan unit’s items into a new unit; returns a dependency advisory.', action: { actionId: 'split-draft-unit' } },
      { rendererId: 'action-form', title: 'Advise: merge draft units', content: 'Preview the dependency advisory for a merge without changing anything.', action: { actionId: 'advise-merge-draft-units' } },
      { rendererId: 'action-form', title: 'Advise: split draft unit', content: 'Preview the dependency advisory for a split without changing anything.', action: { actionId: 'advise-split-draft-unit' } },
    ],
  }));
  eforge.registerConsoleWorkstation(defineConsoleWorkstation({
    id: 'planning-workstation',
    title: 'eforge-plan planning workstation',
    description: 'Extension-owned planning workstation for backlog board data, flat session plans, and session plan sets.',
    allowedActions: [
      'list-board-compact',
      'get-item',
      'get-epic',
      'search-items',
      'update-item',
      'render-board-markdown',
      'get-recommendations',
      'put-recommendations',
      'analyze-all-backlog',
      'get-roadmap-state',
      'update-roadmap-state',
      'refresh-recommendations',
      'prepare-planner-context',
      'apply-planner-result',
      'start-planning-agent-task',
      'get-planning-agent-task',
      'preview-backlog-curation-task',
      'cancel-planning-agent-task',
      'list-planning-agent-tasks',
      'remove-planning-agent-task',
      'retry-planning-agent-task',
      'redraft-planning-agent-task',
      'apply-planning-agent-task-result',
      'list-planning-artifacts',
      'show-session-plan',
      'show-session-plan-set',
      'create-session-plan',
      'set-session-plan-section',
      'select-session-plan-dimensions',
      'check-session-plan-readiness',
      'set-session-plan-ready',
      'delete-session-plan',
      'update-session-plan-metadata',
      'handoff-session-plan',
      'start-plan-revision-session',
      'list-plan-revision-sessions',
      'get-plan-revision-session',
      'create-plan-revision-annotation',
      'update-plan-revision-annotation',
      'delete-plan-revision-annotation',
      'resolve-plan-revision-annotation',
      'dismiss-plan-revision-annotation',
      'start-plan-revision-turn',
      'retry-plan-revision-turn',
      'cancel-plan-revision-turn',
      'apply-plan-revision-turn',
      'fork-recommendation-to-draft-unit',
      'create-draft-unit',
      'list-draft-units',
      'get-draft-unit',
      'update-draft-unit',
      'delete-draft-unit',
      'promote-draft-unit',
      'merge-draft-units',
      'split-draft-unit',
      'advise-merge-draft-units',
      'advise-split-draft-unit',
    ],
    frameBundle: { root: 'workstation-assets/plans', entrypoint: 'index.js', styles: ['style.css'], browserSdkVersion: 1 },
  }));
  eforge.registerIntegrationCommand(defineIntegrationCommand({ id: 'open-planning-entry', label: 'Open eforge-plan planning entry', description: 'Return the eforge-plan planning workstation URL for planning-mode continuation.', inputSchema: Type.Object({}, { additionalProperties: false }), action: { actionId: 'open-planning-entry' } }));
  eforge.registerIntegrationCommand(defineIntegrationCommand({ id: 'render-board', label: 'Render eforge-plan board', inputSchema: BoardInput, action: { actionId: 'render-board-markdown' } }));
  eforge.registerIntegrationCommand(defineIntegrationCommand({ id: 'promote-item', label: 'Promote eforge-plan item', inputSchema: PromoteInput, action: { actionId: 'promote-item' } }));
  eforge.registerIntegrationCommand(defineIntegrationCommand({ id: 'promote-selection', label: 'Promote eforge-plan selection', inputSchema: PromoteSelectionInput, action: { actionId: 'promote-selection' } }));
  eforge.registerDeepLink(defineExtensionDeepLink({ id: 'planning-workstation', label: 'Open eforge-plan planning workstation', description: 'Open the eforge-plan planning workstation for planning-mode playbook continuation.', urlTemplate: PLANNING_WORKSTATION_ROUTE, action: { actionId: 'open-planning-entry' } }));
  eforge.registerDeepLink(defineExtensionDeepLink({ id: 'board', label: 'Open eforge-plan board', action: { actionId: 'render-board-markdown' } }));
  eforge.registerDeepLink(defineExtensionDeepLink({ id: 'promote', label: 'Promote eforge-plan item', action: { actionId: 'promote-item' } }));
  eforge.registerDeepLink(defineExtensionDeepLink({ id: 'promote-selection', label: 'Promote eforge-plan selection', action: { actionId: 'promote-selection' } }));
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

