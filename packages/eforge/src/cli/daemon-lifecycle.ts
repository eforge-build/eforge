import { fork } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import chalk from 'chalk';
import {
  isAgentWorktreeCwd,
  isPidAlive,
  isServerAlive,
  killPidIfAlive,
  readLockfile,
  removeLockfile,
} from '@eforge-build/client';

export interface DaemonStartOptions {
  port?: number;
}

export interface DaemonStopOptions {
  force?: boolean;
}

type StopResult = 'stopped' | 'not-running' | 'aborted';
type DaemonLock = NonNullable<ReturnType<typeof readLockfile>>;
type CommandActionHandler = (this: Command, args: unknown[]) => unknown;
type CommandWithActionHandler = Command & { _actionHandler?: CommandActionHandler };

export function addDaemonStartOptions(command: Command): Command {
  return command.option('--port <port>', 'Preferred port', parseInt);
}

export function addDaemonStopOptions(command: Command): Command {
  return command.option('--force', 'Skip active-build safety check');
}

export function setDaemonStartAction(command: Command): Command {
  (command as CommandWithActionHandler)._actionHandler = daemonStartActionHandler;
  return command;
}

export function setDaemonStopAction(command: Command): Command {
  (command as CommandWithActionHandler)._actionHandler = daemonStopActionHandler;
  return command;
}

export function setDaemonRestartAction(command: Command): Command {
  (command as CommandWithActionHandler)._actionHandler = daemonRestartActionHandler;
  return command;
}

async function daemonStartAction(options: DaemonStartOptions): Promise<void> {
  await startDaemon(options);
}

async function daemonStopAction(options: DaemonStopOptions): Promise<void> {
  await stopDaemon(options, { exitOnComplete: true });
}

async function daemonRestartAction(options: DaemonStopOptions): Promise<void> {
  const cwd = process.cwd();
  const previousLock = readLockfile(cwd);
  const result = await stopDaemon(options, { exitOnComplete: false });
  if (result === 'aborted') return;
  if (result === 'stopped' && previousLock) {
    const released = await waitForDaemonRelease(previousLock);
    if (!released) {
      console.error(chalk.red('Timed out waiting for previous daemon to finish shutting down'));
      process.exit(1);
    }
  }
  await startDaemon({});
}

const daemonStartActionHandler = createActionHandler(daemonStartAction);
const daemonStopActionHandler = createActionHandler(daemonStopAction);
const daemonRestartActionHandler = createActionHandler(daemonRestartAction);

function createActionHandler<Options>(
  action: (options: Options, command: Command) => unknown,
): CommandActionHandler {
  return function sharedDaemonActionHandler(this: Command, args: unknown[]): unknown {
    const actionArgs = args.slice(0, this.registeredArguments.length);
    actionArgs[this.registeredArguments.length] = this.opts();
    actionArgs.push(this);
    return action.apply(this, actionArgs as [Options, Command]);
  };
}

async function waitForDaemonRelease(lock: DaemonLock): Promise<boolean> {
  const maxRetries = 20;
  const retryInterval = 250;

  for (let i = 0; i < maxRetries; i++) {
    if (!isPidAlive(lock.pid)) return true;
    if (!(await isServerAlive(lock))) return true;
    await new Promise((r) => setTimeout(r, retryInterval));
  }

  return !isPidAlive(lock.pid) || !(await isServerAlive(lock));
}

