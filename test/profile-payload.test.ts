import { describe, it, expect } from 'vitest';
import { buildProfileCreatePayload } from '../packages/pi-eforge/extensions/eforge/profile-payload';

// ---------------------------------------------------------------------------
// buildProfileCreatePayload — tier-recipe shape
// ---------------------------------------------------------------------------

describe('buildProfileCreatePayload', () => {
  it('returns exactly name, scope, agents as top-level keys', () => {
    const payload = buildProfileCreatePayload({
      name: 'my-profile',
      scope: 'project',
      tiers: {
        planning:       { harness: 'claude-sdk', modelId: 'claude-opus-4-7',   effort: 'high' },
        implementation: { harness: 'claude-sdk', modelId: 'claude-sonnet-4-6', effort: 'medium' },
        review:         { harness: 'claude-sdk', modelId: 'claude-haiku-4-5',  effort: 'low' },
        evaluation:     { harness: 'claude-sdk', modelId: 'claude-haiku-4-5',  effort: 'low' },
      },
    });

    expect(Object.keys(payload).sort()).toEqual(['agents', 'name', 'scope']);
  });

  it('agents contains only tiers — no agentRuntimes, no defaultAgentRuntime, no agents.models', () => {
    const payload = buildProfileCreatePayload({
      name: 'clean',
      scope: 'project',
      tiers: {
        planning:       { harness: 'claude-sdk', modelId: 'model-a', effort: 'high' },
        implementation: { harness: 'claude-sdk', modelId: 'model-b', effort: 'medium' },
        review:         { harness: 'claude-sdk', modelId: 'model-c', effort: 'low' },
        evaluation:     { harness: 'claude-sdk', modelId: 'model-d', effort: 'low' },
      },
    });

    expect(Object.keys(payload.agents)).toEqual(['tiers']);
    expect((payload as Record<string, unknown>)['agentRuntimes']).toBeUndefined();
    expect((payload as Record<string, unknown>)['defaultAgentRuntime']).toBeUndefined();
    expect((payload.agents as Record<string, unknown>)['models']).toBeUndefined();
    expect((payload.agents as Record<string, unknown>)['agentRuntimes']).toBeUndefined();
    expect((payload.agents as Record<string, unknown>)['defaultAgentRuntime']).toBeUndefined();
  });

  it('emits all four built-in tiers', () => {
    const payload = buildProfileCreatePayload({
      name: 'four-tiers',
      scope: 'user',
      tiers: {
        planning:       { harness: 'claude-sdk', modelId: 'claude-opus-4-7',   effort: 'high' },
        implementation: { harness: 'claude-sdk', modelId: 'claude-sonnet-4-6', effort: 'medium' },
        review:         { harness: 'claude-sdk', modelId: 'claude-haiku-4-5',  effort: 'low' },
        evaluation:     { harness: 'claude-sdk', modelId: 'claude-haiku-4-5',  effort: 'low' },
      },
    });

    expect(Object.keys(payload.agents.tiers).sort()).toEqual(
      ['evaluation', 'implementation', 'planning', 'review'],
    );
  });

  it('each tier entry has harness, model, effort', () => {
    const payload = buildProfileCreatePayload({
      name: 'check-fields',
      scope: 'project',
      tiers: {
        planning:       { harness: 'claude-sdk', modelId: 'claude-opus-4-7',   effort: 'high' },
        implementation: { harness: 'claude-sdk', modelId: 'claude-sonnet-4-6', effort: 'medium' },
        review:         { harness: 'claude-sdk', modelId: 'claude-haiku-4-5',  effort: 'low' },
        evaluation:     { harness: 'claude-sdk', modelId: 'claude-haiku-4-5',  effort: 'low' },
      },
    });

    expect(payload.agents.tiers.planning).toEqual({ harness: 'claude-sdk', model: 'claude-opus-4-7', effort: 'high' });
    expect(payload.agents.tiers.implementation).toEqual({ harness: 'claude-sdk', model: 'claude-sonnet-4-6', effort: 'medium' });
    expect(payload.agents.tiers.review).toEqual({ harness: 'claude-sdk', model: 'claude-haiku-4-5', effort: 'low' });
    expect(payload.agents.tiers.evaluation).toEqual({ harness: 'claude-sdk', model: 'claude-haiku-4-5', effort: 'low' });
  });

  it('pi tier includes pi.provider', () => {
    const payload = buildProfileCreatePayload({
      name: 'pi-profile',
      scope: 'user',
      tiers: {
        planning:       { harness: 'pi', provider: 'anthropic', modelId: 'claude-opus-4-7',   effort: 'high' },
        implementation: { harness: 'pi', provider: 'anthropic', modelId: 'claude-sonnet-4-6', effort: 'medium' },
        review:         { harness: 'pi', provider: 'anthropic', modelId: 'claude-haiku-4-5',  effort: 'low' },
        evaluation:     { harness: 'pi', provider: 'anthropic', modelId: 'claude-haiku-4-5',  effort: 'low' },
      },
    });

    expect(payload.agents.tiers.planning).toEqual({
      harness: 'pi',
      pi: { provider: 'anthropic' },
      model: 'claude-opus-4-7',
      effort: 'high',
    });
    expect(payload.agents.tiers.implementation.pi?.provider).toBe('anthropic');
  });

  it('claude-sdk tier does not include pi field', () => {
    const payload = buildProfileCreatePayload({
      name: 'sdk-only',
      scope: 'project',
      tiers: {
        planning:       { harness: 'claude-sdk', modelId: 'model-a', effort: 'high' },
        implementation: { harness: 'claude-sdk', modelId: 'model-b', effort: 'medium' },
        review:         { harness: 'claude-sdk', modelId: 'model-c', effort: 'low' },
        evaluation:     { harness: 'claude-sdk', modelId: 'model-d', effort: 'low' },
      },
    });

    expect((payload.agents.tiers.planning as Record<string, unknown>)['pi']).toBeUndefined();
    expect((payload.agents.tiers.implementation as Record<string, unknown>)['pi']).toBeUndefined();
  });

  it('mixed harnesses across tiers are all preserved', () => {
    const payload = buildProfileCreatePayload({
      name: 'mixed',
      scope: 'project',
      tiers: {
        planning:       { harness: 'claude-sdk', modelId: 'claude-opus-4-7',   effort: 'high' },
        implementation: { harness: 'pi', provider: 'anthropic', modelId: 'claude-sonnet-4-6', effort: 'medium' },
        review:         { harness: 'pi', provider: 'openrouter', modelId: 'some-model',        effort: 'low' },
        evaluation:     { harness: 'claude-sdk', modelId: 'claude-haiku-4-5',  effort: 'low' },
      },
    });

    expect(payload.agents.tiers.planning.harness).toBe('claude-sdk');
    expect(payload.agents.tiers.implementation.harness).toBe('pi');
    expect(payload.agents.tiers.implementation.pi?.provider).toBe('anthropic');
    expect(payload.agents.tiers.review.harness).toBe('pi');
    expect(payload.agents.tiers.review.pi?.provider).toBe('openrouter');
    expect(payload.agents.tiers.evaluation.harness).toBe('claude-sdk');
  });

  it('name and scope are preserved in the payload', () => {
    const payload = buildProfileCreatePayload({
      name: 'my-profile',
      scope: 'user',
      tiers: {
        planning:       { harness: 'claude-sdk', modelId: 'model-a', effort: 'high' },
        implementation: { harness: 'claude-sdk', modelId: 'model-b', effort: 'medium' },
        review:         { harness: 'claude-sdk', modelId: 'model-c', effort: 'low' },
        evaluation:     { harness: 'claude-sdk', modelId: 'model-d', effort: 'low' },
      },
    });

    expect(payload.name).toBe('my-profile');
    expect(payload.scope).toBe('user');
  });

  it('does not emit effort/pi at top-level or agents level', () => {
    const payload = buildProfileCreatePayload({
      name: 'clean',
      scope: 'project',
      tiers: {
        planning:       { harness: 'claude-sdk', modelId: 'model-a', effort: 'high' },
        implementation: { harness: 'claude-sdk', modelId: 'model-b', effort: 'medium' },
        review:         { harness: 'claude-sdk', modelId: 'model-c', effort: 'low' },
        evaluation:     { harness: 'claude-sdk', modelId: 'model-d', effort: 'low' },
      },
    });

    const payloadAny = payload as Record<string, unknown>;
    expect(payloadAny['effort']).toBeUndefined();
    expect(payloadAny['pi']).toBeUndefined();
    expect(payloadAny['harness']).toBeUndefined();
    const agentsAny = payload.agents as Record<string, unknown>;
    expect(agentsAny['effort']).toBeUndefined();
    expect(agentsAny['pi']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildProfileCreatePayload — toolbelt field pass-through
// ---------------------------------------------------------------------------

describe('toolbelt field pass-through', () => {
  it('emits toolbelt on tier entry when set in TierSelection', () => {
    const payload = buildProfileCreatePayload({
      name: 'toolbelt-profile',
      scope: 'project',
      tiers: {
        planning:       { harness: 'claude-sdk', modelId: 'claude-opus-4-7',   effort: 'high',   toolbelt: 'none' },
        implementation: { harness: 'claude-sdk', modelId: 'claude-sonnet-4-6', effort: 'medium', toolbelt: 'browser-ui' },
        review:         { harness: 'claude-sdk', modelId: 'claude-haiku-4-5',  effort: 'low',    toolbelt: 'browser-ui' },
        evaluation:     { harness: 'claude-sdk', modelId: 'claude-haiku-4-5',  effort: 'low',    toolbelt: 'none' },
      },
    });

    expect(payload.agents.tiers.planning.toolbelt).toBe('none');
    expect(payload.agents.tiers.implementation.toolbelt).toBe('browser-ui');
    expect(payload.agents.tiers.review.toolbelt).toBe('browser-ui');
    expect(payload.agents.tiers.evaluation.toolbelt).toBe('none');
  });

  it('omits toolbelt from tier entry when not set in TierSelection', () => {
    const payload = buildProfileCreatePayload({
      name: 'no-toolbelt',
      scope: 'project',
      tiers: {
        planning:       { harness: 'claude-sdk', modelId: 'model-a', effort: 'high' },
        implementation: { harness: 'claude-sdk', modelId: 'model-b', effort: 'medium' },
        review:         { harness: 'claude-sdk', modelId: 'model-c', effort: 'low' },
        evaluation:     { harness: 'claude-sdk', modelId: 'model-d', effort: 'low' },
      },
    });

    expect((payload.agents.tiers.planning as Record<string, unknown>)['toolbelt']).toBeUndefined();
    expect((payload.agents.tiers.implementation as Record<string, unknown>)['toolbelt']).toBeUndefined();
    expect((payload.agents.tiers.review as Record<string, unknown>)['toolbelt']).toBeUndefined();
    expect((payload.agents.tiers.evaluation as Record<string, unknown>)['toolbelt']).toBeUndefined();
  });

  it('supports mixed tiers where only some have toolbelt set', () => {
    const payload = buildProfileCreatePayload({
      name: 'partial-toolbelt',
      scope: 'user',
      tiers: {
        planning:       { harness: 'claude-sdk', modelId: 'model-a', effort: 'high',   toolbelt: 'docs-research' },
        implementation: { harness: 'claude-sdk', modelId: 'model-b', effort: 'medium' },
        review:         { harness: 'claude-sdk', modelId: 'model-c', effort: 'low' },
        evaluation:     { harness: 'claude-sdk', modelId: 'model-d', effort: 'low' },
      },
    });

    expect(payload.agents.tiers.planning.toolbelt).toBe('docs-research');
    expect((payload.agents.tiers.implementation as Record<string, unknown>)['toolbelt']).toBeUndefined();
  });

  it('TierSelection toolbelt does not affect top-level payload keys', () => {
    const payload = buildProfileCreatePayload({
      name: 'toolbelt-keys',
      scope: 'project',
      tiers: {
        planning:       { harness: 'claude-sdk', modelId: 'model-a', effort: 'high',   toolbelt: 'none' },
        implementation: { harness: 'claude-sdk', modelId: 'model-b', effort: 'medium', toolbelt: 'browser-ui' },
        review:         { harness: 'claude-sdk', modelId: 'model-c', effort: 'low',    toolbelt: 'browser-ui' },
        evaluation:     { harness: 'claude-sdk', modelId: 'model-d', effort: 'low',    toolbelt: 'none' },
      },
    });

    // toolbelt should only appear inside tier entries, not at top level
    const payloadAny = payload as Record<string, unknown>;
    expect(payloadAny['toolbelt']).toBeUndefined();
    expect((payload.agents as Record<string, unknown>)['toolbelt']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildProfileCreatePayload — runtime choices and routing
// ---------------------------------------------------------------------------

describe('runtime choices and routing pass-through', () => {
  it('serializes implementation.ui, implementation.backend, and ordered routing rules', () => {
    const payload = buildProfileCreatePayload({
      name: 'implementation-routing',
      scope: 'project',
      tiers: {
        planning:       { harness: 'pi', provider: 'openrouter', modelId: 'anthropic/claude-opus-4-6',   effort: 'high' },
        implementation: { harness: 'pi', provider: 'openrouter', modelId: 'anthropic/claude-sonnet-4-6', effort: 'medium' },
        review:         { harness: 'pi', provider: 'openrouter', modelId: 'anthropic/claude-opus-4-6',   effort: 'high' },
        evaluation:     { harness: 'pi', provider: 'openrouter', modelId: 'anthropic/claude-opus-4-6',   effort: 'high' },
      },
      runtimeChoices: {
        implementation: {
          choices: {
            backend: {
              modelId: 'qwen3-coder',
              provider: 'local',
              toolbelt: 'none',
            },
            ui: {
              effort: 'high',
              toolbelt: 'browser-ui',
            },
          },
          routing: {
            rules: [
              {
                name: 'ui-paths',
                choice: 'ui',
                when: {
                  pathGlobs: ['packages/console-ui/**', 'web/**', '**/*.{tsx,jsx,css}'],
                  keywords: ['ui', 'frontend', 'browser', 'component'],
                },
              },
              {
                name: 'backend-paths',
                choice: 'backend',
                when: {
                  pathGlobs: ['packages/engine/**', 'packages/client/**', 'packages/monitor/**'],
                },
              },
            ],
          },
        },
      },
    });

    expect(payload.agents.tiers.implementation.choices).toEqual({
      backend: {
        pi: { provider: 'local' },
        model: 'qwen3-coder',
        toolbelt: 'none',
      },
      ui: {
        effort: 'high',
        toolbelt: 'browser-ui',
      },
    });
    expect(payload.agents.tiers.implementation.routing).toEqual({
      rules: [
        {
          name: 'ui-paths',
          choice: 'ui',
          when: {
            pathGlobs: ['packages/console-ui/**', 'web/**', '**/*.{tsx,jsx,css}'],
            keywords: ['ui', 'frontend', 'browser', 'component'],
          },
        },
        {
          name: 'backend-paths',
          choice: 'backend',
          when: {
            pathGlobs: ['packages/engine/**', 'packages/client/**', 'packages/monitor/**'],
          },
        },
      ],
    });
    expect((payload.agents.tiers.planning as Record<string, unknown>)['choices']).toBeUndefined();
    expect((payload.agents.tiers.review as Record<string, unknown>)['routing']).toBeUndefined();
  });

  it('supports inherited choices that override only effort and toolbelt', () => {
    const payload = buildProfileCreatePayload({
      name: 'inherited-ui',
      scope: 'local',
      tiers: {
        planning:       { harness: 'pi', provider: 'openrouter', modelId: 'model-a', effort: 'high' },
        implementation: { harness: 'pi', provider: 'openrouter', modelId: 'model-b', effort: 'medium' },
        review:         { harness: 'pi', provider: 'openrouter', modelId: 'model-c', effort: 'low' },
        evaluation:     { harness: 'pi', provider: 'openrouter', modelId: 'model-d', effort: 'low' },
      },
      runtimeChoices: {
        implementation: {
          choices: {
            ui: { effort: 'high', toolbelt: 'browser-ui' },
          },
        },
      },
    });

    expect(payload.agents.tiers.implementation.choices?.ui).toEqual({
      effort: 'high',
      toolbelt: 'browser-ui',
    });
  });
});

// ---------------------------------------------------------------------------
// buildProfileCreatePayload — metadata pass-through
// ---------------------------------------------------------------------------

describe('metadata pass-through', () => {
  it('includes full metadata when all fields are provided', () => {
    const payload = buildProfileCreatePayload({
      name: 'meta-profile',
      scope: 'project',
      tiers: {
        planning:       { harness: 'claude-sdk', modelId: 'claude-opus-4-7',   effort: 'high' },
        implementation: { harness: 'claude-sdk', modelId: 'claude-sonnet-4-6', effort: 'medium' },
        review:         { harness: 'claude-sdk', modelId: 'claude-haiku-4-5',  effort: 'low' },
        evaluation:     { harness: 'claude-sdk', modelId: 'claude-haiku-4-5',  effort: 'low' },
      },
      metadata: { description: 'My profile', whenToUse: ['ci', 'review'], tags: ['fast', 'cheap'] },
    });

    expect(payload.metadata).toEqual({
      description: 'My profile',
      whenToUse: ['ci', 'review'],
      tags: ['fast', 'cheap'],
    });
    expect(Object.keys(payload).sort()).toEqual(['agents', 'metadata', 'name', 'scope']);
  });

  it('omits metadata key entirely when not provided', () => {
    const payload = buildProfileCreatePayload({
      name: 'no-meta',
      scope: 'project',
      tiers: {
        planning:       { harness: 'claude-sdk', modelId: 'model-a', effort: 'high' },
        implementation: { harness: 'claude-sdk', modelId: 'model-b', effort: 'medium' },
        review:         { harness: 'claude-sdk', modelId: 'model-c', effort: 'low' },
        evaluation:     { harness: 'claude-sdk', modelId: 'model-d', effort: 'low' },
      },
    });

    expect((payload as Record<string, unknown>)['metadata']).toBeUndefined();
    expect(Object.keys(payload).sort()).toEqual(['agents', 'name', 'scope']);
  });

  it('handles partial metadata (only description)', () => {
    const payload = buildProfileCreatePayload({
      name: 'partial-meta',
      scope: 'user',
      tiers: {
        planning:       { harness: 'claude-sdk', modelId: 'model-a', effort: 'high' },
        implementation: { harness: 'claude-sdk', modelId: 'model-b', effort: 'medium' },
        review:         { harness: 'claude-sdk', modelId: 'model-c', effort: 'low' },
        evaluation:     { harness: 'claude-sdk', modelId: 'model-d', effort: 'low' },
      },
      metadata: { description: 'Just a description' },
    });

    expect(payload.metadata).toEqual({ description: 'Just a description' });
    expect((payload.metadata as Record<string, unknown>)['whenToUse']).toBeUndefined();
    expect((payload.metadata as Record<string, unknown>)['tags']).toBeUndefined();
  });

  it('handles partial metadata (only tags)', () => {
    const payload = buildProfileCreatePayload({
      name: 'tags-only',
      scope: 'local',
      tiers: {
        planning:       { harness: 'claude-sdk', modelId: 'model-a', effort: 'high' },
        implementation: { harness: 'claude-sdk', modelId: 'model-b', effort: 'medium' },
        review:         { harness: 'claude-sdk', modelId: 'model-c', effort: 'low' },
        evaluation:     { harness: 'claude-sdk', modelId: 'model-d', effort: 'low' },
      },
      metadata: { tags: ['production', 'high-quality'] },
    });

    expect(payload.metadata).toEqual({ tags: ['production', 'high-quality'] });
    expect((payload.metadata as Record<string, unknown>)['description']).toBeUndefined();
    expect((payload.metadata as Record<string, unknown>)['whenToUse']).toBeUndefined();
  });

  it('metadata is preserved at top level (not nested inside agents)', () => {
    const payload = buildProfileCreatePayload({
      name: 'top-level-meta',
      scope: 'project',
      tiers: {
        planning:       { harness: 'claude-sdk', modelId: 'model-a', effort: 'high' },
        implementation: { harness: 'claude-sdk', modelId: 'model-b', effort: 'medium' },
        review:         { harness: 'claude-sdk', modelId: 'model-c', effort: 'low' },
        evaluation:     { harness: 'claude-sdk', modelId: 'model-d', effort: 'low' },
      },
      metadata: { description: 'top-level test' },
    });

    // Metadata is top-level, not inside agents
    expect(payload.metadata).toBeDefined();
    expect((payload.agents as Record<string, unknown>)['metadata']).toBeUndefined();
  });
});
