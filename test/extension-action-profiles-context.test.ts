import { describe, expect, it } from 'vitest';
import { Type } from '@eforge-build/extension-sdk';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import type { NativeExtensionRegistry } from '@eforge-build/engine/extensions/types.js';
import type { ProfileListResponse } from '@eforge-build/client';

function registry(): NativeExtensionRegistry {
  const { api, state } = createExtensionRecorder('profile-reader', '/extensions/profile-reader.ts');
  api.registerAction({
    id: 'inspect-profiles',
    title: 'Inspect profiles',
    inputSchema: Type.Object({ scope: Type.Optional(Type.Union([Type.Literal('local'), Type.Literal('project'), Type.Literal('user'), Type.Literal('all')])) }),
    outputSchema: Type.Object({}, { additionalProperties: true }),
    sideEffects: ['local-read'],
    async handler(input, ctx) {
      return ctx.profiles.list(typeof input.scope === 'string' ? { scope: input.scope as 'all' } : undefined);
    },
  });
  api.registerAction({
    id: 'describe-profiles-context',
    title: 'Describe profiles context',
    inputSchema: Type.Object({}),
    outputSchema: Type.Object({ keys: Type.Array(Type.String()) }),
    sideEffects: ['local-read'],
    async handler(_input, ctx) {
      return { keys: Object.keys(ctx.profiles).sort() };
    },
  });
  return { ...state, extensions: [], candidates: [] };
}

describe('extension action profile-list context service', () => {
  it('exposes a read-only shared profile-list service to action handlers', async () => {
    const response: ProfileListResponse = {
      active: 'team',
      source: 'project',
      profiles: [{ name: 'team', harness: 'pi', path: '/repo/eforge/profiles/team.yaml', scope: 'project', metadata: { description: 'Team profile' } }],
    };
    const calls: Array<{ extensionName: string; extensionPath: string; scope?: string }> = [];

    const result = await dispatchExtensionAction(registry(), {
      actionId: 'profile-reader:inspect-profiles',
      input: { scope: 'all' },
      requestedBy: { host: 'cli' },
      cwd: '/repo',
      timeoutMs: 1000,
      profiles: (extension) => ({
        async list(request) {
          calls.push({ ...extension, scope: request?.scope });
          return response;
        },
      }),
    });

    expect(result).toMatchObject({ kind: 'success', output: response });
    expect(calls).toEqual([{ extensionName: 'profile-reader', extensionPath: '/extensions/profile-reader.ts', scope: 'all' }]);
  });

  it('exposes only the read-only list operation on the profile context', async () => {
    const result = await dispatchExtensionAction(registry(), {
      actionId: 'profile-reader:describe-profiles-context',
      input: {},
      requestedBy: { host: 'cli' },
      cwd: '/repo',
      timeoutMs: 1000,
      profiles: () => ({
        async list() {
          return { active: null, source: 'none', profiles: [] };
        },
      }),
    });

    expect(result).toMatchObject({ kind: 'success', output: { keys: ['list'] } });
  });

  it('fails closed when the kernel does not provide profile listing', async () => {
    const result = await dispatchExtensionAction(registry(), {
      actionId: 'profile-reader:inspect-profiles',
      input: {},
      requestedBy: { host: 'cli' },
      cwd: '/repo',
      timeoutMs: 1000,
    });

    expect(result).toMatchObject({ kind: 'handler-error' });
  });
});
