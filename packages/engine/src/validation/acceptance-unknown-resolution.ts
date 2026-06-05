import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { AcceptanceCriterionVerdict, EforgeEvent } from '../events.js';
import { validateReadOnlyArgv, validateReadOnlyPathArg } from './read-only-command-validation.js';
import { matchVerdictsToExpected, normalizeCriterionMatchText, type ExpectedAcceptanceCriterion } from './acceptance-criteria.js';
import { findJsonObjectText } from './json-object-extractor.js';

export type AcceptanceValidationEvent = Extract<EforgeEvent, { type: 'acceptance_validation:complete' }>;

export interface ValidationCommandEvidence {
  command: string;
  exitCode: number;
  output?: string;
}

export interface AcceptanceUnknownResolverEvidence {
  type: 'file' | 'command';
  path?: string;
  argv?: string[];
  excerpt?: string;
  output?: string;
  detail?: string;
}

export interface AcceptanceUnknownResolution {
  criterion: string;
  verdict: 'pass' | 'fail';
  evidence: AcceptanceUnknownResolverEvidence;
}

export interface AcceptanceUnknownResolverRequest {
  unknownCriteria: ExpectedAcceptanceCriterion[];
  acceptanceVerdicts: AcceptanceCriterionVerdict[];
  validationCommandEvidence?: ValidationCommandEvidence[];
  implementationDiffContext: string;
}

export interface AcceptanceUnknownResolutionGateInput {
  prdValidationPassed: boolean | undefined;
  expectedAcceptanceCriteria?: readonly ExpectedAcceptanceCriterion[];
  acceptanceEvent?: AcceptanceValidationEvent;
  validationCommandEvidence?: readonly ValidationCommandEvidence[];
}

export function getExpectedUnknownCriteria(
  expected: readonly ExpectedAcceptanceCriterion[],
  verdicts: readonly AcceptanceCriterionVerdict[],
): ExpectedAcceptanceCriterion[] {
  const matched = matchVerdictsToExpected(expected, verdicts);
  return expected.filter((criterion) => matched.get(criterion.id)?.verdict === 'unknown');
}

export function shouldRunAcceptanceUnknownResolver(input: AcceptanceUnknownResolutionGateInput): boolean {
  if (input.prdValidationPassed !== true) return false;
  if (!input.acceptanceEvent) return false;
  const expected = input.expectedAcceptanceCriteria ?? [];
  if (expected.length === 0) return false;
  if (input.acceptanceEvent.verdicts.some((verdict) => verdict.verdict === 'fail')) return false;
  if ((input.validationCommandEvidence ?? []).some((command) => command.exitCode !== 0)) return false;
  return getExpectedUnknownCriteria(expected, input.acceptanceEvent.verdicts).length > 0;
}

export interface AcceptanceUnknownEvidenceVerificationOptions {
  cwd?: string;
  implementationDiffContext?: string;
  commandEvidence?: readonly ValidationCommandEvidence[];
}

export function parseAcceptanceUnknownResolverOutput(
  text: string,
  unknownCriteria: readonly ExpectedAcceptanceCriterion[],
  verification?: AcceptanceUnknownEvidenceVerificationOptions,
): AcceptanceUnknownResolution[] {
  if (text.trim() === '') {
    throw new Error('Acceptance unknown resolver produced no output');
  }

  const jsonText = findJsonObjectText(text);
  if (!jsonText) {
    throw new Error('Acceptance unknown resolver output did not contain a JSON object');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Acceptance unknown resolver output was malformed JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Acceptance unknown resolver output must be a JSON object');
  }
  const rawVerdicts = (parsed as { verdicts?: unknown; resolvedVerdicts?: unknown }).verdicts
    ?? (parsed as { resolvedVerdicts?: unknown }).resolvedVerdicts;
  if (!Array.isArray(rawVerdicts)) {
    throw new Error('Acceptance unknown resolver output must include a verdicts array');
  }

  const unknownByRef = buildUnknownCriterionReferenceMap(unknownCriteria);
  const seen = new Set<string>();
  return rawVerdicts.map((entry): AcceptanceUnknownResolution => {
    const resolution = parseResolutionEntry(entry, verification);
    const criterion = unknownByRef.get(normalizeCriterionReference(resolution.criterion));
    if (!criterion) {
      throw new Error(`Resolver verdict targets an unknown or non-unresolved criterion: ${resolution.criterion}`);
    }
    if (seen.has(criterion.id)) {
      throw new Error(`Resolver produced duplicate verdicts for criterion ${criterion.id}`);
    }
    seen.add(criterion.id);
    return { ...resolution, criterion: criterion.id };
  });
}

