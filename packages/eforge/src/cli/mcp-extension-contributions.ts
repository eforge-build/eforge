import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  apiGetExtensionContributionManifest,
  createExtensionContributionFailedInvocationEnvelope,
  formatExtensionContributionDetailText,
  formatExtensionContributionListText,
  formatExtensionContributionOutputText,
  invokeEforgeExtensionContribution,
  listEforgeExtensionContributions,
  showExtensionContributionManifestEntry,
  type ExtensionActionOutputProfile,
  type ExtensionHostContributionDetailResponse,
  type ExtensionHostContributionInvokeResult,
  type ExtensionHostContributionKind,
  type ExtensionHostContributionListResponse,
  type ExtensionHostContributionProjection,
  type ExtensionJsonObject,
} from '@eforge-build/client';
import { createDaemonTool, McpUserError, type McpToolResult } from './mcp-tool-factory.js';

const OUTPUT_PROFILES = ['agent-compact', 'agent-paginated', 'markdown', 'ui-rich', 'debug-rich'] as const;

type ContributionToolEnvelope =
  | { action: 'list'; result: ExtensionHostContributionListResponse }
  | { action: 'show'; result: ExtensionHostContributionDetailResponse }
  | { action: 'invoke'; result: ExtensionHostContributionInvokeResult };

export function registerExtensionContributionMcpTool(server: McpServer, cwd: string): void {
  createDaemonTool(server, cwd, {
    name: 'eforge_extension_contribution',
    description:
      'List, show, and invoke extension-provided actions, integration commands, and action-backed deep links with compact formatted output by default. List supports kind, extensionName, search, idPrefix, outputProfile, limit, offset, includeInputSchema, includeDiagnostics, and full; show supports id, kind, includeInputSchema, includeDiagnostics, and full. Failed invocations return a summarized error envelope without target.input. Distinct from eforge_extension extension management.',
    schema: {
      action: z.enum(['list', 'show', 'invoke']).describe('List host contributions, show one contribution, or invoke one contribution'),
      kind: z.enum(['action', 'command', 'deep-link', 'all']).optional().describe('Contribution kind. Use "all" only when listing all contributions.'),
      id: z.string().min(1).optional().describe('Contribution id. Required when action is "show" or "invoke".'),
      extensionName: z.string().min(1).optional().describe('Filter list results to one extension name.'),
      search: z.string().min(1).optional().describe('Case-insensitive list search across id, label, description, extension, and action metadata.'),
      idPrefix: z.string().min(1).optional().describe('Filter list results to contribution ids with this prefix.'),
      outputProfile: z.enum(OUTPUT_PROFILES).optional().describe('Filter list results by declared action output profile.'),
      limit: z.number().int().positive().optional().describe('Maximum number of list entries to return.'),
      offset: z.number().int().nonnegative().optional().describe('Zero-based list offset for pagination.'),
      includeInputSchema: z.boolean().optional().describe('Include input schema/defaults in list or show detail.'),
      includeDiagnostics: z.boolean().optional().describe('Include manifest diagnostics in list or show detail.'),
      full: z.boolean().optional().describe('Return the full shared projection, including schemas and diagnostics.'),
      input: z.record(z.string(), z.unknown()).optional().describe('JSON object input for invocation.'),
    },
    handler: async (params, { cwd: toolCwd }) => {
      if (params.action === 'list') {
        return {
          action: params.action,
          result: await listEforgeExtensionContributions({
            cwd: toolCwd,
            kind: params.kind as ExtensionHostContributionKind | 'all' | undefined,
            extensionName: params.extensionName,
            search: params.search,
            idPrefix: params.idPrefix,
            outputProfile: params.outputProfile as ExtensionActionOutputProfile | undefined,
            limit: params.limit,
            offset: params.offset,
            includeInputSchema: params.includeInputSchema,
            includeDiagnostics: params.includeDiagnostics,
            projection: projectionFromFullFlag(params.full),
          }),
        } satisfies ContributionToolEnvelope;
      }
      if (!params.id) throw invalidContributionRequest(`"id" is required when action is "${params.action}"`);
      if (params.kind === 'all') throw invalidContributionRequest('"kind: all" is only valid when action is "list"');
      if (params.action === 'show') {
        const manifest = await apiGetExtensionContributionManifest({ cwd: toolCwd });
        try {
          return {
            action: params.action,
            result: showExtensionContributionManifestEntry(manifest, {
              id: params.id,
              kind: params.kind as ExtensionHostContributionKind | undefined,
              includeInputSchema: params.includeInputSchema,
              includeDiagnostics: params.includeDiagnostics,
              projection: projectionFromFullFlag(params.full),
            }),
          } satisfies ContributionToolEnvelope;
        } catch (err) {
          throw invalidContributionRequest((err as Error).message);
        }
      }
      try {
        const result = await invokeEforgeExtensionContribution({
          cwd: toolCwd,
          kind: params.kind as ExtensionHostContributionKind | undefined,
          id: params.id,
          input: params.input as ExtensionJsonObject | undefined,
          requestedBy: { host: 'mcp' },
        });
        if (!result.response.ok) throw contributionInvocationFailed(result);
        return { action: params.action, result } satisfies ContributionToolEnvelope;
      } catch (err) {
        if (isContributionRequestError(err)) throw invalidContributionRequest((err as Error).message);
        throw err;
      }
    },
    formatResponse: formatContributionToolResponse,
  });
}

