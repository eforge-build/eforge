import { Type, type Static } from '@eforge-build/extension-sdk';

export const MAX_ROADMAP_SHARED_SOURCES = 20;
export const MAX_ROADMAP_SOURCE_PATH_LENGTH = 240;
export const MAX_ROADMAP_SOURCE_LABEL_LENGTH = 120;
export const MAX_ROADMAP_LOCAL_FOCUS_BYTES = 40_000;
export const MAX_ROADMAP_CONTEXT_CONTENT_BYTES = 16_000;
export const MAX_ROADMAP_HEADINGS = 40;
export const MAX_ROADMAP_HEADING_LENGTH = 200;
export const MAX_ROADMAP_EXCERPTS = 5;
export const MAX_ROADMAP_EXCERPT_BYTES = 2_000;

export const RoadmapSourceKindSchema = Type.Union([
  Type.Literal('local-focus'),
  Type.Literal('configured-shared'),
  Type.Literal('discovered-conventional'),
]);
export const RoadmapSourceRoleSchema = Type.Union([
  Type.Literal('local-steering'),
  Type.Literal('shared-context'),
]);
export const ConfiguredRoadmapSourceSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: MAX_ROADMAP_SOURCE_LABEL_LENGTH }),
  path: Type.String({ minLength: 1, maxLength: MAX_ROADMAP_SOURCE_PATH_LENGTH }),
  label: Type.Optional(Type.String({ maxLength: MAX_ROADMAP_SOURCE_LABEL_LENGTH })),
  enabled: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
export const RoadmapConfigSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  sharedSources: Type.Array(ConfiguredRoadmapSourceSchema, { maxItems: MAX_ROADMAP_SHARED_SOURCES }),
}, { additionalProperties: false });
export const RoadmapSourceProjectionSchema = Type.Object({
  kind: RoadmapSourceKindSchema,
  role: RoadmapSourceRoleSchema,
  path: Type.String({ maxLength: MAX_ROADMAP_SOURCE_PATH_LENGTH }),
  id: Type.Optional(Type.String({ maxLength: MAX_ROADMAP_SOURCE_LABEL_LENGTH })),
  label: Type.Optional(Type.String({ maxLength: MAX_ROADMAP_SOURCE_LABEL_LENGTH })),
  configured: Type.Boolean(),
  editable: Type.Boolean(),
  exists: Type.Boolean(),
  sha256: Type.Optional(Type.String({ pattern: '^[a-f0-9]{64}$', maxLength: 64 })),
  headings: Type.Array(Type.String({ maxLength: MAX_ROADMAP_HEADING_LENGTH }), { maxItems: MAX_ROADMAP_HEADINGS }),
  excerpts: Type.Array(Type.String({ maxLength: MAX_ROADMAP_EXCERPT_BYTES }), { maxItems: MAX_ROADMAP_EXCERPTS }),
  content: Type.Optional(Type.String({ maxLength: MAX_ROADMAP_LOCAL_FOCUS_BYTES })),
  contentTruncated: Type.Optional(Type.Boolean()),
  updatedAt: Type.Optional(Type.String()),
  maxContentBytes: Type.Optional(Type.Number()),
  readError: Type.Optional(Type.String({ maxLength: MAX_ROADMAP_CONTEXT_CONTENT_BYTES })),
}, { additionalProperties: false });
export const RoadmapConflictSchema = Type.Object({
  code: Type.Union([
    Type.Literal('configured-source-missing'),
    Type.Literal('duplicate-source'),
    Type.Literal('source-read-error'),
    Type.Literal('invalid-config'),
  ]),
  message: Type.String(),
  path: Type.Optional(Type.String()),
  sourceId: Type.Optional(Type.String()),
}, { additionalProperties: false });
export const RoadmapContextSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  localSteering: RoadmapSourceProjectionSchema,
  sharedContextSources: Type.Array(RoadmapSourceProjectionSchema, { maxItems: MAX_ROADMAP_SHARED_SOURCES }),
  discoveredContextSources: Type.Array(RoadmapSourceProjectionSchema, { maxItems: 1 }),
  assumptions: Type.Array(Type.String()),
  conflicts: Type.Array(RoadmapConflictSchema),
  truncation: Type.Object({ sourceExcerpts: Type.Number(), sourceContent: Type.Number() }, { additionalProperties: false }),
}, { additionalProperties: false });
export const GetRoadmapStateInputSchema = Type.Object({
  includeLocalFocusContent: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
export const UpdateRoadmapStateInputSchema = Type.Object({
  localFocusContent: Type.Optional(Type.String({ maxLength: MAX_ROADMAP_LOCAL_FOCUS_BYTES })),
  expectedLocalFocusSha256: Type.Optional(Type.String({ pattern: '^[a-f0-9]{64}$', maxLength: 64 })),
  sharedSources: Type.Optional(Type.Array(ConfiguredRoadmapSourceSchema, { maxItems: MAX_ROADMAP_SHARED_SOURCES })),
}, { additionalProperties: false, anyOf: [{ required: ['localFocusContent'] }, { required: ['sharedSources'] }] });
export const RoadmapStateResponseSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  config: RoadmapConfigSchema,
  context: RoadmapContextSchema,
  storagePaths: Type.Object({ localFocus: Type.String(), config: Type.String() }, { additionalProperties: false }),
}, { additionalProperties: false });

export type ConfiguredRoadmapSource = Static<typeof ConfiguredRoadmapSourceSchema>;
export type RoadmapConfig = Static<typeof RoadmapConfigSchema>;
export type RoadmapSourceProjection = Static<typeof RoadmapSourceProjectionSchema>;
export type RoadmapConflict = Static<typeof RoadmapConflictSchema>;
export type RoadmapContext = Static<typeof RoadmapContextSchema>;
export type GetRoadmapStateInput = Static<typeof GetRoadmapStateInputSchema>;
export type UpdateRoadmapStateInput = Static<typeof UpdateRoadmapStateInputSchema>;
export type RoadmapStateResponse = Static<typeof RoadmapStateResponseSchema>;
