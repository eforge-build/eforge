import * as React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ConsoleWorkstationManifestEntry, ExtensionContributionManifestResponse } from '@eforge-build/client/browser';
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

function workstation(overrides: Partial<ConsoleWorkstationManifestEntry> = {}): ConsoleWorkstationManifestEntry {
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

function manifest(consoleWorkstations: ConsoleWorkstationManifestEntry[]): ExtensionContributionManifestResponse {
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

  it('lists workstation titles and extension names when entries exist', async () => {
    fetchExtensionContributionManifest.mockResolvedValueOnce(manifest([
      workstation({ id: 'demo:board', title: 'Board', extensionName: 'demo' }),
      workstation({ id: 'tools:panel', title: 'Panel', extensionName: 'tools' }),
    ]));

    render(<WorkstationsView />);

    await waitFor(() => expect(screen.getAllByText('Board').length).toBeGreaterThan(0));
    expect(screen.getByText('Panel')).toBeDefined();
    expect(screen.getAllByText('demo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('tools').length).toBeGreaterThan(0);
  });

  it('selecting a workstation renders a sandboxed iframe derived from the manifest srcDoc', async () => {
    fetchExtensionContributionManifest.mockResolvedValueOnce(manifest([
      workstation({ id: 'demo:board', title: 'Board', srcDoc: '<main>Board content</main>' }),
      workstation({ id: 'tools:panel', title: 'Panel', extensionName: 'tools', srcDoc: '<main>Panel content</main>' }),
    ]));
    const onNavigate = vi.fn();

    render(<WorkstationsView onNavigate={onNavigate} />);

    await waitFor(() => expect(screen.getByRole('button', { name: /Panel/i })).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: /Panel/i }));

    const iframe = screen.getByTestId('workstation-iframe') as HTMLIFrameElement;
    expect(iframe.getAttribute('sandbox')).toContain('allow-scripts');
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(iframe.getAttribute('srcdoc')).toContain('Panel content');
    expect(iframe.getAttribute('srcdoc')).toContain('window.eforge');
    expect(iframe.getAttribute('srcdoc')).toContain('invokeAction');
    expect(onNavigate).toHaveBeenCalledWith('/console/workstations/tools%3Apanel');
  });

  it('renders selected detail routes and not-found states', async () => {
    fetchExtensionContributionManifest.mockResolvedValueOnce(manifest([
      workstation({ id: 'demo:board', title: 'Board' }),
    ]));

    render(<WorkstationsView selectedWorkstationId="missing:board" />);

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Workstation not found'));
  });
});
