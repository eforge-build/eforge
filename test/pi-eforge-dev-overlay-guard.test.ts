/**
 * Static guardrails for project-local eforge-dev Pi panel safety.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const EXTENSION_SOURCE = '.pi/extensions/eforge-dev/index.ts';

function readRepoFile(relative: string): string {
  return readFileSync(resolve(REPO_ROOT, relative), 'utf-8');
}

describe('project-local eforge-dev panel guardrails', () => {
  it('does not request floating overlays from the maintainer extension', () => {
    const source = readRepoFile(EXTENSION_SOURCE);

    expect(source).not.toMatch(/overlay:\s*true|overlayOptions/);
  });

  it('sizes the /dev cockpit select list from terminal rows', () => {
    const source = readRepoFile(EXTENSION_SOURCE);
    const block = sliceBetween(source, 'async function showCockpit', 'export default function eforgeDevExtension');

    expect(block).toContain('terminalRows(tui) - COCKPIT_RESERVED_ROWS');
    expect(block).toContain('new SelectList(items, visibleCount');
    expect(block).not.toContain('Math.min(items.length, 10)');
  });

  it('keeps info panel help outside the scrolled content and supports navigation keys', () => {
    const source = readRepoFile(EXTENSION_SOURCE);
    const block = sliceBetween(source, 'class InfoPanel', 'async function showInfo');

    expect(block).toContain('content.slice(this.scrollOffset, visibleEnd)');
    expect(block).toContain('↑↓/PgUp/PgDn/Home/End scroll • esc/enter close');
    expect(block).toContain('renderBorderedLines(out, width, (s: string) => this.theme.fg("accent", s), this.rows())');

    for (const key of ['Key.escape', 'Key.enter', 'Key.up', 'Key.down', 'Key.pageUp', 'Key.pageDown', 'Key.home', 'Key.end']) {
      expect(block).toContain(key);
    }
  });

  it('bounds progress panel rows while preserving the cancel hint', () => {
    const source = readRepoFile(EXTENSION_SOURCE);
    const block = sliceBetween(source, 'class ProgressPanel', 'async function runSteps');

    expect(block).toContain('const stepBudget = Math.max(0, rows - PROGRESS_RESERVED_ROWS)');
    expect(block).toContain('this.theme.fg("dim", "esc/ctrl-c cancel")');
    expect(block).toContain('renderBorderedLines(lines, width, (s: string) => this.theme.fg("accent", s), rows)');
    expect(block).toContain('matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))');
  });

  it('documents the /dev cockpit as a panel, not an overlay', () => {
    const readme = readRepoFile('.pi/extensions/eforge-dev/README.md');
    const commands = extractTextCommandDescriptions(readme);
    const devDescription = commands.get('/dev');

    expect(devDescription, 'README command table should document /dev').toBeDefined();
    expect(devDescription).toMatch(/\bmaintainer cockpit\b/i);
    expect(devDescription).toMatch(/\bpanel\b/i);
    expect(devDescription).not.toMatch(/\boverlay\b/i);
  });
});

function sliceBetween(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function extractTextCommandDescriptions(markdown: string): Map<string, string> {
  const block = markdown.match(/```text\n(?<commands>[\s\S]*?)\n```/)?.groups?.commands;
  expect(block, 'README should include a fenced text command table').toBeDefined();

  const commands = new Map<string, string>();
  for (const line of block!.split('\n')) {
    const match = line.match(/^(?<command>\S+(?:\s+\S+)*)\s{2,}(?<description>\S.*)$/);
    if (!match?.groups) continue;
    commands.set(match.groups.command, match.groups.description.trim());
  }
  return commands;
}
