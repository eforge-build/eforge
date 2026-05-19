import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import {
  readMcpServers,
  addPlaywrightServer,
  readEforgeConfig,
  upsertToolbeltInConfig,
  captureFileContents,
  restoreFileContents,
} from '../packages/pi-eforge/extensions/eforge/toolbelt-config-files.js';
import { getPresetById } from '../packages/pi-eforge/extensions/eforge/toolbelt-presets.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eforge-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('readMcpServers', () => {
  it('returns empty object when .mcp.json does not exist', () => {
    const tmpDir = makeTempDir();
    expect(readMcpServers(tmpDir)).toEqual({});
  });

  it('returns mcpServers from valid .mcp.json', () => {
    const tmpDir = makeTempDir();
    fs.writeFileSync(
      path.join(tmpDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { playwright: { command: 'npx' } } }),
    );
    expect(readMcpServers(tmpDir)).toEqual({ playwright: { command: 'npx' } });
  });

  it('throws on invalid JSON', () => {
    const tmpDir = makeTempDir();
    fs.writeFileSync(path.join(tmpDir, '.mcp.json'), 'not json');
    expect(() => readMcpServers(tmpDir)).toThrow('invalid JSON');
  });

  it('throws on missing mcpServers key', () => {
    const tmpDir = makeTempDir();
    fs.writeFileSync(path.join(tmpDir, '.mcp.json'), JSON.stringify({ other: {} }));
    expect(() => readMcpServers(tmpDir)).toThrow('"mcpServers"');
  });
});

describe('addPlaywrightServer', () => {
  it('creates .mcp.json with playwright when file is missing', () => {
    const tmpDir = makeTempDir();
    addPlaywrightServer(tmpDir, { command: 'npx', args: ['@playwright/mcp@latest'] });
    const content = JSON.parse(fs.readFileSync(path.join(tmpDir, '.mcp.json'), 'utf-8'));
    expect(content.mcpServers.playwright).toEqual({
      command: 'npx',
      args: ['@playwright/mcp@latest'],
    });
  });

  it('does not overwrite existing playwright server config', () => {
    const tmpDir = makeTempDir();
    const existing = { mcpServers: { playwright: { command: 'node', args: ['my-script.js'] } } };
    fs.writeFileSync(path.join(tmpDir, '.mcp.json'), JSON.stringify(existing));
    addPlaywrightServer(tmpDir, { command: 'npx', args: ['@playwright/mcp@latest'] });
    const content = JSON.parse(fs.readFileSync(path.join(tmpDir, '.mcp.json'), 'utf-8'));
    expect(content.mcpServers.playwright).toEqual({ command: 'node', args: ['my-script.js'] });
  });

  it('adds playwright alongside other servers', () => {
    const tmpDir = makeTempDir();
    fs.writeFileSync(
      path.join(tmpDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { fetch: { command: 'npx', args: ['fetch-mcp'] } } }),
    );
    addPlaywrightServer(tmpDir, { command: 'npx', args: ['@playwright/mcp@latest'] });
    const content = JSON.parse(fs.readFileSync(path.join(tmpDir, '.mcp.json'), 'utf-8'));
    expect(content.mcpServers.playwright).toBeDefined();
    expect(content.mcpServers.fetch).toBeDefined();
  });
});

