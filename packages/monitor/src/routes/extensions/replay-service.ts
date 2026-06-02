import type { EforgeEvent, ExtensionDiagnostic, ExtensionTestRequest, ExtensionTestResponse } from '@eforge-build/client';
import type { MonitorContext } from '../../context.js';
import { hydrateEforgeEvent } from '../../projections/event-hydration.js';
import { validateExtensionQueryPath } from './path-security.js';

function sourceResolutionDiagnostic(message: string): ExtensionDiagnostic {
  return { severity: 'error', code: 'extension:replay-source-error', message };
}

function hydrateRunReplayEvents(ctx: MonitorContext, sessionId: string): EforgeEvent[] {
  return ctx.db.getEventsBySession(sessionId).flatMap((evt) => {
    const parsed = hydrateEforgeEvent(evt);
    return parsed ? [parsed] : [];
  });
}

export async function replayExtensionTest(ctx: MonitorContext, body: ExtensionTestRequest): Promise<ExtensionTestResponse> {
  const cwd = ctx.cwd;
  if (!cwd) throw new Error('Working directory not configured');
  let extensionPath: string | undefined;
  if (body.path !== undefined) {
    extensionPath = await validateExtensionQueryPath(cwd, body.path) ?? undefined;
    if (!extensionPath) throw Object.assign(new Error('Invalid extension path'), { statusCode: 400 });
  }
  let fixturePath: string | undefined;
  if (body.fixture !== undefined) {
    fixturePath = await validateExtensionQueryPath(cwd, body.fixture) ?? undefined;
    if (!fixturePath) throw Object.assign(new Error('Invalid fixture path'), { statusCode: 400 });
  }
  const { loadConfig, getConfigDir, getConventionalConfigDir } = await import('@eforge-build/engine/config');
  const { parseExtensionEventFixtureFile, replayNativeExtensionEvents } = await import('@eforge-build/engine/extensions/index');
  const { config, warnings } = await loadConfig(cwd);
  for (const warning of warnings) process.stderr.write(`${warning}\n`);
  const configDir = await getConfigDir(cwd) ?? getConventionalConfigDir(cwd);
  const loaderConfig = extensionPath ? { enabled: true, trustProjectExtensions: config.extensions.trustProjectExtensions, include: ['__eforge_no_auto_extensions__'], paths: [extensionPath] } : config.extensions;
  let events: EforgeEvent[] = [];
  const sourceDiagnostics: ExtensionDiagnostic[] = [];
  let source: ExtensionTestResponse['source'] = { kind: 'none', ...(body.event !== undefined && { event: body.event }) };
  if (fixturePath) {
    const fixture = await parseExtensionEventFixtureFile(fixturePath);
    events = fixture.events;
    sourceDiagnostics.push(...fixture.diagnostics);
    source = { kind: 'fixture', fixture: fixturePath, ...(body.event !== undefined && { event: body.event }) };
  } else if (body.run !== undefined) {
    let sessionId: string | undefined;
    if (body.run === 'latest') {
      sessionId = ctx.db.getLatestSessionId();
      if (!sessionId) sourceDiagnostics.push(sourceResolutionDiagnostic('No latest run is available'));
    } else {
      sessionId = ctx.resolveSessionId(body.run);
      if (!ctx.db.getRun(body.run) && ctx.db.getSessionRuns(sessionId).length === 0) {
        sourceDiagnostics.push(sourceResolutionDiagnostic(`Run or session not found: ${body.run}`));
        sessionId = undefined;
      }
    }
    if (sessionId) events = hydrateRunReplayEvents(ctx, sessionId);
    source = { kind: 'run', run: body.run, ...(sessionId !== undefined && { sessionId }), ...(body.event !== undefined && { event: body.event }) };
  }
  return replayNativeExtensionEvents({ cwd, loaderOptions: { cwd, configDir, config: loaderConfig }, ...(body.name !== undefined && { name: body.name }), ...(extensionPath !== undefined && { path: extensionPath }), events, ...(body.event !== undefined && { eventType: body.event }), timeoutMs: config.extensions.eventHookTimeoutMs, source, sourceDiagnostics });
}
