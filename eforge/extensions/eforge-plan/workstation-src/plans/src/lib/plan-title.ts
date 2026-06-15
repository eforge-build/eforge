// The planning agent is seeded with a machine prompt ("Draft a session plan for
// recommendation group-x covering ...") and sometimes leaves it as the draft
// topic, which then persists as the plan topic. That string is a prompt, not a
// title - detect it so callers can fall back to a readable label instead of
// restating the whole prompt across the backlog card and the Plans tab.
//
// INVARIANT: this mirrors the persist-time safety net in the extension backend
// (`planner-orchestration.ts` - `conciseTopic`). The seed-prompt regex and slug
// humanization MUST stay identical across both: that is the durable fix, this is
// the render-time fallback. They live in separate bundles and cannot share a
// module, so change them together.
export function isGeneratedPlannerPrompt(value: string): boolean {
  return /^draft a session plan for /i.test(value.trim());
}

// A readable plan title: the topic when the agent authored a real one, otherwise
// a humanized session slug (the verbose seed prompt is never shown as a title).
export function planDisplayTitle(topic: string | undefined, fallbackSlug: string): string {
  const trimmed = topic?.trim() ?? '';
  if (trimmed && !isGeneratedPlannerPrompt(trimmed)) return trimmed;
  return humanizeSlug(fallbackSlug) || trimmed || fallbackSlug;
}

function humanizeSlug(slug: string): string {
  return slug
    .replace(/^(?:group|epic)-/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}
