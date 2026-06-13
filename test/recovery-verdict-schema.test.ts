// Split from recovery.test.ts.
import { describe, it, expect } from 'vitest';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { EforgeEvent, BuildFailureSummary } from '@eforge-build/engine/events';
import { parseRecoveryVerdictBlock } from '@eforge-build/engine/agents/common';
import { recoveryVerdictSchema, getRecoveryVerdictSchemaYaml } from '@eforge-build/engine/schemas';
import { safeParseWithSchema, safeParseEforgeEvent } from '@eforge-build/client';
import { runRecoveryAnalyst } from '@eforge-build/engine/agents/recovery-analyst';
import { writeRecoverySidecar } from '@eforge-build/engine/recovery/sidecar';
import { buildFailureSummary } from '@eforge-build/engine/recovery/failure-summary';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import { openDatabase } from '@eforge-build/monitor/db';
import { StubHarness } from './stub-harness.js';
import { collectEvents, findEvent, filterEvents } from './test-events.js';
import { useTempDir } from './test-tmpdir.js';

describe('parseRecoveryVerdictBlock', () => {
  it('returns null for empty text', () => {
    expect(parseRecoveryVerdictBlock('')).toBeNull();
  });

  it('returns null for plain text with no XML block', () => {
    expect(parseRecoveryVerdictBlock('I recommend manual review.')).toBeNull();
  });

  it('returns null when verdict attribute is invalid', () => {
    const text = `<recovery verdict="unknown" confidence="high">
  <rationale>Some reason</rationale>
  <completedWork></completedWork>
  <remainingWork></remainingWork>
  <risks></risks>
</recovery>`;
    expect(parseRecoveryVerdictBlock(text)).toBeNull();
  });

  it('returns null when confidence attribute is invalid', () => {
    const text = `<recovery verdict="retry" confidence="extreme">
  <rationale>Some reason</rationale>
  <completedWork></completedWork>
  <remainingWork></remainingWork>
  <risks></risks>
</recovery>`;
    expect(parseRecoveryVerdictBlock(text)).toBeNull();
  });

  it('returns null when rationale is missing', () => {
    const text = `<recovery verdict="manual" confidence="low">
  <completedWork></completedWork>
  <remainingWork></remainingWork>
  <risks></risks>
</recovery>`;
    expect(parseRecoveryVerdictBlock(text)).toBeNull();
  });

  it('parses retry verdict', () => {
    const text = `<recovery verdict="retry" confidence="high">
  <rationale>The failure was a transient network timeout — no code issues.</rationale>
  <completedWork>
    <item>plan-01: merged successfully</item>
  </completedWork>
  <remainingWork>
    <item>plan-02: timed out, retry should succeed</item>
  </remainingWork>
  <risks>
    <item>Network instability may persist</item>
  </risks>
</recovery>`;
    const result = parseRecoveryVerdictBlock(text);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('retry');
    expect(result!.confidence).toBe('high');
    expect(result!.rationale).toBe('The failure was a transient network timeout — no code issues.');
    expect(result!.completedWork).toEqual(['plan-01: merged successfully']);
    expect(result!.remainingWork).toEqual(['plan-02: timed out, retry should succeed']);
    expect(result!.risks).toEqual(['Network instability may persist']);
  });

  it('parses continue-repair verdict', () => {
    const text = `<recovery verdict="continue-repair" confidence="medium">
  <rationale>Compiled artifacts are preserved and eligible for continue-and-repair.</rationale>
  <completedWork>
    <item>Database schema merged</item>
    <item>Auth middleware merged</item>
  </completedWork>
  <remainingWork>
    <item>REST API endpoints</item>
    <item>Integration tests</item>
  </remainingWork>
  <risks>
    <item>Type error must be fixed</item>
  </risks>
</recovery>`;
    const result = parseRecoveryVerdictBlock(text);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('continue-repair');
    expect(result!.confidence).toBe('medium');
    expect(result!.completedWork).toHaveLength(2);
    expect(result!.remainingWork).toHaveLength(2);
  });

  it('rejects removed split verdicts', () => {
    const text = `<recovery verdict="split" confidence="medium">
  <rationale>Legacy split output is no longer accepted.</rationale>
  <completedWork></completedWork>
  <remainingWork></remainingWork>
  <risks></risks>
</recovery>`;
    expect(parseRecoveryVerdictBlock(text)).toBeNull();
  });

  it('parses abandon verdict', () => {
    const text = `<recovery verdict="abandon" confidence="high">
  <rationale>The feature was shipped in a hotfix before this build ran.</rationale>
  <completedWork>
    <item>Feature already live via hotfix</item>
  </completedWork>
  <remainingWork></remainingWork>
  <risks></risks>
</recovery>`;
    const result = parseRecoveryVerdictBlock(text);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('abandon');
    expect(result!.completedWork).toHaveLength(1);
    expect(result!.remainingWork).toHaveLength(0);
  });

  it('parses manual verdict', () => {
    const text = `<recovery verdict="manual" confidence="low">
  <rationale>Insufficient evidence — ambiguous error with no clear transient indicator.</rationale>
  <completedWork></completedWork>
  <remainingWork>
    <item>All acceptance criteria remain</item>
  </remainingWork>
  <risks>
    <item>Unknown root cause</item>
  </risks>
</recovery>`;
    const result = parseRecoveryVerdictBlock(text);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('manual');
    expect(result!.confidence).toBe('low');
    expect(result!.remainingWork).toHaveLength(1);
  });

  it('extracts the block from surrounding text', () => {
    const text = `Analysis complete. Based on my review:

<recovery verdict="manual" confidence="low">
  <rationale>Evidence is unclear.</rationale>
  <completedWork></completedWork>
  <remainingWork></remainingWork>
  <risks></risks>
</recovery>

That concludes my assessment.`;
    const result = parseRecoveryVerdictBlock(text);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('manual');
  });
});

