import { describe, it, expect } from 'vitest';
import { selectPrdDisplayLabel, slugToDisplayLabel } from '@/lib/selectors/labels';

describe('slugToDisplayLabel', () => {
  it('title-cases hyphen-separated words', () => {
    expect(slugToDisplayLabel('add-server-support')).toBe('Add Server Support');
  });

  it('title-cases underscore-separated words', () => {
    expect(slugToDisplayLabel('fix_auth_flow')).toBe('Fix Auth Flow');
  });

  it('preserves PRD acronym', () => {
    expect(slugToDisplayLabel('create-prd-template')).toBe('Create PRD Template');
  });

  it('preserves UI acronym', () => {
    expect(slugToDisplayLabel('refactor-ui-layout')).toBe('Refactor UI Layout');
  });

  it('preserves MCP acronym', () => {
    expect(slugToDisplayLabel('add-mcp-server')).toBe('Add MCP Server');
  });

  it('preserves CLI acronym', () => {
    expect(slugToDisplayLabel('update-cli-commands')).toBe('Update CLI Commands');
  });

  it('preserves API acronym', () => {
    expect(slugToDisplayLabel('fix-api-auth')).toBe('Fix API Auth');
  });

  it('strips date prefix with ISO format', () => {
    expect(slugToDisplayLabel('2024-01-15-add-feature')).toBe('Add Feature');
  });

  it('strips .md extension', () => {
    expect(slugToDisplayLabel('my-feature.md')).toBe('My Feature');
  });

  it('handles single word', () => {
    expect(slugToDisplayLabel('cleanup')).toBe('Cleanup');
  });

  it('handles multiple acronyms in one slug', () => {
    expect(slugToDisplayLabel('migrate-api-to-mcp')).toBe('Migrate API To MCP');
  });
});

describe('selectPrdDisplayLabel', () => {
  describe('explicit title', () => {
    it('returns explicit title when present and clean', () => {
      expect(selectPrdDisplayLabel('Add MCP Server Support', 'add-mcp-server')).toBe(
        'Add MCP Server Support',
      );
    });

    it('trims whitespace from explicit title', () => {
      expect(selectPrdDisplayLabel('  My Feature  ', 'my-feature')).toBe('My Feature');
    });

    it('returns explicit title even when it matches a slug', () => {
      expect(selectPrdDisplayLabel('CLI Improvements', 'cli-improvements')).toBe(
        'CLI Improvements',
      );
    });
  });

  describe('markdown-title rejection', () => {
    it('falls back to slug when title starts with markdown heading #', () => {
      expect(selectPrdDisplayLabel('# Add MCP Server', 'add-mcp-server')).toBe('Add MCP Server');
    });

    it('falls back to slug when title has ## heading', () => {
      expect(selectPrdDisplayLabel('## Overview', 'overview')).toBe('Overview');
    });

    it('falls back to slug when title contains bold markers', () => {
      expect(selectPrdDisplayLabel('**Bold Title**', 'bold-title')).toBe('Bold Title');
    });

    it('falls back to slug when title contains backtick', () => {
      expect(selectPrdDisplayLabel('Add `code` here', 'add-code')).toBe('Add Code');
    });

    it('falls back to slug when title contains markdown link', () => {
      expect(selectPrdDisplayLabel('[Click here](http://example.com)', 'click-here')).toBe(
        'Click Here',
      );
    });
  });

  describe('slug title-casing fallback', () => {
    it('title-cases slug when title is undefined', () => {
      expect(selectPrdDisplayLabel(undefined, 'add-mcp-server')).toBe('Add MCP Server');
    });

    it('title-cases slug when title is null', () => {
      expect(selectPrdDisplayLabel(null, 'refactor-ui-layout')).toBe('Refactor UI Layout');
    });

    it('title-cases slug when title is empty string', () => {
      expect(selectPrdDisplayLabel('', 'fix-cli-output')).toBe('Fix CLI Output');
    });

    it('title-cases slug when title is whitespace only', () => {
      expect(selectPrdDisplayLabel('   ', 'fix-api-timeout')).toBe('Fix API Timeout');
    });

    it('preserves CLI acronym from slug', () => {
      expect(selectPrdDisplayLabel(undefined, 'improve-cli-ux')).toBe('Improve CLI Ux');
    });

    it('returns raw id when slug is empty after processing', () => {
      expect(selectPrdDisplayLabel(undefined, 'x')).toBe('X');
    });
  });
});
