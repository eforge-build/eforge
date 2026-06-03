import type { ProjectContext } from '@eforge-build/client/browser';
import { projectBasename } from './runs';

/**
 * Extract `owner/repo` from a git remote URL (https or ssh GitHub form).
 * Returns null when the remote does not match a recognizable GitHub shape.
 */
export function extractOwnerRepo(gitRemote: string): string | null {
  const match = gitRemote.match(/(?:github\.com[:/])([^/]+\/[^/.]+?)(?:\.git)?$/);
  return match ? match[1] : null;
}

/**
 * Derive a human-readable project label from daemon-reported project context.
 * Prefers `owner/repo` from the git remote, then the cwd basename. Returns null
 * when no usable identity is present (e.g. context unavailable).
 */
export function projectLabelFromContext(ctx: ProjectContext | null | undefined): string | null {
  if (!ctx) return null;
  if (ctx.gitRemote) {
    const ownerRepo = extractOwnerRepo(ctx.gitRemote);
    if (ownerRepo) return ownerRepo;
  }
  return projectBasename(ctx.cwd);
}
