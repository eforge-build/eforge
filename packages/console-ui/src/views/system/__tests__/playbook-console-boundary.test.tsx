// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SystemViewContent } from '../system-view-content';
import type { ExtensionContributionManifestResponse, SystemSurfacesState } from '../system-types';

const testDir = dirname(fileURLToPath(import.meta.url));
const systemViewDir = join(testDir, '..');
const consoleSrcRoot = join(testDir, '../../..');

const invokeExtensionAction = vi.fn();
vi.mock('@eforge-build/client/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@eforge-build/client/browser')>();
  return { ...actual, invokeExtensionAction: (...args: unknown[]) => invokeExtensionAction(...args) };
});

function success<T>(data: T) {
  return { status: 'success' as const, data, updatedAt: 1 };
}

function emptyTotals() {
  return { eventHooks: 0, agentRunHooks: 0, policyGates: 0, profileRouters: 0, inputSources: 0, reviewerPerspectives: 0, validationProviders: 0, tools: 0, prdEnrichers: 0, actions: 0, consoleContributions: 0, consoleWorkstations: 0, integrationCommands: 0, deepLinks: 0 };
}

function emptyContributionManifest(): ExtensionContributionManifestResponse {
  return {
    schemaVersion: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    actions: [],
    consoleContributions: [],
    consoleWorkstations: [],
    integrationCommands: [],
    deepLinks: [],
    diagnostics: [],
  };
}

function playbooksContributionManifest(): ExtensionContributionManifestResponse {
  return {
    schemaVersion: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    actions: [{
      id: 'eforge-playbooks:list-playbooks',
      localId: 'list-playbooks',
      extensionName: 'eforge-playbooks',
      extensionPath: '/repo/eforge/extensions/eforge-playbooks/index.ts',
      title: 'List playbooks',
      inputSchema: { type: 'object', properties: {} },
    }],
    consoleContributions: [{
      id: 'eforge-playbooks.inventory',
      localId: 'inventory',
      extensionName: 'eforge-playbooks',
      extensionPath: '/repo/eforge/extensions/eforge-playbooks/index.ts',
      title: 'Playbook inventory',
      schemaVersion: 1,
      blocks: [
        { rendererId: 'text', content: 'Manage playbooks through extension-owned Console contributions.' },
        { rendererId: 'action-button', content: 'List playbooks', action: { actionId: 'eforge-playbooks:list-playbooks' } },
      ],
    }],
    consoleWorkstations: [],
    integrationCommands: [],
    deepLinks: [],
    diagnostics: [],
  };
}

function makeState(manifest: ExtensionContributionManifestResponse): SystemSurfacesState {
  return {
    daemon: {
      health: success({ status: 'ok', pid: 42 }),
      version: success({ version: 17, eforgeVersion: '1.0.0' }),
      projectContext: success({ cwd: '/repo', gitRemote: null }),
    },
    config: {
      show: success({ resolved: {}, sources: {} }),
      validate: success({ configFound: true, valid: true }),
    },
    profiles: {
      list: success({ profiles: [], active: null, source: 'none' }),
      active: success({ active: null, source: 'none', resolved: { profile: null } }),
    },
    extensions: {
      list: success({ extensions: [], diagnostics: [], totals: emptyTotals() }),
      validate: success({ valid: true, extensions: [], diagnostics: [] }),
      contributions: success(manifest),
    },
    models: {
      catalogs: {
        pi: { providers: success({ providers: [] }), models: success({ models: [] }) },
        'claude-sdk': { providers: success({ providers: [] }), models: success({ models: [] }) },
      },
    },
  };
}

function collectSourceFiles(root: string): string[] {
  const entries = readdirSync(root);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry);
    if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist') continue;
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...collectSourceFiles(path));
    if (stat.isFile() && /\.(ts|tsx)$/.test(entry)) files.push(path);
  }
  return files;
}

describe('playbook Console ownership boundary', () => {
  it('does not keep the deleted core Playbooks section file', () => {
    expect(existsSync(join(systemViewDir, 'playbooks-section.tsx'))).toBe(false);
  });

  it('does not render playbook controls when the manifest has no playbook contribution', () => {
    render(<SystemViewContent state={makeState(emptyContributionManifest())} onRefresh={() => {}} />);

    expect(screen.queryByRole('heading', { name: 'Playbooks' })).toBeNull();
    expect(screen.queryByText('Playbook inventory')).toBeNull();
    expect(screen.queryByRole('button', { name: 'List playbooks' })).toBeNull();
  });

  it('renders eforge-playbooks inventory controls through generic extension contributions', async () => {
    invokeExtensionAction.mockResolvedValueOnce({ ok: true, invocationId: 'inv-playbooks', output: null });

    render(<SystemViewContent state={makeState(playbooksContributionManifest())} onRefresh={() => {}} />);

    expect(screen.queryByRole('heading', { name: 'Playbooks' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Extension Console contributions' })).toBeDefined();
    expect(screen.getByText('Playbook inventory')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'List playbooks' }));

    await waitFor(() => expect(invokeExtensionAction).toHaveBeenCalledOnce());
    expect(invokeExtensionAction.mock.calls[0][0]).toMatchObject({
      actionId: 'eforge-playbooks:list-playbooks',
      input: {},
      requestedBy: { host: 'console', surface: 'contribution:eforge-playbooks.inventory' },
    });
  });

  it('keeps core Console source free of direct playbook ownership tokens', () => {
    const root = consoleSrcRoot;
    const playbookToken = 'Playbook';
    const playbooksToken = 'playbooks';
    const forbiddenTokens = [
      `${playbookToken}sSection`,
      `fetchSystem${playbookToken}List`,
      `API_ROUTES.${'playbook'}`,
      `${playbookToken}ListResponse`,
      `${playbookToken}ListEntry`,
      `select${playbookToken}ModeCounts`,
      `select${playbookToken}Rows`,
      `commandPalette${playbookToken}s`,
      `${playbooksToken}.list`,
      `${playbooksToken}.run`,
      `state.${playbooksToken}`,
      `/${playbooksToken}`,
      `PLAYBOOK_CONTRIBUTION_IDS`,
      `eforge-playbooks:list-playbooks`,
    ];

    const offenders = collectSourceFiles(root).flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return forbiddenTokens
        .filter((token) => text.includes(token))
        .map((token) => `${file}: ${token}`);
    });

    expect(offenders).toEqual([]);
  });
});
