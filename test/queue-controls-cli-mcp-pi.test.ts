import { afterEach, describe, expect, it, vi } from 'vitest';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  apiRemoveQueueItem,
  apiUpdateQueuePriority,
  clearApiVersionCache,
  removeLockfile,
  writeLockfile,
} from '@eforge-build/client';
import { openDatabase } from '@eforge-build/monitor/db';
import { startServer, type MonitorServer } from '@eforge-build/monitor/server';
import { claimPrd } from '@eforge-build/engine/prd-queue';
import { createProgram } from '../packages/eforge/src/cli/index.js';
import { createDaemonTool, type RegisteredTool } from '../packages/eforge/src/cli/mcp-tool-factory.js';
import eforgeExtension from '../packages/pi-eforge/extensions/eforge/index.js';
import { DAEMON_NOT_RUNNING_GUIDANCE } from '../packages/pi-eforge/extensions/eforge/daemon-requests.js';
import { useTempDir } from './test-tmpdir.js';

const REPO_ROOT = resolve(__dirname, '..');
const makeTempDir = useTempDir('eforge-host-queue-controls-');

let server: MonitorServer | undefined;
let originalCwd: string | undefined;

afterEach(async () => {
  if (originalCwd) {
    process.chdir(originalCwd);
    originalCwd = undefined;
  }
  await server?.stop();
  server = undefined;
  clearApiVersionCache();
  vi.restoreAllMocks();
});

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeQueuePrd(
  cwd: string,
  id: string,
  opts: { location?: 'queue' | 'waiting' | 'failed' | 'skipped'; priority?: number; dependsOn?: string[] } = {},
): Promise<string> {
  const location = opts.location ?? 'queue';
  const dir = location === 'queue' ? join(cwd, '.eforge', 'queue') : join(cwd, '.eforge', 'queue', location);
  await mkdir(dir, { recursive: true });
  const dependsOn = opts.dependsOn?.length
    ? `depends_on: [${opts.dependsOn.map((dep) => JSON.stringify(dep)).join(', ')}]\n`
    : '';
  const priority = opts.priority === undefined ? '' : `priority: ${opts.priority}\n`;
  const path = join(dir, `${id}.md`);
  await writeFile(path, `---\ntitle: ${id}\n${priority}${dependsOn}---\n\n# ${id}\n`, 'utf-8');
  return path;
}

async function startDaemon(cwd: string): Promise<void> {
  clearApiVersionCache();
  server = await startServer(openDatabase(resolve(cwd, 'monitor.db')), 0, { strictPort: true, cwd });
  writeLockfile(cwd, { pid: process.pid, port: server.port, startedAt: new Date().toISOString() });
}

function withCwd<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  originalCwd = process.cwd();
  process.chdir(cwd);
  return fn();
}

async function runCli(cwd: string, argv: string[]): Promise<{ stdout: string; stderr: string; exitCode?: number }> {
  let stdout = '';
  let stderr = '';
  let exitCode: number | undefined;
  vi.spyOn(console, 'log').mockImplementation((line = '') => { stdout += `${String(line)}\n`; });
  vi.spyOn(console, 'error').mockImplementation((line = '') => { stderr += `${String(line)}\n`; });
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    exitCode = typeof code === 'number' ? code : code === undefined || code === null ? 0 : Number(code);
    throw new Error(`process.exit:${exitCode}`);
  });

  await withCwd(cwd, async () => {
    const program = createProgram(new AbortController(), '0.0.0-test');
    program.exitOverride();
    try {
      await program.parseAsync(argv, { from: 'user' });
    } catch (err) {
      if (!(err instanceof Error && err.message.startsWith('process.exit:'))) throw err;
    }
  });

  return { stdout, stderr, exitCode };
}

function parseToolJson(result: unknown): Record<string, unknown> {
  const typed = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
  return JSON.parse(typed.content[0].text) as Record<string, unknown>;
}

const fakeMcpExtra = {
  signal: new AbortController().signal,
  _meta: {},
} as unknown as Parameters<RegisteredTool['handler']>[1];

