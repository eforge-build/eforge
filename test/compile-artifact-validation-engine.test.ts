import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import type { EforgeEvent } from '@eforge-build/engine/events';
import { DEFAULT_REVIEW } from '@eforge-build/engine/config';
import { registerCompileStage, type PipelineContext } from '@eforge-build/engine/pipeline';
import { computeWorktreeBase } from '@eforge-build/engine/worktree-ops';
import { validateCompileArtifacts } from '@eforge-build/engine/compile-resilience/artifact-validation';
import { StubHarness } from './stub-harness.js';
import { useTempDir } from './test-tmpdir.js';

const BUILD = ['implement', 'review-cycle'];
const makeTempDir = useTempDir('eforge-artifact-engine-');

registerCompileStage({ name: 'artifact-test-no-orchestration', phase: 'compile', description: 'test', whenToUse: 'test', costHint: 'low', parallelizable: false }, async function* () {
  yield { timestamp: new Date().toISOString(), type: 'planning:complete', plans: [] };
});

registerCompileStage({ name: 'artifact-test-write-valid', phase: 'compile', description: 'test', whenToUse: 'test', costHint: 'low', parallelizable: false }, async function* (ctx) {
  await writeValidPlanSet(ctx);
  yield { timestamp: new Date().toISOString(), type: 'planning:complete', plans: [] };
});

registerCompileStage({ name: 'artifact-test-expedition-missing', phase: 'compile', description: 'test', whenToUse: 'test', costHint: 'low', parallelizable: false }, async function* (ctx) {
  await writeExpeditionIndex(ctx, 'alpha');
  ctx.expeditionModules = [{ id: 'alpha', description: 'Alpha', dependsOn: [] }];
  yield { timestamp: new Date().toISOString(), type: 'expedition:architecture:complete', modules: ctx.expeditionModules };
});

registerCompileStage({ name: 'artifact-test-expedition-empty', phase: 'compile', description: 'test', whenToUse: 'test', costHint: 'low', parallelizable: false }, async function* (ctx) {
  await writeExpeditionIndex(ctx, 'alpha');
  await writeFile(resolve(planDir(ctx), 'modules', 'alpha.md'), '   ');
  ctx.expeditionModules = [{ id: 'alpha', description: 'Alpha', dependsOn: [] }];
  yield { timestamp: new Date().toISOString(), type: 'expedition:architecture:complete', modules: ctx.expeditionModules };
});

describe('engine compile artifact validation', () => {
  it('fails the phase and emits planning:error when a stage writes no orchestration.yaml', async () => {
    const cwd = await setupProject();
    const planSet = 'missing-artifacts';
    const events = await runCompile(cwd, planSet, ['artifact-test-no-orchestration']);

    expect(phaseEnd(events)?.result.status).toBe('failed');
    expect(phaseEnd(events)?.result.summary).toContain('orchestration.yaml');
    expect(events.find((event) => event.type === 'planning:error')).toMatchObject({ reason: phaseEnd(events)?.result.summary });
    expect(gitLog(cwd, planSet)).not.toContain(`plan(${planSet}): initial planning artifacts`);
  });

  it('populates ctx.plans from persisted files before the no-review artifact commit', async () => {
    const cwd = await setupProject();
    const planSet = 'valid-artifacts';
    const events = await runCompile(cwd, planSet, ['artifact-test-write-valid']);

    expect(phaseEnd(events)?.result.status).toBe('completed');
    expect(gitLog(cwd, planSet)).toContain(`plan(${planSet}): initial planning artifacts`);
    expect(existsSync(resolve(computeWorktreeBase(cwd, planSet), '__merge__', 'eforge/plans', planSet, 'plan-01.md'))).toBe(true);
  });

  it('fails expedition compile before completion events when a module file is missing', async () => {
    const cwd = await setupProject();
    const events = await runCompile(cwd, 'expedition-missing', ['planner', 'module-planning', 'compile-expedition'], 'expedition', expeditionResponses());

    expect(phaseEnd(events)?.result.status).toBe('failed');
    expect(phaseEnd(events)?.result.summary).toContain('missing expedition module');
    expect(events.find((event) => event.type === 'expedition:compile:complete')).toBeUndefined();
    expect(events.find((event) => event.type === 'planning:complete')).toBeUndefined();
  });

  it('fails expedition compile before planning:complete when a module file is empty', async () => {
    const cwd = await setupProject();
    const events = await runCompile(cwd, 'expedition-empty', ['planner', 'module-planning', 'artifact-test-expedition-empty', 'compile-expedition'], 'expedition', expeditionResponses());

    expect(phaseEnd(events)?.result.status).toBe('failed');
    expect(phaseEnd(events)?.result.summary).toContain('empty expedition module');
    expect(events.find((event) => event.type === 'planning:complete')).toBeUndefined();
  });

  it('keeps valid small errand compiles successful and parseable', async () => {
    const cwd = await setupProject();
    const planSet = 'valid-small';
    const events = await runCompile(cwd, planSet, ['planner'], 'errand', [{
      toolCalls: [{ tool: 'submit_plan_set', toolUseId: 'tool-1', input: planPayload(), output: '' }],
      text: 'submitted',
    }]);

    expect(phaseEnd(events)?.result.status).toBe('completed');
    expect(events.find((event) => event.type === 'planning:complete')).toBeDefined();
    const mergeCwd = resolve(computeWorktreeBase(cwd, planSet), '__merge__');
    const result = await validateCompileArtifacts({ ...minimalCtx(mergeCwd, planSet), pipeline: pipeline('errand', ['planner']) });
    expect(result.ok).toBe(true);
  });
});

