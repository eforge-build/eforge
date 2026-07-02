/**
 * Bounded, deterministic summaries of compiler data for the planning quality
 * reviewer prompt. Pure functions: no I/O, no LLM involvement. Every list is
 * item-capped with an explicit "(+N more)" marker and the final text is
 * byte-capped so a pathological compile cannot blow up the reviewer prompt.
 */
import type { SourceInventory } from '../planner-compiler/source-inventory.js';
import type { CompilerDiagnostics } from '../planner-compiler/compiler-diagnostics-contracts.js';

const MAX_LIST_ITEMS = 40;
const MAX_LINE_CHARS = 240;
const MAX_SUMMARY_BYTES = 8_192;

function truncateLine(text: string): string {
  const flattened = text.replace(/\s+/g, ' ').trim();
  return flattened.length > MAX_LINE_CHARS ? `${flattened.slice(0, MAX_LINE_CHARS - 1)}…` : flattened;
}

function boundedList(items: string[], render: (item: string) => string = (item) => `- ${truncateLine(item)}`): string[] {
  const shown = items.slice(0, MAX_LIST_ITEMS).map(render);
  if (items.length > MAX_LIST_ITEMS) shown.push(`- (+${items.length - MAX_LIST_ITEMS} more)`);
  return shown;
}

function capBytes(text: string): string {
  if (Buffer.byteLength(text, 'utf-8') <= MAX_SUMMARY_BYTES) return text;
  let result = text;
  while (Buffer.byteLength(result, 'utf-8') > MAX_SUMMARY_BYTES - 20) {
    result = result.slice(0, Math.floor(result.length * 0.9));
  }
  return `${result}\n… (summary truncated)`;
}

/**
 * Summarize compiler-diagnostics.json for the reviewer: coverage status,
 * reduce gaps/conflicts with resolutions, repair outcome, and residue
 * decisions. The reviewer uses this to judge whether uncovered criteria are
 * represented by blocking diagnostics.
 */
export function summarizeCompilerDiagnosticsForReview(diagnostics: CompilerDiagnostics): string {
  const lines: string[] = [];
  lines.push(`Compiler status: ${diagnostics.compilerStatus}`);
  lines.push(`Repair status: ${diagnostics.repair.status} (${diagnostics.repair.attempts.length} recorded attempt(s))`);

  if (diagnostics.validationErrors.length > 0) {
    lines.push('', 'Validation errors:');
    lines.push(...boundedList(diagnostics.validationErrors));
  }

  lines.push('', `Coverage: ${diagnostics.coverage.completeCriteria.length} complete criteria, ${diagnostics.coverage.incompleteCriteria.length} incomplete.`);
  if (diagnostics.coverage.incompleteCriteria.length > 0) {
    lines.push('Incomplete criteria:');
    lines.push(...boundedList(diagnostics.coverage.incompleteCriteria));
  }

  if (diagnostics.reduce.gaps.length > 0) {
    lines.push('', 'Reduce gaps:');
    lines.push(...boundedList(diagnostics.reduce.gaps.map((gap) =>
      `${gap.gapId} [${gap.resolution}${gap.representedByCandidateId ? ` by ${gap.representedByCandidateId}` : ''}] ${gap.title}: ${gap.description}`)));
  }
  if (diagnostics.reduce.conflicts.length > 0) {
    lines.push('', 'Reduce conflicts:');
    lines.push(...boundedList(diagnostics.reduce.conflicts.map((conflict) =>
      `${conflict.conflictId} [${conflict.resolution}${conflict.representedByCandidateId ? ` by ${conflict.representedByCandidateId}` : ''}] ${conflict.title}: ${conflict.description}`)));
  }

  lines.push('', `Residue synthesis blocked: ${diagnostics.residue.synthesisBlocked}`);
  if (diagnostics.residue.blockedReasons.length > 0) {
    lines.push('Blocked reasons:');
    lines.push(...boundedList(diagnostics.residue.blockedReasons));
  }
  if (diagnostics.residue.candidates.length > 0) {
    lines.push('Residue candidates:');
    lines.push(...boundedList(diagnostics.residue.candidates.map((candidate) =>
      `${candidate.candidateId} [${candidate.kind}/${candidate.buildability}, reason: ${candidate.reason}] ${candidate.title} (criteria: ${candidate.criterionIds.join(', ') || 'none'})`)));
  }

  if (diagnostics.evidenceFailures.length > 0) {
    lines.push('', `Evidence materialization failures: ${diagnostics.evidenceFailures.length}`);
    lines.push(...boundedList(diagnostics.evidenceFailures.map((failure) =>
      `${failure.path} [${failure.status}]${failure.reason ? ` ${failure.reason}` : ''}`)));
  }

  const omittedTotal = Object.values(diagnostics.omitted).reduce((sum, value) => sum + value, 0);
  if (omittedTotal > 0) {
    lines.push('', `Note: the diagnostics artifact itself omitted ${omittedTotal} entries for size; consult compiler-diagnostics.json omitted counts.`);
  }

  return capBytes(lines.join('\n'));
}

/**
 * Summarize the deterministic source inventory for the reviewer: the criterion
 * ids and texts the compiler planned against, so coverage findings can be
 * traced back to inventory ids.
 */
export function summarizeSourceInventoryForReview(inventory: SourceInventory): string {
  const lines: string[] = [];
  lines.push(`Source inventory: ${inventory.summary.criterionCount} acceptance criteria across ${inventory.summary.headingCount} headings (${inventory.summary.byteLength} bytes).`);

  if (inventory.criteria.length > 0) {
    lines.push('', 'Criteria:');
    lines.push(...boundedList(inventory.criteria.map((criterion) => `${criterion.id}: ${criterion.text}`)));
  }
  if (inventory.subsystemHints.length > 0) {
    lines.push('', `Subsystem hints: ${truncateLine(inventory.subsystemHints.slice(0, MAX_LIST_ITEMS).join(', '))}`);
  }
  if (inventory.interfaceKeys.length > 0) {
    lines.push(`Interface keys: ${truncateLine(inventory.interfaceKeys.slice(0, MAX_LIST_ITEMS).join(', '))}`);
  }

  return capBytes(lines.join('\n'));
}
