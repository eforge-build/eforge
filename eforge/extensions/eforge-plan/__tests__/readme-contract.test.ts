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
  it('documents direct compact agent backlog workflow actions', async () => {
    const readme = await readFile(README, 'utf-8');
    const workflow = sectionBetween(readme, '## Direct agent backlog workflow', '## Storage model');

    for (const actionId of ['search-items', 'get-item', 'get-epic', 'capture-item', 'update-item']) {
      expect(workflow).toContain(actionId);
    }
    for (const projectionFlag of ['includeEpics', 'includeDependencies', 'includeEpic', 'includeSections', 'includeLifecycleRows', 'includeDependents', 'includeItems', 'includeItemDependencies', 'includeLaneCounts']) {
      expect(workflow).toContain(projectionFlag);
    }
  });

  it('documents body-safe direct agent backlog updates', async () => {
    const readme = await readFile(README, 'utf-8');
    const workflow = sectionBetween(readme, '## Direct agent backlog workflow', '## Storage model');
    const updateRow = actionRow(readme, 'update-item');
    const storage = sectionBetween(readme, '## Storage model', '## Promotion flow');

    for (const required of ['get-item', 'bodySha256', 'expectedBodySha256', 'sections', 'sectionOperations', 'changedSections']) {
      expect(workflow).toContain(required);
    }
    expect(workflow).toMatch(/get-item[\s\S]*bodySha256[\s\S]*expectedBodySha256[\s\S]*update-item/);
    expect(workflow).toMatch(/expectedBodySha256[\s\S]*(primary lock token|lock token)/i);
    expect(workflow).toMatch(/stale (lock|token|hash|precondition|mismatch)[\s\S]*fresh `get-item`|fresh `get-item`[\s\S]*stale (lock|token|hash|precondition|mismatch)/i);
    expect(workflow).toMatch(/metadata-only updates?[\s\S]*(preserve|without changing)[\s\S]*body[\s\S]*(do not require|without)[\s\S]*lock/i);
    expect(workflow).toMatch(/(title|body|section)[\s\S]*(require|send)[\s\S]*expectedBodySha256/i);
    expect(workflow).toMatch(/Claim[\s\S]*Evidence[\s\S]*Acceptance Criteria[\s\S]*Recheck[\s\S]*Notes/);
    expect(workflow).toMatch(/priority[\s\S]*free-form[\s\S]*non-empty[\s\S]*single-line/i);
    expect(workflow).toMatch(/Claim[\s\S]*sections/i);
    expect(workflow).toMatch(/unknown section[\s\S]*sectionOperations|sectionOperations[\s\S]*unknown section/i);
    expect(workflow).toContain('{ "action": "append", "heading": "Rollout Notes"');
    expect(workflow).not.toContain('{ "op": "append", "heading": "Rollout Notes"');
    for (const field of ['itemId', 'title', 'status', 'updatedAt', 'bodySha256', 'recordSha256', 'path', 'storage', 'changedFields', 'changedSections']) {
      expect(workflow).toContain(field);
    }
    expect(workflow).toMatch(/direct Markdown edits?[\s\S]*(manual recovery|explicit manual recovery)/i);
    expect(workflow).toMatch(/\.backlog\/items\/<id>\.md[\s\S]*(legacy|import|mirror)|legacy[\s\S]*\.backlog\/items\/<id>\.md/i);
    expect(workflow).toMatch(/\.eforge\/storage\/extensions\/eforge-plan\/backlog\/items\/<id>\.md[\s\S]*(legacy|import|mirror|compatibility)/i);

    expect(updateRow).toMatch(/title/i);
    expect(updateRow).toMatch(/canonical sections/i);
    expect(updateRow).toMatch(/additional sections/i);
    expect(updateRow).toMatch(/metadata/i);
    expect(updateRow).toMatch(/private storage/);

    expect(storage).toMatch(/successful updates?[\s\S]*canonical SQLite/i);
    expect(storage).toMatch(/recompute[\s\S]*section rows/i);
    expect(storage).toMatch(/Markdown mirrors?/i);
    expect(storage).toMatch(/search documents? dirty/i);
    expect(storage).toMatch(/recommendation metadata stale|recommendations? stale/i);
  });


  it('documents private recommendations, promotion sources, planner boundaries, and non-goals', async () => {
    const readme = await readFile(README, 'utf-8');

    expect(readme).toContain('.eforge/storage/extensions/eforge-plan/recommendations/current.json');
    expect(readme).toContain('.eforge/storage/extensions/eforge-plan/recommendations/status.json');
    expect(readme).toMatch(/missing[\s\S]*No private current recommendation run exists/);
    expect(readme).toMatch(/fresh[\s\S]*status metadata matches/);
    expect(readme).toMatch(/stale[\s\S]*status metadata is missing\/invalid|stale[\s\S]*last-applied fingerprint differs/);
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
    expect(readme).toMatch(/Runtime writes.*canonical SQLite|through canonical SQLite writes/);
    expect(readme).toMatch(/legacy item and epic files are not deleted or rewritten by default/);
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

    expect(readme).not.toContain('scanMode');
    expect(readme).not.toContain('full-implementation-audit');
    expect(readme).toContain('`analyze-all-backlog` example input: `{}`');
    expect(readme).toMatch(/audits open backlog items against current source/);
    expect(readme).toMatch(/current source as the closure authority|current source is the closure authority/);
    expect(readme).toMatch(/git\/PR\/lifecycle\/session history as navigation hints|history is a navigation hint/);
    expect(readme).toMatch(/coverage, caps, diagnostics, concurrency settings, per-item outcomes, current-source citations, historical navigation hints/);
    expect(readme).toMatch(/analyze-all-backlog[\s\S]*(starts or reuses|start or reuse)[\s\S]*daemon-owned[\s\S]*read-only/);
    expect(readme).toMatch(/Completed (backlog )?curation tasks? render(s)? a (read-only )?preview before mutation/i);
    expect(readme).toMatch(/item changes[\s\S]*epic changes[\s\S]*no-op rechecks[\s\S]*unresolved exceptions[\s\S]*needs-input cases[\s\S]*generated recommendation details/);
    expect(readme).toMatch(/curation apply requires two in-app confirmation steps/i);
    expect(readme).toMatch(/applyBacklogCurationDraft\.previewAcknowledged[\s\S]*applyBacklogCurationDraft\.confirmApply[\s\S]*true/);
    expect(readme).toMatch(/Analyze-all and curation apply do not enqueue builds/);
    expect(readme).toMatch(/(do not|does not)[^.]*mark (records|items|backlog items) shipped or superseded without durable status-specific evidence/);
    expect(readme).toMatch(/Validation, reference, and curation precondition failures leave the existing recommendation run, freshness metadata, and accepted-analysis baseline unchanged/);
    expect(readme).toMatch(/post-apply\/post-curation backlog fingerprint/);
    expect(readme).toContain('apply-backlog-curation-draft');
    expect(readme).toContain('applyCurationOnly');
    expect(readme).toMatch(/invalid generated recommendation references/i);
    expect(readme).toMatch(/Invalid generated recommendations block normal curation apply/);
    expect(readme).toMatch(/apply curation only while discarding generated recommendations/);
    expect(readme).toMatch(/bounded git\/PR (shipped or superseded|history shipped) evidence/);
    expect(readme).toMatch(/optional PR enrichment (is fail-closed|through `gh` is fail-closed and not required)/i);
    expect(readme).toContain('Shipped evidence: lifecycle trace');
    expect(readme).toContain('Shipped evidence: inferred from git/PR history');
    expect(readme).toContain('Shipped evidence: lifecycle trace — ');
    expect(readme).toContain('Shipped evidence: inferred from git/PR history — ');
    expect(readme).toContain('Superseded evidence: lifecycle trace — ');
    expect(readme).toContain('Superseded evidence: inferred from git/PR history — ');
    expect(readme).toContain('Ambiguous shipped candidate: needs input — ');
    expect(readme).toContain('Ambiguous superseded candidate: needs input — ');
    expect(readme).toMatch(/Ambiguous closure evidence is not enough for a closed-status patch/);
    expect(readme).toMatch(/prospective recommendation projection metadata/);
  });

  it('documents accepted analysis baselines, git-delta diagnostics, overlay projection, and freshness semantics', async () => {
    const readme = await readFile(README, 'utf-8');

    expect(readme).toContain('.eforge/storage/extensions/eforge-plan/analysis-baseline/current.json');
    for (const field of ['acceptedAt', 'taskId', 'passKind', 'sourceFingerprint', 'git.headCommit', 'git.headCommittedAt', 'coverage', 'diagnostics']) {
      expect(readme).toContain(field);
    }
    expect(readme).toMatch(/not encoded into backlog item or epic bodies, recommendation model JSON, or legacy `\.backlog\/recommendations\.json`/);
    expect(readme).toMatch(/put-recommendations.*do not create an accepted-analysis git baseline/s);

    for (const field of [
      'gitDelta.baseline.commit',
      'gitDelta.baseline.time',
      'gitDelta.baseline.source',
      'gitDelta.currentHead',
      'gitDelta.scannedCommitCount',
      'scanned commits',
      'scan caps',
      'affected item candidates',
    ]) {
      expect(readme).toContain(field);
    }
    for (const code of [
      'baseline-missing',
      'baseline-invalid-sidecar',
      'baseline-unreachable',
      'baseline-shallow',
      'git-unavailable',
      'git-command-failed',
      'scan-cap-truncated',
      'pr-enrichment-unavailable',
    ]) {
      expect(readme).toContain(code);
    }
    expect(readme).toMatch(/missing, invalid, unreachable, shallow, (and|or) no-git baseline states.*(fallback or unavailable coverage|produce fallback or unavailable coverage labels)/s);
    expect(readme).toMatch(/optional PR enrichment through `gh`.*not required/is);
    expect(readme).toMatch(/Deterministic git-delta matching considers item ids, titles, slugs, changed paths, branch hints, PR numbers\/titles\/bodies\/files, merge subjects, and bounded excerpts/);

    expect(readme).toMatch(/Preview and apply use the same prospective `recommendationProjection`/);
    expect(readme).toContain('recommendationProjection.effectiveRecommendations');
    expect(readme).toMatch(/removed\/repositioned targets/);
    expect(readme).toContain('wrong-lane');
    expect(readme).toMatch(/raw task result preservation|Raw generated task output remains preserved/i);
    expect(readme).not.toMatch(/same-draft recommendation filtering/i);
    expect(readme).not.toMatch(/Proposed-shipped item ids from the same draft are removed/i);
    expect(readme).toMatch(/Normal curation apply writes only `recommendationProjection\.effectiveRecommendations`/);
    expect(readme).toMatch(/Curation-only apply.*records the accepted backlog-curation baseline.*leaves discarded generated recommendations unfresh/s);
    expect(readme).toMatch(/comparing stored recommendation\/source fingerprint data.*current or prospective source fingerprint/s);
  });

  it('documents active-versus-historical lifecycle evidence semantics', async () => {
    const readme = await readFile(README, 'utf-8');

    expect(readme).toMatch(/Evidence rows are durable audit evidence, not authoritative activity state/);
    expect(readme).toMatch(/submitted session-plan evidence alone does not mark items active or planned/);
    expect(readme).toMatch(/current editable session plan, live queue\/run\/build evidence, current PR-open\/landing evidence, or explicit `active` backlog status/);
    expect(readme).toMatch(/historical rows in `linkRows`/);
  });

  it('documents explicit retention maintenance actions and compaction safeguards', async () => {
    const readme = await readFile(README, 'utf-8');
    const storage = sectionBetween(readme, '## Storage model', '## Promotion flow');

    for (const required of [
      'get-store-status',
      'compact-planning-store',
      'rebuild-search-index',
      'optimize-search-index',
      'vacuum-planning-store',
      'dry run',
      'protected canonical rows',
      '.eforge/storage/extensions/eforge-plan/archives/maintenance/<runId>/',
      'raw lifecycle event payloads',
      'terminal planning-task raw request/result payloads',
      'superseded recommendation runs',
      'FTS',
      'VACUUM',
    ]) {
      expect(storage).toContain(required);
    }
    expect(storage).toMatch(/Backlog items, epics, dependencies, session plans, session-plan joins.*current lifecycle evidence.*current recommendation runs.*recommendation actionability/s);
    expect(storage).toMatch(/lifecycle_evidence\.retained_summary_json|retained_summary_json/);
    for (const actionId of ['get-store-status', 'compact-planning-store', 'rebuild-search-index', 'optimize-search-index', 'vacuum-planning-store']) {
      expect(actionRow(readme, actionId)).toBeDefined();
    }
  });

  it('keeps action table side effects aligned with planning boundaries', async () => {
    const readme = await readFile(README, 'utf-8');
    const rows = actionTableRows(readme);

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
      expect(row).toMatch(/visible|private|canonical SQLite/);
    }

    expect(actionRow(readme, 'capture-item')).toMatch(/private eforge-plan storage/);
    expect(actionRow(readme, 'upsert-epic')).toMatch(/private eforge-plan storage/);
    expect(actionRow(readme, 'update-item')).toMatch(/private storage/);
    expect(actionRow(readme, 'promote-item')).toMatch(/canonical SQLite writes/);
    expect(actionRow(readme, 'promote-selection')).toMatch(/selected visible item IDs[\s\S]*canonical SQLite writes/);
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

    expect(boundary).toMatch(/analyze-all-backlog` starts or reuses an active daemon-owned read-only source-first `backlog-curation` planning task/);
    expect(boundary).toMatch(/defers all-open-backlog curation source assembly to that background task/);
    expect(boundary).toMatch(/`backlogCurationDraft` plus `recommendations`/);
    expect(boundary).toMatch(/Planning activity monitor labels curation tasks and supports retry, redraft, cancel, remove, and apply/);
    // --- eforge:region plan-04-workstation-session-plan-auto-apply ---
    expect(boundary).toMatch(/auto-applies only completed available unapplied ready single-output `sessionPlanCreationDraft` creation tasks/);
    expect(boundary).toMatch(/opens the created plan in Plans focus/);
    expect(boundary).toMatch(/Readiness checks, sign-off, and handoff remain separate explicit Plan actions/);
    // --- eforge:endregion plan-04-workstation-session-plan-auto-apply ---
    expect(boundary).toMatch(/task result is otherwise read-only until the user previews it/i);
    expect(boundary).toMatch(/Completed curation task previews include item changes, epic changes, no-op rechecks, unresolved exceptions, needs-input cases, generated recommendation details/);
    expect(boundary).toMatch(/preview-time invalid generated recommendation references/);
    expect(boundary).toMatch(/Invalid generated recommendations block normal curation apply/);
    expect(boundary).toMatch(/apply curation only while discarding generated recommendations with `applyCurationOnly`/);
    expect(boundary).toMatch(/does not enqueue a build, mark backlog items shipped or superseded without durable status-specific evidence, or submit session plans/);
    expect(boundary).toMatch(/scheduling, stale-triggered execution, unattended mutation/);
    expect(boundary).toMatch(/autonomous backlog draining|auto-mode backlog draining/);
    expect(boundary).toMatch(/queue orchestration/);
  });

  // --- eforge:region plan-04-workstation-session-plan-auto-apply ---
  it('documents automatic session-plan creation and visible non-success states', async () => {
    const readme = await readFile(README, 'utf-8');

    expect(readme).toContain('The workstation automatically sends exactly `{ "taskId": "task_123", "applySessionPlanCreationDraft": {} }` once');
    expect(readme).toMatch(/failed, cancelled, unavailable, needs-input, recommendation refresh, backlog curation, handoff, recommendation, patch, revision, and ambiguous multi-output tasks remain visible/);
    expect(readme).toMatch(/Automatic creation failures, including collision errors/);
    expect(readme).toContain('opens `focus=plans` with the created `plan` selected');
    expect(readme).toContain('readiness/sign-off continues in Plans focus');
  });
  // --- eforge:endregion plan-04-workstation-session-plan-auto-apply ---
});
