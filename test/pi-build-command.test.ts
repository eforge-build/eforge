/**
 * Unit tests for the native Pi /eforge:build command handler.
 *
 * Verifies:
 *   1. Headless (no UI context): delegates directly to /skill:eforge-build with
 *      original args — no source, profile, or landing prompts.
 *   2. Explicit landing bypass: when args already contain an explicit landing override
 *      (--landing-action), the landing selector is not invoked.
 *   3. Project-default selection: when the landing gate returns no landingAction,
 *      the skill is called without any --landing-action argument.
 *   4. Explicit landing forwarding: explicit landingAction is appended to the skill call.
 *   5. Profile override preservation: --profile argument survives the landing step.
 *   6. Cancelled landing gate: skill is not called when the user cancels.
 *
 * Pi framework peer deps are avoided by mocking ui-helpers entirely.
 * The landing gate is mocked at the module level to isolate command routing from UI.
 *
 * NOTE: These tests exercise behavior added by this plan (Unified Pi Landing-Action UX).
 * Until handleBuildCommand is updated to call promptForBuildLandingGate, the
 * landing-selector tests will fail — that is expected.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Pi TUI helpers — avoids loading @earendil-works/pi-tui peer dep
// ---------------------------------------------------------------------------

// vi.hoisted ensures this is available when the vi.mock factory runs (hoisted above imports).
const { mockShowSelectPanel } = vi.hoisted(() => ({
  mockShowSelectPanel: vi.fn(),
}));

vi.mock('../packages/pi-eforge/extensions/eforge/ui-helpers.js', () => ({
  withLoader: vi.fn(async (_ctx: unknown, _msg: unknown, fn: () => unknown) => fn()),
  showInfoPanel: vi.fn(),
  showSelectPanel: mockShowSelectPanel,
  showSearchableSelectPanel: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock landing gate — decouples build-command routing from Pi UI internals
// ---------------------------------------------------------------------------

vi.mock('../packages/pi-eforge/extensions/eforge/landing-gate.js', () => ({
  promptForBuildLandingGate: vi.fn(),
  promptForPlaybookLandingGate: vi.fn(),
  promptForLandingSelection: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock daemon client calls — no live daemon needed
// ---------------------------------------------------------------------------

vi.mock('@eforge-build/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@eforge-build/client')>();
  return {
    ...actual,
    apiListProfilesIfRunning: vi.fn(),
    apiSessionPlanListIfRunning: vi.fn(),
    apiGetQueueIfRunning: vi.fn(),
  };
});

import { handleBuildCommand } from '../packages/pi-eforge/extensions/eforge/build-command.js';
import { promptForBuildLandingGate } from '../packages/pi-eforge/extensions/eforge/landing-gate.js';
import { apiGetQueueIfRunning } from '@eforge-build/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: { hasUI?: boolean; cwd?: string } = {}) {
  return {
    cwd: overrides.cwd ?? '/project',
    hasUI: overrides.hasUI ?? true,
    ui: {
      custom: vi.fn(),
      setStatus: vi.fn(),
      input: vi.fn(),
      editor: vi.fn(),
    },
  };
}

function makePi() {
  return { sendUserMessage: vi.fn() };
}

/**
 * Returns the first argument passed to pi.sendUserMessage, or undefined if not called.
 */
function captureSkillCall(pi: ReturnType<typeof makePi>): string | undefined {
  const calls = (pi.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls;
  return calls.length > 0 ? (calls[0][0] as string) : undefined;
}

function mockLandingGate(result: { landingAction?: string; cancelled?: boolean; configUpdated?: boolean; landingAutoMerge?: boolean }) {
  (promptForBuildLandingGate as ReturnType<typeof vi.fn>).mockResolvedValue(result);
}

function mockQueue(items: Array<{ id: string; title: string; status: string }>) {
  (apiGetQueueIfRunning as ReturnType<typeof vi.fn>).mockResolvedValue({ data: items });
}

function mockQueueEmpty() {
  (apiGetQueueIfRunning as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
}

// ---------------------------------------------------------------------------
// Tests: headless fallback
// ---------------------------------------------------------------------------

describe('handleBuildCommand - headless fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to skill with original args when ctx is null', async () => {
    const pi = makePi();
    await handleBuildCommand(pi as any, null, '--infer');

    expect(pi.sendUserMessage).toHaveBeenCalledOnce();
    expect(captureSkillCall(pi)).toBe('/skill:eforge-build --infer');
    expect(promptForBuildLandingGate).not.toHaveBeenCalled();
  });

  it('delegates to skill with original args when hasUI is false', async () => {
    const pi = makePi();
    const ctx = makeCtx({ hasUI: false });

    await handleBuildCommand(pi as any, ctx as any, '--infer');

    expect(pi.sendUserMessage).toHaveBeenCalledOnce();
    expect(captureSkillCall(pi)).toBe('/skill:eforge-build --infer');
    expect(promptForBuildLandingGate).not.toHaveBeenCalled();
  });

  it('delegates with empty args in headless mode', async () => {
    const pi = makePi();
    await handleBuildCommand(pi as any, null, '');

    expect(pi.sendUserMessage).toHaveBeenCalledOnce();
    expect(captureSkillCall(pi)).toBe('/skill:eforge-build');
  });

  it('does not invoke the landing gate when headless', async () => {
    const pi = makePi();
    await handleBuildCommand(pi as any, null, '--infer');
    expect(promptForBuildLandingGate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: explicit landing argument bypass
// ---------------------------------------------------------------------------

describe('handleBuildCommand - explicit landing argument bypass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not call landing gate when args already contain --landing-action', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast" --landing-action pr');

    expect(promptForBuildLandingGate).not.toHaveBeenCalled();
  });

  it('forwards original args with explicit landing override to the skill', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast" --landing-action leave');

    expect(pi.sendUserMessage).toHaveBeenCalledOnce();
    const call = captureSkillCall(pi)!;
    expect(call).toContain('--landing-action leave');
    // explicit override must not be duplicated
    expect(call.match(/--landing-action/g)).toHaveLength(1);
  });

  it('does not call landing gate when args already contain landingAction keyword', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast" landingAction=leave');

    expect(promptForBuildLandingGate).not.toHaveBeenCalled();
    expect(captureSkillCall(pi)).toContain('landingAction=leave');
  });
});

