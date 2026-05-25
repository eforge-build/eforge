/**
 * Config schema generator.
 *
 * Imports the Zod v4 engine config schema, converts it to JSON Schema via
 * z.toJSONSchema(), and emits both config.schema.json and the Markdown
 * reference.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { eforgeConfigSchema } from '@eforge-build/engine/config';
import type { OutputPaths } from '../output-paths.js';
import type { ProvenanceInfo } from '../provenance.js';
import { buildProvenanceHeader } from '../provenance.js';

async function writeToAll(content: string, paths: string[]): Promise<void> {
  for (const p of paths) {
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content, 'utf-8');
  }
}

interface JsonSchemaProperty {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchemaProperty>;
  $ref?: string;
  anyOf?: JsonSchemaProperty[];
  allOf?: JsonSchemaProperty[];
  items?: JsonSchemaProperty;
  [key: string]: unknown;
}

interface ConfigJsonSchema {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  [key: string]: unknown;
}

export async function generateConfig(opts: {
  outputPaths: OutputPaths;
  provenance: ProvenanceInfo;
  repoRoot: string;
}): Promise<void> {
  const header = buildProvenanceHeader({
    sourceFiles: ['packages/engine/src/config.ts'],
  });

  // Generate JSON Schema using Zod v4 native converter
  const jsonSchema = z.toJSONSchema(eforgeConfigSchema) as ConfigJsonSchema;
  const schemaJson = JSON.stringify(jsonSchema, null, 2);
  await mkdir(dirname(opts.outputPaths.schemaConfig), { recursive: true });
  await writeFile(opts.outputPaths.schemaConfig, schemaJson + '\n', 'utf-8');

  // Build Markdown from the JSON schema properties — sorted for determinism
  const properties = jsonSchema.properties ?? {};
  const sortedFields = Object.entries(properties).sort(([a], [b]) => a.localeCompare(b));

  const lines: string[] = [
    header,
    '# eforge Configuration Reference',
    '',
    'eforge merges configuration from three tiers (highest precedence first):',
    '',
    '1. `.eforge/config.yaml` — project-local, gitignored, developer-personal',
    '2. `eforge/config.yaml` — project-level, committed',
    '3. `~/.config/eforge/config.yaml` — user-global',
    '',
    '## Top-level fields',
    '',
    '| Field | Description |',
    '|-------|-------------|',
  ];

  for (const [key, prop] of sortedFields) {
    const desc = (prop.description ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    lines.push(`| \`${key}\` | ${desc} |`);
  }

  lines.push('');
  // --- eforge:region plan-01-reference-and-mirror-content ---
  lines.push('## Toolbelts');
  lines.push('');
  lines.push('`tools.toolbelts` declares named bundles of project MCP servers that tiers can opt into with `agents.tiers.<tier>.toolbelt`. Toolbelts are intended for profiles that need a focused capability set, such as browser automation for UI implementation and review.');
  lines.push('');
  lines.push('Use Pi\'s native `/eforge:profile:new` wizard or Claude Code\'s `/eforge:profile-new` fallback to configure toolbelt presets interactively. The wizard prompts for a preset after tier configuration, with a gallery including `browser-ui`, `docs-research`, `issue-triage`, `repo-review`, `observability`, `database-readonly`, `api-testing`, and `design-ui`. Each preset assigns `toolbelt: none` to tiers that do not need project MCP access (least-privilege default).');
  lines.push('');
  lines.push('```yaml');
  lines.push('tools:');
  lines.push('  toolbelts:');
  lines.push('    browser-ui:');
  lines.push('      description: Browser automation for UI implementation and review.');
  lines.push('      mcpServers:');
  lines.push('        - playwright');
  lines.push('');
  lines.push('agents:');
  lines.push('  tiers:');
  lines.push('    implementation:');
  lines.push('      harness: pi');
  lines.push('      model: anthropic/claude-sonnet-4-6');
  lines.push('      effort: medium');
  lines.push('      pi:');
  lines.push('        provider: openrouter');
  lines.push('      toolbelt: browser-ui');
  lines.push('    planning:');
  lines.push('      harness: pi');
  lines.push('      model: anthropic/claude-opus-4-6');
  lines.push('      effort: high');
  lines.push('      pi:');
  lines.push('        provider: openrouter');
  lines.push('      toolbelt: none');
  lines.push('```');
  lines.push('');
  lines.push('- `tools.toolbelts.<name>.description` is optional human-readable prose for list/show surfaces.');
  lines.push('- `tools.toolbelts.<name>.mcpServers` is a non-empty list of server names from `.mcp.json`.');
  lines.push('- `agents.tiers.<tier>.toolbelt` names one declared toolbelt, or uses `toolbelt: none` to pass no project MCP servers to that tier.');
  lines.push('- An omitted `toolbelt` keeps the default behavior: all project MCP servers from `.mcp.json` are passed through.');
  lines.push('- Toolbelts filter only project MCP servers from `.mcp.json`; they do not affect Pi extensions, Claude Code plugins, engine-internal tools, extension-contributed custom tools, or harness built-ins.');
  lines.push('- Validation rejects reserved toolbelt names such as `none`, invalid toolbelt names, tier references to undeclared toolbelts, missing `.mcp.json` files when a toolbelt declares MCP servers, and toolbelt server names that are not present under `.mcp.json` `mcpServers`.');
  lines.push('');
  lines.push('## Hooks');
  lines.push('');
  lines.push('`hooks` is an optional list of fire-and-forget shell commands triggered by eforge events. Hooks are for notifications, logging, and external integrations; they do not block the build pipeline.');
  lines.push('');
  lines.push('```yaml');
  lines.push('hooks:');
  lines.push('  - event: plan:build:complete');
  lines.push('    command: "notify-send \'Build complete\'"');
  lines.push('    timeout: 5000');
  lines.push('  - event: plan:build:failed');
  lines.push('    command: "curl -X POST $SLACK_WEBHOOK -d \'{\\"text\\": \\"Build failed\\"}\'"');
  lines.push('```');
  lines.push('');
  lines.push('| Field | Description |');
  lines.push('|-------|-------------|');
  lines.push('| `event` | Event name or pattern that triggers the hook command. |');
  lines.push('| `command` | Shell command executed when the event matches. |');
  lines.push('| `timeout` | Optional positive timeout in milliseconds; defaults to `5000`. |');
  lines.push('');
  lines.push('Hook commands run asynchronously from the pipeline path. Use them for best-effort side effects, not required validation or build steps.');
  lines.push('');
  // --- eforge:endregion plan-01-reference-and-mirror-content ---
  lines.push('## Landing Action');
  lines.push('');
  lines.push('`landing.action` controls what happens after a successful build. Values: `pr` (open a GitHub pull request), `merge` (merge the artifact branch into the base branch), `leave` (leave the artifact branch in place). Default: `merge`.');
  lines.push('');
  lines.push('**Migration:** The old `build.onSuccess` field and its values (`issue-pr`, `merge-to-base-branch`, `leave-branch`) have been removed. Configs using `build.onSuccess` are rejected with a migration error. Replace it with `landing.action` using the mapping below:');
  lines.push('');
  lines.push('| `landing.action` | Old `build.onSuccess` (rejected) |');
  lines.push('|-----------------|----------------------------------|');
  lines.push('| `pr` | `issue-pr` |');
  lines.push('| `merge` | `merge-to-base-branch` |');
  lines.push('| `leave` | `leave-branch` |');
  lines.push('');
  lines.push('```yaml');
  lines.push('landing:');
  lines.push('  action: pr    # pr | merge (default) | leave');
  lines.push('```');
  lines.push('');
  lines.push('## PR Auto-Merge');
  lines.push('');
  lines.push('`landing.pr.autoMerge` controls whether GitHub PR auto-merge is enabled after a PR is opened. This setting only applies when `landing.action: pr`. Default: `ask`.');
  lines.push('');
  lines.push('Note: `landing.pr.autoMerge` is distinct from `landing.action: merge`. The `action: merge` setting merges the artifact branch directly into the base branch without opening a PR. `landing.pr.autoMerge` opens a PR and then optionally enables GitHub\'s native auto-merge feature on it.');
  lines.push('');
  lines.push('| Value | Behavior |');
  lines.push('|-------|----------|');
  lines.push('| `ask` (default) | Enable auto-merge only when the per-run `landingAutoMerge` flag is explicitly `true`. Omitting the per-run flag means no auto-merge. |');
  lines.push('| `always` | Enable auto-merge on every PR unless the per-run `landingAutoMerge` flag is explicitly `false`. |');
  lines.push('| `never` | Never enable auto-merge; skips auto-merge silently and emits a skipped event. |');
  lines.push('');
  lines.push('**Per-run override:** Individual builds and playbook runs can override the policy via the `landingAutoMerge` field in the enqueue body (CLI: `--landing-auto-merge` / `--no-landing-auto-merge`). Omitting the field defers to the `landing.pr.autoMerge` policy.');
  lines.push('');
  lines.push('```yaml');
  lines.push('landing:');
  lines.push('  action: pr');
  lines.push('  pr:');
  lines.push('    autoMerge: ask    # ask (default) | always | never');
  lines.push('```');
  lines.push('');
  lines.push('## Stacking');
  lines.push('');
  lines.push('`stacking` configures git-spice backed stacked pull requests. When `stacking.enabled: true`, each build\'s artifact branch targets the parent artifact branch instead of the trunk, forming a linear stack of PRs. git-spice must be installed; see the [Stacked PRs guide](/docs/stacking).');
  lines.push('');
  lines.push('```yaml');
  lines.push('stacking:');
  lines.push('  enabled: true              # Default false');
  lines.push('  gitSpice:');
  lines.push('    command: git-spice       # Default. Set to \'gs\' if you use the short alias.');
  lines.push('');
  lines.push('landing:');
  lines.push('  action: pr                 # Required for stacking');
  lines.push('```');
  lines.push('');
  lines.push('| Field | Description |');
  lines.push('|-------|-------------|');
  lines.push('| `stacking.enabled` | Enable stacking. Default `false`. |');
  lines.push('| `stacking.provider` | Stack provider. Only `"git-spice"` is supported in v1. |');
  lines.push('| `stacking.gitSpice.command` | Path or name of the git-spice executable. Default: `"git-spice"`. |');
  lines.push('');
  lines.push('**PRD frontmatter stacking fields:**');
  lines.push('');
  lines.push('| Field | Description |');
  lines.push('|-------|-------------|');
  lines.push('| `stack_id` | Logical stack name shared by all PRDs in the stack. Optional; inferred from root PRD id. |');
  lines.push('| `stack_parent` | Parent PRD id. Optional for single-dependency PRDs (inferred from `depends_on`); required for multi-dependency PRDs. |');
  lines.push('');
  lines.push('## JSON Schema');
  lines.push('');
  lines.push(
    'The complete machine-readable schema is at [`/schemas/config.schema.json`](/schemas/config.schema.json).',
  );
  lines.push('');

  const content = lines.join('\n');
  await writeToAll(content, [opts.outputPaths.contentConfig, opts.outputPaths.publicConfig]);
}
