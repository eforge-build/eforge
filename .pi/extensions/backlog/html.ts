import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	CLOSED_STATUSES,
	PRIORITY_VALUES,
	STATUS_VALUES,
	backlogRoot,
	blockedBy,
	filterItems,
	filterReadyItems,
	isStale,
	itemById,
	listItems,
	sectionContent,
	shortId,
	summaryLabels,
	type BacklogDisplayItem,
	type BacklogItem,
	type BacklogPriority,
	type BacklogStatus,
} from "./store";
import { epicById, listEpics, type BacklogEpic } from "./epic-store";
import { buildRecommendationIndex, readRecommendations, renderRecommendationsHtml, type BacklogRecommendations } from "./recommendations";
import { clientScript, css } from "./html-assets";

// --- eforge:region html-view-model ---
export type BacklogHtmlOptions = { query?: string; includeClosed?: boolean };
export type BacklogHtmlDependencyRef = { id: string; title: string; status?: BacklogStatus; visible: boolean; missing: boolean; blocking: boolean };
export type BacklogHtmlEpicRef = { id: string; title: string; status?: BacklogStatus; missing: boolean };
export type BacklogHtmlEpicGroup = { id: string; title: string; status?: BacklogStatus; missing: boolean; count: number };
export type BacklogHtmlItem = {
	item: BacklogItem;
	labels: string[];
	ready: boolean;
	blocked: boolean;
	reviewDue: boolean;
	closed: boolean;
	epic?: BacklogHtmlEpicRef;
	dependencies: BacklogHtmlDependencyRef[];
	dependents: BacklogHtmlDependencyRef[];
	claim: string;
	evidence: string;
	recheck: string;
	promotionPaths: string;
	recRank?: number;
	recLanes: string[];
	recUnblock?: string;
	recColumn: "next" | "blocked" | "other" | "closed";
};
export type BacklogHtmlModel = {
	generatedAt: string;
	query?: string;
	includeClosed: boolean;
	items: BacklogHtmlItem[];
	epics: BacklogHtmlEpicGroup[];
	unassignedCount: number;
	cycles: string[][];
	recommendations?: BacklogRecommendations;
	stats: {
		total: number;
		open: number;
		ready: number;
		blocked: number;
		reviewDue: number;
		closed: number;
		statusCounts: Record<BacklogStatus, number>;
		priorityCounts: Record<BacklogPriority, number>;
	};
};
export type BacklogHtmlWriteResult = BacklogHtmlModel["stats"] & { path: string };

export async function writeBacklogHtml(cwd: string, options: BacklogHtmlOptions = {}): Promise<BacklogHtmlWriteResult> {
	const allItems = await listItems(cwd);
	const allEpics = await listEpics(cwd);
	const visibleItems = filterItems(allItems, { query: options.query, includeClosed: options.includeClosed });
	const recommendations = await readRecommendations(cwd);
	const model = createBacklogHtmlModel(visibleItems, allItems, options, allEpics, recommendations);
	const dir = join(backlogRoot(cwd), "view");
	const path = join(dir, "index.html");
	await mkdir(dir, { recursive: true });
	await writeFile(path, renderBacklogHtml(model), "utf8");
	return { path, ...model.stats };
}

