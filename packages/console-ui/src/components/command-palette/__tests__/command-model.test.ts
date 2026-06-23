import { describe, expect, it } from 'vitest';
import type { ConsoleWorkstationManifestEntry, ExtensionContributionManifestResponse } from '@eforge-build/client/browser';
import {
  buildCommandPaletteModel,
  buildExtensionIntegrationCommands,
  classifySideEffects,
} from '../command-model';

function emptyManifest(overrides: Partial<ExtensionContributionManifestResponse> = {}): ExtensionContributionManifestResponse {
  return {
    schemaVersion: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    actions: [],
    consoleContributions: [],
    consoleWorkstations: [],
    integrationCommands: [],
    deepLinks: [],
    diagnostics: [],
    ...overrides,
  };
}

function action(id: string, overrides: Partial<ExtensionContributionManifestResponse['actions'][number]> = {}): ExtensionContributionManifestResponse['actions'][number] {
  return {
    id,
    localId: id,
    extensionName: 'demo-ext',
    extensionPath: '/extensions/demo',
    title: 'Demo action',
    inputSchema: { type: 'object' },
    sideEffects: ['none'],
    ...overrides,
  };
}

function command(
  id: string,
  actionId: string,
  overrides: Partial<ExtensionContributionManifestResponse['integrationCommands'][number]> = {},
): ExtensionContributionManifestResponse['integrationCommands'][number] {
  return {
    id,
    localId: id,
    extensionName: 'demo-ext',
    extensionPath: '/extensions/demo',
    label: `Run ${id}`,
    action: { actionId },
    ...overrides,
  };
}

function workstation(id: string, overrides: Partial<ConsoleWorkstationManifestEntry> = {}): ConsoleWorkstationManifestEntry {
  return {
    id,
    localId: id,
    extensionName: 'demo-ext',
    extensionPath: '/extensions/demo',
    title: id,
    schemaVersion: 1,
    srcDoc: '<p>demo</p>',
    allowedActions: [],
    ...overrides,
  } as ConsoleWorkstationManifestEntry;
}

describe('command palette model', () => {
  it('derives Navigation commands from first-party nav items', () => {
    const labels = buildCommandPaletteModel(undefined).navigationCommands.map((entry) => entry.label);
    expect(labels).toEqual(['Now', 'Workstations', 'System']);
  });

  it('derives workstation commands with encoded workstation ids', () => {
    const model = buildCommandPaletteModel(emptyManifest({
      consoleWorkstations: [workstation('demo:board', { title: 'Demo Board' })],
    }));
    expect(model.workstationCommands[0]).toMatchObject({
      label: 'Open Demo Board',
      href: '/console/workstations/demo%3Aboard',
    });
  });

  it('derives eforge-plan workstation subview paths', () => {
    const model = buildCommandPaletteModel(emptyManifest({
      consoleWorkstations: [workstation('eforge-plan', {
        title: 'Plan',
        subviews: [
          { id: 'roadmap', label: 'Roadmap', path: '?focus=roadmap' },
          { id: 'backlog', label: 'Backlog', subPath: '?focus=board' },
          { id: 'plans', label: 'Plans', path: '?focus=plans' },
        ],
      })],
    }));
    expect(model.workstationSubviewCommands.map((entry) => entry.href)).toEqual([
      '/console/workstations/eforge-plan?focus=roadmap',
      '/console/workstations/eforge-plan?focus=board',
      '/console/workstations/eforge-plan?focus=plans',
    ]);
  });

  it('includes an integration command with no required input', () => {
    const commands = buildExtensionIntegrationCommands(emptyManifest({
      actions: [action('demo.echo')],
      integrationCommands: [command('demo.run', 'demo.echo')],
    }));
    expect(commands).toHaveLength(1);
    expect(commands[0].input).toEqual({});
  });

  it('includes an integration command whose required fields are present in defaults', () => {
    const commands = buildExtensionIntegrationCommands(emptyManifest({
      actions: [action('demo.echo', { inputSchema: { type: 'object', required: ['message'] } })],
      integrationCommands: [command('demo.run', 'demo.echo', { action: { actionId: 'demo.echo', inputDefaults: { message: 'hi' } } })],
    }));
    expect(commands).toHaveLength(1);
    expect(commands[0].input).toEqual({ message: 'hi' });
  });

  it('excludes an integration command with a required field absent from defaults', () => {
    const commands = buildExtensionIntegrationCommands(emptyManifest({
      actions: [action('demo.echo', { inputSchema: { type: 'object', required: ['message'] } })],
      integrationCommands: [command('demo.run', 'demo.echo')],
    }));
    expect(commands).toHaveLength(0);
  });

  it('excludes unavailable integration commands', () => {
    const commands = buildExtensionIntegrationCommands(emptyManifest({
      actions: [action('demo.echo')],
      integrationCommands: [command('demo.run', 'demo.echo', { availability: { available: false, message: 'disabled' } })],
    }));
    expect(commands).toHaveLength(0);
  });

  it('excludes integration commands bound to unavailable actions', () => {
    const commands = buildExtensionIntegrationCommands(emptyManifest({
      actions: [action('demo.echo', { availability: { available: false, message: 'disabled' } })],
      integrationCommands: [command('demo.run', 'demo.echo')],
    }));
    expect(commands).toHaveLength(0);
  });

  it('resolves the bound action before side-effect classification', () => {
    const commands = buildExtensionIntegrationCommands(emptyManifest({
      actions: [action('demo.write', { sideEffects: ['network'] })],
      integrationCommands: [command('demo.run', 'demo.write')],
    }));
    expect(commands[0]).toMatchObject({ actionId: 'demo.write', sideEffectClasses: ['network'], requiresConfirmation: true });
  });

  it('classifies missing side-effect metadata as unknown and requiring confirmation', () => {
    expect(classifySideEffects(undefined)).toEqual({ sideEffectClasses: ['unknown'], requiresConfirmation: true });
  });

  it('classifies empty side-effect metadata as unknown and requiring confirmation', () => {
    expect(classifySideEffects([])).toEqual({ sideEffectClasses: ['unknown'], requiresConfirmation: true });
  });
});
