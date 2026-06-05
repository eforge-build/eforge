// --- eforge:region extension-tooling-wiring-runtime-docs ---
/**
 * Split static wiring tests for native extension tooling surfaces.
 */

import { describe, it, expect } from 'vitest';
import { API_ROUTES, EFORGE_EXTENSION_ACTIONS, dispatchEforgeExtensionAction, type EforgeExtensionAction, type EforgeExtensionActionHelpers, type EforgeExtensionActionParams } from '@eforge-build/client';
import { createProgram } from '../packages/eforge/src/cli/index.js';
import { escapeRegExp, readRepoFile } from './extension-tooling-wiring-helpers.js';
describe('native extension event runtime wiring', () => {
  const cliIndexSource = readRepoFile('packages/eforge/src/cli/index.ts');
  const runOrDelegateSource = readRepoFile('packages/eforge/src/cli/run-or-delegate.ts');
  const daemonSource = readRepoFile('packages/monitor/src/server-main.ts');

  function expectCallOrder(block: string, calls: string[]): void {
    const indices = calls.map((call) => {
      const index = block.indexOf(call);
      expect(index, call).toBeGreaterThanOrEqual(0);
      return index;
    });
    for (let i = 1; i < indices.length; i += 1) {
      expect(indices[i - 1], `${calls[i - 1]} before ${calls[i]}`).toBeLessThan(indices[i]);
    }
  }

  it('CLI entrypoint imports and wires native event hooks before monitor recording', () => {
    expect(cliIndexSource).toContain("withNativeEventHooks, type NativeExtensionRegistry");
    expect(cliIndexSource).toContain('withNativeEventHooks(');
    expect(cliIndexSource).toContain('nativeExtensionRegistry');
    expect(cliIndexSource).toContain('eventHookTimeoutMs');
    const wrapBlock = cliIndexSource.slice(cliIndexSource.indexOf('function wrapEvents('), cliIndexSource.indexOf('async function consumeEvents'));
    expectCallOrder(wrapBlock, ['withSessionId(', 'withRunId(', 'withNativeEventHooks(', 'opts.monitor.wrapEvents(', 'withHooks(']);
  });

  it('run-or-delegate imports and wires native event hooks before monitor recording', () => {
    expect(runOrDelegateSource).toContain("withNativeEventHooks, type NativeExtensionRegistry");
    expect(runOrDelegateSource).toContain('withNativeEventHooks(');
    expect(runOrDelegateSource).toContain('nativeExtensionRegistry');
    expect(runOrDelegateSource).toContain('eventHookTimeoutMs');
    const wrapBlock = runOrDelegateSource.slice(runOrDelegateSource.indexOf('function wrapEvents('), runOrDelegateSource.indexOf('async function consumeEvents'));
    expectCallOrder(wrapBlock, ['withSessionId(', 'withRunId(', 'withNativeEventHooks(', 'opts.monitor.wrapEvents(', 'withHooks(']);
  });

  it('daemon watcher imports and wires native event hooks before SQLite recording', () => {
    expect(daemonSource).toContain("withNativeEventHooks, type NativeExtensionRegistry");
    expect(daemonSource).toContain('withNativeEventHooks(');
    expect(daemonSource).toContain('nativeExtensionRegistry');
    expect(daemonSource).toContain('eventHookTimeoutMs');
    const wrapBlock = daemonSource.slice(daemonSource.indexOf('export function wrapWatcherEvents('), daemonSource.indexOf('async function main'));
    expectCallOrder(wrapBlock, ['withNativeEventHooks(', 'withRecording(', 'withHooks(']);
  });

  it('reloads the in-process watcher through the auto-build supervisor', () => {
    const supervisorBlock = daemonSource.slice(
      daemonSource.indexOf('const autoBuildSupervisor = persistent ? new AutoBuildSupervisor({'),
      daemonSource.indexOf('const daemonState: DaemonState'),
    );
    expect(supervisorBlock).toContain('new AutoBuildSupervisor');
    expect(supervisorBlock).toContain('reloadExtensions: reloadExtensionsWatcher');
    expect(supervisorBlock).toContain('restartWatcher: () => restartWatcher(config?.hooks ?? [], { reloadConfig: true })');
    expect(supervisorBlock).not.toContain('cancelWorker');
    expect(supervisorBlock).not.toContain('process.kill');
  });
});