export function createBacklogHtmlModel(visibleItems: BacklogItem[], allItems: BacklogItem[] = visibleItems, options: BacklogHtmlOptions = {}, allEpics: BacklogEpic[], recommendations?: BacklogRecommendations): BacklogHtmlModel {
	const contextById = itemById(allItems);
	const epicsById = epicById(allEpics);
	const visibleIds = new Set(visibleItems.map((item) => item.id));
	const readyIds = new Set(filterReadyItems(visibleItems, allItems).map((item) => item.id));
	const recIndex = buildRecommendationIndex(recommendations);
	const items = visibleItems.map((item) => {
		const blockers = blockedBy(item, contextById);
		const blocked = blockers.length > 0;
		const closed = CLOSED_STATUSES.has(item.status);
		const recRank = recIndex.rankById.get(item.id);
		return {
			item,
			epic: item.epic ? epicRef(item.epic, epicsById) : undefined,
			labels: summaryLabels(item, contextById),
			ready: readyIds.has(item.id),
			blocked,
			reviewDue: isStale(item),
			closed,
			dependencies: item.depends_on.map((id) => dependencyRef(id, contextById, visibleIds, blockers.includes(id))),
			dependents: allItems.filter((candidate) => candidate.depends_on.includes(item.id)).map((candidate) => dependencyRef(candidate.id, contextById, visibleIds, false)),
			claim: sectionContent(item.body, "Claim"),
			evidence: sectionContent(item.body, "Evidence"),
			recheck: sectionContent(item.body, "Recheck"),
			promotionPaths: sectionContent(item.body, "Promotion Paths"),
			recRank,
			recLanes: recIndex.lanesById.get(item.id) ?? [],
			recUnblock: recIndex.unblockById.get(item.id),
			recColumn: recColumnFor(closed, recRank !== undefined, blocked),
		};
	});
	return {
		generatedAt: new Date().toISOString(),
		query: options.query?.trim() || undefined,
		includeClosed: Boolean(options.includeClosed),
		items,
		epics: epicGroups(items),
		unassignedCount: items.filter((entry) => !entry.epic).length,
		cycles: findDependencyCycles(allItems).filter((cycle) => cycle.some((id) => visibleIds.has(id))),
		recommendations,
		stats: createStats(visibleItems, allItems),
	};
}

function recColumnFor(closed: boolean, ranked: boolean, blocked: boolean): BacklogHtmlItem["recColumn"] {
	if (closed) return "closed";
	if (ranked) return "next";
	if (blocked) return "blocked";
	return "other";
}

function epicGroups(items: BacklogHtmlItem[]): BacklogHtmlEpicGroup[] {
	const groups = new Map<string, BacklogHtmlEpicGroup>();
	for (const entry of items) {
		if (!entry.epic) continue;
		const existing = groups.get(entry.epic.id);
		if (existing) existing.count += 1;
		else groups.set(entry.epic.id, { id: entry.epic.id, title: entry.epic.title, status: entry.epic.status, missing: entry.epic.missing, count: 1 });
	}
	return [...groups.values()].sort((a, b) => Number(a.missing) - Number(b.missing) || a.title.localeCompare(b.title));
}

function dependencyRef(id: string, contextById: Map<string, BacklogDisplayItem>, visibleIds: Set<string>, blocking: boolean): BacklogHtmlDependencyRef {
	const item = contextById.get(id);
	return { id, title: item?.title ?? `Missing dependency: ${id}`, status: item?.status, visible: visibleIds.has(id), missing: !item, blocking };
}

function epicRef(id: string, epicsById: Map<string, BacklogEpic>): BacklogHtmlEpicRef {
	const epic = epicsById.get(id);
	return { id, title: epic?.title ?? `Missing epic: ${id}`, status: epic?.status, missing: !epic };
}

function createStats(visibleItems: BacklogItem[], allItems: BacklogItem[]): BacklogHtmlModel["stats"] {
	const statusCounts = Object.fromEntries(STATUS_VALUES.map((status) => [status, 0])) as Record<BacklogStatus, number>;
	const priorityCounts = Object.fromEntries(PRIORITY_VALUES.map((priority) => [priority, 0])) as Record<BacklogPriority, number>;
	const contextById = itemById(allItems);
	for (const item of visibleItems) {
		statusCounts[item.status] += 1;
		priorityCounts[item.priority] += 1;
	}
	const openItems = visibleItems.filter((item) => !CLOSED_STATUSES.has(item.status));
	return {
		total: visibleItems.length,
		open: openItems.length,
		ready: filterReadyItems(openItems, allItems).length,
		blocked: openItems.filter((item) => blockedBy(item, contextById).length > 0).length,
		reviewDue: visibleItems.filter(isStale).length,
		closed: visibleItems.length - openItems.length,
		statusCounts,
		priorityCounts,
	};
}

