import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import type { EforgeEvent } from '@eforge-build/engine/events';
import type { PlanSetSubmission } from '@eforge-build/engine/schemas';
import { StubHarness } from './stub-harness.js';
import { useTempDir } from './test-tmpdir.js';

const makeTempDir = useTempDir('eforge-compile-preflight-engine-');
const sentinel = 'RAW_ENGINE_GENERATED_SENTINEL_67890';

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

async function collect(gen: AsyncGenerator<EforgeEvent>): Promise<EforgeEvent[]> {
  const events: EforgeEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

function composer(scope: 'errand' | 'excursion' | 'expedition' = 'excursion'): string {
  return JSON.stringify({
    scope,
    compile: ['planner'],
    defaultBuild: ['implement', 'review-cycle'],
    defaultReview: { strategy: 'auto', perspectives: ['code', 'test'], maxRounds: 1, evaluatorStrictness: 'standard' },
    rationale: 'test pipeline',
  });
}

function planPayload(): PlanSetSubmission {
  return {
    description: 'test plan set',
    plans: [{ frontmatter: { id: 'plan-01-test', name: 'Test Plan' }, body: '# Test Plan\n\n## Implementation\n\nDo it.' }],
    orchestration: { validate: [], plans: [{ id: 'plan-01-test', dependsOn: [] }] },
  };
}

function generatedPrd(): string {
  const rows = Array.from({ length: 1200 }, (_, i) => `  { "path": "packages/engine/src/${i}.ts", "name": "${i === 200 ? sentinel : `entry-${i}`}" }`).join(',\n');
  return ['# Generated Source', '', '## Generated Inventory', '', '```json inventory/generated.json', '[', rows, ']', '```', '', 'Touch packages/engine, packages/client, packages/monitor, packages/console-ui, eforge-plugin, and packages/pi-eforge.', '', '## Acceptance Criteria', '', '- Planning artifacts are written.'].join('\n');
}

function overflowGeneratedPrd(): string {
  return `${generatedPrd()}\n\n## Additional Ordinary Scope\n\n${'Large human-authored scope detail. '.repeat(3_000)}`;
}

function smallPrd(): string {
  return ['# Small Compile', '', 'Full detail remains visible.', '', '## Acceptance Criteria', '', '- The full acceptance criterion text remains in prompts.'].join('\n');
}

describe('compile preflight engine plumbing', () => {
  it('emits planning:preflight before composer and compacts composer/planner prompts', async () => {
    const cwd = await setupProject();
    const harness = new StubHarness([
      { resultText: composer('excursion') },
      { toolCalls: [{ tool: 'submit_plan_set', toolUseId: 'tool-1', input: planPayload(), output: '' }], text: 'submitted' },
    ]);
    const engine = await EforgeEngine.create({ cwd, agentRuntimes: harness });

    const events = await collect(engine.compile(generatedPrd(), { name: 'preflight-generated' }));
    const preflightIndex = events.findIndex((e) => e.type === 'planning:preflight');
    const composerStartIndex = events.findIndex((e) => e.type === 'agent:start' && e.agent === 'pipeline-composer');
    expect(preflightIndex).toBeGreaterThanOrEqual(0);
    expect(composerStartIndex).toBeGreaterThan(preflightIndex);
    const preflight = events[preflightIndex] as Extract<EforgeEvent, { type: 'planning:preflight' }>;
    expect(preflight.risk.generatedInventory.blockCount).toBeGreaterThan(0);
    expect(preflight.risk.generatedInventory.omittedBytes).toBeGreaterThan(0);
    expect(preflight.risk.generatedInventory.contentHashes.length).toBeGreaterThan(0);

    expect(harness.prompts[0]).toContain('eforge compile preflight compaction');
    expect(harness.prompts[0]).not.toContain(sentinel);
    expect(harness.prompts[1]).toContain('eforge compile preflight compaction');
    expect(harness.prompts[1]).not.toContain(sentinel);
    expect(harness.prompts[0]).toContain(preflight.risk.generatedInventory.contentHashes[0]);
    expect(harness.prompts[1]).toContain(preflight.risk.generatedInventory.contentHashes[0]);
  });

  it('adds pipeline-scope-enriched preflight appendix to planner prompt', async () => {
    const cwd = await setupProject();
    const harness = new StubHarness([
      { resultText: composer('excursion') },
      { toolCalls: [{ tool: 'submit_plan_set', toolUseId: 'tool-1', input: planPayload(), output: '' }], text: 'submitted' },
    ]);
    const engine = await EforgeEngine.create({ cwd, agentRuntimes: harness });
    await collect(engine.compile(overflowGeneratedPrd(), { name: 'preflight-scope' }));
    expect(harness.prompts[1]).toContain('Compile Preflight Advisory');
    expect(harness.prompts[1]).toMatch(/retry-as-expedition|bounded-decomposition/);
  });

  it('keeps small PRD prompt detail unchanged without advisory', async () => {
    const cwd = await setupProject();
    const harness = new StubHarness([
      { resultText: composer('excursion') },
      { toolCalls: [{ tool: 'submit_plan_set', toolUseId: 'tool-1', input: planPayload(), output: '' }], text: 'submitted' },
    ]);
    const engine = await EforgeEngine.create({ cwd, agentRuntimes: harness });
    await collect(engine.compile(smallPrd(), { name: 'preflight-small' }));
    expect(harness.prompts[0]).toContain('The full acceptance criterion text remains in prompts.');
    expect(harness.prompts[1]).toContain('The full acceptance criterion text remains in prompts.');
    expect(harness.prompts[0]).not.toContain('Compile Preflight Advisory');
    expect(harness.prompts[1]).not.toContain('Compile Preflight Advisory');
  });

  it('continues stripping hidden acceptance inventory blocks from prompts', async () => {
    const cwd = await setupProject();
    const hidden = '<!-- eforge:acceptance-criteria-inventory\n{"version":1,"criteria":[]}\neforge:end-acceptance-criteria-inventory -->';
    const harness = new StubHarness([
      { resultText: composer('excursion') },
      { toolCalls: [{ tool: 'submit_plan_set', toolUseId: 'tool-1', input: planPayload(), output: '' }], text: 'submitted' },
    ]);
    const engine = await EforgeEngine.create({ cwd, agentRuntimes: harness });
    await collect(engine.compile(`${smallPrd()}\n\n${hidden}`, { name: 'preflight-hidden-inventory' }));
    expect(harness.prompts[0]).not.toContain('eforge:acceptance-criteria-inventory');
    expect(harness.prompts[1]).not.toContain('eforge:acceptance-criteria-inventory');
  });
});
