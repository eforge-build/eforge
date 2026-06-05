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
};
export type BacklogHtmlModel = {
	generatedAt: string;
	query?: string;
	includeClosed: boolean;
	items: BacklogHtmlItem[];
	epics: BacklogHtmlEpicGroup[];
	unassignedCount: number;
	cycles: string[][];
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
	const model = createBacklogHtmlModel(visibleItems, allItems, options, allEpics);
	const dir = join(backlogRoot(cwd), "view");
	const path = join(dir, "index.html");
	await mkdir(dir, { recursive: true });
	await writeFile(path, renderBacklogHtml(model), "utf8");
	return { path, ...model.stats };
}

export function createBacklogHtmlModel(visibleItems: BacklogItem[], allItems: BacklogItem[] = visibleItems, options: BacklogHtmlOptions = {}, allEpics: BacklogEpic[]): BacklogHtmlModel {
	const contextById = itemById(allItems);
	const epicsById = epicById(allEpics);
	const visibleIds = new Set(visibleItems.map((item) => item.id));
	const readyIds = new Set(filterReadyItems(visibleItems, allItems).map((item) => item.id));
	const items = visibleItems.map((item) => {
		const blockers = blockedBy(item, contextById);
		return {
			item,
			epic: item.epic ? epicRef(item.epic, epicsById) : undefined,
			labels: summaryLabels(item, contextById),
			ready: readyIds.has(item.id),
			blocked: blockers.length > 0,
			reviewDue: isStale(item),
			closed: CLOSED_STATUSES.has(item.status),
			dependencies: item.depends_on.map((id) => dependencyRef(id, contextById, visibleIds, blockers.includes(id))),
			dependents: allItems.filter((candidate) => candidate.depends_on.includes(item.id)).map((candidate) => dependencyRef(candidate.id, contextById, visibleIds, false)),
			claim: sectionContent(item.body, "Claim"),
			evidence: sectionContent(item.body, "Evidence"),
			recheck: sectionContent(item.body, "Recheck"),
			promotionPaths: sectionContent(item.body, "Promotion Paths"),
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
		stats: createStats(visibleItems, allItems),
	};
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
	${renderCycles(model)}
	${renderEpicPanel(model)}
	${renderBoard(model)}
	${renderEpicBoard(model)}
</main>
<script>${clientScript()}</script>
</body>
</html>`;
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
	return `<section class="toolbar" aria-label="Backlog filters"><input id="search" type="search" placeholder="Search title, id, tag, dependency…" autocomplete="off"><div class="toolbar-actions">${statusFilters}${renderEpicControls(model)}</div></section>`;
}

function filterButton(filter: string, label: string, active = false): string {
	return `<button type="button" class="filter${active ? " active" : ""}" data-filter="${filter}">${label}</button>`;
}

function renderEpicControls(model: BacklogHtmlModel): string {
	if (model.epics.length === 0) return "";
	const groupToggle = `<div class="filters" role="group" aria-label="Group cards by"><span class="group-label">Group</span><button type="button" class="filter active" data-group="status">Status</button><button type="button" class="filter" data-group="epic">Epic</button></div>`;
	const options = [`<option value="">All epics</option>`, ...model.epics.map((epic) => `<option value="${escapeAttr(epic.id)}">${escapeHtml(`${epic.title} (${epic.count})`)}</option>`)].join("");
	const select = `<select id="epic-filter" class="epic-select" aria-label="Filter by epic">${options}</select>`;
	return groupToggle + select;
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
		entry.blocked && `<span class="badge badge-bad">Blocked</span>`,
		entry.reviewDue && `<span class="badge badge-warn">Review due</span>`,
	].filter(Boolean).join("");
	return `<article class="card priority-${item.priority}" id="item-${escapeAttr(item.id)}" data-backlog-card ${dataAttributes(entry)}><div class="card-head"><span class="prio"><span class="prio-dot"></span>${escapeHtml(item.priority)}</span><span class="badges">${badges}</span></div><h3 class="card-title">${escapeHtml(item.title)}</h3><code class="card-id" title="${escapeAttr(item.id)}">${escapeHtml(shortId(item.id))}</code>${renderEpic(entry)}${renderTags(item.tags)}${renderDeps(entry)}${renderSections(entry)}</article>`;
}

function dataAttributes(entry: BacklogHtmlItem): string {
	const item = entry.item;
	const searchText = [item.id, item.title, item.status, item.priority, item.tags.join(" "), item.depends_on.join(" "), item.epic ?? "", entry.epic?.title ?? "", entry.claim, entry.evidence, entry.recheck].join("\n");
	return [`data-search="${escapeAttr(searchText.toLowerCase())}"`, `data-ready="${entry.ready}"`, `data-blocked="${entry.blocked}"`, `data-review="${entry.reviewDue}"`, `data-closed="${entry.closed}"`, `data-epic="${escapeAttr(entry.epic?.id ?? "")}"`].join(" ");
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
function css(): string {
	return `
:root{
	color-scheme:dark;
	--bg:#0b0e14;--col:#11151d;--card:#161b24;--card-hi:#1b212c;--line:#252c39;--line-2:#2f3848;
	--text:#e6edf3;--muted:#8b97a8;--faint:#5b6678;--accent:#58a6ff;
	--ok:#3fb950;--warn:#d2a022;--bad:#f0613a;
	--st-candidate:#7d8aa0;--st-planned:#58a6ff;--st-active:#3fb950;--st-shipped:#a371f7;--st-stale:#d2a022;--st-superseded:#6e7681;
	--p-high:#f0613a;--p-medium:#d2a022;--p-low:#5b6678;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82em}
main{max-width:1500px;margin:0 auto;padding:1rem 1.25rem 3rem}

.topbar{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;padding:.9rem 1.25rem;background:rgba(11,14,20,.92);border-bottom:1px solid var(--line);backdrop-filter:blur(8px)}
.topbar-title{display:flex;align-items:center;gap:.6rem}
.topbar-title h1{font-size:1.15rem;font-weight:650;margin:0;letter-spacing:-.01em}
.dot-brand{width:.7rem;height:.7rem;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px rgba(88,166,255,.18)}
.gen{color:var(--faint);font-size:.78rem}
.gen code{background:#0a0d13;border:1px solid var(--line);border-radius:.3rem;padding:.05rem .3rem;color:var(--muted)}

.stats{display:flex;gap:.4rem;flex-wrap:wrap}
.stat{display:inline-flex;align-items:baseline;gap:.35rem;background:var(--col);border:1px solid var(--line);border-radius:.5rem;padding:.3rem .6rem;font-size:.76rem;color:var(--muted)}
.stat strong{font-size:.95rem;color:var(--text);font-weight:650}
.stat-ready strong{color:var(--ok)}
.stat-bad strong{color:var(--bad)}
.stat-warn strong{color:var(--warn)}

.toolbar{display:flex;justify-content:space-between;gap:.75rem;align-items:center;flex-wrap:wrap;margin:1.1rem 0}
.toolbar input{flex:1;min-width:min(28rem,100%);background:var(--col);color:var(--text);border:1px solid var(--line);border-radius:.55rem;padding:.5rem .75rem;font-size:.9rem}
.toolbar input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(88,166,255,.15)}
.filters{display:flex;gap:.35rem;flex-wrap:wrap}
.filter{border:1px solid var(--line);background:var(--col);color:var(--muted);border-radius:.5rem;padding:.4rem .7rem;cursor:pointer;font-size:.82rem;transition:.12s}
.filter:hover{color:var(--text);border-color:var(--line-2)}
.filter.active{color:var(--text);border-color:var(--accent);background:rgba(88,166,255,.12)}
.toolbar-actions{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
.group-label{font-size:.72rem;color:var(--faint);align-self:center;padding:0 .15rem}
.epic-select{background:var(--col);color:var(--text);border:1px solid var(--line);border-radius:.5rem;padding:.4rem .6rem;font-size:.82rem;max-width:16rem}
.epic-select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(88,166,255,.15)}

.epic-panel{display:flex;flex-wrap:wrap;gap:.4rem;margin:0 0 1.1rem}
.epic-summary{display:inline-flex;align-items:center;gap:.4rem;background:rgba(88,166,255,.08);color:var(--accent);border:1px solid var(--line);border-radius:.5rem;padding:.3rem .55rem;font-size:.78rem;cursor:pointer;transition:.12s}
.epic-summary:hover{border-color:var(--accent)}
.epic-summary.active{border-color:var(--accent);background:rgba(88,166,255,.18)}
.epic-summary.missing{color:var(--bad);border-style:dashed;background:rgba(240,97,58,.08)}
.epic-summary-none{color:var(--muted);background:var(--col);cursor:default}
.epic-summary-count{background:var(--card);border:1px solid var(--line);border-radius:999px;min-width:1.4rem;text-align:center;padding:.02rem .35rem;font-size:.72rem;color:var(--muted)}

.cycles{margin:0 0 1.1rem;padding:.7rem .9rem;background:rgba(240,97,58,.07);border:1px solid rgba(240,97,58,.4);border-radius:.6rem}
.cycles-tag{display:inline-block;font-size:.72rem;font-weight:650;text-transform:uppercase;letter-spacing:.08em;color:var(--bad);margin-bottom:.35rem}
.cycles ul{margin:0;padding-left:1.1rem}
.cycles code{background:#0a0d13;border:1px solid var(--line);border-radius:.3rem;padding:.03rem .28rem}

.board{display:flex;gap:.9rem;align-items:flex-start;overflow-x:auto;padding-bottom:.5rem}
.col{flex:1 1 0;min-width:300px;max-width:520px;background:var(--col);border:1px solid var(--line);border-radius:.75rem;border-top:2px solid var(--st);overflow:hidden}
.status-candidate{--st:var(--st-candidate)}.status-planned{--st:var(--st-planned)}.status-active{--st:var(--st-active)}
.status-shipped{--st:var(--st-shipped)}.status-stale{--st:var(--st-stale)}.status-superseded{--st:var(--st-superseded)}
.epic-col{--st:var(--accent)}.epic-col.missing{--st:var(--bad)}.epic-col.none{--st:var(--faint)}
.col-head{position:sticky;top:0;display:flex;align-items:center;gap:.5rem;padding:.65rem .8rem;background:var(--col);border-bottom:1px solid var(--line)}
.col-dot{width:.55rem;height:.55rem;border-radius:50%;background:var(--st)}
.col-name{font-weight:650;font-size:.9rem}
.col-count{margin-left:auto;font-size:.78rem;color:var(--muted);background:var(--card);border:1px solid var(--line);border-radius:999px;min-width:1.5rem;text-align:center;padding:.05rem .4rem}
.col-body{display:flex;flex-direction:column;gap:.6rem;padding:.7rem}
.col-empty{color:var(--faint);font-size:.82rem;text-align:center;padding:1.2rem 0;margin:0}

.card{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--p);border-radius:.6rem;padding:.7rem .8rem;scroll-margin-top:5rem;transition:.12s}
.card:hover{border-color:var(--line-2);background:var(--card-hi)}
.card:target{border-color:var(--accent);box-shadow:0 0 0 3px rgba(88,166,255,.2)}
.priority-high{--p:var(--p-high)}.priority-medium{--p:var(--p-medium)}.priority-low{--p:var(--p-low)}
.card[data-blocked=true]{border-left-color:var(--bad)}
.card[data-closed=true]{opacity:.62}
.card-head{display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem}
.prio{display:inline-flex;align-items:center;gap:.3rem;font-size:.72rem;color:var(--muted);text-transform:capitalize}
.prio-dot{width:.5rem;height:.5rem;border-radius:50%;background:var(--p)}
.badges{margin-left:auto;display:flex;gap:.3rem;flex-wrap:wrap}
.badge{font-size:.68rem;font-weight:600;border-radius:.35rem;padding:.08rem .4rem;border:1px solid transparent}
.badge-bad{color:var(--bad);background:rgba(240,97,58,.12);border-color:rgba(240,97,58,.35)}
.badge-warn{color:var(--warn);background:rgba(210,160,34,.12);border-color:rgba(210,160,34,.35)}
.badge-ok{color:var(--ok);background:rgba(63,185,80,.12);border-color:rgba(63,185,80,.3)}
.card-title{font-size:.95rem;font-weight:600;line-height:1.3;margin:.1rem 0 .25rem}
.card-id{display:block;color:var(--faint);font-size:.72rem;margin-bottom:.3rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tags{display:flex;flex-wrap:wrap;gap:.3rem;margin:.35rem 0 0}
.tag{font-size:.7rem;color:var(--muted);background:var(--col);border:1px solid var(--line);border-radius:.35rem;padding:.06rem .4rem}
.epic-tag{color:var(--accent);background:rgba(88,166,255,.08)}.epic-tag.missing{color:var(--bad);border-color:var(--bad);border-style:dashed}

.deps{margin-top:.5rem;display:flex;flex-direction:column;gap:.35rem}
.dep-row{display:flex;gap:.4rem;align-items:baseline;flex-wrap:wrap}
.dep-label{font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);flex:0 0 auto;padding-top:.05rem}
.dep-chips{display:flex;flex-wrap:wrap;gap:.25rem}
.chip{font-size:.72rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--accent);background:rgba(88,166,255,.08);border:1px solid var(--line);border-radius:.35rem;padding:.04rem .35rem;max-width:14rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chip.blocking{color:var(--bad);background:rgba(240,97,58,.1);border-color:rgba(240,97,58,.35)}
.chip.missing{color:var(--bad);border-color:var(--bad);border-style:dashed}
.chip.hidden-ref{color:var(--muted);background:var(--col)}

.details{margin-top:.55rem}
.details summary{cursor:pointer;color:var(--muted);font-size:.78rem;list-style:none}
.details summary::-webkit-details-marker{display:none}
.details summary::before{content:"▸ ";color:var(--faint)}
.details[open] summary::before{content:"▾ "}
.details summary:hover{color:var(--text)}
.detail-section{margin-top:.5rem}
.detail-section h4{margin:0 0 .25rem;font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
pre{white-space:pre-wrap;word-break:break-word;background:#0a0d13;border:1px solid var(--line);border-radius:.45rem;padding:.55rem;color:#cdd9e5;font-size:.78rem;max-height:16rem;overflow:auto;margin:0}

.empty{color:var(--muted);padding:3rem;text-align:center}
.is-hidden{display:none!important}
@media (max-width:760px){.board{flex-direction:column}.col{max-width:none;width:100%}.toolbar input{min-width:100%}}
`;
}

function clientScript(): string {
	return `(() => {
	const search = document.getElementById('search');
	const buttons = [...document.querySelectorAll('[data-filter]')];
	const groupButtons = [...document.querySelectorAll('[data-group]')];
	const epicSelect = document.getElementById('epic-filter');
	const epicChips = [...document.querySelectorAll('[data-epic-filter]')];
	const nodes = [...document.querySelectorAll('[data-backlog-card]')];
	const columns = [...document.querySelectorAll('.col')];
	const statusBoard = document.querySelector('[data-board=status]');
	const epicBoard = document.querySelector('[data-board=epic]');
	const cardHome = new Map();
	for (const card of nodes) cardHome.set(card, card.parentElement);
	let filter = 'all';
	let group = 'status';
	let epicFilter = '';
	function matchesFilter(node) {
		if (filter === 'ready') return node.dataset.ready === 'true';
		if (filter === 'blocked') return node.dataset.blocked === 'true';
		if (filter === 'review') return node.dataset.review === 'true';
		if (filter === 'closed') return node.dataset.closed === 'true';
		return true;
	}
	function matchesEpic(node) {
		return !epicFilter || (node.dataset.epic || '') === epicFilter;
	}
	function apply() {
		const q = (search && search.value || '').trim().toLowerCase();
		for (const node of nodes) {
			const text = node.dataset.search || '';
			node.classList.toggle('is-hidden', Boolean(q && !text.includes(q)) || !matchesFilter(node) || !matchesEpic(node));
		}
		for (const col of columns) {
			const visible = col.querySelectorAll('[data-backlog-card]:not(.is-hidden)').length;
			const count = col.querySelector('[data-count]');
			if (count) count.textContent = visible;
			col.classList.toggle('is-hidden', visible === 0);
		}
	}
	function layout() {
		if (!epicBoard) return;
		for (const card of nodes) {
			if (group === 'epic') {
				const target = epicBoard.querySelector('[data-epic-col="' + (card.dataset.epic || '') + '"] .col-body');
				(target || cardHome.get(card)).appendChild(card);
			} else {
				cardHome.get(card).appendChild(card);
			}
		}
		statusBoard.classList.toggle('is-hidden', group === 'epic');
		epicBoard.classList.toggle('is-hidden', group !== 'epic');
	}
	function syncEpicChips() {
		for (const chip of epicChips) chip.classList.toggle('active', chip.dataset.epicFilter === epicFilter);
	}
	if (search) search.addEventListener('input', apply);
	for (const button of buttons) button.addEventListener('click', () => {
		filter = button.dataset.filter || 'all';
		for (const other of buttons) other.classList.toggle('active', other === button);
		apply();
	});
	for (const button of groupButtons) button.addEventListener('click', () => {
		group = button.dataset.group || 'status';
		for (const other of groupButtons) other.classList.toggle('active', other === button);
		layout();
		apply();
	});
	if (epicSelect) epicSelect.addEventListener('change', () => {
		epicFilter = epicSelect.value;
		syncEpicChips();
		apply();
	});
	for (const chip of epicChips) chip.addEventListener('click', () => {
		epicFilter = epicFilter === chip.dataset.epicFilter ? '' : (chip.dataset.epicFilter || '');
		if (epicSelect) epicSelect.value = epicFilter;
		syncEpicChips();
		apply();
	});
})();`;
}

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
