import { describe, expect, it } from 'vitest';
import type { FrameBundleWorkstationManifestEntry, SrcDocWorkstationManifestEntry } from '../workstation-manifest-mode';
import { resolveAllowedWorkstationAction, selectWorkstation, sortWorkstations } from '../workstation-selectors';

const assetId = 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-path-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function srcDocWorkstation(overrides: Partial<SrcDocWorkstationManifestEntry> = {}): SrcDocWorkstationManifestEntry {
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

function frameBundleWorkstation(overrides: Partial<FrameBundleWorkstationManifestEntry> = {}): FrameBundleWorkstationManifestEntry {
  return {
    id: 'bundle:board',
    localId: 'board',
    extensionName: 'bundle',
    extensionPath: '/bundle.js',
    title: 'Board',
    schemaVersion: 1,
    frameBundle: {
      browserSdkVersion: 1,
      frameUrl: '/api/extensions/workstations/bundle%3Aboard/frame',
      entrypoint: {
        id: assetId,
        url: `/api/extensions/workstations/bundle%3Aboard/assets/${assetId}`,
        relativePath: 'dist/index.js',
        sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      styles: [],
      assets: [],
    },
    allowedActions: ['bundle:render-board-markdown'],
    ...overrides,
  };
}

describe('workstation selectors', () => {
  it('sorts by title, extension, then id over mixed workstation modes', () => {
    const sorted = sortWorkstations([
      srcDocWorkstation({ id: 'z:board', extensionName: 'z', title: 'Board' }),
      frameBundleWorkstation({ id: 'a:alpha', extensionName: 'a', title: 'Alpha' }),
      srcDocWorkstation({ id: 'a:board', extensionName: 'a', title: 'Board' }),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual(['a:alpha', 'a:board', 'z:board']);
  });

  it('selects the requested workstation or the first when no id is provided', () => {
    const entries = [srcDocWorkstation({ id: 'demo:first' }), frameBundleWorkstation({ id: 'demo:second' })];

    expect(selectWorkstation(entries, undefined)?.id).toBe('demo:first');
    expect(selectWorkstation(entries, 'demo:second')?.id).toBe('demo:second');
    expect(selectWorkstation(entries, 'missing')).toBeNull();
  });

  it('resolves local and effective allowed action ids', () => {
    const entry = srcDocWorkstation({ allowedActions: ['demo:render-board-markdown'] });

    expect(resolveAllowedWorkstationAction(entry, 'render-board-markdown')).toBe('demo:render-board-markdown');
    expect(resolveAllowedWorkstationAction(entry, 'demo:render-board-markdown')).toBe('demo:render-board-markdown');
    expect(resolveAllowedWorkstationAction(entry, 'delete-everything')).toBeNull();
  });
});