function createQueuePriorityMcpHandler(cwd: string): RegisteredTool['handler'] {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  return createDaemonTool(server, cwd, {
    name: 'eforge_queue_priority',
    description: 'Update pending or waiting queue priority. Lower numbers run earlier; cancel running items by session id.',
    schema: { prdId: z.string(), priority: z.number().int() },
    handler: async ({ prdId, priority }, { cwd: toolCwd }) => {
      const { data } = await apiUpdateQueuePriority({ cwd: toolCwd, prdId, priority });
      return data;
    },
  }).handler;
}

function createQueueRemoveMcpHandler(cwd: string): RegisteredTool['handler'] {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  return createDaemonTool(server, cwd, {
    name: 'eforge_queue_remove',
    description: 'Remove non-running queue items, cleaning failed sidecars; refuses running and live-dependent conflicts.',
    schema: { prdId: z.string() },
    handler: async ({ prdId }, { cwd: toolCwd }) => {
      const { data } = await apiRemoveQueueItem({ cwd: toolCwd, prdId });
      return data;
    },
  }).handler;
}

type CapturedPiTool = {
  name: string;
  execute: (toolCallId: string, params: Record<string, unknown>, signal: AbortSignal, onUpdate: unknown, ctx: { cwd: string }) => Promise<unknown>;
};

function capturePiTools(): Map<string, CapturedPiTool> {
  const tools = new Map<string, CapturedPiTool>();
  const pi = {
    registerTool(tool: CapturedPiTool) { tools.set(tool.name, tool); },
    on() {},
    registerCommand() {},
    registerSlashCommand() {},
    registerView() {},
  };
  eforgeExtension(pi as never);
  return tools;
}

async function executePiTool(tool: CapturedPiTool, cwd: string, params: Record<string, unknown>): Promise<unknown> {
  return tool.execute('call-1', params, new AbortController().signal, undefined, { cwd });
}

