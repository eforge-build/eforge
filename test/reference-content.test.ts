import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readRepoFile = (path: string) => readFileSync(path, 'utf-8');
const readRepoBytes = (path: string) => readFileSync(path);

const markdownSourceFiles = (dir: string) => readdirSync(dir)
  .map((entry) => `${dir}/${entry}`)
  .filter((path) => path.endsWith('.md'));

const publicGuideSourceFiles = () => markdownSourceFiles('web/content/docs');
const publicReferenceSourceFiles = () => markdownSourceFiles('web/content/reference');

const generatedPublicTextFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return generatedPublicTextFiles(path);
    return /\.(?:json|md|txt)$/.test(entry.name) ? [path] : [];
  });

describe('plan-01 reference and raw mirror content', () => {
  it('checks in raw mirror files for extension guide pages', () => {
    for (const mirror of [
      'web/public/docs/extensions.md',
      'web/public/docs/extensions-api.md',
    ] as const) {
      expect(existsSync(mirror)).toBe(true);
    }
  });

  it('generates config reference sections for toolbelts and hooks in both rendered and raw targets', () => {
    for (const path of ['web/content/reference/config.md', 'web/public/reference/config.md']) {
      const raw = readRepoFile(path);
      expect(raw).toContain('## Toolbelts');
      expect(raw).toContain('## Hooks');

      const toolbeltsSection = raw.split('## Toolbelts')[1]?.split('## Hooks')[0] ?? '';
      for (const expected of ['tools.toolbelts', 'toolbelt: none', 'omitted', '.mcp.json', 'Validation']) {
        expect(toolbeltsSection).toContain(expected);
      }

      const hooksSection = raw.split('## Hooks')[1]?.split('## JSON Schema')[0] ?? '';
      for (const expected of ['event', 'command', 'timeout']) {
        expect(hooksSection).toContain(expected);
      }
    }
  });

  it('surfaces extension docs and the full bundle in the LLM manifest', () => {
    const raw = readRepoFile('web/public/llms.txt');
    expect(raw).toContain('/docs/extensions.md');
    expect(raw).toContain('/docs/extensions-api.md');
    expect(raw).toContain('/llms-full.txt');
  });

  it('uses public toolbelt documentation links in profile-new skills', () => {
    for (const path of [
      'eforge-plugin/skills/profile-new/profile-new.md',
      'packages/pi-eforge/skills/eforge-profile-new/SKILL.md',
    ]) {
      const raw = readRepoFile(path);
      expect(raw).toContain('https://eforge.build/docs/configuration#guided-toolbelt-presets');
      expect(raw).toContain('https://eforge.build/reference/config#toolbelts');
    }
  });

  it('does not reference repo-only or stale toolbelt documentation paths from public docs or profile-new skills', () => {
    const forbidden = [
      'web/content/docs/configuration.md',
      'docs/config.md#toolbelts',
      'docs/prd/profile-toolbelts.md',
    ];

    for (const path of [
      'eforge-plugin/skills/profile-new/profile-new.md',
      'packages/pi-eforge/skills/eforge-profile-new/SKILL.md',
      'web/content/docs/configuration.md',
      'web/public/docs/configuration.md',
    ]) {
      const raw = readRepoFile(path);
      for (const staleReference of forbidden) {
        expect(raw).not.toContain(staleReference);
      }
    }
  });

  it('keeps public docs on public references and current queue/approval behavior', () => {
    const forbidden = [
      'docs/hooks.md',
      'until future cascade',
      'future cascade-aware',
      'future release',
    ];

    for (const path of publicGuideSourceFiles()) {
      const raw = readRepoFile(path);
      for (const staleReference of forbidden) {
        expect(raw, `${path} should not contain ${staleReference}`).not.toContain(staleReference);
      }
    }
  });
});

describe('plan-02 public docs regeneration', () => {
  it('keeps every public raw mirror byte-identical to its content source', () => {
    for (const sourcePath of publicGuideSourceFiles()) {
      const mirrorPath = sourcePath.replace('web/content/docs/', 'web/public/docs/');
      expect(readRepoBytes(mirrorPath), `${mirrorPath} should mirror ${sourcePath}`).toEqual(readRepoBytes(sourcePath));
    }

    for (const sourcePath of publicReferenceSourceFiles()) {
      const mirrorPath = sourcePath.replace('web/content/reference/', 'web/public/reference/');
      expect(readRepoBytes(mirrorPath), `${mirrorPath} should mirror ${sourcePath}`).toEqual(readRepoBytes(sourcePath));
    }
  });
});

