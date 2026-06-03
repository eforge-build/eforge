import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Create an isolated temp dir to serve as the user-level XDG config home.
 * Returns the base dir and the eforge-specific dir inside it.
 */
export async function makeUserHome(): Promise<{ userHomeDir: string; userEforgeDir: string }> {
  const userHomeDir = await mkdtemp(join(tmpdir(), 'eforge-user-'));
  const userEforgeDir = join(userHomeDir, 'eforge');
  await mkdir(userEforgeDir, { recursive: true });
  return { userHomeDir, userEforgeDir };
}

/**
 * Create an isolated temp project dir with an `eforge/` subdir and
 * optionally a seed `config.yaml`. Returns the project root dir and
 * the config dir (which is the same as projectDir/eforge).
 */
export async function makeProject(seed?: { configYaml?: string }): Promise<{ projectDir: string; configDir: string }> {
  const projectDir = await mkdtemp(join(tmpdir(), 'eforge-bp-'));
  const configDir = join(projectDir, 'eforge');
  await mkdir(configDir, { recursive: true });
  if (seed?.configYaml !== undefined) {
    await writeFile(join(configDir, 'config.yaml'), seed.configYaml, 'utf-8');
  }
  return { projectDir, configDir };
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
