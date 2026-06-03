import { describe, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EforgeEvent } from '@eforge-build/engine/events';
import type { QueuedPrd } from '@eforge-build/engine/prd-queue';
import {
  createTestEnv,
  waitForSchedulerEvents,
  waitForSpawnCallCount,
} from './queue-scheduler-helpers';

function makeCompiledResumePrd(cwd: string): QueuedPrd {
  const id = '01-resume-prd';
  const filePath = join(cwd, 'eforge', 'queue', `${id}.md`);
  const content = `---
title: Resume PRD
profile: resume-profile
resume_mode: compiled
resume_from: failed-prd
resume_set_name: failed-set
resume_feature_branch: eforge/failed-set
resume_base_branch: main
---

# Resume PRD
`;
  return {
    id,
    filePath,
    frontmatter: {
      title: 'Resume PRD',
      profile: 'resume-profile',
      resume_mode: 'compiled',
      resume_from: 'failed-prd',
      resume_set_name: 'failed-set',
      resume_feature_branch: 'eforge/failed-set',
      resume_base_branch: 'main',
    },
    content,
    lastCommitHash: '',
    lastCommitDate: '',
  };
}

function makeNormalPrd(cwd: string): QueuedPrd {
  const id = '02-normal-prd';
  const filePath = join(cwd, 'eforge', 'queue', `${id}.md`);
  const content = `---
title: Normal PRD
---

# Normal PRD
`;
  return {
    id,
    filePath,
    frontmatter: { title: 'Normal PRD' },
    content,
    lastCommitHash: '',
    lastCommitDate: '',
  };
}

describe('QueueScheduler — queued compiled resume', () => {
  it('dispatches a compiled-resume PRD through the queue scheduler and respects maxConcurrentBuilds', async () => {
    const { cwd, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();
    const resumePrd = makeCompiledResumePrd(cwd);
    const normalPrd = makeNormalPrd(cwd);
    await writeFile(resumePrd.filePath, resumePrd.content, 'utf-8');
    await writeFile(normalPrd.filePath, normalPrd.content, 'utf-8');

    spawnPrdChild.mockImplementation(() => new Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>(() => {}));

    const scheduler = makeScheduler([resumePrd, normalPrd], [], [], 1);
    await scheduler.start();

    await waitForSpawnCallCount(spawnPrdChild, 1);
    const events = await waitForSchedulerEvents(eventQueue, (seen) =>
      seen.some((event) => event.type === 'daemon:scheduler:dequeued' && event.prdId === resumePrd.id)
      && seen.some((event) => event.type === 'daemon:scheduler:capacity-blocked' && event.limit === 1)
      && seen.some((event) => event.type === 'session:profile' && event.profileName === 'resume-profile'),
    );

    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    const spawnedPrd = spawnPrdChild.mock.calls[0][0];
    expect(spawnedPrd.id).toBe(resumePrd.id);
    expect(spawnedPrd.frontmatter).toMatchObject({
      profile: 'resume-profile',
      resume_mode: 'compiled',
      resume_from: 'failed-prd',
      resume_set_name: 'failed-set',
      resume_feature_branch: 'eforge/failed-set',
      resume_base_branch: 'main',
    });
    expect(spawnPrdChild.mock.calls.map((call) => call[0].id)).not.toContain(normalPrd.id);

    expect(events).toContainEqual(expect.objectContaining({
      type: 'daemon:scheduler:dequeued',
      prdId: resumePrd.id,
      capacityRemaining: 0,
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'daemon:scheduler:capacity-blocked',
      runningCount: 1,
      limit: 1,
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'session:profile',
      profileName: 'resume-profile',
      source: 'override',
    }));

    eventQueue.removeProducer();
  });
});
