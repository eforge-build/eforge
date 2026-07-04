
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { API_ROUTES, buildPath, buildProfileListPath, type ProfileListResponse } from "@eforge-build/client";
import { piDaemonRequest, DAEMON_NOT_RUNNING_GUIDANCE } from "./daemon-requests.js";
import { showSelectOverlay, showSearchableSelectOverlay, showInfoOverlay, withLoader, type UIContext } from "./ui-helpers";
import { buildProfileCreatePayload, type TierSelection, type TierRuntimeChoicesSelection } from "./profile-payload";
import { buildYamlPreview } from "./profile-yaml-preview";
import { TOOLBELT_PRESETS, findMissingServers, applyToolbeltPresetToTiers, applyNoMcpAccessToTiers } from "./toolbelt-presets";
import { readMcpServers, addPlaywrightServer, upsertToolbeltInConfig } from "./toolbelt-config-files";


async function ensureBrowserUiToolbelt(ctx: UIContext): Promise<boolean> {
  const preset = TOOLBELT_PRESETS.find((p) => p.id === 'browser-ui');
  if (!preset) return false;

  let existingServers: Record<string, unknown> = {};
  try {
    existingServers = readMcpServers(ctx.cwd);
  } catch {
  }

  const missing = findMissingServers(preset, existingServers);
  if (missing.length > 0) {
    const autoAddChoice = await showSelectOverlay(ctx, 'eforge - Add MCP Servers for UI Runtime Choice?', [
      { value: 'yes', label: 'Yes, add automatically', description: `Add ${missing.join(', ')} to .mcp.json` },
      { value: 'no', label: 'No, omit browser-ui toolbelt', description: preset.setupHint },
    ]);
    if (autoAddChoice !== 'yes') return false;

    for (const serverName of missing) {
      const serverConfig = preset.autoAdd?.servers[serverName];
      if (!serverConfig) return false;
      try {
        if (serverName === 'playwright') addPlaywrightServer(ctx.cwd, serverConfig);
      } catch (err) {
        await showInfoOverlay(
          ctx,
          'eforge - Warning',
          `Could not auto-add ${serverName} to .mcp.json:\n\n${err instanceof Error ? err.message : String(err)}\n\nThe UI runtime choice will omit the browser-ui toolbelt.`,
        );
        return false;
      }
    }
  }

  try {
    upsertToolbeltInConfig(ctx.cwd, preset);
    return true;
  } catch (err) {
    await showInfoOverlay(
      ctx,
      'eforge - Warning',
      `Could not update eforge/config.yaml:\n\n${err instanceof Error ? err.message : String(err)}\n\nThe UI runtime choice will omit the browser-ui toolbelt.`,
    );
    return false;
  }
}


