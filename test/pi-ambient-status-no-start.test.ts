/**
 * Regression tests: Pi extension session_start footer refresh does NOT
 * auto-start the eforge daemon when no daemon is running.
 *
 * Verifies:
 *   1. No-lockfile case: all three footer keys cleared, fake eforge binary not executed.
 *   2. Stale-lockfile case: all three footer keys cleared, fake eforge binary not executed.
 *   3. eforge_daemon stop with no lockfile: returns a stopped/not-running result and does
 *      not execute a fake eforge binary placed first in PATH.
 *   4. A representative non-lifecycle tool (eforge_status) returns text containing the
 *      expected explicit-start guidance when no daemon is running.
 *
 * Pattern: follows AGENTS.md "no mocks" convention — uses a real temp dir, real lockfile
 * helpers, and a real (stub) Pi ExtensionAPI implementation hand-crafted for the narrow
 * surface the extension uses at registration and execution time.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { writeLockfile } from '@eforge-build/client';
import { useTempDir } from './test-tmpdir.js';

// Import the extension entry point. Pi framework peer deps are peer/optional so
// they aren't installed in the test workspace — the extension is testable because
// we never call any real Pi UI rendering code.
import eforgeExtension from '../packages/pi-eforge/extensions/eforge/index.js';

// ---------------------------------------------------------------------------
// Stub Pi framework
// ---------------------------------------------------------------------------

/** Minimal subset of Pi's UI API used by the extension footer refresh path. */
interface StubUI {
  status: Record<string, string | undefined>;
  setStatus(key: string, value: string | undefined): void;
}

type SessionEventHandler = (ev: unknown, ctx: unknown) => Promise<void>;

