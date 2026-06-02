/**
 * Tests for executeStackLanding metadataFactory behavior:
 * factory result takes precedence over static metadata, fallback to static
 * metadata when factory throws, and no gh pr edit when factory throws with
 * no static metadata fallback.
 *
 * Extracted to a separate file to keep stack-runtime-landing.test.ts within
 * its legacy size ceiling. File name intentionally contains
 * "stack-runtime-landing" so the verification command
 * `pnpm test -- stack-runtime-landing` picks it up.
 */


import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import {
  executeStackLanding,
  type StackLandingOptions,
  type StackProviderAdapter,
  type ProviderCommandResult,
  upsertStackLayer,
} from '@eforge-build/engine/stacking';
import type { EforgeEvent } from '@eforge-build/engine/events';
import type { StackBaseContext } from '@eforge-build/engine/stacking';
import { collectBuildArtifactProvenance, renderProvenanceSection } from '@eforge-build/engine/provenance';

// ---------------------------------------------------------------------------
// Helpers (local copies of stack-runtime-landing.test.ts infrastructure)
// ---------------------------------------------------------------------------

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'eforge-stack-provenance-'));
});

function makeResult(command: string, args: string[], stdout = ''): ProviderCommandResult {
  return { command, args, stdout, stderr: '', exitCode: 0 };
}

function makeStubProvider(overrides?: Partial<StackProviderAdapter>): StackProviderAdapter {
  return {
    requireAvailable: async () => {},
    trackBranch: async (_cwd, base) => makeResult('git-spice', ['branch', 'track', '--base', base]),
    retargetBranch: async (_cwd, branch, target) => makeResult('git-spice', ['branch', 'onto', target, '--branch', branch]),
    submitBranch: async () => makeResult('git-spice', ['branch', 'submit'], 'Created PR https://github.com/owner/repo/pull/42'),
    submitStack: async () => makeResult('git-spice', ['stack', 'submit']),
    syncRepo: async () => makeResult('git-spice', ['repo', 'sync']),
    restackBranch: async () => makeResult('git-spice', ['branch', 'restack']),
    restackStack: async () => makeResult('git-spice', ['stack', 'restack']),
    upstackOnto: async (_cwd, target) => makeResult('git-spice', ['upstack', 'onto', target]),
    commandPreview: (argv) => ({ command: 'git-spice', args: argv }),
    syncRepoPreview: () => ({ command: 'git-spice', args: ['repo', 'sync'] }),
    restackStackPreview: () => ({ command: 'git-spice', args: ['stack', 'restack'] }),
    parsePrUrl: (stdout) => stdout.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/)?.[0],
    isValidPrUrl: (url) => /^https:\/\/github\.com\/.+\/pull\/\d+$/.test(url),
    redactMessage: (message) => message,
    ...overrides,
  };
}

function makeStackContext(overrides?: Partial<StackBaseContext>): StackBaseContext {
  return { prdId: 'test-prd', stackId: 'test-stack', provider: 'git-spice', branch: 'eforge/test-prd', baseBranch: 'main', ...overrides };
}

