import { createServer, type IncomingMessage, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  API_ROUTES,
  DAEMON_API_VERSION,
  apiListProfiles,
  apiListProfilesIfRunning,
  buildProfileListPath,
  clearApiVersionCache,
  writeLockfile,
  type ProfileListResponse,
} from '@eforge-build/client';

interface RecordedRequest {
  method: string;
  url: string;
}

interface TestServer {
  server: Server;
  port: number;
  requests: RecordedRequest[];
}

const profileListResponse: ProfileListResponse = {
  active: 'team',
  source: 'project',
  profiles: [
    {
      name: 'team',
      harness: 'pi',
      path: '/repo/eforge/profiles/team.yaml',
      scope: 'project',
      metadata: { description: 'Team runtime profile', tags: ['team'] },
    },
  ],
};

function startProfileServer(): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const state: TestServer = { server: null as unknown as Server, port: 0, requests: [] };
    const server = createServer((req: IncomingMessage, res) => {
      const method = req.method ?? 'GET';
      const url = req.url ?? '/';
      state.requests.push({ method, url });

      if (url === API_ROUTES.health) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      if (url === API_ROUTES.version) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ version: DAEMON_API_VERSION }));
        return;
      }

      if (url === buildProfileListPath() || url === buildProfileListPath({ scope: 'all' })) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(profileListResponse));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `unexpected ${method} ${url}` }));
    });

    state.server = server;
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unexpected server address'));
        return;
      }
      state.port = address.port;
      resolve(state);
    });
    server.on('error', reject);
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

let cwd: string;
let testServer: TestServer;

beforeEach(async () => {
  clearApiVersionCache();
  cwd = await mkdtemp(join(tmpdir(), 'eforge-profile-list-client-contract-'));
  testServer = await startProfileServer();
  writeLockfile(cwd, { pid: process.pid, port: testServer.port, startedAt: new Date().toISOString() });
});

afterEach(async () => {
  await stopServer(testServer.server);
  await rm(cwd, { recursive: true, force: true });
  clearApiVersionCache();
});

describe('profile-list client route contract', () => {
  it('builds the shared profile-list path for omitted and all-scope requests', () => {
    expect(buildProfileListPath()).toBe(API_ROUTES.profileList);
    expect(buildProfileListPath({})).toBe(API_ROUTES.profileList);
    expect(buildProfileListPath({ scope: 'all' })).toBe(`${API_ROUTES.profileList}?scope=all`);
  });

  it('uses the shared path builder from the profile-list API helpers', async () => {
    const source = readFileSync('packages/client/src/api/profile.ts', 'utf-8');
    expect(source).toMatch(/apiListProfiles[\s\S]*daemonRequest<ProfileListResponse>\(opts\.cwd, 'GET', buildProfileListPath\(opts\.query\)\)/);
    expect(source).toMatch(/apiListProfilesIfRunning[\s\S]*daemonRequestIfRunning<ProfileListResponse>\(opts\.cwd, 'GET', buildProfileListPath\(opts\.query\)\)/);
    expect(source).not.toMatch(/API_ROUTES\.profileList\s*(?:[+?;:]|\?\?|&&|\|\||`|\$\{|\.concat)|new URLSearchParams\([^)]*scope|\?scope/);

    const activeResult = await apiListProfiles({ cwd, query: { scope: 'all' } });
    expect(activeResult).toMatchObject({ data: profileListResponse, port: testServer.port });
    expect(testServer.requests.at(-1)).toEqual({ method: 'GET', url: buildProfileListPath({ scope: 'all' }) });

    const passiveResult = await apiListProfilesIfRunning({ cwd, query: { scope: 'all' } });
    expect(passiveResult).toEqual({ data: profileListResponse, port: testServer.port });
    expect(testServer.requests.at(-1)).toEqual({ method: 'GET', url: buildProfileListPath({ scope: 'all' }) });
  });

  it('omits the scope query when the client request has no scope filter', async () => {
    const result = await apiListProfilesIfRunning({ cwd });

    expect(result?.data.profiles).toEqual(profileListResponse.profiles);
    expect(testServer.requests.at(-1)).toEqual({ method: 'GET', url: API_ROUTES.profileList });
  });
});