describe('plan-06 generated reference artifact contracts', () => {
  it('checks in the optional eforge-plan public guide mirror and keeps generated mirrors byte-identical', () => {
    expect(existsSync('web/public/docs/eforge-plan.md')).toBe(true);

    for (const sourcePath of publicGuideSourceFiles()) {
      const mirrorPath = sourcePath.replace('web/content/docs/', 'web/public/docs/');
      expect(readRepoBytes(mirrorPath), `${mirrorPath} should mirror ${sourcePath}`).toEqual(readRepoBytes(sourcePath));
    }

    for (const sourcePath of publicReferenceSourceFiles()) {
      const mirrorPath = sourcePath.replace('web/content/reference/', 'web/public/reference/');
      expect(readRepoBytes(mirrorPath), `${mirrorPath} should mirror ${sourcePath}`).toEqual(readRepoBytes(sourcePath));
    }
  });

  it('exposes queue PRD dispatch failures in generated event reference and schema artifacts', () => {
    for (const path of ['web/content/reference/events.md', 'web/public/reference/events.md']) {
      const raw = readRepoFile(path);
      expect(raw).toContain('dispatchFailure');
      expect(raw).toContain('queue:prd:dispatch-failed');
      expect(raw).toContain('| `queue:prd:dispatch-failed` | `prdId`, `reason`, `stage`, `title` |');
    }

    const schema = readRepoFile('web/public/schemas/events.schema.json');
    expect(schema).toContain('queue:prd:dispatch-failed');
    expect(schema).toContain('dispatchFailure');
    expect(schema).toContain('reason');
    expect(schema).toContain('stage');
  });

  it('omits the removed extension trust field from every generated public artifact and config reference', () => {
    const generatedPaths = [
      ...generatedPublicTextFiles('web/public/docs'),
      ...generatedPublicTextFiles('web/public/reference'),
      ...generatedPublicTextFiles('web/public/schemas'),
      'web/public/llms.txt',
      'web/public/llms-full.txt',
      'web/content/reference/config.md',
    ];

    for (const path of generatedPaths) {
      expect(readRepoFile(path), `${path} should not expose removed trust config`).not.toContain('trustProjectExtensions');
    }
  });

  it('labels playbook and session-plan generated API and tool surfaces as optional workflow or host surfaces', () => {
    for (const path of ['web/content/reference/api.md', 'web/public/reference/api.md']) {
      const raw = readRepoFile(path);
      expect(raw).toContain('Routes whose keys begin with `playbook`, `sessionPlan`, or `sessionPlanSet`');
      expect(raw).toMatch(/optional workflow compatibility and producer surfaces/i);
      expect(raw).toContain('not kernel-owned planning capabilities');
    }

    for (const path of ['web/content/reference/tools.md', 'web/public/reference/tools.md']) {
      const raw = readRepoFile(path);
      expect(raw).toContain('Playbook and session-plan host tools');
      expect(raw).toMatch(/optional workflow compatibility or host surfaces/i);
      expect(raw).toContain('not kernel-owned planning capabilities');
    }
  });

  it('keeps generated LLM artifacts aligned to kernel, optional workflow, extension, and eforge-plan boundaries', () => {
    const llms = readRepoFile('web/public/llms.txt');
    expect(llms).toContain('## Core kernel guides');
    expect(llms).toContain('## Optional workflow guides');
    expect(llms).toContain('## Extension platform guides');
    expect(llms).toContain('## Optional first-party extension guides');
    expect(llms).toContain('/docs/eforge-plan.md');

    const full = readRepoFile('web/public/llms-full.txt');
    expect(full).toContain('<!-- section: guide:eforge-plan -->');
    expect(full).toContain('<!-- end-section: guide:eforge-plan -->');
    expect(full).toContain('Revise with AI');
    expect(full).toContain('planRevisionTurn');
    expect(full).toContain('backlogCurationDraft');
  });

  it('keeps eforge-plan product terms out of generic generated extension mirrors', () => {
    for (const path of ['web/public/docs/extensions.md', 'web/public/docs/extensions-api.md']) {
      const raw = readRepoFile(path);
      expect(raw).not.toContain('planRevisionTurn');
      expect(raw).not.toContain('backlogCurationDraft');
      expect(raw).not.toContain('Revise with AI');
    }

    const eforgePlan = readRepoFile('web/public/docs/eforge-plan.md');
    expect(eforgePlan).toContain('planRevisionTurn');
    expect(eforgePlan).toContain('backlogCurationDraft');
    expect(eforgePlan).toContain('Revise with AI');
  });
});

