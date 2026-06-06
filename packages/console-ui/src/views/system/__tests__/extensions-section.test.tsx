// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import * as React from 'react';
import { ExtensionsSection } from '../extensions-section';
import { useExtensionManagementMutations } from '../use-extension-management-mutations';
import type { ExtensionManagementControls } from '../use-extension-management-mutations';
import { extensionKey } from '../extension-management-selectors';
import type {
  ExtensionEntry,
  ExtensionListResponse,
  ExtensionScope,
  ExtensionTrust,
  ExtensionTrustState,
} from '@eforge-build/client/browser';
import type { Loadable, ExtensionValidateResponse } from '../system-types';

const emptyTotals = { eventHooks: 0, agentRunHooks: 0, policyGates: 0, profileRouters: 0, inputSources: 0, reviewerPerspectives: 0, validationProviders: 0, tools: 0, prdEnrichers: 0, actions: 0, consoleContributions: 0, consoleWorkstations: 0, integrationCommands: 0, deepLinks: 0 };

function makeExtension(
  name: string,
  opts: { scope?: ExtensionScope; trustState?: ExtensionTrustState; trust?: ExtensionTrust } = {},
): ExtensionEntry {
  return {
    name,
    path: `/repo/eforge/extensions/${name}.ts`,
    scope: opts.scope ?? 'project-team',
    source: 'auto',
    status: 'loaded',
    trustState: opts.trustState,
    trust: opts.trust,
    shadows: [],
    registrations: { ...emptyTotals },
    diagnostics: [],
  };
}

function listOf(extensions: ExtensionEntry[]): Loadable<ExtensionListResponse> {
  return {
    status: 'success',
    updatedAt: 1,
    data: { extensions, diagnostics: [], totals: { ...emptyTotals } },
  };
}

const validateOk: Loadable<ExtensionValidateResponse> = {
  status: 'success',
  updatedAt: 1,
  data: { valid: true, extensions: [], diagnostics: [] },
};

function staticManagement(overrides: Partial<ExtensionManagementControls> = {}): ExtensionManagementControls {
  return {
    pending: null,
    errors: {},
    successes: {},
    onMutate: vi.fn(),
    reload: { pending: false, error: null, result: null },
    onReload: vi.fn(),
    validation: { pending: false, error: null, result: null, key: null },
    onValidateSelected: vi.fn(),
    ...overrides,
  };
}

function reloadResponse(message: string, watcherMessage: string) {
  return {
    extensions: [], diagnostics: [], totals: { ...emptyTotals },
    wasRunning: true, restarted: true, running: true, previousSessionId: 'old', sessionId: 'new', message,
    watcher: { wasRunning: true, restarted: true, running: true, previousSessionId: 'old', sessionId: 'new', message: watcherMessage },
  };
}

