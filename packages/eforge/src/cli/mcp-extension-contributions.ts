import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  invokeEforgeExtensionContribution,
  listEforgeExtensionContributions,
  type ExtensionJsonObject,
} from '@eforge-build/client';
import { createDaemonTool, McpUserError } from './mcp-tool-factory.js';

export function registerExtensionContributionMcpTool(server: McpServer, cwd: string): void {
  createDaemonTool(server, cwd, {
    name: 'eforge_extension_contribution',
    description:
      'List and invoke extension-provided actions, integration commands, and action-backed deep links. Distinct from eforge_extension extension management.',
    schema: {
      action: z.enum(['list', 'invoke']).describe('List host contributions or invoke one contribution'),
      kind: z.enum(['action', 'command', 'deep-link']).optional().describe('Contribution kind. Required when an id is ambiguous.'),
      id: z.string().min(1).optional().describe('Contribution id. Required when action is "invoke".'),
      input: z.record(z.string(), z.unknown()).optional().describe('JSON object input for invocation.'),
    },
    handler: async ({ action, kind, id, input }, { cwd: toolCwd }) => {
      if (action === 'list') {
        return listEforgeExtensionContributions({ cwd: toolCwd, kind });
      }
      if (!id) throw new Error('"id" is required when action is "invoke"');
      const result = await invokeEforgeExtensionContribution({
        cwd: toolCwd,
        kind,
        id,
        input: input as ExtensionJsonObject | undefined,
        requestedBy: { host: 'mcp' },
      });
      if (!result.response.ok) throw new McpUserError(result);
      return result;
    },
  });
}
