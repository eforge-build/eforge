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
import type { EforgeEvent } from '../../../packages/extension-sdk/src/index.js';
import { extractMarkdownSections } from './backlog-domain.js';
import { projectKanbanBoard } from './kanban.js';
import {
  listBacklogEpics,
  listBacklogItems,
  readBacklogEpic,
  readBacklogItem,
  updateBacklogItemFrontmatter,
  writeBacklogEpic,
  writeBacklogItem,
} from './markdown-store.js';
import { summarizeTrace, listTraceSidecars } from './trace-store.js';
import { applyLifecycleEvent } from './lifecycle.js';
import { fetchEforgePlanInputSource, promoteBacklogItem } from './promote.js';

const BoardInput = Type.Object({ epic: Type.Optional(Type.String()), includeArchive: Type.Optional(Type.Boolean()) });
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
const JsonValue = Type.Recursive((Self) => Type.Union([Type.Null(), Type.Boolean(), Type.Number(), Type.String(), Type.Array(Self), Type.Record(Type.String(), Self)]));
const ActionObjectOutput = Type.Object({}, { additionalProperties: JsonValue });
const ListBoardOutput = Type.Object({ epics: Type.Array(Type.Unknown()), items: Type.Array(Type.Unknown()), lanes: Type.Array(Type.Unknown()), blockedReasons: Type.Array(Type.Object({ itemId: Type.String(), reasons: Type.Array(Type.String()) })), traceSummaries: Type.Array(Type.Unknown()) });
const MarkdownOutput = Type.Object({ markdown: Type.String() });

const listBoard = defineExtensionAction({
  id: 'list-board', title: 'List eforge-plan board', description: 'Read backlog epics, items, kanban lanes, blocked reasons, and trace summaries.',
  inputSchema: BoardInput, outputSchema: ListBoardOutput, sideEffects: ['local-read'],
  async handler(input, ctx) { return projectBoardOutput(await buildBoard(ctx.cwd, input)); },
});

const renderBoardMarkdown = defineExtensionAction({
  id: 'render-board-markdown', title: 'Render eforge-plan board', description: 'Render the derived kanban board as Markdown for hosts and Console.',
  inputSchema: BoardInput, outputSchema: MarkdownOutput, sideEffects: ['local-read'],
  async handler(input, ctx) { return { markdown: renderBoard(await buildBoard(ctx.cwd, input)) }; },
});

const captureItem = defineExtensionAction({
  id: 'capture-item', title: 'Capture backlog item', description: 'Create a project-local .backlog item.',
  inputSchema: CaptureInput, outputSchema: ActionObjectOutput, sideEffects: ['local-write'],
  async handler(input, ctx) {
    const id = await resolveNewItemId(ctx.cwd, input.id, input.title);
    const now = new Date().toISOString();
    const body = [`# ${input.title}`, '', '## Claim', '', input.claim, '', '## Evidence', '', input.evidence ?? 'No evidence recorded yet.', '', '## Acceptance Criteria', '', input.acceptanceCriteria ?? 'Missing acceptance criteria: add concrete, verifiable done conditions before build handoff.', ''].join('\n');
    const item = await writeBacklogItem(ctx.cwd, { id, status: 'candidate', priority: input.priority, tags: input.tags ?? [], depends_on: input.dependsOn ?? [], epic: input.epic, created: now, updated: now, body });
    return { itemId: item.id, status: item.status, path: `.backlog/items/${item.id}.md` };
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
    return { epicId: epic.id, status: epic.status, path: `.backlog/epics/${epic.id}.md` };
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
    return { itemId: item.id, status: item.status };
  },
});

const promoteItem = defineExtensionAction({
  id: 'promote-item', title: 'Promote backlog item', description: 'Write a session plan and trace evidence for a backlog item.',
  inputSchema: PromoteInput, outputSchema: ActionObjectOutput, sideEffects: ['local-write'],
  async handler(input, ctx) { return promoteBacklogItem({ cwd: ctx.cwd, itemId: input.itemId, status: input.status ?? 'active', session: input.session, profile: input.profile ?? null }); },
});

