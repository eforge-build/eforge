import { describe, expect, it } from 'vitest';
import { Type } from '@eforge-build/extension-sdk';

import { createExtensionRecorder } from '../packages/engine/src/extensions/recorder.js';

function recordAction(action: Record<string, unknown>) {
  const { api, state } = createExtensionRecorder('validation-ext', '/extensions/validation-ext/index.js');
  api.registerAction(action as never);
  return state;
}

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

  it('records broad paginated profiled actions with limit, cursor, and projection controls without warnings', () => {
    const state = recordAction({
      id: 'search-items',
      title: 'Search items',
      inputSchema: Type.Object({
        query: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        fields: Type.Optional(Type.Array(Type.String())),
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