// ---------------------------------------------------------------------------
// Tests: project-default selection (no landingAction in enqueue body)
// ---------------------------------------------------------------------------

describe('handleBuildCommand - project-default selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Return empty LandingGateResult — project default, no explicit override
    mockLandingGate({});
  });

  it('calls the landing gate when UI is available and no explicit landing in args', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    expect(promptForBuildLandingGate).toHaveBeenCalledOnce();
  });

  it('calls the skill without --landing-action when project-default is selected', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    expect(pi.sendUserMessage).toHaveBeenCalledOnce();
    const call = captureSkillCall(pi)!;
    expect(call).toContain('/skill:eforge-build');
    expect(call).not.toContain('--landing-action');
  });

  it('calls the skill exactly once for project-default selection', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    expect(pi.sendUserMessage).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Tests: explicit landing selection forwarding
// ---------------------------------------------------------------------------

describe('handleBuildCommand - explicit landing selection forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('appends leave override to skill call when explicitly selected', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    mockLandingGate({ landingAction: 'leave' });

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    const call = captureSkillCall(pi)!;
    expect(call).toContain('--landing-action leave');
  });

  it('appends pr override to skill call when explicitly selected', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    mockLandingGate({ landingAction: 'pr' });

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    const call = captureSkillCall(pi)!;
    expect(call).toContain('--landing-action pr');
  });

  it('appends merge override to skill call when explicitly selected', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    mockLandingGate({ landingAction: 'merge' });

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    const call = captureSkillCall(pi)!;
    expect(call).toContain('--landing-action merge');
  });

  it('does not call skill when landing gate returns cancelled', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    mockLandingGate({ cancelled: true });

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    expect(pi.sendUserMessage).not.toHaveBeenCalled();
  });

  it('appends the explicit override only once to the skill call', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    mockLandingGate({ landingAction: 'leave' });

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    const call = captureSkillCall(pi)!;
    // canonical value must appear exactly once
    expect((call.match(/\bleave\b/g) ?? []).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: profile override preservation
// ---------------------------------------------------------------------------

describe('handleBuildCommand - profile override preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('profile arg survives an explicit landing selection', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    mockLandingGate({ landingAction: 'pr' });

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    const call = captureSkillCall(pi)!;
    expect(call).toContain('--profile');
    expect(call).toContain('"fast"');
    expect(call).toContain('pr');
  });

  it('profile arg survives a project-default landing selection (no --landing-action added)', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    mockLandingGate({});

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    const call = captureSkillCall(pi)!;
    expect(call).toContain('--profile');
    expect(call).toContain('"fast"');
    expect(call).not.toContain('--landing-action');
  });

  it('source arg survives landing selection alongside the profile', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    mockLandingGate({ landingAction: 'leave' });

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    const call = captureSkillCall(pi)!;
    expect(call).toContain('--infer');
    expect(call).toContain('--profile');
  });
});


// ---------------------------------------------------------------------------
// Tests: active-build wait selection (--after <queue-id>)
// ---------------------------------------------------------------------------