export function mergeAcceptanceUnknownResolutions(
  event: AcceptanceValidationEvent,
  expected: readonly ExpectedAcceptanceCriterion[],
  resolutions: readonly AcceptanceUnknownResolution[],
  verification?: AcceptanceUnknownEvidenceVerificationOptions,
): AcceptanceValidationEvent {
  if (resolutions.length === 0) {
    return { ...event, passed: event.verdicts.length > 0 && event.verdicts.every((verdict) => verdict.verdict === 'pass') };
  }

  const resolutionByExpectedId = new Map(resolutions.map((resolution) => [resolution.criterion, resolution]));
  const matched = matchVerdictsToExpected(expected, event.verdicts);
  const replacementByVerdict = new Map<AcceptanceCriterionVerdict, AcceptanceCriterionVerdict>();

  for (const criterion of expected) {
    const resolution = resolutionByExpectedId.get(criterion.id);
    const verdict = matched.get(criterion.id);
    if (!resolution || !verdict) continue;
    if (verdict.verdict !== 'unknown') {
      throw new Error(`Resolver attempted to replace non-unknown criterion ${criterion.id}`);
    }
    verifyResolverEvidence(resolution, verification);
    replacementByVerdict.set(verdict, {
      criterion: criterion.text,
      verdict: resolution.verdict,
      evidence: formatResolutionEvidence(resolution.evidence),
    });
  }

  const verdicts = event.verdicts.map((verdict) => replacementByVerdict.get(verdict) ?? verdict);
  return {
    ...event,
    verdicts,
    passed: verdicts.length > 0 && verdicts.every((verdict) => verdict.verdict === 'pass'),
  };
}

export function hasUnresolvedAcceptanceUnknowns(
  event: AcceptanceValidationEvent,
  expected: readonly ExpectedAcceptanceCriterion[],
): boolean {
  return getExpectedUnknownCriteria(expected, event.verdicts).length > 0;
}

function parseResolutionEntry(entry: unknown, verification?: AcceptanceUnknownEvidenceVerificationOptions): AcceptanceUnknownResolution {
  if (typeof entry !== 'object' || entry === null) {
    throw new Error('Resolver verdict entry must be an object');
  }
  const raw = entry as Record<string, unknown>;
  const criterion = typeof raw.criterion === 'string' ? raw.criterion.trim() : '';
  const verdict = raw.verdict;
  if (criterion === '') throw new Error('Resolver verdict entry is missing criterion');
  if (verdict !== 'pass' && verdict !== 'fail') {
    throw new Error(`Resolver verdict for ${criterion} must be pass or fail`);
  }
  const evidence = parseEvidence(raw.evidence, criterion);
  const resolution: AcceptanceUnknownResolution = { criterion, verdict, evidence };
  verifyResolverEvidence(resolution, verification);
  return resolution;
}

