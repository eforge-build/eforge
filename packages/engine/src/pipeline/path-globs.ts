/** Focused path-glob matching for runtime-choice routing. */

function escapeRegexChar(ch: string): string {
  return /[|\\{}()[\]^$+?.]/.test(ch) ? `\\${ch}` : ch;
}

function appendGlobRegex(pattern: string): string {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    const next = pattern[i + 1];
    if (ch === '*') {
      if (next === '*') {
        const after = pattern[i + 2];
        if (after === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
      continue;
    }
    if (ch === '?') {
      out += '[^/]';
      continue;
    }
    out += escapeRegexChar(ch);
  }
  return out;
}

function globToRegex(pattern: string): RegExp {
  let out = '^';
  const normalized = pattern.replace(/\\/g, '/');
  let segmentStart = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    if (normalized[i] !== '{') continue;
    const close = normalized.indexOf('}', i + 1);
    if (close <= i + 1) continue;
    out += appendGlobRegex(normalized.slice(segmentStart, i));
    const body = normalized.slice(i + 1, close);
    out += `(${body.split(',').map((part) => appendGlobRegex(part.trim())).join('|')})`;
    i = close;
    segmentStart = close + 1;
  }
  out += appendGlobRegex(normalized.slice(segmentStart));
  out += '$';
  return new RegExp(out);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function pathMatchesGlob(path: string, pattern: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedPattern = normalizePath(pattern);
  if (!normalizedPattern.includes('*') && !normalizedPattern.includes('?') && !normalizedPattern.includes('{')) {
    return normalizedPath === normalizedPattern || normalizedPath.startsWith(`${normalizedPattern.replace(/\/$/, '')}/`);
  }
  return globToRegex(normalizedPattern).test(normalizedPath);
}

export function anyPathMatchesGlob(paths: readonly string[], patterns: readonly string[]): boolean {
  return paths.some((path) => patterns.some((pattern) => pathMatchesGlob(path, pattern)));
}
