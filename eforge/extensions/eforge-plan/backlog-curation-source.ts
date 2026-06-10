import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { blockerRiskProjection, dependencyProjection, extractMarkdownSections, isOpenStatus } from './backlog-domain.js';
import { listBacklogEpicSnapshots, listBacklogItemSnapshots, type BacklogRecordSnapshot } from './markdown-store.js';
import { canonicalJson, sha256 } from './markdown-store-support.js';
import { buildRecommendationSourceProjection, readPlannerTraceSummaries } from './recommendation-status.js';
import { readRecommendations, summarizeRecommendations } from './recommendations-store.js';
import type { BacklogEpic, BacklogItem } from './backlog-domain.js';

export interface BacklogCurationSourceBuild {
  sourceFingerprint: string;
  sourceText: string;
  source: Record<string, unknown>;
}

const SOURCE_TEXT_TARGET = 180_000;
const SECTION_LIMIT = 4000;
const TRACE_LIMIT = 2000;
const ROADMAP_EXCERPT_LIMIT = 2000;

export async function buildBacklogCurationSource(cwd: string, redraft?: Record<string, unknown>): Promise<BacklogCurationSourceBuild> {
  const [itemSnapshots, epicSnapshots, recommendationProjection, recommendations] = await Promise.all([
    listBacklogItemSnapshots(cwd),
    listBacklogEpicSnapshots(cwd),
    buildRecommendationSourceProjection(cwd),
    readRecommendations(cwd),
  ]);
  const openItemSnapshots = itemSnapshots.filter((snapshot) => isOpenStatus(snapshot.record.status)).sort(bySnapshotId);
  const openEpicSnapshots = epicSnapshots.filter((snapshot) => isOpenStatus(snapshot.record.status)).sort(bySnapshotId);
  const recommendationHash = recommendations === null ? null : sha256(canonicalJson(recommendations));
  const fingerprintProjection = {
    schemaVersion: 1,
    recommendationSourceProjection: recommendationProjection,
    preconditions: {
      items: openItemSnapshots.map(projectPrecondition),
      epics: openEpicSnapshots.map(projectPrecondition),
    },
    recommendationModelHash: recommendationHash,
  };
  const sourceFingerprint = sha256(canonicalJson(fingerprintProjection));
  const truncation = { sectionStrings: 0, roadmapExcerpts: 0, traceDetails: 0 };
  const openItems = openItemSnapshots.map((snapshot) => projectItem(snapshot, sourceFingerprint, truncation));
  const openEpics = openEpicSnapshots.map((snapshot) => projectEpic(snapshot, sourceFingerprint, truncation));
  const itemIds = openItems.map((item) => item.id as string);
  const traceSummaries = boundTraceSummaries(await readPlannerTraceSummaries(cwd, itemIds), truncation);
  const roadmapEvidence = await readRoadmapEvidence(cwd, truncation);
  const source = {
    schemaVersion: 1,
    purpose: 'backlog-curation',
    sourceFingerprint,
    generatedAt: new Date().toISOString(),
    openItems,
    openEpics,
    preconditions: { items: openItemSnapshots.map(projectPrecondition), epics: openEpicSnapshots.map(projectPrecondition) },
    dependencies: dependencyProjection(openItemSnapshots.map((snapshot) => snapshot.record)),
    blockers: blockerRiskProjection(openItemSnapshots.map((snapshot) => snapshot.record)),
    traceSummaries,
    roadmapEvidence,
    recommendations: { exists: recommendations !== null, modelSummary: summarizeRecommendations(recommendations), modelHash: recommendationHash },
    truncation,
    ...(redraft !== undefined && { redraft }),
  };
  return { sourceFingerprint, sourceText: buildSourceText(source), source };
}

export function buildBacklogCurationRedraftContext(parentTaskId: string, result: Record<string, unknown> | undefined, input: { answers?: string[]; steering?: string }): Record<string, unknown> {
  return {
    parentTaskId,
    ...(typeof result?.summary === 'string' && { previousSummary: result.summary }),
    ...(result?.backlogCurationDraft !== undefined && { previousBacklogCurationDraft: result.backlogCurationDraft }),
    ...(Array.isArray(result?.assumptionsOpenQuestions) && { previousAssumptionsOpenQuestions: result.assumptionsOpenQuestions }),
    ...(Array.isArray(result?.clarificationQuestions) && { previousClarificationQuestions: result.clarificationQuestions }),
    ...(input.answers !== undefined && { userAnswers: input.answers }),
    ...(input.steering !== undefined && { steering: input.steering }),
  };
}

