import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import {
  EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION,
  ConsoleContributionBlockSchema,
  ExtensionActionInvokeErrorCodeSchema,
  ExtensionActionInvokeRequestSchema,
  ExtensionActionInvokeResponseSchema,
  safeParseExtensionContributionManifest,
  safeParseExtensionActionInvokeRequest,
  safeParseExtensionActionInvokeResponse,
} from '../extension-contributions.js';
import { Value } from '@sinclair/typebox/value';
import { API_ROUTES } from '../routes.js';

const base = {
  id: 'example.item',
  localId: 'item',
  extensionName: 'example',
  extensionPath: '/repo/.eforge/extensions/example',
};

function manifest() {
  return {
    schemaVersion: EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION,
    actions: [{
      ...base,
      id: 'example.say-hi',
      localId: 'say-hi',
      title: 'Say hi',
      inputSchema: Type.Object({ name: Type.String() }),
      sideEffects: ['none'],
    }],
    consoleContributions: [{
      ...base,
      id: 'example.panel',
      localId: 'panel',
      schemaVersion: EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION,
      blocks: [{ rendererId: 'text', content: 'Hello' }],
    }],
    integrationCommands: [{
      ...base,
      id: 'example.command',
      localId: 'command',
      label: 'Run command',
      action: { actionId: 'example.say-hi', inputDefaults: { name: 'world' } },
    }],
    deepLinks: [{
      ...base,
      id: 'example.link',
      localId: 'link',
      label: 'Open link',
      urlTemplate: 'https://example.test/{id}',
    }],
    diagnostics: [{
      extensionName: 'example',
      extensionPath: '/repo/.eforge/extensions/example',
      severity: 'warning',
      message: 'Heads up',
    }],
  };
}

describe('extension contribution schemas', () => {
  it('owns the contribution manifest and action invocation route constants', () => {
    expect(API_ROUTES.extensionContributionManifest).toBe('/api/extensions/contributions');
    expect(API_ROUTES.extensionActionInvoke).toBe('/api/extensions/actions/invoke');
  });

  it('accepts a manifest with actions, Console contributions, commands, deep links, and diagnostics', () => {
    expect(safeParseExtensionContributionManifest(manifest()).success).toBe(true);
  });

  it('rejects handler-like unsafe action manifest fields', () => {
    for (const key of ['handler', 'module', 'source']) {
      const value = manifest();
      (value.actions[0] as Record<string, unknown>)[key] = 'unsafe';
      expect(safeParseExtensionContributionManifest(value).success).toBe(false);
    }
  });

  it('rejects invalid console blocks and non-JSON-safe schema documents', () => {
    const missingHref = manifest();
    missingHref.consoleContributions[0].blocks = [{ rendererId: 'link', content: 'x' } as never];
    expect(safeParseExtensionContributionManifest(missingHref).success).toBe(false);

    const unsafeSchema = manifest();
    (unsafeSchema.actions[0].inputSchema as Record<string, unknown>).properties = { value: () => 'nope' };
    expect(safeParseExtensionContributionManifest(unsafeSchema).success).toBe(false);

    const nonObjectInputSchema = manifest();
    nonObjectInputSchema.actions[0].inputSchema = Type.String() as never;
    expect(safeParseExtensionContributionManifest(nonObjectInputSchema).success).toBe(false);
  });

  it('validates requestedBy host values', () => {
    for (const host of ['console', 'pi', 'claude', 'mcp', 'cli']) {
      expect(safeParseExtensionActionInvokeRequest({ actionId: 'a', input: {}, requestedBy: { host } }).success).toBe(true);
    }
    expect(safeParseExtensionActionInvokeRequest({ actionId: 'a', input: {}, requestedBy: { host: 'web' } }).success).toBe(false);
  });

  it('rejects non-object invocation inputs', () => {
    for (const input of [[], 'x', 1, true, null]) {
      expect(Value.Check(ExtensionActionInvokeRequestSchema, { actionId: 'a', input, requestedBy: { host: 'cli' } })).toBe(false);
    }
  });

  it('accepts invocation success and every failure code', () => {
    expect(safeParseExtensionActionInvokeResponse({ ok: true, output: { value: 1 } }).success).toBe(true);
    const codes = ExtensionActionInvokeErrorCodeSchema.anyOf.map((schema) => schema.const);
    for (const code of codes) {
      expect(Value.Check(ExtensionActionInvokeResponseSchema, { ok: false, error: { code, message: 'nope' } })).toBe(true);
    }
  });

  it('accepts each Console renderer ID and rejects an unknown renderer', () => {
    expect(Value.Check(ConsoleContributionBlockSchema, { rendererId: 'text', content: 'x' })).toBe(true);
    expect(Value.Check(ConsoleContributionBlockSchema, { rendererId: 'markdown', content: 'x' })).toBe(true);
    expect(Value.Check(ConsoleContributionBlockSchema, { rendererId: 'status-badge', content: 'x', status: 'ok' })).toBe(true);
    expect(Value.Check(ConsoleContributionBlockSchema, { rendererId: 'link', content: 'x', href: 'https://example.com' })).toBe(true);
    expect(Value.Check(ConsoleContributionBlockSchema, { rendererId: 'action-button', content: 'x', action: { actionId: 'a' } })).toBe(true);
    expect(Value.Check(ConsoleContributionBlockSchema, { rendererId: 'action-form', content: 'x', action: { actionId: 'a' } })).toBe(true);
    expect(Value.Check(ConsoleContributionBlockSchema, { rendererId: 'iframe', content: 'x' })).toBe(false);
  });
});