export default defineEforgeExtension((eforge) => {
  if (typeof eforge.registerAction !== 'function') return;
  eforge.registerAction(listBoard);
  eforge.registerAction(captureItem);
  eforge.registerAction(upsertEpic);
  eforge.registerAction(updateItem);
  eforge.registerAction(promoteItem);
  eforge.registerAction(renderBoardMarkdown);
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
    id: 'board-workstation',
    title: 'eforge-plan board workstation',
    description: 'Rough iframe proof-of-concept for rendering the project-local backlog board.',
    allowedActions: ['render-board-markdown'],
    srcDoc: `<!doctype html>
<html>
  <body>
    <h1>eforge-plan board</h1>
    <p id="status">Hello from the eforge-plan workstation.</p>
    <pre id="board">Loading board markdown…</pre>
    <script>
      (async () => {
        const status = document.getElementById('status');
        const board = document.getElementById('board');
        try {
          const result = await window.eforge.invokeAction('render-board-markdown', {});
          board.textContent = result && typeof result.markdown === 'string' ? result.markdown : JSON.stringify(result, null, 2);
          status.textContent = 'Board markdown rendered.';
        } catch (error) {
          status.textContent = 'Unable to render board markdown.';
          board.textContent = error instanceof Error ? error.message : String(error);
        }
      })();
    </script>
  </body>
</html>`,
  }));
  eforge.registerIntegrationCommand(defineIntegrationCommand({ id: 'render-board', label: 'Render eforge-plan board', inputSchema: BoardInput, action: { actionId: 'render-board-markdown' } }));
  eforge.registerIntegrationCommand(defineIntegrationCommand({ id: 'promote-item', label: 'Promote eforge-plan item', inputSchema: PromoteInput, action: { actionId: 'promote-item' } }));
  eforge.registerDeepLink(defineExtensionDeepLink({ id: 'board', label: 'Open eforge-plan board', action: { actionId: 'render-board-markdown' } }));
  eforge.registerDeepLink(defineExtensionDeepLink({ id: 'promote', label: 'Promote eforge-plan item', action: { actionId: 'promote-item' } }));
  for (const pattern of ['enqueue:start', 'enqueue:complete', 'queue:prd:start', 'queue:prd:complete', 'session:start', 'session:end', 'landing:complete', 'landing:auto-merge:complete'] as const) {
    eforge.onEvent(pattern, async (event, ctx) => { await applyLifecycleEvent(await resolveHookCwd(ctx), event); });
  }
});

async function buildBoard(cwd: string, input: { epic?: string; includeArchive?: boolean }) {
  const [epics, items, traces] = await Promise.all([listBacklogEpics(cwd), listBacklogItems(cwd), listTraceSidecars(cwd)]);
  const traceSummaries = traces.flatMap((trace) => summarizeTrace(trace) ?? []);
  const board = projectKanbanBoard(items, traceSummaries, { epic: input.epic, includeArchive: input.includeArchive });
  return { epics, items, lanes: board.lanes, blockedReasons: board.items.filter((item) => item.unresolvedDependsOn.length > 0).map((item) => ({ itemId: item.id, reasons: item.reasons })), traceSummaries };
}

// --- eforge:region plan-01-json-safe-list-board ---
function projectBoardOutput(board: Awaited<ReturnType<typeof buildBoard>>) {
  return projectJsonSafeValue(board);
}

function projectJsonSafeValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(projectJsonSafeValue).filter((entry) => entry !== undefined);
  if (!isPlainObject(value)) return value;
  const projected = Object.create(null) as Record<string, unknown>;
  for (const [key, entry] of Object.entries(value)) {
    const projectedEntry = projectJsonSafeValue(entry);
    if (projectedEntry !== undefined) projected[key] = projectedEntry;
  }
  return projected;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
// --- eforge:endregion plan-01-json-safe-list-board ---

function renderBoard(board: Awaited<ReturnType<typeof buildBoard>>): string {
  const lines = ['# eforge-plan board', ''];
  for (const lane of board.lanes) {
    lines.push(`## ${lane.title}`, '');
    if (lane.items.length === 0) lines.push('_No items._', '');
    for (const item of lane.items) lines.push(`- **${item.id}** (${item.status}) ${item.title}${item.reasons.length ? ` — ${item.reasons.join('; ')}` : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}

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