function projectItem(snapshot: BacklogRecordSnapshot<BacklogItem>, sourceFingerprint: string, truncation: { sectionStrings: number }) {
  const record = snapshot.record;
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    priority: record.priority,
    tags: record.tags,
    depends_on: record.depends_on,
    epic: record.epic,
    updated: record.updated,
    precondition: { ...projectPrecondition(snapshot), sourceFingerprint },
    sections: boundSections(record.body, truncation),
  };
}

function projectEpic(snapshot: BacklogRecordSnapshot<BacklogEpic>, sourceFingerprint: string, truncation: { sectionStrings: number }) {
  const record = snapshot.record;
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    priority: record.priority,
    tags: record.tags,
    updated: record.updated,
    precondition: { ...projectPrecondition(snapshot), sourceFingerprint },
    sections: boundSections(record.body, truncation),
  };
}

function projectPrecondition(snapshot: BacklogRecordSnapshot<BacklogItem | BacklogEpic>) {
  return {
    kind: snapshot.kind,
    id: snapshot.id,
    origin: snapshot.origin,
    relativePath: snapshot.relativePath,
    updated: snapshot.updated,
    bodySha256: snapshot.bodySha256,
    recordSha256: snapshot.recordSha256,
  };
}

function boundSections(body: string, truncation: { sectionStrings: number }): Record<string, string> {
  return Object.fromEntries([...extractMarkdownSections(body)].map(([heading, value]) => [heading, boundString(value, SECTION_LIMIT, () => { truncation.sectionStrings += 1; })]));
}

function boundTraceSummaries(values: Array<Record<string, unknown>>, truncation: { traceDetails: number }): Array<Record<string, unknown>> {
  return values.map((value) => {
    const text = JSON.stringify(value);
    if (text.length <= TRACE_LIMIT) return value;
    truncation.traceDetails += 1;
    return { itemId: value.itemId, truncated: true, excerpt: text.slice(0, TRACE_LIMIT) };
  });
}

async function readRoadmapEvidence(cwd: string, truncation: { roadmapExcerpts: number }) {
  const path = 'docs/roadmap.md';
  const absolute = join(cwd, path);
  if (!existsSync(absolute)) return { path, exists: false, headings: [], excerpts: [] };
  const markdown = await readFile(absolute, 'utf-8');
  const headings = markdown.split(/\r?\n/).map((line: string) => /^#{1,6}\s+(.+)$/.exec(line)?.[1]?.trim()).filter((line): line is string => Boolean(line));
  const excerpts = markdown.split(/\n\s*\n/).map((block: string) => block.trim()).filter(Boolean).slice(0, 10).map((value: string) => boundString(value, ROADMAP_EXCERPT_LIMIT, () => { truncation.roadmapExcerpts += 1; }));
  return { path, exists: true, headings, excerpts };
}

function boundString(value: string, limit: number, onTruncate: () => void): string {
  if (value.length <= limit) return value;
  onTruncate();
  return `${value.slice(0, Math.max(0, limit - 16))}\n…[truncated]`;
}

function buildSourceText(source: Record<string, unknown>): string {
  let text = JSON.stringify(source, null, 2);
  if (text.length <= SOURCE_TEXT_TARGET) return text;
  const compact = { ...source, openItems: (source.openItems as Array<Record<string, unknown>>).map(stripSections), openEpics: (source.openEpics as Array<Record<string, unknown>>).map(stripSections), traceSummaries: [] };
  text = JSON.stringify(compact, null, 2);
  if (text.length <= SOURCE_TEXT_TARGET) return text;
  const minimal = {
    schemaVersion: source.schemaVersion,
    purpose: source.purpose,
    sourceFingerprint: source.sourceFingerprint,
    generatedAt: source.generatedAt,
    openItems: (source.openItems as Array<Record<string, unknown>>).map(minimalRecord),
    openEpics: (source.openEpics as Array<Record<string, unknown>>).map(minimalRecord),
    preconditions: source.preconditions,
    dependencies: source.dependencies,
    blockers: source.blockers,
    recommendations: stripRecommendationSummary(source.recommendations),
    truncation: { ...(source.truncation as Record<string, unknown>), fallback: 'minimal' },
  };
  return JSON.stringify(minimal, null, 2);
}

function stripSections(record: Record<string, unknown>): Record<string, unknown> {
  const { sections: _sections, ...rest } = record;
  return rest;
}

function minimalRecord(record: Record<string, unknown>): Record<string, unknown> {
  return { id: record.id, status: record.status, precondition: record.precondition };
}

function stripRecommendationSummary(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  const recommendations = value as Record<string, unknown>;
  return { exists: recommendations.exists, modelHash: recommendations.modelHash };
}

function bySnapshotId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}
