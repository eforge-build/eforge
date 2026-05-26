/**
 * Native Pi command handlers for workflow setup and reconfiguration.
 *
 * /eforge:workflow       — discoverability menu (init or reconfigure)
 * /eforge:workflow:init  — full wizard for initial config
 * /eforge:workflow:reconfigure — reconfiguration wizard with current config shown
 *
 * All fixed-choice questions use showSelectOverlay / showSearchableSelectOverlay.
 * No prompt asks the user to type a preset identifier.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { showSelectPanel, showInfoPanel, type UIContext } from './ui-helpers.js';
import {
  mapAnswersToPreset,
  getPresetConfigDelta,
  buildConfigChangeSummary,
  buildConfigChangeSummaryWithGitSpice,
  resolveGitSpiceRemediation,
  resolvePresetAfterRemediation,
  applyDeltaToConfig,
  type WizardAnswers,
  type WorkflowPresetId,
  type WorkflowConfigDelta,
} from './workflow-wizard-helpers.js';

// ---------------------------------------------------------------------------
// git-spice availability check
// ---------------------------------------------------------------------------

function isGitSpiceAvailable(command = 'git-spice'): boolean {
  try {
    execFileSync(command, ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Config read/write helpers
// ---------------------------------------------------------------------------

function readCurrentConfig(cwd: string): Record<string, unknown> {
  const configPath = join(cwd, 'eforge', 'config.yaml');
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = parseYaml(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // File does not exist or is unparseable — start fresh
  }
  return {};
}

function writeConfig(cwd: string, config: Record<string, unknown>): void {
  const configDir = join(cwd, 'eforge');
  const configPath = join(configDir, 'config.yaml');
  mkdirSync(configDir, { recursive: true });
  const content = Object.keys(config).length > 0 ? stringifyYaml(config) : '';
  writeFileSync(configPath, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Shared wizard flow
// ---------------------------------------------------------------------------

/**
 * Run the multi-step workflow wizard.
 *
 * @param ctx       Pi UIContext (must have hasUI: true)
 * @param initMode  When true, treats this as initial setup (fresh config).
 *                  When false, loads and shows the current config first.
 */
