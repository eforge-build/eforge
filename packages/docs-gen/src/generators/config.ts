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
import { DEFAULT_PLANNING_DECOMPOSITION_CONFIG, PLANNING_DECOMPOSITION_CONFIG_MAXIMA, eforgeConfigSchema } from '@eforge-build/engine/config';
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

const TOP_LEVEL_CONFIG_FIELD_DESCRIPTIONS: Record<string, string> = {
  agents: 'Agent runtime configuration, including tiers, roles, prompt overrides, permissions, and model-turn limits.',
  build: 'Build execution settings such as worktree location, validation commands, cleanup, trunk policy, and validation waivers.',
  daemon: 'Daemon lifecycle settings for the long-running project watcher and API process.',
  extensions: 'Native eforge extension configuration.',
  hooks: 'Fire-and-forget shell commands triggered by matching eforge events.',
  landing: 'Publication action taken after all plans complete and validation passes.',
  langfuse: 'Optional Langfuse tracing configuration for agent runs.',
  maxConcurrentBuilds: 'Maximum number of queued PRD builds that may run concurrently.',
  monitor: 'Monitor and Console retention settings for recorded runs and events.',
  plan: 'Plan artifact output settings used during compile.',
  plugins: 'Host plugin integration settings.',
  prdQueue: 'Queue directory, auto-build, and watcher polling settings for queued PRDs.',
  recovery: 'Disabled-by-default bounded recovery auto-resume policy and attempt budget.',
  stacking: 'Stacking configuration for git-spice backed stacked PRs.',
  tools: 'Toolbelt configuration for named project MCP server bundles.',
};

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
    const description = prop.description?.trim() || TOP_LEVEL_CONFIG_FIELD_DESCRIPTIONS[key] || '';
    const desc = description.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    lines.push(`| \`${key}\` | ${desc} |`);
  }

  lines.push('');
  lines.push('## Compile');
  lines.push('');
  lines.push('`compile` tunes context-managed planning units for overflow-risk compile inputs and the direct PR base-sync conflict-attempt budget. All `compile.planningUnit*` values are positive integers capped by documented operational maxima; `compile.directPrBaseSyncConflictAttempts` is clamped after config/override precedence resolution.');
  lines.push('');
  lines.push('| Field | Default | Max | Description |');
  lines.push('|-------|---------|-----|-------------|');
  lines.push(`| \`compile.planningUnitParallelism\` | \`${DEFAULT_PLANNING_DECOMPOSITION_CONFIG.planningUnitParallelism}\` | \`${PLANNING_DECOMPOSITION_CONFIG_MAXIMA.planningUnitParallelism}\` | Maximum planning units processed concurrently. |`);
  lines.push(`| \`compile.planningUnitMaxDepth\` | \`${DEFAULT_PLANNING_DECOMPOSITION_CONFIG.planningUnitMaxDepth}\` | \`${PLANNING_DECOMPOSITION_CONFIG_MAXIMA.planningUnitMaxDepth}\` | Maximum recursive split depth for planning units. |`);
  lines.push(`| \`compile.planningUnitMaxPromptSourceBytes\` | \`${DEFAULT_PLANNING_DECOMPOSITION_CONFIG.planningUnitMaxPromptSourceBytes}\` | \`${PLANNING_DECOMPOSITION_CONFIG_MAXIMA.planningUnitMaxPromptSourceBytes}\` | Maximum source bytes packed into a single planning-unit prompt. |`);
  lines.push(`| \`compile.planningUnitMaxPromptBytes\` | \`${DEFAULT_PLANNING_DECOMPOSITION_CONFIG.planningUnitMaxPromptBytes}\` | \`${PLANNING_DECOMPOSITION_CONFIG_MAXIMA.planningUnitMaxPromptBytes}\` | Maximum total prompt bytes for a single planning unit. |`);
  lines.push(`| \`compile.planningUnitMaxObservedInputTokens\` | \`${DEFAULT_PLANNING_DECOMPOSITION_CONFIG.planningUnitMaxObservedInputTokens}\` | \`${PLANNING_DECOMPOSITION_CONFIG_MAXIMA.planningUnitMaxObservedInputTokens}\` | Maximum observed input-token budget per planning unit. |`);
  lines.push(`| \`compile.planningUnitMaxObservedTurns\` | unset | \`${PLANNING_DECOMPOSITION_CONFIG_MAXIMA.planningUnitMaxObservedTurns}\` | Optional observed turn limit per planning unit. |`);
  lines.push(`| \`compile.planningUnitMaxCompactHandoffBytes\` | \`${DEFAULT_PLANNING_DECOMPOSITION_CONFIG.planningUnitMaxCompactHandoffBytes}\` | \`${PLANNING_DECOMPOSITION_CONFIG_MAXIMA.planningUnitMaxCompactHandoffBytes}\` | Maximum compact handoff size carried between planning-unit steps. |`);
  lines.push(`| \`compile.planningUnitMaxLocalExplorationToolUses\` | \`${DEFAULT_PLANNING_DECOMPOSITION_CONFIG.planningUnitMaxLocalExplorationToolUses}\` | \`${PLANNING_DECOMPOSITION_CONFIG_MAXIMA.planningUnitMaxLocalExplorationToolUses}\` | Maximum local exploration tool uses per planning unit. |`);
  lines.push(`| \`compile.planningUnitMaxCriteriaPerUnit\` | \`${DEFAULT_PLANNING_DECOMPOSITION_CONFIG.planningUnitMaxCriteriaPerUnit}\` | \`${PLANNING_DECOMPOSITION_CONFIG_MAXIMA.planningUnitMaxCriteriaPerUnit}\` | Maximum acceptance criteria assigned to one planning unit. |`);
  lines.push(`| \`compile.planningUnitMaxSubsystemsPerUnit\` | \`${DEFAULT_PLANNING_DECOMPOSITION_CONFIG.planningUnitMaxSubsystemsPerUnit}\` | \`${PLANNING_DECOMPOSITION_CONFIG_MAXIMA.planningUnitMaxSubsystemsPerUnit}\` | Maximum subsystems assigned to one planning unit. |`);
  lines.push(`| \`compile.planningUnitMaxSplitAttemptsPerUnit\` | \`${DEFAULT_PLANNING_DECOMPOSITION_CONFIG.planningUnitMaxSplitAttemptsPerUnit}\` | \`${PLANNING_DECOMPOSITION_CONFIG_MAXIMA.planningUnitMaxSplitAttemptsPerUnit}\` | Maximum split retries attempted for one planning unit. |`);
  lines.push(`| \`compile.directPrBaseSyncConflictAttempts\` | \`${DEFAULT_PLANNING_DECOMPOSITION_CONFIG.directPrBaseSyncConflictAttempts}\` | \`${PLANNING_DECOMPOSITION_CONFIG_MAXIMA.directPrBaseSyncConflictAttempts}\` | Conflict-resolution attempt budget for direct non-stacked PR base sync. Explicit per-call overrides take precedence over config; the selected value is clamped to \`1\`-\`${PLANNING_DECOMPOSITION_CONFIG_MAXIMA.directPrBaseSyncConflictAttempts}\`. |`);
  lines.push('');
  lines.push('## Recovery auto-resume');
  lines.push('');
  lines.push('`recovery.autoResume` is disabled by default. With the default config, queued builds keep the existing failure handling and manual recovery routes/tools remain available; no auto-resume audit events or attempt state are written.');
  lines.push('');
  lines.push('| Field | Default | Description |');
  lines.push('|-------|---------|-------------|');
  lines.push('| `recovery.autoResume.enabled` | `false` | Opt in to daemon-owned bounded auto-resume for high-confidence compiled-artifact `continue-repair` recommendations. |');
  lines.push('| `recovery.autoResume.maxAttempts` | `1` | Maximum automatic continue-repair attempts per failed PRD. `0` is audit-only/non-mutating mode. |');
  lines.push('');
  lines.push('Policy audit events surface attempt counts and stop reasons such as `disabled`, `attempt-budget-exhausted`, `not-continue-repair`, `not-high-confidence`, `not-eligible`, `manual-confirmation-required`, and `error`.');
  lines.push('');
  lines.push('```yaml');
  lines.push('recovery:');
  lines.push('  autoResume:');
  lines.push('    enabled: false');
  lines.push('    maxAttempts: 1');
  lines.push('```');
  lines.push('');
  lines.push('## Runtime Choices and Routing');
  lines.push('');
  lines.push('`agents.tiers.<tier>` defines the default runtime recipe for roles assigned to that tier. A tier can also declare tier-local `choices` overlays and ordered `routing.rules` to select a choice per agent invocation. The implicit `default` choice is the tier recipe itself.');
  lines.push('');
  lines.push('```yaml');
  lines.push('agents:');
  lines.push('  tiers:');
  lines.push('    implementation:');
  lines.push('      harness: pi');
  lines.push('      model: anthropic/claude-sonnet-4-6');
  lines.push('      effort: medium');
  lines.push('      pi:');
  lines.push('        provider: openrouter');
  lines.push('      choices:');
  lines.push('        ui:');
  lines.push('          model: anthropic/claude-opus-4-6');
  lines.push('          effort: high');
  lines.push('          toolbelt: browser-ui');
  lines.push('        backend:');
  lines.push('          model: openai/gpt-5.4');
  lines.push('          pi:');
  lines.push('            provider: openrouter');
  lines.push('      routing:');
  lines.push('        rules:');
  lines.push('          - name: ui-paths');
  lines.push('            choice: ui');
  lines.push('            when:');
  lines.push('              pathGlobs: ["web/**", "packages/console-ui/**"]');
  lines.push('          - name: backend-keywords');
  lines.push('            choice: implementation.backend');
  lines.push('            when:');
  lines.push('              keywords: ["api", "database"]');
  lines.push('```');
  lines.push('');
  lines.push('| Field | Description |');
  lines.push('|-------|-------------|');
  lines.push('| `agents.tiers.<tier>.choices.<choice>` | Optional named runtime-choice overlay. Choice names are lowercase slugs starting with a letter; `default` is reserved for the implicit tier default. |');
  lines.push('| `agents.tiers.<tier>.choices.<choice>.harness` | Optional harness override. If omitted, inherited from the tier default. |');
  lines.push('| `agents.tiers.<tier>.choices.<choice>.model` | Optional model override. If omitted, inherited from the tier default. |');
  lines.push('| `agents.tiers.<tier>.choices.<choice>.effort` | Optional effort override. If omitted, inherited from the tier default. |');
  lines.push('| `agents.tiers.<tier>.choices.<choice>.pi` / `.claudeSdk` | Optional harness-specific overrides. The effective recipe must match the selected harness. |');
  lines.push('| `agents.tiers.<tier>.choices.<choice>.toolbelt` | Optional toolbelt override for this choice; uses the same `tools.toolbelts` names or `none` as tier-level `toolbelt`. |');
  lines.push('| `agents.tiers.<tier>.routing.rules` | Ordered runtime-choice routing rules. The first matching rule selects its `choice`; if no rule matches, eforge uses `default` or an extension-router/fallback decision when configured. |');
  lines.push('| `agents.tiers.<tier>.routing.rules[].name` | Required human-readable rule identifier, surfaced in runtime-choice metadata. |');
  lines.push('| `agents.tiers.<tier>.routing.rules[].choice` | Required choice reference: `default`, a tier-local choice name such as `ui`, or a qualified same-tier reference such as `implementation.ui`. Cross-tier references are rejected. |');
  lines.push('| `agents.tiers.<tier>.routing.rules[].when.roles` | Match agent roles assigned to this tier. |');
  lines.push('| `agents.tiers.<tier>.routing.rules[].when.phase` | Match invocation phases such as `compile` or `build`. |');
  lines.push('| `agents.tiers.<tier>.routing.rules[].when.stage` | Match invocation stage names. |');
  lines.push('| `agents.tiers.<tier>.routing.rules[].when.pathGlobs` | Match plan or shard paths using path globs. |');
  lines.push('| `agents.tiers.<tier>.routing.rules[].when.keywords` | Match invocation keywords. |');
  lines.push('| `agents.tiers.<tier>.routing.rules[].when.shardIds` | Match compile shard identifiers. |');
  lines.push('| `agents.tiers.<tier>.routing.rules[].when.shardRoots` | Match compile shard root paths. |');
  lines.push('');
  lines.push('Choice overlays inherit from the containing tier default before validation, so a choice may specify only the fields it changes. After inheritance, every effective recipe must have a valid `harness`, `model`, `effort`, and harness-specific provider/config. Routing rules are tier-local: they cannot select a choice declared under another tier. The `when` block must include at least one predicate group; groups are combined as a match for that rule, and rules are evaluated in list order.');
  lines.push('');
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
  lines.push('**Per-run override:** Individual builds and extension-originated enqueue requests can override the policy via the `landingAutoMerge` field in the enqueue body (CLI: `--landing-auto-merge` / `--no-landing-auto-merge`). Omitting the field defers to the `landing.pr.autoMerge` policy.');
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
  lines.push('| `stacking.sync.afterBuild` | Trigger daemon-owned stack sync after every build. Default `false`. When enabled, the daemon automatically runs `git-spice stack restack` after each build completes. When active builds are running, sync is deferred until those builds finish (`outcome: deferred`). |');
  lines.push('');
  lines.push('**Stack sync outcomes:**');
  lines.push('');
  lines.push('| Outcome | Description |');
  lines.push('|---------|-------------|');
  lines.push('| `complete` | All eligible artifact branches were restacked onto the latest trunk. |');
  lines.push('| `skipped` | Stacking is not enabled or no eligible branches found. |');
  lines.push('| `deferred` | Active builds are running whose worktrees overlap the stack candidate set. Sync was deferred; the daemon retries automatically after those builds complete. |');
  lines.push('| `failed` | The sync command exited with a non-zero code. |');
  lines.push('| `conflict` | A restack step hit a merge conflict requiring manual resolution. |');
  lines.push('');
  lines.push('**PRD frontmatter stacking fields:**');
  lines.push('');
  lines.push('| Field | Description |');
  lines.push('|-------|-------------|');
  lines.push('| `stack_id` | Logical stack name shared by all PRDs in the stack. Optional; inferred from root PRD id. |');
  lines.push('| `stack_parent` | Parent PRD id. Optional for single-dependency PRDs (inferred from `depends_on`); required for multi-dependency PRDs. |');
  lines.push('');
  lines.push('## Workflow Presets');
  lines.push('');
  lines.push('Workflow presets bundle landing action, stacking, and PR settings into a named preset. Use `/eforge:workflow` (Claude Code) or `/eforge:workflow` (Pi) to configure interactively without editing `eforge/config.yaml` manually.');
  lines.push('');
  lines.push('| Preset | When selected | Config keys written |');
  lines.push('|--------|--------------|---------------------|');
  lines.push('| `solo-merge` | Solo developer, direct merge to trunk | `landing.action: merge`, `build.allowLocalMergeToTrunk: true`, `stacking.enabled: false` |');
  lines.push('| `solo-pr` | Solo developer, PR workflow, no stacking | `landing.action: pr`, `landing.pr.autoMerge: always`, `stacking.enabled: false` |');
  lines.push('| `team-pr` | Team project, PR workflow, no stacking | `landing.action: pr`, `landing.pr.autoMerge: ask`, `stacking.enabled: false` |');
  lines.push('| `stacked-pr` | git-spice stacking, manual sync | `landing.action: pr`, `stacking.enabled: true` |');
  lines.push('| `stacked-pr-autosync` | git-spice stacking, daemon-owned after-build sync | `landing.action: pr`, `stacking.enabled: true`, `stacking.sync.afterBuild: true` |');
  lines.push('');
  lines.push('For stacking presets where the user provides a non-default git-spice path, `stacking.gitSpice.command` is also written.');
  lines.push('');
  lines.push('## Pre-Compile Trunk Sync');
  lines.push('');
  lines.push(
    '`build.trunkSync` controls the pre-compile trunk freshness gate that runs before the merge worktree is created for queued root builds. It fetches the configured remote trunk, resolves the fetched commit SHA, and compares it to the local trunk ref to select the best compile base.',
  );
  lines.push('');
  lines.push('```yaml');
  lines.push('build:');
  lines.push('  trunkSync:');
  lines.push("    enabled: true             # Default. Set to false for offline/local-only workflows.");
  lines.push("    remote: origin            # Remote to fetch trunk from (default: origin).");
  lines.push("    strategy: fetchedRemoteRef # Only 'fetchedRemoteRef' is supported in v1.");
  lines.push("    onDiverged: warn          # warn | fail | use-remote");
  lines.push('```');
  lines.push('');
  lines.push('| Field | Default | Description |');
  lines.push('|-------|---------|-------------|');
  lines.push(
    '| `build.trunkSync.enabled` | `true` | Enables the pre-compile fetch. Set to `false` for offline or local-only workflows. |',
  );
  lines.push(
    '| `build.trunkSync.remote` | `"origin"` | Remote name to fetch the trunk branch from. Must be a configured git remote name - not a URL or path. Must be non-empty, must not start with `-`, and must contain no whitespace or control characters. Invalid values fail the build before compile rather than falling back to the fetch-unavailable behavior. |',
  );
  lines.push(
    '| `build.trunkSync.strategy` | `"fetchedRemoteRef"` | Base selection strategy. Only `"fetchedRemoteRef"` is supported in v1. |',
  );
  lines.push(
    '| `build.trunkSync.onDiverged` | `"warn"` | Policy applied when local trunk and remote trunk have diverged. Values: `warn` emits a diagnostic and falls back to local trunk; `fail` fails the build before compile; `use-remote` uses the fetched SHA with a diagnostic. |',
  );
  lines.push('');
  lines.push(
    'Remote-ahead and equal cases always use the fetched remote SHA. Local-ahead-only cases use the local trunk ref with a diagnostic. Child stacked PRDs and feature-branch builds are not retargeted.',
  );
  lines.push('');
  lines.push(
    'When the configured remote is missing, the remote trunk branch does not exist, the fetch fails, or FETCH_HEAD cannot be resolved after the fetch, trunk sync is skipped. The build continues with the original candidate base and emits a planning diagnostic. The `onDiverged` policy applies only to true local/remote divergence, not to fetch failures or unavailable remotes.',
  );
  lines.push('');
  lines.push(
    'The `remote` value is validated before the fetch. Invalid values (URL, path, starts with `-`, whitespace/control characters) and invalid trunk branch refnames fail the build before compile - they do not fall back to the fetch-unavailable behavior. Use `enabled: false` to skip trunk sync for offline or local-only workflows.',
  );
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
