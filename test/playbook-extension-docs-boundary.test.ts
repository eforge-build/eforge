import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

const sourceDocs = [
  'README.md',
  'docs/architecture.md',
  'docs/config.md',
  'docs/extensions.md',
  'docs/extensions-api.md',
  'docs/releasing.md',
  'web/content/docs/playbooks.md',
  'web/content/docs/extensions.md',
  'web/content/docs/extensions-api.md',
  'web/content/docs/configuration.md',
  'web/content/docs/integrations.md',
  'web/content/docs/getting-started.md',
  'web/content/docs/concepts.md',
  'web/content/docs/profiles.md',
  'web/content/docs/glossary.md',
] as const;

const canonicalActions = [
  'eforge-playbooks:list-playbooks',
  'eforge-playbooks:show-playbook',
  'eforge-playbooks:save-playbook',
  'eforge-playbooks:validate-playbook',
  'eforge-playbooks:copy-playbook',
  'eforge-playbooks:promote-playbook',
  'eforge-playbooks:demote-playbook',
  'eforge-playbooks:run-playbook',
] as const;

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

function forbiddenDirectRoute(): string {
  return '/api/' + 'playbook';
}

function routeKeyRows(markdown: string): string[] {
  return markdown.split('\n').filter((line) => /^\|\s*playbook\w*\s*\|/.test(line));
}

describe('playbook extension docs boundary', () => {
  it('describes playbooks as first-party eforge-playbooks extension-owned workflow behavior in source docs', () => {
    for (const path of sourceDocs) {
      const contents = read(path);
      expect(contents, `${path} should name eforge-playbooks`).toContain('eforge-playbooks');
    }

    const playbooksGuide = read('web/content/docs/playbooks.md');
    expect(playbooksGuide).toMatch(/eforge-playbooks[^.\n]*owns playbook management and run behavior/i);
    expect(playbooksGuide).toMatch(/generic extension contribution\/action invocation/i);
    expect(playbooksGuide).toMatch(/extension-unavailable diagnostics/i);
    expect(playbooksGuide).toMatch(/Console playbook management[^.\n]*extension contributions and workstations/i);
    for (const action of canonicalActions) expect(playbooksGuide).toContain(action);
    for (const planningToken of [
      'eforge-plan:open-planning-entry',
      'eforge-plan:planning-workstation',
      '/console/workstations/eforge-plan%3Aplanning-workstation',
      'eforge.plan.planning-mode-playbook',
      '>=1.0.0',
    ]) {
      expect(playbooksGuide).toContain(planningToken);
    }
    expect(playbooksGuide).not.toMatch(/daemon returns/i);
  });

  it('documents generic contribution invocation and host compatibility instead of direct playbook HTTP APIs', () => {
    const integrations = read('web/content/docs/integrations.md');
    expect(integrations).toMatch(/Claude Code MCP.*eforge_playbook|Pi.*eforge_playbook|Playbook commands call `eforge-playbooks:\*`/is);
    expect(integrations).toContain('eforge-playbooks:*');
    expect(integrations).toContain('eforge_extension_contribution');
    expect(integrations).toMatch(/direct playbook-specific (?:daemon )?routes are absent|playbook-specific routes are absent|no playbook-specific routes/i);
    expect(integrations).toContain('invokeExtensionAction');
    expect(integrations).toContain('fetchExtensionContributionManifest');

    for (const path of ['docs/extensions.md', 'web/content/docs/extensions.md']) {
      const contents = read(path);
      expect(contents).toMatch(/first-party[^.\n]*eforge-playbooks|eforge-playbooks[^.\n]*first-party/i);
      expect(contents).toContain('eforge extension contributions invoke');
      expect(contents).toMatch(/user-authored[^.\n]*playbook extraction[^.\n]*(?:unsupported|deferred|not supported)|(?:unsupported|deferred|not supported)[^.\n]*user-authored[^.\n]*playbook extraction/i);
    }
  });

  it('rejects stale bundled-adapter, direct-route, and client-owned playbook documentation language', () => {
    const stalePhrases = [
      'bundled playbook workflow adapter',
      'playbook adapter owns',
      'daemon compatibility service calls that adapter',
      'client-owned HTTP routes',
      'POST ' + forbiddenDirectRoute() + '/copy',
      'api' + 'Playbook',
      'create-from-' + 'playbook',
      'sessionPlanCreateFrom' + 'Playbook',
    ];

    for (const path of sourceDocs) {
      const contents = read(path);
      for (const phrase of stalePhrases) {
        expect(contents, `${path} should not contain ${phrase}`).not.toContain(phrase);
      }
    }
  });

  it('regenerates API reference around generic extension routes and omits playbook route keys', () => {
    for (const path of ['web/content/reference/api.md', 'web/public/reference/api.md']) {
      const apiReference = read(path);
      expect(apiReference).toContain('extensionContributionManifest');
      expect(apiReference).toContain('extensionActionInvoke');
      expect(apiReference).toContain('eforge-playbooks');
      expect(routeKeyRows(apiReference), `${path} should not include playbook route key rows`).toEqual([]);
      expect(apiReference).not.toContain(forbiddenDirectRoute());
      expect(apiReference).not.toContain('sessionPlanCreateFrom' + 'Playbook');
      expect(apiReference).not.toContain('api' + 'Playbook');
    }
  });

  it('regenerates tools and LLM references around eforge-playbooks compatibility facades', () => {
    for (const path of ['web/content/reference/tools.md', 'web/public/reference/tools.md']) {
      const toolsReference = read(path);
      expect(toolsReference).toContain('eforge_playbook');
      expect(toolsReference).toContain('eforge-playbooks');
      expect(toolsReference).toMatch(/copy/i);
      expect(toolsReference).not.toContain('create-from-' + 'playbook');
      expect(toolsReference).not.toContain('playbook_name');
    }

    const llmsFull = read('web/public/llms-full.txt');
    expect(llmsFull).toContain('eforge-playbooks:run-playbook');
    expect(llmsFull).not.toContain(forbiddenDirectRoute());
  });
});
