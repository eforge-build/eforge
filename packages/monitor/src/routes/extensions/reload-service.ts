import type { AutoBuildState, ExtensionReloadWatcherMetadata } from '@eforge-build/client';
import type { StartServerOptions } from '../../types.js';

function emptyAutoBuildState(): AutoBuildState {
  return {
    enabled: false,
    desired: 'disabled',
    mode: 'disabled',
    watcher: { running: false, sessionId: null },
  } as AutoBuildState;
}

export async function reloadAutoBuildExtensions(daemonState: StartServerOptions['daemonState']): Promise<ExtensionReloadWatcherMetadata> {
  const controller = daemonState?.autoBuildController;
  const before = controller?.getSnapshot() ?? emptyAutoBuildState();
  const after = controller?.reloadExtensions ? await controller.reloadExtensions() : before;
  const restarted = before.watcher.sessionId !== after.watcher.sessionId && after.watcher.running;
  return {
    wasRunning: before.watcher.running,
    restarted,
    running: after.watcher.running,
    previousSessionId: before.watcher.sessionId,
    sessionId: after.watcher.sessionId,
    message: restarted
      ? 'Extension discovery refreshed and runtime watcher restarted.'
      : 'Extension discovery refreshed; no runtime watcher was restarted.',
  };
}
