import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOST_OUTPUT_CHAR_BUDGET, HOST_OUTPUT_GUIDANCE, capHostOutputText, formatExtensionContributionDetailText, formatExtensionContributionListText, formatExtensionContributionOutputText } from '@eforge-build/client';
import { createProgram } from '../packages/eforge/src/cli/index.js';
import { parseJsonObjectInput } from '../packages/eforge/src/cli/extension-contributions.js';
import { readRepoFile } from './extension-tooling-wiring-helpers.js';

function commandNames(command: { commands?: Array<{ name(): string; commands?: Array<{ name(): string }> }> } | undefined): string[] {
  return command?.commands?.map((child) => child.name()) ?? [];
}

function normalizedSkillText(relativePath: string): string {
  return readRepoFile(relativePath)
    .replace(/mcp__eforge__eforge_extension_contribution/g, 'eforge_extension_contribution')
    .replace(/Claude\/MCP|Claude Code|MCP|Pi/g, 'HOST')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('host contribution CLI surface', () => {
  it('registers extension contributions list and invoke commands on the real Commander program', () => {
    const program = createProgram(undefined, 'test');
    const extension = program.commands.find((command) => command.name() === 'extension');
    const contributions = extension?.commands.find((command) => command.name() === 'contributions');

    expect(extension, 'extension command').toBeDefined();
    expect(contributions, 'extension contributions command group').toBeDefined();
    expect(commandNames(contributions)).toContain('list');
    expect(commandNames(contributions)).toContain('show');
    expect(commandNames(contributions)).toContain('invoke');
  });

  it('uses shared client helpers and JSON object input flags without route literals', () => {
    const source = readRepoFile('packages/eforge/src/cli/extension-contributions.ts');

    expect(source).toContain('listEforgeExtensionContributions');
    expect(source).toContain('invokeEforgeExtensionContribution');
    expect(source).toContain('formatExtensionContributionListText');
    expect(source).toContain('formatExtensionContributionDetailText');
    expect(source).toContain('formatExtensionContributionOutputText');
    expect(source).toContain('createExtensionContributionFailedInvocationEnvelope');
    expect(source).toContain('showExtensionContributionManifestEntry');
    expect(source).toContain('JSON.stringify(result, null, 2)');
    for (const option of ['--kind <kind>', '--extension-name <name>', '--search <text>', '--id-prefix <prefix>', '--output-profile <profile>', '--limit <number>', '--offset <number>', '--include-schema', '--include-diagnostics', '--full']) {
      expect(source).toContain(option);
    }
    expect(source).toContain('show <id>');
    expect(source).toContain('projectionFromFullFlag(options.full)');
    expect(source).toContain('--input-json <json>');
    expect(source).toContain('--input-file <path>');
    expect(source).toContain("requestedBy: { host: 'cli' }");
    expect(source).not.toContain('/api/');
    expect(source).not.toContain('@eforge-build/monitor');
    expect(source).not.toContain('@eforge-build/engine');
  });

  it('wires focused contribution commands from the bounded CLI entrypoint', () => {
    const source = readRepoFile('packages/eforge/src/cli/index.ts');
    const importIndex = source.indexOf('registerExtensionContributionCommands');
    const callIndex = source.indexOf('registerExtensionContributionCommands(extension)');
    const configIndex = source.indexOf('// Config commands');

    expect(importIndex).toBeGreaterThanOrEqual(0);
    expect(callIndex).toBeGreaterThan(importIndex);
    expect(callIndex).toBeLessThan(configIndex);
  });

  it('parses invoke input from JSON text or files and rejects non-object forms before invocation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eforge-contribution-cli-input-'));
    try {
      const inputFile = join(dir, 'input.json');
      await writeFile(inputFile, JSON.stringify({ fromFile: true }), 'utf-8');

      await expect(parseJsonObjectInput({})).resolves.toEqual({});
      await expect(parseJsonObjectInput({ inputJson: '{"fromJson":true}' })).resolves.toEqual({ fromJson: true });
      await expect(parseJsonObjectInput({ inputFile })).resolves.toEqual({ fromFile: true });
      await expect(parseJsonObjectInput({ inputJson: '{}', inputFile })).rejects.toThrow('--input-json and --input-file are mutually exclusive');
      await expect(parseJsonObjectInput({ inputJson: '[]' })).rejects.toThrow('"input" must be a JSON object');
      await expect(parseJsonObjectInput({ inputJson: 'null' })).rejects.toThrow('"input" must be a JSON object');
      await expect(parseJsonObjectInput({ inputJson: 'not-json' })).rejects.toThrow('Invalid JSON input:');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('host contribution MCP surface', () => {
  it('registers a daemon-backed MCP tool for list, show, and invoke with typed user errors', () => {
    const source = readRepoFile('packages/eforge/src/cli/mcp-extension-contributions.ts');

    expect(source).toContain('eforge_extension_contribution');
    expect(source).toContain('createDaemonTool');
    expect(source).toContain('listEforgeExtensionContributions');
    expect(source).toContain('invokeEforgeExtensionContribution');
    expect(source).toContain('formatExtensionContributionListText');
    expect(source).toContain('formatExtensionContributionDetailText');
    expect(source).toContain('formatExtensionContributionOutputText');
    expect(source).toContain('createExtensionContributionFailedInvocationEnvelope');
    expect(source).toContain('showExtensionContributionManifestEntry');
    expect(source).toContain('formatResponse');
    expect(source).toContain('capHostOutputText');
    expect(source).toContain('textResult');
    expect(source).toContain("host: 'mcp'");
    expect(source).toContain('McpUserError');
    expect(source).toContain('new McpUserError(failureEnvelope');
    for (const schemaField of ['extensionName', 'search', 'idPrefix', 'outputProfile', 'limit', 'offset', 'includeInputSchema', 'includeDiagnostics', 'full']) {
      expect(source).toContain(schemaField);
    }
    expect(source).toContain('list');
    expect(source).toContain('show');
    expect(source).toContain('invoke');
    expect(source).not.toContain('JSON.stringify(payload');
    expect(source).not.toContain('/api/');
    expect(source).not.toContain('dispatchEforgeExtensionAction');
  });

  it('caps MCP contribution list, show, and invoke text after MCP-specific headers', () => {
    const entry = {
      kind: 'action' as const,
      id: 'giant.run',
      label: 'Giant Run',
      description: 'debug '.repeat(2_000),
      extensionName: 'giant',
      extensionPath: '/repo/.eforge/extensions/giant/index.ts',
      actionId: 'giant.run',
      actionBacked: true,
      outputProfile: 'debug-rich' as const,
      inputSchema: { type: 'object', properties: Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`field_${index}`, { type: 'string', description: 'debug '.repeat(80) }])) },
      inputPropertyKeys: Array.from({ length: 500 }, (_, index) => `field_${index}`),
      inputPropertyCount: 500,
      inputRequiredCount: 250,
      inputDefaultKeys: Array.from({ length: 100 }, (_, index) => `field_${index}`),
      diagnostics: Array.from({ length: 200 }, (_, index) => ({ severity: 'warning', code: `diag-${index}`, message: 'debug '.repeat(100) })),
    };
    const listText = capHostOutputText(formatExtensionContributionListText({ generatedAt: new Date(0).toISOString(), total: 200, returned: 1, offset: 0, limit: 1, hasMore: true, nextOffset: 1, diagnosticCount: 200, entries: [entry], diagnostics: entry.diagnostics })).text;
    const showText = capHostOutputText(formatExtensionContributionDetailText({ generatedAt: new Date(0).toISOString(), entry, diagnosticCount: 200, diagnostics: entry.diagnostics })).text;
    const invokeText = capHostOutputText([
      'Invocation: invocation-1',
      'Target: action:giant.run',
      'Action: giant.run',
      '',
      formatExtensionContributionOutputText({ rows: Array.from({ length: 1_000 }, (_, index) => ({ index, debug: 'debug '.repeat(200) })), nextOffset: 1000 }, { outputProfile: 'debug-rich' }),
    ].join('\n')).text;

    for (const text of [listText, showText, invokeText]) {
      expect(text.length).toBeLessThanOrEqual(HOST_OUTPUT_CHAR_BUDGET);
      if (text.includes('rawLength') || text.includes('final host character budget')) expect(text).toContain(HOST_OUTPUT_GUIDANCE);
    }
  });

  it('registers the contribution tool after extension management and before models', () => {
    const source = readRepoFile('packages/eforge/src/cli/mcp-proxy.ts');
    const extensionToolIndex = source.indexOf('eforge_extension');
    const contributionIndex = source.indexOf('registerExtensionContributionMcpTool(server, cwd)');
    const modelsIndex = source.indexOf('eforge_models', contributionIndex);

    expect(contributionIndex).toBeGreaterThan(extensionToolIndex);
    expect(modelsIndex).toBeGreaterThan(contributionIndex);
  });
});

