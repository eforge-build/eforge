/**
 * Focused tests for read-only preset composition and denylist aliasing
 * across Claude SDK and Pi harness boundaries.
 *
 * These tests exercise the shared tool-safety helpers without requiring live
 * model calls.
 */
import { describe, it, expect } from 'vitest';
import {
  MUTATION_TOOL_DENYLIST_CLAUDE,
  MUTATION_TOOL_DENYLIST_PI,
  SUBAGENT_TOOL_DENYLIST,
  expandDisallowedToolAliasesForPi,
  mergeMutationDisallowedTools,
} from '@eforge-build/engine/harnesses/tool-safety';

describe('MUTATION_TOOL_DENYLIST_CLAUDE', () => {
  it('includes all expected PascalCase mutation tools', () => {
    expect(MUTATION_TOOL_DENYLIST_CLAUDE).toEqual(
      expect.arrayContaining(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash']),
    );
  });

  it('does not include Task (subagent tool is separate)', () => {
    expect(MUTATION_TOOL_DENYLIST_CLAUDE).not.toContain('Task');
  });

  it('does not include lowercase Pi tool names', () => {
    for (const tool of MUTATION_TOOL_DENYLIST_CLAUDE) {
      expect(tool).toBe(tool.slice(0, 1).toUpperCase() + tool.slice(1));
    }
  });
});

describe('MUTATION_TOOL_DENYLIST_PI', () => {
  it('includes lowercase mutation tool names', () => {
    expect(MUTATION_TOOL_DENYLIST_PI).toEqual(
      expect.arrayContaining(['write', 'edit', 'bash']),
    );
  });

  it('uses only lowercase tool names', () => {
    for (const tool of MUTATION_TOOL_DENYLIST_PI) {
      expect(tool).toBe(tool.toLowerCase());
    }
  });
});

describe('SUBAGENT_TOOL_DENYLIST', () => {
  it('contains Task', () => {
    expect(SUBAGENT_TOOL_DENYLIST).toContain('Task');
  });
});

describe('expandDisallowedToolAliasesForPi', () => {
  it('expands Claude PascalCase mutation tools to Pi lowercase equivalents', () => {
    const result = expandDisallowedToolAliasesForPi(['Write', 'Edit', 'Bash']);
    expect(result).toEqual(expect.arrayContaining(['Write', 'Edit', 'Bash', 'write', 'edit', 'bash']));
  });

  it('expands MultiEdit and NotebookEdit both to "edit"', () => {
    const result = expandDisallowedToolAliasesForPi(['MultiEdit', 'NotebookEdit']);
    expect(result).toContain('edit');
    // Original names are preserved
    expect(result).toContain('MultiEdit');
    expect(result).toContain('NotebookEdit');
  });

  it('deduplicates expanded aliases', () => {
    // Both Write and write should result in only one 'write' entry
    const result = expandDisallowedToolAliasesForPi(['Write', 'write']);
    expect(result.filter(t => t === 'write').length).toBe(1);
  });

  it('does not modify non-mutation tool names', () => {
    const result = expandDisallowedToolAliasesForPi(['Task', 'SomeCustomTool']);
    expect(result).toContain('Task');
    expect(result).toContain('SomeCustomTool');
    // No spurious additions
    expect(result).not.toContain('task');
    expect(result).not.toContain('somecustomtool');
  });

  it('preserves Pi lowercase tool names that are already in the list', () => {
    const result = expandDisallowedToolAliasesForPi(['write', 'edit', 'bash']);
    expect(result).toEqual(expect.arrayContaining(['write', 'edit', 'bash']));
    // No duplicates
    expect(result.filter(t => t === 'write').length).toBe(1);
    expect(result.filter(t => t === 'edit').length).toBe(1);
    expect(result.filter(t => t === 'bash').length).toBe(1);
  });

  it('returns a new array and does not mutate the input', () => {
    const input = ['Write', 'Bash'];
    const result = expandDisallowedToolAliasesForPi(input);
    expect(result).not.toBe(input);
    expect(input).toEqual(['Write', 'Bash']);
  });
});

describe('mergeMutationDisallowedTools', () => {
  it('merges all Claude and Pi mutation tools into the result', () => {
    const result = mergeMutationDisallowedTools();
    for (const tool of MUTATION_TOOL_DENYLIST_CLAUDE) {
      expect(result).toContain(tool);
    }
    for (const tool of MUTATION_TOOL_DENYLIST_PI) {
      expect(result).toContain(tool);
    }
  });

  it('preserves existing entries from the input list', () => {
    const result = mergeMutationDisallowedTools(['MyCustomDenyTool']);
    expect(result).toContain('MyCustomDenyTool');
  });

  it('deduplicates entries when the same tool appears in both input and denylist', () => {
    const result = mergeMutationDisallowedTools(['Write', 'write']);
    expect(result.filter(t => t === 'Write').length).toBe(1);
    expect(result.filter(t => t === 'write').length).toBe(1);
  });

  it('does not include Task by default', () => {
    const result = mergeMutationDisallowedTools();
    expect(result).not.toContain('Task');
  });

  it('includes Task when includeSubagent is true', () => {
    const result = mergeMutationDisallowedTools(undefined, { includeSubagent: true });
    expect(result).toContain('Task');
  });

  it('deduplicates Task when already in the input and includeSubagent is true', () => {
    const result = mergeMutationDisallowedTools(['Task'], { includeSubagent: true });
    expect(result.filter(t => t === 'Task').length).toBe(1);
  });

  it('returns a new array and does not mutate the input', () => {
    const input = ['Write'];
    const result = mergeMutationDisallowedTools(input);
    expect(result).not.toBe(input);
    expect(input).toEqual(['Write']);
  });
});
