/**
 * Tests for the acceptance criteria quality analyzer in @eforge-build/input.
 *
 * Covers:
 *  - analyzeAcceptanceCriteriaItem: per-item diagnostics
 *  - analyzeAcceptanceCriteria: section-level analysis
 *  - analyzeAcceptanceCriteriaInBody: full-body extraction + analysis
 *  - Verification that engine enqueue emits enqueue:failed without queue writes
 *    when formatted PRD contains invalid AC content
 */
import { describe, it, expect } from 'vitest';
import { mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  analyzeAcceptanceCriteriaItem,
  analyzeAcceptanceCriteria,
  analyzeAcceptanceCriteriaInBody,
} from '@eforge-build/input';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import { StubHarness } from './stub-harness.js';
import { useTempDir } from './test-tmpdir.js';

// ---------------------------------------------------------------------------
// analyzeAcceptanceCriteriaItem
// ---------------------------------------------------------------------------

describe('analyzeAcceptanceCriteriaItem — grouping labels', () => {
  it('reports grouping-label for a bullet ending with ":"', () => {
    const d = analyzeAcceptanceCriteriaItem('- Tests cover:');
    expect(d).not.toBeNull();
    expect(d!.kind).toBe('grouping-label');
    expect(d!.line).toBe('- Tests cover:');
  });

  it('reports grouping-label for "Targeted validation passes:"', () => {
    const d = analyzeAcceptanceCriteriaItem('- Targeted validation passes:');
    expect(d).not.toBeNull();
    expect(d!.kind).toBe('grouping-label');
  });

  it('reports grouping-label for a checkbox item ending with ":"', () => {
    const d = analyzeAcceptanceCriteriaItem('- [ ] Tests cover:');
    expect(d).not.toBeNull();
    expect(d!.kind).toBe('grouping-label');
  });

  it('does NOT report grouping-label for a criterion that contains ":" mid-sentence', () => {
    const d = analyzeAcceptanceCriteriaItem('- Route returns status: 200 when successful.');
    // Could be null or a different diagnostic but not grouping-label
    if (d !== null) {
      expect(d.kind).not.toBe('grouping-label');
    }
  });
});

describe('analyzeAcceptanceCriteriaItem — bare command fragments', () => {
  it('reports bare-command for a bullet that is only a code span with trailing period', () => {
    const d = analyzeAcceptanceCriteriaItem('- `pnpm type-check`.');
    expect(d).not.toBeNull();
    expect(d!.kind).toBe('bare-command');
  });

  it('reports bare-command for a bullet with only a code span and no trailing period', () => {
    const d = analyzeAcceptanceCriteriaItem('- `pnpm build`');
    expect(d).not.toBeNull();
    expect(d!.kind).toBe('bare-command');
  });

  it('does NOT report bare-command when a meaningful outcome follows the code span', () => {
    const d = analyzeAcceptanceCriteriaItem('- `pnpm type-check` exits 0.');
    expect(d).toBeNull();
  });

  it('does NOT report bare-command when outcome text follows code span', () => {
    const d = analyzeAcceptanceCriteriaItem('- `pnpm build` completes without errors.');
    expect(d).toBeNull();
  });
});

describe('analyzeAcceptanceCriteriaItem — vague criteria', () => {
  it('reports vague for "Works correctly."', () => {
    const d = analyzeAcceptanceCriteriaItem('- Works correctly.');
    expect(d).not.toBeNull();
    expect(d!.kind).toBe('vague');
  });

  it('reports vague for "Improves reliability."', () => {
    const d = analyzeAcceptanceCriteriaItem('- Improves reliability.');
    expect(d).not.toBeNull();
    expect(d!.kind).toBe('vague');
  });

  it('does NOT report vague for a concrete criterion with a code span', () => {
    const d = analyzeAcceptanceCriteriaItem('- `pnpm type-check` exits 0.');
    expect(d).toBeNull();
  });

  it('does NOT report vague for a concrete event criterion', () => {
    const d = analyzeAcceptanceCriteriaItem('- Engine emits an `enqueue:failed` event when AC quality gate fails.');
    expect(d).toBeNull();
  });

  it('does NOT report vague for a test-outcome criterion', () => {
    // "Type checking passes" - not starting with a vague verb
    const d = analyzeAcceptanceCriteriaItem('- Type checking passes.');
    expect(d).toBeNull();
  });

  it('does NOT report vague for a criterion with a digit', () => {
    const d = analyzeAcceptanceCriteriaItem('- Returns HTTP 200 on success.');
    expect(d).toBeNull();
  });
});

