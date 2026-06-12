import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '../../../../packages/engine/src/extensions/action-runtime.js';
import { createExtensionRecorder } from '../../../../packages/engine/src/extensions/recorder.js';
import type { NativeExtensionRecorderState, NativeExtensionRegistry } from '../../../../packages/engine/src/extensions/types.js';
import type { EforgeEvent, EventHookContext } from '../../../../packages/extension-sdk/src/index.js';
import eforgePlanExtension from '../index.js';
import { writeBacklogEpic, writeBacklogItem } from '../markdown-store.js';
import { createEmptyRecommendationModel, writeRecommendations } from '../recommendations-store.js';
import { createTraceSidecar, writeTraceSidecar } from '../trace-store.js';

const CLOSED_RENDERERS = new Set(['text', 'markdown', 'status-badge', 'link', 'action-button', 'action-form']);
const WRITE_ACTIONS = new Set(['analyze-all-backlog', 'apply-planner-result', 'apply-planning-agent-task-result', 'cancel-planning-agent-task', 'start-planning-agent-task', 'retry-planning-agent-task', 'redraft-planning-agent-task', 'refresh-recommendations', 'remove-planning-agent-task', 'capture-item', 'upsert-epic', 'update-item', 'import-legacy-backlog', 'promote-item', 'promote-selection', 'create-session-plan', 'set-session-plan-section', 'select-session-plan-dimensions', 'set-session-plan-ready', 'update-session-plan-metadata', 'put-recommendations', 'handoff-session-plan', 'start-plan-revision-session', 'start-plan-revision-turn', 'retry-plan-revision-turn', 'cancel-plan-revision-turn', 'apply-plan-revision-turn']);
const READ_ACTIONS = new Set(['prepare-planner-context', 'get-planning-agent-task', 'list-planning-agent-tasks', 'list-board', 'list-board-compact', 'get-item', 'get-epic', 'search-items', 'render-board-markdown', 'list-planning-artifacts', 'show-session-plan', 'show-session-plan-set', 'check-session-plan-readiness', 'get-recommendations', 'list-plan-revision-sessions', 'get-plan-revision-session']);
const DAEMON_STATE_ACTIONS = new Set(['analyze-all-backlog', 'start-planning-agent-task', 'retry-planning-agent-task', 'redraft-planning-agent-task', 'refresh-recommendations', 'handoff-session-plan', 'start-plan-revision-turn', 'retry-plan-revision-turn', 'cancel-plan-revision-turn']);
const BUILD_QUEUE_ACTIONS = new Set(['handoff-session-plan']);

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-registration-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function load() {
  const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
  eforgePlanExtension(api as never);
  expect(state.diagnostics).toEqual([]);
  return state;
}

function registryFromRecorderState(state: NativeExtensionRecorderState): NativeExtensionRegistry {
  return { ...state, extensions: [], candidates: [] };
}

function collectUndefinedPaths(value: unknown, path = '$'): string[] {
  if (value === undefined) return [path];
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((entry, index) => collectUndefinedPaths(entry, `${path}[${index}]`));
  return Object.entries(value).flatMap(([key, entry]) => collectUndefinedPaths(entry, `${path}.${key}`));
}

function expectRecord(value: unknown): Record<string, unknown> {
  expect(value).toEqual(expect.any(Object));
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}

function markdownSection(markdown: string, heading: string): string {
  const start = markdown.indexOf(`${heading}\n`);
  expect(start).toBeGreaterThanOrEqual(0);
  const nextHeading = markdown.indexOf('\n## ', start + heading.length + 1);
  return markdown.slice(start, nextHeading === -1 ? undefined : nextHeading);
}

