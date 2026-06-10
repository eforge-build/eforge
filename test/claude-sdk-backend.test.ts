import { describe, it, expect } from 'vitest';
import { EforgePlanPlanningBacklogCurationDraftSchema } from '@eforge-build/client';
import { mapSDKMessages, resolveDisallowedTools, SUBAGENT_TOOL_NAME, typeboxObjectToZodRawShape } from '@eforge-build/engine/harnesses/claude-sdk';
import { EFORGE_DISALLOWED_TOOL_PATTERNS } from '@eforge-build/engine/harnesses/eforge-resource-filter';
import { MUTATION_TOOL_DENYLIST_CLAUDE, MUTATION_TOOL_DENYLIST_PI } from '@eforge-build/engine/harnesses/tool-safety';
import { AgentTerminalError } from '@eforge-build/engine/harness';

async function* iter<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

describe('typeboxObjectToZodRawShape', () => {
  it('converts the planning submit backlog curation draft schema with epic metadata', () => {
    const kind = Symbol.for('TypeBox.Kind');
    const shape = typeboxObjectToZodRawShape({
      type: 'object',
      properties: { backlogCurationDraft: EforgePlanPlanningBacklogCurationDraftSchema },
      required: ['backlogCurationDraft'],
      [kind]: 'Object',
    } as never);

    expect(() => shape.backlogCurationDraft.parse({
      schemaVersion: 1,
      sourceFingerprint: 'source-fingerprint-1',
      summary: ['Curated stale backlog records.'],
      itemChanges: [],
      epicChanges: [{
        id: 'epic-1',
        kind: 'epic',
        precondition: { id: 'epic-1', kind: 'epic', bodySha256: 'a'.repeat(64) },
        metadata: { priority: 'high' },
      }],
      noOpRechecks: [],
      skipped: [],
      needsInput: [],
    })).not.toThrow();
  });

  it('rejects extra fields for closed TypeBox objects', () => {
    const kind = Symbol.for('TypeBox.Kind');
    const shape = typeboxObjectToZodRawShape({
      type: 'object',
      properties: { backlogCurationDraft: EforgePlanPlanningBacklogCurationDraftSchema },
      required: ['backlogCurationDraft'],
      [kind]: 'Object',
    } as never);

    expect(() => shape.backlogCurationDraft.parse({
      schemaVersion: 1,
      sourceFingerprint: 'source-fingerprint-1',
      summary: [],
      itemChanges: [],
      epicChanges: [],
      noOpRechecks: [],
      skipped: [],
      needsInput: [],
      extra: 'reject-me',
    })).toThrow();
  });

  it('preserves open-object recommendation fields', () => {
    const kind = Symbol.for('TypeBox.Kind');
    const stringSchema = { type: 'string', [kind]: 'String' };
    const shape = typeboxObjectToZodRawShape({
      type: 'object',
      properties: {
        recommendations: { type: 'object', properties: { schemaVersion: { type: 'number', [kind]: 'Number' } }, required: ['schemaVersion'], additionalProperties: true, [kind]: 'Object' },
        typedExtras: { type: 'object', properties: { known: stringSchema }, required: ['known'], additionalProperties: stringSchema, [kind]: 'Object' },
      },
      required: ['recommendations', 'typedExtras'],
      [kind]: 'Object',
    } as never);
    const parsedRecommendations = shape.recommendations.parse({ schemaVersion: 1, readyCandidates: [{ itemId: 'item-one' }], rationaleAndAssumptions: ['ready'] });
    const parsedTypedExtras = shape.typedExtras.parse({ known: 'yes', dynamic: 'kept' });

    expect(parsedRecommendations).toMatchObject({ readyCandidates: [{ itemId: 'item-one' }], rationaleAndAssumptions: ['ready'] });
    expect(parsedTypedExtras).toEqual({ known: 'yes', dynamic: 'kept' });
  });
});

describe('mapSDKMessages error formatting', () => {
  // Regression: the SDK's result error carries both a `subtype` (e.g. `error_max_turns`)
  // and a human-readable `errors[]`. The backend must throw `AgentTerminalError` carrying
  // the subtype so pipeline continuation logic can branch on it without parsing strings.
  it('throws AgentTerminalError with subtype when SDK errors[] is populated', async () => {
    const msgs = [
      {
        type: 'result',
        subtype: 'error_max_turns',
        is_error: true,
        errors: ['Reached maximum number of turns (30).'],
        duration_ms: 0,
        duration_api_ms: 0,
        num_turns: 30,
        stop_reason: null,
        total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
        uuid: '00000000-0000-0000-0000-000000000000',
      },
    ] as unknown[];

    const gen = mapSDKMessages(iter(msgs as never[]), 'builder', 'agent-id', 'plan-01');

    let caught: unknown;
    try {
      for await (const _ of gen) { /* drain */ }
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AgentTerminalError);
    const terminal = caught as AgentTerminalError;
    expect(terminal.subtype).toBe('error_max_turns');
    expect(terminal.message).toContain('Reached maximum number of turns');
  });

  it('throws AgentTerminalError with subtype when errors[] is empty', async () => {
    const msgs = [
      {
        type: 'result',
        subtype: 'error_max_turns',
        is_error: true,
        duration_ms: 0,
        duration_api_ms: 0,
        num_turns: 30,
        stop_reason: null,
        total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
        uuid: '00000000-0000-0000-0000-000000000000',
      },
    ] as unknown[];

    const gen = mapSDKMessages(iter(msgs as never[]), 'builder', 'agent-id', 'plan-01');

    let caught: unknown;
    try {
      for await (const _ of gen) { /* drain */ }
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AgentTerminalError);
    expect((caught as AgentTerminalError).subtype).toBe('error_max_turns');
  });
});

