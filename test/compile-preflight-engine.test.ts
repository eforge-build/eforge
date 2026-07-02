import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import type { EforgeEvent } from '@eforge-build/engine/events';
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



function generatedPrd(): string {
  const rows = Array.from({ length: 1200 }, (_, i) => `  { "path": "packages/engine/src/${i}.ts", "name": "${i === 200 ? sentinel : `entry-${i}`}" }`).join(',\n');
  return ['# Generated Source', '', '## Generated Inventory', '', '```json inventory/generated.json', '[', rows, ']', '```', '', 'Touch packages/engine and packages/client.', '', '## Acceptance Criteria', '', '- Planning artifacts are written.'].join('\n');
}


function smallPrd(): string {
  return ['# Small Compile', '', 'Full detail remains visible.', '', '## Acceptance Criteria', '', '- The full acceptance criterion text remains in prompts.'].join('\n');
}

describe('compile preflight engine plumbing', () => {
  it('emits planning:preflight before any agent and compacts compiler prompts', async () => {
    const cwd = await setupProject();
    const harness = new StubHarness([{ text: 'no submission' }, { text: 'no submission' }]);
    const engine = await EforgeEngine.create({ cwd, agentRuntimes: harness });

    const events = await collect(engine.compile(generatedPrd(), { name: 'preflight-generated' }));
    const preflightIndex = events.findIndex((e) => e.type === 'planning:preflight');
    const firstAgentStartIndex = events.findIndex((e) => e.type === 'agent:start');
    expect(preflightIndex).toBeGreaterThanOrEqual(0);
    expect(firstAgentStartIndex).toBeGreaterThan(preflightIndex);
    const preflight = events[preflightIndex] as Extract<EforgeEvent, { type: 'planning:preflight' }>;
    expect(preflight.risk.generatedInventory.blockCount).toBeGreaterThan(0);
    expect(preflight.risk.generatedInventory.omittedBytes).toBeGreaterThan(0);
    expect(preflight.risk.generatedInventory.contentHashes.length).toBeGreaterThan(0);

    // The compacted prompt source feeds the bounded compiler: no agent prompt
    // carries the raw generated inventory rows.
    expect(harness.prompts.length).toBeGreaterThan(0);
    for (const prompt of harness.prompts) {
      expect(prompt).not.toContain(sentinel);
    }
  });

  it('keeps small PRD prompt detail unchanged', async () => {
    const cwd = await setupProject();
    const harness = new StubHarness([{ text: 'no submission' }, { text: 'no submission' }]);
    const engine = await EforgeEngine.create({ cwd, agentRuntimes: harness });
    await collect(engine.compile(smallPrd(), { name: 'preflight-small' }));
    expect(harness.prompts.some((prompt) => prompt.includes('The full acceptance criterion text remains in prompts.'))).toBe(true);
    for (const prompt of harness.prompts) {
      expect(prompt).not.toContain('Compile Preflight Advisory');
    }
  });

  it('continues stripping hidden acceptance inventory blocks from prompts', async () => {
    const cwd = await setupProject();
    const hidden = '<!-- eforge:acceptance-criteria-inventory\n{"version":1,"criteria":[]}\neforge:end-acceptance-criteria-inventory -->';
    const harness = new StubHarness([{ text: 'no submission' }, { text: 'no submission' }]);
    const engine = await EforgeEngine.create({ cwd, agentRuntimes: harness });
    await collect(engine.compile(`${smallPrd()}\n\n${hidden}`, { name: 'preflight-hidden-inventory' }));
    expect(harness.prompts.length).toBeGreaterThan(0);
    for (const prompt of harness.prompts) {
      expect(prompt).not.toContain('eforge:acceptance-criteria-inventory');
    }
  });
});
