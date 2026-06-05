import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { backlogRoot, shortId, today } from "./store";

// --- eforge:region recommendations ---
export const RECOMMENDATIONS_RELATIVE_PATH = ".backlog/recommendations.json";
export const RECOMMENDATIONS_SCHEMA_VERSION = 1;

export type RecommendationItemRef = { id: string; title?: string; rationale?: string };
export type RecommendationSequenceEntry = RecommendationItemRef & { rank: number; dependenciesSatisfied?: string[] };
export type RecommendationParallelGroup = { name: string; itemIds: string[]; rationale?: string; cautions?: string[] };
export type RecommendationBlockedChain = { itemId: string; blockedBy: string[]; nextUnblockAction?: string; rationale?: string };
export type BacklogRecommendations = {
	schemaVersion: 1;
	refreshedAt: string;
	summary?: string;
	activeWork: RecommendationItemRef[];
	readyCandidates: RecommendationItemRef[];
	recommendedNextSequence: RecommendationSequenceEntry[];
	safeParallelizableGroups: RecommendationParallelGroup[];
	blockedChains: RecommendationBlockedChain[];
	rationaleAndAssumptions: string[];
};
export type RecommendationsWriteResult = { path: string; relativePath: string; bytes: number };

export function recommendationsPath(cwd: string): string {
	return join(backlogRoot(cwd), "recommendations.json");
}

export function normalizeRecommendations(input: BacklogRecommendations): BacklogRecommendations {
	return {
		schemaVersion: RECOMMENDATIONS_SCHEMA_VERSION,
		refreshedAt: input.refreshedAt?.trim() || today(),
		...(input.summary?.trim() ? { summary: input.summary.trim() } : {}),
		activeWork: input.activeWork ?? [],
		readyCandidates: input.readyCandidates ?? [],
		recommendedNextSequence: [...(input.recommendedNextSequence ?? [])].sort((a, b) => a.rank - b.rank),
		safeParallelizableGroups: input.safeParallelizableGroups ?? [],
		blockedChains: input.blockedChains ?? [],
		rationaleAndAssumptions: input.rationaleAndAssumptions ?? [],
	};
}

export async function readRecommendations(cwd: string): Promise<BacklogRecommendations | undefined> {
	try {
		return normalizeRecommendations(JSON.parse(await readFile(recommendationsPath(cwd), "utf8")) as BacklogRecommendations);
	} catch {
		return undefined;
	}
}

export async function writeRecommendations(cwd: string, input: BacklogRecommendations): Promise<RecommendationsWriteResult> {
	const path = recommendationsPath(cwd);
	const content = `${JSON.stringify(normalizeRecommendations(input), null, 2)}\n`;
	await mkdir(backlogRoot(cwd), { recursive: true });
	await writeFile(path, content, "utf8");
	return { path, relativePath: RECOMMENDATIONS_RELATIVE_PATH, bytes: Buffer.byteLength(content, "utf8") };
}

export function buildRecommendationInstructions(date = today()): string {
	return `After completing the full open-item analysis pass, refresh ${RECOMMENDATIONS_RELATIVE_PATH} with current backlog recommendations.

Treat ${RECOMMENDATIONS_RELATIVE_PATH} as a volatile local planning artifact, not as a backlog item and not as an eforge handoff. Do not call backlog_add for this artifact and do not enqueue builds.

Before writing it, use the post-update backlog state. Re-list open items and, when useful, ready/blocked subsets and local epics so the recommendations reflect any status, dependency, priority, or epic changes from this pass.

Write the artifact with backlog_write_recommendations. Pass a strict structured object named recommendations using this JSON shape:

{
  "schemaVersion": 1,
  "refreshedAt": "${date}",
  "summary": "Short optional summary",
  "activeWork": [{ "id": "backlog-id", "title": "Title", "rationale": "Why active" }],
  "readyCandidates": [{ "id": "backlog-id", "title": "Title", "rationale": "Why ready" }],
  "recommendedNextSequence": [{ "rank": 1, "id": "backlog-id", "title": "Title", "dependenciesSatisfied": ["dep-id"], "rationale": "Why this order" }],
  "safeParallelizableGroups": [{ "name": "Group name", "itemIds": ["backlog-id"], "rationale": "Why safe", "cautions": ["Risk to watch"] }],
  "blockedChains": [{ "itemId": "backlog-id", "blockedBy": ["dep-id"], "nextUnblockAction": "What to do next", "rationale": "Why blocked" }],
  "rationaleAndAssumptions": ["Evidence, tradeoff, or uncertainty"]
}

Use backlog item IDs in every id/itemIds/blockedBy field. If there are no meaningful recommendations, still write valid JSON with empty arrays and explain why in rationaleAndAssumptions.`;
}

// Maps backlog item id -> display title, supplied by the HTML view model so refs render real titles instead of raw slugs.
export type RecommendationTitleLookup = Map<string, string>;

// Per-item recommendation signals projected onto the board cards (rank, parallel lanes, unblock action).
export type RecommendationIndex = {
	rankById: Map<string, number>;
	lanesById: Map<string, string[]>;
	unblockById: Map<string, string>;
};