export function findDependencyCycles(items: BacklogItem[]): string[][] {
	const byId = new Map(items.map((item) => [item.id, item]));
	const visited = new Set<string>();
	const cycles = new Map<string, string[]>();
	const visit = (id: string, stack: string[]): void => {
		const existingIndex = stack.indexOf(id);
		if (existingIndex >= 0) {
			const cycle = [...stack.slice(existingIndex), id];
			cycles.set(canonicalCycleKey(cycle), cycle);
			return;
		}
		if (visited.has(id)) return;
		const item = byId.get(id);
		if (!item) return;
		visited.add(id);
		for (const dependencyId of item.depends_on) visit(dependencyId, [...stack, id]);
	};
	for (const item of items) visit(item.id, []);
	return Array.from(cycles.values());
}

function canonicalCycleKey(cycle: string[]): string {
	const nodes = cycle.slice(0, -1);
	const rotations = nodes.map((_node, index) => [...nodes.slice(index), ...nodes.slice(0, index)].join("→"));
	return rotations.sort()[0] ?? cycle.join("→");
}
// --- eforge:endregion html-view-model ---

// --- eforge:region html-renderer ---
const PRIORITY_RANK: Record<BacklogPriority, number> = { high: 3, medium: 2, low: 1 };
const STATUS_LABELS: Record<BacklogStatus, string> = { candidate: "Candidate", planned: "Planned", active: "Active", shipped: "Shipped", stale: "Stale", superseded: "Superseded" };
const OPEN_STATUS_ORDER: BacklogStatus[] = ["candidate", "planned", "active"];
const CLOSED_STATUS_ORDER: BacklogStatus[] = ["shipped", "stale", "superseded"];

export function renderBacklogHtml(model: BacklogHtmlModel): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Backlog board</title>
<style>${css()}</style>
</head>
<body>
<header class="topbar">
	<div class="topbar-title"><span class="dot-brand"></span><h1>Backlog</h1><span class="gen">${escapeHtml(formatDateTime(model.generatedAt))}${model.query ? ` · query <code>${escapeHtml(model.query)}</code>` : ""}</span></div>
	${renderStats(model)}
</header>
<main>
	${renderToolbar(model)}
	${renderRecommendationsHtml(model.recommendations, recommendationTitles(model))}
	${renderCycles(model)}
	${renderEpicPanel(model)}
	${renderBoard(model)}
	${renderEpicBoard(model)}
	${renderRecommendedBoard(model)}
