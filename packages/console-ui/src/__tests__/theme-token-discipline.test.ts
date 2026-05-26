// @vitest-environment node
// --- eforge:region plan-05-system-activity-progressive-disclosure-and-guards ---
/**
 * theme-token-discipline — source-grep enforcement for theme token discipline.
 *
 * Scans all .ts/.tsx source files under packages/console-ui/src/ (excluding
 * __tests__ directories) and fails the test if any file contains:
 *  1. Arbitrary hex color utility classes (bg-[#...], text-[#...], border-[#...]).
 *  2. Arbitrary pixel text-size classes (text-[Npx]).
 *
 * All colors must use CSS custom properties defined in globals.css and
 * Tailwind semantic tokens (e.g. text-muted-foreground, bg-primary).
 * All font sizes must use named Tailwind scale steps (text-xs, text-sm, etc.).
 */
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

const allSourceFiles = collectSourceFiles(srcDir);

// ---------------------------------------------------------------------------
// Hex color utility guard
// ---------------------------------------------------------------------------

describe('Theme token discipline — no hex color utility classes', () => {
  /**
   * Matches Tailwind arbitrary hex color classes such as:
   *   bg-[#abc123]  text-[#FFF]  border-[#0f172a]  border-t-[#abc]
   *
   * These should be replaced with CSS custom property tokens defined in
   * globals.css and referenced via Tailwind semantic utility names.
   */
  const hexColorPattern = /(?:bg|text|border(?:-[a-zA-Z]+)?)-\[#[0-9a-fA-F]/;

  it('has no hex color utility classes in console source files', () => {
    const violations: string[] = [];
    for (const filePath of allSourceFiles) {
      const content = readFileSync(filePath, 'utf8');
      const lines = nonCommentLines(content);
      for (const { line, text } of lines) {
        if (hexColorPattern.test(text)) {
          violations.push(`${filePath}:${line}: ${text.trim()}`);
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `Console source files must not use hex color utility classes (use CSS tokens instead):\n${violations.join('\n')}`,
      );
    }
    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Arbitrary pixel text-size guard
// ---------------------------------------------------------------------------

describe('Theme token discipline — no arbitrary pixel text-size classes', () => {
  /**
   * Matches Tailwind arbitrary pixel text-size classes such as:
   *   text-[10px]  text-[11px]  text-[13px]
   *
   * These should be replaced with named Tailwind text-size scale steps:
   *   text-xs (12px), text-sm (14px), text-base (16px), etc.
   */
  const pixelTextPattern = /text-\[\d+px\]/;

  it('has no arbitrary pixel text-size classes in console source files', () => {
    const violations: string[] = [];
    for (const filePath of allSourceFiles) {
      const content = readFileSync(filePath, 'utf8');
      const lines = nonCommentLines(content);
      for (const { line, text } of lines) {
        if (pixelTextPattern.test(text)) {
          violations.push(`${filePath}:${line}: ${text.trim()}`);
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `Console source files must not use arbitrary pixel text-size classes (use Tailwind text-size scale instead):\n${violations.join('\n')}`,
      );
    }
    expect(violations).toHaveLength(0);
  });
});
// --- eforge:endregion plan-05-system-activity-progressive-disclosure-and-guards ---
