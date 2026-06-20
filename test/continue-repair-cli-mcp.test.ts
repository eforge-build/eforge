// --- eforge:region continue-repair-cli-mcp-suite ---
/**
 * Tests for the continue-repair CLI command and eforge_continue_repair MCP tool.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join, resolve, dirname } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
  apiContinueRepair,
  apiContinueRepairIfRunning,
  type ContinueRepairResponse,
} from '@eforge-build/client';
import { openDatabase } from '@eforge-build/monitor/db';
import {
  startServer,
  type MonitorServer,
  type WorkerTracker,
} from '@eforge-build/monitor/server';
import { useTempDir } from './test-tmpdir.js';
import { z } from 'zod';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function readRepoFile(relative: string): string {
  return readFileSync(resolve(REPO_ROOT, relative), 'utf-8');
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function writeFileEnsuringDir(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function initRepo(cwd: string): void {
  git(cwd, ['init', '-b', 'main']);
  git(cwd, ['config', 'user.email', 'test@example.com']);
  git(cwd, ['config', 'user.name', 'Test User']);
  writeFileEnsuringDir(join(cwd, 'README.md'), '# test\n');
  git(cwd, ['add', 'README.md']);
  git(cwd, ['commit', '-m', 'chore: initial']);
}

function createFeatureBranchWithArtifacts(cwd: string, setName: string): void {
  git(cwd, ['switch', '-c', `eforge/${setName}`]);
  writeFileEnsuringDir(join(cwd, 'eforge', 'plans', setName, 'orchestration.yaml'), `name: ${setName}\ndescription: Test\nbase_branch: main\nmode: excursion\nvalidate: []\nplans:\n  - id: plan-01\n    name: Plan 01\n    depends_on: []\n    branch: ${setName}/plan-01\n    build: [implement]\n    review:\n      strategy: auto\n      perspectives: [code]\n      maxRounds: 1\n      evaluatorStrictness: standard\npipeline:\n  scope: excursion\n  compile: []\n  defaultBuild: []\n  defaultReview:\n    strategy: auto\n    perspectives: [code]\n    maxRounds: 1\n    evaluatorStrictness: standard\n  rationale: continue-repair\n`);
  writeFileEnsuringDir(join(cwd, 'eforge', 'plans', setName, 'plan-01.md'), '# Plan 01\n');
  git(cwd, ['add', 'eforge']);
  git(cwd, ['commit', '-m', 'plan: compiled artifacts']);
  git(cwd, ['switch', 'main']);
}

function writeFailedPrd(cwd: string, prdId: string, setName = prdId): void {
  writeFileEnsuringDir(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.md`), '---\ntitle: Failed PRD\n---\n\n# Failed PRD\n');
  const generatedAt = new Date().toISOString();
  writeFileEnsuringDir(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`), JSON.stringify({
    schemaVersion: 3,
    generatedAt,
    prdId,
    setName,
    verdict: { verdict: 'continue-repair', confidence: 'high', rationale: 'continue repair', completedWork: [], remainingWork: [], risks: [] },
    report: { operatorSummary: 'plan-01 failed', recommendedAction: 'Continue and repair build.', keyEvidence: [], completedWork: [], remainingWork: ['finish plan-01'], risks: [] },
    boundedEvidence: { identity: { prdId, setName, featureBranch: `eforge/${setName}`, baseBranch: 'main', failedAt: generatedAt }, plans: [{ planId: 'plan-01', status: 'failed' }], failingPlan: { planId: 'plan-01' }, landedCommits: [], modelsUsed: [] },
  }));
}

function makeStubTracker(): { tracker: WorkerTracker; calls: Array<{ command: string; args: string[] }> } {
  const calls: Array<{ command: string; args: string[] }> = [];
  const tracker: WorkerTracker = {
    spawnWorker(command: string, args: string[]): { sessionId: string; pid: number } {
      calls.push({ command, args });
      return { sessionId: 'unexpected-continue-repair-worker', pid: 30001 };
    },
    cancelWorker(): boolean {
      return false;
    },
  };
  return { tracker, calls };
}

function writeTestProfile(cwd: string, name = 'continue-repair-profile'): void {
  const configDir = join(cwd, 'eforge');
  mkdirSync(join(configDir, 'profiles'), { recursive: true });
  writeFileSync(join(configDir, 'config.yaml'), 'agents:\n  tiers: {}\n', 'utf-8');
  writeFileSync(
    join(configDir, 'profiles', `${name}.yaml`),
    'agents:\n  tiers:\n    planning:\n      harness: claude-sdk\n      model: claude-haiku-4-5\n      effort: low\n',
    'utf-8',
  );
}

const fakeExtra = {
  signal: new AbortController().signal,
  _meta: {},
} as unknown as Parameters<RegisteredTool['handler']>[1];

const makeTempDir = useTempDir('eforge-continue-repair-cli-mcp-test-');

let tmpDir: string;
let dbPath: string;
let server: MonitorServer;
let spawnCalls: Array<{ command: string; args: string[] }>;

function prepareEligiblePrd(prdId: string): void {
  createFeatureBranchWithArtifacts(tmpDir, prdId);
  writeFailedPrd(tmpDir, prdId);
}

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
  initRepo(tmpDir);
  await setupServer();
  writeLockfile(tmpDir, { pid: process.pid, port: server.port, startedAt: new Date().toISOString() });
});

afterEach(async () => {
  await server?.stop();
  clearApiVersionCache();
});

describe('continue-repair CLI command registration', () => {
  it('registers the `continue-repair` command on the Commander program', () => {
    const program = createProgram(undefined, 'test');
    const continueRepairCommand = program.commands.find((cmd) => cmd.name() === 'continue-repair');
    expect(continueRepairCommand).toBeDefined();
  });

  it('does not register the removed `resume` command', () => {
    const program = createProgram(undefined, 'test');
    expect(program.commands.some((cmd) => cmd.name() === 'resume')).toBe(false);
  });

  it('continue-repair command accepts expected user-facing options', () => {
    const program = createProgram(undefined, 'test');
    const continueRepairCommand = program.commands.find((cmd) => cmd.name() === 'continue-repair');
    expect(continueRepairCommand?.usage()).toContain('prdId');
    const optionNames = continueRepairCommand?.options.map((o) => o.long ?? '') ?? [];
    expect(optionNames).toContain('--set-name');
    expect(optionNames).toContain('--profile');
    expect(optionNames).toContain('--cwd');
    expect(optionNames).toContain('--verbose');
    expect(optionNames).not.toContain('--no-monitor');
  });
});

describe('eforge_continue_repair MCP tool registration (source-level)', () => {
  const mcpSource = readRepoFile('packages/eforge/src/cli/mcp-proxy.ts');

  it('registers eforge_continue_repair in the MCP proxy source and describes queued metadata', () => {
    expect(mcpSource).toContain("name: 'eforge_continue_repair'");
    expect(mcpSource).not.toContain(['eforge', 'resume', 'build'].join('_'));
    expect(mcpSource).toContain('apiContinueRepair');
    expect(mcpSource).toMatch(/Queue[\s\S]{0,80}continue[\s\S]{0,40}repair/i);
    expect(mcpSource).toContain('no sessionId or pid');
  });

  it('eforge_continue_repair schema declares prdId, setName, and profile fields', () => {
    const start = mcpSource.indexOf("name: 'eforge_continue_repair'");
    expect(start).toBeGreaterThan(-1);
    const next = mcpSource.indexOf('createDaemonTool(', start + 1);
    const block = next > start ? mcpSource.slice(start, next) : mcpSource.slice(start);
    expect(block).toContain('prdId');
    expect(block).toContain('setName');
    expect(block).toContain('profile');
    expect(block).toContain('.optional()');
  });
});

describe('apiContinueRepair helper', () => {
  it('exports the running-daemon convenience helper', () => {
    expect(typeof apiContinueRepairIfRunning).toBe('function');
  });

  it('posts to API_ROUTES.continueRepair and returns queued metadata without spawning a worker', async () => {
    const prdId = 'my-feature-prd';
    prepareEligiblePrd(prdId);
    const { data } = await apiContinueRepair({ cwd: tmpDir, body: { prdId } });

    expect(data).toMatchObject({
      kind: 'queued',
      prdId,
      setName: prdId,
      featureBranch: `eforge/${prdId}`,
      baseBranch: 'main',
      movedDescendantIds: [],
    });
    expect((data as ContinueRepairResponse & { sessionId?: unknown; pid?: unknown }).sessionId).toBeUndefined();
    expect((data as ContinueRepairResponse & { sessionId?: unknown; pid?: unknown }).pid).toBeUndefined();
    expect(spawnCalls).toHaveLength(0);
  });

  it('passes setName in the request body and receives the selected set metadata', async () => {
    const prdId = 'my-feature-prd';
    const setName = 'my-set';
    createFeatureBranchWithArtifacts(tmpDir, setName);
    writeFailedPrd(tmpDir, prdId, setName);
    const { data } = await apiContinueRepair({ cwd: tmpDir, body: { prdId, setName } });

    expect(data.kind).toBe('queued');
    expect(data.setName).toBe(setName);
    expect(data.featureBranch).toBe(`eforge/${setName}`);
    expect(spawnCalls).toHaveLength(0);
  });

  it('passes profile in the request body and receives profile metadata', async () => {
    const prdId = 'profile-prd';
    const profile = 'continue-repair-profile';
    prepareEligiblePrd(prdId);
    writeTestProfile(tmpDir, profile);

    const { data } = await apiContinueRepair({ cwd: tmpDir, body: { prdId, profile } });

    expect(data.kind).toBe('queued');
    expect(data.profile).toBe(profile);
    expect(spawnCalls).toHaveLength(0);
  });
});

describe('continue-repair CLI command behavior', () => {
  it('queues through the daemon route and prints queued metadata', async () => {
    const prdId = 'cli-continue-repair-prd';
    const profile = 'continue-repair-profile';
    prepareEligiblePrd(prdId);
    writeTestProfile(tmpDir, profile);
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message));
    });

    try {
      const program = createProgram(undefined, 'test');
      await program.parseAsync(['continue-repair', prdId, '--cwd', tmpDir, '--profile', profile, '--verbose'], { from: 'user' });
    } finally {
      logSpy.mockRestore();
    }

    expect(logs.join('\n')).toMatch(new RegExp(`Continue (and repair build|build) queued: ${prdId}`));
    expect(logs.join('\n').toLowerCase()).not.toContain('resume');
    expect(logs.join('\n')).toContain(`Set: ${prdId}`);
    expect(logs.join('\n')).toContain(`Feature branch: eforge/${prdId}`);
    expect(logs.join('\n')).toContain('Base branch: main');
    expect(logs.join('\n')).toContain(`Profile: ${profile}`);
    expect(logs.join('\n')).not.toContain('sessionId');
    expect(logs.join('\n')).not.toContain('pid');
    expect(spawnCalls).toHaveLength(0);
  });
});

describe('Pi eforge_continue_repair tool registration (source-level)', () => {
  const piSource = readRepoFile('packages/pi-eforge/extensions/eforge/index.ts');

  it('describes queued metadata and returns daemon JSON unchanged', () => {
    expect(piSource).not.toContain(['eforge', 'resume', 'build'].join('_'));
    const start = piSource.indexOf('name: "eforge_continue_repair"');
    expect(start).toBeGreaterThan(-1);
    const next = piSource.indexOf('pi.registerTool({', start + 1);
    const block = next > start ? piSource.slice(start, next) : piSource.slice(start);
    expect(block).toMatch(/Queue[\s\S]{0,80}continue[\s\S]{0,40}repair/i);
    expect(block).toContain('no sessionId or pid');
    expect(block).toContain('API_ROUTES.continueRepair');
    expect(block).toContain('return jsonResult(data)');
  });
});

describe('eforge_continue_repair MCP tool handler', () => {
  it('calls apiContinueRepair and returns the queued daemon response JSON', async () => {
    const mcpServer = new McpServer({ name: 'test', version: '0.0.0' });
    const prdId = 'mcp-handler-prd';
    prepareEligiblePrd(prdId);

    const registered = createDaemonTool(mcpServer, tmpDir, {
      name: 'eforge_continue_repair',
      description: 'Test: continue and repair build',
      schema: {
        prdId: z.string(),
        setName: z.string().optional(),
        profile: z.string().optional(),
      },
      handler: async ({ prdId: id, setName, profile }, { cwd: toolCwd }) => {
        const body: { prdId: string; setName?: string; profile?: string } = { prdId: id };
        if (setName !== undefined) body.setName = setName;
        if (profile !== undefined) body.profile = profile;
        const { data } = await apiContinueRepair({ cwd: toolCwd, body });
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

    const parsed = JSON.parse(typed.content[0].text) as ContinueRepairResponse & { sessionId?: unknown; pid?: unknown };
    expect(parsed.kind).toBe('queued');
    expect(parsed.prdId).toBe(prdId);
    expect(parsed.sessionId).toBeUndefined();
    expect(parsed.pid).toBeUndefined();
    expect(spawnCalls).toHaveLength(0);
  });

  it('forwards profile overrides through the MCP handler body', async () => {
    const mcpServer = new McpServer({ name: 'test', version: '0.0.0' });
    const prdId = 'mcp-profile-prd';
    const profile = 'continue-repair-profile';
    prepareEligiblePrd(prdId);
    writeTestProfile(tmpDir, profile);

    const registered = createDaemonTool(mcpServer, tmpDir, {
      name: 'eforge_continue_repair',
      description: 'Test: continue and repair build',
      schema: {
        prdId: z.string(),
        setName: z.string().optional(),
        profile: z.string().optional(),
      },
      handler: async ({ prdId: id, setName, profile: profileOverride }, { cwd: toolCwd }) => {
        const body: { prdId: string; setName?: string; profile?: string } = { prdId: id };
        if (setName !== undefined) body.setName = setName;
        if (profileOverride !== undefined) body.profile = profileOverride;
        const { data } = await apiContinueRepair({ cwd: toolCwd, body });
        return data;
      },
    });

    const result = await (registered.handler as (...args: unknown[]) => Promise<unknown>)(
      { prdId, profile },
      fakeExtra,
    );
    const typed = result as { content: Array<{ type: string; text: string }> };
    const parsed = JSON.parse(typed.content[0].text) as ContinueRepairResponse;

    expect(parsed.profile).toBe(profile);
    expect(spawnCalls).toHaveLength(0);
  });
});
// --- eforge:endregion continue-repair-cli-mcp-suite ---