</main>
<script>${clientScript()}</script>
</body>
</html>`;
}

function recommendationTitles(model: BacklogHtmlModel): Map<string, string> {
	return new Map(model.items.map((entry) => [entry.item.id, entry.item.title]));
}

function renderStats(model: BacklogHtmlModel): string {
	const stats: [string, number, string][] = [
		["Open", model.stats.open, "open"],
		["Ready", model.stats.ready, "ready"],
		["Blocked", model.stats.blocked, "bad"],
		["Review due", model.stats.reviewDue, "warn"],
		["Closed", model.stats.closed, "muted"],
	];
	return `<div class="stats">${stats.map(([label, value, tone]) => `<span class="stat stat-${tone}"><strong>${value}</strong>${escapeHtml(label)}</span>`).join("")}</div>`;
}

function renderToolbar(model: BacklogHtmlModel): string {
	const statusFilters = `<div class="filters">${filterButton("all", "All", true)}${filterButton("ready", "Ready")}${filterButton("blocked", "Blocked")}${filterButton("review", "Review due")}${filterButton("closed", "Closed")}</div>`;
	return `<section class="toolbar" aria-label="Backlog filters"><input id="search" type="search" placeholder="Search title, id, tag, dependency…" autocomplete="off"><div class="toolbar-actions">${statusFilters}${renderGroupControls(model)}</div></section>`;
}

function filterButton(filter: string, label: string, active = false): string {
	return `<button type="button" class="filter${active ? " active" : ""}" data-filter="${filter}">${label}</button>`;
}

function renderGroupControls(model: BacklogHtmlModel): string {
	const hasEpics = model.epics.length > 0;
	const hasRecommendations = Boolean(model.recommendations);
	if (!hasEpics && !hasRecommendations) return "";
	const buttons = [`<button type="button" class="filter active" data-group="status">Status</button>`];
	if (hasEpics) buttons.push(`<button type="button" class="filter" data-group="epic">Epic</button>`);
	if (hasRecommendations) buttons.push(`<button type="button" class="filter" data-group="recommended">Recommended</button>`);
	const groupToggle = `<div class="filters" role="group" aria-label="Group cards by"><span class="group-label">Group</span>${buttons.join("")}</div>`;
	return groupToggle + renderEpicSelect(model);
}

function renderEpicSelect(model: BacklogHtmlModel): string {
	if (model.epics.length === 0) return "";
	const options = [`<option value="">All epics</option>`, ...model.epics.map((epic) => `<option value="${escapeAttr(epic.id)}">${escapeHtml(`${epic.title} (${epic.count})`)}</option>`)].join("");
	return `<select id="epic-filter" class="epic-select" aria-label="Filter by epic">${options}</select>`;
}

function renderEpicPanel(model: BacklogHtmlModel): string {
	if (model.epics.length === 0) return "";
	const chips = model.epics.map((epic) => {
		const classes = ["epic-summary", epic.missing && "missing"].filter(Boolean).join(" ");
		const title = escapeAttr(epic.missing ? `Missing: ${epic.id}` : `${epic.id}${epic.status ? ` (${epic.status})` : ""}`);
		return `<button type="button" class="${classes}" data-epic-filter="${escapeAttr(epic.id)}" title="${title}"><span class="epic-summary-name">${escapeHtml(epic.title)}</span><span class="epic-summary-count">${epic.count}</span></button>`;
	}).join("");
	const unassigned = model.unassignedCount > 0 ? `<span class="epic-summary epic-summary-none" title="Items with no epic"><span class="epic-summary-name">No epic</span><span class="epic-summary-count">${model.unassignedCount}</span></span>` : "";
	return `<section class="epic-panel" aria-label="Epics">${chips}${unassigned}</section>`;
}

function renderCycles(model: BacklogHtmlModel): string {
	if (model.cycles.length === 0) return "";
	return `<section class="cycles"><span class="cycles-tag">Dependency cycles</span><ul>${model.cycles.map((cycle) => `<li>${cycle.map((id) => renderIdLink(id)).join(" → ")}</li>`).join("")}</ul></section>`;
}

function renderBoard(model: BacklogHtmlModel): string {
	if (model.items.length === 0) return renderEmptyState();
	const present = new Set(model.items.map((entry) => entry.item.status));
	const columns = [...OPEN_STATUS_ORDER, ...CLOSED_STATUS_ORDER.filter((status) => present.has(status))];
	return `<section class="board" data-board="status">${columns.map((status) => renderColumn(status, model.items.filter((entry) => entry.item.status === status))).join("")}</section>`;
}

function renderEpicBoard(model: BacklogHtmlModel): string {
	if (model.epics.length === 0) return "";
	const columns = model.epics.map((epic) => renderEpicColumn(epic.id, epic.title, epic.count, { missing: epic.missing }));
	if (model.unassignedCount > 0) columns.push(renderEpicColumn("", "No epic", model.unassignedCount, { none: true }));
	return `<section class="board epic-board is-hidden" data-board="epic">${columns.join("")}</section>`;
}

const REC_COLUMNS: { id: BacklogHtmlItem["recColumn"]; title: string }[] = [
	{ id: "next", title: "Next up" },
	{ id: "blocked", title: "Blocked" },
	{ id: "other", title: "Other open" },
	{ id: "closed", title: "Closed" },
];

function renderRecommendedBoard(model: BacklogHtmlModel): string {
	if (!model.recommendations) return "";
	const counts = new Map<string, number>();
	for (const entry of model.items) counts.set(entry.recColumn, (counts.get(entry.recColumn) ?? 0) + 1);
	const columns = REC_COLUMNS.filter((column) => column.id !== "closed" || (counts.get("closed") ?? 0) > 0);
	const cells = columns.map((column) => `<div class="col rec-col-${column.id}" data-rec-col="${column.id}"><div class="col-head"><span class="col-dot"></span><span class="col-name">${escapeHtml(column.title)}</span><span class="col-count" data-count>${counts.get(column.id) ?? 0}</span></div><div class="col-body"></div></div>`).join("");
	return `<section class="board recommended-board is-hidden" data-board="recommended">${cells}</section>`;
}

function renderEpicColumn(id: string, title: string, count: number, kind: { missing?: boolean; none?: boolean }): string {
	const classes = ["col", "epic-col", kind.missing && "missing", kind.none && "none"].filter(Boolean).join(" ");
	return `<div class="${classes}" data-epic-col="${escapeAttr(id)}"><div class="col-head"><span class="col-dot"></span><span class="col-name">${escapeHtml(title)}</span><span class="col-count" data-count>${count}</span></div><div class="col-body"></div></div>`;
}

function renderColumn(status: BacklogStatus, entries: BacklogHtmlItem[]): string {
	const sorted = [...entries].sort(compareEntries);
	const body = sorted.length ? sorted.map(renderItemCard).join("") : `<p class="col-empty">Nothing here</p>`;
	return `<div class="col status-${status}" data-status="${status}"><div class="col-head"><span class="col-dot"></span><span class="col-name">${escapeHtml(STATUS_LABELS[status])}</span><span class="col-count" data-count>${sorted.length}</span></div><div class="col-body">${body}</div></div>`;
}

function compareEntries(a: BacklogHtmlItem, b: BacklogHtmlItem): number {
	if (a.blocked !== b.blocked) return a.blocked ? 1 : -1;
	const priority = PRIORITY_RANK[b.item.priority] - PRIORITY_RANK[a.item.priority];
	if (priority !== 0) return priority;
	return a.item.title.localeCompare(b.item.title);
}

function renderItemCard(entry: BacklogHtmlItem): string {
	const { item } = entry;
	const badges = [
		entry.recRank !== undefined && `<span class="badge badge-rec">Next ${entry.recRank}</span>`,
		entry.blocked && `<span class="badge badge-bad">Blocked</span>`,
		entry.reviewDue && `<span class="badge badge-warn">Review due</span>`,
	].filter(Boolean).join("");
	return `<article class="card priority-${item.priority}" id="item-${escapeAttr(item.id)}" data-backlog-card ${dataAttributes(entry)}><div class="card-head"><span class="prio"><span class="prio-dot"></span>${escapeHtml(item.priority)}</span><span class="badges">${badges}</span></div><h3 class="card-title">${escapeHtml(item.title)}</h3><code class="card-id" title="${escapeAttr(item.id)}">${escapeHtml(shortId(item.id))}</code>${renderEpic(entry)}${renderLanes(entry)}${renderTags(item.tags)}${renderDeps(entry)}${renderUnblock(entry)}${renderSections(entry)}</article>`;
}

function renderLanes(entry: BacklogHtmlItem): string {
	return entry.recLanes.length ? `<div class="tags">${entry.recLanes.map((lane) => `<span class="tag lane-tag" title="Recommended parallel lane">${escapeHtml(lane)}</span>`).join("")}</div>` : "";
}

function renderUnblock(entry: BacklogHtmlItem): string {
	return entry.recUnblock ? `<div class="unblock-note"><span class="unblock-label">Unblock</span>${escapeHtml(entry.recUnblock)}</div>` : "";
}

function dataAttributes(entry: BacklogHtmlItem): string {
	const item = entry.item;
	const searchText = [item.id, item.title, item.status, item.priority, item.tags.join(" "), item.depends_on.join(" "), item.epic ?? "", entry.epic?.title ?? "", entry.claim, entry.evidence, entry.recheck].join("\n");
	return [
		`data-search="${escapeAttr(searchText.toLowerCase())}"`,
		`data-ready="${entry.ready}"`,
		`data-blocked="${entry.blocked}"`,
		`data-review="${entry.reviewDue}"`,
		`data-closed="${entry.closed}"`,
		`data-epic="${escapeAttr(entry.epic?.id ?? "")}"`,
		`data-rec-col="${entry.recColumn}"`,
		entry.recRank !== undefined ? `data-rec-rank="${entry.recRank}"` : "",
	].filter(Boolean).join(" ");
}

function renderTags(tags: string[]): string {
	return tags.length ? `<div class="tags">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>` : "";
}

function renderEpic(entry: BacklogHtmlItem): string {
	if (!entry.epic) return "";
	const classes = ["tag", "epic-tag", entry.epic.missing && "missing"].filter(Boolean).join(" ");
	const title = escapeAttr(entry.epic.missing ? `Missing: ${entry.epic.id}` : `${entry.epic.id}${entry.epic.status ? ` (${entry.epic.status})` : ""}`);
	return `<div class="tags"><span class="${classes}" title="${title}">Epic: ${escapeHtml(entry.epic.title)}</span></div>`;
}

function renderDeps(entry: BacklogHtmlItem): string {
	const rows = [
		entry.dependencies.length ? `<div class="dep-row"><span class="dep-label">Depends on</span><span class="dep-chips">${entry.dependencies.map(renderRef).join("")}</span></div>` : "",
		entry.dependents.length ? `<div class="dep-row"><span class="dep-label">Enables</span><span class="dep-chips">${entry.dependents.map(renderRef).join("")}</span></div>` : "",
	].filter(Boolean).join("");
	return rows ? `<div class="deps">${rows}</div>` : "";
}

function renderRef(ref: BacklogHtmlDependencyRef): string {
	const classes = ["chip", ref.blocking && "blocking", ref.missing && "missing", !ref.visible && !ref.missing && "hidden-ref"].filter(Boolean).join(" ");
	const text = escapeHtml(shortId(ref.id));
	const title = escapeAttr(ref.missing ? `Missing: ${ref.id}` : `${ref.title}${ref.status ? ` (${ref.status})` : ""}`);
	return ref.visible ? `<a class="${classes}" href="#item-${escapeAttr(ref.id)}" title="${title}">${text}</a>` : `<span class="${classes}" title="${title}">${text}</span>`;
}

function renderSections(entry: BacklogHtmlItem): string {
	const sections = `${renderSection("Claim", entry.claim)}${renderSection("Evidence", entry.evidence)}${renderSection("Recheck", entry.recheck)}${renderSection("Promotion paths", entry.promotionPaths)}`;
	return sections ? `<details class="details"><summary>Notes</summary>${sections}</details>` : "";
}

function renderSection(title: string, content: string): string {
	return content.trim() ? `<section class="detail-section"><h4>${escapeHtml(title)}</h4><pre>${escapeHtml(content.trim())}</pre></section>` : "";
}

function renderIdLink(id: string): string {
	return `<a href="#item-${escapeAttr(id)}"><code>${escapeHtml(shortId(id))}</code></a>`;
}

function renderEmptyState(): string {
	return `<p class="empty">No backlog items match this view.</p>`;
}
// --- eforge:endregion html-renderer ---

// --- eforge:region html-assets ---
function formatDateTime(value: string): string {
	return new Date(value).toLocaleString();
}

function escapeHtml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function escapeAttr(value: string): string {
	return escapeHtml(value).replace(/[\r\n\t]+/g, " ");
}
// --- eforge:endregion html-assets ---