describe('extension runtime documentation', () => {
  const docsExtensions = readRepoFile('docs/extensions.md');
  const docsExtensionsApi = readRepoFile('docs/extensions-api.md');
  const webExtensions = readRepoFile('web/content/docs/extensions.md');
  const webExtensionsApi = readRepoFile('web/content/docs/extensions-api.md');
  const sdkReadme = readRepoFile('packages/extension-sdk/README.md');
  const readme = readRepoFile('README.md');
  const configDocs = readRepoFile('docs/config.md');
  const webConfigDocs = readRepoFile('web/content/docs/configuration.md');
  const examplesReadme = readRepoFile('examples/extensions/README.md');
  const minimalEventLogger = readRepoFile('examples/extensions/minimal-event-logger.ts');
  const slackWebhookNotifier = readRepoFile('examples/extensions/slack-webhook-notifier.ts');
  const protectedPaths = readRepoFile('examples/extensions/protected-paths.ts');
  const agentToolsExample = readRepoFile('examples/extensions/agent-tools.ts');
  const publicConfigSchema = JSON.parse(readRepoFile('web/public/schemas/config.schema.json')) as {
    properties?: { extensions?: { properties?: Record<string, unknown> } };
  };

  it('marks onEvent and onAgentRun runtime execution as supported while other families remain deferred', () => {
    expect(docsExtensions).toContain('| `onEvent` - typed event subscriptions | Yes | Yes | Yes |');
    expect(docsExtensionsApi).toContain('| `onEvent` | Yes | Yes | Yes |');
    expect(sdkReadme).toContain('| `onEvent(pattern, handler)` | Subscribe to typed events (glob patterns) | Yes | Yes |');

    // onAgentRun now supports prompt and per-run tool augmentation.
    for (const source of [docsExtensions, docsExtensionsApi, webExtensions, webExtensionsApi, sdkReadme]) {
      const onAgentRunRow = source.split('\n').find((line) => line.startsWith('| `onAgentRun'));
      expect(onAgentRunRow, 'onAgentRun row').toBeDefined();
      expect(onAgentRunRow).not.toContain('Deferred');
      expect(onAgentRunRow).toContain('Yes');

      const registerToolRow = source.split('\n').find((line) => line.startsWith('|') && line.includes('registerTool'));
      expect(registerToolRow, 'registerTool row').toBeDefined();
      expect(registerToolRow).not.toContain('Deferred');
      expect(registerToolRow).toContain('Provenance');
    }

    for (const source of [docsExtensions, docsExtensionsApi, webExtensions, webExtensionsApi, sdkReadme]) {
      for (const capability of [
        'beforeQueueDispatch',
        'beforePlanMerge',
        'beforeFinalMerge',
      ]) {
        const row = source.split('\n').find((line) => line.startsWith(`| \`${capability}`));
        expect(row, `${capability} support row`).toBeDefined();
        expect(row).not.toContain('Deferred');
        expect(row).toContain('Yes');
      }
    }

    // registerReviewerPerspective: plan-03 shipped the runtime — docs now reflect review-cycle dispatch.
    for (const source of [docsExtensions, docsExtensionsApi, webExtensions, webExtensionsApi, sdkReadme]) {
      const reviewerRow = source.split('\n').find((line) => line.startsWith('|') && line.includes('registerReviewerPerspective'));
      expect(reviewerRow, 'registerReviewerPerspective row').toBeDefined();
      expect(reviewerRow).not.toContain('Deferred');
      expect(reviewerRow).toContain('Yes');
    }

    // registerValidationProvider: plan-02 shipped the runtime — docs now reflect per-plan validate build stage dispatch.
    for (const source of [docsExtensions, docsExtensionsApi, webExtensions, webExtensionsApi, sdkReadme]) {
      const validationRow = source.split('\n').find((line) => line.startsWith('|') && line.includes('registerValidationProvider'));
      expect(validationRow, 'registerValidationProvider row').toBeDefined();
      expect(validationRow).not.toContain('Deferred');
      expect(validationRow).toContain('Yes');
    }

    // registerProfileRouter: plan-02 shipped the runtime — all three sources now reflect pre-build dispatch.
    for (const source of [docsExtensions, docsExtensionsApi, webExtensions, webExtensionsApi, sdkReadme]) {
      const row = source.split('\n').find((line) => line.startsWith('|') && line.includes('registerProfileRouter'));
      expect(row, 'registerProfileRouter row').toBeDefined();
      expect(row).toContain('Yes (pre-build dispatch)');
    }

    // registerInputSource and registerPrdEnricher: plan-01-docs-example-and-skills shipped the runtime.
    for (const source of [docsExtensions, docsExtensionsApi, webExtensions, webExtensionsApi, sdkReadme]) {
      const inputSourceRow = source.split('\n').find((line) => line.startsWith('|') && line.includes('registerInputSource'));
      expect(inputSourceRow, 'registerInputSource row').toBeDefined();
      expect(inputSourceRow).not.toContain('Deferred');
      expect(inputSourceRow).toContain('Yes');

      const prdEnricherRow = source.split('\n').find((line) => line.startsWith('|') && line.includes('registerPrdEnricher'));
      expect(prdEnricherRow, 'registerPrdEnricher row').toBeDefined();
      expect(prdEnricherRow).not.toContain('Deferred');
      expect(prdEnricherRow).toContain('Yes');
    }

    for (const source of [configDocs, webConfigDocs]) {
      expect(source).toContain('pre-build `registerProfileRouter` dispatch');
      expect(source).not.toMatch(/profile routing[^.\n]*(?:deferred|future)|(?:deferred|future)[^.\n]*profile routing/i);
    }
  });

  it('documents action/contribution runtime support, timeout reuse, event privacy, and deferred platform boundaries', () => {
    for (const source of [docsExtensions, docsExtensionsApi, webExtensions, webExtensionsApi, sdkReadme]) {
      for (const method of [
        'registerAction',
        'registerConsoleContribution',
        'registerIntegrationCommand',
        'registerDeepLink',
      ]) {
        const row = source.split('\n').find((line) => line.startsWith('|') && line.includes(method));
        expect(row, `${method} support row`).toBeDefined();
        expect(row).toContain('Yes');
      }
      expect(source).toMatch(/(?:object-root TypeBox input schemas?|TypeBox object-root schemas?)/i);
      expect(source).toMatch(/(?:outputs?[^.\n]*JSON-safe|JSON-safe outputs?)/i);
      expect(source).toMatch(/output schemas?[^.\n]*(?:enforced|validated|validates|enforces)|(?:enforced|validated|validates|enforces)[^.\n]*(?:returned )?outputs?/i);
      expect(source).toMatch(/without raw input (?:payloads? )?(?:or|and) (?:raw )?output payloads|omit raw input (?:payloads? )?(?:and|or) (?:raw )?output payloads/i);
      expect(source).toContain('extensions.eventHookTimeoutMs');
    }

    for (const source of [docsExtensions, webExtensions, configDocs, webConfigDocs]) {
      expect(source).toMatch(/(?:extension )?action(?: handlers?| invocations?| invocation)?[^.\n]*extensions\.eventHookTimeoutMs|extensions\.eventHookTimeoutMs[^.\n]*(?:extension )?action(?: handlers?| invocations?| invocation)?/i);
    }

    for (const source of [docsExtensions, webExtensions, sdkReadme]) {
      expect(source).toMatch(/(?:raw extension-owned HTTP routes?|raw HTTP routes?)[^.\n]*(?:unsupported|deferred|not supported|do not register)|(?:unsupported|deferred|not supported|do not register)[^.\n]*(?:raw extension-owned HTTP routes?|raw HTTP routes?)/i);
      expect(source).toMatch(/arbitrary Console JavaScript[^.\n]*(?:deferred|unsupported|not supported)|(?:deferred|unsupported|not supported)[^.\n]*arbitrary Console JavaScript/i);
      expect(source).toMatch(/React bundles?[^.\n]*(?:deferred|unsupported|not supported)|(?:deferred|unsupported|not supported)[^.\n]*React bundles?/i);
      expect(source).toMatch(/(?:user-authored[^.\n]*session-plan[^.\n]*extraction|session-plan extraction[^.\n]*(?:user-authored )?extensions)[^.\n]*(?:deferred|future|not shipped|unsupported|remain)|(?:deferred|future|not shipped|unsupported|remain)[^.\n]*(?:user-authored[^.\n]*session-plan[^.\n]*extraction|session-plan extraction[^.\n]*(?:user-authored )?extensions)/i);
      expect(source).toMatch(/(?:user-authored[^.\n]*playbook extraction|playbook extraction[^.\n]*(?:user-authored )?extensions)[^.\n]*(?:deferred|future|not shipped|unsupported|remain)|(?:deferred|future|not shipped|unsupported|remain)[^.\n]*(?:user-authored[^.\n]*playbook extraction|playbook extraction[^.\n]*(?:user-authored )?extensions)/i);
    }
  });

  it('keeps generated raw mirrors in sync with the public content docs', () => {
    expect(readRepoFile('web/public/docs/extensions.md')).toBe(webExtensions);
    expect(readRepoFile('web/public/docs/extensions-api.md')).toBe(webExtensionsApi);
    expect(readRepoFile('web/public/docs/configuration.md')).toBe(webConfigDocs);
  });

  it('documents extension management commands and replay workflows', () => {
    expect(docsExtensions).toContain('eforge extension new <name>');
    expect(docsExtensions).toContain('eforge extension test');
    expect(docsExtensions).toContain('--run latest');
    expect(docsExtensions).toContain('eforge extension reload');
    expect(docsExtensions).toContain('local -> `.eforge/extensions/`');
    expect(docsExtensions).toContain('project -> `eforge/extensions/`');
    expect(docsExtensions).toContain('user -> `~/.config/eforge/extensions/`');
    expect(docsExtensions).toContain('$XDG_CONFIG_HOME/eforge/extensions/');
    expect(docsExtensions).not.toContain('Event replay testing is deferred');
  });

  it('documents event hook and policy gate timeout/failure semantics plus example runtime notes', () => {
    for (const source of [configDocs, webConfigDocs, docsExtensions, webExtensions]) {
      expect(source).toContain('agentContextHookTimeoutMs');
      expect(source).toContain('policyGateTimeoutMs');
      expect(source).toContain('policyGateFailurePolicy');
      expect(source).toContain('fail-open');
      expect(source).toContain('fail-closed');
    }
    expect(configDocs).toContain('eventHookTimeoutMs: 5000');
    expect(configDocs).toContain('policyGateTimeoutMs: 5000');
    expect(configDocs).toContain('policyGateFailurePolicy: fail-closed');
    expect(configDocs).toContain('Must be a positive integer');
    expect(publicConfigSchema.properties?.extensions?.properties?.policyGateTimeoutMs).toMatchObject({
      type: 'integer',
      exclusiveMinimum: 0,
    });
    expect(publicConfigSchema.properties?.extensions?.properties?.policyGateFailurePolicy).toMatchObject({
      type: 'string',
      enum: ['fail-open', 'fail-closed'],
    });
    expect(minimalEventLogger).not.toContain('Event dispatch remains deferred');
    expect(minimalEventLogger).toContain('onEvent');
    expect(minimalEventLogger).toContain('dispatched at runtime');
    expect(slackWebhookNotifier).toContain("onEvent('plan:error:set'");
    expect(slackWebhookNotifier).toContain('EFORGE_SLACK_WEBHOOK_URL');
    expect(slackWebhookNotifier).not.toMatch(/hooks\.slack\.com\/services/i);
    expect(slackWebhookNotifier).not.toMatch(/\bxox[a-z]?-/i);
    expect(protectedPaths).toContain('beforeFinalMerge');
    expect(protectedPaths).toContain('require-approval` blocks');
    expect(protectedPaths).not.toContain('Policy enforcement before merge remains');
    expect(protectedPaths).not.toContain('deferred until the policy-gate runtime is implemented');
  });

  it('keeps non-shipped policy-gate capabilities explicitly deferred in public docs', () => {
    for (const source of [
      docsExtensions,
      docsExtensionsApi,
      webExtensions,
      webExtensionsApi,
      sdkReadme,
      configDocs,
      webConfigDocs,
      examplesReadme,
    ]) {
      expect(source).toContain('beforeEnqueue');
      expect(source).toContain('beforeValidation');
      expect(source).toContain('modify');
      expect(source).toMatch(/approval (?:workflow|workflows|UI|state)[^\n]*(?:deferred|future|no approval workflow)|(?:deferred|future|no approval workflow)[^\n]*approval (?:workflow|workflows|UI|state)/i);
      expect(source).toMatch(/beforeEnqueue[^\n]*(?:deferred|future)|(?:deferred|future)[^\n]*beforeEnqueue/i);
      expect(source).toMatch(/beforeValidation[^\n]*(?:deferred|future)|(?:deferred|future)[^\n]*beforeValidation/i);
      expect(source).toMatch(/modify[^\n]*(?:deferred|future)|(?:deferred|future)[^\n]*modify/i);
    }
  });

  it('documents extension trust commands, hash-based blocking, trust store location, and hash limitation', () => {
    const claudeCodeSkill = readRepoFile('eforge-plugin/skills/extend/extend.md');
    const piSkill = readRepoFile('packages/pi-eforge/skills/eforge-extend/SKILL.md');
    for (const source of [docsExtensions, webExtensions]) {
      expect(source).toContain('eforge extension trust');
      expect(source).toContain('eforge extension untrust');
      expect(source).toContain('extension-trust.json');
      // Changed-extension blocking: extension is blocked when content hash no longer matches the stored record
      expect(source).toMatch(/re-trust|hash.*changed|changed.*hash|content hash.*no longer|blocked.*until/i);
      // Hash limitation: files outside the extension unit are not covered by the hash
      expect(source).toMatch(/outside the extension|out-of-unit|files.*outside/i);
    }
    for (const source of [readme, sdkReadme]) {
      expect(source).toMatch(/unsandboxed|without a sandbox/i);
      expect(source).toMatch(/project\/team|project-team|team extensions/i);
      expect(source).toMatch(/re-trust|hash.*changed|changed.*hash|content hash.*no longer|blocked.*until/i);
    }
    // No stale language asserting hash-based trust is not shipped or that the old coarse trust flag loads project/team code.
    for (const source of [docsExtensions, webExtensions, sdkReadme, readme, configDocs, webConfigDocs, claudeCodeSkill, piSkill]) {
      expect(source).not.toContain('Hash-based trust prompts/stores are not shipped behavior in this slice');
      expect(source).not.toMatch(/trustProjectExtensions:\s*true[^.\n]*(?:project\/team|checked-in|committed)[^.\n]*(?:load|run|trust|skipped unless)/i);
      expect(source).not.toMatch(/(?:project\/team|checked-in|committed)[^.\n]*(?:load|run|trust|skipped unless)[^.\n]*trustProjectExtensions:\s*true/i);
    }
  });

  it('config docs document per-extension local trust records and committed config cannot grant trust', () => {
    for (const source of [configDocs, webConfigDocs]) {
      expect(source).toMatch(/extension-trust\.json|per-extension.*trust|local.*trust.*record/i);
      expect(source).toMatch(/trustProjectExtensions[^.\n]*(?:does not trust|does not.*bypass|deprecated compatibility)/i);
      expect(source).toMatch(/(?:checked-in|committed)[^.\n]*(?:config|profile)/i);
      expect(source).toMatch(/stripped[^.\n]*warning/i);
    }
  });

  it('extension-authoring skills require inspection and confirmation before project-team trust, validate, test, and reload', () => {
    const claudeCodeSkill = readRepoFile('eforge-plugin/skills/extend/extend.md');
    const piSkill = readRepoFile('packages/pi-eforge/skills/eforge-extend/SKILL.md');
    for (const source of [claudeCodeSkill, piSkill]) {
      // Trust command and trust store location mentioned
      expect(source).toContain('eforge extension trust');
      expect(source).toContain('extension-trust.json');
      // Inspection before trust/validate/test/reload for project/team scope
      expect(source).toMatch(/project.team.*inspect|Read the extension file|inspect.*before.*trust/i);
      for (const operation of ['trust', 'validate', 'test', 'reload']) {
        expect(source, `project-team inspection mentions ${operation}`).toMatch(new RegExp(`before[^.\\n]*${operation}`, 'i'));
      }
      // Explicit confirmation required before trust, validation, test, and reload operations that execute project/team code
      expect(source).toMatch(/explicit.*confirm|ask for explicit|explicit user confirm/i);
      expect(source).toMatch(/confirmation[^.\n]*(?:record the current content hash|action:\s*"trust"|eforge extension trust)|(?:record the current content hash|action:\s*"trust"|eforge extension trust)[^.\n]*confirmation/i);
      expect(source).toMatch(/confirmation before calling validate/i);
      expect(source).toMatch(/confirmation before running the replay test/i);
      expect(source).toMatch(/confirmation before reload/i);
      // Hash limitation for out-of-unit imports
      expect(source).toMatch(/outside the extension directory/i);
    }
  });

  it('documents examples, scaffold templates, and unavailable extension workflows accurately', () => {
    for (const example of [
      'minimal-event-logger.ts',
      'slack-webhook-notifier.ts',
      'agent-context.ts',
      'agent-tools.ts',
      'profile-router.ts',
      'protected-paths.ts',
    ]) {
      expect(examplesReadme).toContain(example);
    }

    for (const expected of [
      'Runtime-supported event dispatch and replay',
      'Runtime-supported prompt-context augmentation',
      'Runtime-supported per-run extension tool injection and availability tuning',
      'Runtime-supported pre-build dispatch',
      'Runtime-supported policy enforcement for plan/final merge protected paths',
      'pnpm test -- test/extension-sdk-example.test.ts',
      'pnpm test -- test/extension-tooling-wiring-cli.test.ts test/extension-tooling-wiring-consumer-parity.test.ts test/extension-tooling-wiring-runtime-docs.test.ts',
      'pnpm docs:check',
      'eforge extension test ./examples/extensions/slack-webhook-notifier.ts --fixture events.json',
    ]) {
      expect(examplesReadme).toContain(expected);
    }

    expect(agentToolsExample).toContain('defineExtensionTool');
    expect(agentToolsExample).toContain('registerTool');
    expect(agentToolsExample).toContain('onAgentRun');
    expect(agentToolsExample).toContain('effectiveToolName');

    for (const source of [docsExtensions, webExtensions, sdkReadme]) {
      expect(source).toContain('event-logger');
      expect(source).toContain('blank');
    }

    for (const source of [docsExtensions, webExtensions]) {
      expect(source).toContain('slack-webhook-notifier.ts');
      expect(source).toContain('EFORGE_SLACK_WEBHOOK_URL');
      expect(source).toMatch(/extension enable[^.\n]*(?:and|,)[^.\n]*extension disable[^.\n]*workflows? (?:are|is) deferred/i);
    }

    // promote and demote are now real commands — docs must document them
    for (const source of [docsExtensions, webExtensions]) {
      expect(source).toContain('eforge extension promote');
      expect(source).toContain('eforge extension demote');
      expect(source).toContain('eforge extension install');
      expect(source).toContain('eforge extension update');
      expect(source).toContain('eforge extension remove');
    }

    for (const source of [
      docsExtensions,
      docsExtensionsApi,
      webExtensions,
      webExtensionsApi,
      sdkReadme,
      configDocs,
      webConfigDocs,
      examplesReadme,
    ]) {
      expect(source).not.toContain('/eforge:extend');
      expect(source).not.toMatch(/\beforge extension (enable|disable)(?:\s|`|$)/);
      expect(source).not.toMatch(/profile routing[^.\n]*(?:deferred|future)|(?:deferred|future)[^.\n]*profile routing/i);
    }
  });
});
// --- eforge:endregion extension-tooling-wiring-runtime-docs ---