function projectionFromFullFlag(full: boolean | undefined): ExtensionHostContributionProjection | undefined {
  return full ? 'full' : undefined;
}

function invalidContributionRequest(message: string): McpUserError {
  return new McpUserError({ code: 'invalid-request', message });
}

function contributionInvocationFailed(result: ExtensionHostContributionInvokeResult): McpUserError {
  const failureEnvelope = createExtensionContributionFailedInvocationEnvelope(result);
  return new McpUserError(failureEnvelope ?? {
    ok: false,
    invocationId: result.response.ok ? 'unknown' : result.response.invocationId,
    target: {
      kind: result.target.kind,
      id: result.target.id,
      label: result.target.label,
      extensionName: result.target.extensionName,
      extensionPath: result.target.extensionPath,
      actionId: result.target.actionId,
      outputProfile: result.target.outputProfile,
    },
    requestedBy: result.target.requestedBy,
    error: result.response.ok ? { code: 'unknown', message: 'Unknown contribution invocation failure' } : result.response.error,
    inputSummary: { inputKeys: [], inputKeyCount: 0, serializedInputSize: 0 },
  });
}

function isContributionRequestError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /^("|Unknown extension|Ambiguous extension|Deep link )/.test(err.message);
}

function formatContributionToolResponse(data: unknown): McpToolResult {
  if (isToolEnvelope(data) && data.action === 'list') {
    return { content: [{ type: 'text', text: formatExtensionContributionListText(data.result) }] };
  }
  if (isToolEnvelope(data) && data.action === 'show') {
    return { content: [{ type: 'text', text: formatExtensionContributionDetailText(data.result) }] };
  }
  if (isToolEnvelope(data) && data.action === 'invoke') {
    const { result } = data;
    if (!result.response.ok) throw contributionInvocationFailed(result);
    const text = [
      `Invocation: ${result.response.invocationId}`,
      `Target: ${result.target.kind}:${result.target.id}`,
      `Action: ${result.target.actionId}`,
      '',
      formatExtensionContributionOutputText(result.response.output, { outputProfile: result.target.outputProfile }),
    ].join('\n');
    return { content: [{ type: 'text', text }] };
  }
  return { content: [{ type: 'text', text: String(data) }] };
}

function isToolEnvelope(data: unknown): data is ContributionToolEnvelope {
  return typeof data === 'object' && data !== null && 'action' in data && 'result' in data;
}
