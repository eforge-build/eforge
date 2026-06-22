import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import type { NativeExtensionRegistry } from '@eforge-build/engine/extensions/types.js';
import extension from '../index.js';

export function record(): NativeExtensionRegistry {
  const { api, state } = createExtensionRecorder('eforge-playbooks', '/project/eforge/extensions/eforge-playbooks/index.ts');
  extension(api as never);
  return { ...state, extensions: [], candidates: [] };
}

export async function withTempProject<T>(fn: (cwd: string, configDir: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-playbooks-'));
  const configDir = resolve(cwd, 'eforge');
  try { return await fn(cwd, configDir); } finally { await rm(cwd, { recursive: true, force: true }); }
}

export function rawPlaybook(opts: { name: string; scope: 'user' | 'project-team' | 'project-local'; mode?: 'autonomous' | 'planning'; profile?: string; postMerge?: string[]; ac?: string }): string {
  const postMerge = opts.postMerge ? `postMerge:\n${opts.postMerge.map((cmd) => `  - ${cmd}`).join('\n')}\n` : '';
  const profile = opts.profile ? `profile: ${opts.profile}\n` : '';
  return `---\nname: ${opts.name}\ndescription: ${opts.name} description\nscope: ${opts.scope}\nmode: ${opts.mode ?? 'autonomous'}\n${profile}${postMerge}---\n\n## Goal\n\nShip ${opts.name}.\n\n## Acceptance criteria\n\n${opts.ac ?? '- `pnpm type-check` exits 0.'}\n\n## Notes for the planner\n\nUse public APIs.\n`;
}

export async function writePlaybook(cwd: string, scope: 'project-local' | 'project-team' | 'user', name: string, raw = rawPlaybook({ name, scope })): Promise<string> {
  const root = scope === 'project-local' ? resolve(cwd, '.eforge') : scope === 'project-team' ? resolve(cwd, 'eforge') : resolve(cwd, '.xdg', 'eforge');
  const dir = resolve(root, 'playbooks');
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, `${name}.md`);
  await writeFile(path, raw, 'utf-8');
  return path;
}
