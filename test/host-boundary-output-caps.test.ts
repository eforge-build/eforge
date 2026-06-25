import { describe, expect, it } from 'vitest';
import {
  HOST_OUTPUT_CHAR_BUDGET,
  HOST_OUTPUT_GUIDANCE,
  capHostOutputText,
  formatExtensionContributionDetailText,
  formatExtensionContributionListText,
  formatExtensionContributionOutputText,
  projectExtensionManagementResponse,
  type EforgeExtensionManagementProjectionAction,
} from '@eforge-build/client';
import { jsonResult } from '../packages/pi-eforge/extensions/eforge/index.js';
import { textResult as piContributionTextResult } from '../packages/pi-eforge/extensions/eforge/extension-contributions.js';

const GIANT_MARKER = 'giant-host-boundary-marker:';
const GIANT_TEXT = GIANT_MARKER.repeat(2_000);
const GIANT_SCHEMA_CACHE = new Map<number, Record<string, unknown>>();

function giantSchema(seed: number): Record<string, unknown> {
  const cached = GIANT_SCHEMA_CACHE.get(seed);
  if (cached) return cached;
  const schema = {
    type: 'object',
    properties: Object.fromEntries(
      Array.from({ length: 300 }, (_, index) => [
        `field_${seed}_${index}`,
        { type: 'string', description: GIANT_TEXT },
      ]),
    ),
  };
  GIANT_SCHEMA_CACHE.set(seed, schema);
  return schema;
}

function giantExtension(name = 'giant-extension'): Record<string, unknown> {
  const diagnostics = Array.from({ length: 60 }, (_, index) => ({
    severity: 'warning',
    code: `diag-${index}`,
    message: GIANT_TEXT,
    path: `/repo/${index}.ts`,
  }));
  const registrations = {
    eventHooks: 1,
    agentRunHooks: 1,
    policyGates: 1,
    profileRouters: 1,
    inputSources: 1,
    reviewerPerspectives: 1,
    validationProviders: 1,
    tools: 1,
    prdEnrichers: 1,
    actions: 120,
    agentTasks: 20,
    consoleContributions: 20,
    consoleWorkstations: 20,
    integrationCommands: 80,
    deepLinks: 80,
  };
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
    format: 'ts',
    layout: 'directory',
    strategy: 'native',
    registrations,
    diagnostics,
    shadows: Array.from({ length: 20 }, (_, index) => ({ name: `shadow-${index}`, path: `/shadow/${index}.ts`, detail: GIANT_TEXT })),
    actionDetails: Array.from({ length: 120 }, (_, index) => ({ id: `${name}:action-${index}`, label: `Action ${index}`, inputSchema: giantSchema(index), outputProfile: 'debug-rich' })),
    integrationCommandDetails: Array.from({ length: 80 }, (_, index) => ({ id: `${name}:command-${index}`, actionId: `${name}:action-${index}`, inputSchema: giantSchema(index) })),
    deepLinkDetails: Array.from({ length: 80 }, (_, index) => ({ id: `${name}:link-${index}`, actionId: `${name}:action-${index}`, inputSchema: giantSchema(index) })),
    capabilities: Array.from({ length: 40 }, (_, index) => ({ name: `${name}.cap.${index}`, detail: GIANT_TEXT })),
    dependencies: { required: Array.from({ length: 30 }, (_, index) => ({ name: `dep-${index}`, detail: GIANT_TEXT })) },
    resolvedDependencies: { available: true, required: [], optional: [], diagnostics },
    package: { packageName: name, version: '1.0.0', description: GIANT_TEXT },
    install: { sourceKind: 'npm', sourceSpec: name, resolvedVersion: '1.0.0' },
  };
}

