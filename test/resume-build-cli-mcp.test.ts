/**
 * Tests for the resume CLI command and eforge_resume_build MCP tool.
 *
 * Verifies:
 * - The `resume` command is registered on the Commander program
 * - The `eforge_resume_build` MCP tool is registered in the proxy source
 * - The MCP tool handler posts to API_ROUTES.resumeBuild with the correct body
 *   and returns the daemon response JSON
 *
 * Follows AGENTS.md conventions:
 * - No mocks. Real Commander programs, real McpServer instances, real HTTP servers.
 * - useTempDir for filesystem cleanup.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join, resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createProgram } from '../packages/eforge/src/cli/index.js';
import {
  createDaemonTool,
  type RegisteredTool,
} from '../packages/eforge/src/cli/mcp-tool-factory.js';
import {
  API_ROUTES,
  writeLockfile,
  clearApiVersionCache,
  apiResumeBuild,
} from '@eforge-build/client';
import { openDatabase } from '@eforge-build/monitor/db';
import {
  startServer,
  type MonitorServer,
  type WorkerTracker,
} from '@eforge-build/monitor/server';
import { useTempDir } from './test-tmpdir.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function readRepoFile(relative: string): string {
  return readFileSync(resolve(REPO_ROOT, relative), 'utf-8');
}

interface SpawnCall {
  command: string;
  args: string[];
  sessionId: string;
  pid: number;
}

function makeStubTracker(): { tracker: WorkerTracker; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  let pidCounter = 30000;
  let sessionCounter = 0;

  const tracker: WorkerTracker = {
    spawnWorker(command: string, args: string[]): { sessionId: string; pid: number } {
      const sessionId = `stub-mcp-${++sessionCounter}`;
      const pid = ++pidCounter;
      calls.push({ command, args, sessionId, pid });
      return { sessionId, pid };
    },
    cancelWorker(_sessionId: string): boolean {
      return false;
    },
  };

  return { tracker, calls };
}

function writeTestProfile(cwd: string, name = 'resume-profile'): void {
  const configDir = join(cwd, 'eforge');
  mkdirSync(join(configDir, 'profiles'), { recursive: true });
  writeFileSync(join(configDir, 'config.yaml'), 'agents:\n  tiers: {}\n', 'utf-8');
  writeFileSync(
    join(configDir, 'profiles', `${name}.yaml`),
    'agents:\n  tiers:\n    planning:\n      harness: claude-sdk\n      model: claude-haiku-4-5\n      effort: low\n',
    'utf-8',
  );
}

/** Fake extra object for MCP tool handler calls. */
const fakeExtra = {
  signal: new AbortController().signal,
  _meta: {},
} as unknown as Parameters<RegisteredTool['handler']>[1];

// ---------------------------------------------------------------------------
// Test setup for integration tests
// ---------------------------------------------------------------------------

const makeTempDir = useTempDir('eforge-resume-cli-mcp-test-');

let tmpDir: string;
let dbPath: string;
let server: MonitorServer;
let spawnCalls: SpawnCall[];

async function setupServer(): Promise<void> {
  const { tracker, calls } = makeStubTracker();
  spawnCalls = calls;

  server = await startServer(
    openDatabase(dbPath),
    0,
    {
      strictPort: true,
      cwd: tmpDir,
      workerTracker: tracker,
    },
  );
}

beforeEach(async () => {
  clearApiVersionCache();
  tmpDir = makeTempDir();
  dbPath = resolve(tmpDir, 'monitor.db');
  await setupServer();
  // Write lockfile so daemon client helpers can discover the test server
  writeLockfile(tmpDir, { pid: process.pid, port: server.port, startedAt: new Date().toISOString() });
});

afterEach(async () => {
  await server?.stop();
  clearApiVersionCache();
});

// ---------------------------------------------------------------------------
// CLI registration
// ---------------------------------------------------------------------------