export async function handleProfileCommand(
  pi: ExtensionAPI,
  ctx: UIContext | null,
  args: string,
  onStatusRefresh: () => Promise<void>,
): Promise<void> {
  if (!ctx || !ctx.hasUI) {
    pi.sendUserMessage(`/skill:eforge-profile${args ? " " + args : ""}`);
    return;
  }

  const profileName = args.trim();
  if (profileName) {
    try {
      const switchResult = await withLoader(ctx, "Switching profile...", () =>
        piDaemonRequest(ctx.cwd, "POST", API_ROUTES.profileUse, { name: profileName }),
      );
      if (switchResult === null) {
        await showInfoOverlay(ctx, "eforge - Daemon Not Running", DAEMON_NOT_RUNNING_GUIDANCE);
        return;
      }
      await onStatusRefresh();
      await showInfoOverlay(
        ctx,
        "eforge - Profile Switched",
        `Switched to profile **${profileName}**.\n\nThe next eforge build will use this profile.`,
      );
    } catch (err) {
      await showInfoOverlay(
        ctx,
        "eforge - Error",
        `Failed to switch to profile "${profileName}":\n\n${err instanceof Error ? err.message : String(err)}\n\nUse \`/eforge:profile\` with no args to list available profiles.`,
      );
    }
    return;
  }

  let listData: ProfileListResponse;
  try {
    const result = await withLoader(ctx, "Loading profiles...", () =>
      piDaemonRequest<ProfileListResponse>(ctx.cwd, "GET", buildProfileListPath({ scope: "all" })),
    );
    if (result === null) {
      await showInfoOverlay(ctx, "eforge - Daemon Not Running", DAEMON_NOT_RUNNING_GUIDANCE);
      return;
    }
    listData = result.data;
  } catch (err) {
    await showInfoOverlay(
      ctx,
      "eforge - Error",
      `Failed to load profiles:\n\n${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  const { active } = listData;
  const profiles = listData.profiles.filter((profile) => !profile.shadowedBy);

  if (profiles.length === 0) {
    await showInfoOverlay(
      ctx,
      "eforge - Profiles",
      "No profiles found.\n\nUse `/eforge:profile:new` to create one.",
    );
    return;
  }

  const items = profiles.map((p) => {
    const activeMarker = p.name === active ? "●" : "○";
    const scopeBadge = p.shadowedBy ? `${p.scope} (shadowed)` : p.scope;
    const harnessType = p.harness ?? "unknown";
    const descPart = p.metadata?.description ? ` - ${p.metadata.description}` : '';
    return {
      value: p.name,
      label: `${activeMarker} ${p.name}`,
      description: `${scopeBadge} - ${harnessType}${descPart}`,
    };
  });

  const selected = await showSelectOverlay(ctx, "eforge - Profiles", items);
  if (!selected) return;

  const selectedProfile = profiles.find((p) => p.name === selected);
  if (
    selectedProfile?.metadata &&
    (selectedProfile.metadata.description ||
      (selectedProfile.metadata.whenToUse?.length ?? 0) > 0 ||
      (selectedProfile.metadata.tags?.length ?? 0) > 0)
  ) {
    const metaLines: string[] = [];
    if (selectedProfile.metadata.description) {
      metaLines.push(`**Description:** ${selectedProfile.metadata.description}`);
    }
    if (selectedProfile.metadata.whenToUse?.length) {
      metaLines.push(`\n**Use when:**`);
      for (const w of selectedProfile.metadata.whenToUse) {
        metaLines.push(`- ${w}`);
      }
    }
    if (selectedProfile.metadata.tags?.length) {
      metaLines.push(`\n**Tags:** ${selectedProfile.metadata.tags.join(', ')}`);
    }
    await showInfoOverlay(ctx, `eforge - Profile: ${selected}`, metaLines.join('\n'));
  }

  const isActive = selected === active;
  const detailItems = isActive
    ? [
        { value: "info", label: "● Currently active", description: `${selected} is the active profile` },
        { value: "close", label: "Close", description: "Go back" },
      ]
    : [
        { value: "switch", label: "Switch to this profile", description: `Activate ${selected}` },
        { value: "close", label: "Close", description: "Go back" },
      ];

  const action = await showSelectOverlay(ctx, `eforge - Profile: ${selected}`, detailItems);

  if (action === "switch") {
    try {
      const switchResult = await withLoader(ctx, "Switching profile...", () =>
        piDaemonRequest(ctx.cwd, "POST", API_ROUTES.profileUse, { name: selected }),
      );
      if (switchResult === null) {
        await showInfoOverlay(ctx, "eforge - Daemon Not Running", DAEMON_NOT_RUNNING_GUIDANCE);
        return;
      }
      await onStatusRefresh();
      await showInfoOverlay(
        ctx,
        "eforge - Profile Switched",
        `Switched to profile **${selected}**.\n\nThe next eforge build will use this profile.`,
      );
    } catch (err) {
      await showInfoOverlay(
        ctx,
        "eforge - Error",
        `Failed to switch profile:\n\n${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}


/** Model info as returned by the daemon models list endpoint. */
interface ModelInfo {
  id: string;
  provider?: string;
  releasedAt?: string;
}

const TIER_ORDER = ['planning', 'implementation', 'review', 'evaluation'] as const;
type TierName = typeof TIER_ORDER[number];

/** Load model list from the daemon for a given harness/provider. Returns null on error (error shown). */
async function loadModelsList(
  ctx: UIContext,
  harness: string,
  provider?: string,
): Promise<ModelInfo[] | null> {
  const params = new URLSearchParams({ harness });
  if (provider) params.set("provider", provider);
  try {
    const result = await withLoader(ctx, "Loading models...", () =>
      piDaemonRequest<{ models: ModelInfo[] }>(
        ctx.cwd,
        "GET",
        `${API_ROUTES.modelList}?${params.toString()}`,
      ),
    );
    if (result === null) {
      await showInfoOverlay(ctx, "eforge - Daemon Not Running", DAEMON_NOT_RUNNING_GUIDANCE);
      return null;
    }
    if (result.data.models.length === 0) {
      await showInfoOverlay(ctx, "eforge - Error", "No models available for the selected harness/provider.");
      return null;
    }
    return result.data.models;
  } catch (err) {
    await showInfoOverlay(
      ctx,
      "eforge - Error",
      `Failed to load models:\n\n${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Run the custom harness + provider + model + effort sub-flow for a single tier.
 */
async function pickCustomTier(
  ctx: UIContext,
  tierLabel: string,
  defaultHarness: "claude-sdk" | "pi",
  defaultProvider?: string,
): Promise<TierSelection | null> {
  const harnessItems =
    defaultHarness === "claude-sdk"
      ? [
          { value: "claude-sdk", label: "Claude SDK", description: "Anthropic-specific Agent SDK (credit/API-priced)" },
          { value: "pi", label: "Pi", description: "Recommended provider-flexible harness via Pi SDK" },
        ]
      : [
          {
            value: "pi",
            label: "Pi",
            description: "Recommended provider-flexible harness (OpenRouter, Anthropic, OpenAI, Google, local, etc.)",
          },
          { value: "claude-sdk", label: "Claude SDK", description: "Anthropic-specific Agent SDK (credit/API-priced)" },
        ];

  const harness = (await showSelectOverlay(ctx, `eforge - ${tierLabel}: Harness`, harnessItems)) as
    | "claude-sdk"
    | "pi"
    | null;
  if (!harness) return null;

  let provider: string | undefined;
  if (harness === "pi") {
    let providers: string[];
    try {
      const result = await withLoader(ctx, "Loading providers...", () =>
        piDaemonRequest<{ providers: string[] }>(ctx.cwd, "GET", `${API_ROUTES.modelProviders}?harness=pi`),
      );
      if (result === null) {
        await showInfoOverlay(ctx, "eforge - Daemon Not Running", DAEMON_NOT_RUNNING_GUIDANCE);
        return null;
      }
      providers = result.data.providers;
    } catch (err) {
      await showInfoOverlay(
        ctx,
        "eforge - Error",
        `Failed to load providers:\n\n${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
    if (providers.length === 0) {
      await showInfoOverlay(ctx, "eforge - Error", "No providers available for the Pi harness.");
      return null;
    }

    const providerItems =
      defaultProvider && providers.includes(defaultProvider)
        ? [
            { value: defaultProvider, label: defaultProvider, description: "Previously selected" },
            ...providers
              .filter((p) => p !== defaultProvider)
              .map((p) => ({ value: p, label: p, description: `Provider: ${p}` })),
          ]
        : providers.map((p) => ({ value: p, label: p, description: `Provider: ${p}` }));

    const selectedProvider = await showSearchableSelectOverlay(
      ctx,
      `eforge - ${tierLabel}: Provider`,
      providerItems,
    );
    if (!selectedProvider) return null;
    provider = selectedProvider;
  }

  const models = await loadModelsList(ctx, harness, provider);
  if (!models) return null;

  const modelItems = models.map((m) => ({
    value: m.id,
    label: m.id,
    description: [m.provider, m.releasedAt].filter(Boolean).join(" - ") || undefined,
  }));

  const modelId = await showSearchableSelectOverlay(ctx, `eforge - ${tierLabel}: Model`, modelItems);
  if (!modelId) return null;

  const effortItems = [
    { value: "high",   label: "high",   description: "Maximum capability — best for planning and complex tasks" },
    { value: "medium", label: "medium", description: "Balanced — good for most implementation work" },
    { value: "low",    label: "low",    description: "Fast and efficient — good for review and evaluation" },
  ];
  const effort = await showSelectOverlay(ctx, `eforge - ${tierLabel}: Effort`, effortItems);
  if (!effort) return null;

  return { harness, provider, modelId, effort };
}

export async function handleProfileNewCommand(
  pi: ExtensionAPI,
  ctx: UIContext | null,
  args: string,
  onStatusRefresh: () => Promise<void>,
): Promise<void> {
  if (!ctx || !ctx.hasUI) {
    pi.sendUserMessage(`/skill:eforge-profile-new${args ? " " + args : ""}`);
    return;
  }

  const name = args.trim();
  if (!name) {
    pi.sendUserMessage(
      "Please provide a name for the new profile. For example: `/eforge:profile:new my-profile`",
    );
    return;
  }

  const scope = await showSelectOverlay(ctx, "eforge - New Profile: Scope", [
    { value: "project", label: "Project scope", description: "eforge/profiles/ - committed with the project" },
    { value: "user", label: "User scope", description: "~/.config/eforge/profiles/ - reusable across projects" },
    {
      value: "local",
      label: "Local scope",
      description: ".eforge/profiles/ - gitignored, dev-personal, highest precedence",
    },
  ]) as "project" | "user" | "local" | null;
  if (!scope) return;

  const tierSelections: Partial<Record<TierName, TierSelection>> = {};

  for (let i = 0; i < TIER_ORDER.length; i++) {
    const tier = TIER_ORDER[i];
    const tierLabel = `New Profile: ${tier}`;

    const choiceItems: Array<{ value: string; label: string; description: string }> = [];

    for (const srcTier of TIER_ORDER.slice(0, i)) {
      const srcSelection = tierSelections[srcTier];
      if (srcSelection) {
        const srcDesc = [
          srcSelection.harness,
          srcSelection.provider,
          srcSelection.modelId,
          `effort: ${srcSelection.effort}`,
        ].filter(Boolean).join(" · ");
        choiceItems.push({
          value: `__copy_${srcTier}__`,
          label: `Copy from ${srcTier} (${srcSelection.modelId})`,
          description: srcDesc,
        });
      }
    }

    choiceItems.push({
      value: "__custom__",
      label: "Custom",
      description: "Choose harness, provider, model, and effort manually",
    });

    const choice = await showSelectOverlay(ctx, `eforge - ${tierLabel}`, choiceItems);
    if (!choice) return;

    let selection: TierSelection;

    if (choice.startsWith("__copy_")) {
      const srcTierName = choice.slice("__copy_".length, -"__".length) as TierName;
      selection = { ...tierSelections[srcTierName]! };
    } else {
      const prevTier = i > 0 ? TIER_ORDER[i - 1] : null;
      const prevSelection = prevTier ? tierSelections[prevTier] : null;
      const defaultHarness = prevSelection?.harness ?? "pi";
      const result = await pickCustomTier(ctx, tierLabel, defaultHarness as "claude-sdk" | "pi", prevSelection?.provider);
      if (!result) return;
      selection = result;
    }

    tierSelections[tier] = selection;
  }

  const tiers = tierSelections as Record<TierName, TierSelection>;

  const presetChoiceItems: Array<{ value: string; label: string; description: string }> = [
    {
      value: '__none__',
      label: 'No project MCP access',
      description: 'Agents use only built-in tools — safest, least-privilege default',
    },
    ...TOOLBELT_PRESETS.map((p) => ({
      value: p.id,
      label: p.label,
      description: p.description,
    })),
    {
      value: '__skip__',
      label: 'Skip (configure manually)',
      description: 'Set toolbelt assignments directly in the profile YAML',
    },
  ];

  const presetChoice = await showSelectOverlay(ctx, 'eforge - New Profile: Toolbelt Preset', presetChoiceItems);
  if (!presetChoice) return;

  if (presetChoice !== '__skip__') {
    if (presetChoice === '__none__') {
      const updated = applyNoMcpAccessToTiers(tiers);
      for (const tier of TIER_ORDER) {
        tiers[tier] = { ...tiers[tier], toolbelt: updated[tier].toolbelt };
      }
    } else {
      const selectedPreset = TOOLBELT_PRESETS.find((p) => p.id === presetChoice)!;

      let existingServers: Record<string, unknown> = {};
      try {
        existingServers = readMcpServers(ctx.cwd);
      } catch {
      }
      const missing = findMissingServers(selectedPreset, existingServers);

      if (missing.length > 0 && selectedPreset.autoAdd) {
        const autoAddItems = [
          {
            value: 'yes',
            label: 'Yes, add automatically',
            description: `Add ${missing.join(', ')} to .mcp.json`,
          },
          {
            value: 'no',
            label: 'No, I will add manually',
            description: selectedPreset.setupHint,
          },
        ];
        const autoAddChoice = await showSelectOverlay(
          ctx,
          `eforge - Add MCP Servers for ${selectedPreset.label}?`,
          autoAddItems,
        );
        if (!autoAddChoice) return;

        if (autoAddChoice === 'yes') {
          for (const serverName of missing) {
            const serverConfig = selectedPreset.autoAdd.servers[serverName];
            if (serverConfig) {
              try {
                if (serverName === 'playwright') {
                  addPlaywrightServer(ctx.cwd, serverConfig);
                }
              } catch (err) {
                await showInfoOverlay(
                  ctx,
                  'eforge - Warning',
                  `Could not auto-add ${serverName} to .mcp.json:\n\n${err instanceof Error ? err.message : String(err)}\n\n${selectedPreset.setupHint}`,
                );
              }
            }
          }
        } else {
          await showInfoOverlay(
            ctx,
            `eforge - Setup Hint: ${selectedPreset.label}`,
            selectedPreset.setupHint,
          );
        }
      } else if (missing.length > 0) {
        await showInfoOverlay(
          ctx,
          `eforge - Setup Hint: ${selectedPreset.label}`,
          `Missing MCP servers: ${missing.join(', ')}\n\n${selectedPreset.setupHint}`,
        );
      }

      const updated = applyToolbeltPresetToTiers(selectedPreset, tiers);
      for (const tier of TIER_ORDER) {
        tiers[tier] = { ...tiers[tier], toolbelt: updated[tier].toolbelt };
      }

      try {
        upsertToolbeltInConfig(ctx.cwd, selectedPreset);
      } catch (err) {
        await showInfoOverlay(
          ctx,
          'eforge - Warning',
          `Could not update eforge/config.yaml:\n\n${err instanceof Error ? err.message : String(err)}\n\nYou may need to add the toolbelt definition manually.`,
        );
      }
    }

    try {
      const validateResult = await withLoader(ctx, 'Validating config...', () =>
        piDaemonRequest<{ valid: boolean; errors?: string[] }>(ctx.cwd, 'GET', API_ROUTES.configValidate),
      );
      if (validateResult === null) {
        await showInfoOverlay(ctx, 'eforge - Daemon Not Running', DAEMON_NOT_RUNNING_GUIDANCE);
        return;
      }
      if (!validateResult.data.valid && validateResult.data.errors?.length) {
        await showInfoOverlay(
          ctx,
          'eforge - Config Validation Warning',
          `Config has issues after applying preset:\n\n${validateResult.data.errors.join('\n')}\n\nYou may need to fix eforge/config.yaml before building.`,
        );
      }
    } catch {
    }
  }

  const runtimeChoices: Partial<Record<TierName, TierRuntimeChoicesSelection>> = {};
  const runtimeChoice = await showSelectOverlay(ctx, 'eforge - Implementation Runtime Choices?', [
    {
      value: 'add-ui-backend',
      label: 'Add UI/backend implementation choices',
      description: 'Create implementation.ui and implementation.backend with path/keyword routing rules',
    },
    {
      value: 'skip',
      label: 'Skip runtime choices',
      description: 'Use each tier default for every agent invocation',
    },
  ]);
  if (!runtimeChoice) return;

  if (runtimeChoice === 'add-ui-backend') {
    const backendChoice = tiers.implementation.harness === 'pi'
      ? { modelId: 'qwen3-coder', provider: 'local', toolbelt: 'none' }
      : { harness: 'pi' as const, modelId: 'qwen3-coder', provider: 'local', toolbelt: 'none' };
    const uiChoice = await ensureBrowserUiToolbelt(ctx)
      ? { effort: 'high', toolbelt: 'browser-ui' }
      : { effort: 'high', ...(tiers.implementation.toolbelt && tiers.implementation.toolbelt !== 'none' ? { toolbelt: tiers.implementation.toolbelt } : {}) };
    runtimeChoices.implementation = {
      choices: {
        backend: backendChoice,
        ui: uiChoice,
      },
      routing: {
        rules: [
          {
            name: 'ui-paths',
            choice: 'ui',
            when: {
              pathGlobs: ['packages/console-ui/**', 'web/**', '**/*.{tsx,jsx,css}'],
              keywords: ['ui', 'frontend', 'browser', 'component'],
            },
          },
          {
            name: 'backend-paths',
            choice: 'backend',
            when: {
              pathGlobs: ['packages/engine/**', 'packages/client/**', 'packages/monitor/**'],
            },
          },
        ],
      },
    };
  }

  const payload = buildProfileCreatePayload({
    name,
    scope,
    tiers: {
      planning: tiers.planning,
      implementation: tiers.implementation,
      review: tiers.review,
      evaluation: tiers.evaluation,
    },
    runtimeChoices,
  });

  const yamlPreview = buildYamlPreview(payload);
  await showInfoOverlay(
    ctx,
    `eforge - Profile Preview: ${name}`,
    `Profile **${name}** will be written to ${scope} scope:\n\n${yamlPreview}\n\nEdit the YAML file directly to fine-tune per-tier settings.`,
  );

  const planningModel = tiers.planning.modelId;
  const implModel = tiers.implementation.modelId;
  const reviewModel = tiers.review.modelId;
  const evalModel = tiers.evaluation.modelId;

  const confirm = await showSelectOverlay(
    ctx,
    `eforge - Confirm: ${name} (${scope})`,
    [
      {
        value: "create",
        label: "✓ Create profile",
        description: `planning: ${planningModel} / impl: ${implModel} / review: ${reviewModel} / eval: ${evalModel}`,
      },
      { value: "cancel", label: "✗ Cancel", description: "Abort" },
    ],
  );
  if (confirm !== "create") return;

  try {
    const createResult = await withLoader(ctx, "Creating profile...", () =>
      piDaemonRequest(ctx.cwd, "POST", API_ROUTES.profileCreate, payload as unknown as Record<string, unknown>),
    );
    if (createResult === null) {
      await showInfoOverlay(ctx, "eforge - Daemon Not Running", DAEMON_NOT_RUNNING_GUIDANCE);
      return;
    }
  } catch (err) {
    await showInfoOverlay(
      ctx,
      "eforge - Error",
      `Failed to create profile:\n\n${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  const activate = await showSelectOverlay(ctx, "eforge - Activate Profile?", [
    { value: "yes", label: `Activate ${name}`, description: "Make this the active profile" },
    { value: "no", label: "Not now", description: `Switch later with /eforge:profile ${name}` },
  ]);

  if (activate === "yes") {
    try {
      const activateResult = await withLoader(ctx, "Activating profile...", () =>
        piDaemonRequest(ctx.cwd, "POST", API_ROUTES.profileUse, { name, scope }),
      );
      if (activateResult === null) {
        await showInfoOverlay(ctx, "eforge - Daemon Not Running", DAEMON_NOT_RUNNING_GUIDANCE);
        return;
      }
      await onStatusRefresh();
      await showInfoOverlay(
        ctx,
        "eforge - Profile Created & Activated",
        `Profile **${name}** created and activated.\n\nThe next eforge build will use this profile.`,
      );
    } catch (err) {
      await showInfoOverlay(
        ctx,
        "eforge - Error",
        `Profile created but activation failed:\n\n${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    await showInfoOverlay(
      ctx,
      "eforge - Profile Created",
      `Profile **${name}** created at ${scope} scope.\n\nSwitch to it later with \`/eforge:profile ${name}\`.`,
    );
  }
}
