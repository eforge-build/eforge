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
import { createTraceSidecar, writeTraceSidecar } from '../trace-store.js';

const CLOSED_RENDERERS = new Set(['text', 'markdown', 'status-badge', 'link', 'action-button', 'action-form']);
const WRITE_ACTIONS = new Set(['capture-item', 'upsert-epic', 'update-item', 'promote-item']);
const READ_ACTIONS = new Set(['list-board', 'render-board-markdown']);

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

// --- eforge:region plan-01-json-safe-list-board ---
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
// --- eforge:endregion plan-01-json-safe-list-board ---

describe('eforge-plan extension registration', () => {
  it('loads without creating runtime storage', async () => {
    await withTempProject(async (cwd) => {
      load();
      expect(existsSync(join(cwd, '.backlog'))).toBe(false);
      expect(existsSync(join(cwd, '.eforge', 'storage'))).toBe(false);
      expect(existsSync(join(cwd, '.eforge', 'extensions', 'eforge-plan'))).toBe(false);
    });
  });

  it('registers the six MVP actions with object-root inputs and safe side effects', () => {
    const state = load();
    const actions = state.actions.map((entry) => entry.value);
    expect(actions.map((action) => action.id).sort()).toEqual(['capture-item', 'list-board', 'promote-item', 'render-board-markdown', 'update-item', 'upsert-epic']);
    for (const action of actions) {
      expect(action.inputSchema.type).toBe('object');
      expect(action.outputSchema).toBeDefined();
      expect(JSON.stringify(action.outputSchema)).not.toMatch(/function|undefined/);
      expect(action.sideEffects).not.toContain('build-queue');
      if (WRITE_ACTIONS.has(action.id)) expect(action.sideEffects).toContain('local-write');
      if (READ_ACTIONS.has(action.id)) expect(action.sideEffects?.every((effect) => effect === 'local-read' || effect === 'none')).toBe(true);
    }
    const listBoardOutput = actions.find((action) => action.id === 'list-board')?.outputSchema as Record<string, unknown>;
    expect(Object.keys(listBoardOutput.properties as Record<string, unknown>).sort()).toEqual(['blockedReasons', 'epics', 'items', 'lanes', 'traceSummaries']);
  });

  // --- eforge:region plan-01-json-safe-list-board ---
  it('dispatches JSON-safe board output and keeps markdown rendering available', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogEpic(cwd, { id: 'epic-one', status: 'planned', body: '# Epic One\n\nEpic evidence.\n' });
      await writeBacklogItem(cwd, { id: 'item-one', status: 'candidate', body: '# Item One\n\n## Claim\n\nShip item one.\n' });
      await mkdir(join(cwd, '.backlog', 'items'), { recursive: true });
      await writeFile(join(cwd, '.backlog', 'items', 'item-proto.md'), '---\nid: item-proto\nstatus: candidate\n__proto__:\n  injected: true\n---\n# Item Proto\n');
      await writeTraceSidecar(cwd, createTraceSidecar('item-one'));

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
      const output = expectRecord(listResult.output);
      for (const key of ['epics', 'items', 'lanes', 'blockedReasons', 'traceSummaries']) {
        expect(output[key]).toEqual(expect.any(Array));
      }
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
      expect(typeof expectRecord(markdownResult.output).markdown).toBe('string');
    });
  });
  // --- eforge:endregion plan-01-json-safe-list-board ---

  it('registers input source, Console contribution, commands, deep links, and lifecycle hooks', () => {
    const state = load();
    expect(state.inputSources.map((entry) => entry.name)).toEqual(['eforge-plan']);

    const contribution = state.consoleContributions[0]?.value;
    expect(contribution).toBeDefined();
    expect(contribution!.blocks.every((block) => CLOSED_RENDERERS.has(block.rendererId))).toBe(true);
    expect(contribution!.blocks.some((block) => (block.rendererId === 'text' || block.rendererId === 'markdown') && /board/i.test(block.title ?? block.content))).toBe(true);
    expect(contribution!.blocks.some((block) => block.rendererId === 'status-badge')).toBe(true);
    for (const actionId of ['render-board-markdown', 'promote-item', 'capture-item', 'update-item']) {
      expect(contribution!.blocks.some((block) => 'action' in block && block.action.actionId === actionId)).toBe(true);
    }

    expect(state.consoleWorkstations).toHaveLength(1);
    expect(state.consoleWorkstations[0]?.value.allowedActions).toEqual(['render-board-markdown']);
    expect(state.consoleWorkstations[0]?.value.srcDoc).toContain("window.eforge.invokeAction('render-board-markdown'");

    expect(state.integrationCommands.map((entry) => entry.value.action.actionId).sort()).toEqual(['promote-item', 'render-board-markdown']);
    expect(state.deepLinks.map((entry) => entry.value.action?.actionId).sort()).toEqual(['promote-item', 'render-board-markdown']);
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
