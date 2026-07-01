import { Type } from '@sinclair/typebox';
import { AgentRoleSchema, ReviewPerspectiveKeySchema } from './schemas.js';

export const RuntimeChoiceSourceSchema = Type.Union([
  Type.Literal('default'),
  Type.Literal('rule'),
  Type.Literal('extension-router'),
  Type.Literal('fallback'),
]);

export const RuntimeChoiceFallbackReasonSchema = Type.Union([
  Type.Literal('no-match'),
  Type.Literal('router-declined'),
  Type.Literal('router-timeout'),
  Type.Literal('router-error'),
  Type.Literal('router-invalid-choice'),
]);

export const agentStartFields = {
  planId: Type.Optional(Type.String()),
  agentId: Type.String(),
  agent: AgentRoleSchema,
  model: Type.String(),
  harness: Type.Union([Type.Literal('claude-sdk'), Type.Literal('pi')]),
  harnessSource: Type.Literal('tier'),
  tier: Type.String(),
  tierSource: Type.Union([
    Type.Literal('tier'),
    Type.Literal('role'),
    Type.Literal('plan'),
  ]),
  runtimeChoice: Type.String(),
  runtimeChoiceQualified: Type.String(),
  runtimeChoiceSource: RuntimeChoiceSourceSchema,
  runtimeChoiceRule: Type.Optional(Type.String()),
  runtimeChoiceRouter: Type.Optional(Type.String()),
  runtimeChoiceFallbackReason: Type.Optional(RuntimeChoiceFallbackReasonSchema),
  effort: Type.Optional(Type.String()),
  effortSource: Type.Optional(
    Type.Union([Type.Literal('tier'), Type.Literal('role'), Type.Literal('plan')]),
  ),
  thinking: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  thinkingSource: Type.Optional(
    Type.Union([Type.Literal('tier'), Type.Literal('role'), Type.Literal('plan')]),
  ),
  effortClamped: Type.Optional(Type.Boolean()),
  effortOriginal: Type.Optional(Type.String()),
  thinkingCoerced: Type.Optional(Type.Boolean()),
  thinkingOriginal: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  perspective: Type.Optional(ReviewPerspectiveKeySchema),
  /** The toolbelt name selected for this tier. Null when explicitly 'none', string when named. */
  toolbelt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  /** Provenance of the toolbelt selection. */
  toolbeltSource: Type.Optional(Type.Union([
    Type.Literal('tier'),
    Type.Literal('role'),
    Type.Literal('plan'),
    Type.Literal('default'),
  ])),
  /** Which project MCP servers were selected for this tier. */
  projectMcpSelection: Type.Optional(Type.Union([
    Type.Literal('all'),
    Type.Literal('none'),
    Type.Literal('toolbelt'),
  ])),
  /** Sorted names of the project MCP servers passed to this tier's harness. */
  projectMcpServerNames: Type.Optional(Type.Array(Type.String())),
};
