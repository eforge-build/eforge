import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  API_ROUTES,
  buildProfileListPath,
  safeParseExtensionActionInvokeResponse,
  safeParseExtensionContributionManifest,
} from '@eforge-build/client';
import { createExtensionContentRoutes } from '../routes/extension-content.js';
import { createProfileRoutes } from '../routes/profiles.js';
import { startContentRouteHarness, type RouteHarness } from './route-test-harness.js';

async function seedExtension(cwd: string, body: string, timeoutMs = 1000): Promise<void> {
  const dir = join(cwd, '.eforge', 'extensions');
  await mkdir(dir, { recursive: true });
  const extensionPath = join(dir, 'tools.mjs');
  await writeFile(extensionPath, body);
  await mkdir(join(cwd, 'eforge'), { recursive: true });
  await writeFile(join(cwd, 'eforge', 'config.yaml'), [
    'extensions:',
    '  enabled: true',
    `  eventHookTimeoutMs: ${timeoutMs}`,
    '',
  ].join('\n'));
}

const extensionSource = `
import { Type, ExtensionActionInputValidationError, ExtensionActionUserError } from '@eforge-build/extension-sdk';

export default function extension(eforge) {
  const empty = Type.Object({});
  eforge.registerAction({
    id: 'echo',
    title: 'Echo',
    inputSchema: Type.Object({ message: Type.String() }, { additionalProperties: false }),
    outputSchema: Type.Object({ reply: Type.String() }, { additionalProperties: false }),
    handler(input) { return { reply: 'out-secret:' + input.message }; }
  });
  eforge.registerAction({ id: 'throws', title: 'Throws', inputSchema: empty, handler() { throw new Error('boom'); } });
  eforge.registerAction({ id: 'structured-invalid', title: 'Structured invalid', inputSchema: empty, handler() { throw new ExtensionActionInputValidationError('Bad references.', [{ path: 'items[0]', message: 'Closed item.', id: 'item-1', kind: 'item', reason: 'closed', status: 'shipped', title: 'Done' }]); } });
  eforge.registerAction({ id: 'user-error', title: 'User error', inputSchema: empty, handler() { throw new ExtensionActionUserError('Select exactly one backlog source.', [{ path: 'itemIds', message: 'Cannot combine itemIds with recommendationRef.', selectorCount: 2 }]); } });
  eforge.registerAction({ id: 'bad-output', title: 'Bad output', inputSchema: empty, handler() { return undefined; } });
  eforge.registerAction({ id: 'schema-output', title: 'Schema output', inputSchema: empty, outputSchema: Type.Object({ ok: Type.Boolean() }), handler() { return { ok: 'no' }; } });
  eforge.registerAction({ id: 'slow', title: 'Slow', inputSchema: empty, async handler() { await new Promise((resolve) => setTimeout(resolve, 50)); return { ok: true }; } });
  eforge.registerAction({ id: 'enqueue-build', title: 'Enqueue build', inputSchema: empty, async handler(_input, ctx) { return await ctx.buildQueue.enqueue({ source: 'prd.md', postMerge: ['pnpm build'], landingAction: 'leave' }); } });
  eforge.registerAction({ id: 'read-profiles', title: 'Read profiles', inputSchema: Type.Object({ scope: Type.Optional(Type.Union([Type.Literal('local'), Type.Literal('project'), Type.Literal('user'), Type.Literal('all')])) }), async handler(input, ctx) { return await ctx.profiles.list({ scope: input.scope ?? 'all' }); } });
  eforge.registerConsoleContribution({ id: 'panel', title: 'Panel', blocks: [{ rendererId: 'text', content: 'Hello' }] });
  eforge.registerConsoleWorkstation({ id: 'board', title: 'Board', srcDoc: '<h1>Board</h1>', allowedActions: ['echo'] });
  eforge.registerIntegrationCommand({ id: 'cmd', label: 'Echo command', action: { actionId: 'echo' } });
  eforge.registerDeepLink({ id: 'link', label: 'Echo link', action: { actionId: 'echo' } });
}
`;

