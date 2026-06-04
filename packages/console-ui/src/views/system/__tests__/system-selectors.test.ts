import { describe, it, expect } from 'vitest';
import {
  selectProfileCounts,
  selectExtensionDiagnosticCounts,
  selectPlaybookModeCounts,
  selectSessionPlanReadinessCounts,
  selectConfigSourceRows,
  selectModelTotals,
  selectExtensionContributionManifestSummary,
} from '@/lib/selectors';
import type {
  AgentRuntimeProfileInfo,
  ExtensionDiagnostic,
  PlaybookListEntry,
  SessionPlanListEntryWire,
  ConfigShowVerboseResponse,
  ModelInfo,
} from '@eforge-build/client/browser';

// ---------------------------------------------------------------------------
// Profile selectors
// ---------------------------------------------------------------------------

describe('selectProfileCounts', () => {
  it('returns zero totals for empty array', () => {
    const result = selectProfileCounts([]);
    expect(result.total).toBe(0);
    expect(result.byScope).toEqual({});
  });

  it('counts profiles by scope', () => {
    const profiles: AgentRuntimeProfileInfo[] = [
      { name: 'default', harness: 'claude-sdk', path: '/a', scope: 'local' },
      { name: 'fast', harness: 'pi', path: '/b', scope: 'project' },
      { name: 'deep', harness: 'claude-sdk', path: '/c', scope: 'local' },
      { name: 'user-default', harness: undefined, path: '/d', scope: 'user' },
    ];
    const result = selectProfileCounts(profiles);
    expect(result.total).toBe(4);
    expect(result.byScope['local']).toBe(2);
    expect(result.byScope['project']).toBe(1);
    expect(result.byScope['user']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Extension diagnostic selectors
// ---------------------------------------------------------------------------

describe('selectExtensionDiagnosticCounts', () => {
  it('returns zero counts for empty array', () => {
    const result = selectExtensionDiagnosticCounts([]);
    expect(result.errors).toBe(0);
    expect(result.warnings).toBe(0);
    expect(result.total).toBe(0);
  });

  it('counts diagnostics by severity', () => {
    const diagnostics: ExtensionDiagnostic[] = [
      { severity: 'error', code: 'E001', message: 'failed to load' },
      { severity: 'warning', code: 'W001', message: 'deprecated usage' },
      { severity: 'warning', code: 'W002', message: 'hash mismatch' },
      { severity: 'error', code: 'E002', message: 'syntax error' },
    ];
    const result = selectExtensionDiagnosticCounts(diagnostics);
    expect(result.errors).toBe(2);
    expect(result.warnings).toBe(2);
    expect(result.total).toBe(4);
  });
});

describe('selectExtensionContributionManifestSummary', () => {
  it('counts manifest families, renderers, and diagnostics', () => {
    const result = selectExtensionContributionManifestSummary({
      schemaVersion: 1,
      generatedAt: '2026-01-01T00:00:00.000Z',
      actions: [{ id: 'ext.echo', localId: 'echo', extensionName: 'ext', extensionPath: '/ext.js', title: 'Echo', inputSchema: { type: 'object', properties: {} } }],
      consoleContributions: [{
        id: 'ext.panel',
        localId: 'panel',
        extensionName: 'ext',
        extensionPath: '/ext.js',
        title: 'Panel',
        schemaVersion: 1,
        blocks: [
          { rendererId: 'text', content: 'hello' },
          { rendererId: 'markdown', content: '**hello**' },
          { rendererId: 'status-badge', content: 'ready', status: 'success' },
          { rendererId: 'link', content: 'docs', href: 'https://example.test' },
          { rendererId: 'action-button', content: 'Run', action: { actionId: 'ext.echo' } },
          { rendererId: 'action-form', content: 'Configure', action: { actionId: 'ext.echo' } },
        ],
      }],
      integrationCommands: [{ id: 'ext.cmd', localId: 'cmd', extensionName: 'ext', extensionPath: '/ext.js', label: 'Run', action: { actionId: 'ext.echo' } }],
      deepLinks: [{ id: 'ext.link', localId: 'link', extensionName: 'ext', extensionPath: '/ext.js', label: 'Open' }],
      diagnostics: [{ severity: 'warning', code: 'W1', message: 'heads up' }],
    });

    expect(result.families).toEqual({ actions: 1, consoleContributions: 1, integrationCommands: 1, deepLinks: 1 });
    expect(result.renderers.text).toBe(1);
    expect(result.renderers.markdown).toBe(1);
    expect(result.renderers['status-badge']).toBe(1);
    expect(result.renderers.link).toBe(1);
    expect(result.renderers['action-button']).toBe(1);
    expect(result.renderers['action-form']).toBe(1);
    expect(result.diagnostics.warnings).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Playbook mode selectors
// ---------------------------------------------------------------------------

describe('selectPlaybookModeCounts', () => {
  it('returns zero counts for empty array', () => {
    const result = selectPlaybookModeCounts([]);
    expect(result.autonomous).toBe(0);
    expect(result.planning).toBe(0);
    expect(result.total).toBe(0);
  });

  it('counts playbooks by mode', () => {
    const playbooks: PlaybookListEntry[] = [
      { name: 'auto-1', description: '', scope: 'project-local', mode: 'autonomous', source: 'project-local', shadows: [], path: '/a' },
      { name: 'plan-1', description: '', scope: 'user', mode: 'planning', source: 'user', shadows: [], path: '/b' },
      { name: 'auto-2', description: '', scope: 'project-team', mode: 'autonomous', source: 'project-team', shadows: [], path: '/c' },
    ];
    const result = selectPlaybookModeCounts(playbooks);
    expect(result.autonomous).toBe(2);
    expect(result.planning).toBe(1);
    expect(result.total).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Session-plan readiness selectors
// ---------------------------------------------------------------------------

describe('selectSessionPlanReadinessCounts', () => {
  it('returns zero counts for empty array', () => {
    const result = selectSessionPlanReadinessCounts([]);
    expect(result.ready).toBe(0);
    expect(result.notReady).toBe(0);
    expect(result.total).toBe(0);
    expect(result.byStatus).toEqual({});
  });

  it('counts plans by readiness and status', () => {
    const plans: SessionPlanListEntryWire[] = [
      { session: 'sess-1', topic: 'add feature', status: 'ready', path: '/a', ready: true, missingDimensions: [] },
      { session: 'sess-2', topic: 'fix bug', status: 'planning', path: '/b', ready: false, missingDimensions: ['acceptance_criteria'] },
      { session: 'sess-3', topic: 'refactor', status: 'ready', path: '/c', ready: true, missingDimensions: [] },
      { session: 'sess-4', topic: 'docs', status: 'abandoned', path: '/d', ready: false, missingDimensions: [] },
    ];
    const result = selectSessionPlanReadinessCounts(plans);
    expect(result.ready).toBe(2);
    expect(result.notReady).toBe(2);
    expect(result.total).toBe(4);
    expect(result.byStatus['ready']).toBe(2);
    expect(result.byStatus['planning']).toBe(1);
    expect(result.byStatus['abandoned']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Config source selectors
// ---------------------------------------------------------------------------

describe('selectConfigSourceRows', () => {
  it('returns empty array when sources is undefined', () => {
    const result = selectConfigSourceRows(undefined);
    expect(result).toEqual([]);
  });

  it('returns source rows from config sources', () => {
    const sources: ConfigShowVerboseResponse['sources'] = {
      local: { path: '/project/.eforge/config.yaml', found: true },
      project: { path: null, found: false },
      user: { path: '/home/user/.config/eforge/config.yaml', found: true },
    };
    const result = selectConfigSourceRows(sources);
    expect(result).toHaveLength(3);
    const local = result.find((r) => r.scope === 'local');
    expect(local).toBeDefined();
    expect(local!.path).toBe('/project/.eforge/config.yaml');
    expect(local!.found).toBe(true);
    const project = result.find((r) => r.scope === 'project');
    expect(project!.path).toBeNull();
    expect(project!.found).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Model selectors
// ---------------------------------------------------------------------------

describe('selectModelTotals', () => {
  it('returns zero counts for empty array', () => {
    const result = selectModelTotals([]);
    expect(result.total).toBe(0);
    expect(result.deprecated).toBe(0);
    expect(result.byProvider).toEqual({});
  });

  it('counts models, deprecated models, and groups by provider', () => {
    const models: ModelInfo[] = [
      { id: 'claude-3-5-sonnet', provider: 'anthropic', contextWindow: 200000, deprecated: false },
      { id: 'claude-3-haiku', provider: 'anthropic', contextWindow: 200000, deprecated: true },
      { id: 'claude-3-opus', provider: 'anthropic', contextWindow: 200000, deprecated: true },
      { id: 'gpt-4o', provider: 'openai', contextWindow: 128000 },
    ];
    const result = selectModelTotals(models);
    expect(result.total).toBe(4);
    expect(result.deprecated).toBe(2);
    expect(result.byProvider['anthropic']).toBe(3);
    expect(result.byProvider['openai']).toBe(1);
  });

  it('groups models without provider under unknown', () => {
    const models: ModelInfo[] = [
      { id: 'some-model' },
      { id: 'another-model' },
    ];
    const result = selectModelTotals(models);
    expect(result.byProvider['unknown']).toBe(2);
  });
});
