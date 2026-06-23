import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('CLI playbook compatibility commands', () => {
  it('delegates eforge playbook run docs-sync --after q-abc to eforge-playbooks:run-playbook with afterQueueId', () => {
    const playbook = read('packages/eforge/src/cli/playbook.ts');
    const helper = read('packages/eforge/src/cli/playbook-contributions.ts');

    expect(playbook).toContain(".command('run <name>')");
    expect(playbook).toContain(".command('play <name>')");
    expect(playbook).toContain(".option('--after <queue-id>'");
    expect(playbook).toContain('afterQueueId: options.after');
    expect(playbook).toContain("invokeAndRender('run'");
    expect(helper).toContain("run: 'eforge-playbooks:run-playbook'");
    expect(helper).toMatch(/kind:\s*['"]command['"]/);
    expect(helper).toContain("host: 'cli'");
  });
});
