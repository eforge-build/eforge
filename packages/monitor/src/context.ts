import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_ROUTES, DAEMON_API_VERSION } from '@eforge-build/client';
import { DEFAULT_CONFIG, getConfigDir, getConventionalConfigDir } from '@eforge-build/engine/config';
import type { MonitorDB } from './db.js';
import type { MonitorQueuePaths, MonitorUiRoots, MonitorVersionInfo, StartServerOptions } from './types.js';
import type { AutoBuildQueueMutationReason } from './auto-build-supervisor.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_UI_ROOTS: MonitorUiRoots = {
  monitorUiDir: resolve(__dirname, 'monitor-ui'),
  consoleUiDir: resolve(__dirname, 'console-ui'),
};

export interface MonitorContext {
  db: MonitorDB;
  preferredPort: number;
  options: StartServerOptions;
  cwd?: string;
  queuePaths?: MonitorQueuePaths;
  relativePlanOutputDir: string;
  planOutputDir: string;
  uiRoots: MonitorUiRoots;
  versionInfo: MonitorVersionInfo;
  daemonSessionId: string;
  cachedGitRemote: string | null;
  apiRoutes: typeof API_ROUTES;
  resolveSessionId(id: string): string;
  getRunningBuildCount(): number;
  getSchedulerLimit(): number;
  notifyQueueMutation(reason: AutoBuildQueueMutationReason): void;
  getDiscoveredConfigDir(): Promise<string | null>;
  getConfigDirOrConventional(): Promise<string>;
}

export async function createMonitorContext(
  db: MonitorDB,
  preferredPort = 4567,
  options: StartServerOptions = {},
  versionInfo: MonitorVersionInfo = {
    daemonApiVersion: DAEMON_API_VERSION,
    eforgeVersion: 'unknown',
    pid: process.pid,
  },
): Promise<MonitorContext> {
  const cwd = options.cwd;
  const relativePlanOutputDir = options.config?.plan?.outputDir ?? options.planOutputDir ?? 'eforge/plans';
  const planOutputDir = cwd ? resolve(cwd, relativePlanOutputDir) : relativePlanOutputDir;
  const uiRoots = {
    monitorUiDir: options.uiDirs?.monitorUiDir ?? DEFAULT_UI_ROOTS.monitorUiDir,
    consoleUiDir: options.uiDirs?.consoleUiDir ?? DEFAULT_UI_ROOTS.consoleUiDir,
  };
  const queuePaths = cwd ? buildQueuePaths(cwd, options) : undefined;
  const daemonSessionId = options.daemonSessionId ?? `daemon-${process.pid}-${Date.now()}`;

  try {
    db.cleanupOldSessions(options.config?.monitor?.retentionCount ?? 100);
  } catch {
    // Best-effort cleanup must not block daemon startup.
  }

  let cachedGitRemote: string | null = null;
  if (cwd) {
    try {
      const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd });
      cachedGitRemote = stdout.trim() || null;
    } catch {
      cachedGitRemote = null;
    }
  }

  return {
    db,
    preferredPort,
    options,
    cwd,
    queuePaths,
    relativePlanOutputDir,
    planOutputDir,
    uiRoots,
    versionInfo,
    daemonSessionId,
    cachedGitRemote,
    apiRoutes: API_ROUTES,
    resolveSessionId(id) {
      return db.getRun(id)?.sessionId ?? id;
    },
    getRunningBuildCount() {
      try {
        return db.getRunningRuns().length;
      } catch {
        return 0;
      }
    },
    getSchedulerLimit() {
      return options.config?.maxConcurrentBuilds ?? DEFAULT_CONFIG.maxConcurrentBuilds;
    },
    notifyQueueMutation(reason) {
      options.daemonState?.autoBuildController.notifyQueueMutation(reason);
    },
    getDiscoveredConfigDir() {
      return getConfigDir(cwd);
    },
    async getConfigDirOrConventional() {
      return (await getConfigDir(cwd)) ?? getConventionalConfigDir(cwd);
    },
  };
}

function buildQueuePaths(cwd: string, options: StartServerOptions): MonitorQueuePaths {
  const relativeQueueDir = options.config?.prdQueue?.dir ?? options.queueDir ?? '.eforge/queue';
  const queueDir = resolve(cwd, relativeQueueDir);
  return {
    relativeQueueDir,
    queueDir,
    lockDir: resolve(cwd, '.eforge', 'queue-locks'),
    failedDir: resolve(queueDir, 'failed'),
    skippedDir: resolve(queueDir, 'skipped'),
    waitingDir: resolve(queueDir, 'waiting'),
  };
}