function extensionResponses(): Array<[EforgeExtensionManagementProjectionAction, unknown]> {
  const extensions = Array.from({ length: 90 }, (_, index) => giantExtension(`giant-${index}`));
  const extension = extensions[0];
  const diagnostics = extension.diagnostics as unknown[];
  const totals = extension.registrations;
  return [
    ['list', { extensions, diagnostics, totals }],
    ['show', { extension }],
    ['validate', { valid: false, extensions, diagnostics }],
    ['reload', { extensions, diagnostics, totals, wasRunning: true, restarted: true, running: true, previousSessionId: null, sessionId: 'session-1', message: 'reloaded', watcher: { running: true } }],
    ['test', { valid: true, source: { kind: 'fixture', fixture: 'fixture.json' }, replay: { inputEventCount: 200, filteredEventCount: 100, emittedEventCount: 50, diagnosticEventCount: 20 }, matches: Array.from({ length: 120 }, (_, index) => ({ eventIndex: index, eventType: 'plan:status:change', extensionName: 'giant-0', pattern: GIANT_TEXT })), emittedDiagnostics: diagnostics, deferredRegistrations: [{ family: 'actions', count: 120 }], extensions, diagnostics }],
    ['new', { name: 'giant-new', template: 'blank', requestScope: 'project', scope: 'project', configDir: '/repo/eforge', scopeDir: '/repo/eforge', extensionsDir: '/repo/eforge/extensions', path: '/repo/eforge/extensions/giant-new', created: true, overwritten: false, message: GIANT_TEXT }],
    ['trust', { extension, message: 'trusted' }],
    ['untrust', { extension, message: 'untrusted' }],
    ['install', { extension, message: 'installed' }],
    ['update', { extension, previousVersion: '0.1.0', message: 'updated' }],
    ['remove', { extension, message: 'removed' }],
    ['promote', { extension, message: 'promoted' }],
    ['demote', { extension, message: 'demoted' }],
  ];
}

function giantContributionEntry(): Record<string, unknown> {
  return {
    kind: 'action',
    id: 'giant.run',
    label: 'Giant Run',
    description: GIANT_TEXT,
    extensionName: 'giant',
    extensionPath: '/repo/.eforge/extensions/giant/index.ts',
    actionId: 'giant.run',
    actionBacked: true,
    outputProfile: 'debug-rich',
    inputSchema: giantSchema(1),
    inputPropertyKeys: Array.from({ length: 500 }, (_, index) => `field_${index}`),
    inputPropertyCount: 500,
    inputRequiredCount: 250,
    inputDefaultKeys: Array.from({ length: 100 }, (_, index) => `field_${index}`),
    diagnostics: Array.from({ length: 200 }, (_, index) => ({ severity: 'warning', code: `diag-${index}`, message: GIANT_TEXT })),
  };
}