describe('resolveDisallowedTools', () => {
  // eforge patterns (mcp__eforge__*) are ALWAYS appended so that the eforge
  // Claude Code plugin cannot be invoked recursively by any agent, even when
  // the user configures settingSources so that the plugin is loaded. Each of
  // the following tests verifies both the pass-through of user-supplied
  // values and the presence of the eforge patterns.
  const eforgePatterns = [...EFORGE_DISALLOWED_TOOL_PATTERNS];

  it('returns only eforge patterns when nothing is disallowed and subagents are allowed', () => {
    expect(resolveDisallowedTools(undefined, false)).toEqual(eforgePatterns);
    expect(resolveDisallowedTools([], false)).toEqual(eforgePatterns);
  });

  it('returns the role list plus eforge patterns when subagents are allowed', () => {
    expect(resolveDisallowedTools(['Bash', 'Write'], false)).toEqual(['Bash', 'Write', ...eforgePatterns]);
  });

  it('does not mutate the caller-supplied role list', () => {
    const roleList = ['Bash'];
    const resolved = resolveDisallowedTools(roleList, false);
    expect(resolved).not.toBe(roleList);
    expect(roleList).toEqual(['Bash']);
  });

  it('appends Task and eforge patterns when disableSubagents is true and role has no disallowedTools', () => {
    expect(resolveDisallowedTools(undefined, true)).toEqual([SUBAGENT_TOOL_NAME, ...eforgePatterns]);
  });

  it('appends Task and eforge patterns to an existing role disallowedTools list', () => {
    expect(resolveDisallowedTools(['Bash', 'Write'], true)).toEqual(['Bash', 'Write', SUBAGENT_TOOL_NAME, ...eforgePatterns]);
  });

  it('does not duplicate Task when the role already disallows it', () => {
    const resolved = resolveDisallowedTools(['Task', 'Bash'], true);
    expect(resolved.filter((t) => t === 'Task').length).toBe(1);
    expect(resolved).toEqual(['Task', 'Bash', ...eforgePatterns]);
  });

  it('does not duplicate eforge patterns when the role already disallows them', () => {
    const resolved = resolveDisallowedTools(['mcp__eforge__*', 'Bash'], false);
    expect(resolved.filter((t) => t === 'mcp__eforge__*').length).toBe(1);
    expect(resolved).toEqual(['mcp__eforge__*', 'Bash']);
  });

  it('exposes Task as the subagent tool name', () => {
    expect(SUBAGENT_TOOL_NAME).toBe('Task');
  });

  it('blocks the eforge MCP server via mcp__eforge__* pattern', () => {
    expect(EFORGE_DISALLOWED_TOOL_PATTERNS).toContain('mcp__eforge__*');
  });
});

describe('read-only mode denylist constants', () => {
  it('MUTATION_TOOL_DENYLIST_CLAUDE covers expected PascalCase tools', () => {
    expect(MUTATION_TOOL_DENYLIST_CLAUDE).toContain('Write');
    expect(MUTATION_TOOL_DENYLIST_CLAUDE).toContain('Edit');
    expect(MUTATION_TOOL_DENYLIST_CLAUDE).toContain('MultiEdit');
    expect(MUTATION_TOOL_DENYLIST_CLAUDE).toContain('NotebookEdit');
    expect(MUTATION_TOOL_DENYLIST_CLAUDE).toContain('Bash');
    expect(MUTATION_TOOL_DENYLIST_CLAUDE).not.toContain('Task');
  });

  it('MUTATION_TOOL_DENYLIST_PI covers expected lowercase tools', () => {
    expect(MUTATION_TOOL_DENYLIST_PI).toContain('write');
    expect(MUTATION_TOOL_DENYLIST_PI).toContain('edit');
    expect(MUTATION_TOOL_DENYLIST_PI).toContain('bash');
  });

  it('resolveDisallowedTools for read-only mode includes Task and mutation tools', () => {
    // Simulate what the Claude SDK harness does for read-only mode:
    // mutation tools + Task + eforge patterns
    const readOnlyDenylist = resolveDisallowedTools(
      [...MUTATION_TOOL_DENYLIST_CLAUDE, SUBAGENT_TOOL_NAME],
      false,
    );
    expect(readOnlyDenylist).toEqual(expect.arrayContaining([
      'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'Task',
    ]));
    // eforge patterns must also be present
    for (const pattern of EFORGE_DISALLOWED_TOOL_PATTERNS) {
      expect(readOnlyDenylist).toContain(pattern);
    }
  });
});
