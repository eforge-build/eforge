import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAcceptanceUnknownResolverOutput, mergeAcceptanceUnknownResolutions } from '@eforge-build/engine/validation/acceptance-unknown-resolution';
import { createReadOnlyCommandTool, runAcceptanceUnknownResolver } from '@eforge-build/engine/agents/acceptance-unknown-resolver';
import type { EforgeEvent } from '@eforge-build/engine/events';
import { StubHarness } from './stub-harness.js';

const UNKNOWN = [{ id: 'ac-001', text: 'The CLI reports success', raw: '- The CLI reports success' }];

function acceptanceEvent(verdict: 'pass' | 'fail' | 'unknown' = 'unknown'): Extract<EforgeEvent, { type: 'acceptance_validation:complete' }> {
  return {
    type: 'acceptance_validation:complete',
    timestamp: new Date().toISOString(),
    passed: verdict === 'pass',
    verdicts: [{ criterion: 'The CLI reports success', verdict, evidence: 'initial evidence' }],
    source: 'prd',
  };
}

describe('acceptance unknown resolver parsing', () => {
  it('parses pass verdicts with non-empty file evidence', () => {
    const parsed = parseAcceptanceUnknownResolverOutput(JSON.stringify({
      verdicts: [{ criterion: 'ac-001', verdict: 'pass', evidence: { type: 'file', path: 'src/cli.ts', excerpt: 'prints success' } }],
    }), UNKNOWN);
    expect(parsed).toEqual([{ criterion: 'ac-001', verdict: 'pass', evidence: { type: 'file', path: 'src/cli.ts', excerpt: 'prints success' } }]);
  });

  it('parses prose-wrapped fenced resolver JSON', () => {
    const parsed = parseAcceptanceUnknownResolverOutput([
      'Resolver result:',
      '```json',
      JSON.stringify({ verdicts: [{ criterion: 'ac-001', verdict: 'pass', evidence: { type: 'file', path: 'src/cli.ts', excerpt: 'prints success' } }] }),
      '```',
      'Done.',
    ].join('\n'), UNKNOWN);

    expect(parsed).toEqual([{ criterion: 'ac-001', verdict: 'pass', evidence: { type: 'file', path: 'src/cli.ts', excerpt: 'prints success' } }]);
  });

  it('rejects malformed JSON and unknown criterion references', () => {
    expect(() => parseAcceptanceUnknownResolverOutput('```json\n{bad}\n```', UNKNOWN)).toThrow(/malformed JSON/);
    expect(() => parseAcceptanceUnknownResolverOutput(JSON.stringify({
      verdicts: [{ criterion: 'ac-999', verdict: 'pass', evidence: { type: 'file', path: 'src/a.ts', excerpt: 'x' } }],
    }), UNKNOWN)).toThrow(/non-unresolved criterion/);
  });

  it('rejects pass verdicts without file or command evidence', () => {
    expect(() => parseAcceptanceUnknownResolverOutput(JSON.stringify({
      verdicts: [{ criterion: 'ac-001', verdict: 'pass', evidence: { type: 'note', detail: 'trust me' } }],
    }), UNKNOWN)).toThrow(/file or command/);
  });

  it('merges resolver verdicts back into the acceptance event', () => {
    const merged = mergeAcceptanceUnknownResolutions(acceptanceEvent(), UNKNOWN, [
      { criterion: 'ac-001', verdict: 'fail', evidence: { type: 'command', argv: ['git', 'grep', 'success'], output: 'no matches' } },
    ]);
    expect(merged.passed).toBe(false);
    expect(merged.verdicts[0]).toMatchObject({ verdict: 'fail', evidence: expect.stringContaining('git grep success') });
  });

  it('verifies command evidence against recorded read-only command stdout', () => {
    const parsed = parseAcceptanceUnknownResolverOutput(JSON.stringify({
      verdicts: [{ criterion: 'ac-001', verdict: 'pass', evidence: { type: 'command', argv: ['git', 'grep', 'success'], output: 'src/cli.ts:success branch\n' } }],
    }), UNKNOWN, {
      commandEvidence: [{
        command: 'git grep success',
        exitCode: 0,
        output: JSON.stringify({ exitCode: 0, stdout: 'src/cli.ts:success branch\n', stderr: '' }, null, 2),
      }],
    });

    expect(parsed).toEqual([{ criterion: 'ac-001', verdict: 'pass', evidence: { type: 'command', argv: ['git', 'grep', 'success'], output: 'src/cli.ts:success branch' } }]);
  });
});

