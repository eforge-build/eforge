/**
 * Unit and integration tests for the provenance module.
 *
 * Git-history tests use real temp repos so commit SHA lookups are accurate.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import {
  parseGitHubRepoFromRemote,
  collectBuildArtifactProvenance,
  renderProvenanceSection,
  type BuildArtifactProvenanceRef,
} from '@eforge-build/engine/provenance';
import { useTempDir } from './test-tmpdir.js';

const exec = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupGitRepo(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'initial'], { cwd: dir });
}

function gitSha(dir: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
}

// ---------------------------------------------------------------------------
// parseGitHubRepoFromRemote — URL parsing
// ---------------------------------------------------------------------------

describe('parseGitHubRepoFromRemote', () => {
  it('parses HTTPS remote with .git suffix', () => {
    expect(parseGitHubRepoFromRemote('https://github.com/owner/repo.git')).toBe('owner/repo');
  });

  it('parses HTTPS remote without .git suffix', () => {
    expect(parseGitHubRepoFromRemote('https://github.com/owner/repo')).toBe('owner/repo');
  });

  it('parses git+https remote', () => {
    expect(parseGitHubRepoFromRemote('git+https://github.com/owner/repo.git')).toBe('owner/repo');
  });

  it('parses scp-like SSH remote (git@github.com:owner/repo.git)', () => {
    expect(parseGitHubRepoFromRemote('git@github.com:owner/repo.git')).toBe('owner/repo');
  });

  it('parses scp-like SSH remote without .git suffix', () => {
    expect(parseGitHubRepoFromRemote('git@github.com:owner/repo')).toBe('owner/repo');
  });

  it('parses ssh:// remote', () => {
    expect(parseGitHubRepoFromRemote('ssh://git@github.com/owner/repo.git')).toBe('owner/repo');
  });

  it('parses ssh:// remote without .git suffix', () => {
    expect(parseGitHubRepoFromRemote('ssh://git@github.com/owner/repo')).toBe('owner/repo');
  });

  it('returns undefined for GitLab HTTPS remote', () => {
    expect(parseGitHubRepoFromRemote('https://gitlab.com/owner/repo.git')).toBeUndefined();
  });

  it('returns undefined for a local file path', () => {
    expect(parseGitHubRepoFromRemote('/tmp/local-remote.git')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(parseGitHubRepoFromRemote('')).toBeUndefined();
  });

  it('returns undefined for a Bitbucket remote', () => {
    expect(parseGitHubRepoFromRemote('https://bitbucket.org/owner/repo.git')).toBeUndefined();
  });

  it('preserves hyphenated repo names', () => {
    expect(parseGitHubRepoFromRemote('https://github.com/my-org/my-repo.git')).toBe('my-org/my-repo');
  });
});

// ---------------------------------------------------------------------------
// collectBuildArtifactProvenance — non-deletion commit lookup
// ---------------------------------------------------------------------------

describe('collectBuildArtifactProvenance — non-deletion commit lookup', () => {
  const makeTempDir = useTempDir('eforge-provenance-');

  it('returns the modify commit SHA when a file is added, modified, then deleted', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);

    // Add the PRD file
    mkdirSync(join(dir, 'eforge', 'prds'), { recursive: true });
    writeFileSync(join(dir, 'eforge', 'prds', 'demo.md'), '# version 1\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'add demo.md'], { cwd: dir });

    // Modify the PRD file
    writeFileSync(join(dir, 'eforge', 'prds', 'demo.md'), '# version 2 modified\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'modify demo.md'], { cwd: dir });
    const modifySha = gitSha(dir);

    // Delete the PRD file
    execFileSync('git', ['rm', 'eforge/prds/demo.md'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'delete demo.md'], { cwd: dir });

    const refs = await collectBuildArtifactProvenance(dir, {
      planSetName: 'demo',
      outputDir: 'eforge/plans',
      prdArtifactPath: 'eforge/prds/demo.md',
    });

    const prdRef = refs.find((r) => r.kind === 'prd');
    expect(prdRef).toBeDefined();
    // Must return the modify commit, not the deletion commit
    expect(prdRef!.commitSha).toBe(modifySha);
  });

  it('`git show <sha>:<path>` recovers the modified content after deletion', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);

    mkdirSync(join(dir, 'eforge', 'prds'), { recursive: true });
    writeFileSync(join(dir, 'eforge', 'prds', 'demo.md'), '# v1\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'add'], { cwd: dir });

    writeFileSync(join(dir, 'eforge', 'prds', 'demo.md'), '# v2 modified content\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'modify'], { cwd: dir });
    const modifySha = gitSha(dir);

    execFileSync('git', ['rm', 'eforge/prds/demo.md'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'delete'], { cwd: dir });

    const refs = await collectBuildArtifactProvenance(dir, {
      planSetName: 'demo',
      outputDir: 'eforge/plans',
      prdArtifactPath: 'eforge/prds/demo.md',
    });

    const prdRef = refs.find((r) => r.kind === 'prd');
    expect(prdRef).toBeDefined();

    // git show with the collected SHA returns the modified content
    // Assert that the collected SHA matches modifySha before using it
    expect(prdRef!.commitSha).toBe(modifySha);
    const { stdout } = await exec('git', ['show', `${prdRef!.commitSha}:${prdRef!.path}`], { cwd: dir });
    expect(stdout.trim()).toBe('# v2 modified content');
  });

  it('returns empty when the file was never committed', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);

    const refs = await collectBuildArtifactProvenance(dir, {
      planSetName: 'nonexistent',
      outputDir: 'eforge/plans',
      prdArtifactPath: 'eforge/prds/nonexistent.md',
    });

    expect(refs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// collectBuildArtifactProvenance — GitHub URL rendering
// ---------------------------------------------------------------------------

describe('collectBuildArtifactProvenance — GitHub URL rendering', () => {
  const makeTempDir = useTempDir('eforge-provenance-gh-');

  it('renders GitHub blob URL for HTTPS remote (https://github.com/...)', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/my-org/my-repo.git'], { cwd: dir });

    mkdirSync(join(dir, 'eforge', 'plans', 'test-set'), { recursive: true });
    writeFileSync(join(dir, 'eforge', 'plans', 'test-set', 'orchestration.yaml'), 'planSet: test-set\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'add plan'], { cwd: dir });
    const sha = gitSha(dir);

    const refs = await collectBuildArtifactProvenance(dir, {
      planSetName: 'test-set',
      outputDir: 'eforge/plans',
    });

    const orchRef = refs.find((r) => r.kind === 'orchestration');
    expect(orchRef).toBeDefined();
    expect(orchRef!.webUrl).toBe(
      `https://github.com/my-org/my-repo/blob/${sha}/eforge/plans/test-set/orchestration.yaml`,
    );
  });

  it('renders GitHub blob URL for git+https remote', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);
    execFileSync('git', ['remote', 'add', 'origin', 'git+https://github.com/acme/proj.git'], { cwd: dir });

    mkdirSync(join(dir, 'eforge', 'plans', 'test-set'), { recursive: true });
    writeFileSync(join(dir, 'eforge', 'plans', 'test-set', 'orchestration.yaml'), 'planSet: test-set\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'add plan'], { cwd: dir });
    const sha = gitSha(dir);

    const refs = await collectBuildArtifactProvenance(dir, {
      planSetName: 'test-set',
      outputDir: 'eforge/plans',
    });

    const orchRef = refs.find((r) => r.kind === 'orchestration');
    expect(orchRef!.webUrl).toContain(`https://github.com/acme/proj/blob/${sha}/`);
  });

  it('renders GitHub blob URL for scp-like SSH remote (git@github.com:...)', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:my-org/my-repo.git'], { cwd: dir });

    mkdirSync(join(dir, 'eforge', 'plans', 'test-set'), { recursive: true });
    writeFileSync(join(dir, 'eforge', 'plans', 'test-set', 'orchestration.yaml'), 'planSet: test-set\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'add plan'], { cwd: dir });
    const sha = gitSha(dir);

    const refs = await collectBuildArtifactProvenance(dir, {
      planSetName: 'test-set',
      outputDir: 'eforge/plans',
    });

    const orchRef = refs.find((r) => r.kind === 'orchestration');
    expect(orchRef!.webUrl).toBe(
      `https://github.com/my-org/my-repo/blob/${sha}/eforge/plans/test-set/orchestration.yaml`,
    );
  });

  it('renders GitHub blob URL for ssh:// remote', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);
    execFileSync('git', ['remote', 'add', 'origin', 'ssh://git@github.com/my-org/my-repo.git'], { cwd: dir });

    mkdirSync(join(dir, 'eforge', 'plans', 'test-set'), { recursive: true });
    writeFileSync(join(dir, 'eforge', 'plans', 'test-set', 'orchestration.yaml'), 'planSet: test-set\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'add plan'], { cwd: dir });
    const sha = gitSha(dir);

    const refs = await collectBuildArtifactProvenance(dir, {
      planSetName: 'test-set',
      outputDir: 'eforge/plans',
    });

    const orchRef = refs.find((r) => r.kind === 'orchestration');
    expect(orchRef!.webUrl).toBe(
      `https://github.com/my-org/my-repo/blob/${sha}/eforge/plans/test-set/orchestration.yaml`,
    );
  });

  it('sets webUrl to undefined when remote is a local file path', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);
    execFileSync('git', ['remote', 'add', 'origin', '/tmp/local-remote.git'], { cwd: dir });

    mkdirSync(join(dir, 'eforge', 'plans', 'test-set'), { recursive: true });
    writeFileSync(join(dir, 'eforge', 'plans', 'test-set', 'orchestration.yaml'), 'planSet: test-set\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'add plan'], { cwd: dir });

    const refs = await collectBuildArtifactProvenance(dir, {
      planSetName: 'test-set',
      outputDir: 'eforge/plans',
    });

    const orchRef = refs.find((r) => r.kind === 'orchestration');
    expect(orchRef).toBeDefined();
    expect(orchRef!.webUrl).toBeUndefined();
    // gitShowRef must still be present
    expect(orchRef!.gitShowRef).toMatch(/^git show [0-9a-f]{40}:eforge\/plans\/test-set\/orchestration\.yaml$/);
  });

  it('sets webUrl to undefined when no remote is configured', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);

    mkdirSync(join(dir, 'eforge', 'plans', 'test-set'), { recursive: true });
    writeFileSync(join(dir, 'eforge', 'plans', 'test-set', 'orchestration.yaml'), 'planSet: test-set\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'add plan'], { cwd: dir });

    const refs = await collectBuildArtifactProvenance(dir, {
      planSetName: 'test-set',
      outputDir: 'eforge/plans',
    });

    const orchRef = refs.find((r) => r.kind === 'orchestration');
    expect(orchRef).toBeDefined();
    expect(orchRef!.webUrl).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// collectBuildArtifactProvenance — path ordering and artifact discovery
// ---------------------------------------------------------------------------

describe('collectBuildArtifactProvenance — path ordering', () => {
  const makeTempDir = useTempDir('eforge-provenance-order-');

  it('returns refs in order: prd, orchestration, plan files sorted by path', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);

    // Commit PRD + plan files in a single commit
    mkdirSync(join(dir, 'eforge', 'prds'), { recursive: true });
    writeFileSync(join(dir, 'eforge', 'prds', 'demo.md'), '# PRD\n');
    mkdirSync(join(dir, 'eforge', 'plans', 'test-set'), { recursive: true });
    writeFileSync(join(dir, 'eforge', 'plans', 'test-set', 'orchestration.yaml'), 'planSet: test-set\n');
    writeFileSync(join(dir, 'eforge', 'plans', 'test-set', 'plan-02.md'), '# Plan 02\n');
    writeFileSync(join(dir, 'eforge', 'plans', 'test-set', 'plan-01.md'), '# Plan 01\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'add all artifacts'], { cwd: dir });

    const refs = await collectBuildArtifactProvenance(dir, {
      planSetName: 'test-set',
      outputDir: 'eforge/plans',
      prdArtifactPath: 'eforge/prds/demo.md',
    });

    expect(refs).toHaveLength(4);
    expect(refs[0].kind).toBe('prd');
    expect(refs[1].kind).toBe('orchestration');
    expect(refs[1].path).toContain('orchestration.yaml');
    expect(refs[2].kind).toBe('plan');
    expect(refs[2].path).toContain('plan-01.md');
    expect(refs[3].kind).toBe('plan');
    expect(refs[3].path).toContain('plan-02.md');
  });

  it('includes orchestration.yaml and .md plan files, excludes other file types', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);

    mkdirSync(join(dir, 'eforge', 'plans', 'test-set'), { recursive: true });
    writeFileSync(join(dir, 'eforge', 'plans', 'test-set', 'orchestration.yaml'), 'planSet: test-set\n');
    writeFileSync(join(dir, 'eforge', 'plans', 'test-set', 'plan-01.md'), '# Plan\n');
    // This JSON file should be excluded
    writeFileSync(join(dir, 'eforge', 'plans', 'test-set', 'data.json'), '{}');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'add plan files'], { cwd: dir });

    const refs = await collectBuildArtifactProvenance(dir, {
      planSetName: 'test-set',
      outputDir: 'eforge/plans',
    });

    const kinds = refs.map((r) => r.kind);
    expect(kinds).toContain('orchestration');
    expect(kinds).toContain('plan');
    // Should only have orchestration + plan, not the json file
    expect(refs).toHaveLength(2);
  });

  it('returns empty when plan set has no committed artifacts', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);

    const refs = await collectBuildArtifactProvenance(dir, {
      planSetName: 'nonexistent-set',
      outputDir: 'eforge/plans',
    });

    expect(refs).toHaveLength(0);
  });

  it('normalizes non-normalized outputDir (leading ./) and returns repo-relative POSIX paths', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);

    mkdirSync(join(dir, 'eforge', 'plans', 'demo'), { recursive: true });
    writeFileSync(join(dir, 'eforge', 'plans', 'demo', 'orchestration.yaml'), 'name: demo\n');
    writeFileSync(join(dir, 'eforge', 'plans', 'demo', 'plan-01.md'), '# Plan 01\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'add plan files'], { cwd: dir });

    // Use non-normalized outputDir with leading ./
    const refs = await collectBuildArtifactProvenance(dir, {
      planSetName: 'demo',
      outputDir: './eforge/plans',
    });

    // Must find the artifacts despite the non-normalized input
    expect(refs.length).toBeGreaterThanOrEqual(1);
    // All returned paths must be repo-relative POSIX paths (no leading ./)
    for (const ref of refs) {
      expect(ref.path).not.toMatch(/^\.\//);
      expect(ref.path).toMatch(/^eforge\//);
      // gitShowRef must use the normalized repo-relative path
      expect(ref.gitShowRef).toMatch(/^git show [0-9a-f]{40}:eforge\//);
    }
  });

  it('normalizes non-normalized prdArtifactPath (leading ./) and returns repo-relative POSIX path', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);

    mkdirSync(join(dir, 'eforge', 'prds'), { recursive: true });
    mkdirSync(join(dir, 'eforge', 'plans', 'demo'), { recursive: true });
    writeFileSync(join(dir, 'eforge', 'prds', 'demo.md'), '# PRD\n');
    writeFileSync(join(dir, 'eforge', 'plans', 'demo', 'orchestration.yaml'), 'name: demo\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'add artifacts'], { cwd: dir });

    // Use non-normalized prdArtifactPath with leading ./
    const refs = await collectBuildArtifactProvenance(dir, {
      planSetName: 'demo',
      outputDir: 'eforge/plans',
      prdArtifactPath: './eforge/prds/demo.md',
    });

    const prdRef = refs.find((r) => r.kind === 'prd');
    expect(prdRef).toBeDefined();
    // Path must be normalized to repo-relative (no leading ./)
    expect(prdRef!.path).toBe('eforge/prds/demo.md');
    expect(prdRef!.gitShowRef).toBe(`git show ${prdRef!.commitSha}:eforge/prds/demo.md`);
  });

  it('discovers nested markdown artifacts under the plan-set subdirectory', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);

    // Commit a nested markdown artifact under a subdir of the plan-set directory
    mkdirSync(join(dir, 'eforge', 'plans', 'test-set', 'subdir'), { recursive: true });
    writeFileSync(join(dir, 'eforge', 'plans', 'test-set', 'orchestration.yaml'), 'name: test-set\n');
    writeFileSync(join(dir, 'eforge', 'plans', 'test-set', 'plan-01.md'), '# Plan 01\n');
    writeFileSync(join(dir, 'eforge', 'plans', 'test-set', 'subdir', 'plan-02.md'), '# Plan 02\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'add nested artifacts'], { cwd: dir });

    const refs = await collectBuildArtifactProvenance(dir, {
      planSetName: 'test-set',
      outputDir: 'eforge/plans',
    });

    const paths = refs.map((r) => r.path).sort();
    // Nested plan file must be discovered
    expect(paths.some((p) => p.includes('subdir/plan-02.md'))).toBe(true);
    // All paths must be repo-relative POSIX (no leading ./ or backslashes)
    for (const p of paths) {
      expect(p).not.toMatch(/^\.\//);
      expect(p).not.toContain('\\');
    }
  });
});

// ---------------------------------------------------------------------------
// collectBuildArtifactProvenance — best-effort behavior
// ---------------------------------------------------------------------------

describe('collectBuildArtifactProvenance — best-effort behavior', () => {
  const makeTempDir = useTempDir('eforge-provenance-best-effort-');

  it('omits prd row when prdArtifactPath has no commits (not added)', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);

    mkdirSync(join(dir, 'eforge', 'plans', 'test-set'), { recursive: true });
    writeFileSync(join(dir, 'eforge', 'plans', 'test-set', 'orchestration.yaml'), 'planSet: test-set\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'add plan files'], { cwd: dir });

    const refs = await collectBuildArtifactProvenance(dir, {
      planSetName: 'test-set',
      outputDir: 'eforge/plans',
      prdArtifactPath: 'eforge/prds/nonexistent.md', // never committed
    });

    // Should still have orchestration row but no prd row
    expect(refs.some((r) => r.kind === 'prd')).toBe(false);
    expect(refs.some((r) => r.kind === 'orchestration')).toBe(true);
  });

  it('does not throw when the cwd is not a git repo', async () => {
    const dir = makeTempDir();
    // Not a git repo — just a plain directory

    const refs = await collectBuildArtifactProvenance(dir, {
      planSetName: 'test-set',
      outputDir: 'eforge/plans',
    });

    expect(refs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// renderProvenanceSection
// ---------------------------------------------------------------------------

describe('renderProvenanceSection', () => {
  it('returns empty string when refs array is empty', () => {
    expect(renderProvenanceSection([])).toBe('');
  });

  it('renders fallback-only row when webUrl is absent', () => {
    const ref: BuildArtifactProvenanceRef = {
      kind: 'orchestration',
      label: 'Orchestration',
      path: 'eforge/plans/demo/orchestration.yaml',
      commitSha: 'abc123def456abc123def456abc123def456abc1',
      gitShowRef: 'git show abc123def456abc123def456abc123def456abc1:eforge/plans/demo/orchestration.yaml',
    };
    const result = renderProvenanceSection([ref]);
    expect(result).toContain('## Eforge provenance');
    expect(result).toContain('Orchestration');
    expect(result).toContain('`git show abc123def456abc123def456abc123def456abc1:eforge/plans/demo/orchestration.yaml`');
    // Must NOT contain a markdown link without a webUrl
    expect(result).not.toMatch(/\[.*\]\(http/);
  });

  it('renders GitHub link row when webUrl is present', () => {
    const sha = 'abc123def456abc123def456abc123def456abc1';
    const ref: BuildArtifactProvenanceRef = {
      kind: 'prd',
      label: 'Normalized PRD',
      path: 'eforge/prds/demo.md',
      commitSha: sha,
      gitShowRef: `git show ${sha}:eforge/prds/demo.md`,
      webUrl: `https://github.com/org/repo/blob/${sha}/eforge/prds/demo.md`,
    };
    const result = renderProvenanceSection([ref]);
    expect(result).toContain('## Eforge provenance');
    expect(result).toContain(`[eforge/prds/demo.md](https://github.com/org/repo/blob/${sha}/eforge/prds/demo.md)`);
    expect(result).toContain(`\`git show ${sha}:eforge/prds/demo.md\``);
  });

  it('does not contain branch names like blob/main or blob/master in artifact links', () => {
    const sha = 'abc123def456abc123def456abc123def456abc1';
    const ref: BuildArtifactProvenanceRef = {
      kind: 'plan',
      label: 'Plan',
      path: 'eforge/plans/demo/plan-01.md',
      commitSha: sha,
      gitShowRef: `git show ${sha}:eforge/plans/demo/plan-01.md`,
      webUrl: `https://github.com/org/repo/blob/${sha}/eforge/plans/demo/plan-01.md`,
    };
    const result = renderProvenanceSection([ref]);
    expect(result).not.toContain('blob/main');
    expect(result).not.toContain('blob/master');
    // The SHA is present in the URL
    expect(result).toContain(sha);
  });

  it('renders the section header followed by each ref row', () => {
    const sha = '0000000000000000000000000000000000000001';
    const refs: BuildArtifactProvenanceRef[] = [
      { kind: 'prd', label: 'Normalized PRD', path: 'eforge/prds/demo.md', commitSha: sha, gitShowRef: `git show ${sha}:eforge/prds/demo.md` },
      { kind: 'orchestration', label: 'Orchestration', path: 'eforge/plans/demo/orchestration.yaml', commitSha: sha, gitShowRef: `git show ${sha}:eforge/plans/demo/orchestration.yaml` },
    ];
    const result = renderProvenanceSection(refs);
    const headerIdx = result.indexOf('## Eforge provenance');
    const prdIdx = result.indexOf('Normalized PRD');
    const orchIdx = result.indexOf('Orchestration');
    expect(headerIdx).toBeLessThan(prdIdx);
    expect(prdIdx).toBeLessThan(orchIdx);
  });
});
