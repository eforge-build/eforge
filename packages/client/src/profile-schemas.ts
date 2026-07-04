import { Type, type Static } from '@sinclair/typebox';

export const ProfileMetadataSchema = Type.Object({
  description: Type.Optional(Type.String()),
  whenToUse: Type.Optional(Type.Array(Type.String())),
  tags: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: true });

export const AgentRuntimeProfileInfoSchema = Type.Object({
  name: Type.String(),
  harness: Type.Optional(Type.Union([Type.Literal('claude-sdk'), Type.Literal('pi')])),
  path: Type.String(),
  scope: Type.Union([Type.Literal('local'), Type.Literal('project'), Type.Literal('user')]),
  shadowedBy: Type.Optional(Type.Union([Type.Literal('local'), Type.Literal('project')])),
  metadata: Type.Optional(ProfileMetadataSchema),
}, { additionalProperties: true });

export const AgentRuntimeProfileSourceSchema = Type.Union([
  Type.Literal('local'),
  Type.Literal('project'),
  Type.Literal('user-local'),
  Type.Literal('missing'),
  Type.Literal('none'),
]);

export const ProfileListResponseSchema = Type.Object({
  profiles: Type.Array(AgentRuntimeProfileInfoSchema),
  active: Type.Union([Type.String(), Type.Null()]),
  source: AgentRuntimeProfileSourceSchema,
}, { additionalProperties: true });

export type ProfileMetadataFromSchema = Static<typeof ProfileMetadataSchema>;
export type AgentRuntimeProfileInfoFromSchema = Static<typeof AgentRuntimeProfileInfoSchema>;
export type ProfileListResponseFromSchema = Static<typeof ProfileListResponseSchema>;