function selectRow(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

function details(): HTMLElement {
  return screen.getByLabelText(/^Extension details:/);
}

describe('ExtensionsSection details panel', () => {
  it('renders extension details only after the row is selected', () => {
    const list = listOf([makeExtension('alpha', { trustState: 'untrusted' })]);
    render(<ExtensionsSection list={list} validate={validateOk} management={staticManagement()} />);

    expect(screen.queryByLabelText(/^Extension details:/)).toBeNull();
    selectRow('alpha');
    const panel = details();
    expect(within(panel).getByText('/repo/eforge/extensions/alpha.ts')).toBeDefined();
    expect(within(panel).getByText('project-team')).toBeDefined();
  });

  it('renders provenance, registration, shadow, and diagnostic fields when present', () => {
    const ext: ExtensionEntry = {
      ...makeExtension('rich', { trustState: 'trusted' }),
      entrypoint: 'index.ts',
      enabled: true,
      currentHash: 'abc123',
      trustedHash: 'def456',
      trustedAt: '2026-01-01T00:00:00.000Z',
      trustedBy: 'console-ui',
      registrations: { ...emptyTotals, eventHooks: 2 },
      shadows: [{ name: 'rich', path: '/other/rich.ts', scope: 'project-local' }],
      diagnostics: [{ severity: 'warning', code: 'W1', message: 'heads up' }],
      package: { packageName: '@scope/rich', version: '1.0.0' },
      install: { sourceKind: 'npm', sourceSpec: '@scope/rich', installedAt: '2026-01-01T00:00:00.000Z', targetScope: 'project-team' },
    };
    render(<ExtensionsSection list={listOf([ext])} validate={validateOk} management={staticManagement()} />);
    selectRow('rich');
    const panel = details();
    expect(within(panel).getByText('index.ts')).toBeDefined();
    expect(within(panel).getByText('abc123')).toBeDefined();
    expect(within(panel).getByText('def456')).toBeDefined();
    expect(within(panel).getByText('console-ui')).toBeDefined();
    expect(within(panel).getByText(/event hooks: 2/)).toBeDefined();
    expect(within(panel).getByText('Package provenance')).toBeDefined();
    expect(within(panel).getByText('Install provenance')).toBeDefined();
    expect(within(panel).getByText(/Shadows \(1\)/)).toBeDefined();
    expect(within(panel).getByText(/heads up/)).toBeDefined();
  });

  it('shows the eligible actions per scope and trust state', () => {
    const list = listOf([
      makeExtension('untrusted-pt', { trustState: 'untrusted' }),
      makeExtension('trusted-pt', { trustState: 'trusted' }),
      makeExtension('local', { scope: 'project-local' }),
      makeExtension('user-ext', { scope: 'user' }),
    ]);
    render(<ExtensionsSection list={list} validate={validateOk} management={staticManagement()} />);

    selectRow('untrusted-pt');
    let panel = details();
    expect(within(panel).getByRole('button', { name: 'Trust' })).toBeDefined();
    expect(within(panel).getByRole('button', { name: 'Demote' })).toBeDefined();
    expect(within(panel).queryByRole('button', { name: 'Untrust' })).toBeNull();
    selectRow('untrusted-pt'); // deselect

    selectRow('trusted-pt');
    panel = details();
    expect(within(panel).getByRole('button', { name: 'Untrust' })).toBeDefined();
    expect(within(panel).queryByRole('button', { name: 'Trust' })).toBeNull();
    selectRow('trusted-pt');

    selectRow('local');
    panel = details();
    expect(within(panel).getByRole('button', { name: 'Promote' })).toBeDefined();
    expect(within(panel).getByRole('button', { name: 'Validate' })).toBeDefined();
    expect(within(panel).queryByRole('button', { name: 'Demote' })).toBeNull();
    selectRow('local');

    selectRow('user-ext');
    panel = details();
    expect(within(panel).getByRole('note')).toBeDefined();
    expect(within(panel).queryByRole('button', { name: 'Promote' })).toBeNull();
  });
});

describe('ExtensionsSection confirmation gating (static controls)', () => {
  it('does not call onMutate until the dialog is confirmed', () => {
    const onMutate = vi.fn();
    const list = listOf([makeExtension('alpha', { trustState: 'untrusted' })]);
    render(<ExtensionsSection list={list} validate={validateOk} management={staticManagement({ onMutate })} />);

    selectRow('alpha');
    fireEvent.click(within(details()).getByRole('button', { name: 'Trust' }));
    expect(onMutate).not.toHaveBeenCalled();

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('/repo/eforge/extensions/alpha.ts')).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Trust' }));
    expect(onMutate).toHaveBeenCalledWith('trust', '/repo/eforge/extensions/alpha.ts');
  });

  it('does not call onReload until the reload dialog is confirmed', () => {
    const onReload = vi.fn();
    render(<ExtensionsSection list={listOf([])} validate={validateOk} management={staticManagement({ onReload })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reload extensions' }));
    expect(onReload).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('shows pending, error, and success feedback while the row stays rendered', () => {
    const path = '/repo/eforge/extensions/alpha.ts';
    const list = listOf([makeExtension('alpha', { trustState: 'untrusted' })]);

    const { rerender } = render(
      <ExtensionsSection list={list} validate={validateOk} management={staticManagement({ pending: { action: 'trust', path } })} />,
    );
    selectRow('alpha');
    const pendingButton = within(details()).getByRole('button', { name: 'Trusting…' });
    expect((pendingButton as HTMLButtonElement).disabled).toBe(true);

    rerender(<ExtensionsSection list={list} validate={validateOk} management={staticManagement({ errors: { [path]: 'Ambiguous' } })} />);
    const alerts = within(details()).getAllByRole('alert').map((el) => el.textContent);
    expect(alerts.some((t) => t?.includes('Ambiguous'))).toBe(true);
    expect(within(details()).getByRole('button', { name: 'Trust' })).toBeDefined();

    rerender(<ExtensionsSection list={list} validate={validateOk} management={staticManagement({ successes: { [path]: 'Trusted alpha.' } })} />);
    expect(within(details()).getByText('Trusted alpha.')).toBeDefined();
  });

  it('renders the selected validation result without removing the global validation summary', () => {
    const ext = makeExtension('alpha', { trustState: 'untrusted' });
    const validation = {
      pending: false,
      error: null,
      result: { valid: false, extensions: [], diagnostics: [{ severity: 'error' as const, code: 'E1', message: 'selected bad' }] },
      key: extensionKey(ext),
    };
    render(<ExtensionsSection list={listOf([ext])} validate={validateOk} management={staticManagement({ validation })} />);
    selectRow('alpha');
    const panel = details();
    expect(within(panel).getByText('Selected validation')).toBeDefined();
    expect(within(panel).getByText('invalid')).toBeDefined();
    expect(within(panel).getByText(/selected bad/)).toBeDefined();
    // Global validation summary remains.
    expect(screen.getByText('Validation')).toBeDefined();
    expect(screen.getByText('valid')).toBeDefined();
  });

  it('renders reload watcher feedback from a reload result', () => {
    const reload = { pending: false, error: null, result: reloadResponse('Reloaded 3 extensions.', 'Watcher restarted on session new.') };
    render(<ExtensionsSection list={listOf([])} validate={validateOk} management={staticManagement({ reload })} />);
    expect(screen.getByText('Reloaded 3 extensions.')).toBeDefined();
    expect(screen.getByText(/Watcher restarted on session new\./)).toBeDefined();
    expect(screen.getByText('watcher restarted')).toBeDefined();
  });

  it('renders a reload error in a role=alert element', () => {
    const reload = { pending: false, error: 'reload failed', result: null };
    render(<ExtensionsSection list={listOf([])} validate={validateOk} management={staticManagement({ reload })} />);
    const alerts = screen.getAllByRole('alert').map((el) => el.textContent);
    expect(alerts.some((t) => t?.includes('reload failed'))).toBe(true);
  });
});

function ManagementHarness({ list, onRefresh }: { list: Loadable<ExtensionListResponse>; onRefresh: () => void }) {
  const management = useExtensionManagementMutations(onRefresh);
  return <ExtensionsSection list={list} validate={validateOk} management={management} />;
}

function okFetch(body: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(body) });
}

describe('ExtensionsSection + useExtensionManagementMutations integration', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const cases = [
    { label: 'trust', name: 'alpha', opts: { trustState: 'untrusted' as const }, trigger: 'Trust' },
    { label: 're-trust', name: 'beta', opts: { trustState: 'changed' as const }, trigger: 'Re-trust' },
    { label: 'untrust', name: 'gamma', opts: { trustState: 'trusted' as const }, trigger: 'Untrust' },
    { label: 'demote', name: 'delta', opts: { trustState: 'trusted' as const }, trigger: 'Demote' },
    { label: 'promote', name: 'epsilon', opts: { scope: 'project-local' as const }, trigger: 'Promote' },
  ];

  for (const c of cases) {
    it(`${c.label} calls refresh and renders the daemon message on success`, async () => {
      globalThis.fetch = okFetch({ extension: makeExtension(c.name, c.opts), message: `${c.label} done.` });
      const onRefresh = vi.fn();
      render(<ManagementHarness list={listOf([makeExtension(c.name, c.opts)])} onRefresh={onRefresh} />);

      selectRow(c.name);
      fireEvent.click(within(details()).getByRole('button', { name: c.trigger }));
      const dialog = screen.getByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: c.trigger }));

      await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
      expect(screen.getByText(`${c.label} done.`)).toBeDefined();
    });
  }

  it('renders the daemon error in role=alert and does not refresh on a failed mutation', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 409, statusText: 'Conflict', json: () => Promise.resolve({ error: 'Ambiguous' }) });
    const onRefresh = vi.fn();
    render(<ManagementHarness list={listOf([makeExtension('alpha', { trustState: 'untrusted' })])} onRefresh={onRefresh} />);

    selectRow('alpha');
    fireEvent.click(within(details()).getByRole('button', { name: 'Trust' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Trust' }));

    await waitFor(() => {
      const alerts = screen.getAllByRole('alert').map((el) => el.textContent);
      expect(alerts.some((t) => t?.includes('Ambiguous'))).toBe(true);
    });
    expect(onRefresh).not.toHaveBeenCalled();
    expect(within(details()).getByRole('button', { name: 'Trust' })).toBeDefined();
  });

  it('reload calls refresh and renders the daemon message and watcher metadata on success', async () => {
    globalThis.fetch = okFetch(reloadResponse('Reloaded extensions.', 'Watcher restarted.'));
    const onRefresh = vi.fn();
    render(<ManagementHarness list={listOf([])} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reload extensions' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Reload' }));

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Reloaded extensions.')).toBeDefined();
    expect(screen.getByText(/Watcher restarted\./)).toBeDefined();
  });

  it('selected validation renders its result without removing the global validation summary', async () => {
    globalThis.fetch = okFetch({ valid: false, extensions: [], diagnostics: [{ severity: 'error', code: 'E1', message: 'selected invalid' }] });
    render(<ManagementHarness list={listOf([makeExtension('alpha', { trustState: 'untrusted' })])} onRefresh={vi.fn()} />);

    selectRow('alpha');
    fireEvent.click(within(details()).getByRole('button', { name: 'Validate' }));

    await waitFor(() => expect(within(details()).getByText('Selected validation')).toBeDefined());
    expect(within(details()).getByText('invalid')).toBeDefined();
    expect(within(details()).getByText(/selected invalid/)).toBeDefined();
    expect(screen.getByText('Validation')).toBeDefined();
  });
});
