import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EforgeEvent } from '@eforge-build/engine/events';
import type { EforgeConfig } from '@eforge-build/engine/config';
import type { AgentHarness } from '@eforge-build/engine/harness';
import type { AgentRuntimeRegistry } from '@eforge-build/engine/agent-runtime-registry';
import type { NativeExtensionRegistry } from '@eforge-build/engine/extensions/types';
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
  listWorkerSessions?(): string[];
  cancelWorkerProcess?(sessionId: string): boolean;
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
  config?: Pick<EforgeConfig, 'monitor' | 'agents' | 'prdQueue' | 'maxConcurrentBuilds' | 'plan' | 'build'> & { recovery?: EforgeConfig['recovery']; stacking?: EforgeConfig['stacking']; extensions?: EforgeConfig['extensions'] };
  agentRuntimes?: AgentRuntimeRegistry | AgentHarness;
  nativeExtensionRegistry?: Pick<NativeExtensionRegistry, 'policyGates'>;
  nativeExtensionConfigDir?: string;
  configDir?: string;
  uiDirs?: { consoleUiDir?: string };
  daemonSessionId?: string;
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
  consoleUiDir: string;
}

export interface MonitorStreamHub {
  attachSession(req: IncomingMessage, res: ServerResponse, id: string): void;
  attachDaemon(req: IncomingMessage, res: ServerResponse): void | Promise<void>;
  broadcast(eventName: string, data: string | EforgeEvent): void;
  subscriberCount(): number;
  stop(): void;
  buildHeartbeatObject?(): unknown;
}