describe('getRecoveryVerdictSchemaYaml', () => {
  function parsedSchema(): Record<string, any> {
    return parseYaml(getRecoveryVerdictSchemaYaml()) as Record<string, any>;
  }

  it('emits parseable object schema with the verdict enum values', () => {
    const schema = parsedSchema();

    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(expect.arrayContaining(['verdict', 'confidence', 'rationale', 'completedWork', 'remainingWork', 'risks']));
    expect(schema.properties.verdict.anyOf.map((entry: { const: string }) => entry.const)).toEqual(['retry', 'continue-repair', 'abandon', 'manual']);
    expect(getRecoveryVerdictSchemaYaml()).not.toContain(['suggested', 'Successor', 'Prd'].join(''));
  });

  it('includes optional recovery metadata fields in the schema structure', () => {
    const schema = parsedSchema();

    expect(schema.properties.recommendationSource.anyOf.map((entry: { const: string }) => entry.const)).toEqual(['deterministic', 'analyst', 'manual-fallback']);
    expect(schema.properties.recoveryError.type).toBe('string');
    expect(schema.properties.recommendationRationale.type).toBe('string');
    expect(schema.properties.verdictInvalidationReason.type).toBe('string');
  });

  it('is cached — returns the same string on repeated calls', () => {
    expect(getRecoveryVerdictSchemaYaml()).toBe(getRecoveryVerdictSchemaYaml());
  });
});

describe('recoveryVerdictSchema', () => {
  function makeVerdict(overrides: Record<string, unknown> = {}) {
    return {
      verdict: 'manual',
      confidence: 'low',
      rationale: 'Insufficient evidence',
      completedWork: [],
      remainingWork: [],
      risks: [],
      ...overrides,
    };
  }

  it('accepts retry verdict', () => {
    expect(safeParseWithSchema(recoveryVerdictSchema, makeVerdict({ verdict: 'retry', confidence: 'high' })).success).toBe(true);
  });

  it('accepts continue-repair verdict', () => {
    const result = safeParseWithSchema(recoveryVerdictSchema, makeVerdict({
      verdict: 'continue-repair',
      confidence: 'medium',
    }));
    expect(result.success).toBe(true);
  });

  it('rejects removed split verdict', () => {
    expect(safeParseWithSchema(recoveryVerdictSchema, makeVerdict({ verdict: 'split' })).success).toBe(false);
  });

  it('accepts abandon verdict', () => {
    expect(safeParseWithSchema(recoveryVerdictSchema, makeVerdict({ verdict: 'abandon' })).success).toBe(true);
  });

  it('accepts manual verdict', () => {
    expect(safeParseWithSchema(recoveryVerdictSchema, makeVerdict()).success).toBe(true);
  });

  it('rejects unknown verdict', () => {
    expect(safeParseWithSchema(recoveryVerdictSchema, makeVerdict({ verdict: 'unknown' })).success).toBe(false);
  });

  it('rejects unknown confidence', () => {
    expect(safeParseWithSchema(recoveryVerdictSchema, makeVerdict({ confidence: 'extreme' })).success).toBe(false);
  });

  it('rejects empty rationale', () => {
    expect(safeParseWithSchema(recoveryVerdictSchema, makeVerdict({ rationale: '' })).success).toBe(false);
  });
});