describe('upsertToolbeltInConfig', () => {
  it('inserts tools.toolbelts.browser-ui in new config', () => {
    const tmpDir = makeTempDir();
    const preset = getPresetById('browser-ui')!;
    upsertToolbeltInConfig(tmpDir, preset);
    const config = readEforgeConfig(tmpDir);
    const tools = config['tools'] as Record<string, unknown>;
    const toolbelts = tools['toolbelts'] as Record<string, unknown>;
    expect(toolbelts['browser-ui']).toMatchObject({
      description: preset.description,
      mcpServers: preset.mcpServers,
    });
  });

  it('replaces existing tools.toolbelts.browser-ui entry', () => {
    const tmpDir = makeTempDir();
    const eforgeDir = path.join(tmpDir, 'eforge');
    fs.mkdirSync(eforgeDir);
    const initial = { tools: { toolbelts: { 'browser-ui': { description: 'old', mcpServers: [] } } } };
    fs.writeFileSync(path.join(eforgeDir, 'config.yaml'), yaml.stringify(initial));
    const preset = getPresetById('browser-ui')!;
    upsertToolbeltInConfig(tmpDir, preset);
    const config = readEforgeConfig(tmpDir);
    const toolbelts = (config['tools'] as Record<string, unknown>)['toolbelts'] as Record<string, unknown>;
    expect((toolbelts['browser-ui'] as { mcpServers: string[] }).mcpServers).toEqual(['playwright']);
  });

  it('creates eforge directory if needed', () => {
    const tmpDir = makeTempDir();
    const preset = getPresetById('browser-ui')!;
    upsertToolbeltInConfig(tmpDir, preset);
    expect(fs.existsSync(path.join(tmpDir, 'eforge', 'config.yaml'))).toBe(true);
  });

  it('preserves unrelated config keys and existing toolbelts when upserting a preset', () => {
    const tmpDir = makeTempDir();
    const eforgeDir = path.join(tmpDir, 'eforge');
    fs.mkdirSync(eforgeDir);
    const initial = {
      maxConcurrentBuilds: 3,
      tools: {
        custom: 'value',
        toolbelts: {
          'docs-research': { description: 'Docs preset', mcpServers: ['fetch', 'context7'] },
        },
      },
    };
    fs.writeFileSync(path.join(eforgeDir, 'config.yaml'), yaml.stringify(initial));
    const preset = getPresetById('browser-ui')!;
    upsertToolbeltInConfig(tmpDir, preset);
    const config = readEforgeConfig(tmpDir);
    // Unrelated top-level key preserved
    expect(config['maxConcurrentBuilds']).toBe(3);
    const tools = config['tools'] as Record<string, unknown>;
    // Unrelated tools key preserved
    expect(tools['custom']).toBe('value');
    const toolbelts = tools['toolbelts'] as Record<string, unknown>;
    // Existing docs-research toolbelt preserved
    expect(toolbelts['docs-research']).toBeDefined();
    // New browser-ui toolbelt added
    expect(toolbelts['browser-ui']).toBeDefined();
  });
});

describe('captureFileContents / restoreFileContents', () => {
  it('captures existing file contents', () => {
    const tmpDir = makeTempDir();
    fs.writeFileSync(path.join(tmpDir, '.mcp.json'), '{"mcpServers":{}}');
    const captured = captureFileContents(tmpDir, ['.mcp.json']);
    expect(captured.get('.mcp.json')).toBe('{"mcpServers":{}}');
  });

  it('captures null for missing files', () => {
    const tmpDir = makeTempDir();
    const captured = captureFileContents(tmpDir, ['.mcp.json']);
    expect(captured.get('.mcp.json')).toBeNull();
  });

  it('restores file contents', () => {
    const tmpDir = makeTempDir();
    fs.writeFileSync(path.join(tmpDir, '.mcp.json'), 'original');
    const captured = captureFileContents(tmpDir, ['.mcp.json']);
    fs.writeFileSync(path.join(tmpDir, '.mcp.json'), 'modified');
    restoreFileContents(tmpDir, captured);
    expect(fs.readFileSync(path.join(tmpDir, '.mcp.json'), 'utf-8')).toBe('original');
  });

  it('deletes files that did not exist before', () => {
    const tmpDir = makeTempDir();
    const captured = captureFileContents(tmpDir, ['.mcp.json']);
    fs.writeFileSync(path.join(tmpDir, '.mcp.json'), 'new content');
    restoreFileContents(tmpDir, captured);
    expect(fs.existsSync(path.join(tmpDir, '.mcp.json'))).toBe(false);
  });
});