async function startDaemon(options: DaemonStartOptions): Promise<void> {
  const cwd = process.cwd();
  if (isAgentWorktreeCwd(cwd)) {
    console.error(chalk.red(
      `Refusing to start eforge daemon from agent worktree: ${cwd}. ` +
      `Run eforge from the project root, not from inside a worktree.`,
    ));
    process.exit(2);
  }
  const dbPath = resolve(cwd, '.eforge', 'monitor.db');
  const preferredPort = options.port ?? 4567;

  // Check if daemon is already running
  const existingLock = readLockfile(cwd);
  if (existingLock) {
    const alive = await isServerAlive(existingLock);
    if (alive) {
      console.log(chalk.yellow(`Daemon already running at http://localhost:${existingLock.port} (PID ${existingLock.pid})`));
      process.exit(0);
    }
    // Stale lockfile — kill stale daemon before spawning
    // SIGTERM first
    killPidIfAlive(existingLock.pid);
    // Wait 500ms for graceful shutdown
    await new Promise((r) => setTimeout(r, 500));
    // SIGKILL survivor
    if (isPidAlive(existingLock.pid)) {
      killPidIfAlive(existingLock.pid, 'SIGKILL');
    }
    removeLockfile(cwd);
  }

  // Spawn detached server-main with --persistent flag

  // Resolve via ESM import.meta.resolve: the monitor package's
  // ./server-main export only declares an "import" condition, so CJS
  // require.resolve (including createRequire) cannot match it.
  let serverMainPath: string;
  try {
    serverMainPath = fileURLToPath(import.meta.resolve('@eforge-build/monitor/server-main'));
  } catch {
    console.error(chalk.red('Monitor server-main entry not found. Did you run `pnpm build`?'));
    process.exit(1);
  }

  // Pass the CLI path through to the daemon so its in-process watcher
  // can spawn `queue exec` children against the CLI (argv[1] in the
  // daemon points at server-main.js, not the CLI).
  const env = { ...process.env };
  if (process.argv[1]) env.EFORGE_CLI_PATH = process.argv[1];

  const child = fork(serverMainPath, [dbPath, String(preferredPort), cwd, '--persistent'], {
    detached: true,
    stdio: 'ignore',
    execArgv: [...process.execArgv, '--disable-warning=ExperimentalWarning'],
    env,
  });

  child.on('error', (err) => {
    console.error(chalk.red(`Failed to start daemon: ${err.message}`));
    process.exit(1);
  });

  child.unref();
  child.disconnect?.();

  // Wait for lockfile to appear
  const maxRetries = 40;
  const retryInterval = 250;
  let lock: Awaited<ReturnType<typeof readLockfile>> = null;

  for (let i = 0; i < maxRetries; i++) {
    await new Promise((r) => setTimeout(r, retryInterval));
    lock = readLockfile(cwd);
    if (lock) {
      const alive = await isServerAlive(lock);
      if (alive) break;
      lock = null;
    }
  }

  if (!lock) {
    console.error(chalk.red('Daemon failed to start within timeout'));
    process.exit(1);
  }

  console.log(chalk.green(`Daemon started at http://localhost:${lock.port} (PID ${lock.pid})`));
}

async function stopDaemon(
  options: DaemonStopOptions,
  mode: { exitOnComplete: boolean },
): Promise<StopResult> {
  const cwd = process.cwd();
  const lock = readLockfile(cwd);

  if (!lock) {
    console.log(chalk.yellow('Daemon is not running'));
    if (mode.exitOnComplete) process.exit(0);
    return 'not-running';
  }

  if (!isPidAlive(lock.pid)) {
    removeLockfile(cwd);
    console.log(chalk.yellow('Daemon was not running (stale lockfile removed)'));
    if (mode.exitOnComplete) process.exit(0);
    return 'not-running';
  }

  // Safety valve: check for active builds unless --force
  if (!options.force) {
    let runningBuilds: { id: string; command: string; status: string }[] = [];
    try {
      const { openDatabase } = await import('@eforge-build/monitor/db');
      const dbPath = resolve(cwd, '.eforge', 'monitor.db');
      const db = openDatabase(dbPath);
      runningBuilds = db.getRunningRuns();
      db.close();
    } catch {
      // DB may not exist — no active builds
    }

    if (runningBuilds.length > 0) {
      // Non-TTY stdin: auto-force to avoid blocking in scripts/daemon
      const isTTY = process.stdin.isTTY === true;
      if (!isTTY) {
        // Auto-force in non-interactive mode
      } else {
        console.log(chalk.yellow(`Active builds (${runningBuilds.length}):`));
        for (const build of runningBuilds) {
          console.log(chalk.yellow(`  - ${build.id} (${build.command})`));
        }
        const readline = await import('node:readline/promises');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        try {
          const answer = await rl.question(chalk.yellow('Stop daemon with active builds? [y/N] '));
          if (answer.toLowerCase() !== 'y') {
            console.log(chalk.dim('Aborted'));
            if (mode.exitOnComplete) process.exit(0);
            return 'aborted';
          }
        } finally {
          rl.close();
        }
      }
    }
  }

  // Send SIGTERM to the daemon; its shutdown handler aborts the in-process
  // watcher and tears down the lockfile.
  try {
    process.kill(lock.pid, 'SIGTERM');
  } catch {
    // Process may have already exited
  }

  // Wait for lockfile removal (daemon's shutdown handler removes it)
  const maxRetries = 20; // 20 * 250ms = 5s
  const retryInterval = 250;

  for (let i = 0; i < maxRetries; i++) {
    await new Promise((r) => setTimeout(r, retryInterval));
    const stillExists = readLockfile(cwd);
    if (!stillExists) {
      console.log(chalk.green('Daemon stopped'));
      if (mode.exitOnComplete) process.exit(0);
      return 'stopped';
    }
  }

  // Force-kill escalation after 5s timeout
  console.log(chalk.yellow('Daemon did not shut down gracefully, escalating to SIGKILL...'));
  killPidIfAlive(lock.pid, 'SIGKILL');
  removeLockfile(cwd);
  console.log(chalk.green('Daemon force-stopped'));
  if (mode.exitOnComplete) process.exit(0);
  return 'stopped';
}