describe('extension contribution routes', () => {
  it('returns a safe contribution manifest for loaded extensions', async () => {
    const harness = await startContentRouteHarness();
    try {
      await seedExtension(harness.cwd, extensionSource);
      const res = await harness.get(API_ROUTES.extensionContributionManifest);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(safeParseExtensionContributionManifest(body).success).toBe(true);
      expect(body.actions.length).toBeGreaterThan(0);
      expect(body.consoleContributions.length).toBeGreaterThan(0);
      expect(body.consoleWorkstations).toEqual([expect.objectContaining({ id: 'tools:board', allowedActions: ['tools:echo'], srcDoc: '<h1>Board</h1>' })]);
      expect(body.integrationCommands.length).toBeGreaterThan(0);
      expect(body.deepLinks.length).toBeGreaterThan(0);
      expect(JSON.stringify(body)).not.toMatch(/handler|module|out-secret/);
    } finally { await harness.close(); }
  });

  it('protects contribution manifest reads from non-local and cross-site browser requests', async () => {
    const harness = await startContentRouteHarness();
    try {
      expect((await harness.rawGet(API_ROUTES.extensionContributionManifest, { Host: 'example.com' })).status).toBe(403);
      expect((await harness.rawGet(API_ROUTES.extensionContributionManifest, { Host: 'localhost', Origin: 'http://evil.example' })).status).toBe(403);
      expect((await harness.rawGet(API_ROUTES.extensionContributionManifest, { Host: 'localhost', 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    } finally { await harness.close(); }
  });

  it('protects action invocations before reading malformed JSON bodies', async () => {
    const harness = await startContentRouteHarness();
    try {
      expect((await harness.rawPostJson(API_ROUTES.extensionActionInvoke, {}, { Host: 'example.com' })).status).toBe(403);
      expect((await harness.rawPostJson(API_ROUTES.extensionActionInvoke, {}, { Host: 'localhost', 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    } finally { await harness.close(); }
  });

  it('invokes known actions and returns typed success responses', async () => {
    const harness = await startContentRouteHarness();
    try {
      await seedExtension(harness.cwd, extensionSource);
      const echoId = await actionIdFor(harness, 'echo');
      const { res, body } = await invoke(harness, echoId, { message: 'in-secret' });
      expect(res.status).toBe(200);
      expect(body).toMatchObject({ ok: true, output: { reply: 'out-secret:in-secret' } });
    } finally { await harness.close(); }
  });

  it.each([
    ['unknown action', 'missing.action', {}, 404, 'unknown-action'],
    ['invalid input', 'echo', {}, 400, 'invalid-input'],
    ['handler throw', 'throws', {}, 500, 'handler-error'],
    ['user error', 'user-error', {}, 400, 'invalid-input'],
    ['non-JSON-safe output', 'bad-output', {}, 500, 'invalid-output'],
    ['output schema failure', 'schema-output', {}, 500, 'output-schema-failed'],
  ])('maps %s dispatcher outcomes to typed failure responses', async (_label, localOrEffectiveId, input, status, code) => {
    const harness = await startContentRouteHarness();
    try {
      await seedExtension(harness.cwd, extensionSource);
      const actionId = localOrEffectiveId.includes('.') ? localOrEffectiveId : await actionIdFor(harness, localOrEffectiveId);
      const { res, body } = await invoke(harness, actionId, input);
      expect(res.status).toBe(status);
      expect(body).toMatchObject({ ok: false, error: { code } });
    } finally { await harness.close(); }
  });

  it('preserves structured validation and user errors in action failure responses', async () => {
    const harness = await startContentRouteHarness();
    try {
      await seedExtension(harness.cwd, extensionSource);
      const structured = await invoke(harness, await actionIdFor(harness, 'structured-invalid'), {});
      expect(structured.res.status).toBe(400);
      expect(structured.body).toMatchObject({
        ok: false,
        error: { code: 'invalid-input', details: [{ id: 'item-1', kind: 'item', reason: 'closed', status: 'shipped' }] },
      });
      const userError = await invoke(harness, await actionIdFor(harness, 'user-error'), {});
      expect(userError.res.status).toBe(400);
      expect(userError.body).toMatchObject({
        ok: false,
        error: { code: 'invalid-input', message: 'Select exactly one backlog source.', details: [{ selectorCount: 2 }] },
      });
    } finally { await harness.close(); }
  });

  it('invokes profile-list context through the daemon contribution route wiring', async () => {
    const harness = await startContentRouteHarness({ routes: (context) => [...createExtensionContentRoutes(context), ...createProfileRoutes(context)] });
    try {
      await seedExtension(harness.cwd, extensionSource);
      await mkdir(join(harness.cwd, '.eforge', 'profiles'), { recursive: true });
      await mkdir(join(harness.cwd, 'eforge', 'profiles'), { recursive: true });
      await writeFile(join(harness.cwd, '.eforge', '.active-profile'), 'team\n');
      await writeFile(join(harness.cwd, '.eforge', 'profiles', 'team.yaml'), [
        'description: Local team profile',
        'whenToUse: [local work]',
        'tags: [local, team]',
        'agents:',
        '  tiers:',
        '    planning: { harness: claude-sdk, model: claude-model, effort: medium }',
        '    implementation: { harness: claude-sdk, model: claude-model, effort: medium }',
        '    review: { harness: claude-sdk, model: claude-model, effort: medium }',
        '    evaluation: { harness: claude-sdk, model: claude-model, effort: medium }',
        '',
      ].join('\n'));
      await writeFile(join(harness.cwd, 'eforge', 'profiles', 'team.yaml'), [
        'description: Project team profile',
        'tags: [project]',
        'agents:',
        '  tiers:',
        '    planning: { harness: pi, model: pi-model, effort: medium }',
        '    implementation: { harness: pi, model: pi-model, effort: medium }',
        '    review: { harness: pi, model: pi-model, effort: medium }',
        '    evaluation: { harness: pi, model: pi-model, effort: medium }',
        '',
      ].join('\n'));

      const { res, body } = await invoke(harness, await actionIdFor(harness, 'read-profiles'), { scope: 'all' });
      const routeRes = await harness.get(buildProfileListPath({ scope: 'all' }));
      const routeBody = await routeRes.json();
      expect(res.status).toBe(200);
      expect(routeRes.status).toBe(200);
      expect(body).toMatchObject({ ok: true, output: { active: 'team', source: 'local' } });
      expect(body.output).toEqual(routeBody);
      expect(body.output.profiles).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'team',
          scope: 'local',
          harness: 'claude-sdk',
          metadata: { description: 'Local team profile', whenToUse: ['local work'], tags: ['local', 'team'] },
        }),
        expect.objectContaining({
          name: 'team',
          scope: 'project',
          harness: 'pi',
          shadowedBy: 'local',
          metadata: { description: 'Project team profile', tags: ['project'] },
        }),
      ]));
      expect(body.output.profiles.every((profile: { path?: unknown }) => typeof profile.path === 'string')).toBe(true);
    } finally { await harness.close(); }
  });

  it('forwards generic build queue enqueue fields from extension actions to the worker', async () => {
    const spawned: Array<{ command: string; args: string[] }> = [];
    const harness = await startContentRouteHarness({
      serverOptions: {
        workerTracker: {
          spawnWorker: (command, args) => { spawned.push({ command, args }); return { sessionId: 'enqueue-session', pid: 77 }; },
          cancelWorker: () => false,
        },
      },
    });
    try {
      await seedExtension(harness.cwd, extensionSource);
      const { res, body } = await invoke(harness, await actionIdFor(harness, 'enqueue-build'), {});
      expect(res.status).toBe(200);
      expect(body).toMatchObject({ ok: true, output: { sessionId: 'enqueue-session', pid: 77, autoBuild: false } });
      expect(spawned).toEqual([{ command: 'enqueue', args: ['prd.md', '--post-merge', 'pnpm build', '--landing-action', 'leave'] }]);
    } finally { await harness.close(); }
  });

  it('maps action handler timeouts to typed timeout responses', async () => {
    const harness = await startContentRouteHarness();
    try {
      await seedExtension(harness.cwd, extensionSource, 5);
      const { res, body } = await invoke(harness, await actionIdFor(harness, 'slow'), {});
      expect(res.status).toBe(504);
      expect(body).toMatchObject({ ok: false, error: { code: 'timeout' } });
    } finally { await harness.close(); }
  });

  it.each([
    ['invalid content type', async (harness: RouteHarness) => fetch(`${harness.url}${API_ROUTES.extensionActionInvoke}`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })],
    ['invalid JSON body', async (harness: RouteHarness) => fetch(`${harness.url}${API_ROUTES.extensionActionInvoke}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })],
    ['array body', async (harness: RouteHarness) => harness.postJson(API_ROUTES.extensionActionInvoke, [])],
    ['missing fields', async (harness: RouteHarness) => harness.postJson(API_ROUTES.extensionActionInvoke, { actionId: 'x' })],
    ['empty action id', async (harness: RouteHarness) => harness.postJson(API_ROUTES.extensionActionInvoke, { actionId: '', input: {}, requestedBy: { host: 'console' } })],
    ['blank action id', async (harness: RouteHarness) => harness.postJson(API_ROUTES.extensionActionInvoke, { actionId: '   ', input: {}, requestedBy: { host: 'console' } })],
    ['invalid requested-by host', async (harness: RouteHarness) => harness.postJson(API_ROUTES.extensionActionInvoke, { actionId: 'x', input: {}, requestedBy: { host: 'browser' } })],
    ['non-object input', async (harness: RouteHarness) => harness.postJson(API_ROUTES.extensionActionInvoke, { actionId: 'x', input: 'nope', requestedBy: { host: 'console' } })],
  ])('returns typed invalid-request responses for %s', async (_label, request) => {
    const harness = await startContentRouteHarness();
    try {
      const res = await request(harness);
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body).toMatchObject({ ok: false, error: { code: 'invalid-request' } });
      expect(safeParseExtensionActionInvokeResponse(body).success).toBe(true);
    } finally { await harness.close(); }
  });

  it('persists start and complete events for successful known-action invocations without raw payloads', async () => {
    const harness = await startContentRouteHarness();
    try {
      await seedExtension(harness.cwd, extensionSource);
      await invoke(harness, await actionIdFor(harness, 'echo'), { message: 'input-secret-token' });
      const events = actionEvents(harness);
      expect(events.map((event) => event.type)).toEqual(['extension:action:start', 'extension:action:complete']);
      expect(events[0]).toMatchObject({ actionId: events[1].actionId, extensionName: 'tools', requestedBy: { host: 'console' } });
      expect(events[1]).toHaveProperty('durationMs');
      expect(JSON.stringify(events)).not.toContain('input-secret-token');
      expect(JSON.stringify(events)).not.toContain('out-secret:input-secret-token');
    } finally { await harness.close(); }
  });

  it('persists start and failed events for input validation failures without raw payloads', async () => {
    const harness = await startContentRouteHarness();
    try {
      await seedExtension(harness.cwd, extensionSource);
      await invoke(harness, await actionIdFor(harness, 'echo'), { message: 123, secret: 'input-secret-token' });
      const events = actionEvents(harness);
      expect(events.map((event) => event.type)).toEqual(['extension:action:start', 'extension:action:failed']);
      expect(events[1]).toMatchObject({ errorCode: 'invalid-input' });
      expect(events[1]).toHaveProperty('validationErrors');
      expect(JSON.stringify(events)).not.toContain('input-secret-token');
    } finally { await harness.close(); }
  });

  it('persists start and timeout events for handler timeouts', async () => {
    const harness = await startContentRouteHarness();
    try {
      await seedExtension(harness.cwd, extensionSource, 5);
      await invoke(harness, await actionIdFor(harness, 'slow'), { secret: 'input-secret-token' });
      const events = actionEvents(harness);
      expect(events.map((event) => event.type)).toEqual(['extension:action:start', 'extension:action:timeout']);
      expect(events[1]).toMatchObject({ timeoutMs: 5 });
      expect(events[1]).toHaveProperty('durationMs');
      expect(JSON.stringify(events)).not.toContain('input-secret-token');
    } finally { await harness.close(); }
  });

  it('does not persist action lifecycle events for unknown actions', async () => {
    const harness = await startContentRouteHarness();
    try {
      await seedExtension(harness.cwd, extensionSource);
      await invoke(harness, 'missing.action', { secret: 'input-secret-token' });
      expect(actionEvents(harness)).toEqual([]);
    } finally { await harness.close(); }
  });
});

async function actionIdFor(harness: RouteHarness, localId: string): Promise<string> {
  const manifestResponse = await harness.get(API_ROUTES.extensionContributionManifest);
  const manifest = await manifestResponse.json();
  expect(manifestResponse.status, JSON.stringify(manifest)).toBe(200);
  expect(manifest.actions, JSON.stringify(manifest)).toEqual(expect.any(Array));
  const action = manifest.actions.find((candidate: { localId: string }) => candidate.localId === localId);
  expect(action, `action ${localId}`).toBeDefined();
  return action.id;
}

async function invoke(harness: RouteHarness, actionId: string, input: Record<string, unknown>): Promise<{ res: Response; body: any }> {
  const res = await harness.postJson(API_ROUTES.extensionActionInvoke, { actionId, input, requestedBy: { host: 'console' } });
  const body = await res.json();
  expect(safeParseExtensionActionInvokeResponse(body).success).toBe(true);
  return { res, body };
}

function actionEvents(harness: RouteHarness): Array<Record<string, any>> {
  return harness.db.getDaemonEventsAfter(0)
    .filter((event) => event.type.startsWith('extension:action:'))
    .map((event) => JSON.parse(event.data));
}
