import { describe, expect, it } from 'vitest';
import type { ConsoleWorkstationManifestEntry } from '@eforge-build/client/browser';
import { resolveAllowedWorkstationAction, selectWorkstation, sortWorkstations } from '../workstation-selectors';

function workstation(overrides: Partial<ConsoleWorkstationManifestEntry> = {}): ConsoleWorkstationManifestEntry {
  return {
    id: 'demo:board',
    localId: 'board',
    extensionName: 'demo',
    extensionPath: '/demo.js',
    title: 'Board',
    schemaVersion: 1,
    srcDoc: '<h1>Board</h1>',
    allowedActions: ['demo:render-board-markdown'],
    ...overrides,
  };
}

describe('workstation selectors', () => {
  it('sorts by title, extension, then id', () => {
    const sorted = sortWorkstations([
      workstation({ id: 'z:board', extensionName: 'z', title: 'Board' }),
      workstation({ id: 'a:alpha', extensionName: 'a', title: 'Alpha' }),
      workstation({ id: 'a:board', extensionName: 'a', title: 'Board' }),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual(['a:alpha', 'a:board', 'z:board']);
  });

  it('selects the requested workstation or the first when no id is provided', () => {
    const entries = [workstation({ id: 'demo:first' }), workstation({ id: 'demo:second' })];

    expect(selectWorkstation(entries, undefined)?.id).toBe('demo:first');
    expect(selectWorkstation(entries, 'demo:second')?.id).toBe('demo:second');
    expect(selectWorkstation(entries, 'missing')).toBeNull();
  });

  it('resolves local and effective allowed action ids', () => {
    const entry = workstation({ allowedActions: ['demo:render-board-markdown'] });

    expect(resolveAllowedWorkstationAction(entry, 'render-board-markdown')).toBe('demo:render-board-markdown');
    expect(resolveAllowedWorkstationAction(entry, 'demo:render-board-markdown')).toBe('demo:render-board-markdown');
    expect(resolveAllowedWorkstationAction(entry, 'delete-everything')).toBeNull();
  });
});
