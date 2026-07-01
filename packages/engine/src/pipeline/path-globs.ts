// --- eforge:region plan-01-runtime-choice-core ---
/** Focused path-glob matching for runtime-choice routing. */

function escapeRegexChar(ch: string): string {
  return /[|\\{}()[\]^$+?.]/.test(ch) ? `\\${ch}` : ch;
}

function expandBraceAlternates(pattern: string): string {
  return pattern.replace(/\{([^{}]+)\}/g, (_match, body: string) => `(${body.split(',').map((part) => part.trim().split('').map(escapeRegexChar).join('')).join('|')})`);
}

function globToRegex(pattern: string): RegExp {
  let out = '^';
  const expanded = expandBraceAlternates(pattern.replace(/\\/g, '/'));
  for (let i = 0; i < expanded.length; i += 1) {
    const ch = expanded[i];
    const next = expanded[i + 1];
    if (ch === '*') {
      if (next === '*') {
        const after = expanded[i + 2];
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
    if (ch === '(' || ch === ')' || ch === '|') {
      out += ch;
      continue;
    }
    out += escapeRegexChar(ch);
  }
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
// --- eforge:endregion plan-01-runtime-choice-core ---
