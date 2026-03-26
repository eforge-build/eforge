/**
 * MCP stdio proxy server.
 *
 * Bridges MCP tool calls from Claude Code to the eforge daemon's HTTP API.
 * Auto-starts the daemon if not running. Called via `eforge mcp-proxy`.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ensureDaemon, daemonRequest, sleep, DAEMON_POLL_INTERVAL_MS } from './daemon-client.js';
import { readLockfile } from '../monitor/lockfile.js';

const ALLOWED_FLAGS = new Set([
  '--queue',
  '--watch',
  '--auto',
  '--verbose',
  '--dry-run',
  '--no-monitor',
  '--no-plugins',
  '--no-generate-profile',
  '--poll-interval',
  '--profiles',
]);

function sanitizeFlags(flags?: string[]): string[] | undefined {
  if (!flags) return undefined;
  const result: string[] = [];
  let skipNext = false;
  for (const flag of flags) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (ALLOWED_FLAGS.has(flag)) {
      result.push(flag);
    } else if (!flag.startsWith('-')) {
      result.push(flag);
    } else {
      skipNext = true;
    }
  }
  return result;
}

// Re-export for any consumers that imported from here
export { ensureDaemon, daemonRequest };

export async function runMcpProxy(cwd: string): Promise<void> {
  const server = new McpServer({
    name: 'eforge',
    version: '0.5.0',
  });

  // Tool: eforge_build
  server.tool(
    'eforge_build',
    'Enqueue a PRD source for the eforge daemon to build. Returns a sessionId and autoBuild status.',
    {
      source: z
        .string()
        .describe('PRD file path or inline description to enqueue for building'),
    },
    async ({ source }) => {
      const { data, port } = await daemonRequest(cwd, 'POST', '/api/enqueue', { source });
      const obj = data != null && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : { data };
      const response = { ...obj, monitorUrl: `http://localhost:${port}` };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // Tool: eforge_enqueue
  server.tool(
    'eforge_enqueue',
    'Normalize input and add it to the eforge PRD queue.',
    {
      source: z.string().describe('PRD file path, inline prompt, or rough notes to enqueue'),
      flags: z.array(z.string()).optional().describe('Optional CLI flags'),
    },
    async ({ source, flags }) => {
      const { data, port } = await daemonRequest(cwd, 'POST', '/api/enqueue', { source, flags: sanitizeFlags(flags) });
      const obj = data != null && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : { data };
      const response = { ...obj, monitorUrl: `http://localhost:${port}` };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // Tool: eforge_auto_build
  server.tool(
    'eforge_auto_build',
    'Get or set the daemon auto-build state. When enabled, the daemon automatically builds PRDs as they are enqueued.',
    {
      action: z.enum(['get', 'set']).describe("'get' returns current auto-build state, 'set' updates it"),
      enabled: z.boolean().optional().describe('Required when action is "set". Whether auto-build should be enabled.'),
    },
    async ({ action, enabled }) => {
      if (action === 'get') {
        const { data } = await daemonRequest(cwd, 'GET', '/api/auto-build');
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
      // action === 'set'
      if (enabled === undefined) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: '"enabled" is required when action is "set"' }, null, 2) }],
          isError: true,
        };
      }
      const { data } = await daemonRequest(cwd, 'POST', '/api/auto-build', { enabled });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  // Tool: eforge_status
  server.tool(
    'eforge_status',
    'Get the current run status including plan progress, session state, and event summary.',
    {},
    async () => {
      const { data: latestRun } = await daemonRequest(cwd, 'GET', '/api/latest-run');
      const latestRunObj = latestRun as { sessionId?: string };
      if (!latestRunObj?.sessionId) {
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'idle', message: 'No active eforge sessions.' }) }] };
      }
      const { data: summary } = await daemonRequest(cwd, 'GET', `/api/run-summary/${encodeURIComponent(latestRunObj.sessionId)}`);
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    },
  );

  // Tool: eforge_queue_list
  server.tool(
    'eforge_queue_list',
    'List all PRDs currently in the eforge queue with their metadata.',
    {},
    async () => {
      const { data } = await daemonRequest(cwd, 'GET', '/api/queue');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  // Tool: eforge_config
  server.tool(
    'eforge_config',
    'Show resolved eforge configuration or validate eforge.yaml.',
    {
      action: z.enum(['show', 'validate']).describe("'show' returns resolved config, 'validate' checks for errors"),
    },
    async ({ action }) => {
      const path = action === 'validate' ? '/api/config/validate' : '/api/config/show';
      const { data } = await daemonRequest(cwd, 'GET', path);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  // Tool: eforge_daemon
  server.tool(
    'eforge_daemon',
    'Manage the eforge daemon lifecycle: start, stop, or restart the daemon.',
    {
      action: z.enum(['start', 'stop', 'restart']).describe("'start' ensures daemon is running, 'stop' gracefully stops it, 'restart' stops then starts"),
      force: z.boolean().optional().describe('When action is "stop" or "restart", force shutdown even if builds are active. Default: false.'),
    },
    async ({ action, force }) => {
      const LOCKFILE_POLL_INTERVAL_MS = 250;
      const LOCKFILE_POLL_TIMEOUT_MS = 5000;

      async function checkActiveBuilds(): Promise<string | null> {
        try {
          const { data: latestRun } = await daemonRequest(cwd, 'GET', '/api/latest-run');
          const latestRunObj = latestRun as { sessionId?: string };
          if (!latestRunObj?.sessionId) return null;
          const { data: summary } = await daemonRequest(cwd, 'GET', `/api/run-summary/${encodeURIComponent(latestRunObj.sessionId)}`);
          const summaryObj = summary as { status?: string };
          if (summaryObj?.status === 'running') {
            return 'An eforge build is currently active. Use force: true to stop anyway.';
          }
          return null;
        } catch {
          return null;
        }
      }

      async function stopDaemon(forceStop: boolean): Promise<{ stopped: boolean; message: string }> {
        // Check if daemon is running
        const lock = readLockfile(cwd);
        if (!lock) {
          return { stopped: true, message: 'Daemon is not running.' };
        }

        // Check for active builds unless force
        if (!forceStop) {
          const activeMessage = await checkActiveBuilds();
          if (activeMessage) {
            return { stopped: false, message: activeMessage };
          }
        }

        // Send stop request
        try {
          await daemonRequest(cwd, 'POST', '/api/daemon/stop', { force: forceStop });
        } catch {
          // Daemon may have already shut down before responding
        }

        // Poll for lockfile removal
        const deadline = Date.now() + LOCKFILE_POLL_TIMEOUT_MS;
        while (Date.now() < deadline) {
          await sleep(LOCKFILE_POLL_INTERVAL_MS);
          const current = readLockfile(cwd);
          if (!current) {
            return { stopped: true, message: 'Daemon stopped successfully.' };
          }
        }

        return { stopped: true, message: 'Daemon stop requested. Lockfile may take a moment to clear.' };
      }

      if (action === 'start') {
        const port = await ensureDaemon(cwd);
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'running', port }, null, 2) }] };
      }

      if (action === 'stop') {
        const result = await stopDaemon(force === true);
        if (!result.stopped) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: result.message }, null, 2) }], isError: true };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'stopped', message: result.message }, null, 2) }] };
      }

      // action === 'restart'
      const stopResult = await stopDaemon(force === true);
      if (!stopResult.stopped) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: stopResult.message }, null, 2) }], isError: true };
      }

      const port = await ensureDaemon(cwd);
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'restarted', port, message: 'Daemon restarted successfully.' }, null, 2) }] };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
