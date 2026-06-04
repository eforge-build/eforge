/**
 * Unit tests for Pi playbook-commands planning-mode delegation and landing behavior.
 *
 * Verifies:
 *   - Planning-mode playbooks delegate to /skill:eforge-playbook run before landing/queue prompts.
 *   - Autonomous playbooks prompt for landing action and pass landingAction to enqueue body.
 *   - Project-default selection (no landingAction in gate result) omits landingAction from enqueue body.
 *   - Explicit landing selection propagates to immediate, delayed, and fallback enqueue bodies.
 *
 * Pi framework peer deps are avoided by mocking ui-helpers entirely.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PlaybookListEntry, PlaybookRunRequest } from '@eforge-build/client';

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
import { promptForPlaybookLandingGate, type LandingGateResult } from '../packages/pi-eforge/extensions/eforge/landing-gate.js';
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

type EnqueuePath = 'immediate' | 'delayed' | 'fallback';

type ExpectedEnqueueBody = Pick<PlaybookRunRequest, 'name' | 'afterQueueId' | 'landingAction' | 'landingAutoMerge'>;

function mockLandingGate(result: LandingGateResult) {
  (promptForPlaybookLandingGate as ReturnType<typeof vi.fn>).mockResolvedValue(result);
}

function queueItems(items: Partial<QueueItem>[] = []): QueueItem[] {
  const defaultItem: QueueItem = {
    id: 'build-1',
    title: 'Running build',
    status: 'running',
  };
  return items.length > 0 ? items.map((i) => ({ ...defaultItem, ...i })) : [defaultItem];
}

function mockQueueState(path: EnqueuePath) {
  (apiGetQueueIfRunning as ReturnType<typeof vi.fn>).mockResolvedValue({
    status: 200,
    data: path === 'immediate' ? [] : queueItems([{ id: 'build-1', title: 'Running build', status: 'running' }]),
  });
}

function mockQueueEmpty() {
  mockQueueState('immediate');
}

function mockPlaybookRun(id = 'run-1') {
  (apiPlaybookRunIfRunning as ReturnType<typeof vi.fn>).mockResolvedValue({
    status: 200,
    data: { kind: 'enqueued', id },
  });
}

function mockEnqueueBehavior(path: EnqueuePath) {
  if (path === 'fallback') {
    (apiPlaybookRunIfRunning as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce({ status: 200, data: { kind: 'enqueued', id: 'run-2' } });
    return;
  }
  mockPlaybookRun();
}

function selectDelayedUpstream(path: EnqueuePath) {
  if (path === 'immediate') return;
  (showSelectOverlay as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce('build-1')
    .mockResolvedValueOnce('confirm');
}

async function runAutonomousScenario(path: EnqueuePath, landingGateResult: LandingGateResult) {
  const pi = makePi();
  const ctx = makeCtx();

  mockPlaybookList([makeEntry({ name: 'my-feature', mode: 'autonomous' })]);
  mockLandingGate(landingGateResult);
  mockQueueState(path);
  mockEnqueueBehavior(path);
  selectDelayedUpstream(path);

  await handlePlaybookCommand(pi as any, ctx as any, 'run my-feature');
}

function expectEnqueueBody(callIndex: number, expected: ExpectedEnqueueBody, omittedKeys: string[] = []) {
  const call = (apiPlaybookRunIfRunning as ReturnType<typeof vi.fn>).mock.calls[callIndex][0] as {
    body: Record<string, unknown>;
  };
  expect(call.body).toEqual(expect.objectContaining(expected));
  for (const key of omittedKeys) {
    expect(call.body).not.toHaveProperty(key);
  }
}

function expectedBody(path: EnqueuePath, body: Omit<ExpectedEnqueueBody, 'name' | 'afterQueueId'> = {}): ExpectedEnqueueBody {
  return {
    name: 'my-feature',
    ...(path === 'delayed' && { afterQueueId: 'build-1' }),
    ...body,
  };
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
    mockLandingGate({ landingAction: 'leave' });
    mockQueueEmpty();
    mockPlaybookRun();

    await handlePlaybookCommand(pi as any, ctx as any, 'run my-feature');

    expect(promptForPlaybookLandingGate).toHaveBeenCalledOnce();
  });

  it('prompts for landing action before checking active-build dependencies', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    mockPlaybookList([makeEntry({ name: 'my-feature', mode: 'autonomous' })]);
    mockLandingGate({ landingAction: 'leave' });
    mockQueueEmpty();
    mockPlaybookRun();

    await handlePlaybookCommand(pi as any, ctx as any, 'run my-feature');

    expect(promptForPlaybookLandingGate).toHaveBeenCalledOnce();
    expect(apiGetQueueIfRunning).toHaveBeenCalledOnce();
    expect(
      (promptForPlaybookLandingGate as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    ).toBeLessThan((apiGetQueueIfRunning as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]);
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
// Tests: project-default selection (no landingAction key)
// ---------------------------------------------------------------------------

describe('Pi handlePlaybookCommand - project-default selection omits landingAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    { scenario: 'immediate enqueue', path: 'immediate' as const, callCount: 1, callIndex: 0, omitted: ['landingAction', 'afterQueueId'] },
    { scenario: 'delayed enqueue', path: 'delayed' as const, callCount: 1, callIndex: 0, omitted: ['landingAction'] },
    { scenario: 'stale-upstream fallback enqueue', path: 'fallback' as const, callCount: 2, callIndex: 1, omitted: ['landingAction', 'afterQueueId'] },
  ])('enqueue body has no landingAction key for project-default $scenario', async ({ path, callCount, callIndex, omitted }) => {
    await runAutonomousScenario(path, {});

    expect(apiPlaybookRunIfRunning).toHaveBeenCalledTimes(callCount);
    if (path === 'fallback') {
      expectEnqueueBody(0, { name: 'my-feature', afterQueueId: 'build-1' }, ['landingAction', 'landingAutoMerge']);
    }
    expectEnqueueBody(callIndex, expectedBody(path), omitted);
  });
});

// ---------------------------------------------------------------------------
// Tests: explicit leave propagation — immediate, delayed, fallback
// ---------------------------------------------------------------------------

describe('Pi handlePlaybookCommand - explicit leave propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    { scenario: 'immediate enqueue body', path: 'immediate' as const, callCount: 1, callIndex: 0, omitted: ['afterQueueId'] },
    { scenario: 'delayed enqueue body', path: 'delayed' as const, callCount: 1, callIndex: 0, omitted: [] },
    { scenario: 'stale-upstream fallback body', path: 'fallback' as const, callCount: 2, callIndex: 1, omitted: ['afterQueueId'] },
  ])('propagates leave to $scenario', async ({ path, callCount, callIndex, omitted }) => {
    await runAutonomousScenario(path, { landingAction: 'leave' });

    expect(apiPlaybookRunIfRunning).toHaveBeenCalledTimes(callCount);
    if (path === 'fallback') {
      expectEnqueueBody(0, { name: 'my-feature', afterQueueId: 'build-1', landingAction: 'leave' }, ['landingAutoMerge']);
    }
    expectEnqueueBody(callIndex, expectedBody(path, { landingAction: 'leave' }), omitted);
  });
});


// ---------------------------------------------------------------------------
// Tests: landingAutoMerge propagation — immediate, delayed, fallback
// ---------------------------------------------------------------------------

describe('Pi handlePlaybookCommand - landingAutoMerge propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    { scenario: 'immediate enqueue body', path: 'immediate' as const, callCount: 1, callIndex: 0, omitted: ['afterQueueId'] },
    { scenario: 'delayed enqueue body', path: 'delayed' as const, callCount: 1, callIndex: 0, omitted: [] },
    { scenario: 'stale-upstream fallback body', path: 'fallback' as const, callCount: 2, callIndex: 1, omitted: ['afterQueueId'] },
  ])('propagates landingAutoMerge: true to $scenario', async ({ path, callCount, callIndex, omitted }) => {
    await runAutonomousScenario(path, { landingAction: 'pr', landingAutoMerge: true });

    expect(apiPlaybookRunIfRunning).toHaveBeenCalledTimes(callCount);
    if (path === 'fallback') {
      expectEnqueueBody(0, {
        name: 'my-feature',
        afterQueueId: 'build-1',
        landingAction: 'pr',
        landingAutoMerge: true,
      });
    }
    expectEnqueueBody(
      callIndex,
      expectedBody(path, { landingAction: 'pr', landingAutoMerge: true }),
      omitted,
    );
  });

  it('omits landingAutoMerge from enqueue body when gate returns no landingAutoMerge', async () => {
    await runAutonomousScenario('immediate', { landingAction: 'leave' });

    expect(apiPlaybookRunIfRunning).toHaveBeenCalledOnce();
    expectEnqueueBody(0, expectedBody('immediate', { landingAction: 'leave' }), ['afterQueueId', 'landingAutoMerge']);
  });
});

