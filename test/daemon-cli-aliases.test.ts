import { describe, expect, it } from 'vitest';
import type { Command } from 'commander';
import { createProgram } from '../packages/eforge/src/cli/index.js';

type CommandWithActionHandler = Command & { _actionHandler?: unknown };

function commandNamed(parent: Command, name: string): Command {
  const command = parent.commands.find((candidate) => candidate.name() === name);
  expect(command, `expected command ${name}`).toBeDefined();
  return command as Command;
}

function optionSignatures(command: Command): string[] {
  return command.options.map((option) => option.flags);
}

function actionHandler(command: Command): unknown {
  return (command as CommandWithActionHandler)._actionHandler;
}

describe('daemon lifecycle CLI aliases', () => {
  it('registers playful top-level daemon lifecycle aliases without a kill alias', () => {
    const program = createProgram(undefined, 'test');
    const topLevelNames = program.commands.map((command) => command.name());

    expect(topLevelNames).toContain('ignite');
    expect(topLevelNames).toContain('reignite');
    expect(topLevelNames).toContain('douse');
    expect(topLevelNames).not.toContain('kill');
  });

  it('describes aliases in top-level help with their canonical daemon commands', () => {
    const program = createProgram(undefined, 'test');
    const help = program.helpInformation();

    expect(help).toContain('ignite');
    expect(help).toContain('eforge daemon start');
    expect(help).toContain('douse');
    expect(help).toContain('eforge daemon stop');
    expect(help).toContain('reignite');
    expect(help).toContain('eforge daemon restart');
  });

  it('keeps the explicit daemon lifecycle command surface', () => {
    const program = createProgram(undefined, 'test');
    const daemon = commandNamed(program, 'daemon');
    const help = daemon.helpInformation();

    for (const name of ['start', 'stop', 'restart', 'status', 'kill']) {
      expect(daemon.commands.map((command) => command.name())).toContain(name);
      expect(help).toContain(name);
    }
  });

  it('matches daemon lifecycle alias options and handler identities', () => {
    const program = createProgram(undefined, 'test');
    const daemon = commandNamed(program, 'daemon');

    const start = commandNamed(daemon, 'start');
    const stop = commandNamed(daemon, 'stop');
    const restart = commandNamed(daemon, 'restart');
    const ignite = commandNamed(program, 'ignite');
    const douse = commandNamed(program, 'douse');
    const reignite = commandNamed(program, 'reignite');

    expect(optionSignatures(ignite)).toEqual(optionSignatures(start));
    expect(optionSignatures(ignite)).toContain('--port <port>');
    expect(optionSignatures(douse)).toEqual(optionSignatures(stop));
    expect(optionSignatures(douse)).toContain('--force');
    expect(optionSignatures(reignite)).toEqual(optionSignatures(restart));
    expect(optionSignatures(reignite)).toContain('--force');

    expect(actionHandler(ignite)).toBe(actionHandler(start));
    expect(actionHandler(douse)).toBe(actionHandler(stop));
    expect(actionHandler(reignite)).toBe(actionHandler(restart));
  });
});
