import { describe, expect, it } from 'vitest';
import { HOST_OUTPUT_CHAR_BUDGET, renderHostOutput } from '../host-output.js';
import {
  projectCompactExtensionEntry,
  projectExtensionManagementListResponse,
  projectExtensionManagementPackageResponse,
  projectExtensionManagementReloadResponse,
  projectExtensionManagementResponse,
  projectExtensionManagementShowResponse,
  projectExtensionManagementTestResponse,
  projectExtensionManagementValidateResponse,
} from '../extension-management-output.js';
import type { ExtensionEntry, ExtensionListResponse, ExtensionRegistrationSummary } from '../types.js';

const registrations: ExtensionRegistrationSummary = {
  eventHooks: 1,
  agentRunHooks: 1,
  policyGates: 1,
  profileRouters: 1, runtimeChoiceRouters: 1,
  inputSources: 1,
  reviewerPerspectives: 1,
  validationProviders: 1,
  tools: 1,
  prdEnrichers: 1,
  actions: 20,
  agentTasks: 5,
  consoleContributions: 2,
  consoleWorkstations: 2,
  integrationCommands: 8,
  deepLinks: 8,
};

function giantSchema(index: number) {
  return {
    type: 'object',
    properties: Object.fromEntries(Array.from({ length: 250 }, (_, keyIndex) => [`field_${index}_${keyIndex}`, { type: 'string', description: 'x'.repeat(200) }])),
  };
}

function makeExtension(name = 'giant-extension'): ExtensionEntry {
  return {
    name,
    path: `/repo/.eforge/extensions/${name}/index.ts`,
    entrypoint: 'index.ts',
    scope: 'project-team',
    source: 'explicit',
    status: 'loaded',
    enabled: true,
    trust: 'trusted',
    trustState: 'trusted',
    currentHash: 'current-hash',
    trustedHash: 'current-hash',
    trustedAt: '2026-06-25T00:00:00.000Z',
    trustedBy: 'tester',
    trustStorePath: '/repo/.eforge/extension-trust.json',
    format: 'ts',
    layout: 'directory',
    strategy: 'native',
    shadows: Array.from({ length: 20 }, (_, index) => ({ name: `shadow-${index}`, path: `/shadow/${index}.ts`, scope: 'project-local' as const })),
    registrations,
    diagnostics: Array.from({ length: 20 }, (_, index) => ({ severity: index % 2 === 0 ? 'warning' : 'error', code: `diag-${index}`, message: 'diagnostic '.repeat(40), name, path: `/repo/${index}.ts` })),
    actionDetails: Array.from({ length: 80 }, (_, index) => ({ id: `${name}:action-${index}`, label: `Action ${index}`, inputSchema: giantSchema(index), outputProfile: 'debug-rich' })),
    integrationCommandDetails: Array.from({ length: 80 }, (_, index) => ({ id: `${name}:command-${index}`, label: `Command ${index}`, actionId: `${name}:action-${index}`, inputSchema: giantSchema(index) })),
    deepLinkDetails: Array.from({ length: 80 }, (_, index) => ({ id: `${name}:link-${index}`, label: `Link ${index}`, actionId: `${name}:action-${index}`, urlTemplate: 'eforge://x/{id}', inputSchema: giantSchema(index) })),
    capabilities: Array.from({ length: 40 }, (_, index) => ({ name: `${name}.cap.${index}`, version: '1.0.0' })),
    dependencies: { required: Array.from({ length: 30 }, (_, index) => ({ name: `dep-${index}` })) },
    resolvedDependencies: { available: true, required: [], optional: [], diagnostics: [] },
    package: { packageName: name, version: '1.0.0', description: 'package '.repeat(100), capabilities: Array.from({ length: 20 }, (_, index) => ({ name: `pkg.cap.${index}` })) },
    install: { sourceKind: 'npm', sourceSpec: name, resolvedVersion: '1.0.0', installedAt: '2026-06-25T00:00:00.000Z', targetScope: 'project-team' },
  } as unknown as ExtensionEntry;
}

function expectCompactRender(value: unknown) {
  const rendered = renderHostOutput(value);
  expect(rendered.text.length).toBeLessThanOrEqual(HOST_OUTPUT_CHAR_BUDGET);
  expect(rendered.text).not.toContain('field_0_200');
  expect(rendered.text).not.toContain('x'.repeat(200));
  expect(rendered.text).toContain('nextSteps');
}

