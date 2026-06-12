import { Type, type TSchema, type Static } from './schema.js';

export const DEFAULT_CONTRIBUTION_PAGE_LIMIT = 20;
export const DEFAULT_CONTRIBUTION_MAX_LIMIT = 100;

export interface ContributionPaginationOptions {
  defaultLimit?: number;
  maxLimit?: number;
}

export interface ContributionPaginationInput {
  limit?: number;
  offset?: number;
}

export interface ResolvedContributionPagination {
  limit: number;
  offset: number;
}

export interface ContributionPage<T> extends ResolvedContributionPagination {
  items: T[];
  total: number;
}

export function createContributionPaginationInputFields(options: ContributionPaginationOptions = {}) {
  const maxLimit = normalizePositiveInteger(options.maxLimit, DEFAULT_CONTRIBUTION_MAX_LIMIT);
  return {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: maxLimit })),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
  };
}

export function createContributionPageOutputSchema<ItemSchema extends TSchema>(itemSchema: ItemSchema) {
  return Type.Object({
    items: Type.Array(itemSchema),
    total: Type.Integer({ minimum: 0 }),
    limit: Type.Integer({ minimum: 1 }),
    offset: Type.Integer({ minimum: 0 }),
  }, { additionalProperties: false });
}

export function resolveContributionPagination(
  input: ContributionPaginationInput,
  options: ContributionPaginationOptions = {},
): ResolvedContributionPagination {
  const maxLimit = normalizePositiveInteger(options.maxLimit, DEFAULT_CONTRIBUTION_MAX_LIMIT);
  const defaultLimit = Math.min(normalizePositiveInteger(options.defaultLimit, DEFAULT_CONTRIBUTION_PAGE_LIMIT), maxLimit);
  const requestedLimit = normalizePositiveInteger(input.limit, defaultLimit);
  const requestedOffset = normalizeNonNegativeInteger(input.offset, 0);
  return { limit: Math.min(requestedLimit, maxLimit), offset: requestedOffset };
}

export function paginateContributionItems<T>(
  items: readonly T[],
  input: ContributionPaginationInput,
  options: ContributionPaginationOptions = {},
): ContributionPage<T> {
  const { limit, offset } = resolveContributionPagination(input, options);
  return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
}

export type ContributionPageOutput<ItemSchema extends TSchema> = Static<ReturnType<typeof createContributionPageOutputSchema<ItemSchema>>>;

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}
