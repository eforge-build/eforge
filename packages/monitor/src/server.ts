import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { DAEMON_API_VERSION } from '@eforge-build/client';
import type { MonitorDB } from './db.js';
import { createMonitorContext } from './context.js';
import { sendJsonError } from './http/response.js';
import { createControlMonitorRuntime } from './routes/control-runtime.js';
import { createMonitorRouter } from './routes/index.js';
import { createStreamHub } from './streams/stream-hub.js';
import type { MonitorServer, StartServerOptions } from './types.js';

/** Replaced at build time by tsup `define` with the daemon bundle's package version. */
declare const EFORGE_VERSION: string;

export type { MonitorServer, WorkerTracker, DaemonState, StartServerOptions } from './types.js';
export { buildRunSummary } from './projections/run-summary.js';

export async function startServer(
  db: MonitorDB,
  preferredPort = 4567,
  options?: StartServerOptions,
): Promise<MonitorServer> {
  const context = await createMonitorContext(db, preferredPort, options, {
    daemonApiVersion: DAEMON_API_VERSION,
    eforgeVersion: typeof EFORGE_VERSION === 'string' ? EFORGE_VERSION : 'unknown',
    pid: process.pid,
  });
  const streams = createStreamHub(context);
  const runtime = createControlMonitorRuntime();
  const router = createMonitorRouter(context, streams, runtime);

  const server = createServer((req, res) => {
    void handleRequest(router.handle, req, res);
  });

  let port: number;
  try {
    port = await listen(server, preferredPort, options?.strictPort ? 0 : 10);
  } catch (err) {
    streams.stop();
    throw err;
  }

  return {
    port,
    url: `http://localhost:${port}`,
    get subscriberCount() {
      return streams.subscriberCount();
    },
    broadcast(eventName, data) {
      streams.broadcast(eventName, data);
    },
    get onKeepAlive() {
      return runtime.getOnKeepAlive();
    },
    set onKeepAlive(cb) {
      runtime.setOnKeepAlive(cb);
    },
    async stop() {
      streams.stop();
      await closeServer(server);
    },
  };
}

async function handleRequest(
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    await handle(req, res);
  } catch (err) {
    console.error('Unhandled monitor request error', err instanceof Error ? err.message : String(err));
    if (res.headersSent) {
      res.destroy();
      return;
    }
    sendJsonError(res, 500, 'Internal server error');
  }
}

function listen(server: Server, port: number, maxRetries = 10): Promise<number> {
  return new Promise((resolve, reject) => {
    let currentPort = port;
    let attempts = 0;

    const tryListen = (): void => {
      const onError = (err: NodeJS.ErrnoException): void => {
        server.removeListener('listening', onListening);
        if (err.code === 'EADDRINUSE' && attempts < maxRetries) {
          attempts += 1;
          currentPort += 1;
          tryListen();
          return;
        }
        reject(err);
      };

      const onListening = (): void => {
        server.removeListener('error', onError);
        const address = server.address();
        if (typeof address === 'object' && address) {
          resolve(address.port);
          return;
        }
        resolve(currentPort);
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(currentPort, '0.0.0.0');
    };

    tryListen();
  });
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections?.();
  return new Promise((resolve, reject) => {
    server.close((err?: Error) => {
      if (!err || (err as NodeJS.ErrnoException).code === 'ERR_SERVER_NOT_RUNNING') {
        resolve();
        return;
      }
      reject(err);
    });
  });
}
