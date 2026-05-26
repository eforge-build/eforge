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

describe('Console source guards', () => {
  const files = collectSourceFiles(srcDir);

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
