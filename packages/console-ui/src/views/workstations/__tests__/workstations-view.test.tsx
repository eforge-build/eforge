import * as React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ExtensionContributionManifestResponse } from '@eforge-build/client/browser';
import type { FrameBundleWorkstationManifestEntry, SrcDocWorkstationManifestEntry } from '../workstation-manifest-mode';
import { WorkstationsView } from '../workstations-view';

const fetchExtensionContributionManifest = vi.fn();
const invokeExtensionAction = vi.fn();

vi.mock('@eforge-build/client/browser', async () => {
  const actual = await vi.importActual('@eforge-build/client/browser');
  return {
    ...actual,
    fetchExtensionContributionManifest: (...args: unknown[]) => fetchExtensionContributionManifest(...args),
    invokeExtensionAction: (...args: unknown[]) => invokeExtensionAction(...args),
  };
});

const assetId = 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-path-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const cssAssetId = 'sha256-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc-path-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';

function srcDocWorkstation(overrides: Partial<SrcDocWorkstationManifestEntry> = {}): SrcDocWorkstationManifestEntry {
  return {
    id: 'demo:board',
    localId: 'board',
    extensionName: 'demo',
    extensionPath: '/demo.js',
    title: 'Board',
    description: 'Board workstation',
    schemaVersion: 1,
    srcDoc: '<main><h1>Board iframe</h1></main>',
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
    title: 'Bundle Board',
    description: 'Bundle workstation',
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
      styles: [{
        id: cssAssetId,
        url: `/api/extensions/workstations/bundle%3Aboard/assets/${cssAssetId}`,
        relativePath: 'dist/index.css',
        sha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      }],
      assets: [],
    },
    allowedActions: ['bundle:render-board-markdown'],
    ...overrides,
  };
}

function manifest(consoleWorkstations: ExtensionContributionManifestResponse['consoleWorkstations']): ExtensionContributionManifestResponse {
  return {
    schemaVersion: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    actions: [],
    consoleContributions: [],
    consoleWorkstations,
    integrationCommands: [],
    deepLinks: [],
    diagnostics: [],
  };
}

