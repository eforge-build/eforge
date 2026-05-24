/**
 * Unit tests for the native Pi /eforge:build command handler.
 *
 * Verifies:
 *   1. Headless (no UI context): delegates directly to /skill:eforge-build with
 *      original args — no source, profile, or landing prompts.
 *   2. Explicit landing bypass: when args already contain an explicit landing override
 *      (--on-success / onSuccess), the landing selector is not invoked.
 *   3. Project-default selection: when the landing gate returns no onSuccess,
 *      the skill is called without any --on-success argument.
 *   4. Explicit landing forwarding: explicit onSuccess is appended to the skill call.
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

vi.mock('../packages/pi-eforge/extensions/eforge/ui-helpers.js', () => ({
  withLoader: vi.fn(async (_ctx: unknown, _msg: unknown, fn: () => unknown) => fn()),
  showInfoPanel: vi.fn(),
  showSelectPanel: vi.fn(),
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
  };
});

import { handleBuildCommand } from '../packages/pi-eforge/extensions/eforge/build-command.js';
import { promptForBuildLandingGate } from '../packages/pi-eforge/extensions/eforge/landing-gate.js';

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

function mockLandingGate(result: { onSuccess?: string; cancelled?: boolean; configUpdated?: boolean }) {
  (promptForBuildLandingGate as ReturnType<typeof vi.fn>).mockResolvedValue(result);
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

  it('does not call landing gate when args already contain --on-success', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    // --profile "fast" skips profile UI; --on-success is the existing explicit override
    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast" --on-success issue-pr');

    expect(promptForBuildLandingGate).not.toHaveBeenCalled();
  });

  it('forwards original args with explicit landing override to the skill', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast" --on-success leave-branch');

    expect(pi.sendUserMessage).toHaveBeenCalledOnce();
    const call = captureSkillCall(pi)!;
    expect(call).toContain('--on-success leave-branch');
    // explicit override must not be duplicated
    expect(call.match(/--on-success/g)).toHaveLength(1);
  });

  it('does not call landing gate when args already contain onSuccess keyword', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast" onSuccess=issue-pr');

    expect(promptForBuildLandingGate).not.toHaveBeenCalled();
  });

  it('does not call landing gate when args already contain landingAction keyword', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast" landingAction=leave-branch');

    expect(promptForBuildLandingGate).not.toHaveBeenCalled();
    expect(captureSkillCall(pi)).toContain('landingAction=leave-branch');
  });
});

// ---------------------------------------------------------------------------
// Tests: project-default selection (no onSuccess in enqueue body)
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

  it('calls the skill without --on-success when project-default is selected', async () => {
    const pi = makePi();
    const ctx = makeCtx();

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    expect(pi.sendUserMessage).toHaveBeenCalledOnce();
    const call = captureSkillCall(pi)!;
    expect(call).toContain('/skill:eforge-build');
    expect(call).not.toContain('--on-success');
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

  it('appends leave-branch override to skill call when explicitly selected', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    mockLandingGate({ onSuccess: 'leave-branch' });

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    const call = captureSkillCall(pi)!;
    expect(call).toContain('--on-success leave-branch');
  });

  it('appends issue-pr override to skill call when explicitly selected', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    mockLandingGate({ onSuccess: 'issue-pr' });

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    const call = captureSkillCall(pi)!;
    expect(call).toContain('--on-success issue-pr');
  });

  it('appends merge-to-base-branch override to skill call when explicitly selected', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    mockLandingGate({ onSuccess: 'merge-to-base-branch' });

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    const call = captureSkillCall(pi)!;
    expect(call).toContain('--on-success merge-to-base-branch');
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
    mockLandingGate({ onSuccess: 'leave-branch' });

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    const call = captureSkillCall(pi)!;
    // landing wire value must appear exactly once
    expect((call.match(/leave-branch/g) ?? []).length).toBe(1);
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
    mockLandingGate({ onSuccess: 'issue-pr' });

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    const call = captureSkillCall(pi)!;
    expect(call).toContain('--profile');
    expect(call).toContain('"fast"');
    expect(call).toContain('issue-pr');
  });

  it('profile arg survives a project-default landing selection (no --on-success added)', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    mockLandingGate({});

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    const call = captureSkillCall(pi)!;
    expect(call).toContain('--profile');
    expect(call).toContain('"fast"');
    expect(call).not.toContain('--on-success');
  });

  it('source arg survives landing selection alongside the profile', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    mockLandingGate({ onSuccess: 'leave-branch' });

    await handleBuildCommand(pi as any, ctx as any, '--infer --profile "fast"');

    const call = captureSkillCall(pi)!;
    expect(call).toContain('--infer');
    expect(call).toContain('--profile');
  });
});
