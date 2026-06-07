import { describe, expect, it } from 'vitest';
import type { ExtensionHostContributionEntry, ExtensionHostContributionInvokeResult } from '@eforge-build/client';
import {
  canInvokeWithoutPrompt,
  formatInvocationPanel,
  prepareContributionInput,
  schemaInputTemplate,
} from '../packages/pi-eforge/extensions/eforge/extension-contribution-ux.js';

function objectSchema(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: 'object', properties, required: Object.keys(properties) };
}

function stringSchema(options: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: 'string', ...options };
}

function entry(overrides: Partial<ExtensionHostContributionEntry> = {}): ExtensionHostContributionEntry {
  return {
    kind: 'action',
    id: 'ext.run',
    label: 'Run',
    extensionName: 'example',
    extensionPath: '/extensions/example',
    actionId: 'ext.run',
    actionBacked: true,
    inputSchema: objectSchema({}),
    ...overrides,
  };
}

function result(response: ExtensionHostContributionInvokeResult['response']): ExtensionHostContributionInvokeResult {
  return {
    target: {
      kind: 'action',
      id: 'ext.run',
      label: 'Run',
      extensionName: 'example',
      extensionPath: '/extensions/example',
      actionId: 'ext.run',
      requestedBy: { host: 'pi' },
      input: {},
    },
    response,
  };
}

describe('Pi extension contribution input UX helpers', () => {
  it('skips prompting for no-input action entries', () => {
    const action = entry({ inputSchema: objectSchema({}) });

    expect(canInvokeWithoutPrompt(action)).toBe(true);
    expect(prepareContributionInput(action)).toEqual({ kind: 'no-prompt', input: {} });
  });

  it('skips prompting when command defaults satisfy all required schema fields', () => {
    const command = entry({
      kind: 'command',
      id: 'ext.command',
      inputDefaults: { name: 'from-default' },
      inputSchema: objectSchema({ name: stringSchema() }),
    });

    expect(prepareContributionInput(command)).toEqual({ kind: 'no-prompt', input: {} });
  });

  it('skips prompting when action-backed deep-link defaults satisfy required schema fields', () => {
    const deepLink = entry({
      kind: 'deep-link',
      id: 'ext.deep',
      inputDefaults: { source: 'from-default' },
      inputSchema: objectSchema({ source: stringSchema() }),
    });

    expect(prepareContributionInput(deepLink)).toEqual({ kind: 'no-prompt', input: {} });
  });

  it('builds JSON templates with defaults and placeholders for missing required fields', () => {
    const contribution = entry({
      kind: 'command',
      id: 'ext.command',
      inputDefaults: { kept: 'default' },
      inputSchema: objectSchema({
        kept: stringSchema(),
        text: stringSchema(),
        count: { type: 'number' },
        index: { type: 'integer' },
        enabled: { type: 'boolean' },
        items: { type: 'array', items: stringSchema() },
        options: objectSchema({ nested: stringSchema() }),
        mode: { anyOf: [{ const: 'fast' }, { const: 'safe' }] },
        unknown: { required: ['nested'] },
      }),
    });

    expect(schemaInputTemplate(contribution)).toEqual({
      kept: 'default',
      text: '',
      count: 0,
      index: 0,
      enabled: false,
      items: [],
      options: {},
      mode: 'fast',
      unknown: null,
    });
    const decision = prepareContributionInput(contribution);
    expect(decision.kind).toBe('editor');
    if (decision.kind !== 'editor') return;
    expect(decision.title).toContain('command:ext.command');
    expect(decision.missingRequired).toEqual(['text', 'count', 'index', 'enabled', 'items', 'options', 'mode', 'unknown']);
    expect(JSON.parse(decision.prefillText)).toEqual(schemaInputTemplate(contribution));
  });

  it('uses enum defaults before first enum values', () => {
    expect(schemaInputTemplate(entry({
      inputSchema: objectSchema({ color: stringSchema({ enum: ['red', 'blue'], default: 'blue' }) }),
    }))).toEqual({ color: 'blue' });
    expect(schemaInputTemplate(entry({
      inputSchema: objectSchema({ color: stringSchema({ enum: ['red', 'blue'] }) }),
    }))).toEqual({ color: 'red' });
  });
});

describe('Pi extension contribution invocation panel formatting', () => {
  it('renders exact markdown success output as markdown content', () => {
    const panel = formatInvocationPanel(result({ ok: true, invocationId: 'invoke-1', output: { markdown: '# Done\n- ok' } }));

    expect(panel.title).toBe('eforge extensions - Success');
    expect(panel.content).toContain('# Done\n- ok');
    expect(panel.content).not.toContain('"markdown"');
    expect(panel.content).not.toContain('\\n');
  });

  it('renders non-markdown object and array success outputs as fenced JSON', () => {
    const objectPanel = formatInvocationPanel(result({ ok: true, invocationId: 'invoke-object', output: { value: true } }));
    const arrayPanel = formatInvocationPanel(result({ ok: true, invocationId: 'invoke-array', output: [1, 2] }));

    expect(objectPanel.content).toContain('```json\n{\n  "value": true\n}\n```');
    expect(arrayPanel.content).toContain('```json\n[\n  1,\n  2\n]\n```');
  });

  it('renders failure code, message, and details as fenced JSON', () => {
    const panel = formatInvocationPanel(result({
      ok: false,
      invocationId: 'invoke-failed',
      error: { code: 'invalid-input', message: 'Bad input', details: { field: 'name' } },
    }));

    expect(panel.title).toBe('eforge extensions - Failure');
    expect(panel.content).toContain('invalid-input: Bad input');
    expect(panel.content).toContain('```json\n{\n  "field": "name"\n}\n```');
  });
});
