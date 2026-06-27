import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('Pi playbook host surface removal', () => {
  it('deletes Pi playbook command and contribution helper modules', () => {
    expect(existsSync('packages/pi-eforge/extensions/eforge/playbook-commands.ts')).toBe(false);
    expect(existsSync('packages/pi-eforge/extensions/eforge/playbook-contributions.ts')).toBe(false);
  });

  it('does not register the playbook tool or native command from the Pi entrypoint', () => {
    const source = read('packages/pi-eforge/extensions/eforge/index.ts');

    expect(source).not.toContain('eforge_playbook');
    expect(source).not.toContain('eforge:playbook');
    expect(source).not.toContain('playbook-contributions');
    expect(source).not.toContain('playbook-commands');
    expect(source).not.toContain('playbookToolFailure');
  });

  it('keeps generic extension contribution tool and command registration', () => {
    const source = read('packages/pi-eforge/extensions/eforge/index.ts');
    const contributions = read('packages/pi-eforge/extensions/eforge/extension-contributions.ts');

    expect(source).toContain('registerExtensionContributionTool(pi)');
    expect(source).toContain('registerExtensionContributionsCommand(pi, () => _latestCtx)');
    expect(contributions).toContain('eforge_extension_contribution');
    expect(contributions).toContain('eforge:extensions');
  });
});