describe('host contribution Pi surface', () => {
  it('registers passive Pi tool and native command surfaces', () => {
    const source = readRepoFile('packages/pi-eforge/extensions/eforge/extension-contributions.ts');
    const uxSource = readRepoFile('packages/pi-eforge/extensions/eforge/extension-contribution-ux.ts');

    expect(source).toContain('eforge_extension_contribution');
    expect(source).toContain('eforge:extensions');
    expect(source).toContain("host: 'pi'");
    expect(source).toContain('listEforgeExtensionContributionsIfRunning');
    expect(source).toContain('invokeEforgeExtensionContributionIfRunning');
    expect(source).toContain('formatExtensionContributionListText');
    expect(source).toContain('formatExtensionContributionListText(result)');
    expect(source).toContain('formatExtensionContributionDetailText');
    expect(source).toContain('formatExtensionContributionOutputText');
    expect(source).toContain('showExtensionContributionManifestEntry');
    expect(source).toContain('apiGetExtensionContributionManifestIfRunning');
    expect(source).toContain('createExtensionContributionFailedInvocationEnvelope');
    expect(uxSource).toContain('formatExtensionContributionOutputText');
    expect(uxSource).toContain('formatExtensionContributionFailedInvocationEnvelopeText');
    expect(source).toContain('DAEMON_NOT_RUNNING_GUIDANCE');
    expect(source).toContain('prepareContributionInput');
    expect(source).toContain('formatInvocationPanel');
    expect(source).toContain('includeInputSchema: true');
    for (const schemaField of ['extensionName', 'search', 'idPrefix', 'outputProfile', 'limit', 'offset', 'includeInputSchema', 'includeDiagnostics', 'full']) {
      expect(source).toContain(schemaField);
    }
    expect(source).not.toContain("ctx.ui.editor('eforge extensions - JSON input', '{}')");
    expect(source).not.toContain('JSON.stringify(result, null, 2)');
    for (const contributionSource of [source, uxSource]) {
      expect(contributionSource).not.toContain('ensureDaemon');
      expect(contributionSource).not.toContain('daemonRequest(');
      expect(contributionSource).not.toContain('/api/');
    }
  });

  it('wires the Pi registration helpers from the bounded extension entrypoint without a plan shim', () => {
    const source = readRepoFile('packages/pi-eforge/extensions/eforge/index.ts');

    expect(source).toContain('registerExtensionContributionTool');
    expect(source).toContain('registerExtensionContributionsCommand');
    expect(source).toContain('registerExtensionContributionTool(pi)');
    expect(source).toContain('registerExtensionContributionsCommand(pi, () => _latestCtx)');
    expect(source).not.toContain('pi.registerCommand("eforge:plan"');
    expect(source).not.toContain('handlePlanCommand');
  });

  it('documents the Pi tool, native command, and generic planning entry without bumping the Pi package version', () => {
    const readme = readRepoFile('packages/pi-eforge/README.md');
    const packageJson = JSON.parse(readRepoFile('packages/pi-eforge/package.json')) as { version: string };

    expect(readme).toContain('eforge_extension_contribution');
    expect(readme).toContain('/eforge:extensions');
    expect(readme).toContain('/console/workstations/eforge-plan%3Aplanning-workstation');
    expect(readme).not.toContain('/eforge:plan');
    expect(packageJson.version).toBe('0.7.21');
  });
});

