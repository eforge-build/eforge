import type { ServerResponse } from 'node:http';
import type { EforgeEvent } from '@eforge-build/engine/events';
import type { EforgeConfig } from '@eforge-build/engine/config';
import type { AutoBuildController } from './auto-build-supervisor.js';

export interface MonitorServer {
  readonly port: number;
  readonly url: string;
  readonly subscriberCount: number;
  broadcast(eventName: string, data: string): void;
  onKeepAlive: (() => void) | null;
  stop(): Promise<void>;
}

export interface WorkerTracker {
  spawnWorker(command: string, args: string[], onExit?: () => void): { sessionId: string; pid: number };
  cancelWorker(sessionId: string): boolean;
}

export interface DaemonState {
  autoBuildController: AutoBuildController;
  onShutdown?: () => void;
}

export interface StartServerOptions {
  strictPort?: boolean;
  cwd?: string;
  queueDir?: string;
  planOutputDir?: string;
  workerTracker?: WorkerTracker;
  daemonState?: DaemonState;
  config?: Pick<EforgeConfig, 'monitor' | 'agents' | 'prdQueue' | 'maxConcurrentBuilds' | 'plan' | 'build'>;
  uiDirs?: { monitorUiDir?: string; consoleUiDir?: string };
}

export interface MonitorVersionInfo {
  daemonApiVersion: number;
  eforgeVersion: string;
  pid: number;
}

export interface MonitorQueuePaths {
  relativeQueueDir: string;
  queueDir: string;
  lockDir: string;
  failedDir: string;
  skippedDir: string;
  waitingDir: string;
}

export interface MonitorUiRoots {
  monitorUiDir: string;
  consoleUiDir: string;
}

export interface MonitorStreamHub {
  attachSession(res: ServerResponse, sessionId: string, lastSeenId?: number): void;
  attachDaemon(res: ServerResponse, lastSeenId?: number): void;
  broadcast(eventName: string, data: string | EforgeEvent): void;
  subscriberCount(): number;
  stop(): void;
  buildHeartbeatObject?(): unknown;
}
