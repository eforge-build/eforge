/**
 * Unit tests for `preprocessBuildSource` and `parseInputSourceReference` from
 * `@eforge-build/input`.
 *
 * Covers:
 * - Explicit eforge://input/<adapter>/<id> reference parsing
 * - Adapter fetch: success (string), success (object), not-found, error, timeout, invalid-result
 * - Unknown adapter (fatal)
 * - File source: session-plan normalization
 * - Inline source passthrough
 * - Enricher ordering: second enricher receives content from first
 * - Enricher no-op (null/undefined result)
 * - Enricher fail-open (throw, invalid result) — subsequent enrichers still run
 * - Enricher timeout (fail-open)
 * - Event ordering: input-source events, then enricher events
 * - No engine-import boundary: packages/engine/src and packages/engine/package.json
 *   must not reference @eforge-build/input
 */

import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { useTempDir } from './test-tmpdir.js';
import {
  preprocessBuildSource,
  parseInputSourceReference,
  FatalPreprocessingError,
  type InputSourceRegistrationLike,
  type PrdEnricherRegistrationLike,
} from '@eforge-build/input';

const makeTempDir = useTempDir('eforge-input-normalize-');
const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a stub input source registration with the given name and fetch result. */
function makeInputSource(
  name: string,
  fetchImpl: (sourceId: string) => Promise<unknown>,
): InputSourceRegistrationLike {
  return {
    extensionName: `ext-${name}`,
    extensionPath: `/path/to/ext-${name}`,
    name,
    value: {
      name,
      description: `${name} adapter`,
      fetch: fetchImpl as unknown as (...args: never[]) => unknown,
    },
  };
}

/** Create a stub PRD enricher registration with the given name and enrich result. */
function makeEnricher(
  name: string,
  enrichImpl: (content: string) => Promise<unknown>,
): PrdEnricherRegistrationLike {
  return {
    extensionName: `ext-enricher-${name}`,
    extensionPath: `/path/to/ext-enricher-${name}`,
    name,
    value: {
      name,
      description: `${name} enricher`,
      enrich: enrichImpl as unknown as (...args: never[]) => unknown,
    },
  };
}

/** Write a valid session plan markdown file to the given directory. */
async function writeSessionPlan(dir: string, session: string, content?: string): Promise<string> {
  const sessionPlansDir = resolve(dir, '.eforge', 'session-plans');
  await mkdir(sessionPlansDir, { recursive: true });
  const raw = content ?? [
    '---',
    `session: ${session}`,
    'topic: "Test Plan"',
    'status: ready',
    'planning_type: feature',
    'planning_depth: focused',
    'required_dimensions: []',
    'optional_dimensions: []',
    'skipped_dimensions: []',
    'open_questions: []',
    'profile: null',
    '---',
    '',
    '# Test Plan',
    '',
    '## Acceptance Criteria',
    '',
    'Done when it works.',
    '',
  ].join('\n');
  const filePath = resolve(sessionPlansDir, `${session}.md`);
  await writeFile(filePath, raw, 'utf-8');
  return filePath;
}

// ---------------------------------------------------------------------------
// parseInputSourceReference
// ---------------------------------------------------------------------------