describe('analyzeAcceptanceCriteriaItem — valid criteria return null', () => {
  it('accepts a concrete command criterion', () => {
    expect(analyzeAcceptanceCriteriaItem('- `pnpm type-check` exits 0.')).toBeNull();
  });

  it('accepts an event-emission criterion', () => {
    expect(analyzeAcceptanceCriteriaItem('- Engine emits `enqueue:complete` after writing to queue.')).toBeNull();
  });

  it('accepts a file-system criterion', () => {
    expect(analyzeAcceptanceCriteriaItem('- Queue directory contains one new markdown file after enqueue.')).toBeNull();
  });

  it('accepts an observable UI criterion', () => {
    expect(analyzeAcceptanceCriteriaItem('- Monitor UI shows the session plan status as "ready".')).toBeNull();
  });

  it('accepts an API response criterion', () => {
    expect(analyzeAcceptanceCriteriaItem('- Readiness route responds with `ready: false` and `acDiagnostics`.')).toBeNull();
  });

  it('returns null for an empty or whitespace-only string', () => {
    expect(analyzeAcceptanceCriteriaItem('')).toBeNull();
    expect(analyzeAcceptanceCriteriaItem('   ')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// analyzeAcceptanceCriteria — section-level
// ---------------------------------------------------------------------------

describe('analyzeAcceptanceCriteria', () => {
  it('returns valid: true for all-valid criteria', () => {
    const content = [
      '- `pnpm type-check` exits 0.',
      '- Engine emits `enqueue:complete` on success.',
      '- Queue directory contains one markdown file.',
    ].join('\n');
    const result = analyzeAcceptanceCriteria(content);
    expect(result.valid).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('returns valid: false with diagnostics for a grouping label', () => {
    const content = [
      '- Tests cover:',
      '  - Some nested item',
    ].join('\n');
    const result = analyzeAcceptanceCriteria(content);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.kind === 'grouping-label')).toBe(true);
  });

  it('returns valid: false with diagnostics for a bare command', () => {
    const content = '- `pnpm type-check`.';
    const result = analyzeAcceptanceCriteria(content);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.kind === 'bare-command')).toBe(true);
  });

  it('returns valid: false with diagnostics for vague criteria', () => {
    const content = '- Works correctly.';
    const result = analyzeAcceptanceCriteria(content);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.kind === 'vague')).toBe(true);
  });

  it('skips non-list prose lines', () => {
    const content = [
      'The implementation is accepted when:',
      '',
      '- `pnpm type-check` exits 0.',
    ].join('\n');
    const result = analyzeAcceptanceCriteria(content);
    expect(result.valid).toBe(true);
  });

  it('collects multiple diagnostics from multiple invalid lines', () => {
    const content = [
      '- Tests cover:',
      '- `pnpm type-check`.',
      '- Works correctly.',
    ].join('\n');
    const result = analyzeAcceptanceCriteria(content);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// analyzeAcceptanceCriteriaInBody
// ---------------------------------------------------------------------------

describe('analyzeAcceptanceCriteriaInBody', () => {
  it('returns null when no AC section is found', () => {
    const body = '## Scope\n\n- Add login page.\n';
    expect(analyzeAcceptanceCriteriaInBody(body)).toBeNull();
  });

  it('returns valid result for a body with valid AC section', () => {
    const body = [
      '## Acceptance Criteria',
      '',
      '- `pnpm type-check` exits 0.',
      '- Engine emits `enqueue:complete` on success.',
    ].join('\n');
    const result = analyzeAcceptanceCriteriaInBody(body);
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(true);
  });

  it('returns invalid result for a body with grouping-label AC', () => {
    const body = [
      '## Acceptance Criteria',
      '',
      '- Tests cover:',
      '  - Engine path',
    ].join('\n');
    const result = analyzeAcceptanceCriteriaInBody(body);
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
    expect(result!.diagnostics[0].kind).toBe('grouping-label');
  });

  it('returns invalid result for a body with bare-command AC', () => {
    const body = [
      '## Acceptance Criteria',
      '',
      '- `pnpm type-check`.',
    ].join('\n');
    const result = analyzeAcceptanceCriteriaInBody(body);
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
    expect(result!.diagnostics[0].kind).toBe('bare-command');
  });

  it('stops reading the AC section at the next heading of equal depth', () => {
    const body = [
      '## Acceptance Criteria',
      '',
      '- Tests cover:',
      '',
      '## Out of Scope',
      '',
      '- Something else',
    ].join('\n');
    const result = analyzeAcceptanceCriteriaInBody(body);
    expect(result).not.toBeNull();
    // Only the grouping label inside AC section should be flagged
    expect(result!.diagnostics).toHaveLength(1);
    expect(result!.diagnostics[0].kind).toBe('grouping-label');
  });
});

// ---------------------------------------------------------------------------
// Engine enqueue — AC quality gate integration
// ---------------------------------------------------------------------------

const makeTempDir = useTempDir('eforge-ac-quality-enqueue-');

async function setupProject(tmpDir: string): Promise<void> {
  const gitOpts = { cwd: tmpDir };
  execFileSync('git', ['init', '-b', 'main'], gitOpts);
  execFileSync('git', ['config', 'user.email', 'test@example.com'], gitOpts);
  execFileSync('git', ['config', 'user.name', 'Test'], gitOpts);
  execFileSync('git', ['commit', '--allow-empty', '-m', 'chore: initial commit'], gitOpts);
  await mkdir(resolve(tmpDir, 'eforge'), { recursive: true });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(resolve(tmpDir, 'eforge', 'config.yaml'), '', 'utf-8');
}

/** Build a minimal formatted PRD body with the given AC lines. */
function makePrdBody(acLines: string[]): string {
  return [
    '# Test Feature',
    '',
    '## Problem / Motivation',
    '',
    'We need this feature.',
    '',
    '## Goal',
    '',
    'Add the feature.',
    '',
    '## Approach',
    '',
    'Implement it.',
    '',
    '## Scope',
    '',
    '- In scope: the feature.',
    '',
    '## Acceptance Criteria',
    '',
    ...acLines,
  ].join('\n');
}

describe('EforgeEngine.enqueue — AC quality gate', () => {
  /** Engine options that disable heavy plugin/MCP loading for unit tests. */
  async function makeEngine(tmpDir: string, formattedBody: string): Promise<EforgeEngine> {
    const formatter = new StubHarness([{ text: formattedBody }]);
    return EforgeEngine.create({
      cwd: tmpDir,
      agentRuntimes: formatter,
      config: {
        plugins: { enabled: false },
      },
    });
  }

  it('emits enqueue:failed for PRD with grouping-label AC ("Tests cover:")', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const formattedBody = makePrdBody(['- Tests cover:']);
    const engine = await makeEngine(tmpDir, formattedBody);

    const events: string[] = [];
    for await (const e of engine.enqueue('test input')) {
      events.push(e.type);
    }

    expect(events).toContain('enqueue:failed');
    expect(events).not.toContain('enqueue:complete');

    // Queue directory should have zero queued markdown files
    const queueDir = resolve(tmpDir, '.eforge', 'queue');
    let queueFiles: string[] = [];
    try {
      queueFiles = (await readdir(queueDir)).filter((f) => f.endsWith('.md'));
    } catch {
      queueFiles = [];
    }
    expect(queueFiles).toHaveLength(0);
  });

  it('emits enqueue:failed for PRD with bare-command AC ("`pnpm type-check`.")', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const formattedBody = makePrdBody(['- `pnpm type-check`.']);
    const engine = await makeEngine(tmpDir, formattedBody);

    const events: string[] = [];
    for await (const e of engine.enqueue('test input')) {
      events.push(e.type);
    }

    expect(events).toContain('enqueue:failed');
    expect(events).not.toContain('enqueue:complete');

    const queueDir = resolve(tmpDir, '.eforge', 'queue');
    let queueFiles: string[] = [];
    try {
      queueFiles = (await readdir(queueDir)).filter((f) => f.endsWith('.md'));
    } catch {
      queueFiles = [];
    }
    expect(queueFiles).toHaveLength(0);
  });

  it('reaches enqueue:complete for PRD with valid AC ("`pnpm type-check` exits 0.")', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const formattedBody = makePrdBody(['- `pnpm type-check` exits 0.']);
    const engine = await makeEngine(tmpDir, formattedBody);

    const events: string[] = [];
    for await (const e of engine.enqueue('test input')) {
      events.push(e.type);
    }

    expect(events).toContain('enqueue:complete');
    expect(events).not.toContain('enqueue:failed');
  });
});
