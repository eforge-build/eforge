import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  formatExtensionContributionOutputText,
  invokeEforgeExtensionContribution,
  listEforgeExtensionContributions,
  type ExtensionHostContributionInvokeResult,
  type ExtensionHostContributionListResponse,
  type ExtensionJsonObject,
} from '@eforge-build/client';
import { createDaemonTool, McpUserError, type McpToolResult } from './mcp-tool-factory.js';

type ContributionToolEnvelope =
  | { action: 'list'; result: ExtensionHostContributionListResponse }
  | { action: 'invoke'; result: ExtensionHostContributionInvokeResult };

export function registerExtensionContributionMcpTool(server: McpServer, cwd: string): void {
  createDaemonTool(server, cwd, {
    name: 'eforge_extension_contribution',
    description:
      'List and invoke extension-provided actions, integration commands, and action-backed deep links. Distinct from eforge_extension extension management.',
    schema: {
      action: z.enum(['list', 'invoke']).describe('List host contributions or invoke one contribution'),
      kind: z.enum(['action', 'command', 'deep-link', 'all']).optional().describe('Contribution kind. Use "all" only when listing all contributions.'),
      id: z.string().min(1).optional().describe('Contribution id. Required when action is "invoke".'),
      input: z.record(z.string(), z.unknown()).optional().describe('JSON object input for invocation.'),
    },
    handler: async ({ action, kind, id, input }, { cwd: toolCwd }) => {
      if (action === 'list') {
        return { action, result: await listEforgeExtensionContributions({ cwd: toolCwd, kind }) } satisfies ContributionToolEnvelope;
      }
      if (!id) throw new Error('"id" is required when action is "invoke"');
      if (kind === 'all') throw new Error('"kind: all" is only valid when action is "list"');
      const result = await invokeEforgeExtensionContribution({
        cwd: toolCwd,
        kind,
        id,
        input: input as ExtensionJsonObject | undefined,
        requestedBy: { host: 'mcp' },
      });
      if (!result.response.ok) throw new McpUserError(result);
      return { action, result } satisfies ContributionToolEnvelope;
    },
    formatResponse: formatContributionToolResponse,
  });
}

function formatContributionToolResponse(data: unknown): McpToolResult {
  if (isToolEnvelope(data) && data.action === 'invoke') {
    const { result } = data;
    if (!result.response.ok) return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: true };
    const text = [
      `Invocation: ${result.response.invocationId}`,
      `Target: ${result.target.kind}:${result.target.id}`,
      `Action: ${result.target.actionId}`,
      '',
      formatExtensionContributionOutputText(result.response.output, { outputProfile: result.target.outputProfile }),
    ].join('\n');
    return { content: [{ type: 'text', text }] };
  }
  const payload = isToolEnvelope(data) ? data.result : data;
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function isToolEnvelope(data: unknown): data is ContributionToolEnvelope {
  return typeof data === 'object' && data !== null && 'action' in data && 'result' in data;
}