describe('parseInputSourceReference', () => {
  it('returns null for file paths', () => {
    expect(parseInputSourceReference('/path/to/file.md')).toBeNull();
    expect(parseInputSourceReference('.eforge/session-plans/plan.md')).toBeNull();
    expect(parseInputSourceReference('relative/path.md')).toBeNull();
  });

  it('returns null for inline content', () => {
    expect(parseInputSourceReference('# My PRD\n\nSome content')).toBeNull();
    expect(parseInputSourceReference('')).toBeNull();
  });

  it('parses a simple reference', () => {
    const result = parseInputSourceReference('eforge://input/static/ISSUE-1');
    expect(result).toEqual({ adapter: 'static', sourceId: 'ISSUE-1' });
  });

  it('decodes percent-encoded characters in source id', () => {
    const result = parseInputSourceReference('eforge://input/github/owner%2Frepo%23123');
    expect(result).toEqual({ adapter: 'github', sourceId: 'owner/repo#123' });
  });

  it('handles source ids with slashes (not encoded)', () => {
    const result = parseInputSourceReference('eforge://input/jira/PROJ/123');
    expect(result).toEqual({ adapter: 'jira', sourceId: 'PROJ/123' });
  });

  it('throws for missing source id (only adapter)', () => {
    expect(() => parseInputSourceReference('eforge://input/github')).toThrow();
  });

  it('throws for missing source id (trailing slash)', () => {
    expect(() => parseInputSourceReference('eforge://input/github/')).toThrow();
  });

  it('throws for missing adapter and source id', () => {
    expect(() => parseInputSourceReference('eforge://input/')).toThrow();
  });

  it('throws for missing everything after prefix', () => {
    expect(() => parseInputSourceReference('eforge://input/')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// preprocessBuildSource — explicit input source references
// ---------------------------------------------------------------------------

describe('preprocessBuildSource — explicit eforge://input/ references', () => {
  it('resolves eforge://input/static/ISSUE-1 through the static adapter (string result)', async () => {
    const tmpDir = makeTempDir();
    const adapter = makeInputSource('static', async (id) => `fetched: ${id}`);

    const result = await preprocessBuildSource({
      source: 'eforge://input/static/ISSUE-1',
      inputSources: [adapter],
      prdEnrichers: [],
      cwd: tmpDir,
      timeoutMs: 5000,
    });

    expect(result.content).toBe('fetched: ISSUE-1');
    expect(result.sourcePath).toBeUndefined();
    expect(result.provenance.adapterName).toBe('static');
    expect(result.provenance.sourceId).toBe('ISSUE-1');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe('extension:input-source:fetched');
    if (result.events[0].type === 'extension:input-source:fetched') {
      expect(result.events[0].adapterName).toBe('static');
      expect(result.events[0].sourceId).toBe('ISSUE-1');
      expect(result.events[0].contentLength).toBe('fetched: ISSUE-1'.length);
      expect(result.events[0].extensionName).toBe('ext-static');
    }
  });

  it('resolves object result with content field', async () => {
    const tmpDir = makeTempDir();
    const adapter = makeInputSource('github', async () => ({ content: '# Issue content', number: 42 }));

    const result = await preprocessBuildSource({
      source: 'eforge://input/github/repo%23123',
      inputSources: [adapter],
      prdEnrichers: [],
      cwd: tmpDir,
      timeoutMs: 5000,
    });

    expect(result.content).toBe('# Issue content');
    expect(result.events[0].type).toBe('extension:input-source:fetched');
  });

  it('throws FatalPreprocessingError for unknown adapter', async () => {
    const tmpDir = makeTempDir();

    await expect(
      preprocessBuildSource({
        source: 'eforge://input/missing/ISSUE-1',
        inputSources: [],
        prdEnrichers: [],
        cwd: tmpDir,
        timeoutMs: 5000,
      }),
    ).rejects.toBeInstanceOf(FatalPreprocessingError);
  });

  it('FatalPreprocessingError for unknown adapter has extension:input-source:failed diagnostic with error reason', async () => {
    const tmpDir = makeTempDir();

    let caughtErr: FatalPreprocessingError | undefined;
    try {
      await preprocessBuildSource({
        source: 'eforge://input/missing/ISSUE-1',
        inputSources: [],
        prdEnrichers: [],
        cwd: tmpDir,
        timeoutMs: 5000,
      });
    } catch (err) {
      if (err instanceof FatalPreprocessingError) caughtErr = err;
    }

    expect(caughtErr).toBeDefined();
    expect(caughtErr!.diagnosticEvent.type).toBe('extension:input-source:failed');
    expect(caughtErr!.diagnosticEvent.adapterName).toBe('missing');
    expect(caughtErr!.diagnosticEvent.sourceId).toBe('ISSUE-1');
    expect(caughtErr!.diagnosticEvent.reason).toBe('error');
  });

  it('throws FatalPreprocessingError with not-found reason when adapter returns null', async () => {
    const tmpDir = makeTempDir();
    const adapter = makeInputSource('static', async () => null);

    let caughtErr: FatalPreprocessingError | undefined;
    try {
      await preprocessBuildSource({
        source: 'eforge://input/static/MISSING',
        inputSources: [adapter],
        prdEnrichers: [],
        cwd: tmpDir,
        timeoutMs: 5000,
      });
    } catch (err) {
      if (err instanceof FatalPreprocessingError) caughtErr = err;
    }

    expect(caughtErr).toBeDefined();
    expect(caughtErr!.diagnosticEvent.reason).toBe('not-found');
    expect(caughtErr!.diagnosticEvent.sourceId).toBe('MISSING');
  });

  it('throws FatalPreprocessingError with not-found reason when adapter returns undefined', async () => {
    const tmpDir = makeTempDir();
    const adapter = makeInputSource('static', async () => undefined);

    let caughtErr: FatalPreprocessingError | undefined;
    try {
      await preprocessBuildSource({
        source: 'eforge://input/static/MISSING',
        inputSources: [adapter],
        prdEnrichers: [],
        cwd: tmpDir,
        timeoutMs: 5000,
      });
    } catch (err) {
      if (err instanceof FatalPreprocessingError) caughtErr = err;
    }

    expect(caughtErr!.diagnosticEvent.reason).toBe('not-found');
  });

  it('throws FatalPreprocessingError with invalid-result reason when adapter returns non-string/non-object', async () => {
    const tmpDir = makeTempDir();
    const adapter = makeInputSource('static', async () => 42);

    let caughtErr: FatalPreprocessingError | undefined;
    try {
      await preprocessBuildSource({
        source: 'eforge://input/static/ISSUE-1',
        inputSources: [adapter],
        prdEnrichers: [],
        cwd: tmpDir,
        timeoutMs: 5000,
      });
    } catch (err) {
      if (err instanceof FatalPreprocessingError) caughtErr = err;
    }

    expect(caughtErr!.diagnosticEvent.reason).toBe('invalid-result');
  });

  it('throws FatalPreprocessingError with error reason when adapter throws', async () => {
    const tmpDir = makeTempDir();
    const adapter = makeInputSource('static', async () => {
      throw new Error('network failure');
    });

    let caughtErr: FatalPreprocessingError | undefined;
    try {
      await preprocessBuildSource({
        source: 'eforge://input/static/ISSUE-1',
        inputSources: [adapter],
        prdEnrichers: [],
        cwd: tmpDir,
        timeoutMs: 5000,
      });
    } catch (err) {
      if (err instanceof FatalPreprocessingError) caughtErr = err;
    }

    expect(caughtErr!.diagnosticEvent.reason).toBe('error');
    expect(caughtErr!.diagnosticEvent.message).toBe('network failure');
  });

  it('throws FatalPreprocessingError with timeout reason when adapter exceeds timeoutMs', async () => {
    const tmpDir = makeTempDir();
    const adapter = makeInputSource('static', () => new Promise<string>(() => {
      // never resolves
    }));

    let caughtErr: FatalPreprocessingError | undefined;
    try {
      await preprocessBuildSource({
        source: 'eforge://input/static/ISSUE-1',
        inputSources: [adapter],
        prdEnrichers: [],
        cwd: tmpDir,
        timeoutMs: 50, // very short timeout
      });
    } catch (err) {
      if (err instanceof FatalPreprocessingError) caughtErr = err;
    }

    expect(caughtErr!.diagnosticEvent.reason).toBe('timeout');
    expect(caughtErr!.diagnosticEvent.timeoutMs).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// preprocessBuildSource — file and inline sources
// ---------------------------------------------------------------------------

describe('preprocessBuildSource — file and inline sources', () => {
  it('passes inline content through unchanged (no file, no enrichers)', async () => {
    const tmpDir = makeTempDir();
    const inlineContent = '# My PRD\n\nDo the thing.';

    const result = await preprocessBuildSource({
      source: inlineContent,
      inputSources: [],
      prdEnrichers: [],
      cwd: tmpDir,
      timeoutMs: 5000,
    });

    expect(result.content).toBe(inlineContent);
    expect(result.sourcePath).toBeUndefined();
    expect(result.events).toHaveLength(0);
  });

  it('normalizes a session-plan file via normalizeBuildSource before enrichers run', async () => {
    const tmpDir = makeTempDir();
    await writeSessionPlan(tmpDir, '2026-01-01-test-plan');

    // The enricher receives the normalized build source, not raw session-plan markdown
    let receivedContent = '';
    const enricher = makeEnricher('spy', async (content) => {
      receivedContent = content;
      return null; // no-op
    });

    const sourcePath = `.eforge/session-plans/2026-01-01-test-plan.md`;
    const result = await preprocessBuildSource({
      source: sourcePath,
      inputSources: [],
      prdEnrichers: [enricher],
      cwd: tmpDir,
      timeoutMs: 5000,
    });

    // Normalized content should be a PRD-style markdown (no YAML frontmatter)
    expect(result.content).not.toContain('---');
    expect(result.content).toContain('# Test Plan');
    expect(result.sourcePath).toBeTruthy();
    expect(result.sourcePath).toContain('2026-01-01-test-plan.md');

    // Enricher received the normalized content (no frontmatter)
    expect(receivedContent).not.toContain('session:');
    expect(receivedContent).toContain('# Test Plan');
  });

  it('reads a regular PRD file unchanged (no session-plan normalization)', async () => {
    const tmpDir = makeTempDir();
    const prdContent = '# My PRD\n\n## Scope\n\nDo the thing.\n';
    const prdPath = resolve(tmpDir, 'my-prd.md');
    await writeFile(prdPath, prdContent, 'utf-8');

    const result = await preprocessBuildSource({
      source: 'my-prd.md',
      inputSources: [],
      prdEnrichers: [],
      cwd: tmpDir,
      timeoutMs: 5000,
    });

    expect(result.content).toBe(prdContent);
    expect(result.sourcePath).toBe(prdPath);
  });
});

// ---------------------------------------------------------------------------
// preprocessBuildSource — enricher sequencing
// ---------------------------------------------------------------------------

describe('preprocessBuildSource — enricher sequencing', () => {
  it('applies enrichers in registration order', async () => {
    const tmpDir = makeTempDir();
    const order: string[] = [];

    const enricher1 = makeEnricher('first', async (content) => {
      order.push('first');
      return content + '\n## Added by first';
    });
    const enricher2 = makeEnricher('second', async (content) => {
      order.push('second');
      return content + '\n## Added by second';
    });

    const result = await preprocessBuildSource({
      source: '# PRD',
      inputSources: [],
      prdEnrichers: [enricher1, enricher2],
      cwd: tmpDir,
      timeoutMs: 5000,
    });

    expect(order).toEqual(['first', 'second']);
    expect(result.content).toContain('Added by first');
    expect(result.content).toContain('Added by second');
  });

  it('second enricher receives content returned by first', async () => {
    const tmpDir = makeTempDir();
    let secondReceivedContent = '';

    const enricher1 = makeEnricher('first', async () => '# Content from first');
    const enricher2 = makeEnricher('second', async (content) => {
      secondReceivedContent = content;
      return null;
    });

    await preprocessBuildSource({
      source: '# Original',
      inputSources: [],
      prdEnrichers: [enricher1, enricher2],
      cwd: tmpDir,
      timeoutMs: 5000,
    });

    expect(secondReceivedContent).toBe('# Content from first');
  });

  it('null enricher result emits applied event with changed=false', async () => {
    const tmpDir = makeTempDir();
    const enricher = makeEnricher('noop', async () => null);

    const result = await preprocessBuildSource({
      source: '# PRD',
      inputSources: [],
      prdEnrichers: [enricher],
      cwd: tmpDir,
      timeoutMs: 5000,
    });

    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    expect(event.type).toBe('extension:prd-enricher:applied');
    if (event.type === 'extension:prd-enricher:applied') {
      expect(event.changed).toBe(false);
    }
    expect(result.provenance.enrichersApplied).toEqual([]);
  });

  it('undefined enricher result emits applied event with changed=false', async () => {
    const tmpDir = makeTempDir();
    const enricher = makeEnricher('noop', async () => undefined);

    const result = await preprocessBuildSource({
      source: '# PRD',
      inputSources: [],
      prdEnrichers: [enricher],
      cwd: tmpDir,
      timeoutMs: 5000,
    });

    const event = result.events[0];
    expect(event.type).toBe('extension:prd-enricher:applied');
    if (event.type === 'extension:prd-enricher:applied') {
      expect(event.changed).toBe(false);
    }
  });

  it('enricher that throws is fail-open: subsequent enrichers still run', async () => {
    const tmpDir = makeTempDir();
    let thirdRan = false;

    const failing = makeEnricher('failing', async () => {
      throw new Error('enricher error');
    });
    const succeeding = makeEnricher('succeeding', async (content) => {
      thirdRan = true;
      return content + '\n## From succeeding';
    });

    const result = await preprocessBuildSource({
      source: '# PRD',
      inputSources: [],
      prdEnrichers: [failing, succeeding],
      cwd: tmpDir,
      timeoutMs: 5000,
    });

    expect(thirdRan).toBe(true);
    expect(result.content).toContain('From succeeding');
    expect(result.provenance.enrichersFailed).toContain('failing');
    expect(result.provenance.enrichersApplied).toContain('succeeding');

    const failedEvents = result.events.filter((e) => e.type === 'extension:prd-enricher:failed');
    expect(failedEvents).toHaveLength(1);
    if (failedEvents[0].type === 'extension:prd-enricher:failed') {
      expect(failedEvents[0].reason).toBe('error');
      expect(failedEvents[0].enricherName).toBe('failing');
    }
  });

  it('enricher with invalid result (non-string, non-object) is fail-open', async () => {
    const tmpDir = makeTempDir();
    const invalidEnricher = makeEnricher('invalid', async () => 42);
    const goodEnricher = makeEnricher('good', async (c) => c + '\n## Good');

    const result = await preprocessBuildSource({
      source: '# PRD',
      inputSources: [],
      prdEnrichers: [invalidEnricher, goodEnricher],
      cwd: tmpDir,
      timeoutMs: 5000,
    });

    expect(result.content).toContain('## Good');
    expect(result.provenance.enrichersFailed).toContain('invalid');

    const failedEvents = result.events.filter((e) => e.type === 'extension:prd-enricher:failed');
    expect(failedEvents).toHaveLength(1);
    if (failedEvents[0].type === 'extension:prd-enricher:failed') {
      expect(failedEvents[0].reason).toBe('invalid-result');
    }
  });

  it('enricher timeout is fail-open: subsequent enrichers still run', async () => {
    const tmpDir = makeTempDir();
    let afterRan = false;

    const slowEnricher = makeEnricher('slow', () => new Promise<string>(() => {
      // never resolves
    }));
    const fastEnricher = makeEnricher('fast', async (c) => {
      afterRan = true;
      return c;
    });

    const result = await preprocessBuildSource({
      source: '# PRD',
      inputSources: [],
      prdEnrichers: [slowEnricher, fastEnricher],
      cwd: tmpDir,
      timeoutMs: 50,
    });

    expect(afterRan).toBe(true);
    expect(result.provenance.enrichersFailed).toContain('slow');

    const failedEvents = result.events.filter((e) => e.type === 'extension:prd-enricher:failed');
    expect(failedEvents).toHaveLength(1);
    if (failedEvents[0].type === 'extension:prd-enricher:failed') {
      expect(failedEvents[0].reason).toBe('timeout');
      expect(failedEvents[0].timeoutMs).toBe(50);
    }
  });
});

// ---------------------------------------------------------------------------
// preprocessBuildSource — event ordering
// ---------------------------------------------------------------------------

describe('preprocessBuildSource — event ordering', () => {
  it('input-source fetched event precedes enricher events', async () => {
    const tmpDir = makeTempDir();
    const adapter = makeInputSource('static', async () => '# Fetched content');
    const enricher = makeEnricher('add-section', async (c) => c + '\n## Extra');

    const result = await preprocessBuildSource({
      source: 'eforge://input/static/DOC-1',
      inputSources: [adapter],
      prdEnrichers: [enricher],
      cwd: tmpDir,
      timeoutMs: 5000,
    });

    expect(result.events).toHaveLength(2);
    expect(result.events[0].type).toBe('extension:input-source:fetched');
    expect(result.events[1].type).toBe('extension:prd-enricher:applied');
  });

  it('events array is empty when source is inline and no enrichers', async () => {
    const tmpDir = makeTempDir();

    const result = await preprocessBuildSource({
      source: '# PRD',
      inputSources: [],
      prdEnrichers: [],
      cwd: tmpDir,
      timeoutMs: 5000,
    });

    expect(result.events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// agentProfile — session-plan file sources expose agentProfile
// ---------------------------------------------------------------------------

describe('preprocessBuildSource — agentProfile from session-plan file', () => {
  it('exposes agentProfile when session-plan file declares agent_profile', async () => {
    const tmpDir = makeTempDir();
    const sessionPlansDir = resolve(tmpDir, '.eforge', 'session-plans');
    await mkdir(sessionPlansDir, { recursive: true });

    const sessionPlanContent = [
      '---',
      'session: 2026-05-01-test-plan',
      'topic: "Test Plan"',
      'status: planning',
      'planning_type: feature',
      'planning_depth: focused',
      'required_dimensions: []',
      'optional_dimensions: []',
      'skipped_dimensions: []',
      'open_questions: []',
      'profile: null',
      'agent_profile: docs-heavy',
      '---',
      '',
      '# Test Plan',
      '',
      '## Scope',
      '',
      'Do the thing.',
    ].join('\n');

    const planPath = resolve(sessionPlansDir, '2026-05-01-test-plan.md');
    await writeFile(planPath, sessionPlanContent, 'utf-8');

    const result = await preprocessBuildSource({
      source: planPath,
      inputSources: [],
      prdEnrichers: [],
      cwd: tmpDir,
      timeoutMs: 5000,
    });

    expect(result.agentProfile).toBe('docs-heavy');
    expect(result.content).toContain('# Test Plan');
    // The content should be build source (no frontmatter)
    expect(result.content).not.toMatch(/^---/);
  });

  it('does not expose agentProfile for non-session-plan file sources', async () => {
    const tmpDir = makeTempDir();
    const prdPath = resolve(tmpDir, 'my-prd.md');
    await writeFile(prdPath, '# My PRD\n\nDo the thing.', 'utf-8');

    const result = await preprocessBuildSource({
      source: prdPath,
      inputSources: [],
      prdEnrichers: [],
      cwd: tmpDir,
      timeoutMs: 5000,
    });

    expect(result.agentProfile).toBeUndefined();
  });

  it('does not expose agentProfile for adapter/inline sources', async () => {
    const tmpDir = makeTempDir();
    const adapter = makeInputSource('static', async () => '# Fetched content');

    const result = await preprocessBuildSource({
      source: 'eforge://input/static/DOC-1',
      inputSources: [adapter],
      prdEnrichers: [],
      cwd: tmpDir,
      timeoutMs: 5000,
    });

    expect(result.agentProfile).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// No engine-import boundary
// ---------------------------------------------------------------------------

describe('no-engine-import boundary', () => {
  it('packages/engine/src does not reference @eforge-build/input', () => {
    const engineSrcDir = resolve(REPO_ROOT, 'packages', 'engine', 'src');
    // Recursively grep engine source for @eforge-build/input imports
    const { execSync } = require('node:child_process');
    let output = '';
    try {
      output = execSync(
        `grep -r "from '@eforge-build/input'\\|from \\"@eforge-build/input\\"" "${engineSrcDir}" --include="*.ts" -l 2>/dev/null || true`,
        { encoding: 'utf-8' },
      ).trim();
    } catch {
      output = '';
    }
    expect(output).toBe('');
  });

  it('packages/engine/package.json does not reference @eforge-build/input', () => {
    const enginePkgJson = readFileSync(
      resolve(REPO_ROOT, 'packages', 'engine', 'package.json'),
      'utf-8',
    );
    expect(enginePkgJson).not.toContain('@eforge-build/input');
  });
});
