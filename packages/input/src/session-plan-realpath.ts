import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { resolveProjectLocalStoragePath } from '@eforge-build/extension-sdk/project-storage';

export async function assertSessionPlanRealpathWithinRoot(cwd: string, targetPath: string): Promise<void> {
  const realRoot = await realpath(resolveProjectLocalStoragePath({ cwd, segments: ['session-plans'] }));
  const realTarget = await realpath(targetPath);
  const rel = relative(realRoot, realTarget);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error(`Resolved path "${targetPath}" escapes .eforge/session-plans/ via a symlink`);
  }
}
