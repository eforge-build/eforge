import type { ProfileCreatePayload, TierRecipeEntry } from "./profile-payload";

// Extended types for buildYamlPreview to handle optional toolbelt assignments
// that may be present in profile configs loaded from the daemon.
interface TierPreviewEntry extends TierRecipeEntry {
  toolbelt?: string;
}

interface ProfilePreviewPayload {
  metadata?: ProfileCreatePayload['metadata'];
  agents: {
    tiers: Record<string, TierPreviewEntry>;
  };
  tools?: {
    toolbelts?: Record<string, { description?: string; mcpServers: string[] }>;
  };
}

/** Build a human-readable YAML preview of the profile payload. */
export function buildYamlPreview(payload: ProfilePreviewPayload): string {
  const lines: string[] = ["```yaml"];
  if (payload.metadata) {
    const m = payload.metadata;
    if (m.description) {
      lines.push(`description: ${JSON.stringify(m.description)}`);
    }
    if (m.whenToUse?.length) {
      lines.push('whenToUse:');
      for (const w of m.whenToUse) {
        lines.push(`  - ${JSON.stringify(w)}`);
      }
    }
    if (m.tags?.length) {
      lines.push('tags:');
      for (const t of m.tags) {
        lines.push(`  - ${JSON.stringify(t)}`);
      }
    }
  }
  lines.push("agents:");
  lines.push("  tiers:");
  for (const [tier, entry] of Object.entries(payload.agents.tiers)) {
    lines.push(`    ${tier}:`);
    lines.push(`      harness: ${entry.harness}`);
    if (entry.pi?.provider) {
      lines.push(`      pi:`);
      lines.push(`        provider: ${entry.pi.provider}`);
    }
    lines.push(`      model: ${entry.model}`);
    lines.push(`      effort: ${entry.effort}`);
    if (entry.toolbelt !== undefined) {
      lines.push(`      toolbelt: ${entry.toolbelt}`);
    }
    appendRuntimeChoices(lines, entry);
  }
  appendToolbelts(lines, payload.tools?.toolbelts);
  lines.push("```");
  return lines.join("\n");
}

function appendRuntimeChoices(lines: string[], entry: TierPreviewEntry): void {
  if (entry.choices && Object.keys(entry.choices).length > 0) {
    lines.push(`      choices:`);
    for (const [choiceName, choice] of Object.entries(entry.choices)) {
      lines.push(`        ${choiceName}:`);
      if (choice.harness !== undefined) lines.push(`          harness: ${choice.harness}`);
      if (choice.pi?.provider) {
        lines.push(`          pi:`);
        lines.push(`            provider: ${choice.pi.provider}`);
      }
      if (choice.model !== undefined) lines.push(`          model: ${choice.model}`);
      if (choice.effort !== undefined) lines.push(`          effort: ${choice.effort}`);
      if (choice.toolbelt !== undefined) lines.push(`          toolbelt: ${choice.toolbelt}`);
    }
  }
  if (entry.routing?.rules.length) {
    lines.push(`      routing:`);
    lines.push(`        rules:`);
    for (const rule of entry.routing.rules) {
      lines.push(`          - name: ${rule.name}`);
      lines.push(`            choice: ${rule.choice}`);
      lines.push(`            when:`);
      for (const [key, values] of Object.entries(rule.when)) {
        if (Array.isArray(values)) lines.push(`              ${key}: ${JSON.stringify(values)}`);
      }
    }
  }
}

function appendToolbelts(
  lines: string[],
  toolbelts: Record<string, { description?: string; mcpServers: string[] }> | undefined,
): void {
  if (!toolbelts || Object.keys(toolbelts).length === 0) return;
  lines.push("tools:");
  lines.push("  toolbelts:");
  for (const [name, tb] of Object.entries(toolbelts)) {
    lines.push(`    ${name}:`);
    if (tb.description) {
      lines.push(`      description: ${JSON.stringify(tb.description)}`);
    }
    if (tb.mcpServers.length > 0) {
      lines.push("      mcpServers:");
      for (const server of tb.mcpServers) {
        lines.push(`        - ${server}`);
      }
    }
  }
}
