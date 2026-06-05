import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// --- eforge:region backlog-store ---
export type BacklogStatus = "candidate" | "planned" | "active" | "shipped" | "stale" | "superseded";
export type BacklogPriority = "low" | "medium" | "high";
export type BacklogSource = "conversation" | "review" | "build" | "roadmap" | "manual";

export type BacklogItem = {
	id: string;
	title: string;
	status: BacklogStatus;
	priority: BacklogPriority;
	source: BacklogSource;
	created: string;
	updated: string;
	last_checked?: string;
	stale_after?: string;
	tags: string[];
	depends_on: string[];
	epic?: string;
	body: string;
};

export type BacklogSummary = Omit<BacklogItem, "body"> & { stale: boolean };

export const STATUS_VALUES = ["candidate", "planned", "active", "shipped", "stale", "superseded"] as const;
export const PRIORITY_VALUES = ["low", "medium", "high"] as const;
export const SOURCE_VALUES = ["conversation", "review", "build", "roadmap", "manual"] as const;
export const BACKLOG_ACTIONS = ["list", "ready", "blocked", "graph", "html", "add", "show", "status", "stale", "depends", "epic", "review", "analyze", "analyze-all", "promote", "curate"] as const;
export const CLOSED_STATUSES = new Set<BacklogStatus>(["shipped", "stale", "superseded"]);
export const SATISFIED_DEPENDENCY_STATUSES = new Set<BacklogStatus>(["shipped", "superseded"]);
export const DEFAULT_STALE_DAYS = 14;

export function backlogRoot(cwd: string): string {
	return join(cwd, ".backlog");
}

export function backlogDir(cwd: string): string {
	return join(backlogRoot(cwd), "items");
}

export function today(): string {
	return new Date().toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
	const parsed = new Date(`${date}T00:00:00.000Z`);
	parsed.setUTCDate(parsed.getUTCDate() + days);
	return parsed.toISOString().slice(0, 10);
}

export function slugify(input: string): string {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60) || "item";
}

export async function nextId(cwd: string, title: string): Promise<string> {
	const base = `backlog-${today()}-${slugify(title)}`;
	let candidate = base;
	let suffix = 2;
	while (await exists(itemPath(cwd, candidate))) {
		candidate = `${base}-${suffix}`;
		suffix += 1;
	}
	return candidate;
}

export async function exists(path: string): Promise<boolean> {
	try {
		await readFile(path, "utf8");
		return true;
	} catch {
		return false;
	}
}

export function itemPath(cwd: string, id: string): string {
	return join(backlogDir(cwd), `${id}.md`);
}

