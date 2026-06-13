import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function expectContainsAll(path: string, snippets: string[]): void {
  const contents = read(path);
  for (const snippet of snippets) {
    expect(contents, `${path} should contain ${snippet}`).toContain(snippet);
  }
}

function readActionRow(contents: string, actionId: string): string {
  return contents.split('\n').find((line) => line.startsWith(`| \`${actionId}\` |`)) ?? '';
}

function readUsageBullet(contents: string, actionId: string): string {
  return contents.split('\n').find((line) => line.startsWith(`- \`${actionId}\` example input:`)) ?? '';
}

function readTextFilesUnder(root: string): Array<{ path: string; contents: string }> {
  const entries: Array<{ path: string; contents: string }> = [];
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist') continue;
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        visit(path);
      } else if (/\.(?:json|md|ts|tsx|js|mjs|cjs|yaml|yml|txt)$/.test(name)) {
        entries.push({ path, contents: read(path) });
      }
    }
  };
  visit(root);
  return entries;
}

describe('eforge-plan plan revision documentation contract', () => {
  it('documents the eforge-plan Revise with AI action surface and apply boundary', () => {
    const readmePath = 'eforge/extensions/eforge-plan/README.md';
    expectContainsAll(readmePath, [
      'Revise with AI',
      '.eforge/storage/extensions/eforge-plan/plan-revisions/index.json',
      'start-plan-revision-session',
      'list-plan-revision-sessions',
      'get-plan-revision-session',
      'start-plan-revision-turn',
      'retry-plan-revision-turn',
      'cancel-plan-revision-turn',
      'apply-plan-revision-turn',
      'answer-only',
      'patch preview',
      'auto-apply',
      'stale',
      'retry',
      'redraft',
      'handoff remains separate',
      'generic daemon-owned chat runtime',
    ]);

    const contents = read(readmePath);
    const revisionActions = [
      ['start-plan-revision-session', ['local-read', 'local-write']],
      ['list-plan-revision-sessions', ['local-read']],
      ['get-plan-revision-session', ['local-read']],
      ['start-plan-revision-turn', ['local-read', 'local-write', 'daemon-state']],
      ['retry-plan-revision-turn', ['local-read', 'local-write', 'daemon-state']],
      ['cancel-plan-revision-turn', ['local-write', 'daemon-state']],
      ['apply-plan-revision-turn', ['local-read', 'local-write']],
    ] as const;

    for (const [actionId, expectedSideEffects] of revisionActions) {
      const usageBullet = readUsageBullet(contents, actionId);
      expect(usageBullet, `${actionId} should document an example input`).toContain('example input');

      const row = readActionRow(contents, actionId);
      expect(row, `${actionId} should have an action table row`).not.toBe('');
      for (const sideEffect of expectedSideEffects) {
        expect(row, `${actionId} should declare ${sideEffect}`).toContain(sideEffect);
      }
      if (actionId === 'apply-plan-revision-turn') {
        expect(row).not.toContain('build-queue');
      }
    }

    const plansBullet = contents.match(/^- \*\*Plans\*\*.*$/m)?.[0] ?? '';
    expect(plansBullet).toContain('Flat plans');
    expect(plansBullet).toContain('Revise with AI');
    expect(plansBullet).toContain('Plan sets render');
    expect(plansBullet.indexOf('Revise with AI')).toBeLessThan(plansBullet.indexOf('Plan sets render'));
  });

  it('documents planRevisionTurn and preserves the daemon chat boundary in shared guides', () => {
    for (const path of ['docs/extensions.md', 'web/content/docs/extensions.md', 'web/public/docs/extensions.md']) {
      expectContainsAll(path, [
        'planRevisionTurn',
        'First-party eforge-plan revision sessions',
        'application-level pattern',
        'ctx.agentTasks',
        'Answer-only revision turns remain output-bearing',
        'top-level `needs-input` variant remains output-free',
        'links turns to daemon task ids',
        'multi-turn chat',
        'arbitrary raw prompt templates',
      ]);
    }
  });

  it('documents planRevisionTurn in the ctx.agentTasks API boundary', () => {
    for (const path of ['docs/extensions-api.md', 'web/content/docs/extensions-api.md', 'web/public/docs/extensions-api.md']) {
      expectContainsAll(path, [
        'ctx.agentTasks',
        'planRevisionTurn',
        'answer-only revision turns',
        'extension-owned revision threads',
        'daemon-owned single-shot task API',
        'multi-turn chat',
      ]);
    }
  });

  it('keeps generated public docs byte-identical to their source mirrors', () => {
    expect(read('web/public/docs/extensions.md')).toBe(read('web/content/docs/extensions.md'));
    expect(read('web/public/docs/extensions-api.md')).toBe(read('web/content/docs/extensions-api.md'));
  });

  it('includes the revision docs in the generated LLM bundle', () => {
    expectContainsAll('web/public/llms-full.txt', ['planRevisionTurn', 'Revise with AI']);
  });

  it('does not expose workstation-only revision sessions through Pi or Claude integration packages', () => {
    for (const root of ['eforge-plugin', 'packages/pi-eforge']) {
      for (const file of readTextFilesUnder(root)) {
        expect(file.contents, `${file.path} should not mention planRevisionTurn`).not.toContain('planRevisionTurn');
        expect(file.contents, `${file.path} should not mention Revise with AI`).not.toContain('Revise with AI');
        expect(file.contents, `${file.path} should not mention revision action ids`).not.toMatch(/(?:start|list|get|retry|cancel|apply)-plan-revision-(?:session|sessions|turn)/);
      }
    }
  });
});