describe('eforge-plan generic planning contribution routing', () => {
  it('keeps planning entry as an extension contribution, workstation, and deep link', () => {
    const source = readRepoFile('eforge/extensions/eforge-plan/index.ts');

    expect(source).toContain('eforge-plan:open-planning-entry');
    expect(source).toContain('eforge-plan:planning-workstation');
    expect(source).toContain('/console/workstations/eforge-plan%3Aplanning-workstation');
    expect(source).toContain('registerIntegrationCommand');
    expect(source).toContain('registerDeepLink');
    expect(source).toContain('registerConsoleWorkstation');
  });
});

describe('host contribution client exports and source discipline', () => {
  it('exports dispatcher helpers from @eforge-build/client and the source index', async () => {
    const client = await import('@eforge-build/client');
    const source = readRepoFile('packages/client/src/index.ts');
    const platformExport = source.indexOf('./api/extension-contributions.js');
    const dispatcherExport = source.indexOf('./api/extension-contribution-dispatch.js');

    expect(client.EXTENSION_HOST_CONTRIBUTION_KINDS).toEqual(['action', 'command', 'deep-link']);
    for (const name of [
      'summarizeExtensionContributionManifest',
      'resolveExtensionContributionInvocation',
      'listEforgeExtensionContributions',
      'listEforgeExtensionContributionsIfRunning',
      'invokeEforgeExtensionContribution',
      'invokeEforgeExtensionContributionIfRunning',
      'formatExtensionContributionOutput',
      'formatExtensionContributionOutputText',
    ] as const) {
      expect(client[name], name).toBeTypeOf('function');
    }
    expect(dispatcherExport).toBeGreaterThan(platformExport);
  });

  it('keeps contribution invocation separate from extension-management dispatch', () => {
    const source = readRepoFile('packages/client/src/api/extension-tool-dispatch.ts');

    expect(source).not.toContain('extensionContribution');
    expect(source).not.toContain('integrationCommand');
    expect(source).not.toContain('deepLink');
    expect(source).not.toContain('invokeEforgeExtensionContribution');
  });
});