describe('eforge-plan extension registration', () => {
  it('loads without creating runtime storage', async () => {
    await withTempProject(async (cwd) => {
      load();
      expect(existsSync(join(cwd, '.backlog'))).toBe(false);
      expect(existsSync(join(cwd, '.eforge', 'storage'))).toBe(false);
      expect(existsSync(join(cwd, '.eforge', 'extensions', 'eforge-plan'))).toBe(false);
    });
  });

  it('registers backlog and planning actions with object-root inputs and safe side effects', () => {
    const state = load();
    const actions = state.actions.map((entry) => entry.value);
    expect(actions.map((action) => action.id).sort()).toEqual([
      'analyze-all-backlog',
      'apply-plan-revision-turn',
      'apply-planner-result',
      'apply-planning-agent-task-result',
      'cancel-plan-revision-turn',
      'cancel-planning-agent-task',
      'capture-item',
      'check-session-plan-readiness',
      'create-session-plan',
      'get-epic',
      'get-item',
      'get-plan-revision-session',
      'get-planning-agent-task',
      'get-recommendations',
      'handoff-session-plan',
      'import-legacy-backlog',
      'list-board',
      'list-board-compact',
      'list-plan-revision-sessions',
      'list-planning-agent-tasks',
      'list-planning-artifacts',
      'prepare-planner-context',
      'promote-item',
      'promote-selection',
      'put-recommendations',
      'redraft-planning-agent-task',
      'refresh-recommendations',
      'remove-planning-agent-task',
      'render-board-markdown',
      'retry-plan-revision-turn',
      'retry-planning-agent-task',
      'search-items',
      'select-session-plan-dimensions',
      'set-session-plan-ready',
      'set-session-plan-section',
      'show-session-plan',
      'show-session-plan-set',
      'start-plan-revision-session',
      'start-plan-revision-turn',
      'start-planning-agent-task',
      'update-item',
      'update-session-plan-metadata',
      'upsert-epic',
    ]);
    for (const action of actions) {
      expect(action.inputSchema.type).toBe('object');
      expect(action.outputSchema).toBeDefined();
      expect(JSON.stringify(action.outputSchema)).not.toMatch(/function|undefined/);
      if (BUILD_QUEUE_ACTIONS.has(action.id)) expect(action.sideEffects).toContain('build-queue');
      else expect(action.sideEffects).not.toContain('build-queue');
      if (WRITE_ACTIONS.has(action.id)) expect(action.sideEffects).toContain('local-write');
      if (DAEMON_STATE_ACTIONS.has(action.id)) expect(action.sideEffects).toContain('daemon-state');
      if (action.id === 'refresh-recommendations' || action.id === 'import-legacy-backlog' || action.id === 'analyze-all-backlog') expect(action.sideEffects).toContain('local-read');
      if (READ_ACTIONS.has(action.id)) {
        expect(action.sideEffects).toContain('local-read');
        expect(action.sideEffects).not.toContain('local-write');
        expect(action.sideEffects).not.toContain('build-queue');
      }
    }
    const listBoardOutput = actions.find((action) => action.id === 'list-board')?.outputSchema as Record<string, unknown>;
    expect(Object.keys(listBoardOutput.properties as Record<string, unknown>).sort()).toEqual(['blockedReasons', 'epicProgress', 'epics', 'items', 'lanes', 'lifecycleLinks', 'recommendationStatus', 'recommendationSummary', 'traceSummaries']);
    const getRecommendationsOutput = actions.find((action) => action.id === 'get-recommendations')?.outputSchema as Record<string, unknown>;
    expect(Object.keys(getRecommendationsOutput.properties as Record<string, unknown>).sort()).toEqual(['activeRefreshTask', 'path', 'recommendationSummary', 'recommendations', 'status']);
    expect(JSON.stringify(getRecommendationsOutput.properties)).toMatch(/statusPath|currentPath|freshAt|staleSince|lastRefreshedBy|reasons|staleReasons|missing|fresh|stale|activeRefreshTask/);
    const refreshOutput = actions.find((action) => action.id === 'refresh-recommendations')?.outputSchema as Record<string, unknown>;
    expect(JSON.stringify(refreshOutput)).toMatch(/task|entry|sourceFingerprint|recommendation-refresh/);
    const analyzeOutput = actions.find((action) => action.id === 'analyze-all-backlog')?.outputSchema as Record<string, unknown>;
    expect(JSON.stringify(analyzeOutput)).toMatch(/task|entry|sourceFingerprint|reused/);
    const applyPlanningOutput = actions.find((action) => action.id === 'apply-planning-agent-task-result')?.outputSchema as Record<string, unknown>;
    expect(JSON.stringify(applyPlanningOutput)).toMatch(/backlogCuration|generatedRecommendationValidation|recommendationsSkipped/);
    const applyPlanningInput = actions.find((action) => action.id === 'apply-planning-agent-task-result')?.inputSchema as Record<string, unknown>;
    expect(JSON.stringify(applyPlanningInput)).toMatch(/applyBacklogCurationDraft|previewAcknowledged|confirmApply|applyCurationOnly/);
    const listPlanningOutput = actions.find((action) => action.id === 'list-planning-agent-tasks')?.outputSchema as Record<string, unknown>;
    expect(JSON.stringify(listPlanningOutput)).toMatch(/backlogCurationPreview|generatedRecommendationValidation/);
  });

  it('dispatches JSON-safe board output and keeps markdown rendering available', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogEpic(cwd, { id: 'epic-one', status: 'planned', body: '# Epic One\n\nEpic evidence.\n' });
      await writeBacklogItem(cwd, { id: 'item-one', status: 'candidate', body: '# Item One\n\n## Claim\n\nShip item one.\n' });
      await writeBacklogItem(cwd, { id: 'item-blocked', status: 'candidate', body: '# Item Blocked\n\n## Claim\n\nBlocked work.\n' });
      await mkdir(join(cwd, '.backlog', 'items'), { recursive: true });
      await writeFile(join(cwd, '.backlog', 'items', 'item-proto.md'), '---\nid: item-proto\nstatus: candidate\n__proto__:\n  injected: true\n---\n# Item Proto\n');
      await writeTraceSidecar(cwd, createTraceSidecar('item-one'));

      const registry = registryFromRecorderState(load());
      await dispatchExtensionAction(registry, {
        actionId: 'eforge-plan:put-recommendations',
        input: {
          schemaVersion: 1,
          activeWork: [],
          readyCandidates: [],
          recommendedNextSequence: [{ itemId: 'item-one', rationale: 'Next best work.' }],
          safeParallelizableGroups: [{
            ref: 'group-one',
            title: 'Parallel group',
            itemIds: ['item-one', 'item-proto'],
            epicIds: ['epic-one'],
            safeToPlanTogether: true,
            rationale: 'Independent files.',
            recommendedProfile: 'errand',
          }],
          blockedChains: [{ ref: 'blocked-one', itemIds: ['item-blocked'], blockedBy: ['item-one'], rationale: 'Needs item one first.' }],
          rationaleAndAssumptions: ['Prefer thin vertical slices.'],
        },
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
      });
      const listResult = await dispatchExtensionAction(registry, {
        actionId: 'eforge-plan:list-board',
        input: { includeArchive: false },
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
      });

      expect(listResult).toMatchObject({ kind: 'success' });
      if (listResult.kind !== 'success') throw new Error(listResult.message);
      const output = expectRecord(listResult.output);
      for (const key of ['epics', 'items', 'lanes', 'blockedReasons', 'traceSummaries', 'lifecycleLinks', 'epicProgress']) {
        expect(output[key]).toEqual(expect.any(Array));
      }
      expect(output.recommendationSummary).toEqual({
        recommendedNextItemIds: ['item-one'],
        safeParallelizableGroups: [{
          ref: 'group-one',
          title: 'Parallel group',
          itemIds: ['item-one', 'item-proto'],
          epicIds: ['epic-one'],
          safeToPlanTogether: true,
          rationale: 'Independent files.',
          recommendedProfile: 'errand',
        }],
        blockedChainCount: 1,
        rationaleAndAssumptions: ['Prefer thin vertical slices.'],
      });
      expect(expectRecord(output.recommendationStatus).state).toBe('fresh');
      expect(collectUndefinedPaths(output)).toEqual([]);

      const item = expectRecord((output.items as unknown[]).find((entry) => expectRecord(entry).id === 'item-one'));
      expect('epic' in item).toBe(false);
      const protoItem = expectRecord((output.items as unknown[]).find((entry) => expectRecord(entry).id === 'item-proto'));
      expect(Object.getOwnPropertyDescriptor(protoItem, '__proto__')?.value).toEqual({ injected: true });
      const lanes = output.lanes as Array<{ items?: unknown[] }>;
      const card = expectRecord(lanes.flatMap((lane) => lane.items ?? []).find((entry) => expectRecord(entry).id === 'item-one'));
      expect('epic' in card).toBe(false);
      const trace = expectRecord((output.traceSummaries as unknown[]).find((entry) => expectRecord(entry).itemId === 'item-one'));
      expect('lastEvent' in trace).toBe(false);
      expect('epicId' in trace).toBe(false);

      const markdownResult = await dispatchExtensionAction(registry, {
        actionId: 'eforge-plan:render-board-markdown',
        input: { includeArchive: false },
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
      });

      expect(markdownResult).toMatchObject({ kind: 'success' });
      if (markdownResult.kind !== 'success') throw new Error(markdownResult.message);
      const markdown = expectRecord(markdownResult.output).markdown;
      if (typeof markdown !== 'string') throw new Error('Expected markdown output');
      expect(markdown).toContain('Recommendations are fresh for the current backlog fingerprint.');
      const recommendedSection = markdownSection(markdown, '## Recommended Next Work');
      expect(recommendedSection).toContain('- **item-one**');
    });
  });

  it('dispatches lifecycle links and epic progress from list-board output', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogEpic(cwd, { id: 'epic-one', status: 'active', body: '# Epic One\n' });
      await writeBacklogItem(cwd, { id: 'item-one', status: 'shipped', epic: 'epic-one', body: '# Item One\n\n## Claim\n\nMerged item.\n' });
      await writeBacklogItem(cwd, { id: 'item-two', status: 'planned', epic: 'epic-one', body: '# Item Two\n\n## Claim\n\nRemaining item.\n' });
      const trace = createTraceSidecar('item-one', 'epic-one');
      trace.promotedSessionPlans.push({ session: 'session-one', path: '.eforge/session-plans/session-one.md', status: 'submitted', promotedAt: '2026-01-01T00:00:00.000Z' });
      trace.queuePrds.push({ prdId: 'prd-one', path: '.eforge/prds/prd-one.md', status: 'completed', queuedAt: '2026-01-01T00:01:00.000Z' });
      trace.buildRuns.push({ runId: 'run-one', sessionId: 'build-session-one', status: 'completed', startedAt: '2026-01-01T00:02:00.000Z', completedAt: '2026-01-01T00:03:00.000Z' });
      trace.buildSessions.push({ runId: 'run-one', sessionId: 'build-session-one', status: 'completed', startedAt: '2026-01-01T00:02:00.000Z', completedAt: '2026-01-01T00:03:00.000Z' });
      trace.landingResults.push({ featureBranch: 'feature/one', prUrl: 'https://example.test/pr/1', status: 'pr-open', landedAt: '2026-01-01T00:04:00.000Z' });
      trace.landingResults.push({ featureBranch: 'feature/one', commitSha: 'abc123', status: 'landed', landedAt: '2026-01-01T00:04:30.000Z' });
      trace.lastEvent = { type: 'session:end', timestamp: '2026-01-01T00:05:00.000Z', sessionId: 'build-session-one', runId: 'run-one' };
      await writeTraceSidecar(cwd, trace);

      const result = await dispatchExtensionAction(registryFromRecorderState(load()), {
        actionId: 'eforge-plan:list-board',
        input: { includeArchive: false },
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
      });

      expect(result).toMatchObject({ kind: 'success' });
      if (result.kind !== 'success') throw new Error(result.message);
      const output = expectRecord(result.output);
      expect(collectUndefinedPaths(output)).toEqual([]);
      const lifecycleLinks = output.lifecycleLinks as Array<Record<string, unknown>>;
      expect(lifecycleLinks.map((row) => row.kind)).toEqual(['session-plan', 'queue-prd', 'build-run', 'build-session', 'pr', 'landing', 'last-event']);
      expect(lifecycleLinks.every((row) => Array.isArray(row.affectedItemIds) && row.affectedItemIds.includes('item-one'))).toBe(true);
      expect(lifecycleLinks.find((row) => row.kind === 'pr')).toMatchObject({ prUrl: 'https://example.test/pr/1', stage: 'pr-open', status: 'pr-open' });
      const epicProgress = expectRecord((output.epicProgress as unknown[]).find((entry) => expectRecord(entry).epicId === 'epic-one'));
      expect(epicProgress.lifecycleState).toBe('partial');
      expect(epicProgress.countsByBacklogStatus).toEqual({ planned: 1, shipped: 1 });
      expect(epicProgress.countsByLifecycleState).toEqual({ planned: 1, shipped: 1 });
      expect((epicProgress.itemRows as Array<Record<string, unknown>>).map((row) => row.itemId)).toEqual(['item-one', 'item-two']);
    });
  });

  it('omits recommendation projections and markdown section when recommendation storage is missing', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'candidate', body: '# Item One\n\n## Claim\n\nShip item one.\n' });
      const registry = registryFromRecorderState(load());
      const listResult = await dispatchExtensionAction(registry, {
        actionId: 'eforge-plan:list-board',
        input: { includeArchive: false },
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
      });
      expect(listResult).toMatchObject({ kind: 'success' });
      if (listResult.kind !== 'success') throw new Error(listResult.message);
      expect('recommendationSummary' in expectRecord(listResult.output)).toBe(false);

      const markdownResult = await dispatchExtensionAction(registry, {
        actionId: 'eforge-plan:render-board-markdown',
        input: { includeArchive: false },
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
      });
      expect(markdownResult).toMatchObject({ kind: 'success' });
      if (markdownResult.kind !== 'success') throw new Error(markdownResult.message);
      expect(expectRecord(markdownResult.output).markdown).not.toContain('## Recommended Next Work');
    });
  });

  it('renders empty recommendation projections when recommendation storage is empty', async () => {
    await withTempProject(async (cwd) => {
      await writeRecommendations(cwd, createEmptyRecommendationModel());
      const registry = registryFromRecorderState(load());
      const listResult = await dispatchExtensionAction(registry, {
        actionId: 'eforge-plan:list-board',
        input: { includeArchive: false },
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
      });
      expect(listResult).toMatchObject({ kind: 'success' });
      if (listResult.kind !== 'success') throw new Error(listResult.message);
      expect(expectRecord(listResult.output).recommendationSummary).toEqual({
        recommendedNextItemIds: [],
        safeParallelizableGroups: [],
        blockedChainCount: 0,
        rationaleAndAssumptions: [],
      });

      const markdownResult = await dispatchExtensionAction(registry, {
        actionId: 'eforge-plan:render-board-markdown',
        input: { includeArchive: false },
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
      });
      expect(markdownResult).toMatchObject({ kind: 'success' });
      if (markdownResult.kind !== 'success') throw new Error(markdownResult.message);
      const markdown = expectRecord(markdownResult.output).markdown;
      if (typeof markdown !== 'string') throw new Error('Expected markdown output');
      const recommendedSection = markdownSection(markdown, '## Recommended Next Work');
      expect(recommendedSection).toContain('_No recommended next items._');
    });
  });

  it('registers input source, Console contribution, commands, deep links, and lifecycle hooks', () => {
    const state = load();
    expect(state.inputSources.map((entry) => entry.name)).toEqual(['eforge-plan']);

    const contribution = state.consoleContributions[0]?.value;
    expect(contribution).toBeDefined();
    expect(contribution!.blocks.every((block) => CLOSED_RENDERERS.has(block.rendererId))).toBe(true);
    expect(contribution!.blocks.some((block) => (block.rendererId === 'text' || block.rendererId === 'markdown') && /board/i.test(block.title ?? block.content))).toBe(true);
    expect(contribution!.blocks.some((block) => block.rendererId === 'status-badge')).toBe(true);
    for (const actionId of ['render-board-markdown', 'list-board-compact', 'get-item', 'get-epic', 'search-items', 'promote-item', 'promote-selection', 'prepare-planner-context', 'apply-planner-result', 'start-planning-agent-task', 'analyze-all-backlog', 'get-planning-agent-task', 'cancel-planning-agent-task', 'apply-planning-agent-task-result', 'capture-item', 'update-item', 'import-legacy-backlog']) {
      expect(contribution!.blocks.some((block) => 'action' in block && block.action.actionId === actionId)).toBe(true);
    }
    expect(contribution!.blocks.some((block) => 'action' in block && block.action.actionId === 'refresh-recommendations')).toBe(false);

    expect(state.consoleWorkstations).toHaveLength(1);
    const workstation = state.consoleWorkstations[0]?.value;
    expect(workstation).toMatchObject({
      id: 'planning-workstation',
      allowedActions: expect.arrayContaining([
        'update-item',
        'list-board-compact',
        'get-item',
        'get-epic',
        'search-items',
        'list-planning-artifacts',
        'show-session-plan',
        'show-session-plan-set',
        'create-session-plan',
        'set-session-plan-section',
        'check-session-plan-readiness',
        'set-session-plan-ready',
        'handoff-session-plan',
        'get-recommendations',
        'put-recommendations',
        'prepare-planner-context',
        'apply-planner-result',
        'start-planning-agent-task',
        'analyze-all-backlog',
        'get-planning-agent-task',
        'cancel-planning-agent-task',
        'list-planning-agent-tasks',
        'retry-planning-agent-task',
        'redraft-planning-agent-task',
        'apply-planning-agent-task-result',
        'start-plan-revision-session',
        'list-plan-revision-sessions',
        'get-plan-revision-session',
        'start-plan-revision-turn',
        'retry-plan-revision-turn',
        'cancel-plan-revision-turn',
        'apply-plan-revision-turn',
      ]),
      frameBundle: { root: 'workstation-assets/plans', entrypoint: 'index.js', styles: ['style.css'], browserSdkVersion: 1 },
    });
    // promote-selection remains registered as an action, integration command, and
    // deep link, but the AI-first workstation no longer allows it in the iframe surface.
    expect(workstation!.allowedActions).not.toContain('promote-selection');
    expect(workstation!.allowedActions).not.toContain('refresh-recommendations');
    expect('srcDoc' in workstation!).toBe(false);

    expect(state.integrationCommands.map((entry) => entry.value.action.actionId).sort()).toEqual(['promote-item', 'promote-selection', 'render-board-markdown']);
    expect(state.deepLinks.map((entry) => entry.value.action?.actionId).sort()).toEqual(['promote-item', 'promote-selection', 'render-board-markdown']);
    expect(state.eventHooks.map((entry) => entry.value.pattern).sort()).toEqual(['enqueue:complete', 'enqueue:start', 'landing:auto-merge:complete', 'landing:complete', 'queue:prd:complete', 'queue:prd:start', 'session:end', 'session:start']);
  });

  it('runs lifecycle hooks with event contexts that do not expose cwd', async () => {
    await withTempProject(async (cwd) => {
      const state = load();
      const hook = state.eventHooks.find((entry) => entry.value.pattern === 'session:start');
      expect(hook).toBeDefined();
      const calls: Array<{ command: string; args?: string[] }> = [];
      const ctx = {
        event: { type: 'session:start', sessionId: 'session-one' } as EforgeEvent,
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        exec: {
          async run(command: string, args?: string[]) {
            calls.push({ command, args });
            return { stdout: cwd, stderr: '', exitCode: 0 };
          },
        },
      } satisfies EventHookContext;

      await (hook!.value.handler as unknown as (event: EforgeEvent, ctx: EventHookContext) => Promise<void>)(ctx.event, ctx);

      expect('cwd' in ctx).toBe(false);
      expect(calls).toEqual([{ command: process.execPath, args: ['-e', 'process.stdout.write(process.cwd())'] }]);
    });
  });
});
