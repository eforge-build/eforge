/**
 * Unit tests for Pi playbook-commands planning-mode delegation and landing behavior.
 *
 * Verifies:
 *   - Planning-mode playbooks delegate to /skill:eforge-playbook run before landing/queue prompts.
 *   - Autonomous playbooks prompt for landing action and pass onSuccess to enqueue body.
 *   - Project-default selection (no onSuccess in gate result) omits onSuccess from enqueue body.
 *   - Explicit landing selection propagates to immediate, delayed, and fallback enqueue bodies.
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
import {
  apiPlaybookListIfRunning,
  apiPlaybookRunIfRunning,
  apiGetQueueIfRunning,
  type QueueItem,
} from '@eforge-build/client';
import { showSelectOverlay } from '../packages/pi-eforge/extensions/eforge/ui-helpers.js';

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

function mockQueueWithRunning(items: Partial<QueueItem>[] = []) {
  const defaultItem: QueueItem = {
    id: 'build-1',
    title: 'Running build',
    status: 'running',
  };
  const data = items.length > 0 ? items.map((i) => ({ ...defaultItem, ...i })) : [defaultItem];
  (apiGetQueueIfRunning as ReturnType<typeof vi.fn>).mockResolvedValue({
    status: 200,
    data,
  });
}

function mockPlaybookRun(id = 'run-1') {
  (apiPlaybookRunIfRunning as ReturnType<typeof vi.fn>).mockResolvedValue({
    status: 200,
    data: { kind: 'enqueued', id },
  });
}

function mockPlaybookRunFailThenSucceed(errorMsg = 'not found') {
  (apiPlaybookRunIfRunning as ReturnType<typeof vi.fn>)
    .mockRejectedValueOnce(new Error(errorMsg))
    .mockResolvedValueOnce({ status: 200, data: { kind: 'enqueued', id: 'run-2' } });
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

  it('prompts for landing action before checking active-build dependencies', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    mockPlaybookList([makeEntry({ name: 'my-feature', mode: 'autonomous' })]);
    mockLandingGate({ onSuccess: 'leave-branch' });
    mockQueueEmpty();
    mockPlaybookRun();

    await handlePlaybookCommand(pi as any, ctx as any, 'run my-feature');

    expect(promptForPlaybookLandingGate).toHaveBeenCalledOnce();
    expect(apiGetQueueIfRunning).toHaveBeenCalledOnce();
    expect(
      (promptForPlaybookLandingGate as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    ).toBeLessThan((apiGetQueueIfRunning as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]);
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

// ---------------------------------------------------------------------------
// Tests: project-default selection (no onSuccess key)
// ---------------------------------------------------------------------------

describe('Pi handlePlaybookCommand - project-default selection omits onSuccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueue body has no onSuccess key when landing gate returns no onSuccess', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    mockPlaybookList([makeEntry({ name: 'my-feature', mode: 'autonomous' })]);
    // No onSuccess returned = project default
    mockLandingGate({});
    mockQueueEmpty();
    mockPlaybookRun();

    await handlePlaybookCommand(pi as any, ctx as any, 'run my-feature');

    expect(apiPlaybookRunIfRunning).toHaveBeenCalledOnce();
    const call = (apiPlaybookRunIfRunning as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      body: Record<string, unknown>;
    };
    expect(call.body).toHaveProperty('name', 'my-feature');
    expect(call.body).not.toHaveProperty('onSuccess');
  });

  it('enqueue body has no onSuccess key for project-default when afterQueueId is set', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    mockPlaybookList([makeEntry({ name: 'my-feature', mode: 'autonomous' })]);
    mockLandingGate({});
    mockQueueWithRunning([{ id: 'build-1', title: 'Running build', status: 'running' }]);
    mockPlaybookRun();

    // Simulate user selecting wait-for + confirm
    (showSelectOverlay as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('build-1')  // wait choice: wait for build-1
      .mockResolvedValueOnce('confirm'); // confirm choice

    await handlePlaybookCommand(pi as any, ctx as any, 'run my-feature');

    expect(apiPlaybookRunIfRunning).toHaveBeenCalledOnce();
    const call = (apiPlaybookRunIfRunning as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      body: Record<string, unknown>;
    };
    expect(call.body).toHaveProperty('name', 'my-feature');
    expect(call.body).toHaveProperty('afterQueueId', 'build-1');
    expect(call.body).not.toHaveProperty('onSuccess');
  });

  it('fallback enqueue body has no onSuccess key for project-default when upstream build already finished', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    mockPlaybookList([makeEntry({ name: 'my-feature', mode: 'autonomous' })]);
    mockLandingGate({});
    mockQueueWithRunning([{ id: 'build-1', title: 'Running build', status: 'running' }]);
    mockPlaybookRunFailThenSucceed('not found');

    (showSelectOverlay as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('build-1')  // wait choice
      .mockResolvedValueOnce('confirm'); // confirm

    await handlePlaybookCommand(pi as any, ctx as any, 'run my-feature');

    expect(apiPlaybookRunIfRunning).toHaveBeenCalledTimes(2);
    const fallbackCall = (apiPlaybookRunIfRunning as ReturnType<typeof vi.fn>).mock.calls[1][0] as {
      body: Record<string, unknown>;
    };
    expect(fallbackCall.body).toHaveProperty('name', 'my-feature');
    expect(fallbackCall.body).not.toHaveProperty('afterQueueId');
    expect(fallbackCall.body).not.toHaveProperty('onSuccess');
  });
});

// ---------------------------------------------------------------------------
// Tests: explicit leave-branch propagation — immediate, delayed, fallback
// ---------------------------------------------------------------------------

describe('Pi handlePlaybookCommand - explicit leave-branch propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('propagates leave-branch to immediate enqueue body (no afterQueueId)', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    mockPlaybookList([makeEntry({ name: 'my-feature', mode: 'autonomous' })]);
    mockLandingGate({ onSuccess: 'leave-branch' });
    mockQueueEmpty();
    mockPlaybookRun();

    await handlePlaybookCommand(pi as any, ctx as any, 'run my-feature');

    const call = (apiPlaybookRunIfRunning as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      body: Record<string, unknown>;
    };
    expect(call.body).toHaveProperty('name', 'my-feature');
    expect(call.body).toHaveProperty('onSuccess', 'leave-branch');
    expect(call.body).not.toHaveProperty('afterQueueId');
  });

  it('propagates leave-branch to delayed enqueue body (with afterQueueId)', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    mockPlaybookList([makeEntry({ name: 'my-feature', mode: 'autonomous' })]);
    mockLandingGate({ onSuccess: 'leave-branch' });
    mockQueueWithRunning([{ id: 'build-1', title: 'Running build', status: 'running' }]);
    mockPlaybookRun();

    (showSelectOverlay as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('build-1')  // wait choice
      .mockResolvedValueOnce('confirm'); // confirm

    await handlePlaybookCommand(pi as any, ctx as any, 'run my-feature');

    expect(apiPlaybookRunIfRunning).toHaveBeenCalledOnce();
    const call = (apiPlaybookRunIfRunning as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      body: Record<string, unknown>;
    };
    expect(call.body).toHaveProperty('name', 'my-feature');
    expect(call.body).toHaveProperty('afterQueueId', 'build-1');
    expect(call.body).toHaveProperty('onSuccess', 'leave-branch');
  });

  it('propagates leave-branch to fallback enqueue body when upstream build is already finished', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    mockPlaybookList([makeEntry({ name: 'my-feature', mode: 'autonomous' })]);
    mockLandingGate({ onSuccess: 'leave-branch' });
    mockQueueWithRunning([{ id: 'build-1', title: 'Running build', status: 'running' }]);
    // First call (with afterQueueId) fails with 404; second (fallback) succeeds
    mockPlaybookRunFailThenSucceed('not found');

    (showSelectOverlay as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('build-1')  // wait choice
      .mockResolvedValueOnce('confirm'); // confirm

    await handlePlaybookCommand(pi as any, ctx as any, 'run my-feature');

    // Two calls were made: the first failed, the second (fallback) should carry leave-branch
    expect(apiPlaybookRunIfRunning).toHaveBeenCalledTimes(2);
    const fallbackCall = (apiPlaybookRunIfRunning as ReturnType<typeof vi.fn>).mock.calls[1][0] as {
      body: Record<string, unknown>;
    };
    expect(fallbackCall.body).toHaveProperty('name', 'my-feature');
    expect(fallbackCall.body).toHaveProperty('onSuccess', 'leave-branch');
    // Fallback is an immediate enqueue — no afterQueueId
    expect(fallbackCall.body).not.toHaveProperty('afterQueueId');
  });
});
