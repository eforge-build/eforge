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
// Mock landing gate — decouples command routing tests from Pi UI internals
// ---------------------------------------------------------------------------

vi.mock('../packages/pi-eforge/extensions/eforge/landing-gate.js', () => ({
  promptForPlaybookLandingGate: vi.fn(),
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
import { promptForPlaybookLandingGate } from '../packages/pi-eforge/extensions/eforge/landing-gate.js';
import { apiPlaybookListIfRunning, apiPlaybookRunIfRunning, apiGetQueueIfRunning } from '@eforge-build/client';

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

function mockLandingGate(result: { onSuccess?: string; cancelled?: boolean; configUpdated?: boolean }) {
  (promptForPlaybookLandingGate as ReturnType<typeof vi.fn>).mockResolvedValue(result);
}

function mockQueueEmpty() {
  (apiGetQueueIfRunning as ReturnType<typeof vi.fn>).mockResolvedValue({
    status: 200,
    data: [],
  });
}

function mockPlaybookRun(id = 'run-1') {
  (apiPlaybookRunIfRunning as ReturnType<typeof vi.fn>).mockResolvedValue({
    status: 200,
    data: { kind: 'enqueued', id },
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

    await handlePlaybookCommand(pi as any, ctx as any, 'run my-planning');

    expect(pi.sendUserMessage).toHaveBeenCalledOnce();
    expect(pi.sendUserMessage).toHaveBeenCalledWith('/skill:eforge-playbook run my-planning');
    // Queue was never checked — planning-mode returned before step 3b
    expect(apiGetQueueIfRunning).not.toHaveBeenCalled();
  });

  it('does not call the landing gate for a planning-mode playbook', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    mockPlaybookList([makeEntry({ name: 'my-planning', mode: 'planning' })]);

    await handlePlaybookCommand(pi as any, ctx as any, 'run my-planning');

    expect(promptForPlaybookLandingGate).not.toHaveBeenCalled();
  });
});

describe('Pi handlePlaybookCommand - autonomous playbook landing gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prompts for landing action before enqueueing an autonomous playbook', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    mockPlaybookList([makeEntry({ name: 'my-feature', mode: 'autonomous' })]);
    mockLandingGate({ onSuccess: 'leave-branch' });
    mockQueueEmpty();
    mockPlaybookRun();

    await handlePlaybookCommand(pi as any, ctx as any, 'run my-feature');

    expect(promptForPlaybookLandingGate).toHaveBeenCalledOnce();
  });

  it('passes selected onSuccess to apiPlaybookRunIfRunning', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    mockPlaybookList([makeEntry({ name: 'my-feature', mode: 'autonomous' })]);
    mockLandingGate({ onSuccess: 'leave-branch' });
    mockQueueEmpty();
    mockPlaybookRun();

    await handlePlaybookCommand(pi as any, ctx as any, 'run my-feature');

    expect(apiPlaybookRunIfRunning).toHaveBeenCalledOnce();
    expect(apiPlaybookRunIfRunning).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ name: 'my-feature', onSuccess: 'leave-branch' }),
      }),
    );
  });

  it('makes zero apiPlaybookRunIfRunning calls when landing gate is cancelled', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    mockPlaybookList([makeEntry({ name: 'my-feature', mode: 'autonomous' })]);
    mockLandingGate({ cancelled: true });

    await handlePlaybookCommand(pi as any, ctx as any, 'run my-feature');

    expect(apiPlaybookRunIfRunning).not.toHaveBeenCalled();
  });

  it('makes zero queue checks when landing gate is cancelled', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    mockPlaybookList([makeEntry({ name: 'my-feature', mode: 'autonomous' })]);
    mockLandingGate({ cancelled: true });

    await handlePlaybookCommand(pi as any, ctx as any, 'run my-feature');

    expect(apiGetQueueIfRunning).not.toHaveBeenCalled();
  });
});
