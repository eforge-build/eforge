import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import { DEFAULT_CONFIG } from '@eforge-build/engine/config';
import { appendAcceptanceCriteriaInventoryBlock, type CanonicalAcceptanceCriteriaInventory } from '@eforge-build/engine/validation/acceptance-criteria-inventory';
import { loadArtifactRegistry, upsertArtifact } from '@eforge-build/engine/artifacts';
import { loadStackState, upsertStackLayer } from '@eforge-build/engine/stacking';
import { resolvePlanningDecompositionLimits } from '@eforge-build/engine/config';
import { atomSubmission, completedOutput, completedReduceOutput, expectedTasks, reduceSubmission, unsatisfiedGateSubmission } from './planning-compiler-fixtures.js';
import { StubHarness, type StubResponse } from './stub-harness.js';
import { useTempDir } from './test-tmpdir.js';
import type { AgentHarness, AgentRunOptions } from '@eforge-build/engine/harness';
import type { AgentRole, EforgeEvent } from '@eforge-build/engine/events';

const makeTempDir = useTempDir('eforge-stacked-validation-lifecycle-');

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commit(cwd: string, path: string, content: string, message: string): string {
  writeFileSync(join(cwd, path), content);
  git(cwd, 'add', path);
  git(cwd, 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

function setupRepository(cwd: string): string {
  git(cwd, 'init', '-b', 'main');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'Test User');
  commit(cwd, 'README.md', 'root\n', 'root');
  const remote = join(cwd, 'remote.git');
  execFileSync('git', ['init', '--bare', remote]);
  git(cwd, 'remote', 'add', 'origin', remote);
  git(cwd, 'push', '-u', 'origin', 'main');
  git(cwd, 'switch', '-c', 'eforge/parent');
  const parentSha = commit(cwd, 'parent.txt', 'parent artifact\n', 'parent artifact');
  git(cwd, 'push', '-u', 'origin', 'eforge/parent');
  git(cwd, 'switch', 'main');
  return parentSha;
}

function installGitSpice(cwd: string): string {
  const command = join(cwd, 'git-spice');
  writeFileSync(command, `#!/bin/sh
set -e
case "$1 $2" in
  "--version ") echo "git-spice test" ;;
  "repo sync") git fetch origin --prune ;;
  "branch onto") git rebase "$3" "$5" ;;
  "branch restack") git rebase main ;;
  "branch submit") echo "Created PR https://github.com/owner/repo/pull/42" ;;
  *) : ;;
esac
`);
  chmodSync(command, 0o755);
  return command;
}

class RoleAwareHarness implements AgentHarness {
  readonly prompts: string[] = [];
  private validatorCalls = 0;
  readonly validationDiffs: string[] = [];
  readonly childBases: string[] = [];
  compileMetadata = ''; 

  constructor(private readonly root: string, private readonly parentSha: string, private readonly plannerResponse: StubResponse, private readonly reducerResponse: StubResponse) {}

  effectiveCustomToolName(name: string): string { return name; }

  async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
    this.prompts.push(options.prompt);
    if (agent === 'builder') this.commitChildChange(options.cwd, planId);
    if (agent === 'gap-closer') this.landAndDeleteParent();
    if (agent === 'prd-validator') this.recordDiff(options);
    const response = this.responseFor(options, agent);
    yield* new StubHarness([response]).run(options, agent, planId);
  }

  private responseFor(options: AgentRunOptions, agent: AgentRole): StubResponse {
    if (agent === 'planner') {
      if (options.prompt.includes('submit_satisfaction_assessment')) return unsatisfiedGateSubmission();
      return options.prompt.includes('submit_reduce_output') ? this.reducerResponse : this.plannerResponse;
    }
    if (agent === 'prd-validator' && options.stage === 'acceptance-unknown-resolver') {
      return { text: JSON.stringify({ verdicts: [{ criterion: 'ac-001', verdict: 'pass', evidence: { type: 'file', path: 'child.txt', excerpt: 'gap closed' } }] }) };
    }
    if (agent === 'prd-validator') {
      this.validatorCalls++;
      return this.validatorCalls === 1
        ? { text: JSON.stringify({ gaps: [{ requirement: 'Child behavior', explanation: 'gap remains', complexity: 'moderate' }], completionPercent: 80 }) }
        : { text: JSON.stringify({ gaps: [], completionPercent: 100, acceptanceVerdicts: [{ criterion: 'ac-001', verdict: 'unknown', evidence: 'Needs final evidence.' }] }) };
    }
    if (agent === 'gap-closer') return { text: '# Close the child behavior gap\n' };
    return { text: '<review-issues></review-issues>' };
  }

  private commitChildChange(cwd: string, planId: string | undefined): void {
    const content = planId === 'gap-close' ? 'child implementation\ngap closed\n' : 'child implementation\n';
    if (planId !== 'gap-close') {
      this.childBases.push(git(cwd, 'merge-base', 'HEAD', this.parentSha));
      this.compileMetadata = readFileSync(join(cwd, 'eforge', 'plans', 'child', 'orchestration.yaml'), 'utf8');
    }
    writeFileSync(join(cwd, 'child.txt'), content);
    git(cwd, 'add', 'child.txt');
    git(cwd, 'commit', '-m', planId === 'gap-close' ? 'close child gap' : 'implement child');
  }

  private recordDiff(options: AgentRunOptions): void {
    const marker = '## Implementation Diff';
    const start = options.prompt.indexOf(marker);
    if (start >= 0) this.validationDiffs.push(options.prompt.slice(start));
    else if (options.stage === 'acceptance-unknown-resolver') this.validationDiffs.push(options.prompt);
  }

  private landAndDeleteParent(): void {
    git(this.root, 'merge', '--ff-only', 'eforge/parent');
    commit(this.root, 'unrelated.txt', 'unrelated trunk advancement\n', 'advance trunk');
    git(this.root, 'push', 'origin', 'main');
    git(this.root, 'branch', '-D', 'eforge/parent');
    git(this.root, 'push', 'origin', '--delete', 'eforge/parent');
  }
}

