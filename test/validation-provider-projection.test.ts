/**
 * Tests for validation provider projection shape.
 *
 * Asserts that projectExtensionRegistry returns validationProviderDetails
 * with the correct shape (name, description, kind, commandCount, extensionName,
 * extensionPath) and that command-form providers report kind: 'commands' and
 * commandCount (not the raw command strings).
 */

import { describe, it, expect } from 'vitest';
import { projectExtensionRegistry } from '../packages/engine/src/extensions/projector.js';
import type {
  NativeExtensionRegistry,
  LoadedNativeExtension,
  ValidationProviderRegistration,
} from '../packages/engine/src/extensions/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRegistry(opts: {
  extensionName: string;
  extensionPath: string;
  validationProviders: ValidationProviderRegistration[];
}): NativeExtensionRegistry {
  const extension: LoadedNativeExtension = {
    name: opts.extensionName,
    path: opts.extensionPath,
    entrypoint: `${opts.extensionPath}/index.js`,
    scope: 'project-local',
    source: 'auto',
    strategy: 'dynamic-import',
    registrations: {
      eventHooks: 0,
      agentRunHooks: 0,
      policyGates: 0,
      profileRouters: 0,
      inputSources: 0,
      reviewerPerspectives: 0,
      validationProviders: opts.validationProviders.length,
      tools: 0,
      prdEnrichers: 0,
      actions: 0,
      agentTasks: 0,
      consoleContributions: 0,
      consoleWorkstations: 0,
      integrationCommands: 0,
      deepLinks: 0,
    },
  };
  return {
    extensions: [extension],
    candidates: [],
    eventHooks: [],
    agentRunHooks: [],
    policyGates: [],
    profileRouters: [],
    inputSources: [],
    reviewerPerspectives: [],
    validationProviders: opts.validationProviders,
    tools: [],
    prdEnrichers: [],
    actions: [],
    agentTasks: [],
    consoleContributions: [],
    consoleWorkstations: [],
    integrationCommands: [],
    deepLinks: [],
    diagnostics: [],
  };
}

function makeValidationProvider(opts: {
  name: string;
  description: string;
  extensionName: string;
  extensionPath: string;
  commands?: string[];
}): ValidationProviderRegistration {
  return {
    kind: 'validationProvider',
    extensionName: opts.extensionName,
    extensionPath: opts.extensionPath,
    name: opts.name,
    value: {
      name: opts.name,
      description: opts.description,
      ...(opts.commands
        ? { commands: opts.commands }
        : { validate: async () => null }),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validation provider projection', () => {
  const extName = 'test-extension';
  const extPath = '/project/.eforge/extensions/test-extension.js';

  it('projects one function-form and one command-form provider with correct shape', () => {
    const registry = makeRegistry({
      extensionName: extName,
      extensionPath: extPath,
      validationProviders: [
        makeValidationProvider({
          name: 'type-check-gate',
          description: 'Runs TypeScript type checking',
          extensionName: extName,
          extensionPath: extPath,
          // no commands → function form
        }),
        makeValidationProvider({
          name: 'lint-gate',
          description: 'Runs the project linter',
          extensionName: extName,
          extensionPath: extPath,
          commands: ['pnpm lint', 'pnpm lint:css'],
        }),
      ],
    });

    const projection = projectExtensionRegistry(registry);
    expect(projection.extensions).toHaveLength(1);

    const details = projection.extensions[0].validationProviderDetails;
    expect(details).toBeDefined();
    expect(details).toHaveLength(2);

    const [functionProvider, commandProvider] = details!;

    // Function-form provider
    expect(functionProvider).toEqual({
      name: 'type-check-gate',
      description: 'Runs TypeScript type checking',
      kind: 'function',
      extensionName: extName,
      extensionPath: extPath,
    });
    expect(functionProvider.commandCount).toBeUndefined();

    // Command-form provider
    expect(commandProvider).toEqual({
      name: 'lint-gate',
      description: 'Runs the project linter',
      kind: 'commands',
      commandCount: 2,
      extensionName: extName,
      extensionPath: extPath,
    });
  });

  it('does not expose raw command strings in the projection', () => {
    const secretCmd = 'pnpm run secret-internal-command';
    const registry = makeRegistry({
      extensionName: extName,
      extensionPath: extPath,
      validationProviders: [
        makeValidationProvider({
          name: 'secret-gate',
          description: 'Validates something sensitive',
          extensionName: extName,
          extensionPath: extPath,
          commands: [secretCmd],
        }),
      ],
    });

    const projection = projectExtensionRegistry(registry);
    const details = projection.extensions[0].validationProviderDetails;
    expect(details).toBeDefined();
    expect(details).toHaveLength(1);

    const detail = details![0];
    expect(detail.kind).toBe('commands');
    expect(detail.commandCount).toBe(1);

    // The raw command string must not appear anywhere in the projection
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain(secretCmd);
  });

  it('returns no validationProviderDetails when extension has no providers', () => {
    const registry = makeRegistry({
      extensionName: extName,
      extensionPath: extPath,
      validationProviders: [],
    });

    const projection = projectExtensionRegistry(registry);
    expect(projection.extensions[0].validationProviderDetails).toBeUndefined();
  });

  it('only projects providers belonging to the matching extension', () => {
    const otherExtName = 'other-extension';
    const otherExtPath = '/project/.eforge/extensions/other-extension.js';

    // Both extensions in the registry but we project only the first one
    const extension: LoadedNativeExtension = {
      name: extName,
      path: extPath,
      entrypoint: `${extPath}/index.js`,
      scope: 'project-local',
      source: 'auto',
      strategy: 'dynamic-import',
      registrations: {
        eventHooks: 0,
        agentRunHooks: 0,
        policyGates: 0,
        profileRouters: 0,
        inputSources: 0,
        reviewerPerspectives: 0,
        validationProviders: 1,
        tools: 0,
        prdEnrichers: 0,
        actions: 0,
        agentTasks: 0,
        consoleContributions: 0,
        consoleWorkstations: 0,
        integrationCommands: 0,
        deepLinks: 0,
      },
    };

    const registry: NativeExtensionRegistry = {
      extensions: [extension],
      candidates: [],
      eventHooks: [],
      agentRunHooks: [],
      policyGates: [],
      profileRouters: [],
      inputSources: [],
      reviewerPerspectives: [],
      validationProviders: [
        makeValidationProvider({
          name: 'my-gate',
          description: 'My gate',
          extensionName: extName,
          extensionPath: extPath,
        }),
        makeValidationProvider({
          name: 'other-gate',
          description: 'Other gate',
          extensionName: otherExtName,
          extensionPath: otherExtPath,
        }),
      ],
      tools: [],
      prdEnrichers: [],
      actions: [],
      agentTasks: [],
      consoleContributions: [],
      consoleWorkstations: [],
      integrationCommands: [],
      deepLinks: [],
      diagnostics: [],
    };

    const projection = projectExtensionRegistry(registry);
    expect(projection.extensions).toHaveLength(1);
    const details = projection.extensions[0].validationProviderDetails;
    expect(details).toBeDefined();
    expect(details).toHaveLength(1);
    expect(details![0].name).toBe('my-gate');
  });
});