describe('handleBuildCommand - active-build wait selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLandingGate({});
  });

  it('skips active-build selector when queue is empty', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    mockQueueEmpty();

    // Use --profile to bypass profile selection (not the concern of this test)
    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    expect(pi.sendUserMessage).toHaveBeenCalledOnce();
    const call = captureSkillCall(pi)!;
    expect(call).not.toContain('--after');
    // showSelectPanel should not be called for active-build (only for profile/source which are mocked out)
  });

  it('appends --after <id> when user selects an active build to wait for', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    mockQueue([{ id: 'q-abc123', title: 'Add rate limiting', status: 'running' }]);
    // Simulate user selecting the active build (returns the queue id)
    mockShowSelectPanel.mockResolvedValueOnce('q-abc123');

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    expect(pi.sendUserMessage).toHaveBeenCalledOnce();
    const call = captureSkillCall(pi)!;
    expect(call).toContain('--after');
    expect(call).toContain('"q-abc123"');
  });

  it('omits --after when user selects "Run now"', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    mockQueue([{ id: 'q-abc123', title: 'Add rate limiting', status: 'running' }]);
    // Simulate user selecting "Run now"
    mockShowSelectPanel.mockResolvedValueOnce('__now__');

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    expect(pi.sendUserMessage).toHaveBeenCalledOnce();
    const call = captureSkillCall(pi)!;
    expect(call).not.toContain('--after');
  });

  it('does not call skill when user cancels the active-build selector', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    mockQueue([{ id: 'q-abc123', title: 'Add rate limiting', status: 'running' }]);
    // Simulate user cancelling (returns null/undefined)
    mockShowSelectPanel.mockResolvedValueOnce(null);

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    expect(pi.sendUserMessage).not.toHaveBeenCalled();
  });

  it('preserves --profile and --landing-action alongside --after', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    mockLandingGate({ landingAction: 'pr' });
    mockQueue([{ id: 'q-xyz', title: 'Feature B', status: 'pending' }]);
    mockShowSelectPanel.mockResolvedValueOnce('q-xyz');

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    const call = captureSkillCall(pi)!;
    expect(call).toContain('--profile');
    expect(call).toContain('"fast"');
    expect(call).toContain('--landing-action pr');
    expect(call).toContain('--after');
    expect(call).toContain('"q-xyz"');
  });

  it('bypasses active-build selector when --after is already in args', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    mockQueue([{ id: 'q-abc', title: 'Active build', status: 'running' }]);
    // --after already in args from headless/scripted caller; --profile bypasses profile selection
    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast" --after "q-already"');

    // Active-build selector should not be shown (mockShowSelectPanel not called for dependency)
    // The call should pass through with the existing --after
    const call = captureSkillCall(pi);
    expect(call).toContain('--after');
    expect(call).toContain('q-already');
  });

  it('does not show active-build selector in headless mode', async () => {
    const pi = makePi();
    mockQueue([{ id: 'q-abc', title: 'Active build', status: 'running' }]);

    await handleBuildCommand(pi as any, null, '--infer');

    // headless: sends skill directly, no UI prompts
    expect(pi.sendUserMessage).toHaveBeenCalledOnce();
    expect(captureSkillCall(pi)).toBe('/skill:eforge-build --infer');
  });
});



// ---------------------------------------------------------------------------
// Tests: PR auto-merge selection forwarding
// ---------------------------------------------------------------------------

describe('handleBuildCommand - PR auto-merge selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Plan-03 added selectActiveBuildsForDependency to all UI paths; mock the queue as empty
    // so tests focused on landing/auto-merge behavior are not affected by the dependency selector.
    mockQueueEmpty();
  });

  it('appends --landing-auto-merge when gate returns landingAutoMerge: true', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    mockLandingGate({ landingAction: 'pr', landingAutoMerge: true });

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    const call = captureSkillCall(pi)!;
    expect(call).toContain('--landing-action pr');
    expect(call).toContain('--landing-auto-merge');
    expect(call).not.toContain('--no-landing-auto-merge');
  });

  it('appends --no-landing-auto-merge when gate returns landingAutoMerge: false', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    mockLandingGate({ landingAction: 'pr', landingAutoMerge: false });

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    const call = captureSkillCall(pi)!;
    expect(call).toContain('--landing-action pr');
    expect(call).toContain('--no-landing-auto-merge');
    expect(call).not.toContain('--landing-auto-merge ');
  });

  it('appends neither auto-merge flag when gate returns no landingAutoMerge', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    mockLandingGate({ landingAction: 'pr' });

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    const call = captureSkillCall(pi)!;
    expect(call).not.toContain('--landing-auto-merge');
    expect(call).not.toContain('--no-landing-auto-merge');
  });

  it('does not call landing gate when args already contain --landing-auto-merge', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast" --landing-auto-merge');

    expect(promptForBuildLandingGate).not.toHaveBeenCalled();
    const call = captureSkillCall(pi)!;
    expect(call).toContain('--landing-auto-merge');
  });

  it('does not call landing gate when args already contain --no-landing-auto-merge', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast" --no-landing-auto-merge');

    expect(promptForBuildLandingGate).not.toHaveBeenCalled();
    const call = captureSkillCall(pi)!;
    expect(call).toContain('--no-landing-auto-merge');
  });
});