describe('resume CLI command registration', () => {
  it('registers the `resume` command on the Commander program', () => {
    const program = createProgram(undefined, 'test');
    const resumeCommand = program.commands.find((cmd) => cmd.name() === 'resume');
    expect(resumeCommand).toBeDefined();
  });

  it('resume command accepts a prdId positional argument', () => {
    const program = createProgram(undefined, 'test');
    const resumeCommand = program.commands.find((cmd) => cmd.name() === 'resume');
    expect(resumeCommand?.usage()).toContain('prdId');
  });

  it('resume command declares --set-name option', () => {
    const program = createProgram(undefined, 'test');
    const resumeCommand = program.commands.find((cmd) => cmd.name() === 'resume');
    const optionNames = resumeCommand?.options.map((o) => o.long ?? '') ?? [];
    expect(optionNames).toContain('--set-name');
  });

  it('resume command declares --profile option', () => {
    const program = createProgram(undefined, 'test');
    const resumeCommand = program.commands.find((cmd) => cmd.name() === 'resume');
    const optionNames = resumeCommand?.options.map((o) => o.long ?? '') ?? [];
    expect(optionNames).toContain('--profile');
  });

  it('resume command declares --cwd option', () => {
    const program = createProgram(undefined, 'test');
    const resumeCommand = program.commands.find((cmd) => cmd.name() === 'resume');
    const optionNames = resumeCommand?.options.map((o) => o.long ?? '') ?? [];
    expect(optionNames).toContain('--cwd');
  });

  it('resume command declares --no-monitor option', () => {
    const program = createProgram(undefined, 'test');
    const resumeCommand = program.commands.find((cmd) => cmd.name() === 'resume');
    const optionNames = resumeCommand?.options.map((o) => o.long ?? '') ?? [];
    expect(optionNames).toContain('--no-monitor');
  });
});

// ---------------------------------------------------------------------------
// MCP proxy source-level registration check
// ---------------------------------------------------------------------------

describe('eforge_resume_build MCP tool registration (source-level)', () => {
  const mcpSource = readRepoFile('packages/eforge/src/cli/mcp-proxy.ts');

  it('registers eforge_resume_build in the MCP proxy source', () => {
    expect(mcpSource).toContain("name: 'eforge_resume_build'");
  });

  it('references apiResumeBuild in the MCP proxy source', () => {
    expect(mcpSource).toContain('apiResumeBuild');
  });

  it('eforge_resume_build schema declares prdId field', () => {
    const start = mcpSource.indexOf("name: 'eforge_resume_build'");
    expect(start).toBeGreaterThan(-1);
    const next = mcpSource.indexOf('createDaemonTool(', start + 1);
    const block = next > start ? mcpSource.slice(start, next) : mcpSource.slice(start);
    expect(block).toContain('prdId');
  });

  it('eforge_resume_build schema declares optional setName field', () => {
    const start = mcpSource.indexOf("name: 'eforge_resume_build'");
    expect(start).toBeGreaterThan(-1);
    const next = mcpSource.indexOf('createDaemonTool(', start + 1);
    const block = next > start ? mcpSource.slice(start, next) : mcpSource.slice(start);
    expect(block).toContain('setName');
    expect(block).toContain('.optional()');
  });

  it('eforge_resume_build schema declares optional profile field', () => {
    const start = mcpSource.indexOf("name: 'eforge_resume_build'");
    expect(start).toBeGreaterThan(-1);
    const next = mcpSource.indexOf('createDaemonTool(', start + 1);
    const block = next > start ? mcpSource.slice(start, next) : mcpSource.slice(start);
    expect(block).toContain('profile');
    expect(block).toContain('.optional()');
  });
});

// ---------------------------------------------------------------------------
// apiResumeBuild integration — posts to API_ROUTES.resumeBuild
// ---------------------------------------------------------------------------

