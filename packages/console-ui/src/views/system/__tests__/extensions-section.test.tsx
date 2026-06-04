// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';
import { ExtensionsSection } from '../extensions-section';
import type { ExtensionTrustControls } from '../extensions-section';
import { useExtensionTrustMutation } from '@/hooks/use-extension-trust-mutation';
import type { ExtensionEntry, ExtensionListResponse, ExtensionTrustState } from '@eforge-build/client/browser';
import type { Loadable, ExtensionValidateResponse } from '../system-types';

function makeExtension(name: string, trustState: ExtensionTrustState): ExtensionEntry {
  return {
    name,
    path: `/repo/eforge/extensions/${name}.ts`,
    scope: 'project-team',
    source: 'project-team',
    status: 'loaded',
    trustState,
    shadows: [],
    registrations: { eventHooks: 0, agentRunHooks: 0, policyGates: 0, profileRouters: 0, inputSources: 0, reviewerPerspectives: 0, validationProviders: 0, tools: 0, prdEnrichers: 0, actions: 0, consoleContributions: 0, integrationCommands: 0, deepLinks: 0 },
    diagnostics: [],
  };
}

function listOf(extensions: ExtensionEntry[]): Loadable<ExtensionListResponse> {
  return {
    status: 'success',
    updatedAt: 1,
    data: {
      extensions,
      diagnostics: [],
      totals: { eventHooks: 0, agentRunHooks: 0, policyGates: 0, profileRouters: 0, inputSources: 0, reviewerPerspectives: 0, validationProviders: 0, tools: 0, prdEnrichers: 0, actions: 0, consoleContributions: 0, integrationCommands: 0, deepLinks: 0 },
    },
  };
}

const validateOk: Loadable<ExtensionValidateResponse> = {
  status: 'success',
  updatedAt: 1,
  data: { valid: true, extensions: [], diagnostics: [] },
};

function staticTrust(overrides: Partial<ExtensionTrustControls> = {}): ExtensionTrustControls {
  return { pendingPath: null, errors: {}, successes: {}, onTrust: vi.fn(), ...overrides };
}

describe('ExtensionsSection trust controls', () => {
  it('renders Trust for untrusted and Re-trust for changed project-team rows', () => {
    const list = listOf([makeExtension('alpha', 'untrusted'), makeExtension('beta', 'changed')]);
    render(<ExtensionsSection list={list} validate={validateOk} trust={staticTrust()} />);
    expect(screen.getByRole('button', { name: 'Trust' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Re-trust' })).toBeDefined();
  });

  it('does not render trust controls for trusted or not-required rows', () => {
    const list = listOf([makeExtension('alpha', 'trusted'), makeExtension('beta', 'not-required')]);
    render(<ExtensionsSection list={list} validate={validateOk} trust={staticTrust()} />);
    expect(screen.queryByRole('button', { name: 'Trust' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Re-trust' })).toBeNull();
  });

  it('dispatches onTrust with the selected extension path', () => {
    const onTrust = vi.fn();
    const list = listOf([makeExtension('alpha', 'untrusted')]);
    render(<ExtensionsSection list={list} validate={validateOk} trust={staticTrust({ onTrust })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Trust' }));
    expect(onTrust).toHaveBeenCalledWith('/repo/eforge/extensions/alpha.ts');
  });

  it('disables the active row while its mutation is pending', () => {
    const list = listOf([makeExtension('alpha', 'untrusted')]);
    render(
      <ExtensionsSection
        list={list}
        validate={validateOk}
        trust={staticTrust({ pendingPath: '/repo/eforge/extensions/alpha.ts' })}
      />,
    );
    const button = screen.getByRole('button', { name: 'Trusting…' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders a failed mutation message in a role=alert element while the control stays visible', () => {
    const list = listOf([makeExtension('alpha', 'untrusted')]);
    render(
      <ExtensionsSection
        list={list}
        validate={validateOk}
        trust={staticTrust({ errors: { '/repo/eforge/extensions/alpha.ts': 'Ambiguous' } })}
      />,
    );
    const alerts = screen.getAllByRole('alert').map((el) => el.textContent);
    expect(alerts.some((t) => t?.includes('Ambiguous'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Trust' })).toBeDefined();
  });

  it('renders a success message for a trusted row', () => {
    const list = listOf([makeExtension('alpha', 'untrusted')]);
    render(
      <ExtensionsSection
        list={list}
        validate={validateOk}
        trust={staticTrust({ successes: { '/repo/eforge/extensions/alpha.ts': 'Trusted alpha. Reload extensions to apply.' } })}
      />,
    );
    expect(screen.getByText('Trusted alpha. Reload extensions to apply.')).toBeDefined();
  });
});

function TrustHarness({ list, onRefresh }: { list: Loadable<ExtensionListResponse>; onRefresh: () => void }) {
  const trust = useExtensionTrustMutation(onRefresh);
  return <ExtensionsSection list={list} validate={validateOk} trust={trust} />;
}

describe('ExtensionsSection + useExtensionTrustMutation integration', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('calls refresh once and renders the success message after a successful trust', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ extension: makeExtension('alpha', 'trusted'), message: 'Trusted alpha.' }),
    });
    const onRefresh = vi.fn();
    render(<TrustHarness list={listOf([makeExtension('alpha', 'untrusted')])} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole('button', { name: 'Trust' }));

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Trusted alpha.')).toBeDefined();
  });

  it('renders the daemon error in a role=alert when the trust mutation fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: () => Promise.resolve({ error: 'Ambiguous' }),
    });
    const onRefresh = vi.fn();
    render(<TrustHarness list={listOf([makeExtension('alpha', 'untrusted')])} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole('button', { name: 'Trust' }));

    await waitFor(() => {
      const alerts = screen.getAllByRole('alert').map((el) => el.textContent);
      expect(alerts.some((t) => t?.includes('Ambiguous'))).toBe(true);
    });
    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Trust' })).toBeDefined();
  });
});
