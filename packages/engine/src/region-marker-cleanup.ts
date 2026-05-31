import { execFile } from 'node:child_process';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { promisify } from 'node:util';

import { retryOnLock } from './git.js';

const exec = promisify(execFile);
const GIT_MAX_BUFFER = 100 * 1024 * 1024;

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const SKIPPED_PATH_SEGMENTS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.eforge',
  '.next',
  'coverage',
  '.turbo',
  'out',
  'build',
]);

const TEMPORARY_EFORGE_REGION_MARKER_LINE = /^[\t ]*(?:(?:\/\/[\t ]*---[\t ]*eforge:(?:end)?region[\t ]+plan-\d{2}-\S+[\t ]*---)|(?:\{\/\*[\t ]*---[\t ]*eforge:(?:end)?region[\t ]+plan-\d{2}-\S+[\t ]*---[\t ]*\*\/\})|(?:\/\*[\t ]*---[\t ]*eforge:(?:end)?region[\t ]+plan-\d{2}-\S+[\t ]*---[\t ]*\*\/))[\t ]*$/;

export interface TemporaryEforgeRegionMarkerCleanupSummary {
  filesScanned: number;
  filesChanged: number;
  markersRemoved: number;
  changedFiles: string[];
}

/**
 * Remove whole-line temporary plan-ID eforge region marker comments.
 * Code inside the marked region and durable semantic marker slugs are preserved.
 */
export function stripTemporaryEforgeRegionMarkerLines(content: string): string {
  return stripTemporaryEforgeRegionMarkerLinesWithCount(content).content;
}

/**
 * Strip temporary plan-ID eforge region marker lines from tracked JS/TS-family files
 * and stage the rewritten files for the existing cleanup commit.
 */
export async function stripTemporaryEforgeRegionMarkers(cwd: string): Promise<TemporaryEforgeRegionMarkerCleanupSummary> {
  const { stdout } = await exec('git', ['ls-files', '-z'], { cwd, maxBuffer: GIT_MAX_BUFFER });
  const sourceFiles = splitNul(stdout).filter(isSupportedTrackedSourcePath);
  const fileChanges: Array<{ filePath: string; originalContent: string; content: string; markersRemoved: number }> = [];

  for (const filePath of sourceFiles) {
    const absolutePath = resolve(cwd, filePath);
    const stat = await lstat(absolutePath);
    if (!stat.isFile()) continue;

    const content = await readFile(absolutePath, 'utf8');
    const stripped = stripTemporaryEforgeRegionMarkerLinesWithCount(content);
    if (stripped.markersRemoved === 0) continue;

    fileChanges.push({
      filePath,
      originalContent: content,
      content: stripped.content,
      markersRemoved: stripped.markersRemoved,
    });
  }

  const writtenChanges: typeof fileChanges = [];
  try {
    for (const change of fileChanges) {
      const absolutePath = resolve(cwd, change.filePath);
      const stat = await lstat(absolutePath);
      if (!stat.isFile()) continue;

      await writeFile(absolutePath, change.content, 'utf8');
      writtenChanges.push(change);
    }

    const stagedFiles = writtenChanges.map((change) => change.filePath);
    if (stagedFiles.length > 0) {
      await retryOnLock(() => exec('git', ['add', '--', ...stagedFiles], { cwd, maxBuffer: GIT_MAX_BUFFER }), cwd);
    }
  } catch (error) {
    await rollbackWrittenChanges(cwd, writtenChanges);
    throw error;
  }

  const changedFiles = writtenChanges.map((change) => change.filePath);

  return {
    filesScanned: sourceFiles.length,
    filesChanged: changedFiles.length,
    markersRemoved: writtenChanges.reduce((total, change) => total + change.markersRemoved, 0),
    changedFiles,
  };
}

async function rollbackWrittenChanges(
  cwd: string,
  writtenChanges: Array<{ filePath: string; originalContent: string }>,
): Promise<void> {
  for (const change of [...writtenChanges].reverse()) {
    const absolutePath = resolve(cwd, change.filePath);
    const stat = await lstat(absolutePath);
    if (!stat.isFile()) continue;

    await writeFile(absolutePath, change.originalContent, 'utf8');
  }

  if (writtenChanges.length > 0) {
    const changedFiles = writtenChanges.map((change) => change.filePath);
    await retryOnLock(() => exec('git', ['add', '--', ...changedFiles], { cwd, maxBuffer: GIT_MAX_BUFFER }), cwd);
  }
}

function stripTemporaryEforgeRegionMarkerLinesWithCount(content: string): { content: string; markersRemoved: number } {
  const lines = content.match(/.*(?:\r?\n|$)/g) ?? [];
  if (lines.at(-1) === '') lines.pop();

  const state: LexicalState = { blockComment: false, quote: null, escaped: false };
  let markersRemoved = 0;
  let stripped = '';

  for (const line of lines) {
    if (isOutsideStringOrComment(state) && TEMPORARY_EFORGE_REGION_MARKER_LINE.test(stripLineEnding(line))) {
      markersRemoved += 1;
      continue;
    }

    stripped += line;
    updateLexicalState(state, line);
  }

  return { content: stripped, markersRemoved };
}

type Quote = '"' | "'" | '`';

interface LexicalState {
  blockComment: boolean;
  quote: Quote | null;
  escaped: boolean;
}

function isOutsideStringOrComment(state: LexicalState): boolean {
  return !state.blockComment && state.quote === null;
}

function stripLineEnding(line: string): string {
  return line.replace(/\r?\n$/, '');
}

function updateLexicalState(state: LexicalState, line: string): void {
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (state.blockComment) {
      if (char === '*' && next === '/') {
        state.blockComment = false;
        index += 1;
      }
      continue;
    }

    if (state.quote !== null) {
      if (state.escaped) {
        state.escaped = false;
      } else if (char === '\\') {
        state.escaped = true;
      } else if (char === state.quote) {
        state.quote = null;
      } else if (state.quote !== '`' && (char === '\n' || char === '\r')) {
        state.quote = null;
      }
      continue;
    }

    if (char === '/' && next === '/') return;
    if (char === '/' && next === '*') {
      state.blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      state.quote = char;
      state.escaped = false;
    }
  }
}

function splitNul(output: string): string[] {
  return output.split('\0').filter(Boolean);
}

function isSupportedTrackedSourcePath(filePath: string): boolean {
  if (!SOURCE_EXTENSIONS.has(extname(filePath))) return false;
  return !filePath.split('/').some((segment) => SKIPPED_PATH_SEGMENTS.has(segment));
}