async function runWorkflowWizard(
  ctx: UIContext,
  initMode: boolean,
): Promise<void> {
  const cwd = ctx.cwd;

  // -- Reconfigure: show current config summary first --
  if (!initMode) {
    const current = readCurrentConfig(cwd);
    if (Object.keys(current).length > 0) {
      const lines: string[] = ['## Current eforge workflow config\n'];
      const landing = current.landing as Record<string, unknown> | undefined;
      const build = current.build as Record<string, unknown> | undefined;
      const stacking = current.stacking as Record<string, unknown> | undefined;

      if (landing?.action) lines.push(`- Landing action: **${landing.action}**`);
      if (landing?.pr && typeof landing.pr === 'object') {
        const pr = landing.pr as Record<string, unknown>;
        if (pr.autoMerge) lines.push(`- PR auto-merge: **${pr.autoMerge}**`);
      }
      if (build?.allowLocalMergeToTrunk !== undefined) {
        lines.push(`- Allow direct merge to trunk: **${build.allowLocalMergeToTrunk}**`);
      }
      if (stacking?.enabled !== undefined) {
        lines.push(`- Stacking: **${stacking.enabled ? 'enabled' : 'disabled'}**`);
      }
      if (stacking?.gitSpice && typeof stacking.gitSpice === 'object') {
        const gs = stacking.gitSpice as Record<string, unknown>;
        if (gs.command) lines.push(`- git-spice command: \`${gs.command}\``);
      }
      if (Array.isArray(build?.postMergeCommands) && (build?.postMergeCommands as string[]).length > 0) {
        lines.push(`- Post-merge commands: \`${(build.postMergeCommands as string[]).join(', ')}\``);
      }

      await showInfoPanel(
        ctx,
        'eforge - Current Workflow Config',
        lines.join('\n'),
      );
    }
  }

  // -- Step 1: Context (solo vs team) --
  const contextChoice = await showSelectPanel(ctx, 'eforge - Workflow: Context', [
    {
      value: 'solo',
      label: 'Solo developer',
      description: 'Just me — I commit and merge directly to trunk or open my own PRs',
    },
    {
      value: 'team',
      label: 'Team project',
      description: 'Multiple contributors — PRs go through review before merging',
    },
  ]);
  if (!contextChoice) return;
  const context = contextChoice as WizardAnswers['context'];

  // -- Step 2: Landing action --
  const landingItems =
    context === 'solo'
      ? [
          {
            value: 'merge',
            label: 'Direct merge to trunk',
            description: 'Builds merge directly to the trunk branch (requires allowLocalMergeToTrunk)',
          },
          {
            value: 'pr',
            label: 'Open a pull request',
            description: 'Each build opens a GitHub PR targeting the base branch',
          },
        ]
      : [
          {
            value: 'pr',
            label: 'Open a pull request',
            description: 'Each build opens a GitHub PR for review before merging',
          },
          {
            value: 'merge',
            label: 'Direct merge to trunk',
            description: 'Skip PRs — merge directly to trunk (unusual for teams)',
          },
        ];

  const landingChoice = await showSelectPanel(ctx, 'eforge - Workflow: Landing', landingItems);
  if (!landingChoice) return;
  const landing = landingChoice as WizardAnswers['landing'];

  // -- Step 3: Stacking (only when using PRs) --
  let stacking: WizardAnswers['stacking'] = 'none';
  if (landing === 'pr') {
    const stackingChoice = await showSelectPanel(ctx, 'eforge - Workflow: Stacking', [
      {
        value: 'none',
        label: 'No stacking',
        description: 'Each build PR targets the trunk branch independently',
      },
      {
        value: 'git-spice',
        label: 'Stacked PRs (git-spice)',
        description: 'Each build PR targets the parent artifact branch — requires git-spice',
      },
    ]);
    if (!stackingChoice) return;
    stacking = stackingChoice as WizardAnswers['stacking'];
  }

  // -- Step 4: git-spice remediation (when stacking selected but git-spice unavailable) --
  let gitSpiceCommand: string | undefined;
  if (stacking === 'git-spice') {
    const spiceCmd = 'git-spice';
    if (!isGitSpiceAvailable(spiceCmd)) {
      const remediationChoice = await showSelectPanel(
        ctx,
        'eforge - git-spice Not Found',
        [
          {
            value: 'configure-path',
            label: 'Configure git-spice path',
            description: 'Enter the path or command name for your git-spice installation',
          },
          {
            value: 'disable-stacking',
            label: 'Continue without stacking',
            description: 'Set up a PR workflow without git-spice (you can enable stacking later)',
          },
          {
            value: 'cancel',
            label: 'Cancel',
            description: 'Abort the wizard — install git-spice first',
          },
        ],
      );
      if (!remediationChoice) return;

      const choice = remediationChoice as 'configure-path' | 'disable-stacking' | 'cancel';

      if (choice === 'cancel') return;

      if (choice === 'configure-path') {
        // Ask for the path using the editor (text input)
        const pathInput = await ctx.ui.editor(
          'git-spice command path',
          'git-spice',
        );
        if (!pathInput || !pathInput.trim()) return;
        gitSpiceCommand = pathInput.trim();
        // Verify the configured path
        if (!isGitSpiceAvailable(gitSpiceCommand)) {
          await showInfoPanel(
            ctx,
            'eforge - Warning',
            `Could not verify git-spice at \`${gitSpiceCommand}\`. The path will be saved in config but stacking may not work until git-spice is installed at that location.\n\nProceeding with the configured path.`,
          );
        }
      } else {
        // disable-stacking: adjust stacking answer
        stacking = 'none';
      }
    }
  }

  // -- Step 5: Auto-sync (only when stacking is still enabled) --
  let autoSync: WizardAnswers['autoSync'] = 'no';
  if (stacking === 'git-spice') {
    const autoSyncChoice = await showSelectPanel(
      ctx,
      'eforge - Workflow: Auto Stack Sync',
      [
        {
          value: 'no',
          label: 'Manual stack sync',
          description: 'Run `eforge stack sync` (or /eforge:stack:sync) manually when needed',
        },
        {
          value: 'yes',
          label: 'Automatic stack sync',
          description: 'Add `eforge stack sync` as a post-merge command so the stack syncs after every build',
        },
      ],
    );
    if (!autoSyncChoice) return;
    autoSync = autoSyncChoice as WizardAnswers['autoSync'];
  }

  // -- Map answers to preset --
  const answers: WizardAnswers = { context, landing, stacking, autoSync };
  const preset = mapAnswersToPreset(answers);

  // -- Determine effective delta (may include gitSpiceCommand from remediation) --
  let effectiveDelta: WorkflowConfigDelta;
  if (gitSpiceCommand) {
    const remediationResult = resolveGitSpiceRemediation('configure-path', gitSpiceCommand);
    const resolved = resolvePresetAfterRemediation(preset.id as WorkflowPresetId, remediationResult);
    if (!resolved) return;
    effectiveDelta = resolved.delta;
  } else {
    effectiveDelta = getPresetConfigDelta(preset.id as WorkflowPresetId);
  }

  // -- Build change summary for confirmation panel --
  const changeItems = gitSpiceCommand
    ? buildConfigChangeSummaryWithGitSpice(preset.id as WorkflowPresetId, gitSpiceCommand)
    : buildConfigChangeSummary(preset.id as WorkflowPresetId);

  const summaryLines: string[] = [
    `## Workflow Preset: ${preset.label}`,
    '',
    preset.description,
    '',
    '### Config changes:',
    '',
    ...changeItems.map((item) => `- ${item.description}`),
    '',
    'These changes will be written to `eforge/config.yaml`.',
    '',
  ];

  if (!initMode) {
    summaryLines.push('*Existing config keys not covered by this preset will be preserved.*');
    summaryLines.push('');
  }

  await showInfoPanel(ctx, 'eforge - Workflow Summary', summaryLines.join('\n'));

  // -- Confirm --
  const confirm = await showSelectPanel(
    ctx,
    `eforge - Apply Preset: ${preset.label}`,
    [
      {
        value: 'apply',
        label: '✓ Apply',
        description: 'Write the changes to eforge/config.yaml',
      },
      {
        value: 'cancel',
        label: '✗ Cancel',
        description: 'Abort without writing',
      },
    ],
  );
  if (confirm !== 'apply') return;

  // -- Write config (exactly once per confirmed write) --
  const currentConfig = initMode ? {} : readCurrentConfig(cwd);
  const newConfig = applyDeltaToConfig(currentConfig, effectiveDelta);
  writeConfig(cwd, newConfig);

  await showInfoPanel(
    ctx,
    'eforge - Workflow Applied',
    `✓ Preset **${preset.label}** applied.\n\n\`eforge/config.yaml\` has been updated.\n\nUse \`/eforge:config\` to view the full configuration.`,
  );
}

