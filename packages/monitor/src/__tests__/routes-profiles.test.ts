import { createServer, request } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { API_ROUTES, buildPath, buildProfileListPath } from '@eforge-build/client';
import { createMonitorContext } from '../context.js';
import { openDatabase } from '../db.js';
import type { MonitorStreamHub } from '../types.js';
import { createRouter } from '../http/router.js';
import { createProfileRoutes } from '../routes/profiles.js';

const streams: MonitorStreamHub = { attachSession() {}, attachDaemon() {}, broadcast() {}, subscriberCount: () => 0, stop() {} };
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

const tiers = `agents:\n  tiers:\n    planning: { harness: claude-sdk, model: claude-opus-4-7, effort: high }\n    implementation: { harness: claude-sdk, model: claude-sonnet-4-6, effort: medium }\n    review: { harness: claude-sdk, model: claude-opus-4-7, effort: high }\n    evaluation: { harness: claude-sdk, model: claude-opus-4-7, effort: high }\n`;

async function start(cwd: string) {
  const db = openDatabase(':memory:');
  const context = await createMonitorContext(db, 0, { cwd });
  const router = createRouter({ monitor: context, streams, routes: createProfileRoutes(context) });
  const server = createServer((req, res) => void router.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup = () => new Promise((resolve) => server.close(() => { db.close(); resolve(); }));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  return `http://127.0.0.1:${addr.port}`;
}

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-profiles-route-'));
  await mkdir(join(cwd, 'eforge', 'profiles'), { recursive: true });
  await mkdir(join(cwd, '.eforge', 'profiles'), { recursive: true });
  await writeFile(join(cwd, 'eforge', 'config.yaml'), tiers, 'utf-8');
  await writeFile(join(cwd, 'eforge', '.active-profile'), 'team\n', 'utf-8');
  await writeFile(join(cwd, 'eforge', 'profiles', 'team.yaml'), `${tiers}description: Team profile\ntags: [team]\nlangfuse:\n  enabled: true\n  publicKey: public\n  secretKey: secret\n`, 'utf-8');
  await writeFile(join(cwd, '.eforge', 'profiles', 'local.yaml'), `${tiers}description: Local profile\n`, 'utf-8');
  return cwd;
}