function parseEvidence(rawEvidence: unknown, criterion: string): AcceptanceUnknownResolverEvidence {
  if (typeof rawEvidence !== 'object' || rawEvidence === null) {
    throw new Error(`Resolver verdict for ${criterion} must include structured evidence`);
  }
  const raw = rawEvidence as Record<string, unknown>;
  const type = raw.type;
  if (type !== 'file' && type !== 'command') {
    throw new Error(`Resolver verdict for ${criterion} must use file or command evidence`);
  }
  const evidence: AcceptanceUnknownResolverEvidence = { type };
  if (typeof raw.path === 'string' && raw.path.trim() !== '') evidence.path = raw.path.trim();
  if (Array.isArray(raw.argv) && raw.argv.every((arg) => typeof arg === 'string' && arg.trim() !== '')) evidence.argv = raw.argv.map((arg) => arg.trim());
  if (typeof raw.excerpt === 'string' && raw.excerpt.trim() !== '') evidence.excerpt = raw.excerpt.trim();
  if (typeof raw.output === 'string' && raw.output.trim() !== '') evidence.output = raw.output.trim();
  if (typeof raw.detail === 'string' && raw.detail.trim() !== '') evidence.detail = raw.detail.trim();

  const hasNonEmptyEvidence = Boolean(evidence.excerpt || evidence.output || evidence.detail);
  if (type === 'file' && !evidence.path) {
    throw new Error(`Resolver file evidence for ${criterion} must include a non-empty path`);
  }
  if (type === 'command' && (!evidence.argv || evidence.argv.length === 0)) {
    throw new Error(`Resolver command evidence for ${criterion} must include a non-empty argv array`);
  }
  if (!hasNonEmptyEvidence) {
    throw new Error(`Resolver evidence for ${criterion} must include non-empty evidence text`);
  }
  return evidence;
}

function verifyResolverEvidence(
  resolution: AcceptanceUnknownResolution,
  verification?: AcceptanceUnknownEvidenceVerificationOptions,
): void {
  if (!verification) return;
  if (resolution.verdict !== 'pass') return;
  const evidence = resolution.evidence;
  if (evidence.type === 'command') {
    if (!evidence.argv) throw new Error(`Resolver command evidence for ${resolution.criterion} must include argv`);
    validateReadOnlyArgv(evidence.argv, verification.cwd);
    if (verification.commandEvidence && !verification.commandEvidence.some((record) => commandEvidenceMatches(record, evidence))) {
      throw new Error(`Resolver command evidence for ${resolution.criterion} was not produced by a recorded read-only command`);
    }
    return;
  }
  if (!evidence.path || !evidence.excerpt) throw new Error(`Resolver file evidence for ${resolution.criterion} must include path and excerpt`);
  validateReadOnlyPathArg(evidence.path, verification.cwd);
  if (!fileEvidenceMatches(evidence.path, evidence.excerpt, verification)) {
    throw new Error(`Resolver file evidence for ${resolution.criterion} could not be verified`);
  }
}

function commandEvidenceMatches(record: ValidationCommandEvidence, evidence: AcceptanceUnknownResolverEvidence): boolean {
  if (!evidence.argv) return false;
  const commandText = evidence.argv.join(' ');
  if (record.command !== commandText) return false;
  if (typeof evidence.output !== 'string') return true;
  return (record.output ?? '').includes(evidence.output);
}

function fileEvidenceMatches(pathValue: string, excerpt: string, verification: AcceptanceUnknownEvidenceVerificationOptions): boolean {
  if (verification.implementationDiffContext?.includes(excerpt)) return true;
  if (!verification.cwd) return false;
  const fullPath = path.resolve(verification.cwd, pathValue);
  if (!existsSync(fullPath)) return false;
  return readFileSync(fullPath, 'utf8').includes(excerpt);
}

function buildUnknownCriterionReferenceMap(criteria: readonly ExpectedAcceptanceCriterion[]): Map<string, ExpectedAcceptanceCriterion> {
  const map = new Map<string, ExpectedAcceptanceCriterion>();
  for (const criterion of criteria) {
    map.set(normalizeCriterionReference(criterion.id), criterion);
    map.set(normalizeCriterionReference(`${criterion.id}: ${criterion.text}`), criterion);
    map.set(normalizeCriterionReference(criterion.text), criterion);
  }
  return map;
}

function normalizeCriterionReference(value: string): string {
  const trimmed = value.trim();
  const idPrefix = trimmed.match(/^(ac-\d{3})\b/i)?.[1];
  return idPrefix ? idPrefix.toLowerCase() : normalizeCriterionMatchText(trimmed);
}

function formatResolutionEvidence(evidence: AcceptanceUnknownResolverEvidence): string {
  const body = evidence.detail ?? evidence.excerpt ?? evidence.output ?? '';
  if (evidence.type === 'file') {
    return `Acceptance unknown resolver file evidence (${evidence.path}): ${body}`;
  }
  return `Acceptance unknown resolver command evidence (${evidence.argv?.join(' ')}): ${body}`;
}

