import { describe, expect, it } from 'vitest';
import type { ConsoleWorkstationManifestEntry } from '@eforge-build/client/browser';
import {
  isFrameBundleWorkstation,
  isSrcDocWorkstation,
  type FrameBundleWorkstationManifestEntry,
  type SrcDocWorkstationManifestEntry,
} from '../workstation-manifest-mode';

const assetId = 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-path-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function srcDocWorkstation(): SrcDocWorkstationManifestEntry {
  return {
    id: 'demo:board',
    localId: 'board',
    extensionName: 'demo',
    extensionPath: '/demo.js',
    title: 'Board',
    schemaVersion: 1,
    srcDoc: '<h1>Board</h1>',
    allowedActions: ['demo:render-board-markdown'],
  };
}

function frameBundleWorkstation(): FrameBundleWorkstationManifestEntry {
  return {
    id: 'bundle:board',
    localId: 'board',
    extensionName: 'bundle',
    extensionPath: '/bundle.js',
    title: 'Bundle Board',
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
  };
}

describe('workstation manifest mode guards', () => {
  it('narrows srcDoc workstation manifest entries', () => {
    const entry: ConsoleWorkstationManifestEntry = srcDocWorkstation();

    expect(isSrcDocWorkstation(entry)).toBe(true);
    expect(isFrameBundleWorkstation(entry)).toBe(false);
  });

  it('narrows frameBundle workstation manifest entries', () => {
    const entry: ConsoleWorkstationManifestEntry = frameBundleWorkstation();

    expect(isFrameBundleWorkstation(entry)).toBe(true);
    expect(isSrcDocWorkstation(entry)).toBe(false);
  });
});
