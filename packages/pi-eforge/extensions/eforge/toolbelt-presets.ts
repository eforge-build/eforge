import type { TierName } from './profile-payload.js';

export interface ToolbeltPreset {
  id: string;
  label: string;
  description: string;
  mcpServers: string[];
  tierAssignments: Record<TierName, string>;
  setupHint: string;
  autoAdd?: {
    servers: Record<string, { command: string; args?: string[] }>;
  };
}

export const TOOLBELT_PRESETS: ToolbeltPreset[] = [
  {
    id: 'browser-ui',
    label: 'Browser / UI Testing',
    description: 'Playwright MCP server for browser automation and UI testing',
    mcpServers: ['playwright'],
    tierAssignments: {
      planning: 'none',
      implementation: 'browser-ui',
      review: 'browser-ui',
      evaluation: 'none',
    },
    setupHint: 'Requires @playwright/mcp package. Will auto-add if confirmed.',
    autoAdd: {
      servers: {
        playwright: {
          command: 'npx',
          args: ['-y', '@playwright/mcp@latest'],
        },
      },
    },
  },
  {
    id: 'docs-research',
    label: 'Docs / Research',
    description: 'Documentation and search servers for research-heavy tasks',
    mcpServers: ['fetch', 'context7'],
    tierAssignments: {
      planning: 'docs-research',
      implementation: 'docs-research',
      review: 'none',
      evaluation: 'none',
    },
    setupHint: 'Add fetch and context7 MCP servers to your .mcp.json manually.',
  },
  {
    id: 'issue-triage',
    label: 'Issue Triage',
    description: 'GitHub/issue-tracker servers for planning and triage',
    mcpServers: ['github'],
    tierAssignments: {
      planning: 'issue-triage',
      implementation: 'none',
      review: 'none',
      evaluation: 'none',
    },
    setupHint: 'Add a GitHub MCP server to your .mcp.json manually.',
  },
  {
    id: 'repo-review',
    label: 'Repo Review',
    description: 'Source navigation and review servers',
    mcpServers: ['github'],
    tierAssignments: {
      planning: 'repo-review',
      implementation: 'none',
      review: 'repo-review',
      evaluation: 'none',
    },
    setupHint: 'Add a GitHub MCP server to your .mcp.json manually.',
  },
  {
    id: 'observability',
    label: 'Observability',
    description: 'Metrics and log servers for runtime analysis',
    mcpServers: ['datadog', 'sentry'],
    tierAssignments: {
      planning: 'observability',
      implementation: 'none',
      review: 'none',
      evaluation: 'observability',
    },
    setupHint: 'Add observability MCP servers (e.g. Datadog, Sentry) to your .mcp.json manually.',
  },
  {
    id: 'database-readonly',
    label: 'Database (Read-only)',
    description: 'Read-only database access for planning queries',
    mcpServers: ['postgres', 'sqlite'],
    tierAssignments: {
      planning: 'database-readonly',
      implementation: 'none',
      review: 'none',
      evaluation: 'none',
    },
    setupHint: 'Add a read-only database MCP server to your .mcp.json manually.',
  },
  {
    id: 'api-testing',
    label: 'API Testing',
    description: 'HTTP client servers for API testing and validation',
    mcpServers: ['fetch'],
    tierAssignments: {
      planning: 'none',
      implementation: 'api-testing',
      review: 'api-testing',
      evaluation: 'none',
    },
    setupHint: 'Add a fetch or HTTP MCP server to your .mcp.json manually.',
  },
  {
    id: 'design-ui',
    label: 'Design / UI',
    description: 'Figma and design system servers for UI work',
    mcpServers: ['figma'],
    tierAssignments: {
      planning: 'design-ui',
      implementation: 'design-ui',
      review: 'design-ui',
      evaluation: 'none',
    },
    setupHint: 'Add a Figma MCP server to your .mcp.json manually.',
  },
];

/**
 * Find missing MCP server names from an existing server map.
 */
export function findMissingServers(
  preset: ToolbeltPreset,
  existingServers: Record<string, unknown>,
): string[] {
  return preset.mcpServers.filter((name) => !(name in existingServers));
}

/**
 * Apply a preset's tier assignments to the given tiers map.
 * Returns a new object with toolbelt fields set.
 */
export function applyToolbeltPresetToTiers<T extends { toolbelt?: string }>(
  preset: ToolbeltPreset,
  tiers: Record<TierName, T>,
): Record<TierName, T & { toolbelt: string }> {
  const result = {} as Record<TierName, T & { toolbelt: string }>;
  for (const tierName of Object.keys(tiers) as TierName[]) {
    result[tierName] = {
      ...tiers[tierName],
      toolbelt: preset.tierAssignments[tierName],
    };
  }
  return result;
}

/**
 * Apply "no project MCP access" to all tiers.
 */
export function applyNoMcpAccessToTiers<T extends { toolbelt?: string }>(
  tiers: Record<TierName, T>,
): Record<TierName, T & { toolbelt: string }> {
  const result = {} as Record<TierName, T & { toolbelt: string }>;
  for (const tierName of Object.keys(tiers) as TierName[]) {
    result[tierName] = { ...tiers[tierName], toolbelt: 'none' };
  }
  return result;
}

/**
 * Registry data for display in config output.
 */
export interface ToolbeltPresetRegistryEntry {
  id: string;
  label: string;
  description: string;
  mcpServers: string[];
  tierAssignments: Record<TierName, string>;
}

export function getPresetRegistryData(): ToolbeltPresetRegistryEntry[] {
  return TOOLBELT_PRESETS.map(({ id, label, description, mcpServers, tierAssignments }) => ({
    id,
    label,
    description,
    mcpServers,
    tierAssignments,
  }));
}

export function getPresetById(id: string): ToolbeltPreset | undefined {
  return TOOLBELT_PRESETS.find((p) => p.id === id);
}
