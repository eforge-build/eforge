import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const README = 'eforge/extensions/eforge-plan/README.md';

function sentenceContaining(readme: string, needle: string): string[] {
  return readme
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence.includes(needle));
}

function actionTableRows(readme: string): string[] {
  const start = readme.indexOf('| Action | Purpose | Side effects |');
  const end = readme.indexOf('\n## Promotion flow', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return readme.slice(start, end).split('\n').filter((line) => /^\| `/.test(line));
}

function actionRow(readme: string, actionId: string): string {
  const row = actionTableRows(readme).find((candidate) => candidate.startsWith(`| \`${actionId}\` |`));
  expect(row).toBeDefined();
  return row!;
}

function sectionBetween(readme: string, heading: string, nextHeading: string): string {
  const start = readme.indexOf(heading);
  const end = nextHeading.length === 0 ? readme.length : readme.indexOf(nextHeading, start + heading.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return readme.slice(start, end);
}

describe('eforge-plan README planner contract', () => {
  it('documents private recommendations, promotion sources, planner boundaries, and non-goals', async () => {
    const readme = await readFile(README, 'utf-8');

    expect(readme).toContain('.eforge/storage/extensions/eforge-plan/recommendations/current.json');
    expect(readme).toContain('.eforge/storage/extensions/eforge-plan/recommendations/status.json');
    expect(readme).toMatch(/missing[\s\S]*No private recommendation model exists/);
    expect(readme).toMatch(/fresh[\s\S]*status\.json[\s\S]*matches/);
    expect(readme).toMatch(/stale[\s\S]*sidecar is missing\/invalid|stale[\s\S]*fingerprint differs/);
    expect(readme).toContain('refresh-recommendations');
    expect(readme).toMatch(/refresh-recommendations[\s\S]*does not apply generated output automatically/);
    expect(readme).toContain('promote-selection');
    expect(readme).toContain('prepare-planner-context');
    expect(readme).toContain('apply-planner-result');
    expect(readme).toContain('daemon-owned');
    expect(readme).toContain('start-planning-agent-task');
    expect(readme).toContain('get-planning-agent-task');
    expect(readme).toContain('cancel-planning-agent-task');
    expect(readme).toContain('apply-planning-agent-task-result');
    expect(readme).toContain('read-only');
    expect(readme).toContain('multi-turn chat');
    expect(readme).toContain('explicitly chooses');
    expect(readme).toContain('unattended enqueueing');
    expect(readme).toContain('queue orchestration');
    expect(readme).toContain('legacy `.backlog/recommendations.json` import/export');
    expect(readme).toMatch(/recommended item|recommended group|epic|selected item set/s);
    expect(readme).toMatch(/general extension-owned AI chat runtime support is not implemented/i);
  });

  it('documents private backlog storage and legacy compatibility without canonical legacy writes', async () => {
    const readme = await readFile(README, 'utf-8');

    expect(readme).toContain('.eforge/storage/extensions/eforge-plan/backlog/items/<id>.md');
    expect(readme).toContain('.eforge/storage/extensions/eforge-plan/backlog/epics/<id>.md');
    expect(readme).toMatch(/\.backlog\/items\/<id>\.md[\s\S]{0,120}(legacy|read-through|import inputs?)/);
    expect(readme).toMatch(/\.backlog\/epics\/<id>\.md[\s\S]{0,120}(legacy|read-through|import inputs?)/);

    for (const legacyPath of ['.backlog/items', '.backlog/epics']) {
      for (const sentence of sentenceContaining(readme, legacyPath)) {
        expect(sentence).not.toMatch(/canonical|stores backlog items|stores epics|writes target/i);
      }
    }

    expect(readme).toMatch(/private records (take precedence over|override) same-ID legacy records/);
    expect(readme).toMatch(/Writes from capture, update, upsert, and promotion helpers target private backlog storage only/);
    expect(readme).toMatch(/legacy item and epic files are not deleted or rewritten by default/);
    expect(readme).toContain('import-legacy-backlog');
    expect(readme).toMatch(/import-legacy-backlog[\s\S]*skips IDs (that are )?already present in private storage/);
    expect(readme).toMatch(/safe-id and path-containment checks apply/i);
    expect(readme).toContain('legacy `.backlog/recommendations.json` import/export');
  });

  it('documents analyze-all curation preview, apply confirmations, and non-goals', async () => {
    const readme = await readFile(README, 'utf-8');

    for (const required of [
      'analyze-all-backlog',
      'backlog-curation',
      'backlogCurationDraft',
      'applyBacklogCurationDraft',
      'previewAcknowledged',
      'confirmApply',
      'daemon-owned',
      'read-only',
      'preview',
      'retry',
      'redraft',
      'cancel',
      'remove',
      'apply',
    ]) {
      expect(readme).toContain(required);
    }

    expect(readme).toMatch(/analyze-all-backlog[\s\S]*(starts or reuses|start or reuse)[\s\S]*daemon-owned[\s\S]*read-only/);
    expect(readme).toMatch(/Completed (backlog )?curation tasks? render(s)? a (read-only )?preview before mutation/i);
    expect(readme).toMatch(/item changes[\s\S]*epic changes[\s\S]*no-op rechecks[\s\S]*skipped cases[\s\S]*needs-input cases[\s\S]*generated recommendations/);
    expect(readme).toMatch(/curation apply requires two in-app confirmation steps/i);
    expect(readme).toMatch(/applyBacklogCurationDraft\.previewAcknowledged[\s\S]*applyBacklogCurationDraft\.confirmApply[\s\S]*true/);
    expect(readme).toMatch(/Analyze-all and curation apply do not enqueue builds/);
    expect(readme).toMatch(/(do not|does not)[^.]*mark (records|items|backlog items) shipped without durable evidence/);
    expect(readme).toMatch(/Validation, reference, and curation precondition failures leave the existing `current\.json` and status sidecar unchanged/);
    expect(readme).toMatch(/post-apply\/post-curation backlog fingerprint/);
    expect(readme).toContain('apply-backlog-curation-draft');
  });

  it('keeps action table side effects aligned with planning boundaries', async () => {
    const readme = await readFile(README, 'utf-8');
    const rows = actionTableRows(readme);

    expect(rows.some((row) => row.startsWith('| `import-legacy-backlog` |'))).toBe(true);
    expect(rows.some((row) => row.startsWith('| `analyze-all-backlog` |'))).toBe(true);
    expect(rows.filter((row) => row.includes('build-queue'))).toEqual([
      expect.stringMatching(/^\| `handoff-session-plan` \|/),
    ]);
  });

  it('keeps backlog write action rows on visible private records rather than legacy paths', async () => {
    const readme = await readFile(README, 'utf-8');

    for (const actionId of ['capture-item', 'upsert-epic', 'update-item', 'promote-item', 'promote-selection']) {
      const row = actionRow(readme, actionId);
      expect(row).not.toContain('.backlog/items');
      expect(row).not.toContain('.backlog/epics');
      expect(row).toMatch(/visible|private/);
    }

    expect(actionRow(readme, 'capture-item')).toMatch(/private eforge-plan storage/);
    expect(actionRow(readme, 'upsert-epic')).toMatch(/private eforge-plan storage/);
    expect(actionRow(readme, 'update-item')).toMatch(/private storage/);
    expect(actionRow(readme, 'promote-item')).toMatch(/private backlog metadata updates/);
    expect(actionRow(readme, 'promote-selection')).toMatch(/selected visible item IDs[\s\S]*private backlog metadata updates/);
  });

  it('documents migrated promotion and input-source wording without canonical .backlog nodes', async () => {
    const readme = await readFile(README, 'utf-8');
    const promotion = sectionBetween(readme, '## Promotion flow', '## Input-source URI');
    const inputSource = sectionBetween(readme, '## Input-source URI', '## Console and host surfaces');

    expect(promotion).toContain('Visible backlog item');
    expect(promotion).toContain('Visible backlog epic');
    expect(promotion).not.toContain('.backlog/items');
    expect(promotion).not.toContain('.backlog/epics');
    expect(inputSource).toMatch(/visible eforge-plan backlog records/);
    expect(inputSource).not.toMatch(/resolve `.backlog`|canonical .*\.backlog/i);
  });

  it('documents curation task boundaries and unsupported automation explicitly', async () => {
    const readme = await readFile(README, 'utf-8');
    const boundary = sectionBetween(readme, '## Planning workstation boundary', '');

    expect(boundary).toMatch(/analyze-all-backlog` starts or reuses a daemon-owned read-only `backlog-curation` planning task/);
    expect(boundary).toMatch(/current source fingerprint/);
    expect(boundary).toMatch(/requests `backlogCurationDraft` plus `recommendations`/);
    expect(boundary).toMatch(/Plan with AI monitor labels curation tasks and supports retry, redraft, cancel, remove, and apply/);
    expect(boundary).toMatch(/task result is read-only until the user previews it/);
    expect(boundary).toMatch(/Completed curation task previews include item changes, epic changes, no-op rechecks, skipped cases, needs-input cases, and generated recommendations/);
    expect(boundary).toMatch(/does not enqueue a build, mark backlog items shipped without durable evidence, or submit session plans/);
    expect(boundary).toMatch(/scheduling, stale-triggered execution, unattended mutation/);
    expect(boundary).toMatch(/autonomous backlog draining|auto-mode backlog draining/);
    expect(boundary).toMatch(/queue orchestration/);
  });
});
