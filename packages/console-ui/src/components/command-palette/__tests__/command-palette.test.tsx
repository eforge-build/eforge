import { describe, expect, it, beforeEach, vi } from 'vitest';
import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ConsoleWorkstationManifestEntry, ExtensionContributionManifestResponse } from '@eforge-build/client/browser';
import { CommandPalette } from '../command-palette';

const browserMocks = vi.hoisted(() => ({
  fetchExtensionContributionManifest: vi.fn(),
  invokeExtensionAction: vi.fn(),
}));

vi.mock('@eforge-build/client/browser', async (importActual) => {
  const actual = await importActual<typeof import('@eforge-build/client/browser')>();
  return {
    ...actual,
    fetchExtensionContributionManifest: (...args: unknown[]) => browserMocks.fetchExtensionContributionManifest(...args),
    invokeExtensionAction: (...args: unknown[]) => browserMocks.invokeExtensionAction(...args),
  };
});

function manifest(overrides: Partial<ExtensionContributionManifestResponse> = {}): ExtensionContributionManifestResponse {
  return {
    schemaVersion: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    actions: [],
    consoleContributions: [],
    consoleWorkstations: [],
    integrationCommands: [],
    deepLinks: [],
    diagnostics: [],
    ...overrides,
  };
}

function workstation(id: string, title: string): ConsoleWorkstationManifestEntry {
  return {
    id,
    localId: id,
    extensionName: 'demo-ext',
    extensionPath: '/extensions/demo',
    title,
    schemaVersion: 1,
    srcDoc: '<p>demo</p>',
    allowedActions: [],
  } as ConsoleWorkstationManifestEntry;
}

function action(id: string, sideEffects?: ExtensionContributionManifestResponse['actions'][number]['sideEffects']): ExtensionContributionManifestResponse['actions'][number] {
  return {
    id,
    localId: id,
    extensionName: 'demo-ext',
    extensionPath: '/extensions/demo',
    title: 'Demo action',
    inputSchema: { type: 'object' },
    ...(sideEffects !== undefined && { sideEffects }),
  };
}

function commandItem(label: string): HTMLElement {
  const item = screen.getAllByText(label).map((node) => node.closest('[cmdk-item]')).find(Boolean);
  if (!item) throw new Error(`Command item not found: ${label}`);
  return item as HTMLElement;
}

async function openPaletteWith(keyInit: KeyboardEventInit = { key: 'k', metaKey: true }) {
  render(<CommandPalette onNavigate={vi.fn()} />);
  fireEvent.keyDown(document, keyInit);
  return screen.findByPlaceholderText('Search Console commands...');
}