interface CapturedTool {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (toolCallId: string, params: any, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
}

/** Build a stub PI ExtensionAPI that captures event handlers and tool registrations. */
function setupStubPi(): {
  pi: unknown;
  handlers: Map<string, SessionEventHandler>;
  tools: Map<string, CapturedTool>;
  ui: StubUI;
} {
  const handlers = new Map<string, SessionEventHandler>();
  const tools = new Map<string, CapturedTool>();
  const ui: StubUI = {
    status: {},
    setStatus(key: string, value: string | undefined) {
      this.status[key] = value;
    },
  };

  const pi = {
    on: (event: string, handler: SessionEventHandler) => {
      handlers.set(event, handler);
    },
    registerTool: (tool: { name: string; execute: CapturedTool['execute'] }) => {
      tools.set(tool.name, { name: tool.name, execute: tool.execute });
    },
    registerCommand: () => {},
    sendUserMessage: () => {},
  };

  // Cast via unknown — real ExtensionAPI surface is large; we hand-craft the
  // minimal slice exercised by the code paths under test.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eforgeExtension(pi as any);
  return { pi, handlers, tools, ui };
}

/** Pre-set all three footer keys to a non-undefined value so we can confirm they get cleared. */
function primeFooter(ui: StubUI): void {
  ui.setStatus('eforge', 'pre-eforge');
  ui.setStatus('eforge-build', 'pre-build');
  ui.setStatus('eforge-queue', 'pre-queue');
}

/** Assert all three footer keys are undefined/cleared. */
function expectFooterCleared(ui: StubUI): void {
  expect(ui.status['eforge'], 'eforge footer key should be cleared').toBeUndefined();
  expect(ui.status['eforge-build'], 'eforge-build footer key should be cleared').toBeUndefined();
  expect(ui.status['eforge-queue'], 'eforge-queue footer key should be cleared').toBeUndefined();
}

async function waitForAssertion(
  assertion: () => void,
  timeoutMs = 1_000,
  intervalMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  if (lastError instanceof Error) throw lastError;
  assertion();
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Pi session_start footer refresh — no daemon auto-start', () => {
  const makeTempDir = useTempDir('eforge-pi-ambient-no-start-');
  let originalPath: string;
  let fakeBinDir: string;
  let sentinelPath: string;

  beforeEach(() => {
    originalPath = process.env.PATH ?? '';
    const rootTmp = makeTempDir();
    fakeBinDir = join(rootTmp, 'fake-bin');
    mkdirSync(fakeBinDir, { recursive: true });
    sentinelPath = join(rootTmp, 'eforge-spawned');

    // Create a fake `eforge` binary that writes a sentinel file when executed.
    // If session_start incorrectly spawns the daemon via spawn('eforge', ...), the
    // sentinel will exist and the assertions below will fail.
    const fakeEforge = join(fakeBinDir, 'eforge');
    writeFileSync(fakeEforge, `#!/bin/sh\ntouch "${sentinelPath}"\n`, 'utf-8');
    chmodSync(fakeEforge, 0o755);

    // Prepend the fake bin dir so our fake binary is found before the real one.
    process.env.PATH = `${fakeBinDir}${delimiter}${originalPath}`;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
  });

  it('(1) no-lockfile: clears all footer keys and does not execute fake eforge binary', async () => {
    const cwd = makeTempDir(); // No lockfile written
    const { handlers, ui } = setupStubPi();

    primeFooter(ui);

    const sessionStart = handlers.get('session_start');
    expect(sessionStart, 'session_start handler should be registered').toBeDefined();

    const ctx = { cwd, hasUI: true, ui };
    const sessionShutdown = handlers.get('session_shutdown');
    try {
      await sessionStart!(undefined, ctx);

      // refreshStatus is fired as void (fire-and-forget) inside startStatusPolling.
      await waitForAssertion(() => expectFooterCleared(ui), 1_000, 25);
      expect(existsSync(sentinelPath), 'fake eforge binary must NOT be executed').toBe(false);
    } finally {
      // Stop the polling timer to avoid leaking into subsequent tests, even on assertion failures.
      if (sessionShutdown) await sessionShutdown(undefined, ctx);
    }
  });

  it('(1b) repeated polling refresh stays passive and clears footer keys', async () => {
    vi.useFakeTimers();
    const cwd = makeTempDir(); // No lockfile written
    const { handlers, ui } = setupStubPi();

    primeFooter(ui);

    const sessionStart = handlers.get('session_start');
    expect(sessionStart, 'session_start handler should be registered').toBeDefined();

    const ctx = { cwd, hasUI: true, ui };
    const sessionShutdown = handlers.get('session_shutdown');
    try {
      await sessionStart!(undefined, ctx);
      await flushMicrotasks();
      expectFooterCleared(ui);

      // Re-prime after the initial refresh. Advancing the 5-second interval should
      // run a second refresh that clears the keys again without spawning eforge.
      primeFooter(ui);
      await vi.advanceTimersByTimeAsync(5_000);
      await flushMicrotasks();

      expectFooterCleared(ui);
      expect(existsSync(sentinelPath), 'fake eforge binary must NOT be executed by repeated polling').toBe(false);
    } finally {
      if (sessionShutdown) await sessionShutdown(undefined, ctx);
      vi.useRealTimers();
    }
  });

  it('(2) stale-lockfile: clears all footer keys and does not execute fake eforge binary', async () => {
    const cwd = makeTempDir();
    // Write a lockfile pointing at port 0 — no server is listening there.
    // isServerAlive will make a fetch to http://127.0.0.1:0/api/health which
    // fails immediately (ECONNREFUSED / invalid port) and returns false.
    writeLockfile(cwd, {
      pid: process.pid,
      port: 0,
      startedAt: new Date().toISOString(),
    });

    const { handlers, ui } = setupStubPi();

    primeFooter(ui);

    const sessionStart = handlers.get('session_start');
    expect(sessionStart, 'session_start handler should be registered').toBeDefined();

    const ctx = { cwd, hasUI: true, ui };
    const sessionShutdown = handlers.get('session_shutdown');
    try {
      await sessionStart!(undefined, ctx);

      await waitForAssertion(() => expectFooterCleared(ui), 2_500, 50);
      expect(existsSync(sentinelPath), 'fake eforge binary must NOT be executed').toBe(false);
    } finally {
      if (sessionShutdown) await sessionShutdown(undefined, ctx);
    }
  });

  it('(3) eforge_daemon stop with no lockfile returns stopped result without executing fake eforge binary', async () => {
    const cwd = makeTempDir(); // No lockfile written
    const { tools } = setupStubPi();

    const daemonTool = tools.get('eforge_daemon');
    expect(daemonTool, 'eforge_daemon tool should be registered').toBeDefined();

    const ctx = { cwd, hasUI: true, ui: { status: {}, setStatus: () => {} } };
    const result = await daemonTool!.execute(
      'tc-1',
      { action: 'stop' },
      undefined,
      undefined,
      ctx,
    ) as { content: Array<{ type: string; text: string }> };

    // The tool should return a stopped/not-running result
    expect(result).toBeDefined();
    const text = result?.content?.[0]?.text ?? JSON.stringify(result);
    expect(text).toMatch(/stopped|not running/i);

    // Fake binary must NOT have been executed
    expect(existsSync(sentinelPath), 'fake eforge binary must NOT be executed on stop with no lockfile').toBe(false);
  });

  it('(4) eforge_status returns explicit-start guidance when no daemon is running', async () => {
    const cwd = makeTempDir(); // No lockfile written
    const { tools } = setupStubPi();

    const statusTool = tools.get('eforge_status');
    expect(statusTool, 'eforge_status tool should be registered').toBeDefined();

    const ctx = { cwd, hasUI: true, ui: { status: {}, setStatus: () => {} } };

    let resultText = '';
    try {
      const result = await statusTool!.execute('tc-2', {}, undefined, undefined, ctx) as {
        content?: Array<{ text?: string }>;
      };
      resultText = result?.content?.[0]?.text ?? JSON.stringify(result);
    } catch (err: unknown) {
      // Tool may throw when daemon is absent — that's also an acceptable outcome.
      resultText = err instanceof Error ? err.message : String(err);
    }

    // Must contain the explicit-start guidance text (not auto-start language) and remain passive.
    expect(resultText).toMatch(/eforge_daemon.*action.*start|eforge daemon start|\/eforge:restart/i);
    expect(existsSync(sentinelPath), 'fake eforge binary must NOT be executed by eforge_status').toBe(false);
  });
});