// ---------------------------------------------------------------------------
// Exported command handlers
// ---------------------------------------------------------------------------

/**
 * /eforge:workflow — discoverability menu: init or reconfigure.
 */
export async function handleWorkflowCommand(
  pi: ExtensionAPI,
  ctx: UIContext | null,
  _args: string,
): Promise<void> {
  if (!ctx || !ctx.hasUI) {
    pi.sendUserMessage('Use `/eforge:workflow:init` to set up workflow config or `/eforge:workflow:reconfigure` to change it.');
    return;
  }

  const choice = await showSelectPanel(ctx, 'eforge - Workflow', [
    {
      value: 'init',
      label: 'Set up workflow',
      description: 'Run the wizard to configure landing action, stacking, and PR settings for this project',
    },
    {
      value: 'reconfigure',
      label: 'Reconfigure workflow',
      description: 'Change workflow settings — shows current config before presenting wizard',
    },
  ]);

  if (!choice) return;

  if (choice === 'init') {
    await runWorkflowWizard(ctx, true);
  } else {
    await runWorkflowWizard(ctx, false);
  }
}

/**
 * /eforge:workflow:init — wizard for initial workflow configuration.
 */
export async function handleWorkflowInitCommand(
  pi: ExtensionAPI,
  ctx: UIContext | null,
  _args: string,
): Promise<void> {
  if (!ctx || !ctx.hasUI) {
    pi.sendUserMessage('The workflow wizard requires an interactive Pi session. Use `/eforge:workflow:init` from an active Pi session.');
    return;
  }
  await runWorkflowWizard(ctx, true);
}

/**
 * /eforge:workflow:reconfigure — wizard to change existing workflow settings.
 */
export async function handleWorkflowReconfigureCommand(
  pi: ExtensionAPI,
  ctx: UIContext | null,
  _args: string,
): Promise<void> {
  if (!ctx || !ctx.hasUI) {
    pi.sendUserMessage('The workflow wizard requires an interactive Pi session. Use `/eforge:workflow:reconfigure` from an active Pi session.');
    return;
  }
  await runWorkflowWizard(ctx, false);
}
