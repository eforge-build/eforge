import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';

import {
  legacyExtensionAgentTaskStartToContributionRef,
  safeParseExtensionAgentTaskStartRequest,
  safeParseExtensionContributionManifest,
} from '../index.js';

describe('extension agent task contribution contracts', () => {
  it('accepts contribution-reference starts alongside legacy kind starts', () => {
    expect(safeParseExtensionAgentTaskStartRequest({ task: { id: 'planning-draft' }, input: { topic: 'Demo' } }).success).toBe(true);
    expect(safeParseExtensionAgentTaskStartRequest({ task: { id: '@eforge+plan:planning-draft' }, input: { topic: 'Demo' } }).success).toBe(true);
    expect(safeParseExtensionAgentTaskStartRequest({ kind: 'eforge-plan.planning-draft', input: { topic: 'Demo' } }).success).toBe(true);
  });

  it('maps legacy kinds to owner-scoped contribution refs without input special cases', () => {
    const start = legacyExtensionAgentTaskStartToContributionRef({
      kind: 'eforge-plan.planning-draft',
      input: { topic: 'Demo', requestedOutputSections: ['sessionPlanCreationDraft'] },
    });
    expect(start).toEqual({
      task: { extensionName: 'eforge-plan', id: 'planning-draft' },
      input: { topic: 'Demo', requestedOutputSections: ['sessionPlanCreationDraft'] },
    });
  });

  it('rejects caller-supplied prompt paths in start requests', () => {
    expect(safeParseExtensionAgentTaskStartRequest({ task: { id: 'planning-draft', promptAsset: '../x.md' }, input: {} }).success).toBe(false);
    expect(safeParseExtensionAgentTaskStartRequest({ task: { id: 'planning-draft' }, input: {}, promptAsset: 'prompts/x.md' }).success).toBe(false);
  });

  it('parses safe manifest metadata for agent task contributions', () => {
    const manifest = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      actions: [],
      agentTasks: [{
        id: 'eforge-plan:planning-draft',
        localId: 'planning-draft',
        extensionName: 'eforge-plan',
        extensionPath: '/extensions/eforge-plan',
        title: 'Planning draft',
        description: 'Drafts a plan.',
        inputSchema: Type.Object({ topic: Type.String() }),
        outputSchema: Type.Object({ summary: Type.String() }),
        prompt: { kind: 'asset', asset: 'prompts/planning-draft.md' },
      }],
      consoleContributions: [],
      consoleWorkstations: [],
      integrationCommands: [],
      deepLinks: [],
    };

    const result = safeParseExtensionContributionManifest(manifest);
    expect(result.success).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain('resolvePrompt');
    expect(JSON.stringify(manifest)).not.toContain('raw prompt');
  });

  it('rejects raw prompt text, resolver functions, and unsafe prompt assets in manifest task entries', () => {
    const base = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      actions: [],
      consoleContributions: [],
      consoleWorkstations: [],
      integrationCommands: [],
      deepLinks: [],
    };
    const taskEntry = {
      id: 'x:y',
      localId: 'y',
      extensionName: 'x',
      extensionPath: '/x',
      title: 'Y',
      inputSchema: Type.Object({}),
    };
    expect(safeParseExtensionContributionManifest({
      ...base,
      agentTasks: [{
        ...taskEntry,
        prompt: { kind: 'asset', asset: 'prompts/y.md', text: 'raw prompt' },
      }],
    }).success).toBe(false);
    expect(safeParseExtensionContributionManifest({
      ...base,
      agentTasks: [{
        ...taskEntry,
        prompt: { kind: 'export', module: './tasks.js' },
        resolver: () => 'nope',
      }],
    }).success).toBe(false);
    for (const asset of ['/tmp/prompt.md', 'C:\\tmp\\prompt.md', '../prompt.md', 'prompts/../prompt.md', 'prompts\\..\\prompt.md', 'prompts\0prompt.md']) {
      expect(safeParseExtensionContributionManifest({
        ...base,
        agentTasks: [{
          ...taskEntry,
          prompt: { kind: 'asset', asset },
        }],
      }).success).toBe(false);
    }
  });
});
