/**
 * Unit tests for Pi playbook-commands planning-mode delegation.
 *
 * Verifies that the native Pi /eforge:playbook run command delegates
 * planning-mode playbooks to /skill:eforge-playbook run before offering
 * any active-build dependency prompts, as required by the contract.
 *
 * Pi framework peer deps are avoided by mocking ui-helpers entirely.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PlaybookListEntry } from '@eforge-build/client';

// ---------------------------------------------------------------------------
// Mock Pi TUI helpers — avoids loading @earendil-works/pi-tui peer dep
// ---------------------------------------------------------------------------

vi.mock('../packages/pi-eforge/extensions/eforge/ui-helpers.js', () => ({
  withLoader: vi.fn(async (_ctx: unknown, _msg: unknown, fn: () => unknown) => fn()),
  showSelectOverlay: vi.fn(),
  showInfoOverlay: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock daemon client calls — no live daemon needed
// ---------------------------------------------------------------------------

vi.mock('@eforge-build/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@eforge-build/client')>();
  return {
    ...actual,
    apiPlaybookListIfRunning: vi.fn(),
    apiPlaybookRunIfRunning: vi.fn(),
    apiPlaybookPromoteIfRunning: vi.fn(),
    apiPlaybookDemoteIfRunning: vi.fn(),
    apiGetQueueIfRunning: vi.fn(),
  };
});

import { handlePlaybookCommand } from '../packages/pi-eforge/extensions/eforge/playbook-commands.js';
import { apiPlaybookListIfRunning } from '@eforge-build/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(cwd = '/project') {
  return {
    cwd,
    hasUI: true,
    ui: {
      custom: vi.fn(),
      setStatus: vi.fn(),
    },
  };
}

function makePi() {
  return { sendUserMessage: vi.fn() };
}

function makeEntry(overrides: Partial<PlaybookListEntry> = {}): PlaybookListEntry {
  return {
    name: 'my-playbook',
    description: 'A test playbook',
    scope: 'project-team',
    mode: 'autonomous',
    source: 'project-team',
    shadows: [],
    path: '/project/.eforge/playbooks/my-playbook.md',
    ...overrides,
  };
}

function mockPlaybookList(playbooks: PlaybookListEntry[]) {
  (apiPlaybookListIfRunning as ReturnType<typeof vi.fn>).mockResolvedValue({
    status: 200,
    data: { playbooks, warnings: [] },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Pi handlePlaybookCommand - planning-mode delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates planning-mode playbook to /skill:eforge-playbook run before dependency prompts', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    mockPlaybookList([makeEntry({ name: 'my-planning', mode: 'planning' })]);

    await handlePlaybookCommand(pi as any, ctx as any, 'run my-planning');

    expect(pi.sendUserMessage).toHaveBeenCalledOnce();
    expect(pi.sendUserMessage).toHaveBeenCalledWith('/skill:eforge-playbook run my-planning');
  });

  it('does not offer active-build dependency prompts for a planning-mode playbook', async () => {
    // The planning-mode early-return at step 3 must fire before step 3b (queue check).
    // apiGetQueueIfRunning must never be reached.
    const pi = makePi();
    const ctx = makeCtx();

    mockPlaybookList([
      makeEntry({ name: 'my-planning', mode: 'planning' }),
      makeEntry({ name: 'my-feature', mode: 'autonomous' }),
    ]);

    const { apiGetQueueIfRunning } = await import('@eforge-build/client');

    await handlePlaybookCommand(pi as any, ctx as any, 'run my-planning');

    expect(pi.sendUserMessage).toHaveBeenCalledOnce();
    expect(pi.sendUserMessage).toHaveBeenCalledWith('/skill:eforge-playbook run my-planning');
    // Queue was never checked — planning-mode returned before step 3b
    expect(apiGetQueueIfRunning).not.toHaveBeenCalled();
  });
});
