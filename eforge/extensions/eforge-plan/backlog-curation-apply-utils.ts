// --- eforge:region markdown-section-helpers ---
export function applySectionOperations(body: string, operations: readonly { heading: string; action: 'replace' | 'append'; content: string }[]): string {
  let next = body;
  for (const operation of operations) next = applySectionOperation(next, operation);
  return next;
}

export function appendEvidence(body: string, evidence: readonly string[]): string {
  const bullets = evidence.map((entry) => entry.trim()).filter(Boolean).map((entry) => `- ${entry}`).join('\n');
  return bullets.length === 0 ? body : applySectionOperation(body, { heading: 'Evidence', action: 'append', content: bullets });
}

export function fieldPath(root: string, pointer: string): string {
  if (pointer.length === 0) return root;
  return pointer.split('/').filter(Boolean).reduce((path, part) => (/^\d+$/.test(part) ? `${path}[${part}]` : `${path}.${part}`), root);
}

function applySectionOperation(body: string, operation: { heading: string; action: 'replace' | 'append'; content: string }): string {
  const heading = operation.heading.trim();
  const lines = splitLinesPreservingEndings(body);
  const start = lines.findIndex((line) => new RegExp(`^#{2,6}\\s+${escapeRegExp(heading)}\\s*$`).test(line.replace(/\r?\n$/u, '')));
  if (start === -1) return appendNewSection(body, heading, operation.content);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{2,6}\s+/.test(lines[index])) { end = index; break; }
  }
  const prefix = lines.slice(0, start + 1).join('');
  const existing = lines.slice(start + 1, end).join('').trim();
  const suffix = lines.slice(end).join('');
  const content = operation.action === 'replace' || existing.length === 0 ? operation.content.trim() : `${existing}\n\n${operation.content.trim()}`;
  return `${prefix}\n${content}\n${suffix.startsWith('\n') || suffix.length === 0 ? '' : '\n'}${suffix}`;
}

function splitLinesPreservingEndings(value: string): string[] {
  const matches = value.match(/.*(?:\r?\n|$)/gu) ?? [];
  return matches.filter((line, index) => line.length > 0 || index < matches.length - 1);
}

function appendNewSection(body: string, heading: string, content: string): string {
  return `${body.trimEnd()}\n\n## ${heading}\n\n${content.trim()}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// --- eforge:endregion markdown-section-helpers ---