describe('apiResumeBuild helper', () => {
  it('posts to API_ROUTES.resumeBuild and returns { sessionId, pid }', async () => {
    const prdId = 'my-feature-prd';
    const { data } = await apiResumeBuild({ cwd: tmpDir, body: { prdId } });

    expect(typeof data.sessionId).toBe('string');
    expect(data.sessionId.length).toBeGreaterThan(0);
    expect(typeof data.pid).toBe('number');
    expect(data.pid).toBeGreaterThan(0);

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toBe('resume');
    expect(spawnCalls[0].args).toEqual([prdId]);
  });

  it('passes setName as --set-name args when provided', async () => {
    const prdId = 'my-feature-prd';
    const setName = 'my-set';
    const { data } = await apiResumeBuild({ cwd: tmpDir, body: { prdId, setName } });

    expect(typeof data.sessionId).toBe('string');
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].args).toEqual([prdId, '--set-name', setName]);
    // sessionId matches what the stub returned
    expect(data.sessionId).toBe(spawnCalls[0].sessionId);
    expect(data.pid).toBe(spawnCalls[0].pid);
  });

  it('passes profile as --profile args when provided', async () => {
    const prdId = 'my-feature-prd';
    const profile = 'resume-profile';
    writeTestProfile(tmpDir, profile);

    const { data } = await apiResumeBuild({ cwd: tmpDir, body: { prdId, profile } });

    expect(typeof data.sessionId).toBe('string');
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].args).toEqual([prdId, '--profile', profile]);
    expect(data.sessionId).toBe(spawnCalls[0].sessionId);
    expect(data.pid).toBe(spawnCalls[0].pid);
  });
});

// ---------------------------------------------------------------------------
// MCP tool handler integration — calls apiResumeBuild and returns daemon JSON
// ---------------------------------------------------------------------------

describe('eforge_resume_build MCP tool handler', () => {
  it('calls apiResumeBuild and returns the daemon response JSON', async () => {
    const mcpServer = new McpServer({ name: 'test', version: '0.0.0' });

    const prdId = 'mcp-handler-prd';

    // Register the tool using the same factory used in the production proxy
    const registered = createDaemonTool(mcpServer, tmpDir, {
      name: 'eforge_resume_build',
      description: 'Test: resume build',
      schema: {
        prdId: z.string(),
        setName: z.string().optional(),
        profile: z.string().optional(),
      },
      handler: async ({ prdId: id, setName, profile }, { cwd: toolCwd }) => {
        const body: { prdId: string; setName?: string; profile?: string } = { prdId: id };
        if (setName !== undefined) body.setName = setName;
        if (profile !== undefined) body.profile = profile;
        const { data } = await apiResumeBuild({ cwd: toolCwd, body });
        return data;
      },
    });

    const result = await (registered.handler as (...args: unknown[]) => Promise<unknown>)(
      { prdId },
      fakeExtra,
    );
    const typed = result as { content: Array<{ type: string; text: string }> };

    expect(typed.content).toHaveLength(1);
    expect(typed.content[0].type).toBe('text');

    const parsed = JSON.parse(typed.content[0].text) as { sessionId: string; pid: number };
    expect(typeof parsed.sessionId).toBe('string');
    expect(typeof parsed.pid).toBe('number');

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toBe('resume');
    expect(spawnCalls[0].args).toEqual([prdId]);
  });

  it('forwards profile overrides through the MCP handler body', async () => {
    const mcpServer = new McpServer({ name: 'test', version: '0.0.0' });
    const prdId = 'mcp-handler-prd';
    const profile = 'resume-profile';
    writeTestProfile(tmpDir, profile);

    const registered = createDaemonTool(mcpServer, tmpDir, {
      name: 'eforge_resume_build',
      description: 'Test: resume build',
      schema: {
        prdId: z.string(),
        setName: z.string().optional(),
        profile: z.string().optional(),
      },
      handler: async ({ prdId: id, setName, profile: profileOverride }, { cwd: toolCwd }) => {
        const body: { prdId: string; setName?: string; profile?: string } = { prdId: id };
        if (setName !== undefined) body.setName = setName;
        if (profileOverride !== undefined) body.profile = profileOverride;
        const { data } = await apiResumeBuild({ cwd: toolCwd, body });
        return data;
      },
    });

    await (registered.handler as (...args: unknown[]) => Promise<unknown>)(
      { prdId, profile },
      fakeExtra,
    );

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toBe('resume');
    expect(spawnCalls[0].args).toEqual([prdId, '--profile', profile]);
  });
});