async function collectEvents(gen: AsyncGenerator<EforgeEvent>): Promise<EforgeEvent[]> {
  const events: EforgeEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

async function seedLayer(dir: string, prdId = 'test-prd'): Promise<void> {
  const now = new Date().toISOString();
  await upsertStackLayer(dir, { prdId, stackId: 'test-stack', provider: 'git-spice', branch: `eforge/${prdId}`, status: 'built', recordedAt: now, updatedAt: now });
}

function makeFakeGhForMetadata(binDir: string, editBehavior: 'success' | 'fail'): void {
  execFileSync('mkdir', ['-p', binDir]);
  const scriptPath = join(binDir, 'gh');
  const exitCode = editBehavior === 'success' ? 0 : 1;
  writeFileSync(scriptPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
const fs = require('fs');
const path = require('path');
// Log pr subcommand invocations
if (args[0] === 'pr') {
  fs.appendFileSync(path.join(__dirname, '..', 'gh-pr-args.log'), JSON.stringify(args) + '\\n');
}
// Copy body-file content
const bodyFileIdx = args.indexOf('--body-file');
if (bodyFileIdx !== -1) {
  const bodyFile = args[bodyFileIdx + 1];
  if (bodyFile) {
    try {
      const body = fs.readFileSync(bodyFile, 'utf8');
      fs.appendFileSync(path.join(__dirname, '..', 'gh-pr-body.log'), body + '\\n---END---\\n');
    } catch {}
  }
}
if (args[0] === 'pr' && args[1] === 'merge') { process.exit(0); }
if (args[0] === 'pr' && args[1] === 'edit') {
  if (${exitCode} !== 0) { process.stderr.write('edit failed\\n'); }
  process.exit(${exitCode});
}
process.exit(0);
`, { mode: 0o755 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeStackLanding — metadataFactory', () => {
  it('uses metadataFactory result when metadataFactory is provided', async () => {
    await seedLayer(cwd);

    const binDir = join(cwd, 'bin-stack-meta-factory-ok');
    makeFakeGhForMetadata(binDir, 'success');
    const bodyLog = join(cwd, 'gh-pr-body.log');

    const origPath = process.env.PATH;
    process.env.PATH = `${binDir}:${origPath}`;

    try {
      const prUrl = 'https://github.com/owner/repo/pull/42';
      const provider = makeStubProvider({
        submitBranch: async () =>
          makeResult('git-spice', ['branch', 'submit'], `Created PR ${prUrl}`),
      });

      const factoryBody = '## Factory provenance body\nGenerated by metadataFactory';
      const staticBody = '## Static body\nThis should NOT appear in the output';

      const opts: StackLandingOptions = {
        cwd,
        mergeWorktreePath: cwd,
        stackContext: makeStackContext(),
        landingAction: 'pr',
        provider,
        metadata: { title: 'Static title', body: staticBody },
        metadataFactory: async () => ({ title: 'Factory title', body: factoryBody }),
      };

      await collectEvents(executeStackLanding(opts));

      const body = readFileSync(bodyLog, 'utf-8');
      expect(body).toContain(factoryBody);
      expect(body).not.toContain(staticBody);
    } finally {
      process.env.PATH = origPath;
    }
  });

  it('falls back to static metadata when metadataFactory throws', async () => {
    await seedLayer(cwd);

    const binDir = join(cwd, 'bin-stack-meta-factory-fail');
    makeFakeGhForMetadata(binDir, 'success');
    const bodyLog = join(cwd, 'gh-pr-body.log');

    const origPath = process.env.PATH;
    process.env.PATH = `${binDir}:${origPath}`;

    try {
      const prUrl = 'https://github.com/owner/repo/pull/42';
      const provider = makeStubProvider({
        submitBranch: async () =>
          makeResult('git-spice', ['branch', 'submit'], `Created PR ${prUrl}`),
      });

      const staticBody = '## Static body\nFallback content used when factory throws';

      const opts: StackLandingOptions = {
        cwd,
        mergeWorktreePath: cwd,
        stackContext: makeStackContext(),
        landingAction: 'pr',
        provider,
        metadata: { title: 'Static title', body: staticBody },
        metadataFactory: async () => { throw new Error('factory intentionally failed'); },
      };

      await collectEvents(executeStackLanding(opts));

      const body = readFileSync(bodyLog, 'utf-8');
      expect(body).toContain(staticBody);
    } finally {
      process.env.PATH = origPath;
    }
  });

  it('skips gh pr edit when metadataFactory throws and no static metadata is provided', async () => {
    await seedLayer(cwd);

    const binDir = join(cwd, 'bin-stack-meta-factory-no-fallback');
    makeFakeGhForMetadata(binDir, 'success');
    const argsLog = join(cwd, 'gh-pr-args.log');

    const origPath = process.env.PATH;
    process.env.PATH = `${binDir}:${origPath}`;

    try {
      const prUrl = 'https://github.com/owner/repo/pull/42';
      const provider = makeStubProvider({
        submitBranch: async () =>
          makeResult('git-spice', ['branch', 'submit'], `Created PR ${prUrl}`),
      });

      const opts: StackLandingOptions = {
        cwd,
        mergeWorktreePath: cwd,
        stackContext: makeStackContext(),
        landingAction: 'pr',
        provider,
        // No static metadata, and factory always throws
        metadataFactory: async () => { throw new Error('no metadata available'); },
      };

      const events = await collectEvents(executeStackLanding(opts));

      // Landing must still complete successfully
      const completeEvent = events.find(
        (e) => e.type === 'stack:landing:update' && (e as Record<string, unknown>).status === 'complete',
      );
      expect(completeEvent).toBeDefined();

      // gh pr edit must NOT have been called (no metadata to apply)
      let editCalled = false;
      try {
        const raw = readFileSync(argsLog, 'utf-8').trim();
        const invocations: string[][] = raw.split('\n').map((line) => JSON.parse(line));
        editCalled = invocations.some((args) => args[0] === 'pr' && args[1] === 'edit');
      } catch {
        // argsLog may not exist at all (no gh calls made) — that is the correct outcome
      }
      expect(editCalled).toBe(false);
    } finally {
      process.env.PATH = origPath;
    }
  });
});

describe('executeStackLanding — Eforge provenance section in stacked PR body', () => {
  it('stacked PR body includes ## Eforge provenance with committed artifact refs', async () => {
    // Initialize a real git repo in the temp cwd so provenance lookup works
    execFileSync('git', ['init', cwd]);
    execFileSync('git', ['-C', cwd, 'config', 'user.email', 'test@test.com']);
    execFileSync('git', ['-C', cwd, 'config', 'user.name', 'Test']);

    // Commit PRD and plan artifacts so Git history contains them
    const prdDir = join(cwd, 'eforge', 'prds');
    const planDir = join(cwd, 'eforge', 'plans', 'test-stack');
    mkdirSync(prdDir, { recursive: true });
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(prdDir, 'test-prd.md'), '# Test PRD\n');
    writeFileSync(join(planDir, 'orchestration.yaml'), 'name: test-stack\n');
    writeFileSync(join(planDir, 'plan-01.md'), '# Plan 01\n');
    execFileSync('git', ['-C', cwd, 'add', '.']);
    execFileSync('git', ['-C', cwd, 'commit', '-m', 'add artifacts']);

    await seedLayer(cwd);

    const binDir = join(cwd, 'bin-stack-prov-sect');
    makeFakeGhForMetadata(binDir, 'success');
    const bodyLog = join(cwd, 'gh-pr-body.log');

    const origPath = process.env.PATH;
    process.env.PATH = `${binDir}:${origPath}`;

    try {
      const prUrl = 'https://github.com/owner/repo/pull/42';
      const provider = makeStubProvider({
        submitBranch: async () =>
          makeResult('git-spice', ['branch', 'submit'], `Created PR ${prUrl}`),
      });

      const opts: StackLandingOptions = {
        cwd,
        mergeWorktreePath: cwd,
        stackContext: makeStackContext(),
        landingAction: 'pr',
        provider,
        metadataFactory: async () => {
          const provenanceRefs = await collectBuildArtifactProvenance(cwd, {
            planSetName: 'test-stack',
            outputDir: 'eforge/plans',
            prdArtifactPath: 'eforge/prds/test-prd.md',
          });
          const provenanceSection = renderProvenanceSection(provenanceRefs);
          return {
            title: 'Test Stack PR',
            body: `## Description\nTest build\n\n${provenanceSection}`,
          };
        },
      };

      await collectEvents(executeStackLanding(opts));

      const body = readFileSync(bodyLog, 'utf-8');
      // The rendered provenance section must appear in the edited PR body
      expect(body).toContain('## Eforge provenance');
      // All three artifact kinds must be present as labelled rows
      expect(body).toContain('Normalized PRD');
      expect(body).toContain('Orchestration');
      expect(body).toContain('Plan');
      // Each row must include a commit-pinned git show reference
      const gitShowMatches = body.match(/git show [0-9a-f]{40}:/g) ?? [];
      expect(gitShowMatches.length).toBeGreaterThanOrEqual(3);
      // Must never use branch-relative blob URLs
      expect(body).not.toMatch(/\/blob\/main\//);
      expect(body).not.toMatch(/\/blob\/master\//);
    } finally {
      process.env.PATH = origPath;
    }
  });
});