export function buildRecommendationIndex(recommendations: BacklogRecommendations | undefined): RecommendationIndex {
	const rankById = new Map<string, number>();
	const lanesById = new Map<string, string[]>();
	const unblockById = new Map<string, string>();
	if (!recommendations) return { rankById, lanesById, unblockById };
	for (const entry of recommendations.recommendedNextSequence) {
		if (!rankById.has(entry.id)) rankById.set(entry.id, entry.rank);
	}
	for (const group of recommendations.safeParallelizableGroups) {
		for (const id of group.itemIds) {
			const lanes = lanesById.get(id) ?? [];
			if (!lanes.includes(group.name)) lanes.push(group.name);
			lanesById.set(id, lanes);
		}
	}
	for (const chain of recommendations.blockedChains) {
		if (chain.nextUnblockAction?.trim()) unblockById.set(chain.itemId, chain.nextUnblockAction.trim());
	}
	return { rankById, lanesById, unblockById };
}

export function renderRecommendationsHtml(recommendations: BacklogRecommendations | undefined, titles?: RecommendationTitleLookup): string {
	if (!recommendations) return "";
	const resolve = makeResolver(titles);
	return `<section class="recommendations-panel" aria-label="Backlog recommendations"><div class="recommendations-head"><span class="cycles-tag">Recommendations</span><span class="gen">${escapeHtml(recommendations.refreshedAt)}</span></div>${renderSummary(recommendations)}${renderSequenceRail(recommendations, resolve)}${renderSupportingDetails(recommendations, resolve)}</section>`;
}

type RefResolver = (id: string, fallbackTitle?: string) => string;

function makeResolver(titles?: RecommendationTitleLookup): RefResolver {
	return (id, fallbackTitle) => titles?.get(id) || fallbackTitle?.trim() || shortId(id);
}

function renderSummary(recommendations: BacklogRecommendations): string {
	return recommendations.summary ? `<p>${escapeHtml(recommendations.summary)}</p>` : "";
}

function renderSequenceRail(recommendations: BacklogRecommendations, resolve: RefResolver): string {
	const steps = recommendations.recommendedNextSequence.map((entry) => {
		const tip = entry.rationale ? ` title="${escapeAttr(entry.rationale)}"` : "";
		return `<a class="rec-step" href="#item-${escapeAttr(entry.id)}"${tip}><span class="rec-rank">${entry.rank}</span><span class="rec-step-title">${escapeHtml(resolve(entry.id, entry.title))}</span></a>`;
	}).join("");
	return steps ? `<div class="rec-section"><span class="rec-label">Recommended next sequence</span><div class="rec-rail">${steps}</div></div>` : "";
}

function renderSupportingDetails(recommendations: BacklogRecommendations, resolve: RefResolver): string {
	const inner = `${renderParallelGroups(recommendations, resolve)}${renderBlockedChains(recommendations, resolve)}${renderRationale(recommendations)}`;
	return inner ? `<details class="rec-details"><summary>Parallel lanes, blocked chains &amp; rationale</summary>${inner}</details>` : "";
}

function renderParallelGroups(recommendations: BacklogRecommendations, resolve: RefResolver): string {
	const rows = recommendations.safeParallelizableGroups.map((group) => {
		const chips = group.itemIds.map((id) => renderRefChip(id, resolve)).join("");
		const note = group.rationale ? `<span class="rec-note">${escapeHtml(group.rationale)}</span>` : "";
		return `<li><div class="rec-group-head"><strong>${escapeHtml(group.name)}</strong></div><div class="rec-chips">${chips}</div>${note}</li>`;
	}).join("");
	return rows ? `<div class="rec-section"><span class="rec-label">Safe parallelizable groups</span><ul class="rec-group-list">${rows}</ul></div>` : "";
}

function renderBlockedChains(recommendations: BacklogRecommendations, resolve: RefResolver): string {
	const rows = recommendations.blockedChains.map((chain) => {
		const blockers = chain.blockedBy.map((id) => renderRefChip(id, resolve, "rec-chip-blocking")).join("");
		const note = chain.nextUnblockAction ? `<span class="rec-note">${escapeHtml(chain.nextUnblockAction)}</span>` : "";
		return `<li><div class="rec-chips">${renderRefChip(chain.itemId, resolve, "rec-chip-blocked")}<span class="rec-blocked-by">blocked by</span>${blockers}</div>${note}</li>`;
	}).join("");
	return rows ? `<div class="rec-section"><span class="rec-label">Blocked chains</span><ul class="rec-group-list">${rows}</ul></div>` : "";
}

function renderRationale(recommendations: BacklogRecommendations): string {
	const rows = recommendations.rationaleAndAssumptions.map((text) => `<li>${escapeHtml(text)}</li>`).join("");
	return rows ? `<div class="rec-section"><span class="rec-label">Rationale and assumptions</span><ul class="rec-rationale">${rows}</ul></div>` : "";
}

function renderRefChip(id: string, resolve: RefResolver, extraClass = ""): string {
	const classes = extraClass ? `rec-chip ${extraClass}` : "rec-chip";
	return `<a class="${classes}" href="#item-${escapeAttr(id)}">${escapeHtml(resolve(id))}</a>`;
}

function escapeHtml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function escapeAttr(value: string): string {
	return escapeHtml(value).replace(/[\r\n\t]+/g, " ");
}
// --- eforge:endregion recommendations ---
