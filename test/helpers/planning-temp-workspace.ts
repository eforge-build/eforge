import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface PlanningTempWorkspace { cwd: string; writeFile(relativePath: string, content: string): Promise<void>; cleanup(): Promise<void>; gitInit(): Promise<void> }

export async function createPlanningTempWorkspace(files: Record<string, string> = {}, options: { git?: boolean } = {}): Promise<PlanningTempWorkspace> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'eforge-planning-workspace-'));
  const workspace: PlanningTempWorkspace = {
    cwd,
    async writeFile(relativePath, content) { await writeWorkspaceFile(cwd, relativePath, content); },
    async cleanup() { await rm(cwd, { recursive: true, force: true }); },
    async gitInit() { await initGit(cwd); },
  };
  for (const [relativePath, content] of Object.entries(files)) await workspace.writeFile(relativePath, content);
  if (options.git) await workspace.gitInit();
  return workspace;
}

async function writeWorkspaceFile(cwd: string, relativePath: string, content: string): Promise<void> {
  const absolute = path.join(cwd, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content, 'utf8');
}

async function initGit(cwd: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd });
  await execFileAsync('git', ['config', 'user.email', 'tests@example.invalid'], { cwd });
  await execFileAsync('git', ['config', 'user.name', 'Tests'], { cwd });
  await execFileAsync('git', ['add', '-A'], { cwd });
}
