import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createProgram } from '../packages/eforge/src/cli/index.js';

function commandNames(command: { commands?: Array<{ name(): string; commands?: Array<{ name(): string }> }> } | undefined): string[] {
  return command?.commands?.map((child) => child.name()) ?? [];
}

describe('CLI playbook host surface removal', () => {
  it('does not register top-level playbook compatibility commands', () => {
    const program = createProgram(undefined, 'test');
    expect(commandNames(program)).not.toContain('playbook');
    expect(commandNames(program)).not.toContain('play');
  });

  it('deletes host-local playbook adapter files', () => {
    expect(existsSync('packages/eforge/src/cli/playbook.ts')).toBe(false);
    expect(existsSync('packages/eforge/src/cli/playbook-contributions.ts')).toBe(false);
  });

  it('keeps generic extension contribution commands available', () => {
    const program = createProgram(undefined, 'test');
    const extension = program.commands.find((command) => command.name() === 'extension');
    const contributions = extension?.commands.find((command) => command.name() === 'contributions');

    expect(contributions).toBeDefined();
    expect(commandNames(contributions)).toEqual(expect.arrayContaining(['list', 'show', 'invoke']));
  });
});
