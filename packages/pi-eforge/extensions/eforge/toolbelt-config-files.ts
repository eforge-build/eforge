import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import type { ToolbeltPreset } from './toolbelt-presets.js';

interface McpServersFile {
  mcpServers: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readMcpJsonFile(projectRoot: string): McpServersFile | null {
  const mcpPath = path.join(projectRoot, '.mcp.json');
  if (!fs.existsSync(mcpPath)) {
    return null;
  }
  const raw = fs.readFileSync(mcpPath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`.mcp.json contains invalid JSON`);
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('mcpServers' in parsed) ||
    typeof (parsed as { mcpServers: unknown }).mcpServers !== 'object' ||
    (parsed as { mcpServers: unknown }).mcpServers === null ||
    Array.isArray((parsed as { mcpServers: unknown }).mcpServers)
  ) {
    throw new Error(`.mcp.json must have a "mcpServers" object at the top level`);
  }
  return parsed as McpServersFile;
}

/**
 * Read existing MCP server names from `.mcp.json`.
 * Returns an empty object if the file does not exist.
 * Throws if the file is present but has invalid JSON or shape.
 */
export function readMcpServers(projectRoot: string): Record<string, unknown> {
  const parsed = readMcpJsonFile(projectRoot);
  return parsed?.mcpServers ?? {};
}

/**
 * Add Playwright server to `.mcp.json`.
 * - Creates the file with `{ mcpServers: {} }` if missing.
 * - Skips if `playwright` key already exists.
 * - Uses atomic temp-file replacement.
 */
export function addPlaywrightServer(
  projectRoot: string,
  serverConfig: { command: string; args?: string[] },
): void {
  const mcpPath = path.join(projectRoot, '.mcp.json');
  let existing: McpServersFile = { mcpServers: {} };
  if (fs.existsSync(mcpPath)) {
    const parsed = readMcpJsonFile(projectRoot);
    if (parsed === null) {
      existing = { mcpServers: {} };
    } else {
      existing = parsed;
    }
  }
  if ('playwright' in existing.mcpServers) {
    // Already exists — do not overwrite
    return;
  }
  const updated: McpServersFile = {
    ...existing,
    mcpServers: {
      ...existing.mcpServers,
      playwright: serverConfig,
    },
  };
  writeFileAtomic(mcpPath, JSON.stringify(updated, null, 2));
}

/**
 * Read current `eforge/config.yaml` as a plain object.
 * Returns `{}` if missing or empty.
 * Throws if the file is present but unparseable.
 */
export function readEforgeConfig(projectRoot: string): Record<string, unknown> {
  const configPath = path.join(projectRoot, 'eforge', 'config.yaml');
  if (!fs.existsSync(configPath)) {
    return {};
  }
  const raw = fs.readFileSync(configPath, 'utf-8').trim();
  if (!raw) return {};
  const parsed: unknown = yaml.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

/**
 * Upsert `tools.toolbelts.<preset.id>` in `eforge/config.yaml`.
 * Creates the file (and directory) if needed.
 * Uses atomic temp-file replacement.
 */
export function upsertToolbeltInConfig(projectRoot: string, preset: ToolbeltPreset): void {
  const configDir = path.join(projectRoot, 'eforge');
  const configPath = path.join(configDir, 'config.yaml');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  const config = readEforgeConfig(projectRoot);
  const tools = isRecord(config['tools']) ? config['tools'] : {};
  const toolbelts = isRecord(tools['toolbelts']) ? tools['toolbelts'] : {};
  const entry = {
    description: preset.description,
    mcpServers: preset.mcpServers,
  };
  const updated = {
    ...config,
    tools: {
      ...tools,
      toolbelts: {
        ...toolbelts,
        [preset.id]: entry,
      },
    },
  };
  writeFileAtomic(configPath, yaml.stringify(updated));
}

/**
 * Read the raw contents of files needed for rollback.
 * Returns null for files that don't exist.
 */
export function captureFileContents(
  projectRoot: string,
  files: string[],
): Map<string, string | null> {
  const result = new Map<string, string | null>();
  for (const file of files) {
    const fullPath = path.join(projectRoot, file);
    if (fs.existsSync(fullPath)) {
      result.set(file, fs.readFileSync(fullPath, 'utf-8'));
    } else {
      result.set(file, null);
    }
  }
  return result;
}

/**
 * Restore previously-captured file contents.
 * Files that were null (didn't exist) are deleted if they now exist.
 */
export function restoreFileContents(
  projectRoot: string,
  captured: Map<string, string | null>,
): void {
  for (const [file, content] of captured.entries()) {
    const fullPath = path.join(projectRoot, file);
    if (content === null) {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    } else {
      fs.writeFileSync(fullPath, content, 'utf-8');
    }
  }
}

function writeFileAtomic(targetPath: string, content: string): void {
  const dir = path.dirname(targetPath);
  const tmpPath = path.join(dir, `.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, targetPath);
}
