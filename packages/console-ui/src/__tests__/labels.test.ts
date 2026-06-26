import { describe, it, expect } from 'vitest';
import { selectPrdDisplayLabel, slugToDisplayLabel } from '@/lib/selectors/labels';

describe('slugToDisplayLabel', () => {
  it.each([
    ['hyphen-separated words', 'add-server-support', 'Add Server Support'],
    ['underscore-separated words', 'fix_auth_flow', 'Fix Auth Flow'],
    ['slug acronym: prd', 'create-prd-template', 'Create PRD Template'],
    ['slug acronym: ui', 'refactor-ui-layout', 'Refactor UI Layout'],
    ['slug acronym: mcp', 'add-mcp-server', 'Add MCP Server'],
    ['slug acronym: cli', 'update-cli-commands', 'Update CLI Commands'],
    ['slug acronym: api', 'fix-api-auth', 'Fix API Auth'],
    ['date-prefix: ISO', '2024-01-15-add-feature', 'Add Feature'],
    ['markdown extension: .md', 'my-feature.md', 'My Feature'],
    ['single word', 'cleanup', 'Cleanup'],
    ['multiple acronyms', 'migrate-api-to-mcp', 'Migrate API To MCP'],
  ])('%s', (_label, slug, expected) => {
    expect(slugToDisplayLabel(slug)).toBe(expected);
  });
});

describe('selectPrdDisplayLabel', () => {
  describe('explicit title', () => {
    it.each([
      ['clean title', 'Add MCP Server Support', 'add-mcp-server', 'Add MCP Server Support'],
      ['trim whitespace', '  My Feature  ', 'my-feature', 'My Feature'],
      ['title matches slug', 'CLI Improvements', 'cli-improvements', 'CLI Improvements'],
    ])('%s', (_label, title, slug, expected) => {
      expect(selectPrdDisplayLabel(title, slug)).toBe(expected);
    });
  });

  describe('markdown-title rejection', () => {
    it.each([
      ['markdown rejection: # heading', '# Add MCP Server', 'add-mcp-server', 'Add MCP Server'],
      ['markdown rejection: ## heading', '## Overview', 'overview', 'Overview'],
      ['markdown rejection: bold markers', '**Bold Title**', 'bold-title', 'Bold Title'],
      ['markdown rejection: backtick', 'Add `code` here', 'add-code', 'Add Code'],
      ['markdown rejection: link', '[Click here](http://example.com)', 'click-here', 'Click Here'],
      ['markdown rejection: newline body leak', 'Add MCP Server\n\nThis PRD describes adding MCP server support.', 'add-mcp-server', 'Add MCP Server'],
      ['markdown rejection: long body leak', 'A'.repeat(200), 'add-mcp-server', 'Add MCP Server'],
    ])('%s', (_label, title, slug, expected) => {
      expect(selectPrdDisplayLabel(title, slug)).toBe(expected);
    });
  });

  describe('slug title-casing fallback', () => {
    it.each([
      ['fallback: undefined title', undefined, 'add-mcp-server', 'Add MCP Server'],
      ['fallback: null title', null, 'refactor-ui-layout', 'Refactor UI Layout'],
      ['fallback: empty title', '', 'fix-cli-output', 'Fix CLI Output'],
      ['fallback: whitespace title', '   ', 'fix-api-timeout', 'Fix API Timeout'],
      ['fallback acronym: cli', undefined, 'improve-cli-ux', 'Improve CLI Ux'],
      ['fallback: raw id when slug reduces to x', undefined, 'x', 'X'],
    ])('%s', (_label, title, slug, expected) => {
      expect(selectPrdDisplayLabel(title, slug)).toBe(expected);
    });
  });
});