describe('host contribution skill parity and plugin versioning', () => {
  it('updates Claude and Pi extension-authoring skills with host contribution guidance', () => {
    const pluginSkill = readRepoFile('eforge-plugin/skills/extend/extend.md');
    const piSkill = readRepoFile('packages/pi-eforge/skills/eforge-extend/SKILL.md');

    for (const text of [pluginSkill, piSkill]) {
      expect(text).toContain('registerAction');
      expect(text).toContain('registerConsoleContribution');
      expect(text).toContain('registerIntegrationCommand');
      expect(text).toContain('registerDeepLink');
      expect(text).toContain('registerConsoleWorkstation');
      expect(text).toContain('frameBundle');
      expect(text).toContain('workstation-assets');
      expect(text).toContain('@eforge-build/extension-sdk/browser');
      expect(text).toMatch(/raw .*HTTP routes/i);
      expect(text).toMatch(/parent.Console|parent Console|private Console/i);
    }
    expect(pluginSkill).toContain('mcp__eforge__eforge_extension_contribution');
    expect(piSkill).toContain('eforge_extension_contribution');
    expect(normalizedSkillText('eforge-plugin/skills/extend/extend.md')).toContain('eforge_extension_contribution');
    expect(normalizedSkillText('packages/pi-eforge/skills/eforge-extend/SKILL.md')).toContain('eforge_extension_contribution');
  });

  it('bumps the Claude plugin patch version above the plan baseline', () => {
    const plugin = JSON.parse(readRepoFile('eforge-plugin/.claude-plugin/plugin.json')) as { version: string };
    const [major, minor, patch] = plugin.version.split('.').map(Number);
    const actual = major * 1_000_000 + minor * 1_000 + patch;
    const baseline = 0 * 1_000_000 + 25 * 1_000 + 51;

    expect(actual).toBeGreaterThan(baseline);
  });
});
