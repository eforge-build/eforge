import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOST_OUTPUT_CHAR_BUDGET } from '../host-output.js';
import { appendExtensionErrorVersionHint, buildExtensionErrorVersionHint } from '../api/extension-error-hints.js';
import { API_ROUTES } from '../routes.js';
import { DAEMON_API_VERSION } from '../api-version.js';
import { writeLockfile } from '../lockfile.js';
import { EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION, type ExtensionActionManifestEntry } from '../extension-contributions.js';
import { listEforgeExtensionContributions, summarizeExtensionContributionManifest } from '../api/extension-contribution-dispatch.js';
import {
  formatExtensionContributionDetailText,
  formatExtensionContributionFailedInvocationEnvelopeText,
  formatExtensionContributionListText,
  formatExtensionContributionOutput,
} from '../extension-contribution-output-formatting.js';
import type {
  ExtensionHostContributionDetailResponse,
  ExtensionHostContributionFailedInvocationEnvelope,
  ExtensionHostContributionListResponse,
} from '../api/extension-contribution-dispatch.js';

let versionServer: ReturnType<typeof createServer> | undefined;

afterEach(async () => {
  if (versionServer) {
    await new Promise<void>((resolve, reject) => versionServer!.close((err) => err ? reject(err) : resolve()));
    versionServer = undefined;
  }
});

function expectedActionBullet(entry: {
  id: string;
  localId?: string;
  label: string;
  extensionName: string;
  actionId?: string;
  actionLocalId?: string;
  actionBacked: boolean;
  outputProfile?: string;
  hasInputSchema: boolean;
  requiredInputKeys: string[];
  inputPropertyKeys: string[];
  inputDefaultKeys: string[];
}): string {
  return `- action:${entry.id} — ${entry.label} [${entry.extensionName}] ${[
    entry.localId ? `local=${entry.localId}` : undefined,
    entry.actionId ? `action=${entry.actionId}` : 'action=none',
    entry.actionLocalId ? `actionLocal=${entry.actionLocalId}` : undefined,
    `actionBacked=${entry.actionBacked}`,
    entry.outputProfile ? `output=${entry.outputProfile}` : undefined,
    `input=${entry.hasInputSchema ? 'schema=yes' : 'schema=no'}; required=${entry.requiredInputKeys.length > 0 ? entry.requiredInputKeys.join(',') : 'none'}; properties=${entry.inputPropertyKeys.length > 0 ? entry.inputPropertyKeys.join(',') : 'none'}; defaults=${entry.inputDefaultKeys.length > 0 ? entry.inputDefaultKeys.join(',') : 'none'}`,
  ].filter(Boolean).join(' ')}`;
}

