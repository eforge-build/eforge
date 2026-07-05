import { Type, type Static } from '@sinclair/typebox';

export const LOCALIZATION_ISSUE_KINDS = ['generic', 'missing-owner-path', 'missing-contract-evidence', 'missing-entrypoint-evidence', 'missing-config-evidence', 'missing-consumer-surface-evidence', 'directory-only-evidence', 'missing-materialized-source', 'localization-ambiguity', 'too-broad', 'tool-budget'] as const;

export const LocalizationIssueKindSchema = Type.Union(LOCALIZATION_ISSUE_KINDS.map((kind) => Type.Literal(kind)));

export type LocalizationIssueKind = Static<typeof LocalizationIssueKindSchema>;