describe('CLI queue controls', () => {
  it('registers queue priority and remove under the queue command', () => {
    const program = createProgram(new AbortController(), '0.0.0-test');
    const queue = program.commands.find((command) => command.name() === 'queue');
    expect(queue).toBeDefined();
    expect(queue?.commands.map((command) => command.name())).toContain('priority');
    expect(queue?.commands.find((command) => command.name() === 'priority')?.registeredArguments.map((arg) => arg.name())).toEqual(['prdId', 'priority']);
    expect(queue?.commands.map((command) => command.name())).toContain('remove');
    expect(queue?.commands.find((command) => command.name() === 'remove')?.registeredArguments.map((arg) => arg.name())).toEqual(['prdId']);
  });

  it('uses semantic client helpers without raw route or priority body construction', async () => {
    const source = await readFile(join(REPO_ROOT, 'packages/eforge/src/cli/queue-control.ts'), 'utf-8');

    expect(source).toMatch(/apiUpdateQueuePriority\s*\(\s*\{\s*cwd:\s*process\.cwd\(\),\s*prdId,\s*priority\s*\}\s*\)/s);
    expect(source).toMatch(/apiRemoveQueueItem\s*\(\s*\{\s*cwd:\s*process\.cwd\(\),\s*prdId\s*\}\s*\)/s);
    expect(source).not.toContain('body: { priority }');
    expect(source).not.toContain("'/api/");
    expect(source).not.toContain('"/api/');
  });

  it('updates queue priority through the daemon helper and prints the returned id and priority', async () => {
    const cwd = makeTempDir();
    const prdPath = await writeQueuePrd(cwd, 'cli-priority', { priority: 20 });
    await startDaemon(cwd);

    const result = await runCli(cwd, ['queue', 'priority', 'cli-priority', '4']);

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain('cli-priority');
    expect(result.stdout).toContain('4');
    expect(await readFile(prdPath, 'utf-8')).toContain('priority: 4');
  });

  it('removes a queue item through the daemon helper and prints removed status plus failed sidecars', async () => {
    const cwd = makeTempDir();
    const prdPath = await writeQueuePrd(cwd, 'cli-remove', { location: 'failed' });
    await writeFile(join(cwd, '.eforge', 'queue', 'failed', 'cli-remove.recovery.md'), '# recovery\n', 'utf-8');
    await writeFile(join(cwd, '.eforge', 'queue', 'failed', 'cli-remove.recovery.json'), '{}\n', 'utf-8');
    await startDaemon(cwd);

    const result = await runCli(cwd, ['queue', 'remove', 'cli-remove']);

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain('cli-remove');
    expect(result.stdout).toContain('removed');
    expect(result.stdout).toContain('failed/cli-remove.recovery.md');
    expect(result.stdout).toContain('failed/cli-remove.recovery.json');
    expect(await exists(prdPath)).toBe(false);
  });

  it.each([
    ['validation failure', ['queue', 'priority', 'cli-priority', '1.5'], 'finite integer'],
    ['blank validation failure', ['queue', 'priority', 'cli-priority', '   '], 'finite integer'],
    ['not-found failure', ['queue', 'priority', 'missing-prd', '4'], "missing-prd"],
  ])('prints daemon message and exits non-zero on priority %s', async (_name, argv, expectedMessage) => {
    const cwd = makeTempDir();
    await writeQueuePrd(cwd, 'cli-priority');
    await startDaemon(cwd);

    const result = await runCli(cwd, argv);

    expect(result.exitCode).toBeGreaterThan(0);
    expect(result.stderr).toContain('Error:');
    expect(result.stderr).toContain(expectedMessage);
  });

  it('prints daemon conflict messages for priority conflicts', async () => {
    const cwd = makeTempDir();
    await writeQueuePrd(cwd, 'cli-failed', { location: 'failed' });
    await startDaemon(cwd);

    const result = await runCli(cwd, ['queue', 'priority', 'cli-failed', '4']);

    expect(result.exitCode).toBeGreaterThan(0);
    expect(result.stderr).toContain('Error:');
    expect(result.stderr).toContain('cli-failed');
  });

  it.each([
    ['not-found failure', async (cwd: string) => { await writeQueuePrd(cwd, 'cli-remove'); }, ['queue', 'remove', 'missing-prd'], 'missing-prd'],
    ['conflict failure', async (cwd: string) => {
      await writeQueuePrd(cwd, 'cli-parent');
      await writeQueuePrd(cwd, 'cli-child', { dependsOn: ['cli-parent'] });
    }, ['queue', 'remove', 'cli-parent'], 'cli-child'],
  ])('prints daemon message and exits non-zero on remove %s', async (_name, setup, argv, expectedMessage) => {
    const cwd = makeTempDir();
    await setup(cwd);
    await startDaemon(cwd);

    const result = await runCli(cwd, argv);

    expect(result.exitCode).toBeGreaterThan(0);
    expect(result.stderr).toContain('Error:');
    expect(result.stderr).toContain(expectedMessage);
  });

  it('prints daemon-down errors without waiting for a daemon startup timeout', async () => {
    const cwd = join(makeTempDir(), 'agent-run-worktrees', '__merge__');
    await mkdir(cwd, { recursive: true });

    const result = await runCli(cwd, ['queue', 'remove', 'missing-prd']);

    expect(result.exitCode).toBeGreaterThan(0);
    expect(result.stderr).toContain('Error:');
    expect(result.stderr).toContain('Refusing to spawn eforge daemon from agent worktree');
  });
});