describe('acceptance read-only command tool', () => {
  it('runs allowlisted inspection commands and rejects unsafe commands', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eforge-ac-resolver-'));
    writeFileSync(join(dir, 'example.txt'), 'hello\n');
    const tool = createReadOnlyCommandTool(dir);
    await expect(tool.handler({ argv: ['cat', 'example.txt'] })).resolves.toContain('hello');
    await expect(tool.handler({ argv: ['cat', '/etc/passwd'] })).rejects.toThrow(/Unsafe read-only command path argument/);
    await expect(tool.handler({ argv: ['rg', '--pre', 'sh -c true', 'hello'] })).rejects.toThrow(/options are not allowed/);
    await expect(tool.handler({ argv: ['git', 'diff', '--output=leak.txt'] })).rejects.toThrow(/Unsafe git option/);
    await expect(tool.handler({ argv: ['git', 'grep', '-O', 'sh -c true', 'hello'] })).rejects.toThrow(/Unsafe git option/);
    await expect(tool.handler({ argv: ['git', '--work-tree', '/tmp', 'status'] })).rejects.toThrow(/Unsafe git global option/);
    await expect(tool.handler({ argv: ['git', '-c', 'core.pager=sh -c true', 'grep', 'hello'] })).rejects.toThrow(/Unsafe git global option/);
    await expect(tool.handler({ argv: ['git', 'commit', '-m', 'nope'] })).rejects.toThrow(/Unsafe git subcommand/);
    await expect(tool.handler({ argv: ['sh', '-c', 'echo nope'] })).rejects.toThrow(/Unsafe read-only command/);
  });
});

describe('acceptance unknown resolver runner', () => {
  it('uses the prd-validator role and returns parsed verdicts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eforge-ac-resolver-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src/cli.ts'), 'success branch\n');
    const harness = new StubHarness([{ text: JSON.stringify({
      verdicts: [{ criterion: 'ac-001', verdict: 'pass', evidence: { type: 'file', path: 'src/cli.ts', excerpt: 'success branch' } }],
    }) }]);
    const events: EforgeEvent[] = [];
    const iterator = runAcceptanceUnknownResolver({
      harness,
      cwd: dir,
      unknownCriteria: UNKNOWN,
      acceptanceVerdicts: acceptanceEvent().verdicts,
      implementationDiffContext: 'diff --git a/src/cli.ts b/src/cli.ts',
    });
    let result;
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        result = next.value;
        break;
      }
      events.push(next.value);
    }
    expect(events).toContainEqual(expect.objectContaining({ type: 'agent:start', agent: 'prd-validator' }));
    expect(result).toEqual([{ criterion: 'ac-001', verdict: 'pass', evidence: { type: 'file', path: 'src/cli.ts', excerpt: 'success branch' } }]);
  });

  it('fails closed on no output', async () => {
    const harness = new StubHarness([{ resultText: '' }]);
    const iterator = runAcceptanceUnknownResolver({
      harness,
      cwd: process.cwd(),
      unknownCriteria: UNKNOWN,
      acceptanceVerdicts: acceptanceEvent().verdicts,
      implementationDiffContext: 'diff',
    });
    await expect(async () => {
      while (!(await iterator.next()).done) { /* drain */ }
    }).rejects.toThrow(/no output/);
  });
});