describe('profile routes', () => {
  async function withXdgConfigHome<T>(fn: (xdgConfigHome: string) => Promise<T>): Promise<T> {
    const previous = process.env.XDG_CONFIG_HOME;
    const xdgConfigHome = await mkdtemp(join(tmpdir(), 'eforge-profile-user-config-'));
    process.env.XDG_CONFIG_HOME = xdgConfigHome;
    try {
      return await fn(xdgConfigHome);
    } finally {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previous;
      await rm(xdgConfigHome, { recursive: true, force: true });
    }
  }

  async function requestStatus(target: string, init: { method: string; body?: string; headers?: Record<string, string> }): Promise<number> {
    const url = new URL(target);
    return new Promise((resolve, reject) => {
      const req = request(url, { method: init.method, headers: init.headers }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      });
      req.on('error', reject);
      if (init.body) req.write(init.body);
      req.end();
    });
  }

  async function expectProfileMutationRejectedBySecurity(url: string, headers: Record<string, string>): Promise<void> {
    const requests = [
      [`${url}${API_ROUTES.profileUse}`, { method: 'POST', body: '{}' }],
      [`${url}${API_ROUTES.profileCreate}`, { method: 'POST', body: '{}' }],
      [`${url}${buildPath(API_ROUTES.profileDelete, { name: 'bad name' })}`, { method: 'DELETE' }],
    ] as const;
    for (const [target, baseInit] of requests) {
      expect(await requestStatus(target, { ...baseInit, headers })).toBe(403);
    }
  }

  it('lists profiles by scope and shows redacted active profile metadata', async () => {
    const cwd = await fixture();
    const url = await start(cwd);
    const all = await fetch(`${url}${API_ROUTES.profileList}`).then((res) => res.json()) as { active: string; source: string; profiles: Array<{ scope: string }> };
    expect(all).toMatchObject({ active: 'team', source: 'project' });
    expect(all.profiles.map((profile) => profile.scope).sort()).toEqual(['local', 'project']);
    const allViaSharedPath = await fetch(`${url}${buildProfileListPath({ scope: 'all' })}`).then((res) => res.json()) as { active: string; source: string; profiles: Array<{ scope: string }> };
    expect(allViaSharedPath).toMatchObject({ active: 'team', source: 'project' });
    expect(allViaSharedPath.profiles.map((profile) => profile.scope).sort()).toEqual(['local', 'project']);
    const local = await fetch(`${url}${API_ROUTES.profileList}?scope=local`).then((res) => res.json()) as { profiles: Array<{ scope: string }> };
    expect(local.profiles).toHaveLength(1);
    expect(local.profiles[0].scope).toBe('local');
    const shown = await fetch(`${url}${API_ROUTES.profileShow}`).then((res) => res.json()) as { resolved: { profile: unknown; metadata: unknown } };
    expect(JSON.stringify(shown.resolved.profile)).toContain('[redacted]');
    expect(shown.resolved.metadata).toEqual({ description: 'Team profile', tags: ['team'] });
    await rm(cwd, { recursive: true, force: true });
  });

  it('uses conventional config dir fallback and filters user profile scope', async () => {
    await withXdgConfigHome(async (xdgConfigHome) => {
      const cwd = await mkdtemp(join(tmpdir(), 'eforge-profiles-fallback-route-'));
      await mkdir(join(cwd, '.eforge', 'profiles'), { recursive: true });
      await mkdir(join(xdgConfigHome, 'eforge', 'profiles'), { recursive: true });
      await writeFile(join(cwd, '.eforge', 'profiles', 'local.yaml'), `${tiers}description: Local profile\n`, 'utf-8');
      await writeFile(join(xdgConfigHome, 'eforge', 'profiles', 'user.yaml'), `${tiers}description: User profile\n`, 'utf-8');
      const url = await start(cwd);
      const all = await fetch(`${url}${API_ROUTES.profileList}`).then((res) => res.json()) as { profiles: Array<{ name: string; scope: string }> };
      expect(all.profiles.map((profile) => `${profile.scope}:${profile.name}`).sort()).toEqual(['local:local', 'user:user']);
      const user = await fetch(`${url}${API_ROUTES.profileList}?scope=user`).then((res) => res.json()) as { profiles: Array<{ name: string; scope: string }> };
      expect(user.profiles).toEqual([expect.objectContaining({ name: 'user', scope: 'user' })]);
      await rm(cwd, { recursive: true, force: true });
    });
  });

  it('falls back to user active profile when no project config dir exists', async () => {
    await withXdgConfigHome(async (xdgConfigHome) => {
      const cwd = await mkdtemp(join(tmpdir(), 'eforge-profiles-user-route-'));
      await mkdir(join(xdgConfigHome, 'eforge', 'profiles'), { recursive: true });
      await writeFile(join(xdgConfigHome, 'eforge', '.active-profile'), 'user\n', 'utf-8');
      await writeFile(join(xdgConfigHome, 'eforge', 'profiles', 'user.yaml'), `${tiers}description: User profile\nlangfuse:\n  secretKey: user-secret\n`, 'utf-8');
      const url = await start(cwd);
      const shown = await fetch(`${url}${API_ROUTES.profileShow}`).then((res) => res.json()) as { source: string; resolved: { profile: unknown; scope?: string; metadata?: unknown } };
      expect(shown.source).toBe('user-local');
      expect(shown.resolved.scope).toBe('user');
      expect(shown.resolved.metadata).toEqual({ description: 'User profile' });
      expect(JSON.stringify(shown.resolved.profile)).toContain('[redacted]');
      await rm(cwd, { recursive: true, force: true });
    });
  });

  it('validates use/create/delete request errors and delete invalid JSON behavior', async () => {
    const cwd = await fixture();
    const url = await start(cwd);
    expect((await fetch(`${url}${API_ROUTES.profileUse}`, { method: 'POST', body: '{' })).status).toBe(400);
    expect((await fetch(`${url}${API_ROUTES.profileUse}`, { method: 'POST', body: 'null' })).status).toBe(400);
    expect((await fetch(`${url}${API_ROUTES.profileUse}`, { method: 'POST', body: '{}' })).status).toBe(400);
    expect((await fetch(`${url}${API_ROUTES.profileUse}`, { method: 'POST', body: JSON.stringify({ name: '../team' }) })).status).toBe(400);
    expect((await fetch(`${url}${API_ROUTES.profileUse}`, { method: 'POST', body: JSON.stringify({ name: 'team', scope: 'team' }) })).status).toBe(400);
    expect((await fetch(`${url}${API_ROUTES.profileCreate}`, { method: 'POST', body: 'null' })).status).toBe(400);
    expect((await fetch(`${url}${API_ROUTES.profileCreate}`, { method: 'POST', body: JSON.stringify({ name: 'new', overwrite: 'yes' }) })).status).toBe(400);
    expect((await fetch(`${url}${API_ROUTES.profileCreate}`, { method: 'POST', body: JSON.stringify({ name: 'new', scope: 'team' }) })).status).toBe(400);
    const duplicate = await fetch(`${url}${API_ROUTES.profileCreate}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'team', agents: { tiers: {} } }) });
    expect(duplicate.status).toBe(409);
    expect((await fetch(`${url}${buildPath(API_ROUTES.profileDelete, { name: 'bad name' })}`, { method: 'DELETE' })).status).toBe(400);
    expect((await fetch(`${url}${buildPath(API_ROUTES.profileDelete, { name: 'local' })}`, { method: 'DELETE', body: '{' })).status).toBe(400);
    expect((await fetch(`${url}${buildPath(API_ROUTES.profileDelete, { name: 'local' })}`, { method: 'DELETE', body: JSON.stringify({ force: 'yes' }) })).status).toBe(400);
    expect((await fetch(`${url}${buildPath(API_ROUTES.profileDelete, { name: 'local' })}`, { method: 'DELETE', body: JSON.stringify({ scope: 'team' }) })).status).toBe(400);
    const deleted = await fetch(`${url}${buildPath(API_ROUTES.profileDelete, { name: 'local' })}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: 'local' });
    await rm(cwd, { recursive: true, force: true });
  });

  it('rejects cross-site profile mutations before reaching handlers', async () => {
    const cwd = await fixture();
    const url = await start(cwd);
    await expectProfileMutationRejectedBySecurity(url, { origin: 'http://evil.test' });
    await expectProfileMutationRejectedBySecurity(url, { 'sec-fetch-site': 'cross-site' });
    await expectProfileMutationRejectedBySecurity(url, { host: 'evil.test' });
    await rm(cwd, { recursive: true, force: true });
  });
});
