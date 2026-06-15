import { describe, expect, it } from 'vitest';
import {
  CONTRIBUTION_OUTPUT_PROFILES,
  Type,
  contributionOutputProfile,
  createContributionPageOutputSchema,
  createContributionPaginationInputFields,
  paginateContributionItems,
  resolveContributionPagination,
} from '@eforge-build/extension-sdk';

describe('extension SDK bounded contribution helpers', () => {
  it('exports JSON-safe contribution output profile helpers', () => {
    expect(CONTRIBUTION_OUTPUT_PROFILES).toEqual({
      agentCompact: 'agent-compact',
      agentPaginated: 'agent-paginated',
      markdown: 'markdown',
      uiRich: 'ui-rich',
      debugRich: 'debug-rich',
    });
    expect(contributionOutputProfile(CONTRIBUTION_OUTPUT_PROFILES.agentCompact)).toBe('agent-compact');
    expect(JSON.parse(JSON.stringify(CONTRIBUTION_OUTPUT_PROFILES))).toEqual(CONTRIBUTION_OUTPUT_PROFILES);
  });

  it('creates reusable pagination input fields with a max limit cap', () => {
    const fields = createContributionPaginationInputFields({ maxLimit: 50 });

    expect(fields.limit).toMatchObject({ type: 'integer', minimum: 1, maximum: 50 });
    expect(fields.offset).toMatchObject({ type: 'integer', minimum: 0 });
  });

  it('creates a standard page output schema', () => {
    const itemSchema = Type.Object({ id: Type.String() }, { additionalProperties: false });
    const schema = createContributionPageOutputSchema(itemSchema);

    expect(schema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(Object.keys(schema.properties).sort()).toEqual(['items', 'limit', 'offset', 'total']);
    expect(schema.properties.items).toMatchObject({ type: 'array', items: itemSchema });
  });

  it('resolves pagination defaults and clamps invalid or excessive input', () => {
    expect(resolveContributionPagination({}, { defaultLimit: 10, maxLimit: 25 })).toEqual({ limit: 10, offset: 0 });
    expect(resolveContributionPagination({ limit: 200, offset: 2 }, { defaultLimit: 10, maxLimit: 25 })).toEqual({ limit: 25, offset: 2 });
    expect(resolveContributionPagination({ limit: -1, offset: -5 }, { defaultLimit: 10, maxLimit: 25 })).toEqual({ limit: 10, offset: 0 });
  });

  it('paginates arrays into the standard output shape', () => {
    const page = paginateContributionItems(['a', 'b', 'c', 'd'], { limit: 2, offset: 1 });

    expect(page).toEqual({ items: ['b', 'c'], total: 4, limit: 2, offset: 1 });
  });
});