describe('MCP queue controls', () => {
  it('registers queue control tools and uses semantic client helpers without raw route or body construction', async () => {
    const source = await readFile(join(REPO_ROOT, 'packages/eforge/src/cli/mcp-proxy.ts'), 'utf-8');
    const priorityBlock = source.slice(source.indexOf("name: 'eforge_queue_priority'"), source.indexOf("name: 'eforge_queue_remove'"));
    const removeBlock = source.slice(source.indexOf("name: 'eforge_queue_remove'"), source.indexOf("name: 'eforge_config'"));

    expect(priorityBlock).toMatch(/apiUpdateQueuePriority\s*\(\s*\{\s*cwd:\s*toolCwd,\s*prdId,\s*priority\s*\}\s*\)/s);
    expect(removeBlock).toMatch(/apiRemoveQueueItem\s*\(\s*\{\s*cwd:\s*toolCwd,\s*prdId\s*\}\s*\)/s);
    expect(`${priorityBlock}\n${removeBlock}`).not.toContain('body: { priority }');
    expect(`${priorityBlock}\n${removeBlock}`).not.toContain("'/api/");
    expect(`${priorityBlock}\n${removeBlock}`).not.toContain('"/api/');
  });

  it('returns JSON success payloads for priority and removal', async () => {
    const cwd = makeTempDir();
    await writeQueuePrd(cwd, 'mcp-priority', { location: 'waiting', priority: 10 });
    await writeQueuePrd(cwd, 'mcp-remove');
    await startDaemon(cwd);

    const priorityResult = await createQueuePriorityMcpHandler(cwd)({ prdId: 'mcp-priority', priority: 2 }, fakeMcpExtra);
    expect(parseToolJson(priorityResult)).toMatchObject({ id: 'mcp-priority', previousStatus: 'waiting', currentStatus: 'waiting', priority: 2 });

    const removeResult = await createQueueRemoveMcpHandler(cwd)({ prdId: 'mcp-remove' }, fakeMcpExtra);
    expect(parseToolJson(removeResult)).toMatchObject({ id: 'mcp-remove', previousStatus: 'pending', currentStatus: 'removed', removedSidecars: [] });
  });

  it.each([
    ['priority validation', () => createQueuePriorityMcpHandler, { prdId: 'mcp-priority', priority: 1.5 }, 'finite integer'],
    ['priority not-found', () => createQueuePriorityMcpHandler, { prdId: 'missing-prd', priority: 2 }, 'missing-prd'],
    ['remove not-found', () => createQueueRemoveMcpHandler, { prdId: 'missing-prd' }, 'missing-prd'],
  ])('preserves daemon messages for %s failures', async (_name, handlerFactory, params, expected) => {
    const cwd = makeTempDir();
    await writeQueuePrd(cwd, 'mcp-priority');
    await startDaemon(cwd);

    const result = await handlerFactory()(cwd)(params, fakeMcpExtra);
    const typed = result as { isError?: boolean };
    expect(typed.isError).toBe(true);
    expect(String(parseToolJson(result).error)).toContain(expected);
  });

  it('preserves daemon conflict messages for priority and removal failures', async () => {
    const cwd = makeTempDir();
    await writeQueuePrd(cwd, 'mcp-running');
    await claimPrd('mcp-running', cwd);
    await writeQueuePrd(cwd, 'mcp-parent');
    await writeQueuePrd(cwd, 'mcp-child', { dependsOn: ['mcp-parent'] });
    await startDaemon(cwd);

    const priorityResult = await createQueuePriorityMcpHandler(cwd)({ prdId: 'mcp-running', priority: 2 }, fakeMcpExtra);
    expect(priorityResult).toMatchObject({ isError: true });
    expect(String(parseToolJson(priorityResult).error)).toContain('cancel');

    const removeResult = await createQueueRemoveMcpHandler(cwd)({ prdId: 'mcp-parent' }, fakeMcpExtra);
    expect(removeResult).toMatchObject({ isError: true });
    expect(String(parseToolJson(removeResult).error)).toContain('mcp-child');
  });
});

