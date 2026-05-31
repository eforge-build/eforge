// @vitest-environment node
// --- eforge:region console-shell ---
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = join(fileURLToPath(new URL('..', import.meta.url)));

/** Recursively collect all .ts and .tsx source files excluding __tests__ and node_modules. */
function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectSourceFiles(full));
    } else if (stat.isFile() && (extname(entry) === '.ts' || extname(entry) === '.tsx')) {
      results.push(full);
    }
  }
  return results;
}

/** Return non-comment lines from file content. */
function nonCommentLines(content: string): Array<{ line: number; text: string }> {
  return content
    .split('\n')
    .map((text, index) => ({ line: index + 1, text }))
    .filter(({ text }) => {
      const trimmed = text.trimStart();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    });
}

/** Recursively collect source files under a specific subdirectory. */
function collectSourceFilesUnder(subDir: string): string[] {
  const fullDir = join(srcDir, subDir);
  try {
    statSync(fullDir);
  } catch {
    return [];
  }
  return collectSourceFiles(fullDir);
}

const allSourceFiles = collectSourceFiles(srcDir);

describe('Console source guards', () => {
  const files = allSourceFiles;

  it('has no @eforge-build/engine imports in console source files', () => {
    const violations: string[] = [];
    for (const filePath of files) {
      const content = readFileSync(filePath, 'utf8');
      const lines = nonCommentLines(content);
      for (const { line, text } of lines) {
        if (text.includes('@eforge-build/engine')) {
          violations.push(`${filePath}:${line}: ${text.trim()}`);
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `Console source files must not import @eforge-build/engine:\n${violations.join('\n')}`,
      );
    }
    expect(violations).toHaveLength(0);
  });

  it('has no hardcoded /api/ literal strings in console source files', () => {
    // Matches quote or backtick followed by /api/ — these should use API_ROUTES instead
    const apiLiteralPattern = /['"`]\/api\//;
    const violations: string[] = [];
    for (const filePath of files) {
      const content = readFileSync(filePath, 'utf8');
      const lines = nonCommentLines(content);
      for (const { line, text } of lines) {
        if (apiLiteralPattern.test(text)) {
          violations.push(`${filePath}:${line}: ${text.trim()}`);
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `Console source files must not use hardcoded /api/ literals (use API_ROUTES instead):\n${violations.join('\n')}`,
      );
    }
    expect(violations).toHaveLength(0);
  });
});
// --- eforge:endregion console-shell ---

// --- eforge:region plan-02-queue-view ---
describe('Queue view architecture guards', () => {
  const queueFiles = collectSourceFilesUnder('views/queue');

  it('queue view files do not call useDaemonEvents', () => {
    const violations: string[] = [];
    for (const filePath of queueFiles) {
      const content = readFileSync(filePath, 'utf8');
      const lines = nonCommentLines(content);
      for (const { line, text } of lines) {
        if (text.includes('useDaemonEvents')) {
          violations.push(`${filePath}:${line}: ${text.trim()}`);
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `Queue view files must not call useDaemonEvents (consume projectState via props instead):\n${violations.join('\n')}`,
      );
    }
    expect(violations).toHaveLength(0);
  });

  it('queue selector imports QueueItem from @eforge-build/client/browser', () => {
    const queueSelectorPath = join(srcDir, 'lib/selectors/queue.ts');
    const content = readFileSync(queueSelectorPath, 'utf8');
    expect(content).toMatch(/from\s+['"]@eforge-build\/client\/browser['"]/);
    expect(content).toMatch(/QueueItem/);
  });

  it('console source does not redeclare a local daemon queue response interface', () => {
    // Interfaces/types named like QueueResponse, DaemonQueue*, or QueueApiResponse
    // must not be declared locally — they belong in @eforge-build/client
    const queueResponsePattern = /\b(?:interface|type)\s+\w*(?:Queue(?:Response|ApiResponse)|DaemonQueue\w*)\b/;
    const violations: string[] = [];
    for (const filePath of allSourceFiles) {
      const content = readFileSync(filePath, 'utf8');
      const lines = nonCommentLines(content);
      for (const { line, text } of lines) {
        if (queueResponsePattern.test(text)) {
          violations.push(`${filePath}:${line}: ${text.trim()}`);
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `Console source must not redeclare daemon queue response interfaces (use @eforge-build/client types):\n${violations.join('\n')}`,
      );
    }
    expect(violations).toHaveLength(0);
  });

  it('console source does not declare local QueueRecovery request/response wire shapes', () => {
    const recoveryShapePattern = /^\s*(?:export\s+)?(?:interface|type)\s+QueueRecovery\w*(?:Request|Response)\b\s*(?:=|\{|extends\b)/;
    const violations: string[] = [];
    for (const filePath of allSourceFiles) {
      const content = readFileSync(filePath, 'utf8');
      const lines = nonCommentLines(content);
      for (const { line, text } of lines) {
        if (recoveryShapePattern.test(text)) {
          violations.push(`${filePath}:${line}: ${text.trim()}`);
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `Console source must import queue recovery request/response types from @eforge-build/client/browser instead of declaring them locally:\n${violations.join('\n')}`,
      );
    }
    expect(violations).toHaveLength(0);
  });

  it('queue view files do not redeclare a daemon queue response shape (structural check)', () => {
    // Detect any interface or type alias block in queue view files that declares 3 or more
    // of the forbidden queue item field names as direct properties. Such a block is a
    // prohibited structural re-declaration of the QueueItem wire shape, regardless of name.
    const FORBIDDEN_QUEUE_FIELDS = [
      'id', 'title', 'status', 'priority', 'created', 'dependsOn', 'recoveryVerdict',
    ];

    /** Extract the bodies of interface/type blocks from source content. */
    function extractTypeBlockBodies(content: string): string[] {
      const bodies: string[] = [];
      const pattern = /\b(?:interface|type)\s+\w+[^{;]*\{/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const startIdx = match.index + match[0].length;
        let depth = 1;
        let i = startIdx;
        while (i < content.length && depth > 0) {
          if (content[i] === '{') depth++;
          else if (content[i] === '}') depth--;
          i++;
        }
        bodies.push(content.slice(startIdx, i - 1));
      }
      return bodies;
    }

    /** Count how many forbidden queue fields are declared as properties in a type block body. */
    function countQueueFields(body: string): number {
      return FORBIDDEN_QUEUE_FIELDS.filter((field) =>
        new RegExp(`^\\s+${field}\\s*\\??:`, 'm').test(body),
      ).length;
    }

    const violations: string[] = [];
    for (const filePath of queueFiles) {
      const content = readFileSync(filePath, 'utf8');
      for (const body of extractTypeBlockBodies(content)) {
        if (countQueueFields(body) >= 3) {
          violations.push(filePath);
          break;
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `Queue view files must not redeclare daemon queue response shapes (use QueueItem from @eforge-build/client):\n${violations.join('\n')}`,
      );
    }
    expect(violations).toHaveLength(0);
  });
});
// --- eforge:endregion plan-02-queue-view ---