export function parseInlineList(value: string | undefined): string[] {
	if (!value) return [];
	const trimmed = value.trim();
	if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
	const inner = trimmed.slice(1, -1).trim();
	if (!inner) return [];
	return inner.split(",").map((part) => part.trim().replace(/^['\"]|['\"]$/g, "")).filter(Boolean);
}

export function uniqueValues(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function parseFrontmatter(content: string): { attrs: Record<string, string>; body: string } {
	if (!content.startsWith("---\n")) return { attrs: {}, body: content };
	const end = content.indexOf("\n---\n", 4);
	if (end === -1) return { attrs: {}, body: content };
	const raw = content.slice(4, end).split("\n");
	const attrs: Record<string, string> = {};
	for (const line of raw) {
		const index = line.indexOf(":");
		if (index === -1) continue;
		const key = line.slice(0, index).trim();
		const value = line.slice(index + 1).trim();
		attrs[key] = value.replace(/^['\"]|['\"]$/g, "");
	}
	return { attrs, body: content.slice(end + 5) };
}

export function titleFromBody(body: string, fallback: string): string {
	const match = body.match(/^#\s+(.+)$/m);
	return match?.[1]?.trim() || fallback;
}

export function isStatus(value: string | undefined): value is BacklogStatus {
	return STATUS_VALUES.includes(value as BacklogStatus);
}

export function isPriority(value: string | undefined): value is BacklogPriority {
	return PRIORITY_VALUES.includes(value as BacklogPriority);
}

export function isSource(value: string | undefined): value is BacklogSource {
	return SOURCE_VALUES.includes(value as BacklogSource);
}

export function parseItem(content: string, fallbackId: string): BacklogItem {
	const { attrs, body } = parseFrontmatter(content);
	return {
		id: attrs.id || fallbackId,
		title: titleFromBody(body, attrs.title || fallbackId),
		status: isStatus(attrs.status) ? attrs.status : "candidate",
		priority: isPriority(attrs.priority) ? attrs.priority : "medium",
		source: isSource(attrs.source) ? attrs.source : "manual",
		created: attrs.created || today(),
		updated: attrs.updated || attrs.created || today(),
		last_checked: attrs.last_checked || undefined,
		stale_after: attrs.stale_after || undefined,
		tags: parseInlineList(attrs.tags),
		depends_on: uniqueValues(parseInlineList(attrs.depends_on || attrs.dependsOn)),
		epic: attrs.epic || undefined,
		body: body.trimEnd() + "\n",
	};
}

export function serializeList(values: string[]): string {
	return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

export function serializeItem(item: BacklogItem): string {
	const attrs = [
		"---",
		`id: ${item.id}`,
		`status: ${item.status}`,
		`priority: ${item.priority}`,
		`source: ${item.source}`,
		`created: ${item.created}`,
		`updated: ${item.updated}`,
		...(item.last_checked ? [`last_checked: ${item.last_checked}`] : []),
		...(item.stale_after ? [`stale_after: ${item.stale_after}`] : []),
		`tags: ${serializeList(item.tags)}`,
		...(item.depends_on.length ? [`depends_on: ${serializeList(item.depends_on)}`] : []),
		...(item.epic ? [`epic: ${JSON.stringify(item.epic)}`] : []),
		"---",
		"",
	];
	return attrs.join("\n") + item.body.trimEnd() + "\n";
}

export async function ensureBacklogDir(cwd: string): Promise<void> {
	await mkdir(backlogDir(cwd), { recursive: true });
}

export async function readItem(cwd: string, id: string): Promise<BacklogItem> {
	return parseItem(await readFile(itemPath(cwd, id), "utf8"), id);
}

export async function writeItem(cwd: string, item: BacklogItem): Promise<void> {
	await ensureBacklogDir(cwd);
	await writeFile(itemPath(cwd, item.id), serializeItem({ ...item, updated: today() }), "utf8");
}

export async function listItems(cwd: string): Promise<BacklogItem[]> {
	await ensureBacklogDir(cwd);
	const names = await readdir(backlogDir(cwd));
	const items = await Promise.all(
		names
			.filter((name) => name.endsWith(".md"))
			.map(async (name) => parseItem(await readFile(join(backlogDir(cwd), name), "utf8"), name.replace(/\.md$/, ""))),
	);
	return items.sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id));
}

export function isStale(item: BacklogItem): boolean {
	if (["shipped", "stale", "superseded"].includes(item.status)) return false;
	return item.stale_after !== undefined && item.stale_after < today();
}

export function summarize(item: BacklogItem): BacklogSummary {
	const { body: _body, ...rest } = item;
	return { ...rest, stale: isStale(item) };
}

export function defaultBody(title: string, claim?: string, evidence?: string): string {
	return `# ${title}\n\n## Claim\n\n${claim?.trim() || "TBD"}\n\n## Evidence\n\n${evidence?.trim() || "- Source: manual capture"}\n\n## Recheck\n\n- Search or inspect the relevant files before promoting this item.\n\n## Promotion Paths\n\n- Create an eforge session plan when this becomes buildable work.\n- Link or update a local backlog epic if this becomes strategic work.\n`;
}

export async function createItem(cwd: string, input: {
	title: string;
	claim?: string;
	evidence?: string;
	tags?: string[];
	dependsOn?: string[];
	epic?: string;
	priority?: BacklogPriority;
	source?: BacklogSource;
	staleAfter?: string;
}): Promise<BacklogItem> {
	const id = await nextId(cwd, input.title);
	const date = today();
	const item: BacklogItem = {
		id,
		title: input.title.trim(),
		status: "candidate",
		priority: input.priority ?? "medium",
		source: input.source ?? "manual",
		created: date,
		updated: date,
		stale_after: input.staleAfter ?? addDays(date, DEFAULT_STALE_DAYS),
		tags: input.tags ?? [],
		depends_on: uniqueValues(input.dependsOn ?? []),
		epic: input.epic || undefined,
		body: defaultBody(input.title.trim(), input.claim, input.evidence),
	};
	await writeItem(cwd, item);
	return item;
}

export function upsertSection(body: string, heading: string, content: string): string {
	const range = findSectionRange(body, heading);
	const replacement = `## ${heading}\n\n${content.trim()}\n\n`;
	if (!range) return body.trimEnd() + `\n\n${replacement}`;
	return body.slice(0, range.start) + replacement + body.slice(range.end).replace(/^\n+/, "");
}

export function appendToSection(body: string, heading: string, content: string): string {
	const existing = sectionContent(body, heading);
	const next = `${existing.trim()}\n\n- ${content.trim()}`.trim();
	return upsertSection(body, heading, next);
}

export function sectionContent(body: string, heading: string): string {
	const range = findSectionRange(body, heading);
	return range ? body.slice(range.contentStart, range.end).trim() : "";
}

export function findSectionRange(body: string, heading: string): { start: number; contentStart: number; end: number } | undefined {
	const marker = `## ${heading}\n`;
	let start = body.indexOf(marker);
	while (start > 0 && body[start - 1] !== "\n") start = body.indexOf(marker, start + marker.length);
	if (start === -1) return undefined;
	const contentStart = start + marker.length;
	const next = body.indexOf("\n## ", contentStart);
	const end = next === -1 ? body.length : next + 1;
	return { start, contentStart, end };
}

export function filterItems(items: BacklogItem[], params: { status?: BacklogStatus; query?: string; tag?: string; epic?: string; includeClosed?: boolean }): BacklogItem[] {
	const query = params.query?.toLowerCase().trim();
	return items.filter((item) => {
		if (params.status && item.status !== params.status) return false;
		if (!params.includeClosed && !params.status && CLOSED_STATUSES.has(item.status)) return false;
		if (params.tag && !item.tags.includes(params.tag)) return false;
		if (params.epic && item.epic !== params.epic) return false;
		if (query && !`${item.id}\n${item.title}\n${item.tags.join(" ")}\n${item.depends_on.join(" ")}\n${item.epic ?? ""}\n${item.body}`.toLowerCase().includes(query)) return false;
		return true;
	});
}

export type BacklogDisplayItem = BacklogItem | BacklogSummary;

export function itemById(items: BacklogDisplayItem[]): Map<string, BacklogDisplayItem> {
	return new Map(items.map((item) => [item.id, item]));
}

export function blockedBy(item: BacklogDisplayItem, itemsById: Map<string, BacklogDisplayItem>): string[] {
	return item.depends_on.filter((dependencyId) => {
		const dependency = itemsById.get(dependencyId);
		return !dependency || !SATISFIED_DEPENDENCY_STATUSES.has(dependency.status);
	});
}

export function itemIsStale(item: BacklogDisplayItem): boolean {
	return "stale" in item ? item.stale : isStale(item);
}

export function shortId(id: string): string {
	return id.replace(/^backlog-\d{4}-\d{2}-\d{2}-/, "");
}

export function formatIdList(ids: string[]): string {
	return ids.map(shortId).join(", ");
}

export function summaryLabels(item: BacklogDisplayItem, itemsById: Map<string, BacklogDisplayItem>): string[] {
	const blocked = blockedBy(item, itemsById);
	return [item.status, item.priority, ...(itemIsStale(item) ? ["review-due"] : []), ...(blocked.length ? ["blocked"] : [])];
}

export function isReady(item: BacklogDisplayItem, itemsById: Map<string, BacklogDisplayItem>): boolean {
	return !CLOSED_STATUSES.has(item.status) && blockedBy(item, itemsById).length === 0;
}

export function filterReadyItems<T extends BacklogDisplayItem>(items: T[], contextItems: BacklogDisplayItem[] = items): T[] {
	const itemsById = itemById(contextItems);
	return items.filter((item) => isReady(item, itemsById));
}

export function filterBlockedItems<T extends BacklogDisplayItem>(items: T[], contextItems: BacklogDisplayItem[] = items): T[] {
	const itemsById = itemById(contextItems);
	return items.filter((item) => !CLOSED_STATUSES.has(item.status) && blockedBy(item, itemsById).length > 0);
}

export function matchesBacklogQuery(item: BacklogItem, query: string): boolean {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return true;
	return `${item.id}\n${item.title}\n${item.tags.join(" ")}\n${item.depends_on.join(" ")}\n${item.epic ?? ""}\n${item.body}`.toLowerCase().includes(normalized);
}

export function formatSummaryLines(item: BacklogDisplayItem, itemsById: Map<string, BacklogDisplayItem>): string[] {
	const blocked = blockedBy(item, itemsById);
	const lines = [`• ${item.title} [${summaryLabels(item, itemsById).join("/")}]`, `  id: ${item.id}`];
	if (item.tags.length) lines.push(`  tags: ${item.tags.join(", ")}`);
	if (item.epic) lines.push(`  epic: ${shortId(item.epic)}`);
	if (item.depends_on.length) lines.push(`  depends on: ${formatIdList(item.depends_on)}`);
	if (blocked.length) lines.push(`  blocked by: ${formatIdList(blocked)}`);
	return lines;
}

export function formatSummaryList(items: BacklogDisplayItem[], contextItems: BacklogDisplayItem[] = items): string[] {
	const itemsById = itemById(contextItems);
	return items.flatMap((item, index) => [...formatSummaryLines(item, itemsById), ...(index < items.length - 1 ? [""] : [])]);
}


export function formatDependencyGraph(items: BacklogItem[]): string[] {
	const byId = new Map(items.map((item) => [item.id, item]));
	const dependents = new Set(items.flatMap((item) => item.depends_on));
	const roots = items.filter((item) => !dependents.has(item.id));
	const orderedRoots = roots.length ? roots : items;
	return orderedRoots.flatMap((item, index) => [...formatDependencyNode(item, byId, "", new Set()), ...(index < orderedRoots.length - 1 ? [""] : [])]);
}

function formatDependencyNode(item: BacklogItem, byId: Map<string, BacklogItem>, indent: string, seen: Set<string>): string[] {
	const marker = seen.has(item.id) ? " ↺" : "";
	const lines = [`${indent}• ${item.title} [${summaryLabels(item, itemById(Array.from(byId.values()))).join("/")}] ${shortId(item.id)}${marker}`];
	if (seen.has(item.id)) return lines;
	const nextSeen = new Set([...seen, item.id]);
	for (const dependencyId of item.depends_on) {
		const dependency = byId.get(dependencyId);
		if (dependency) lines.push(...formatDependencyNode(dependency, byId, `${indent}  ↳ `, nextSeen));
		else lines.push(`${indent}  ↳ • missing dependency ${shortId(dependencyId)}`);
	}
	return lines;
}

// --- eforge:endregion backlog-store ---