describe('Pi host-boundary output caps', () => {
  it('caps jsonResult content and replaces raw details with metadata', () => {
    const raw = { ok: true, payload: GIANT_TEXT, nested: Array.from({ length: 300 }, (_, index) => ({ index, text: GIANT_TEXT })) };
    const result = jsonResult(raw);

    expect(result.content[0].text.length).toBeLessThanOrEqual(HOST_OUTPUT_CHAR_BUDGET);
    expect(result.details).toMatchObject({ hostOutput: { budget: HOST_OUTPUT_CHAR_BUDGET, summarized: true } });
    expect(JSON.stringify(result.details)).not.toContain(GIANT_TEXT.slice(0, 1_000));
  });

  it('keeps Pi extension-management projections compact and host-safe', () => {
    for (const [action, response] of extensionResponses()) {
      const projection = projectExtensionManagementResponse(action, response);
      const result = jsonResult(projection);
      const text = result.content[0].text;

      expect(text.length, action).toBeLessThanOrEqual(HOST_OUTPUT_CHAR_BUDGET);
      expect(text, action).not.toContain(GIANT_TEXT.slice(0, 1_000));
      expect(result.details).toHaveProperty('hostOutput');
      expect(projection.nextSteps.length, action).toBeGreaterThan(0);
      if (text.includes('rawLength')) expect(text, action).toContain(HOST_OUTPUT_GUIDANCE);
    }
  });

  it('includes compact extension identity, status, trust, counts, samples, and next steps', () => {
    const projection = projectExtensionManagementResponse('show', { extension: giantExtension('giant-focused') });
    const extension = projection.extension as Record<string, unknown>;

    expect(extension).toMatchObject({
      name: 'giant-focused',
      path: '/repo/.eforge/extensions/giant-focused/index.ts',
      scope: 'project-team',
      source: 'explicit',
      status: 'loaded',
      trust: 'trusted',
      registrationTotal: expect.any(Number),
    });
    expect(extension.registrations).toMatchObject({ actions: 120, integrationCommands: 80, deepLinks: 80 });
    expect(extension.diagnostics).toMatchObject({ count: 60, omitted: expect.any(Number), samples: expect.any(Array) });
    expect(extension.details).toMatchObject({ actionDetails: { count: 120, samples: expect.any(Array), omitted: expect.any(Number) } });
    expect(extension.nextSteps).toEqual(expect.arrayContaining([expect.stringMatching(/raw CLI\/HTTP JSON|focused details/i)]));
    expect(projection.nextSteps.length).toBeGreaterThan(0);
  });

  it('caps Pi contribution list, show, and invoke text with bounded metadata details', () => {
    const entry = giantContributionEntry();
    const listText = formatExtensionContributionListText({ generatedAt: new Date(0).toISOString(), total: 200, returned: 1, offset: 0, limit: 1, hasMore: true, nextOffset: 1, diagnosticCount: 200, entries: [entry], diagnostics: entry.diagnostics as never[] });
    const showText = formatExtensionContributionDetailText({ generatedAt: new Date(0).toISOString(), entry, diagnosticCount: 200, diagnostics: entry.diagnostics as never[] });
    const invokeText = [
      'Invocation: invocation-1',
      'Target: action:giant.run',
      'Action: giant.run',
      '',
      formatExtensionContributionOutputText({ rows: Array.from({ length: 1_000 }, (_, index) => ({ index, debug: GIANT_TEXT })), nextOffset: 1000 }, { outputProfile: 'debug-rich' }),
    ].join('\n');

    for (const rawText of [listText, showText, invokeText]) {
      const result = piContributionTextResult(rawText);
      expect(result.content[0].text.length).toBeLessThanOrEqual(HOST_OUTPUT_CHAR_BUDGET);
      expect(result.details).toMatchObject({ hostOutput: { budget: HOST_OUTPUT_CHAR_BUDGET, rawLength: rawText.length } });
      expect(JSON.stringify(result.details)).not.toContain(GIANT_MARKER);
      if (rawText.length > HOST_OUTPUT_CHAR_BUDGET) expect(result.content[0].text).toContain(HOST_OUTPUT_GUIDANCE);
    }
  });

  it('caps MCP contribution list, show, and invoke formatted text', () => {
    const entry = giantContributionEntry();
    const texts = [
      formatExtensionContributionListText({ generatedAt: new Date(0).toISOString(), total: 200, returned: 1, offset: 0, limit: 1, hasMore: true, nextOffset: 1, diagnosticCount: 200, entries: [entry], diagnostics: entry.diagnostics as never[] }),
      formatExtensionContributionDetailText({ generatedAt: new Date(0).toISOString(), entry, diagnosticCount: 200, diagnostics: entry.diagnostics as never[] }),
      ['Invocation: invocation-1', 'Target: action:giant.run', 'Action: giant.run', '', formatExtensionContributionOutputText({ rows: Array.from({ length: 1_000 }, (_, index) => ({ index, debug: GIANT_TEXT })), nextOffset: 1000 }, { outputProfile: 'debug-rich' })].join('\n'),
    ];

    for (const text of texts.map((value) => capHostOutputText(value).text)) {
      expect(text.length).toBeLessThanOrEqual(HOST_OUTPUT_CHAR_BUDGET);
      if (text.includes('final host character budget')) expect(text).toContain(HOST_OUTPUT_GUIDANCE);
    }
  });
});
