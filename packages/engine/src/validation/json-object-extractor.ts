/**
 * Finds the first balanced JSON object in model output text.
 *
 * Fenced `json` and unlabeled code blocks are inspected before the full text so
 * agents can wrap canonical JSON in Markdown without losing parseability.
 */
export function findJsonObjectText(text: string): string | undefined {
  const fencedBlocks = [...text.matchAll(/```([^\r\n]*)\r?\n([\s\S]*?)\r?\n?```/g)]
    .filter((match) => isEligibleFenceInfo(match[1]))
    .map((match) => match[2]);
  for (const block of fencedBlocks) {
    const objectText = findBalancedObject(block);
    if (objectText) return objectText;
  }
  return findBalancedObject(text);
}

function isEligibleFenceInfo(info: string): boolean {
  const trimmed = info.trim();
  if (trimmed === '') return true;
  return trimmed.split(/\s+/, 1)[0]?.toLowerCase() === 'json';
}

function findBalancedObject(text: string): string | undefined {
  const start = text.indexOf('{');
  if (start === -1) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth++;
    if (char === '}') depth--;
    if (depth === 0) return text.slice(start, index + 1);
  }

  return undefined;
}
