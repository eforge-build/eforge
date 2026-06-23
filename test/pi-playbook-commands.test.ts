import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockInvokePlaybookContributionIfRunning, mockPromptForPlaybookLandingGate, mockShowInfoPanel } = vi.hoisted(() => ({
  mockInvokePlaybookContributionIfRunning: vi.fn(),
  mockPromptForPlaybookLandingGate: vi.fn(),
  mockShowInfoPanel: vi.fn(),
}));

vi.mock('../packages/pi-eforge/extensions/eforge/playbook-contributions.js', () => ({
  eforgePlaybooksUnavailableMessage: (message: string) => `unavailable: ${message}`,
  invokePlaybookContributionIfRunning: mockInvokePlaybookContributionIfRunning,
}));

vi.mock('../packages/pi-eforge/extensions/eforge/landing-gate.js', () => ({
  promptForPlaybookLandingGate: mockPromptForPlaybookLandingGate,
}));

vi.mock('../packages/pi-eforge/extensions/eforge/ui-helpers.js', () => ({
  showInfoPanel: mockShowInfoPanel,
}));

import { handlePlaybookCommand, registerPlaybookCommand } from '../packages/pi-eforge/extensions/eforge/playbook-commands.js';
import { promptForPlaybookLandingGate } from '../packages/pi-eforge/extensions/eforge/landing-gate.js';
import { invokePlaybookContributionIfRunning } from '../packages/pi-eforge/extensions/eforge/playbook-contributions.js';
import { showInfoPanel } from '../packages/pi-eforge/extensions/eforge/ui-helpers.js';

function makeCtx() {
  return {
    cwd: '/workspace/project',
    hasUI: true,
    ui: {
      custom: vi.fn(),
      setStatus: vi.fn(),
    },
  };
}

function makePi() {
  return {
    registerCommand: vi.fn(),
    sendUserMessage: vi.fn(),
  };
}

function mockContributionSuccess() {
  mockInvokePlaybookContributionIfRunning.mockResolvedValue({
    target: {
      kind: 'command',
      id: 'eforge-playbooks:run-playbook',
      label: 'Run playbook',
      extensionName: 'eforge-playbooks',
      extensionPath: '/extensions/eforge-playbooks',
      actionId: 'run-playbook',
      requestedBy: { host: 'pi' },
      input: {},
      outputProfile: 'markdown',
    },
    response: {
      ok: true,
      output: 'queued',
    },
  });
}

describe('Pi playbook command contribution routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContributionSuccess();
  });

  it('routes planning-mode playbook runs through the registered command without prompting for landing', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    registerPlaybookCommand(pi as any, () => ctx as any);

    const registration = pi.registerCommand.mock.calls[0];
    expect(registration?.[0]).toBe('eforge:playbook');

    await registration[1].handler('run docs-sync --mode planning', ctx);

    expect(promptForPlaybookLandingGate).not.toHaveBeenCalled();
    expect(invokePlaybookContributionIfRunning).toHaveBeenCalledWith({
      cwd: '/workspace/project',
      action: 'run',
      input: {
        name: 'docs-sync',
        mode: 'planning',
      },
    });
  });

  it('prompts for autonomous run landing and forwards enqueue options as contribution input', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    mockPromptForPlaybookLandingGate.mockResolvedValue({ landingAction: 'pr', landingAutoMerge: true });

    await handlePlaybookCommand(pi as any, ctx as any, 'run docs-sync --after-queue-id q-123 --landing-action merge --landing-auto-merge false');

    expect(promptForPlaybookLandingGate).toHaveBeenCalledWith(pi, ctx);
    expect(invokePlaybookContributionIfRunning).toHaveBeenCalledWith({
      cwd: '/workspace/project',
      action: 'run',
      input: {
        name: 'docs-sync',
        afterQueueId: 'q-123',
        landingAction: 'pr',
        landingAutoMerge: true,
      },
    });
  });

  it('does not invoke the contribution when landing selection is cancelled', async () => {
    const pi = makePi();
    const ctx = makeCtx();
    mockPromptForPlaybookLandingGate.mockResolvedValue({ cancelled: true });

    await handlePlaybookCommand(pi as any, ctx as any, 'run docs-sync --after-queue-id q-123');

    expect(promptForPlaybookLandingGate).toHaveBeenCalledOnce();
    expect(invokePlaybookContributionIfRunning).not.toHaveBeenCalled();
    expect(showInfoPanel).toHaveBeenCalledWith(ctx, 'eforge playbook', 'Playbook run cancelled before enqueue.');
  });
});