async function collect(events: AsyncGenerator<EforgeEvent>): Promise<EforgeEvent[]> {
  const result: EforgeEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

describe('stacked queued validation lifecycle', () => {
  it('pins child validation to its parent through gap closure and repairs landing after parent deletion', async () => {
    const cwd = makeTempDir();
    const parentSha = setupRepository(cwd);
    const now = new Date().toISOString();
    await upsertArtifact(cwd, { prdId: 'parent', artifactBranch: 'eforge/parent', commitSha: parentSha, resolvedBase: 'main', landingAction: 'pr', status: 'built', recordedAt: now, updatedAt: now });
    await upsertStackLayer(cwd, { prdId: 'parent', stackId: 'stack', provider: 'git-spice', branch: 'eforge/parent', artifact: { branch: 'eforge/parent', commitSha: parentSha }, status: 'built', recordedAt: now, updatedAt: now });
    // The branch can advance after recording; children must still use the
    // immutable recorded artifact SHA.
    git(cwd, 'switch', 'eforge/parent');
    commit(cwd, 'unrecorded-parent.txt', 'unrecorded parent advancement\n', 'advance parent after recording');
    git(cwd, 'switch', 'main');

    const body = '# Child\n\n## Acceptance Criteria\n\n- Child behavior is implemented.\n';
    const inventory: CanonicalAcceptanceCriteriaInventory = { version: 1, criteria: [{ id: 'ac-001', text: 'Child behavior is implemented.', raw: 'Child behavior is implemented.', sourceQuote: 'Child behavior is implemented.', confidence: 1 }] };
    const content = `---\ntitle: child\nstack_id: stack\nstack_parent: parent\nstack_provider: git-spice\nlanding: pr\n---\n\n${appendAcceptanceCriteriaInventoryBlock(body, inventory)}`;
    const queuePath = join(cwd, '.eforge', 'queue', 'child.md');
    mkdirSync(join(cwd, '.eforge', 'queue'), { recursive: true });
    writeFileSync(queuePath, content, 'utf8');
    const task = expectedTasks(body, resolvePlanningDecompositionLimits(DEFAULT_CONFIG))[0]!;
    const atomOutput = completedOutput(task);
    const harness = new RoleAwareHarness(cwd, parentSha, atomSubmission(atomOutput), reduceSubmission(completedReduceOutput(atomOutput)));
    const engine = await EforgeEngine.create({
      cwd,
      agentRuntimes: harness,
      config: {
        stacking: { enabled: true, provider: 'git-spice', gitSpice: { command: installGitSpice(cwd) }, sync: { afterBuild: false } },
        landing: { ...DEFAULT_CONFIG.landing, action: 'pr' },
        build: { ...DEFAULT_CONFIG.build, cleanupPlanFiles: false, validation: { ...DEFAULT_CONFIG.build.validation, allowNoCommands: true, noCommandsReason: 'lifecycle test' } },
      },
    });
    const events = await collect(engine.buildSinglePrd({ id: 'child', filePath: queuePath, frontmatter: { title: 'child', stack_id: 'stack', stack_parent: 'parent', stack_provider: 'git-spice', landing: 'pr' }, content, lastCommitHash: git(cwd, 'rev-parse', 'HEAD'), lastCommitDate: now }, {}, 'stacked-lifecycle'));

    expect(harness.childBases).toEqual([parentSha]);
    expect(harness.compileMetadata).toContain('base_branch: eforge/parent');
    expect(harness.compileMetadata).toContain(`diff_base_ref: ${parentSha}`);
    expect(harness.validationDiffs).toHaveLength(3);
    for (const diff of harness.validationDiffs) {
      expect(diff).toContain('child.txt');
      expect(diff).not.toContain('parent artifact');
      expect(diff).not.toContain('unrecorded parent advancement');
      expect(diff).not.toContain('unrelated trunk advancement');
    }
    const lifecycle = events.filter((event) => ['validation:complete', 'prd_validation:complete', 'gap_close:complete', 'acceptance_validation:complete', 'stack:landing:update'].includes(event.type)).map((event) => event.type);
    expect(lifecycle).toEqual(['validation:complete', 'prd_validation:complete', 'gap_close:complete', 'acceptance_validation:complete', 'validation:complete', 'prd_validation:complete', 'acceptance_validation:complete', 'stack:landing:update', 'stack:landing:update']);
    expect(events).toContainEqual(expect.objectContaining({ type: 'stack:landing:update', status: 'complete', originalBaseBranch: 'eforge/parent', effectiveBaseBranch: 'main', baseRepairReason: 'parent-artifact-already-integrated' }));
    const childArtifact = (await loadArtifactRegistry(cwd)).builds.find((artifact) => artifact.prdId === 'child');
    expect(childArtifact).toMatchObject({ resolvedBase: 'eforge/parent', status: 'built' });
    const childLayer = (await loadStackState(cwd)).layers.find((layer) => layer.prdId === 'child');
    expect(childLayer?.landing).toMatchObject({ originalBaseBranch: 'eforge/parent', effectiveBaseBranch: 'main', baseRepairReason: 'parent-artifact-already-integrated' });
  }, 30_000);
});