async function setupProject(): Promise<string> {
  const cwd = makeTempDir();
  execFileSync('git', ['init', '-b', 'main'], { cwd });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'chore: initial commit'], { cwd });
  await mkdir(resolve(cwd, 'eforge'), { recursive: true });
  await writeFile(resolve(cwd, 'eforge/config.yaml'), 'plugins:\n  enabled: false\n', 'utf8');
  return cwd;
}

async function runCompile(cwd: string, name: string, stages: string[], scope: 'errand' | 'excursion' | 'expedition' = 'excursion', extraResponses: ConstructorParameters<typeof StubHarness>[0] = []): Promise<EforgeEvent[]> {
  const harness = new StubHarness([{ resultText: JSON.stringify(pipeline(scope, stages)) }, ...extraResponses]);
  const engine = await EforgeEngine.create({ cwd, agentRuntimes: harness });
  const events: EforgeEvent[] = [];
  for await (const event of engine.compile('# Test PRD', { name })) events.push(event);
  return events;
}

function pipeline(scope: 'errand' | 'excursion' | 'expedition', compile: string[]) {
  return { scope, compile, defaultBuild: BUILD, defaultReview: DEFAULT_REVIEW, rationale: 'artifact validation engine test' };
}

function phaseEnd(events: EforgeEvent[]): Extract<EforgeEvent, { type: 'phase:end' }> | undefined {
  return events.find((event): event is Extract<EforgeEvent, { type: 'phase:end' }> => event.type === 'phase:end');
}

function gitLog(cwd: string, planSet: string): string {
  const mergeCwd = resolve(computeWorktreeBase(cwd, planSet), '__merge__');
  if (!existsSync(mergeCwd)) return '';
  return execFileSync('git', ['log', '--oneline', '--decorate=short'], { cwd: mergeCwd, encoding: 'utf8' });
}

async function writeValidPlanSet(ctx: PipelineContext): Promise<void> {
  await mkdir(planDir(ctx), { recursive: true });
  await writeFile(resolve(planDir(ctx), 'orchestration.yaml'), stringifyYaml({
    name: ctx.planSetName,
    description: 'Valid',
    created: '2026-01-01',
    mode: 'errand',
    base_branch: 'main',
    pipeline: ctx.pipeline,
    plans: [{ id: 'plan-01', name: 'Plan 1', depends_on: [], branch: `${ctx.planSetName}/plan-01`, build: BUILD, review: DEFAULT_REVIEW }],
  }));
  await writeFile(resolve(planDir(ctx), 'plan-01.md'), `---\nid: plan-01\nname: Plan 1\nbranch: ${ctx.planSetName}/plan-01\n---\n\n# Body`);
}

async function writeExpeditionIndex(ctx: PipelineContext, id: string): Promise<void> {
  await mkdir(resolve(planDir(ctx), 'modules'), { recursive: true });
  await writeFile(resolve(planDir(ctx), 'index.yaml'), stringifyYaml({
    name: ctx.planSetName,
    description: 'Expedition',
    created: '2026-01-01',
    status: 'draft',
    mode: 'expedition',
    architecture: { status: 'complete' },
    modules: { [id]: { status: 'complete', description: 'Alpha', depends_on: [] } },
  }));
}

function planPayload() {
  return {
    description: 'valid small',
    plans: [{ frontmatter: { id: 'plan-01', name: 'Plan 1' }, body: '# Body' }],
    orchestration: { validate: [], plans: [{ id: 'plan-01', dependsOn: [] }] },
  };
}

function expeditionResponses(): ConstructorParameters<typeof StubHarness>[0] {
  return [
    {
      toolCalls: [{ tool: 'submit_architecture', toolUseId: 'arch-1', input: architecturePayload(), output: '' }],
      text: 'submitted architecture',
    },
    { text: 'module planner completed without writing module file' },
  ];
}

function architecturePayload() {
  return {
    architecture: '# Architecture\n\n## Alpha\n\nOne module.',
    modules: [{ id: 'alpha', description: 'Alpha module', dependsOn: [] }],
    index: {
      name: 'artifact-expedition',
      description: 'Expedition artifact validation',
      mode: 'expedition',
      validate: [],
      modules: { alpha: { description: 'Alpha module', depends_on: [] } },
    },
  };
}

function planDir(ctx: PipelineContext): string {
  return resolve(ctx.cwd, ctx.config.plan.outputDir, ctx.planSetName);
}

function minimalCtx(cwd: string, planSetName: string): PipelineContext {
  return {
    agentRuntimes: {} as PipelineContext['agentRuntimes'],
    config: { plan: { outputDir: 'eforge/plans' } } as PipelineContext['config'],
    pipeline: pipeline('errand', ['planner']),
    tracing: {} as PipelineContext['tracing'],
    cwd,
    planSetName,
    sourceContent: '',
    modelTracker: {} as PipelineContext['modelTracker'],
    plans: [],
    expeditionModules: [],
    moduleBuildConfigs: new Map(),
  };
}
