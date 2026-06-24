import { describe, expect, it } from 'vitest';
import { Type } from '@eforge-build/extension-sdk';

import { createExtensionRecorder } from '../packages/engine/src/extensions/recorder.js';

function recordAction(action: Record<string, unknown>) {
  const { api, state } = createExtensionRecorder('validation-ext', '/extensions/validation-ext/index.js');
  api.registerAction(action as never);
  return state;
}

// --- eforge:region plan-03-broad-action-diagnostics ---
function broadActionWarnings(state: ReturnType<typeof recordAction>) {
  return state.diagnostics.filter((diagnostic) => diagnostic.code.startsWith('extension:action-'));
}
// --- eforge:endregion plan-03-broad-action-diagnostics ---

describe('extension contribution validation warnings', () => {
  it('emits separate warning diagnostics for unbounded broad list/search/board actions', () => {
    const state = recordAction({
      id: 'list-board',
      title: 'List board',
      description: 'List every board row for debugging.',
      inputSchema: Type.Object({}, { additionalProperties: false }),
      outputSchema: Type.Object({ items: Type.Array(Type.Object({ id: Type.String() }, { additionalProperties: false })) }, { additionalProperties: false }),
      handler: () => ({ items: [] }),
    });

    expect(state.actions.map((action) => action.id)).toEqual(['validation-ext:list-board']);
    expect(state.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'warning', code: 'extension:action-missing-limit-control', name: 'validation-ext:list-board' }),
      expect.objectContaining({ severity: 'warning', code: 'extension:action-missing-cursor-control', name: 'validation-ext:list-board' }),
      expect.objectContaining({ severity: 'warning', code: 'extension:action-missing-projection-control', name: 'validation-ext:list-board' }),
      expect.objectContaining({ severity: 'warning', code: 'extension:action-output-profile-missing', name: 'validation-ext:list-board' }),
    ]));
    expect(state.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  });

  it('records broad paginated profiled actions with limit and cursor controls without projection warnings', () => {
    const state = recordAction({
      id: 'search-items',
      title: 'Search items',
      inputSchema: Type.Object({
        query: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
      }, { additionalProperties: false }),
      outputSchema: Type.Object({
        items: Type.Array(Type.Object({ id: Type.String() }, { additionalProperties: false })),
        total: Type.Integer({ minimum: 0 }),
        limit: Type.Integer({ minimum: 1 }),
        offset: Type.Integer({ minimum: 0 }),
      }, { additionalProperties: false }),
      outputProfile: 'agent-paginated',
      handler: () => ({ items: [], total: 0, limit: 20, offset: 0 }),
    });

    expect(state.actions.map((action) => action.id)).toEqual(['validation-ext:search-items']);
    expect(state.diagnostics).toEqual([]);
  });

  // --- eforge:region plan-03-broad-action-diagnostics ---
  it('does not classify single-record and write-like actions from title or description text', () => {
    const cases = [
      {
        id: 'get-item',
        title: 'Get item from board list',
        description: 'Reads one record while mentioning search and list terminology.',
        sideEffects: ['local-read'],
      },
      {
        id: 'preview-backlog-curation-task',
        title: 'Preview board curation task',
        description: 'Shows one search/list preview without dumping a board.',
        sideEffects: ['local-read'],
      },
      {
        id: 'remove-planning-agent-task',
        title: 'Remove planning task from list',
        description: 'Removes one board task selected by id.',
        sideEffects: ['local-write'],
      },
      {
        id: 'list-board-note',
        title: 'Write board list note',
        description: 'Updates a note whose copy mentions search and board lists.',
        sideEffects: ['local-write'],
      },
    ];

    for (const action of cases) {
      const state = recordAction({
        ...action,
        inputSchema: Type.Object({ id: Type.String() }, { additionalProperties: false }),
        outputSchema: Type.Object({ items: Type.Array(Type.Object({ id: Type.String() }, { additionalProperties: false })) }, { additionalProperties: false }),
        handler: () => ({ items: [] }),
      });

      expect(state.actions.map((registeredAction) => registeredAction.id)).toEqual([`validation-ext:${action.id}`]);
      expect(broadActionWarnings(state)).toEqual([]);
    }
  });

  // --- eforge:endregion plan-03-broad-action-diagnostics ---

  it('recognizes broad action controls inside composed input schemas', () => {
    const state = recordAction({
      id: 'list-composed-board',
      title: 'List composed board',
      inputSchema: Type.Object({}, {
        additionalProperties: false,
        allOf: [Type.Object({
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
          offset: Type.Optional(Type.Integer({ minimum: 0 })),
          fields: Type.Optional(Type.Array(Type.String())),
        }, { additionalProperties: false })],
      } as never),
      outputSchema: Type.Object({ items: Type.Array(Type.Object({ id: Type.String() }, { additionalProperties: false })) }, { additionalProperties: false }),
      outputProfile: 'agent-paginated',
      handler: () => ({ items: [] }),
    });

    expect(state.actions.map((action) => action.id)).toEqual(['validation-ext:list-composed-board']);
    expect(state.diagnostics).toEqual([]);
  });

  it('rejects invalid action output profiles as registration errors', () => {
    const state = recordAction({
      id: 'bad-profile',
      title: 'Bad profile',
      inputSchema: Type.Object({}, { additionalProperties: false }),
      outputProfile: 'huge-html',
      handler: () => ({}),
    });

    expect(state.actions).toEqual([]);
    expect(state.diagnostics).toEqual([expect.objectContaining({
      severity: 'error',
      code: 'extension:invalid-registration',
      name: 'bad-profile',
      message: expect.stringContaining('outputProfile'),
    })]);
  });
});
