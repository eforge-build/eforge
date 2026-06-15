import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inferStackParentFromDependencies } from '@eforge-build/engine/queue/stack-parent-inference';
import { saveStackState } from '@eforge-build/engine/stacking/state';
import type { StackLayer } from '@eforge-build/engine/stacking/types';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-stack-parent-inference-'));
  tempDirs.push(cwd);
  await mkdir(join(cwd, '.eforge', 'queue'), { recursive: true });
  return cwd;
}

async function writePrd(cwd: string, id: string, fields: { dependsOn?: string[]; stackParent?: string } = {}): Promise<void> {
  const lines = [`title: ${id}`];
  if (fields.dependsOn && fields.dependsOn.length > 0) {
    lines.push(`depends_on: [${fields.dependsOn.join(', ')}]`);
  }
  if (fields.stackParent) lines.push(`stack_parent: ${fields.stackParent}`);
  await writeFile(join(cwd, '.eforge', 'queue', `${id}.md`), `---\n${lines.join('\n')}\n---\n`, 'utf-8');
}

function layer(prdId: string, parentPrdId?: string): StackLayer {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    prdId,
    stackId: 'stack-1',
    ...(parentPrdId !== undefined && { parentPrdId }),
    provider: 'git-spice',
    branch: `eforge/${prdId}`,
    artifact: { branch: `eforge/${prdId}` },
    status: 'landed',
    recordedAt: now,
    updatedAt: now,
  };
}

describe('inferStackParentFromDependencies', () => {
  it('returns the only dependency for single-dependency stacks', async () => {
    const cwd = await makeProject();

    const result = await inferStackParentFromDependencies({
      cwd,
      queueDir: '.eforge/queue',
      dependsOn: ['parent'],
    });

    expect(result).toEqual({ ambiguous: false, stackParent: 'parent' });
  });

  it('infers the topmost dependency from queued dependency chains', async () => {
    const cwd = await makeProject();
    await writePrd(cwd, 'base');
    await writePrd(cwd, 'middle', { dependsOn: ['base'] });
    await writePrd(cwd, 'top', { dependsOn: ['middle'] });

    const result = await inferStackParentFromDependencies({
      cwd,
      queueDir: '.eforge/queue',
      dependsOn: ['top', 'middle', 'base'],
    });

    expect(result).toEqual({ ambiguous: false, stackParent: 'top' });
  });

  it('infers the topmost dependency from recorded stack layers after queue cleanup', async () => {
    const cwd = await makeProject();
    await saveStackState(cwd, {
      version: 1,
      layers: [layer('base'), layer('middle', 'base'), layer('top', 'middle')],
    });

    const result = await inferStackParentFromDependencies({
      cwd,
      queueDir: '.eforge/queue',
      dependsOn: ['base', 'middle', 'top'],
    });

    expect(result).toEqual({ ambiguous: false, stackParent: 'top' });
  });

  it('reports ambiguity when multiple dependencies do not form one known chain', async () => {
    const cwd = await makeProject();
    await writePrd(cwd, 'one');
    await writePrd(cwd, 'two');

    const result = await inferStackParentFromDependencies({
      cwd,
      queueDir: '.eforge/queue',
      dependsOn: ['one', 'two'],
    });

    expect(result.ambiguous).toBe(true);
    expect(result.reason).toContain('Cannot infer stack_parent');
    expect(result.reason).toContain('topmost candidates: one, two');
  });
});
