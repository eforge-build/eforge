import { readFileSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

const rootExtensionDocs = ['docs/extensions.md', 'docs/extensions-api.md'];
const webExtensionDocs = ['web/content/docs/extensions.md', 'web/content/docs/extensions-api.md'];
const authoringDocs = [
  ...rootExtensionDocs,
  ...webExtensionDocs,
  'packages/extension-sdk/README.md',
  'examples/extensions/README.md',
];
function expectAllContain(paths: string[], snippets: string[]): void {
  for (const path of paths) {
    const contents = read(path);
    for (const snippet of snippets) {
      expect(contents, `${path} should contain ${snippet}`).toContain(snippet);
    }
  }
}

describe('extension platform docs and examples', () => {
  it('documents the shipped action, Console contribution, command, and deep-link registration families', () => {
    expectAllContain(authoringDocs, [
      'registerAction',
      'registerConsoleContribution',
      'registerIntegrationCommand',
      'registerDeepLink',
    ]);

    expectAllContain([...rootExtensionDocs, ...webExtensionDocs], [
      'input-source fetching',
      'PRD enrichment',
      'reviewer perspectives',
      'validation providers',
      'profile routers',
      'policy gates',
      'event hooks',
      'agent context/tool injection',
    ]);
  });

  it('documents daemon/client and Console renderer boundaries without teaching raw route ownership', () => {
    expectAllContain(['docs/extensions.md', 'web/content/docs/extensions.md', 'web/content/docs/integrations.md'], [
      'fetchExtensionContributionManifest',
      'invokeExtensionAction',
    ]);

    expectAllContain(['docs/extensions.md', 'web/content/docs/extensions.md', ...rootExtensionDocs, ...webExtensionDocs], [
      'text',
      'markdown',
      'status-badge',
      'link',
      'action-button',
      'action-form',
      '/console/system',
    ]);

    for (const path of [...rootExtensionDocs, ...webExtensionDocs, 'packages/extension-sdk/README.md']) {
      const contents = read(path);
      expect(contents, `${path} should not present raw extension-owned HTTP routes as shipped`).not.toMatch(
        /register(?:Raw)?HttpRoute|extension-owned HTTP route registration is supported|raw extension-owned HTTP routes are supported/i,
      );
    }
  });

  it('documents concrete host contribution discovery and invocation surfaces', () => {
    const integrations = read('web/content/docs/integrations.md');
    for (const snippet of [
      'eforge extension contributions list',
      'eforge extension contributions invoke',
      'eforge_extension_contribution',
      'mcp__eforge__eforge_extension_contribution',
      '/eforge:extensions',
    ]) {
      expect(integrations, `integrations should mention ${snippet}`).toContain(snippet);
    }
  });

  it('documents action validation, JSON-safe outputs, timeouts, and private lifecycle events', () => {
    for (const path of [...rootExtensionDocs, ...webExtensionDocs, 'packages/extension-sdk/README.md']) {
      const contents = read(path);
      expect(contents, `${path} should require object-root TypeBox input schemas`).toMatch(/(?:object-root TypeBox input schemas?|TypeBox object-root schemas?)/i);
      expect(contents, `${path} should require JSON-safe outputs`).toMatch(/(?:outputs?[^.\n]*JSON-safe|JSON-safe outputs?)/i);
      expect(contents, `${path} should state optional output schemas are enforced`).toMatch(/output schemas?[^.\n]*(?:enforced|validated|validates|enforces)|(?:enforced|validated|validates|enforces)[^.\n]*(?:returned )?outputs?/i);
      expect(contents, `${path} should document eventHookTimeoutMs reuse`).toContain('extensions.eventHookTimeoutMs');
      expect(contents, `${path} should omit raw payloads from action events`).toMatch(/without raw input (?:payloads? )?(?:or|and) (?:raw )?output payloads|omit raw input (?:payloads? )?(?:and|or) (?:raw )?output payloads/i);
      expect(contents, `${path} should warn that extensions are trusted unsandboxed Node code`).toMatch(/trusted unsandboxed Node code|not sandboxed|same Node process/i);
    }

    for (const path of [...rootExtensionDocs, ...webExtensionDocs]) {
      expect(read(path), `${path} should mention action lifecycle diagnostics`).toMatch(/extension:action:\*/i);
    }
  });

  it('documents extension action timeout reuse without implying a new timeout field', () => {
    for (const path of ['docs/config.md', 'web/content/docs/configuration.md']) {
      const contents = read(path);
      expect(contents, `${path} should scope action handlers to eventHookTimeoutMs`).toMatch(
        /(?:extension )?action(?: handlers?| invocations?| invocation)?[^.\n]*extensions\.eventHookTimeoutMs|extensions\.eventHookTimeoutMs[^.\n]*(?:extension )?action(?: handlers?| invocations?| invocation)?/i,
      );
      for (const scopedTimeout of [
        'agentContextHookTimeoutMs',
        'profileRouterTimeoutMs',
        'policyGateTimeoutMs',
        'validationProviderTimeoutMs',
      ]) {
        expect(contents, `${path} should retain ${scopedTimeout} for its existing runtime family`).toContain(
          scopedTimeout,
        );
      }
      expect(contents, `${path} should not document a separate action timeout field`).not.toMatch(
        /actionHookTimeoutMs|actionHandlerTimeoutMs|actionInvocationTimeoutMs|extensionActionTimeoutMs/i,
      );
    }
  });

  it('keeps deferred extension boundaries explicit', () => {
    for (const path of ['docs/extensions.md', 'web/content/docs/extensions.md']) {
      const contents = read(path);
      for (const expected of [
        /raw extension-owned HTTP routes?[^.\n]*(?:unsupported|deferred|not supported)|(?:unsupported|deferred|not supported)[^.\n]*raw extension-owned HTTP routes?/i,
        /arbitrary Console JavaScript[^.\n]*(?:deferred|unsupported|not supported)|(?:deferred|unsupported|not supported)[^.\n]*arbitrary Console JavaScript/i,
        /React bundles?[^.\n]*(?:deferred|unsupported|not supported)|(?:deferred|unsupported|not supported)[^.\n]*React bundles?/i,
        /independently loaded frontend plugins?[^.\n]*(?:deferred|unsupported|not supported)|(?:deferred|unsupported|not supported)[^.\n]*independently loaded frontend plugins?/i,
        /session-plan extraction[^.\n]*(?:deferred|future|not shipped)|(?:deferred|future|not shipped)[^.\n]*session-plan extraction/i,
        /playbook extraction[^.\n]*(?:deferred|future|not shipped)|(?:deferred|future|not shipped)[^.\n]*playbook extraction/i,
      ]) {
        expect(contents, `${path} should match ${expected}`).toMatch(expected);
      }
    }
  });

  it('keeps the action-contribution example safe and imported by the SDK smoke test', () => {
    const example = read('examples/extensions/action-contribution.ts');
    for (const snippet of [
      'defineExtensionAction',
      'defineConsoleContribution',
      'defineIntegrationCommand',
      'defineExtensionDeepLink',
      'registerAction',
      'registerConsoleContribution',
      'registerIntegrationCommand',
      'registerDeepLink',
      'Type.Object',
      'outputSchema',
    ]) {
      expect(example, `example should contain ${snippet}`).toContain(snippet);
    }
    expect(example).not.toContain('/api/');
    expect(example).not.toContain('fetch(');
    expect(example).not.toMatch(/from ['"]node:fs['"]|from ['"]fs['"]/);

    const smokeTest = read('test/extension-sdk-example.test.ts');
    const exampleFiles = readdirSync('examples/extensions')
      .filter((file) => file.endsWith('.ts'))
      .sort();
    for (const file of exampleFiles) {
      expect(smokeTest, `${basename(file)} should be imported or listed`).toContain(file);
    }
  });

  it('keeps roadmap workflow and frontend extraction work future-focused', () => {
    const roadmap = read('docs/roadmap.md');
    for (const forbidden of [
      /session-plan extraction[^.\n]*(?:shipped|complete|supported)/i,
      /playbook extraction[^.\n]*(?:shipped|complete|supported)/i,
      /arbitrary frontend plugin bundles?[^.\n]*(?:shipped|complete|supported)/i,
    ]) {
      expect(roadmap, `roadmap should not match ${forbidden}`).not.toMatch(forbidden);
    }
    expect(roadmap).toMatch(/session-plan extraction|session plan extraction/i);
    expect(roadmap).toMatch(/playbook extraction/i);
    expect(roadmap).toMatch(/frontend plugin bundles|browser bundles|React bundles/i);
  });

  it('contains generated reference entries for shipped daemon routes, events, CLI commands, and host tools', () => {
    const apiReference = read('web/content/reference/api.md');
    expect(apiReference).toContain('extensionContributionManifest');
    expect(apiReference).toContain('extensionActionInvoke');

    const eventsReference = read('web/content/reference/events.md');
    for (const eventType of [
      'extension:action:start',
      'extension:action:complete',
      'extension:action:failed',
      'extension:action:timeout',
    ]) {
      expect(eventsReference).toContain(eventType);
    }

    const cliReference = read('web/content/reference/cli.md');
    expect(cliReference).toContain('extension contributions list');
    expect(cliReference).toContain('extension contributions invoke');

    const toolsReference = read('web/content/reference/tools.md');
    expect(toolsReference).toMatch(/## MCP tools[\s\S]*eforge_extension_contribution/i);
    expect(toolsReference).toMatch(/## Native tools \(Pi extension\)[\s\S]*eforge_extension_contribution/i);
  });

  it('keeps generated public mirrors in sync for extension-platform guide pages', () => {
    for (const slug of ['extensions', 'extensions-api', 'configuration', 'integrations']) {
      expect(read(`web/public/docs/${slug}.md`), `${slug} public mirror`).toBe(read(`web/content/docs/${slug}.md`));
    }
  });
});