describe('CommandPalette', () => {
  beforeEach(() => {
    browserMocks.fetchExtensionContributionManifest.mockReset();
    browserMocks.invokeExtensionAction.mockReset();
    browserMocks.fetchExtensionContributionManifest.mockResolvedValue(manifest());
    browserMocks.invokeExtensionAction.mockResolvedValue({ ok: true, invocationId: 'inv-1', output: null });
  });

  it('opens with Cmd+K and renders the command input', async () => {
    await openPaletteWith({ key: 'k', metaKey: true });
    expect(screen.getByPlaceholderText('Search Console commands...')).toBeDefined();
  });

  it('opens with Ctrl+K and renders the command input', async () => {
    await openPaletteWith({ key: 'k', ctrlKey: true });
    expect(screen.getByPlaceholderText('Search Console commands...')).toBeDefined();
  });

  it('ignores repeated command-palette shortcuts', () => {
    render(<CommandPalette onNavigate={vi.fn()} />);
    fireEvent.keyDown(document, { key: 'k', metaKey: true, repeat: true });
    expect(screen.queryByPlaceholderText('Search Console commands...')).toBeNull();
  });

  it('refreshes the extension manifest when opened', async () => {
    browserMocks.fetchExtensionContributionManifest
      .mockResolvedValueOnce(manifest())
      .mockResolvedValueOnce(manifest({ consoleWorkstations: [workstation('fresh', 'Fresh Board')] }));

    await openPaletteWith();

    await waitFor(() => expect(commandItem('Open Fresh Board')).toBeDefined());
    expect(browserMocks.fetchExtensionContributionManifest).toHaveBeenCalledTimes(2);
  });

  it('renders first-party Navigation commands', async () => {
    await openPaletteWith();
    expect(commandItem('Now')).toBeDefined();
    expect(commandItem('Workstations')).toBeDefined();
    expect(commandItem('System')).toBeDefined();
  });

  it('navigates when first-party commands are selected', async () => {
    const onNavigate = vi.fn();
    render(<CommandPalette onNavigate={onNavigate} />);
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    await screen.findByPlaceholderText('Search Console commands...');

    fireEvent.click(commandItem('Now'));
    expect(onNavigate).toHaveBeenLastCalledWith('/console/');

    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    fireEvent.click(commandItem('Workstations'));
    expect(onNavigate).toHaveBeenLastCalledWith('/console/workstations');

    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    fireEvent.click(commandItem('System'));
    expect(onNavigate).toHaveBeenLastCalledWith('/console/system');
  });

  it('renders Open Workstation as a disabled no-op when no workstations exist', async () => {
    const onNavigate = vi.fn();
    render(<CommandPalette onNavigate={onNavigate} />);
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    await screen.findByText('No Console workstations are registered.');

    fireEvent.click(commandItem('Open Workstation'));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('surfaces manifest load errors with a retry command', async () => {
    browserMocks.fetchExtensionContributionManifest.mockRejectedValue(new Error('daemon offline'));
    render(<CommandPalette onNavigate={vi.fn()} />);
    fireEvent.keyDown(document, { key: 'k', metaKey: true });

    expect(await screen.findByText('Unable to load workstations: daemon offline')).toBeDefined();
    expect(screen.getByText('daemon offline')).toBeDefined();
    fireEvent.click(commandItem('Retry loading extensions'));
    expect(browserMocks.fetchExtensionContributionManifest).toHaveBeenCalledTimes(3);
  });

  it('opens the only workstation directly', async () => {
    browserMocks.fetchExtensionContributionManifest.mockResolvedValue(manifest({
      consoleWorkstations: [workstation('demo:board', 'Demo Board')],
    }));
    const onNavigate = vi.fn();
    render(<CommandPalette onNavigate={onNavigate} />);
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    await waitFor(() => expect(commandItem('Open Demo Board')).toBeDefined());

    fireEvent.click(commandItem('Open Workstation'));
    expect(onNavigate).toHaveBeenCalledWith('/console/workstations/demo%3Aboard');
  });

  it('renders a nested selector for multiple workstations', async () => {
    browserMocks.fetchExtensionContributionManifest.mockResolvedValue(manifest({
      consoleWorkstations: [workstation('alpha', 'Alpha'), workstation('beta', 'Beta')],
    }));
    const onNavigate = vi.fn();
    render(<CommandPalette onNavigate={onNavigate} />);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    await waitFor(() => expect(commandItem('Open Alpha')).toBeDefined());

    fireEvent.click(commandItem('Open Workstation'));
    expect(await screen.findByPlaceholderText('Search workstations...')).toBeDefined();
    fireEvent.click(commandItem('Open Beta'));
    expect(onNavigate).toHaveBeenCalledWith('/console/workstations/beta');
  });

  it('resets nested palette state when closed with the keyboard shortcut', async () => {
    browserMocks.fetchExtensionContributionManifest.mockResolvedValue(manifest({
      consoleWorkstations: [workstation('alpha', 'Alpha'), workstation('beta', 'Beta')],
    }));
    render(<CommandPalette onNavigate={vi.fn()} />);
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    await waitFor(() => expect(commandItem('Open Alpha')).toBeDefined());

    fireEvent.click(commandItem('Open Workstation'));
    expect(await screen.findByPlaceholderText('Search workstations...')).toBeDefined();
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(await screen.findByPlaceholderText('Search Console commands...')).toBeDefined();
  });

  it('invokes a safe extension command with command-palette requestedBy metadata', async () => {
    browserMocks.fetchExtensionContributionManifest.mockResolvedValue(manifest({
      actions: [action('demo.echo', ['none'])],
      integrationCommands: [{
        id: 'demo.run',
        localId: 'run',
        extensionName: 'demo-ext',
        extensionPath: '/extensions/demo',
        label: 'Run Echo',
        action: { actionId: 'demo.echo', inputDefaults: { message: 'hi' } },
      }],
    }));
    await openPaletteWith();
    await waitFor(() => expect(commandItem('Run Echo')).toBeDefined());

    fireEvent.click(commandItem('Run Echo'));
    await waitFor(() => expect(browserMocks.invokeExtensionAction).toHaveBeenCalled());
    expect(browserMocks.invokeExtensionAction.mock.calls[0][0]).toMatchObject({
      actionId: 'demo.echo',
      input: { message: 'hi' },
      requestedBy: { host: 'console', surface: 'command-palette', commandId: 'demo.run' },
    });
  });

  it('confirms side-effectful extension commands before invocation', async () => {
    browserMocks.fetchExtensionContributionManifest.mockResolvedValue(manifest({
      actions: [action('demo.write', ['local-write'])],
      integrationCommands: [{ id: 'demo.writeCommand', localId: 'write', extensionName: 'demo-ext', extensionPath: '/extensions/demo', label: 'Write Files', action: { actionId: 'demo.write' } }],
    }));
    await openPaletteWith();
    await waitFor(() => expect(commandItem('Write Files')).toBeDefined());

    fireEvent.click(commandItem('Write Files'));
    expect(browserMocks.invokeExtensionAction).not.toHaveBeenCalled();
    expect(screen.getByText(/Run Write Files from demo-ext\. Side effects: local-write\./)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Run command' }));
    await waitFor(() => expect(browserMocks.invokeExtensionAction).toHaveBeenCalled());
  });

  it('confirms commands with missing side-effect metadata as unknown', async () => {
    browserMocks.fetchExtensionContributionManifest.mockResolvedValue(manifest({
      actions: [action('demo.unknown')],
      integrationCommands: [{ id: 'demo.unknownCommand', localId: 'unknown', extensionName: 'demo-ext', extensionPath: '/extensions/demo', label: 'Mystery Command', action: { actionId: 'demo.unknown' } }],
    }));
    await openPaletteWith();
    await waitFor(() => expect(commandItem('Mystery Command')).toBeDefined());

    fireEvent.click(commandItem('Mystery Command'));
    expect(screen.getByText(/Run Mystery Command from demo-ext\. Side effects: unknown\./)).toBeDefined();
  });

  it('does not register iframe message listeners for palette shortcuts', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener');
    render(<CommandPalette onNavigate={vi.fn()} />);

    expect(addEventListener).not.toHaveBeenCalledWith('message', expect.any(Function), expect.anything());
    expect(addEventListener).not.toHaveBeenCalledWith('message', expect.any(Function));
    addEventListener.mockRestore();
  });
});