function openSwitcher() {
  const trigger = screen.getByRole('combobox');
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

function chooseWorkstation(name: RegExp) {
  openSwitcher();
  fireEvent.click(screen.getByRole('option', { name }));
}

describe('WorkstationsView', () => {
  beforeEach(() => {
    fetchExtensionContributionManifest.mockReset();
    invokeExtensionAction.mockReset();
  });

  it('renders an empty state when no console workstations are registered', async () => {
    fetchExtensionContributionManifest.mockResolvedValueOnce(manifest([]));

    render(<WorkstationsView />);

    await waitFor(() => expect(screen.getByText(/No Console workstations are registered/i)).toBeDefined());
  });

  it('lists workstation titles in the switcher and shows the selected extension badge', async () => {
    fetchExtensionContributionManifest.mockResolvedValueOnce(manifest([
      srcDocWorkstation({ id: 'demo:board', title: 'Board', extensionName: 'demo' }),
      frameBundleWorkstation({ id: 'tools:panel', title: 'Panel', extensionName: 'tools' }),
    ]));

    render(<WorkstationsView />);

    // First sorted workstation (Board) is selected by default; its extension badge shows.
    await waitFor(() => expect(screen.getByRole('combobox')).toBeDefined());
    expect(screen.getByText('demo')).toBeDefined();

    openSwitcher();
    expect(screen.getByRole('option', { name: 'Board' })).toBeDefined();
    expect(screen.getByRole('option', { name: 'Panel' })).toBeDefined();
  });

  it('selecting a srcDoc workstation renders a sandboxed iframe derived from the manifest srcDoc', async () => {
    fetchExtensionContributionManifest.mockResolvedValueOnce(manifest([
      srcDocWorkstation({ id: 'demo:board', title: 'Board', srcDoc: '<main>Board content</main>' }),
      srcDocWorkstation({ id: 'tools:panel', title: 'Panel', extensionName: 'tools', srcDoc: '<main>Panel content</main>' }),
    ]));
    const onNavigate = vi.fn();

    render(<WorkstationsView onNavigate={onNavigate} />);

    await waitFor(() => expect(screen.getByRole('combobox')).toBeDefined());
    chooseWorkstation(/Panel/i);

    const iframe = screen.getByTestId('workstation-iframe') as HTMLIFrameElement;
    expect(iframe.getAttribute('sandbox')).toContain('allow-scripts');
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(iframe.getAttribute('srcdoc')).toContain('Panel content');
    expect(iframe.getAttribute('srcdoc')).toContain('window.eforge');
    expect(iframe.getAttribute('srcdoc')).toContain('invokeAction');
    expect(iframe.getAttribute('src')).toBeNull();
    expect(onNavigate).toHaveBeenCalledWith('/console/workstations/tools%3Apanel');
  });

  it('renders a frameBundle workstation as a sandboxed iframe src with bridge token in the fragment', async () => {
    const frameUrl = '/api/extensions/workstations/bundle%3Aboard/frame?view=main';
    fetchExtensionContributionManifest.mockResolvedValueOnce(manifest([
      frameBundleWorkstation({ frameBundle: { ...frameBundleWorkstation().frameBundle, frameUrl } }),
    ]));

    render(<WorkstationsView />);

    const iframe = await screen.findByTestId('workstation-iframe') as HTMLIFrameElement;
    expect(iframe.getAttribute('sandbox')).toContain('allow-scripts');
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(iframe.getAttribute('srcdoc')).toBeNull();
    const src = iframe.getAttribute('src');
    expect(src).toBeTruthy();
    expect(src).toContain(`${frameUrl}#bridgeToken=`);
    const parsed = new URL(src ?? '', 'https://console.test');
    expect(parsed.hash).toMatch(/^#bridgeToken=.+/);
    expect(parsed.searchParams.has('bridgeToken')).toBe(false);
    expect(parsed.pathname.includes('bridgeToken')).toBe(false);
  });

  it('does not render frameBundle assets in the parent document realm', async () => {
    const entry = frameBundleWorkstation();
    fetchExtensionContributionManifest.mockResolvedValueOnce(manifest([entry]));

    render(<WorkstationsView />);

    await screen.findByTestId('workstation-iframe');
    expect(document.querySelectorAll(`script[src="${entry.frameBundle.entrypoint.url}"]`)).toHaveLength(0);
    expect(document.querySelectorAll(`link[href="${entry.frameBundle.styles[0]?.url}"]`)).toHaveLength(0);
  });

  it('navigates to frameBundle workstation detail routes with encoded workstation ids', async () => {
    fetchExtensionContributionManifest.mockResolvedValueOnce(manifest([
      srcDocWorkstation({ id: 'demo:board', title: 'Board' }),
      frameBundleWorkstation({ id: 'bundle:board', title: 'Bundle Board' }),
    ]));
    const onNavigate = vi.fn();

    render(<WorkstationsView onNavigate={onNavigate} />);

    await waitFor(() => expect(screen.getByRole('combobox')).toBeDefined());
    chooseWorkstation(/Bundle Board/i);

    const iframe = screen.getByTestId('workstation-iframe') as HTMLIFrameElement;
    expect(iframe.getAttribute('src')).toContain('/api/extensions/workstations/bundle%3Aboard/frame#bridgeToken=');
    expect(iframe.getAttribute('srcdoc')).toBeNull();
    expect(onNavigate).toHaveBeenCalledWith('/console/workstations/bundle%3Aboard');
  });

  it('renders selected detail routes and not-found states', async () => {
    fetchExtensionContributionManifest.mockResolvedValueOnce(manifest([
      srcDocWorkstation({ id: 'demo:board', title: 'Board' }),
    ]));

    render(<WorkstationsView selectedWorkstationId="missing:board" />);

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Workstation not found'));
  });
});
