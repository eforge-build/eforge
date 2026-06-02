import { lstat, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

function isWithinDir(resolvedPath: string, baseDir: string): boolean {
  const base = resolve(baseDir) + sep;
  const resolved = resolve(resolvedPath);
  return resolved === resolve(baseDir) || resolved.startsWith(base);
}

export async function validateExtensionQueryPath(cwd: string | undefined, rawPath: string): Promise<string | null> {
  if (!cwd || rawPath.length === 0 || rawPath.includes('\0')) return null;
  const resolvedPath = resolve(cwd, rawPath);
  if (!isWithinDir(resolvedPath, cwd)) return null;
  try {
    const [realCwd, realResolvedPath] = await Promise.all([realpath(cwd), realpath(resolvedPath)]);
    return isWithinDir(realResolvedPath, realCwd) ? realResolvedPath : null;
  } catch {
    return null;
  }
}

export async function isProjectTeamExtensionPath(cwd: string | undefined, rawPath: string, configDir: string): Promise<boolean> {
  if (!cwd || rawPath.length === 0 || rawPath.includes('\0')) return false;
  const teamExtensionsDir = resolve(configDir, 'extensions');
  const resolvedPath = resolve(cwd, rawPath);
  if (!isWithinDir(resolvedPath, teamExtensionsDir)) return false;
  try {
    const teamDirInfo = await lstat(teamExtensionsDir);
    if (!teamDirInfo.isDirectory() || teamDirInfo.isSymbolicLink()) return false;
    const [realTeamDir, realResolvedPath] = await Promise.all([realpath(teamExtensionsDir), realpath(resolvedPath)]);
    return isWithinDir(realResolvedPath, realTeamDir);
  } catch {
    return false;
  }
}
