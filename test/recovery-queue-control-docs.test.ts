import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readRepoFile = (path: string) => readFileSync(path, 'utf-8');

const NEW_ROUTE_KEYS = [
  'recoveryGuidancePrepare',
  'queueHold',
  'queueUnhold',
  'queueCascadePreview',
  'queueCascadeApply',
  'failedEnqueues',
  'failedEnqueueReenqueue',
  'schedulerPause',
  'schedulerResume',
] as const;

const STALE_CASCADE_PHRASES = [
  'there is no cascade remove action',
  'future cascade-aware removal controls ship',
  'until future cascade',
  'future cascade controls ship',
] as const;

function expectContainsAll(path: string, expected: readonly string[]) {
  const raw = readRepoFile(path);
  for (const term of expected) {
    expect(raw, `${path} should contain ${term}`).toContain(term);
  }
}

function expectMatchesAll(path: string, expected: readonly RegExp[]) {
  const raw = readRepoFile(path);
  for (const pattern of expected) {
    expect(raw, `${path} should match ${pattern}`).toMatch(pattern);
  }
}

function expectOmitsStaleCascadePhrases(path: string) {
  const raw = readRepoFile(path).toLowerCase();
  for (const phrase of STALE_CASCADE_PHRASES) {
    expect(raw, `${path} should not contain stale cascade wording: ${phrase}`).not.toContain(phrase);
  }
}

describe('recovery and queue-control documentation contracts', () => {
  it('documents Console failed-enqueue, recovery, and queue-control data flow', () => {
    expectContainsAll('packages/console-ui/README.md', [
      'FailedEnqueueInfo',
      'failedEnqueues',
      'Re-enqueue',
      'QueueItem.dispatchFailure',
      'QueueItem.hold',
      'QueueItem.capabilities',
      'pauseScheduler / resumeScheduler',
    ]);

    expectMatchesAll('packages/console-ui/README.md', [
      /held rows?|hold\/unhold/i,
      /disabled reasons?|daemon reasons|show daemon reasons/i,
      /scheduler pause|pauses\/resumes scheduler|pauses\/resumes? scheduler/i,
      /cascade preview\/apply|cascade preview.*apply|preview-first .*cascade/i,
      /scheduler launches without disabling desired auto-build|launches without disabling desired auto-build/i,
    ]);
  });

  it('documents the client route helpers, projection fields, and daemon events', () => {
    expectContainsAll('packages/client/README.md', [
      'api/failed-enqueue.ts',
      'api/recovery-guidance.ts',
      'api/scheduler.ts',
      'apiHoldQueueItem',
      'apiPreviewQueueCascade',
      'failedEnqueues',
      'QueueItem.hold',
      'QueueItem.capabilities',
      'failed-enqueue projections',
      'scheduler pause/resume',
    ]);
  });

  it('keeps user-facing docs current for shipped queue/recovery controls', () => {
    const paths = [
      'README.md',
      'docs/architecture.md',
      'web/content/docs/concepts.md',
      'web/content/docs/troubleshooting.md',
      'web/content/docs/integrations.md',
    ] as const;

    for (const path of paths) {
      expectMatchesAll(path, [
        /hold|held/i,
        /scheduler (?:pause|paused)|paus(?:e|ed|es) (?:the )?scheduler/i,
        /cascade .*preview.*apply|preview.*cascade.*apply|preview\/apply/i,
        /failed[- ]enqueue/i,
      ]);
      expectOmitsStaleCascadePhrases(path);
    }
  });

  it('documents recovery guidance and glossary terminology', () => {
    expectMatchesAll('web/content/docs/troubleshooting.md', [
      /canonical `## Recovery Guidance` section/i,
      /before (?:queueing|dispatch|continue-and-repair|continue and repair)|continue-and-repair.*before/i,
      /continue-and-repair|continue and repair/i,
      /resume|compiled artifacts/i,
    ]);

    expectMatchesAll('web/content/docs/glossary.md', [
      /failed enqueue/i,
      /queue hold/i,
      /recovery guidance/i,
      /scheduler pause/i,
    ]);
  });

  it('documents Console-only exposure without inventing new host commands', () => {
    expectMatchesAll('web/content/docs/integrations.md', [
      /Console.*hold\/unhold|hold\/unhold.*Console/i,
      /scheduler pause\/resume|pause\/resume.*scheduler/i,
      /failed[- ]enqueue.*re-enqueue|re-enqueue.*failed[- ]enqueue/i,
      /cascade preview\/apply|cascade preview.*apply/i,
      /typed route helpers from `@eforge-build\/client`/i,
    ]);

    const integrations = readRepoFile('web/content/docs/integrations.md');
    for (const nonExposedHostCommand of [
      'eforge_queue_hold',
      'eforge_queue_unhold',
      'eforge_scheduler_pause',
      'eforge_scheduler_resume',
      'eforge_failed_enqueue_reenqueue',
    ]) {
      expect(integrations, `host docs should not invent ${nonExposedHostCommand}`).not.toContain(nonExposedHostCommand);
    }
  });

  it('includes new route keys and failed-enqueue events in generated references', () => {
    for (const path of ['web/content/reference/api.md', 'web/public/reference/api.md'] as const) {
      expectContainsAll(path, NEW_ROUTE_KEYS);
    }

    for (const path of ['web/content/reference/events.md', 'web/public/reference/events.md'] as const) {
      expectContainsAll(path, [
        'DaemonStreamSnapshot',
        'failedEnqueues',
        'daemon:failed-enqueue:upsert',
        'daemon:failed-enqueue:resolved',
      ]);
    }
  });

  it('includes queue hold/capabilities and failed-enqueue snapshot fields in the generated schema', () => {
    expectContainsAll('web/public/schemas/events.schema.json', [
      'failedEnqueues',
      'capabilities',
      'hold',
    ]);
  });

  it('keeps generated public mirrors byte-identical to edited guide sources', () => {
    for (const page of ['concepts', 'integrations', 'troubleshooting', 'glossary'] as const) {
      expect(readRepoFile(`web/public/docs/${page}.md`)).toBe(readRepoFile(`web/content/docs/${page}.md`));
    }
  });
});