async function startVersionServer(eforgeVersion: string, options: { manifestStatus?: number; manifestBody?: unknown } = {}): Promise<number> {
  versionServer = createServer((req, res) => {
    if (req.url === API_ROUTES.health) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.url === API_ROUTES.version) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: DAEMON_API_VERSION, eforgeVersion }));
      return;
    }
    if (req.url === API_ROUTES.extensionContributionManifest) {
      res.writeHead(options.manifestStatus ?? 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(options.manifestBody ?? { error: 'Extension not found: missing' }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise<void>((resolve, reject) => {
    versionServer!.listen(0, '127.0.0.1', resolve);
    versionServer!.on('error', reject);
  });
  const address = versionServer.address();
  if (!address || typeof address === 'string') throw new Error('No version test server port');
  return address.port;
}

describe('extension contribution output formatting', () => {
  it('renders exact markdown outputs as markdown text', () => {
    const formatted = formatExtensionContributionOutput({ markdown: '# Done\n- ok' });

    expect(formatted.kind).toBe('markdown');
    expect(formatted.text).toBe('# Done\n- ok');
    expect(formatted.text).not.toContain('"markdown"');
    expect(formatted.text).not.toContain('\\n');
  });

  it('summarizes oversized JSON arrays while preserving identity fields and omitted counts', () => {
    const output = {
      items: Array.from({ length: 20 }, (_, index) => ({
        id: `item-${index}`,
        itemId: `I-${index}`,
        title: `Item ${index}`,
        status: index % 2 === 0 ? 'planned' : 'candidate',
        lane: 'ready',
        body: 'x'.repeat(300),
      })),
      total: 20,
      limit: 5,
      offset: 0,
      nextOffset: 5,
    };

    const formatted = formatExtensionContributionOutput(output, { maxChars: 900, arrayItems: 3 });

    expect(formatted.kind).toBe('json-summary');
    expect(formatted.text).toContain('Warning: extension action output was');
    expect(formatted.text).toContain('"items"');
    expect(formatted.text).toContain('"count": 20');
    expect(formatted.text).toContain('"omitted": 17');
    expect(formatted.text).toContain('"id": "item-0"');
    expect(formatted.text).toContain('"itemId": "I-0"');
    expect(formatted.text).toContain('"title": "Item 0"');
    expect(formatted.text).toContain('"status": "planned"');
    expect(formatted.text).toContain('"lane": "ready"');
    expect(formatted.text).toContain('"nextOffset": 5');
    expect(formatted.text).not.toContain('x'.repeat(300));
  });

  it('preserves top-level object keys and cursor continuation hints in summaries', () => {
    const formatted = formatExtensionContributionOutput({
      pageInfo: { cursor: 'cur-1', nextCursor: 'cur-2', hasMore: true },
      epics: Array.from({ length: 12 }, (_, index) => ({ epicId: `E-${index}`, name: `Epic ${index}`, state: 'open' })),
      counts: { openCount: 12, closedCount: 4 },
      debug: 'debug '.repeat(300),
    }, { maxChars: 1_100, arrayItems: 2 });

    expect(formatted.text).toContain('"pageInfo"');
    expect(formatted.text).toContain('"epics"');
    expect(formatted.text).toContain('"counts"');
    expect(formatted.text).toContain('"cursor": "cur-1"');
    expect(formatted.text).toContain('"nextCursor": "cur-2"');
    expect(formatted.text).toContain('"openCount": 12');
    expect(formatted.text).toContain('"closedCount": 4');
    expect(formatted.text).toContain('"epicId": "E-0"');
    expect(formatted.text).toContain('"omitted": 10');
  });

  it('emits rich profile warnings even for small outputs', () => {
    const uiRich = formatExtensionContributionOutput({ ok: true }, { outputProfile: 'ui-rich' });
    const debugRich = formatExtensionContributionOutput({ ok: true }, { outputProfile: 'debug-rich' });

    expect(uiRich.text).toContain('outputProfile "ui-rich"');
    expect(uiRich.text).toContain('"ok": true');
    expect(debugRich.text).toContain('outputProfile "debug-rich"');
    expect(debugRich.text).toContain('"ok": true');
  });

  it('enforces the final host character budget after rich profile warnings', () => {
    const formatted = formatExtensionContributionOutput({ value: 'x'.repeat(350) }, { maxChars: 400, outputProfile: 'debug-rich' });

    expect(formatted.kind).toBe('json');
    expect(formatted.truncated).toBe(true);
    expect(formatted.text.length).toBeLessThanOrEqual(400);
    expect(formatted.text).toContain('outputProfile "debug-rich"');
    expect(formatted.text).toContain('final host character budget');
  });

  it('enforces the final host character budget after semantic summarization', () => {
    const formatted = formatExtensionContributionOutput({
      items: Array.from({ length: 60 }, (_, index) => ({
        id: `item-${index}`,
        title: `Item ${index}`,
        status: 'planned',
        details: 'x'.repeat(500),
      })),
      total: 60,
      nextOffset: 5,
    }, { maxChars: 400, arrayItems: 10 });

    expect(formatted.kind).toBe('json-summary');
    expect(formatted.truncated).toBe(true);
    expect(formatted.text.length).toBeLessThanOrEqual(400);
    expect(formatted.text).toContain('final host character budget');
    expect(formatted.text).not.toContain('x'.repeat(500));
  });

  it('formats compact contribution lists with pagination and input metadata', () => {
    const response: ExtensionHostContributionListResponse = {
      generatedAt: '2026-06-03T00:00:00.000Z',
      diagnosticCount: 2,
      total: 12,
      returned: 1,
      offset: 5,
      limit: 1,
      hasMore: true,
      nextOffset: 6,
      entries: [{
        kind: 'command',
        id: 'ext.command',
        label: 'Run command',
        extensionName: 'example',
        extensionPath: '/extensions/example',
        actionId: 'ext.run',
        actionBacked: true,
        outputProfile: 'agent-compact',
        hasInputSchema: true,
        requiredInputKeys: ['name'],
        inputPropertyKeys: ['name', 'count'],
        inputDefaultKeys: ['count'],
      }],
    };

    const text = formatExtensionContributionListText(response, { maxChars: 800 });

    expect(text).toContain('1 returned of 12 total');
    expect(text).toContain('nextOffset 6');
    expect(text).toContain('command:ext.command');
    expect(text).toContain('required=name');
    expect(text).toContain('properties=name,count');
  });

  it('formats contribution detail with schema only when present in the shared projection', () => {
    const response: ExtensionHostContributionDetailResponse = {
      generatedAt: '2026-06-03T00:00:00.000Z',
      diagnosticCount: 0,
      entry: {
        kind: 'action',
        id: 'ext.run',
        label: 'Run',
        extensionName: 'example',
        extensionPath: '/extensions/example',
        actionId: 'ext.run',
        actionBacked: true,
        hasInputSchema: true,
        requiredInputKeys: ['name'],
        inputPropertyKeys: ['name'],
        inputDefaultKeys: [],
        inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      },
    };

    const text = formatExtensionContributionDetailText(response, { maxChars: 1_200 });

    expect(text).toContain('Extension contribution: action:ext.run');
    expect(text).toContain('Input schema:');
    expect(text).toContain('```json');
    expect(text).toContain('"name"');
  });

  it('keeps default contribution host output within the shared budget and reports raw-size guidance', () => {
    const output = {
      items: Array.from({ length: 500 }, (_, index) => ({
        id: `item-${index}`,
        title: `Item ${index}`,
        status: 'planned',
        body: 'x'.repeat(500),
      })),
      total: 500,
      limit: 5,
      offset: 0,
      nextOffset: 5,
    };

    const formatted = formatExtensionContributionOutput(output);

    expect(formatted.text.length).toBeLessThanOrEqual(HOST_OUTPUT_CHAR_BUDGET);
    expect(formatted.rawLength).toBeGreaterThan(HOST_OUTPUT_CHAR_BUDGET);
    expect(formatted.text).toContain(formatted.rawLength.toLocaleString());
    expect(formatted.text).toContain('Hint: continuation fields preserved');
  });

  it('keeps default list, show, and debug-rich contribution output within the shared budget', () => {
    const inputSchema = { type: 'object', properties: Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`field${index}`, { type: 'string', description: 'x'.repeat(120) }])) };
    const entry = {
      kind: 'action' as const,
      id: 'ext.run',
      label: 'Run',
      extensionName: 'example',
      extensionPath: '/extensions/example',
      actionId: 'ext.run',
      actionBacked: true,
      outputProfile: 'agent-compact' as const,
      hasInputSchema: true,
      requiredInputKeys: ['name'],
      inputPropertyKeys: ['name'],
      inputDefaultKeys: [],
      inputSchema,
    };
    const listText = formatExtensionContributionListText({
      generatedAt: '2026-06-03T00:00:00.000Z',
      diagnosticCount: 0,
      total: 1,
      returned: 1,
      offset: 0,
      hasMore: false,
      entries: [entry],
    });
    const showText = formatExtensionContributionDetailText({ generatedAt: '2026-06-03T00:00:00.000Z', diagnosticCount: 0, entry });
    const debugRich = formatExtensionContributionOutput({ value: 'x'.repeat(30_000) }, { outputProfile: 'debug-rich' });

    expect(listText.length).toBeLessThanOrEqual(HOST_OUTPUT_CHAR_BUDGET);
    expect(showText.length).toBeLessThanOrEqual(HOST_OUTPUT_CHAR_BUDGET);
    expect(debugRich.text.length).toBeLessThanOrEqual(HOST_OUTPUT_CHAR_BUDGET);
    expect(debugRich.text).toContain(debugRich.rawLength.toLocaleString());
  });

  it('reports raw size and continuation guidance for oversized output that fits after summarization', () => {
    const formatted = formatExtensionContributionOutput({ body: 'x'.repeat(5_000), nextOffset: 2 }, { maxChars: 600 });

    expect(formatted.text.length).toBeLessThanOrEqual(600);
    expect(formatted.truncated).toBe(false);
    expect(formatted.text).toContain(formatted.rawLength.toLocaleString());
    expect(formatted.text).toContain('showing a semantic summary');
    expect(formatted.text).toContain('Hint: continuation fields preserved: nextOffset');
    expect(formatted.text).toContain('continue with a smaller read');
  });

  it('preserves all compact action identities through projection and omits large schemas by default', () => {
    const manifestActions: ExtensionActionManifestEntry[] = [0, 1].map((index) => ({
      id: `example:action-${index}`,
      localId: `action-${index}`,
      title: `Action ${index}`,
      extensionName: 'example',
      extensionPath: '/extensions/example',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, [`internalSchemaOnly${index}`]: { type: 'string', description: 'schema-only detail' } },
        required: ['query'],
      } as ExtensionActionManifestEntry['inputSchema'],
      outputProfile: index === 0 ? 'agent-compact' as const : 'agent-paginated' as const,
    }));
    const response = summarizeExtensionContributionManifest({
      schemaVersion: EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION,
      generatedAt: '2026-06-03T00:00:00.000Z',
      actions: manifestActions,
      consoleContributions: [],
      consoleWorkstations: [],
      integrationCommands: [],
      deepLinks: [],
    });

    const text = formatExtensionContributionListText(response, { maxChars: 2_000 });

    for (const [index, action] of manifestActions.entries()) {
      expect(text).toContain(`action:${action.id}`);
      expect(text).toContain(`local=${action.localId}`);
      expect(text).toContain(`— ${action.title}`);
      expect(text).toContain(`action=${action.id}`);
      expect(text).toContain(`actionLocal=${action.localId}`);
      expect(text).toContain(`output=${action.outputProfile}`);
      expect(text).toContain('input=schema=yes; required=query;');
      expect(text).not.toContain(`"internalSchemaOnly${index}"`);
    }
    expect(text).not.toContain('Input schema:');
    expect(text).not.toContain('Input defaults:');
    expect(text).not.toContain('```json');
    expect(text).not.toContain('schema-only detail');
  });

  it('reports budget-aware continuation without slicing contribution entries', () => {
    const entries = Array.from({ length: 75 }, (_, index) => ({
      kind: 'action' as const,
      id: `example:item-${index}`,
      localId: `item-${index}`,
      label: `List Item ${index}`,
      extensionName: 'example',
      extensionPath: '/extensions/example',
      actionId: `example:item-${index}`,
      actionLocalId: `item-${index}`,
      actionBacked: true,
      outputProfile: 'agent-compact' as const,
      hasInputSchema: false,
      requiredInputKeys: [],
      inputPropertyKeys: [],
      inputDefaultKeys: [],
    }));

    const firstText = formatExtensionContributionListText({
      generatedAt: '2026-06-03T00:00:00.000Z',
      diagnosticCount: 0,
      total: entries.length,
      returned: entries.length,
      offset: 0,
      hasMore: false,
      entries,
    }, { maxChars: 1_200 });
    const nextOffset = Number(firstText.match(/nextOffset (\d+)/)?.[1]);
    const firstIds = [...firstText.matchAll(/action:example:item-(\d+)/g)].map((match) => Number(match[1]));
    const secondText = formatExtensionContributionListText({
      generatedAt: '2026-06-03T00:00:00.000Z',
      diagnosticCount: 0,
      total: entries.length,
      returned: entries.length - nextOffset,
      offset: nextOffset,
      hasMore: nextOffset < entries.length,
      entries: entries.slice(nextOffset),
    }, { maxChars: 1_200 });
    const secondIds = [...secondText.matchAll(/action:example:item-(\d+)/g)].map((match) => Number(match[1]));

    expect(firstText).toContain(`Extension contributions: ${firstIds.length} returned of ${entries.length} total`);
    expect(firstText).toContain(`Continue: request the next page with offset ${nextOffset}.`);
    expect(firstText).toContain(`nextOffset ${nextOffset}`);
    expect(firstText.length).toBeLessThanOrEqual(1_200);
    expect(nextOffset).toBe(firstIds.length);
    expect(firstIds.length).toBeGreaterThan(0);
    for (const id of firstIds) expect(firstText).toContain(expectedActionBullet(entries[id]));
    expect(secondText).toContain(`Extension contributions: ${secondIds.length} returned of ${entries.length} total`);
    expect(secondText).toContain(secondIds.length + nextOffset < entries.length ? `nextOffset ${secondIds.length + nextOffset}` : 'complete');
    for (const id of secondIds) expect(secondText).toContain(expectedActionBullet(entries[id]));
    expect(secondIds[0]).toBe(nextOffset);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(firstIds.length + secondIds.length);
  });

  it('returns a whole entry that fits the host budget without reserving unused final-cap headroom', () => {
    const entry = {
      kind: 'action' as const,
      id: 'example:headroom-entry',
      label: 'Headroom Entry With A Moderately Long Label',
      extensionName: 'example',
      extensionPath: '/extensions/example',
      actionId: 'example:headroom-entry',
      actionLocalId: 'headroom-entry',
      actionBacked: true,
      outputProfile: 'agent-compact' as const,
      hasInputSchema: true,
      requiredInputKeys: ['query'],
      inputPropertyKeys: Array.from({ length: 8 }, (_, index) => `field${index}`),
      inputDefaultKeys: [],
    };
    const zeroEntryLength = formatExtensionContributionListText({
      generatedAt: '2026-06-03T00:00:00.000Z',
      diagnosticCount: 0,
      total: 1,
      returned: 1,
      offset: 0,
      hasMore: false,
      entries: [],
    }, { maxChars: 400 }).length;
    const text = formatExtensionContributionListText({
      generatedAt: '2026-06-03T00:00:00.000Z',
      diagnosticCount: 0,
      total: 1,
      returned: 1,
      offset: 0,
      hasMore: false,
      entries: [entry],
    }, { maxChars: zeroEntryLength + expectedActionBullet(entry).length + 1 });

    expect(text.length).toBeLessThanOrEqual(zeroEntryLength + expectedActionBullet(entry).length + 1);
    expect(text).toContain('Extension contributions: 1 returned of 1 total');
    expect(text).toContain(expectedActionBullet(entry));
  });

  it('does not advertise non-progressing continuation when no entry fits the host budget', () => {
    const text = formatExtensionContributionListText({
      generatedAt: '2026-06-03T00:00:00.000Z',
      diagnosticCount: 0,
      total: 1,
      returned: 1,
      offset: 0,
      hasMore: false,
      entries: [{
        kind: 'action',
        id: `example:${'oversized-'.repeat(80)}`,
        label: 'Large entry',
        extensionName: 'example',
        extensionPath: '/extensions/example',
        actionId: `example:${'oversized-'.repeat(80)}`,
        actionBacked: true,
        outputProfile: 'agent-compact',
        hasInputSchema: true,
        requiredInputKeys: [],
        inputPropertyKeys: Array.from({ length: 80 }, (_, index) => `veryLongPropertyName${index}`),
        inputDefaultKeys: [],
      }],
    }, { maxChars: 400 });

    expect(text).toContain('0 returned of 1 total');
    expect(text).toContain('No entries fit within the host output budget');
    expect(text).not.toContain('Continue: request the next page');
    expect(text).not.toContain('nextOffset 0');
    expect(text).not.toContain('action:example:oversized');
  });

  it('walks budget-aware contribution continuation through every entry with no gaps or duplicates', () => {
    const entries = Array.from({ length: 75 }, (_, index) => ({
      kind: 'action' as const,
      id: `example:page-item-${index}`,
      localId: `page-item-${index}`,
      label: `Paginated Item ${index}`,
      extensionName: 'example',
      extensionPath: '/extensions/example',
      actionId: `example:page-item-${index}`,
      actionLocalId: `page-item-${index}`,
      actionBacked: true,
      outputProfile: 'agent-paginated' as const,
      hasInputSchema: false,
      requiredInputKeys: [],
      inputPropertyKeys: [],
      inputDefaultKeys: [],
    }));
    const seenIds: number[] = [];
    const pageSizes: number[] = [];
    let offset = 0;

    while (offset < entries.length) {
      const text = formatExtensionContributionListText({
        generatedAt: '2026-06-03T00:00:00.000Z',
        diagnosticCount: 0,
        total: entries.length,
        returned: entries.length - offset,
        offset,
        hasMore: offset < entries.length,
        entries: entries.slice(offset),
      }, { maxChars: 1_100 });
      const pageIds = [...text.matchAll(/action:example:page-item-(\d+)/g)].map((match) => Number(match[1]));
      const nextOffsetMatch = text.match(/nextOffset (\d+)/);

      const bulletLines = text.split('\n').filter((line) => line.startsWith('- action:'));

      expect(text.length).toBeLessThanOrEqual(1_100);
      expect(text).toContain(`offset ${offset}`);
      expect(text).toContain(`Extension contributions: ${pageIds.length} returned of ${entries.length} total`);
      if (offset + pageIds.length < entries.length) {
        expect(nextOffsetMatch?.[1]).toBe(String(offset + pageIds.length));
      } else {
        expect(nextOffsetMatch).toBeNull();
      }
      expect(pageIds.length).toBeGreaterThan(0);
      expect(pageIds[0]).toBe(offset);
      expect(bulletLines).toEqual(pageIds.map((id) => expectedActionBullet(entries[id])));
      seenIds.push(...pageIds);
      pageSizes.push(pageIds.length);
      offset = nextOffsetMatch ? Number(nextOffsetMatch[1]) : entries.length;
    }

    expect(pageSizes.length).toBeGreaterThan(1);
    expect(seenIds).toEqual(Array.from({ length: entries.length }, (_, index) => index));
    expect(new Set(seenIds).size).toBe(entries.length);
  });

  it('builds stale-daemon remediation hints without making version skew the failure', () => {
    const hint = buildExtensionErrorVersionHint('0.25.1 (daemon)', '0.25.2 (caller)');

    expect(hint).toContain('Daemon eforgeVersion 0.25.1 (daemon) differs from caller version 0.25.2 (caller)');
    expect(hint).toContain('stale after an update');
    expect(hint).toContain('Restart the eforge daemon');
    expect(hint).not.toContain('incompatible API');
  });

  it('enriches non-2xx extension-domain errors with daemon and caller versions only when versions differ', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-version-hint-'));
    try {
      const port = await startVersionServer('0.25.1-daemon');
      writeLockfile(cwd, { pid: process.pid, port, startedAt: new Date().toISOString() });
      const original = new Error('Daemon returned 404: Extension not found: missing');
      const enriched = await appendExtensionErrorVersionHint(original, { cwd, callerVersion: '0.25.2-caller' });

      expect(enriched.message).toContain('Daemon returned 404: Extension not found: missing');
      expect(enriched.message).toContain('Daemon eforgeVersion 0.25.1-daemon differs from caller version 0.25.2-caller');
      expect(enriched.message).toContain('Restart the eforge daemon');
      expect(enriched.message).toContain('update/rebuild the caller and daemon');
      expect(enriched.message).not.toContain('incompatible API');
      const nonExtension = await appendExtensionErrorVersionHint(new Error('plain network failure'), { cwd, callerVersion: '0.25.2-caller' });
      expect(nonExtension.message).not.toContain('Daemon eforgeVersion');
      await expect(appendExtensionErrorVersionHint(original, { cwd, callerVersion: '0.25.1-daemon' })).resolves.toBe(original);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('adds stale-daemon hints through the real contribution list error path without failing on compatible API version skew alone', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-real-version-hint-'));
    try {
      const port = await startVersionServer('0.25.1-daemon');
      writeLockfile(cwd, { pid: process.pid, port, startedAt: new Date().toISOString() });
      let original: Error | undefined;
      try {
        await listEforgeExtensionContributions({ cwd });
      } catch (err) {
        original = err instanceof Error ? err : new Error(String(err));
      }

      expect(original?.message).toContain('Daemon returned 404');
      const enriched = await appendExtensionErrorVersionHint(original, { cwd, callerVersion: '0.25.2-caller' });
      expect(enriched.message).toContain('Daemon eforgeVersion 0.25.1-daemon differs from caller version 0.25.2-caller');
      expect(enriched.message).toContain('Restart the eforge daemon');
      expect(enriched.message).not.toContain('incompatible API');

      await new Promise<void>((resolve, reject) => versionServer!.close((err) => err ? reject(err) : resolve()));
      versionServer = undefined;
      const successPort = await startVersionServer('0.25.0-compatible-skew', {
        manifestStatus: 200,
        manifestBody: {
          schemaVersion: EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION,
          generatedAt: '2026-06-03T00:00:00.000Z',
          actions: [],
          consoleContributions: [],
          consoleWorkstations: [],
          integrationCommands: [],
          deepLinks: [],
        },
      });
      writeLockfile(cwd, { pid: process.pid, port: successPort, startedAt: new Date().toISOString() });

      await expect(listEforgeExtensionContributions({ cwd })).resolves.toMatchObject({ total: 0, returned: 0 });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('formats failure envelopes without raw input values', () => {
    const largeValue = 'secret-large-value-'.repeat(200);
    const envelope: ExtensionHostContributionFailedInvocationEnvelope = {
      ok: false,
      invocationId: 'invoke-1',
      target: {
        kind: 'action',
        id: 'ext.run',
        label: 'Run',
        extensionName: 'example',
        extensionPath: '/extensions/example',
        actionId: 'ext.run',
      },
      requestedBy: { host: 'cli' },
      error: { code: 'invalid-input', message: 'Bad input' },
      inputSummary: {
        inputKeys: ['largeValue'],
        inputKeyCount: 3,
        serializedInputSize: JSON.stringify({ largeValue }).length,
        omittedInputKeyCount: 1,
        truncatedInputKeyCount: 1,
      },
    };

    const text = formatExtensionContributionFailedInvocationEnvelopeText(envelope);

    expect(text).toContain('action:ext.run');
    expect(text).toContain('invalid-input: Bad input');
    expect(text).toContain('largeValue');
    expect(text).toContain('serialized size');
    expect(text).toContain('1 omitted keys');
    expect(text).toContain('1 truncated keys');
    expect(text).not.toContain(largeValue);
  });
});