describe('plan-02 toolbelt preset docs and skill parity', () => {
  it('public configuration docs contain guided toolbelt preset terms', () => {
    for (const path of ['web/content/docs/configuration.md', 'web/public/docs/configuration.md']) {
      const raw = readRepoFile(path);
      expect(raw).toContain('Guided Toolbelt Presets');
      expect(raw).toContain('browser-ui');
      expect(raw).toContain('docs-research');
      expect(raw).toContain('observability');
      expect(raw).toContain('database-readonly');
    }
  });

  it('profile-new skills contain preset gallery with all required preset names', () => {
    for (const path of [
      'eforge-plugin/skills/profile-new/profile-new.md',
      'packages/pi-eforge/skills/eforge-profile-new/SKILL.md',
    ]) {
      const raw = readRepoFile(path);
      expect(raw).toContain('browser-ui');
      expect(raw).toContain('docs-research');
      expect(raw).toContain('observability');
      expect(raw).toContain('database-readonly');
      expect(raw).toContain('issue-triage');
      expect(raw).toContain('repo-review');
      expect(raw).toContain('api-testing');
      expect(raw).toContain('design-ui');
    }
  });

  it('profile-new skills describe the toolbelt step and least-privilege behavior', () => {
    for (const path of [
      'eforge-plugin/skills/profile-new/profile-new.md',
      'packages/pi-eforge/skills/eforge-profile-new/SKILL.md',
    ]) {
      const raw = readRepoFile(path);
      // Core step presence
      expect(raw).toContain('Step 2b');
      expect(raw).toContain('toolbelt: none');
      expect(raw).toContain('No project MCP access');
      // Omitted-toolbelt guidance (skip / default behavior)
      expect(raw).toContain('Skip / default');
      // Playwright auto-add confirmation snippet
      expect(raw).toContain('@playwright/mcp@latest');
      // Non-browser missing-server behavior: do not create tier references
      expect(raw).toContain('do not create tier');
      // Payload toolbelt fields in the create action
      expect(raw).toContain('toolbelt?:');
      // Hierarchical tools.toolbelts browser-ui YAML example
      expect(raw).toContain('tools:');
      expect(raw).toContain('toolbelts:');
      expect(raw).toContain('browser-ui:');
    }
  });

  it('config skills contain tools.toolbelts YAML example', () => {
    for (const path of [
      'eforge-plugin/skills/config/config.md',
      'packages/pi-eforge/skills/eforge-config/SKILL.md',
    ]) {
      const raw = readRepoFile(path);
      expect(raw).toContain('tools:');
      expect(raw).toContain('toolbelts:');
      expect(raw).toContain('browser-ui:');
      expect(raw).toContain('mcpServers:');
    }
  });

  it('config skills note that /eforge:config lists toolbelts', () => {
    for (const path of [
      'eforge-plugin/skills/config/config.md',
      'packages/pi-eforge/skills/eforge-config/SKILL.md',
    ]) {
      const raw = readRepoFile(path);
      expect(raw).toContain('tools.toolbelts');
      expect(raw).toMatch(/\/eforge:config.*lists|lists.*toolbelts/i);
    }
  });

  it('plugin version is greater than 0.25.12', () => {
    const manifest = JSON.parse(readRepoFile('eforge-plugin/.claude-plugin/plugin.json')) as {
      version: string;
    };
    const [major, minor, patch] = manifest.version.split('.').map(Number);
    const isCurrent = major > 0 || minor > 25 || (minor === 25 && patch > 12);
    expect(isCurrent).toBe(true);
  });

  it('generated config reference mentions guided presets in toolbelts section', () => {
    for (const path of ['web/content/reference/config.md', 'web/public/reference/config.md']) {
      const raw = readRepoFile(path);
      const toolbeltsSection = raw.split('## Toolbelts')[1]?.split('## Hooks')[0] ?? '';
      expect(toolbeltsSection).toContain('browser-ui');
      expect(toolbeltsSection).toContain('toolbelt: none');
      expect(toolbeltsSection).toContain('tools.toolbelts');
      // "omitted toolbelt" passes all project MCP servers
      expect(toolbeltsSection).toMatch(/omitted.*toolbelt|toolbelt.*omitted/i);
    }
  });
});
