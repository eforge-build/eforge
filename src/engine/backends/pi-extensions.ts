/**
 * Pi extension discovery — resolves extension paths from config and auto-discovery locations.
 */

import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Configuration for Pi extension discovery. */
export interface PiExtensionConfig {
  /** Explicit extension directory paths to load. */
  paths?: string[];
  /** Whether to auto-discover extensions from standard locations. Default: true. */
  autoDiscover?: boolean;
}

/**
 * Discover Pi extension paths from explicit config and standard auto-discovery locations.
 *
 * Auto-discovery locations:
 * 1. `.pi/extensions/` in the project root (cwd)
 * 2. `~/.pi/extensions/` global directory
 *
 * When `autoDiscover: false`, only explicit `paths` are returned.
 *
 * @param cwd - Project working directory
 * @param config - Extension discovery configuration
 * @returns Array of resolved extension directory paths that exist on disk
 */
export async function discoverPiExtensions(
  cwd: string,
  config?: PiExtensionConfig,
): Promise<string[]> {
  const result: string[] = [];

  // Add explicit paths first
  if (config?.paths) {
    for (const p of config.paths) {
      if (existsSync(p)) {
        result.push(p);
      }
    }
  }

  // Skip auto-discovery if disabled
  if (config?.autoDiscover === false) {
    return result;
  }

  // Auto-discover from project-local .pi/extensions/
  const projectExtDir = join(cwd, '.pi', 'extensions');
  await collectExtensionDirs(projectExtDir, result);

  // Auto-discover from global ~/.pi/extensions/
  const globalExtDir = join(homedir(), '.pi', 'extensions');
  await collectExtensionDirs(globalExtDir, result);

  return result;
}

/**
 * Collect extension directories from a parent directory.
 * Each immediate subdirectory is treated as an extension.
 */
async function collectExtensionDirs(parentDir: string, out: string[]): Promise<void> {
  if (!existsSync(parentDir)) return;

  try {
    const entries = await readdir(parentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        out.push(join(parentDir, entry.name));
      }
    }
  } catch {
    // Directory not readable — skip silently
  }
}