describe('Pi queue controls', () => {
  it('registers queue control tools and imports only no-start queue-control helper values', async () => {
    const source = await readFile(join(REPO_ROOT, 'packages/pi-eforge/extensions/eforge/index.ts'), 'utf-8');
    const priorityBlock = source.slice(source.indexOf('name: "eforge_queue_priority"'), source.indexOf('name: "eforge_queue_remove"'));
    const removeBlock = source.slice(source.indexOf('name: "eforge_queue_remove"'), source.indexOf('name: "eforge_config"'));

    expect(priorityBlock).toMatch(/apiUpdateQueuePriorityIfRunning\s*\(\s*\{\s*cwd:\s*ctx\.cwd,\s*prdId,\s*priority\s*\}\s*\)/s);
    expect(removeBlock).toMatch(/apiRemoveQueueItemIfRunning\s*\(\s*\{\s*cwd:\s*ctx\.cwd,\s*prdId\s*\}\s*\)/s);
    expect(`${priorityBlock}\n${removeBlock}`).not.toContain('body: { priority }');
    expect(`${priorityBlock}\n${removeBlock}`).not.toContain("'/api/");
    expect(`${priorityBlock}\n${removeBlock}`).not.toContain('"/api/');

    expect(source).toContain('apiUpdateQueuePriorityIfRunning');
    expect(source).toContain('apiRemoveQueueItemIfRunning');
    expect(source).not.toMatch(/\bapiUpdateQueuePriority\s*[,}]/);
    expect(source).not.toMatch(/\bapiRemoveQueueItem\s*[,}]/);
  });

  it('returns JSON success payloads for priority and removal', async () => {
    const cwd = makeTempDir();
    await writeQueuePrd(cwd, 'pi-priority', { location: 'waiting', priority: 10 });
    await writeQueuePrd(cwd, 'pi-remove');
    await startDaemon(cwd);
    const tools = capturePiTools();

    const priorityTool = tools.get('eforge_queue_priority');
    const removeTool = tools.get('eforge_queue_remove');
    expect(priorityTool).toBeDefined();
    expect(removeTool).toBeDefined();

    const priorityResult = await executePiTool(priorityTool!, cwd, { prdId: 'pi-priority', priority: 3 });
    expect(parseToolJson(priorityResult)).toMatchObject({ id: 'pi-priority', previousStatus: 'waiting', currentStatus: 'waiting', priority: 3 });

    const removeResult = await executePiTool(removeTool!, cwd, { prdId: 'pi-remove' });
    expect(parseToolJson(removeResult)).toMatchObject({ id: 'pi-remove', previousStatus: 'pending', currentStatus: 'removed', removedSidecars: [] });
  });

  it('throws no-start guidance when the daemon is not running', async () => {
    const cwd = makeTempDir();
    removeLockfile(cwd);
    const tools = capturePiTools();

    await expect(executePiTool(tools.get('eforge_queue_priority')!, cwd, { prdId: 'pi-priority', priority: 3 }))
      .rejects.toThrow(DAEMON_NOT_RUNNING_GUIDANCE);
    await expect(executePiTool(tools.get('eforge_queue_remove')!, cwd, { prdId: 'pi-remove' }))
      .rejects.toThrow(DAEMON_NOT_RUNNING_GUIDANCE);
  });

  it.each([
    ['priority validation', 'eforge_queue_priority', { prdId: 'pi-priority', priority: 1.5 }, 'finite integer'],
    ['priority not-found', 'eforge_queue_priority', { prdId: 'missing-prd', priority: 3 }, 'missing-prd'],
    ['remove not-found', 'eforge_queue_remove', { prdId: 'missing-prd' }, 'missing-prd'],
  ])('preserves daemon messages for %s failures', async (_name, toolName, params, expected) => {
    const cwd = makeTempDir();
    await writeQueuePrd(cwd, 'pi-priority');
    await startDaemon(cwd);
    const tools = capturePiTools();

    await expect(executePiTool(tools.get(toolName)!, cwd, params)).rejects.toThrow(expected);
  });

  it('preserves daemon conflict messages for priority and removal failures', async () => {
    const cwd = makeTempDir();
    await writeQueuePrd(cwd, 'pi-running');
    await claimPrd('pi-running', cwd);
    await writeQueuePrd(cwd, 'pi-parent');
    await writeQueuePrd(cwd, 'pi-child', { dependsOn: ['pi-parent'] });
    await startDaemon(cwd);
    const tools = capturePiTools();

    await expect(executePiTool(tools.get('eforge_queue_priority')!, cwd, { prdId: 'pi-running', priority: 3 }))
      .rejects.toThrow(/cancel|running/i);
    await expect(executePiTool(tools.get('eforge_queue_remove')!, cwd, { prdId: 'pi-parent' }))
      .rejects.toThrow('pi-child');
  });
});
