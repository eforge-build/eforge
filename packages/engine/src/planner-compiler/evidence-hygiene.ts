import { stableSlug } from './source-analysis.js';

export type PlanningEvidenceKind = 'file' | 'directory' | 'generated-artifact' | 'broad-directory' | 'tool-noise' | 'text';

export interface PlanningEvidenceCandidate {
  raw: string;
  value: string;
  kind: PlanningEvidenceKind;
  actionable: boolean;
  rank: number;
  reason: string;
}

const GENERATED_FILE_RE = /(?:^|\/)(?:planner-inspection-handoff\.json|output\.json|orchestration\.ya?ml|graph\.json)$|(?:^|\/)plans\/[^/]+\/(?:architecture\.md|acceptance-coverage\.md)$/;
const PATH_RE = /(?:\.\/)?[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+(?:\/[A-Za-z0-9._-]+)*\/?/g;
const BROAD_DIRECTORIES = new Set(['.', './', 'src', 'src/', 'lib', 'lib/', 'packages', 'packages/', 'apps', 'apps/', 'services', 'services/', 'test', 'test/', 'tests', 'tests/', 'docs', 'docs/']);

export function extractEvidenceCandidatesFromText(text: string): PlanningEvidenceCandidate[] {
  return rankEvidenceCandidates([...text.matchAll(PATH_RE)].map((match) => match[0]));
}

export function rankEvidenceCandidates(values: Iterable<string>): PlanningEvidenceCandidate[] {
  const byValue = new Map<string, PlanningEvidenceCandidate>();
  for (const raw of values) {
    const candidate = classifyEvidenceCandidate(raw);
    const existing = byValue.get(candidate.value);
    if (!existing || candidate.rank > existing.rank) byValue.set(candidate.value, candidate);
  }
  return [...byValue.values()].sort((a, b) => b.rank - a.rank || a.value.localeCompare(b.value));
}

export function actionableEvidencePaths(values: Iterable<string>): string[] {
  return rankEvidenceCandidates(values).filter((candidate) => candidate.actionable).map((candidate) => candidate.value);
}

export function classifyEvidenceCandidate(raw: string): PlanningEvidenceCandidate {
  const value = normalizeEvidenceValue(raw);
  if (!value || /^(?:read|find|grep|ls|bash) called$/i.test(value) || value.includes('[omitted ')) return candidate(raw, value, 'tool-noise', false, 0, 'tool-noise');
  if (isGeneratedPlanningArtifactPath(value)) return candidate(raw, value, 'generated-artifact', false, 5, 'generated-planning-artifact');
  if (isBroadDirectory(value)) return candidate(raw, value, 'broad-directory', false, 10, 'broad-directory');
  if (looksLikeFile(value)) return candidate(raw, value, 'file', true, fileRank(value), 'actionable-file');
  if (value.includes('/')) return candidate(raw, value, 'directory', true, directoryRank(value), 'actionable-directory');
  return candidate(raw, value, 'text', false, 1, 'not-a-path');
}

export function normalizeEvidenceValue(raw: string): string {
  return raw.trim().replace(/^['"`]+|['"`),:;.]+$/g, '').replace(/^\.\//, '');
}

export function evidenceSlug(value: string): string {
  return stableSlug(normalizeEvidenceValue(value));
}

export function isGeneratedPlanningArtifactPath(path: string): boolean {
  return path.includes('/.decomposition/') || path.startsWith('.decomposition/') || path.startsWith('eforge/plans/') || GENERATED_FILE_RE.test(path);
}

function candidate(raw: string, value: string, kind: PlanningEvidenceKind, actionable: boolean, rank: number, reason: string): PlanningEvidenceCandidate {
  return { raw, value, kind, actionable, rank, reason };
}

function isBroadDirectory(value: string): boolean {
  if (BROAD_DIRECTORIES.has(value)) return true;
  const segments = value.replace(/\/$/, '').split('/').filter(Boolean);
  return !looksLikeFile(value) && segments.length <= 2 && ['packages', 'apps', 'services', 'workspace', 'modules'].includes(segments[0] ?? '');
}

function looksLikeFile(value: string): boolean {
  return /\.[A-Za-z0-9]+$/.test(value) && !value.endsWith('/');
}

function fileRank(value: string): number {
  const lower = value.toLowerCase();
  if (/\b(schema|contract|interface|route|command|handler)\b/.test(lower)) return 100;
  if (/(^|\/)(test|tests|__tests__)\//.test(lower) || /\.(test|spec)\./.test(lower)) return 90;
  if (/(^|\/)(docs?|guides?)\//.test(lower) || /readme\.md$/.test(lower)) return 80;
  if (/\b(config|settings)\b|\.(json|ya?ml|toml)$/.test(lower)) return 75;
  return 60;
}

function directoryRank(value: string): number {
  if (value.split('/').length >= 4) return 50;
  return 30;
}
