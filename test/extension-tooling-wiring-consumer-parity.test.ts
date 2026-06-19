// --- eforge:region extension-tooling-wiring-consumer-parity ---
/**
 * Split static wiring tests for native extension tooling surfaces.
 */

import { describe, it, expect } from 'vitest';
import { API_ROUTES, EFORGE_EXTENSION_ACTIONS, dispatchEforgeExtensionAction, type EforgeExtensionAction, type EforgeExtensionActionHelpers, type EforgeExtensionActionParams } from '@eforge-build/client';
import { createProgram } from '../packages/eforge/src/cli/index.js';
import { escapeRegExp, readRepoFile } from './extension-tooling-wiring-helpers.js';
describe('Claude Code plugin metadata', () => {
  it('bumps the plugin version when extension skill guidance changes', () => {
    const pluginManifest = JSON.parse(readRepoFile('eforge-plugin/.claude-plugin/plugin.json')) as { version: string };
    expect(pluginManifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    const [major, minor, patch] = pluginManifest.version.split('.').map(Number) as [number, number, number];
    expect(major * 1_000_000 + minor * 1_000 + patch).toBeGreaterThan(25_008);
  });
});

describe('MCP/Pi eforge_extension parity', () => {
  const mcpSource = readRepoFile('packages/eforge/src/cli/mcp-proxy.ts');
  const piSource = readRepoFile('packages/pi-eforge/extensions/eforge/index.ts');
  const dispatcherSource = readRepoFile('packages/client/src/api/extension-tool-dispatch.ts');
  const clientIndexSource = readRepoFile('packages/client/src/index.ts');
  const dispatcherContractNames = [
    'dispatchEforgeExtensionAction',
    'EFORGE_EXTENSION_ACTIONS',
    'EforgeExtensionAction',
    'EforgeExtensionActionParams',
    'EforgeExtensionActionHelpers',
  ];

  function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function mcpExtensionBlock(): string {
    const blockStart = mcpSource.indexOf("name: 'eforge_extension'");
    const blockEnd = mcpSource.indexOf("name: 'eforge_models'", blockStart);
    expect(blockEnd).toBeGreaterThan(blockStart);
    return mcpSource.slice(blockStart, blockEnd);
  }

  function piExtensionBlock(): string {
    const blockStart = piSource.indexOf('name: "eforge_extension"');
    const blockEnd = piSource.indexOf('name: "eforge_models"', blockStart);
    expect(blockEnd).toBeGreaterThan(blockStart);
    return piSource.slice(blockStart, blockEnd);
  }

  function expectHelperMapping(source: string, tableName: string, mappings: Record<string, string>): void {
    const start = source.indexOf(`const ${tableName} = {`);
    expect(start, tableName).toBeGreaterThanOrEqual(0);
    const end = source.indexOf('} satisfies EforgeExtensionActionHelpers;', start);
    expect(end, tableName).toBeGreaterThan(start);
    const block = source.slice(start, end);
    for (const [action, helper] of Object.entries(mappings)) {
      expect(block, `${tableName}.${action}`).toMatch(new RegExp(`${action}:\\s*${helper}\\b`));
    }
  }

  const requiredMessages = [
    '"list" does not accept name, path, scope, template, or force',
    '"list" does not accept fixture, run, or event',
    '"list" does not accept trustedBy',
    '"list" does not accept source or trust',
    '"name" is required when action is "show"',
    '"show" does not accept path, scope, template, or force',
    '"show" does not accept fixture, run, or event',
    '"show" does not accept trustedBy',
    '"show" does not accept source or trust',
    '"validate" does not accept scope, template, or force',
    '"validate" does not accept fixture, run, or event',
    '"validate" does not accept trustedBy',
    '"validate" does not accept source or trust',
    'Specify only one of "name" or "path" for validate',
    '"test" does not accept scope, template, or force',
    '"test" does not accept trustedBy',
    '"test" does not accept source or trust',
    'Specify only one of "name" or "path" for test',
    '"name" is required when action is "new"',
    '"path" is not supported when action is "new"',
    '"new" does not accept fixture, run, or event',
    '"new" does not accept trustedBy',
    '"new" does not accept source or trust',
    '"reload" does not accept name, path, scope, template, or force',
    '"reload" does not accept source',
    '"reload" does not accept trust',
    '"reload" does not accept fixture, run, or event',
    '"reload" does not accept trustedBy',
    '"name" or "path" is required when action is "trust"',
    'Specify only one of "name" or "path" for trust',
    '"trust" does not accept scope, template, or force',
    '"trust" does not accept fixture, run, or event',
    '"trust" does not accept source or trust',
    '"name" or "path" is required when action is "untrust"',
    'Specify only one of "name" or "path" for untrust',
    '"untrust" does not accept scope, template, or force',
    '"untrust" does not accept fixture, run, or event',
    '"untrust" does not accept trustedBy',
    '"untrust" does not accept source or trust',
    '"source" is required when action is "install"',
    '"install" does not accept path',
    '"install" does not accept fixture, run, or event',
    '"install" does not accept template',
    '"name" or "path" is required when action is "update"',
    'Specify only one of "name" or "path" for update',
    '"update" does not accept scope, template, or source',
    '"update" does not accept force',
    '"update" does not accept fixture, run, or event',
    '"name" or "path" is required when action is "remove"',
    'Specify only one of "name" or "path" for remove',
    '"remove" does not accept scope, template, source, trust, or trustedBy',
    '"remove" does not accept fixture, run, or event',
    '"name" or "path" is required when action is "promote"',
    'Specify only one of "name" or "path" for promote',
    '"promote" does not accept scope, template, or source',
    '"promote" does not accept fixture, run, or event',
    '"name" or "path" is required when action is "demote"',
    'Specify only one of "name" or "path" for demote',
    '"demote" does not accept scope, template, source, trust, or trustedBy',
    '"demote" does not accept fixture, run, or event',
  ];

  it('MCP proxy registers eforge_extension and delegates to the shared dispatcher', () => {
    const block = mcpExtensionBlock();
    expect(mcpSource).toContain("name: 'eforge_extension'");
    expect(mcpSource).toContain("z.enum(['list', 'show', 'validate', 'test', 'new', 'reload', 'trust', 'untrust', 'install', 'update', 'remove', 'promote', 'demote'])");
    expect(mcpSource).toContain('dispatchEforgeExtensionAction');
    expect(block).toContain('dispatchEforgeExtensionAction');
    expect(block).toContain('params: { action, name, path, fixture, run, event, scope, template, force, trustedBy, source, trust, version }');
    expect(block).toContain('helpers: mcpExtensionActionHelpers');
    expect(block).toContain('return result.data');
    expect(block).not.toContain("'/api/");
    expect(block).not.toContain('"/api/');
  });

  it('Pi extension registers eforge_extension and delegates to the shared dispatcher', () => {
    const block = piExtensionBlock();
    expect(piSource).toContain('name: "eforge_extension"');
    expect(piSource).toContain('StringEnum(["list", "show", "validate", "test", "new", "reload", "trust", "untrust", "install", "update", "remove", "promote", "demote"] as const');
    expect(piSource).toContain('dispatchEforgeExtensionAction');
    expect(block).toContain('dispatchEforgeExtensionAction');
    expect(block).toContain('params,');
    expect(block).toContain('helpers: piExtensionActionHelpers');
    expect(block).toContain('if (result === null) throw new Error(DAEMON_NOT_RUNNING_GUIDANCE)');
    expect(block).toContain('return jsonResult(result.data)');
    expect(block).not.toContain("'/api/");
    expect(block).not.toContain('"/api/');
  });

  it('MCP and Pi eforge_extension schemas expose the full shared parameter set', () => {
    const requiredParams = ['name', 'path', 'fixture', 'run', 'event', 'scope', 'template', 'force', 'trustedBy', 'source', 'trust', 'version'];
    for (const [label, block] of [['MCP', mcpExtensionBlock()], ['Pi', piExtensionBlock()]] as const) {
      for (const param of requiredParams) {
        expect(block, `${label} schema exposes ${param}`).toMatch(new RegExp(`\\b${param}\\s*:`));
      }
    }
  });

  it('shared dispatcher owns validation messages and contains no inline route literals', () => {
    const dispatcherErrorMessages = [...dispatcherSource.matchAll(/throw new Error\((['"])(.*?)\1\)/g)].map((match) => match[2]);
    for (const message of requiredMessages) {
      expect(dispatcherErrorMessages, message).toContain(message);
    }
    expect(dispatcherSource).not.toContain("'/api/");
    expect(dispatcherSource).not.toContain('"/api/');
    expect(dispatcherSource).not.toContain('daemonRequest');
  });

  it('shared dispatcher rejects invalid action parameter combinations without calling helpers', async () => {
    const rejectedFieldValues = {
      name: 'team/a',
      path: '.eforge/extensions/a',
      fixture: 'fixture.json',
      run: 'run-1',
      event: 'event-1',
      scope: 'project',
      template: 'blank',
      force: true,
      trustedBy: 'tester',
      source: 'npm:@team/a',
      trust: true,
      version: '2.0.0',
    } satisfies Omit<EforgeExtensionActionParams, 'action'>;

    function rejectedFieldCases(
      action: EforgeExtensionAction,
      base: Omit<EforgeExtensionActionParams, 'action'>,
      fields: (keyof typeof rejectedFieldValues)[],
      message: string,
    ): { params: EforgeExtensionActionParams; message: string }[] {
      return fields.map((field) => ({
        params: { action, ...base, [field]: rejectedFieldValues[field] } as EforgeExtensionActionParams,
        message,
      }));
    }

    const invalidCases: { params: EforgeExtensionActionParams; message: string }[] = [
      { params: { action: 'list', name: 'team/a' }, message: '"list" does not accept name, path, scope, template, or force' },
      { params: { action: 'list', fixture: 'fixture.json' }, message: '"list" does not accept fixture, run, or event' },
      { params: { action: 'list', trustedBy: 'tester' }, message: '"list" does not accept trustedBy' },
      { params: { action: 'list', source: 'npm:@team/a' }, message: '"list" does not accept source or trust' },
      { params: { action: 'list', version: '2.0.0' }, message: '"list" does not accept version' },
      { params: { action: 'show' }, message: '"name" is required when action is "show"' },
      { params: { action: 'show', name: '' }, message: '"name" is required when action is "show"' },
      { params: { action: 'show', name: 'team/a', path: '.eforge/extensions/a' }, message: '"show" does not accept path, scope, template, or force' },
      { params: { action: 'show', name: 'team/a', fixture: 'fixture.json' }, message: '"show" does not accept fixture, run, or event' },
      { params: { action: 'show', name: 'team/a', trustedBy: 'tester' }, message: '"show" does not accept trustedBy' },
      { params: { action: 'show', name: 'team/a', source: 'npm:@team/a' }, message: '"show" does not accept source or trust' },
      { params: { action: 'validate', scope: 'project' }, message: '"validate" does not accept scope, template, or force' },
      { params: { action: 'validate', fixture: 'fixture.json' }, message: '"validate" does not accept fixture, run, or event' },
      { params: { action: 'validate', trustedBy: 'tester' }, message: '"validate" does not accept trustedBy' },
      { params: { action: 'validate', source: 'npm:@team/a' }, message: '"validate" does not accept source or trust' },
      { params: { action: 'validate', name: 'team/a', path: '.eforge/extensions/a' }, message: 'Specify only one of "name" or "path" for validate' },
      { params: { action: 'test', scope: 'project' }, message: '"test" does not accept scope, template, or force' },
      { params: { action: 'test', template: 'blank' }, message: '"test" does not accept scope, template, or force' },
      { params: { action: 'test', force: true }, message: '"test" does not accept scope, template, or force' },
      { params: { action: 'test', trustedBy: 'tester' }, message: '"test" does not accept trustedBy' },
      { params: { action: 'test', source: 'npm:@team/a' }, message: '"test" does not accept source or trust' },
      { params: { action: 'test', trust: true }, message: '"test" does not accept source or trust' },
      { params: { action: 'test', name: 'team/a', path: '.eforge/extensions/a' }, message: 'Specify only one of "name" or "path" for test' },
      { params: { action: 'new' }, message: '"name" is required when action is "new"' },
      { params: { action: 'new', name: '' }, message: '"name" is required when action is "new"' },
      { params: { action: 'new', name: 'team/a', path: '.eforge/extensions/a' }, message: '"path" is not supported when action is "new"' },
      { params: { action: 'new', name: 'team/a', fixture: 'fixture.json' }, message: '"new" does not accept fixture, run, or event' },
      { params: { action: 'new', name: 'team/a', trustedBy: 'tester' }, message: '"new" does not accept trustedBy' },
      { params: { action: 'new', name: 'team/a', source: 'npm:@team/a' }, message: '"new" does not accept source or trust' },
      { params: { action: 'reload', name: 'team/a' }, message: '"reload" does not accept name, path, scope, template, or force' },
      { params: { action: 'reload', source: 'npm:@team/a' }, message: '"reload" does not accept source' },
      { params: { action: 'reload', trust: true }, message: '"reload" does not accept trust' },
      { params: { action: 'reload', fixture: 'fixture.json' }, message: '"reload" does not accept fixture, run, or event' },
      { params: { action: 'reload', trustedBy: 'tester' }, message: '"reload" does not accept trustedBy' },
      { params: { action: 'trust' }, message: '"name" or "path" is required when action is "trust"' },
      { params: { action: 'trust', name: 'team/a', path: '.eforge/extensions/a' }, message: 'Specify only one of "name" or "path" for trust' },
      { params: { action: 'trust', name: 'team/a', scope: 'project' }, message: '"trust" does not accept scope, template, or force' },
      { params: { action: 'trust', name: 'team/a', fixture: 'fixture.json' }, message: '"trust" does not accept fixture, run, or event' },
      { params: { action: 'trust', name: 'team/a', source: 'npm:@team/a' }, message: '"trust" does not accept source or trust' },
      { params: { action: 'untrust' }, message: '"name" or "path" is required when action is "untrust"' },
      { params: { action: 'untrust', name: 'team/a', path: '.eforge/extensions/a' }, message: 'Specify only one of "name" or "path" for untrust' },
      { params: { action: 'untrust', name: 'team/a', scope: 'project' }, message: '"untrust" does not accept scope, template, or force' },
      { params: { action: 'untrust', name: 'team/a', fixture: 'fixture.json' }, message: '"untrust" does not accept fixture, run, or event' },
      { params: { action: 'untrust', name: 'team/a', trustedBy: 'tester' }, message: '"untrust" does not accept trustedBy' },
      { params: { action: 'untrust', name: 'team/a', source: 'npm:@team/a' }, message: '"untrust" does not accept source or trust' },
      { params: { action: 'install' }, message: '"source" is required when action is "install"' },
      { params: { action: 'install', source: 'npm:@team/a', path: '.eforge/extensions/a' }, message: '"install" does not accept path' },
      { params: { action: 'install', source: 'npm:@team/a', fixture: 'fixture.json' }, message: '"install" does not accept fixture, run, or event' },
      { params: { action: 'install', source: 'npm:@team/a', template: 'blank' }, message: '"install" does not accept template' },
      { params: { action: 'update' }, message: '"name" or "path" is required when action is "update"' },
      { params: { action: 'update', name: 'team/a', path: '.eforge/extensions/a' }, message: 'Specify only one of "name" or "path" for update' },
      { params: { action: 'update', name: 'team/a', scope: 'project' }, message: '"update" does not accept scope, template, or source' },
      { params: { action: 'update', name: 'team/a', force: true }, message: '"update" does not accept force' },
      { params: { action: 'update', name: 'team/a', fixture: 'fixture.json' }, message: '"update" does not accept fixture, run, or event' },
      { params: { action: 'remove' }, message: '"name" or "path" is required when action is "remove"' },
      { params: { action: 'remove', name: 'team/a', path: '.eforge/extensions/a' }, message: 'Specify only one of "name" or "path" for remove' },
      { params: { action: 'remove', name: 'team/a', scope: 'project' }, message: '"remove" does not accept scope, template, source, trust, or trustedBy' },
      { params: { action: 'remove', name: 'team/a', fixture: 'fixture.json' }, message: '"remove" does not accept fixture, run, or event' },
      { params: { action: 'promote' }, message: '"name" or "path" is required when action is "promote"' },
      { params: { action: 'promote', name: 'team/a', path: '.eforge/extensions/a' }, message: 'Specify only one of "name" or "path" for promote' },
      { params: { action: 'promote', name: 'team/a', scope: 'project' }, message: '"promote" does not accept scope, template, or source' },
      { params: { action: 'promote', name: 'team/a', fixture: 'fixture.json' }, message: '"promote" does not accept fixture, run, or event' },
      { params: { action: 'demote' }, message: '"name" or "path" is required when action is "demote"' },
      { params: { action: 'demote', name: 'team/a', path: '.eforge/extensions/a' }, message: 'Specify only one of "name" or "path" for demote' },
      { params: { action: 'demote', name: 'team/a', scope: 'project' }, message: '"demote" does not accept scope, template, source, trust, or trustedBy' },
      { params: { action: 'demote', name: 'team/a', fixture: 'fixture.json' }, message: '"demote" does not accept fixture, run, or event' },
    ];

    invalidCases.push(
      ...rejectedFieldCases('list', {}, ['name', 'path', 'scope', 'template', 'force'], '"list" does not accept name, path, scope, template, or force'),
      ...rejectedFieldCases('list', {}, ['fixture', 'run', 'event'], '"list" does not accept fixture, run, or event'),
      ...rejectedFieldCases('list', {}, ['source', 'trust'], '"list" does not accept source or trust'),
      ...rejectedFieldCases('show', { name: 'team/a' }, ['path', 'scope', 'template', 'force'], '"show" does not accept path, scope, template, or force'),
      ...rejectedFieldCases('show', { name: 'team/a' }, ['fixture', 'run', 'event'], '"show" does not accept fixture, run, or event'),
      ...rejectedFieldCases('show', { name: 'team/a' }, ['source', 'trust'], '"show" does not accept source or trust'),
      ...rejectedFieldCases('validate', {}, ['scope', 'template', 'force'], '"validate" does not accept scope, template, or force'),
      ...rejectedFieldCases('validate', {}, ['fixture', 'run', 'event'], '"validate" does not accept fixture, run, or event'),
      ...rejectedFieldCases('validate', {}, ['source', 'trust'], '"validate" does not accept source or trust'),
      ...rejectedFieldCases('test', {}, ['scope', 'template', 'force'], '"test" does not accept scope, template, or force'),
      ...rejectedFieldCases('test', {}, ['source', 'trust'], '"test" does not accept source or trust'),
      ...rejectedFieldCases('new', { name: 'team/a' }, ['fixture', 'run', 'event'], '"new" does not accept fixture, run, or event'),
      ...rejectedFieldCases('new', { name: 'team/a' }, ['source', 'trust'], '"new" does not accept source or trust'),
      ...rejectedFieldCases('reload', {}, ['name', 'path', 'scope', 'template', 'force'], '"reload" does not accept name, path, scope, template, or force'),
      ...rejectedFieldCases('reload', {}, ['fixture', 'run', 'event'], '"reload" does not accept fixture, run, or event'),
      ...rejectedFieldCases('trust', { name: 'team/a' }, ['scope', 'template', 'force'], '"trust" does not accept scope, template, or force'),
      ...rejectedFieldCases('trust', { name: 'team/a' }, ['fixture', 'run', 'event'], '"trust" does not accept fixture, run, or event'),
      ...rejectedFieldCases('trust', { name: 'team/a' }, ['source', 'trust'], '"trust" does not accept source or trust'),
      ...rejectedFieldCases('untrust', { name: 'team/a' }, ['scope', 'template', 'force'], '"untrust" does not accept scope, template, or force'),
      ...rejectedFieldCases('untrust', { name: 'team/a' }, ['fixture', 'run', 'event'], '"untrust" does not accept fixture, run, or event'),
      ...rejectedFieldCases('untrust', { name: 'team/a' }, ['source', 'trust'], '"untrust" does not accept source or trust'),
      ...rejectedFieldCases('install', { source: 'npm:@team/a' }, ['fixture', 'run', 'event'], '"install" does not accept fixture, run, or event'),
      ...rejectedFieldCases('update', { name: 'team/a' }, ['scope', 'template', 'source'], '"update" does not accept scope, template, or source'),
      ...rejectedFieldCases('update', { name: 'team/a' }, ['fixture', 'run', 'event'], '"update" does not accept fixture, run, or event'),
      ...rejectedFieldCases('remove', { name: 'team/a' }, ['scope', 'template', 'source', 'trust', 'trustedBy'], '"remove" does not accept scope, template, source, trust, or trustedBy'),
      ...rejectedFieldCases('remove', { name: 'team/a' }, ['fixture', 'run', 'event'], '"remove" does not accept fixture, run, or event'),
      ...rejectedFieldCases('promote', { name: 'team/a' }, ['scope', 'template', 'source'], '"promote" does not accept scope, template, or source'),
      ...rejectedFieldCases('promote', { name: 'team/a' }, ['fixture', 'run', 'event'], '"promote" does not accept fixture, run, or event'),
      ...rejectedFieldCases('demote', { name: 'team/a' }, ['scope', 'template', 'source', 'trust', 'trustedBy'], '"demote" does not accept scope, template, source, trust, or trustedBy'),
      ...rejectedFieldCases('demote', { name: 'team/a' }, ['fixture', 'run', 'event'], '"demote" does not accept fixture, run, or event'),
    );

    for (const testCase of invalidCases) {
      const calls: EforgeExtensionAction[] = [];
      const helpers = Object.fromEntries(EFORGE_EXTENSION_ACTIONS.map((action) => [
        action,
        () => {
          calls.push(action);
          return { data: { action }, port: 3210 };
        },
      ])) as unknown as EforgeExtensionActionHelpers;
      await expect(dispatchEforgeExtensionAction({ cwd: '/repo', params: testCase.params, helpers })).rejects.toThrow(new RegExp(`^${escapeRegExp(testCase.message)}$`));
      expect(calls, `${testCase.params.action}: ${testCase.message}`).toEqual([]);
    }
  });

  it('integration blocks no longer contain action-specific validation ladders', () => {
    const mcpBlock = mcpExtensionBlock();
    const piBlock = piExtensionBlock();
    for (const action of EFORGE_EXTENSION_ACTIONS) {
      const actionLadderPattern = new RegExp(`(?:\\b(?:params\\.)?action\\s*={2,3}\\s*['"]${action}['"]|['"]${action}['"]\\s*={2,3}\\s*\\b(?:params\\.)?action\\b|\\bcase\\s*['"]${action}['"])`);
      expect(mcpBlock).not.toMatch(actionLadderPattern);
      expect(piBlock).not.toMatch(actionLadderPattern);
    }
  });

  it('routes MCP actions through the normal helper table', () => {
    expectHelperMapping(mcpSource, 'mcpExtensionActionHelpers', {
      list: 'apiListExtensions',
      show: 'apiShowExtension',
      validate: 'apiValidateExtensions',
      test: 'apiTestExtension',
      new: 'apiNewExtension',
      reload: 'apiReloadExtensions',
      trust: 'apiTrustExtension',
      untrust: 'apiUntrustExtension',
      install: 'apiInstallExtension',
      update: 'apiUpdateExtension',
      remove: 'apiRemoveExtension',
      promote: 'apiPromoteExtension',
      demote: 'apiDemoteExtension',
    });
  });

  it('routes Pi actions through the IfRunning helper table', () => {
    expectHelperMapping(piSource, 'piExtensionActionHelpers', {
      list: 'apiListExtensionsIfRunning',
      show: 'apiShowExtensionIfRunning',
      validate: 'apiValidateExtensionsIfRunning',
      test: 'apiTestExtensionIfRunning',
      new: 'apiNewExtensionIfRunning',
      reload: 'apiReloadExtensionsIfRunning',
      trust: 'apiTrustExtensionIfRunning',
      untrust: 'apiUntrustExtensionIfRunning',
      install: 'apiInstallExtensionIfRunning',
      update: 'apiUpdateExtensionIfRunning',
      remove: 'apiRemoveExtensionIfRunning',
      promote: 'apiPromoteExtensionIfRunning',
      demote: 'apiDemoteExtensionIfRunning',
    });
  });

  it('client index exports the shared dispatcher contract but browser does not', () => {
    for (const name of dispatcherContractNames) {
      expect(clientIndexSource, name).toContain(name);
      expect(dispatcherSource, name).toContain(name);
    }
    expect(EFORGE_EXTENSION_ACTIONS).toEqual(['list', 'show', 'validate', 'test', 'new', 'reload', 'trust', 'untrust', 'install', 'update', 'remove', 'promote', 'demote']);
    const browserSource = readRepoFile('packages/client/src/browser.ts');
    for (const name of dispatcherContractNames) {
      expect(browserSource, name).not.toContain(name);
    }
  });

  it('shared dispatcher routes actions with the expected helper call shapes', async () => {
    const calls: { action: EforgeExtensionAction; opts: unknown }[] = [];
    const helpers = Object.fromEntries(EFORGE_EXTENSION_ACTIONS.map((action) => [
      action,
      (opts: unknown) => {
        calls.push({ action, opts });
        return { data: { action }, port: 3210 };
      },
    ])) as unknown as EforgeExtensionActionHelpers;
    const cases: { params: EforgeExtensionActionParams; opts: unknown }[] = [
      { params: { action: 'list' }, opts: { cwd: '/repo' } },
      { params: { action: 'show', name: 'team/a' }, opts: { cwd: '/repo', name: 'team/a' } },
      { params: { action: 'validate', path: '.eforge/extensions/a' }, opts: { cwd: '/repo', path: '.eforge/extensions/a' } },
      { params: { action: 'test', name: 'team/a', fixture: 'fixture.json', run: 'run-1', event: 'event-1' }, opts: { cwd: '/repo', body: { name: 'team/a', fixture: 'fixture.json', run: 'run-1', event: 'event-1' } } },
      { params: { action: 'new', name: 'team/a', scope: 'project', template: 'blank', force: true }, opts: { cwd: '/repo', body: { name: 'team/a', scope: 'project', template: 'blank', force: true } } },
      { params: { action: 'reload' }, opts: { cwd: '/repo' } },
      { params: { action: 'trust', path: '.eforge/extensions/a', trustedBy: 'tester' }, opts: { cwd: '/repo', body: { path: '.eforge/extensions/a', trustedBy: 'tester' } } },
      { params: { action: 'untrust', name: 'team/a' }, opts: { cwd: '/repo', body: { name: 'team/a' } } },
      { params: { action: 'install', source: 'npm:@team/a', name: 'team/a', scope: 'project', force: true, trust: true, trustedBy: 'tester' }, opts: { cwd: '/repo', body: { source: 'npm:@team/a', scope: 'project', name: 'team/a', force: true, trust: true, trustedBy: 'tester' } } },
      { params: { action: 'update', name: 'team/a', trust: false, trustedBy: 'tester', version: '2.0.0' }, opts: { cwd: '/repo', body: { name: 'team/a', trust: false, trustedBy: 'tester', version: '2.0.0' } } },
      { params: { action: 'remove', path: '.eforge/extensions/a', force: true }, opts: { cwd: '/repo', body: { path: '.eforge/extensions/a', force: true } } },
      { params: { action: 'promote', name: 'team/a', force: true, trust: true, trustedBy: 'tester' }, opts: { cwd: '/repo', body: { name: 'team/a', force: true, trust: true, trustedBy: 'tester' } } },
      { params: { action: 'demote', name: 'team/a', force: true }, opts: { cwd: '/repo', body: { name: 'team/a', force: true } } },
    ];

    for (const testCase of cases) {
      calls.length = 0;
      const result = await dispatchEforgeExtensionAction({ cwd: '/repo', params: testCase.params, helpers });
      expect(result).toEqual({ data: { action: testCase.params.action }, port: 3210 });
      expect(calls).toEqual([{ action: testCase.params.action, opts: testCase.opts }]);
    }
  });

  it('shared dispatcher preserves null helper results for thin adapters', async () => {
    const helpers = Object.fromEntries(EFORGE_EXTENSION_ACTIONS.map((action) => [action, () => null])) as unknown as EforgeExtensionActionHelpers;
    await expect(dispatchEforgeExtensionAction({ cwd: '/repo', params: { action: 'list' }, helpers })).resolves.toBeNull();
  });

  it('/eforge:config Pi TUI panel includes the resolved extensions config block', () => {
    const source = readRepoFile('packages/pi-eforge/extensions/eforge/config-command.ts');
    expect(source).toContain('## Extensions');
    expect(source).not.toContain(['trust', 'Project', 'Extensions'].join(''));
  });
});
// --- eforge:endregion extension-tooling-wiring-consumer-parity ---