describe('extension management compact output projections', () => {
  it('summarizes ExtensionEntry detail arrays and keeps key identity/status fields', () => {
    const projection = projectCompactExtensionEntry(makeExtension());

    expect(projection).toMatchObject({
      name: 'giant-extension',
      path: '/repo/.eforge/extensions/giant-extension/index.ts',
      scope: 'project-team',
      source: 'explicit',
      status: 'loaded',
      trust: 'trusted',
      trustState: 'trusted',
    });
    expect(projection.registrationTotal).toBeGreaterThan(0);
    expect(projection.diagnostics).toMatchObject({ count: 20, omitted: 17 });
    expect(projection.details.actionDetails).toMatchObject({ count: 80, omitted: 0 });
    expect(JSON.stringify(projection)).toContain('giant-extension:action-79');
    expect(JSON.stringify(projection)).toContain('Action 79');
    expect(JSON.stringify(projection)).toContain('debug-rich');
    expect(JSON.stringify(projection)).not.toContain('field_0_200');
    expect(projection.nextSteps.length).toBeGreaterThan(0);
  });

  it('preserves every compact action id, label, and output profile while omitting schemas', () => {
    const extension = makeExtension('all-actions');
    const projection = projectCompactExtensionEntry(extension);
    const actionDetails = projection.details.actionDetails;

    expect(actionDetails?.count).toBe(extension.actionDetails?.length);
    expect(actionDetails?.omitted).toBe(0);
    const serialized = JSON.stringify(actionDetails);
    for (let index = 0; index < 80; index += 1) {
      expect(serialized).toContain(`all-actions:action-${index}`);
      expect(serialized).toContain(`Action ${index}`);
    }
    expect(serialized.match(/debug-rich/g)?.length).toBe(80);
    expect(serialized).toContain('"inputSchema":{"keys":2,"omittedKeys":2}');
    expect(serialized).not.toContain('field_0_200');
  });

  it('projects list/show/validate/reload/test/install responses within the host budget', () => {
    const extensions = [makeExtension('giant-a'), makeExtension('giant-b'), makeExtension('giant-c')];
    const list: ExtensionListResponse = { extensions, diagnostics: extensions[0].diagnostics, totals: registrations };

    expectCompactRender(projectExtensionManagementListResponse(list));
    expectCompactRender(projectExtensionManagementShowResponse({ extension: extensions[0] }));
    expectCompactRender(projectExtensionManagementValidateResponse({ valid: false, extensions, diagnostics: extensions[0].diagnostics }));
    expectCompactRender(projectExtensionManagementReloadResponse({ ...list, wasRunning: true, restarted: true, running: true, previousSessionId: null, sessionId: 'session-1', message: 'reloaded', watcher: { wasRunning: true, restarted: true, running: true, previousSessionId: null, sessionId: 'session-1', message: 'reloaded' } }));
    const testProjection = projectExtensionManagementTestResponse({
      valid: true,
      source: { kind: 'fixture', fixture: 'fixture.json' },
      extensions,
      diagnostics: extensions[0].diagnostics,
      replay: { inputEventCount: 100, filteredEventCount: 20, emittedEventCount: 10, diagnosticEventCount: 1 },
      matches: Array.from({ length: 50 }, (_, index) => ({ eventIndex: index, eventType: 'plan:status:change', extensionName: 'giant-a', extensionPath: extensions[0].path, pattern: '*' })),
      emittedDiagnostics: Array.from({ length: 8 }, (_, index) => ({ type: 'extension:event-handler:failed', extensionName: 'giant-a', extensionPath: extensions[0].path, message: 'x'.repeat(1_000), error: { stack: 'x'.repeat(2_000), nested: giantSchema(index) } })) as never,
      deferredRegistrations: [{ family: 'actions', count: 10, extensions: [{ name: 'giant-a', path: extensions[0].path, count: 10 }] }],
    });
    expectCompactRender(testProjection);
    expect(testProjection.matches).toMatchObject({ count: 50, omitted: 40 });
    expect(testProjection.emittedDiagnostics).toMatchObject({ count: 8, omitted: 3 });
    expect(testProjection.deferredRegistrations).toMatchObject({ count: 1, omitted: 0 });
    expectCompactRender(projectExtensionManagementPackageResponse('install', { extension: extensions[0], message: 'installed' }));
  });

  it('projects all extension management action envelopes through the shared dispatcher', () => {
    const extension = makeExtension('giant-action');
    const extensionEnvelopeActions = ['trust', 'untrust', 'install', 'promote', 'demote'] as const;

    const newProjection = projectExtensionManagementResponse('new', {
      name: 'new-extension',
      template: 'blank',
      requestScope: 'project',
      scope: 'project-local',
      configDir: '/repo/.eforge',
      scopeDir: '/repo/.eforge',
      extensionsDir: '/repo/.eforge/extensions',
      path: '/repo/.eforge/extensions/new-extension',
      created: true,
      overwritten: false,
      message: 'created',
    });
    expectCompactRender(newProjection);
    expect(newProjection.action).toBe('new');

    for (const action of extensionEnvelopeActions) {
      const projection = projectExtensionManagementResponse(action, { extension, message: `${action} ok` });
      expectCompactRender(projection);
      expect(projection.action).toBe(action);
    }

    const updateProjection = projectExtensionManagementResponse('update', { extension, previousVersion: '0.1.0', message: 'updated' });
    expectCompactRender(updateProjection);
    expect(updateProjection).toMatchObject({ action: 'update', previousVersion: '0.1.0' });

    const removeProjection = projectExtensionManagementResponse('remove', { message: 'removed' });
    expectCompactRender(removeProjection);
    expect(removeProjection).toMatchObject({ action: 'remove', message: 'removed' });
  });
});
