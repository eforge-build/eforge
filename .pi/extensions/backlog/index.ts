import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, Text, truncateToWidth, wrapTextWithAnsi, type AutocompleteItem } from "@earendil-works/pi-tui";
import { Type } from "typebox";

type BacklogStatus = "candidate" | "planned" | "active" | "shipped" | "stale" | "superseded";
type BacklogPriority = "low" | "medium" | "high";
type BacklogSource = "conversation" | "review" | "build" | "roadmap" | "manual";

type BacklogItem = {
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

type BacklogSummary = Omit<BacklogItem, "body"> & { stale: boolean };

const STATUS_VALUES = ["candidate", "planned", "active", "shipped", "stale", "superseded"] as const;
const PRIORITY_VALUES = ["low", "medium", "high"] as const;
const SOURCE_VALUES = ["conversation", "review", "build", "roadmap", "manual"] as const;
const BACKLOG_ACTIONS = ["list", "add", "show", "status", "stale", "depends", "review", "analyze", "analyze-all", "promote", "curate"] as const;
const CLOSED_STATUSES = new Set<BacklogStatus>(["shipped", "stale", "superseded"]);
const SATISFIED_DEPENDENCY_STATUSES = new Set<BacklogStatus>(["shipped", "superseded"]);
const DEFAULT_STALE_DAYS = 14;
const MAX_PANEL_ROWS_FALLBACK = 20;

const AddParams = Type.Object({
	title: Type.String({ description: "Short title for the backlog item" }),
	claim: Type.Optional(Type.String({ description: "What should be remembered or investigated" })),
	evidence: Type.Optional(Type.String({ description: "Evidence, source, or why this matters" })),
	tags: Type.Optional(Type.Array(Type.String())),
	dependsOn: Type.Optional(Type.Array(Type.String(), { description: "Backlog item IDs this item depends on" })),
	priority: Type.Optional(StringEnum(PRIORITY_VALUES)),
	source: Type.Optional(StringEnum(SOURCE_VALUES)),
	staleAfter: Type.Optional(Type.String({ description: "YYYY-MM-DD date when this item should be rechecked" })),
});

const ListParams = Type.Object({
	status: Type.Optional(StringEnum(STATUS_VALUES)),
	query: Type.Optional(Type.String()),
	tag: Type.Optional(Type.String()),
	includeClosed: Type.Optional(Type.Boolean()),
});

const ShowParams = Type.Object({ id: Type.String() });

const UpdateParams = Type.Object({
	id: Type.String(),
	status: Type.Optional(StringEnum(STATUS_VALUES)),
	priority: Type.Optional(StringEnum(PRIORITY_VALUES)),
	claim: Type.Optional(Type.String()),
	addEvidence: Type.Optional(Type.String()),
	addRecheck: Type.Optional(Type.String()),
	tags: Type.Optional(Type.Array(Type.String())),
	dependsOn: Type.Optional(Type.Array(Type.String(), { description: "Replace dependency list with these backlog item IDs" })),
	addDependsOn: Type.Optional(Type.Array(Type.String(), { description: "Add backlog item IDs as dependencies" })),
	removeDependsOn: Type.Optional(Type.Array(Type.String(), { description: "Remove backlog item IDs from dependencies" })),
	epic: Type.Optional(Type.String()),
	lastChecked: Type.Optional(Type.String({ description: "YYYY-MM-DD date" })),
	staleAfter: Type.Optional(Type.String({ description: "YYYY-MM-DD date" })),
});

function backlogDir(cwd: string): string {
	return join(cwd, ".eforge", "backlog", "items");
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
	const parsed = new Date(`${date}T00:00:00.000Z`);
	parsed.setUTCDate(parsed.getUTCDate() + days);
	return parsed.toISOString().slice(0, 10);
}

function slugify(input: string): string {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60) || "item";
}

async function nextId(cwd: string, title: string): Promise<string> {
	const base = `backlog-${today()}-${slugify(title)}`;
	let candidate = base;
	let suffix = 2;
	while (await exists(itemPath(cwd, candidate))) {
		candidate = `${base}-${suffix}`;
		suffix += 1;
	}
	return candidate;
}

async function exists(path: string): Promise<boolean> {
	try {
		await readFile(path, "utf8");
		return true;
	} catch {
		return false;
	}
}

function itemPath(cwd: string, id: string): string {
	return join(backlogDir(cwd), `${id}.md`);
}

function parseInlineList(value: string | undefined): string[] {
	if (!value) return [];
	const trimmed = value.trim();
	if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
	const inner = trimmed.slice(1, -1).trim();
	if (!inner) return [];
	return inner.split(",").map((part) => part.trim().replace(/^['\"]|['\"]$/g, "")).filter(Boolean);
}

function uniqueValues(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function parseFrontmatter(content: string): { attrs: Record<string, string>; body: string } {
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

function titleFromBody(body: string, fallback: string): string {
	const match = body.match(/^#\s+(.+)$/m);
	return match?.[1]?.trim() || fallback;
}

function isStatus(value: string | undefined): value is BacklogStatus {
	return STATUS_VALUES.includes(value as BacklogStatus);
}

function isPriority(value: string | undefined): value is BacklogPriority {
	return PRIORITY_VALUES.includes(value as BacklogPriority);
}

function isSource(value: string | undefined): value is BacklogSource {
	return SOURCE_VALUES.includes(value as BacklogSource);
}

function parseItem(content: string, fallbackId: string): BacklogItem {
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

function serializeList(values: string[]): string {
	return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function serializeItem(item: BacklogItem): string {
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

async function ensureBacklogDir(cwd: string): Promise<void> {
	await mkdir(backlogDir(cwd), { recursive: true });
}

async function readItem(cwd: string, id: string): Promise<BacklogItem> {
	const content = await readFile(itemPath(cwd, id), "utf8");
	return parseItem(content, id);
}

async function writeItem(cwd: string, item: BacklogItem): Promise<void> {
	await ensureBacklogDir(cwd);
	await writeFile(itemPath(cwd, item.id), serializeItem({ ...item, updated: today() }), "utf8");
}

async function listItems(cwd: string): Promise<BacklogItem[]> {
	await ensureBacklogDir(cwd);
	const names = await readdir(backlogDir(cwd));
	const items = await Promise.all(
		names
			.filter((name) => name.endsWith(".md"))
			.map(async (name) => parseItem(await readFile(join(backlogDir(cwd), name), "utf8"), name.replace(/\.md$/, ""))),
	);
	return items.sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id));
}

function isStale(item: BacklogItem): boolean {
	if (["shipped", "stale", "superseded"].includes(item.status)) return false;
	return item.stale_after !== undefined && item.stale_after < today();
}

function summarize(item: BacklogItem): BacklogSummary {
	const { body: _body, ...rest } = item;
	return { ...rest, stale: isStale(item) };
}

function defaultBody(title: string, claim?: string, evidence?: string): string {
	return `# ${title}\n\n## Claim\n\n${claim?.trim() || "TBD"}\n\n## Evidence\n\n${evidence?.trim() || "- Source: manual capture"}\n\n## Recheck\n\n- Search or inspect the relevant files before promoting this item.\n\n## Promotion Paths\n\n- Create an eforge session plan when this becomes buildable work.\n- Link or update a Schaake OS epic if this becomes strategic work.\n`;
}

async function createItem(cwd: string, input: {
	title: string;
	claim?: string;
	evidence?: string;
	tags?: string[];
	dependsOn?: string[];
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
		body: defaultBody(input.title.trim(), input.claim, input.evidence),
	};
	await writeItem(cwd, item);
	return item;
}

function upsertSection(body: string, heading: string, content: string): string {
	const range = findSectionRange(body, heading);
	const replacement = `## ${heading}\n\n${content.trim()}\n\n`;
	if (!range) return body.trimEnd() + `\n\n${replacement}`;
	return body.slice(0, range.start) + replacement + body.slice(range.end).replace(/^\n+/, "");
}

function appendToSection(body: string, heading: string, content: string): string {
	const existing = sectionContent(body, heading);
	const next = `${existing.trim()}\n\n- ${content.trim()}`.trim();
	return upsertSection(body, heading, next);
}

function sectionContent(body: string, heading: string): string {
	const range = findSectionRange(body, heading);
	return range ? body.slice(range.contentStart, range.end).trim() : "";
}

function findSectionRange(body: string, heading: string): { start: number; contentStart: number; end: number } | undefined {
	const marker = `## ${heading}\n`;
	let start = body.indexOf(marker);
	while (start > 0 && body[start - 1] !== "\n") start = body.indexOf(marker, start + marker.length);
	if (start === -1) return undefined;
	const contentStart = start + marker.length;
	const next = body.indexOf("\n## ", contentStart);
	const end = next === -1 ? body.length : next + 1;
	return { start, contentStart, end };
}

function filterItems(items: BacklogItem[], params: { status?: BacklogStatus; query?: string; tag?: string; includeClosed?: boolean }): BacklogItem[] {
	const query = params.query?.toLowerCase().trim();
	return items.filter((item) => {
		if (params.status && item.status !== params.status) return false;
		if (!params.includeClosed && !params.status && CLOSED_STATUSES.has(item.status)) return false;
		if (params.tag && !item.tags.includes(params.tag)) return false;
		if (query && !`${item.id}\n${item.title}\n${item.tags.join(" ")}\n${item.depends_on.join(" ")}\n${item.body}`.toLowerCase().includes(query)) return false;
		return true;
	});
}

type BacklogDisplayItem = BacklogItem | BacklogSummary;

function itemById(items: BacklogDisplayItem[]): Map<string, BacklogDisplayItem> {
	return new Map(items.map((item) => [item.id, item]));
}

function blockedBy(item: BacklogDisplayItem, itemsById: Map<string, BacklogDisplayItem>): string[] {
	return item.depends_on.filter((dependencyId) => {
		const dependency = itemsById.get(dependencyId);
		return !dependency || !SATISFIED_DEPENDENCY_STATUSES.has(dependency.status);
	});
}

function itemIsStale(item: BacklogDisplayItem): boolean {
	return "stale" in item ? item.stale : isStale(item);
}

function shortId(id: string): string {
	return id.replace(/^backlog-\d{4}-\d{2}-\d{2}-/, "");
}

function formatIdList(ids: string[]): string {
	return ids.map(shortId).join(", ");
}

function formatSummaryLines(item: BacklogDisplayItem, itemsById: Map<string, BacklogDisplayItem>): string[] {
	const blocked = blockedBy(item, itemsById);
	const labels = [item.status, item.priority, ...(itemIsStale(item) ? ["review-due"] : []), ...(blocked.length ? ["blocked"] : [])];
	const lines = [`• ${item.title} [${labels.join("/")}]`, `  id: ${item.id}`];
	if (item.tags.length) lines.push(`  tags: ${item.tags.join(", ")}`);
	if (item.depends_on.length) lines.push(`  depends on: ${formatIdList(item.depends_on)}`);
	if (blocked.length) lines.push(`  blocked by: ${formatIdList(blocked)}`);
	return lines;
}

function formatSummaryList(items: BacklogDisplayItem[], contextItems: BacklogDisplayItem[] = items): string[] {
	const itemsById = itemById(contextItems);
	return items.flatMap((item, index) => [...formatSummaryLines(item, itemsById), ...(index < items.length - 1 ? [""] : [])]);
}

function terminalRows(tui: { terminal?: { rows?: number } }): number {
	const rows = tui.terminal?.rows;
	return typeof rows === "number" && Number.isFinite(rows) && rows > 0 ? rows : MAX_PANEL_ROWS_FALLBACK;
}

class BacklogPanel {
	private scroll = 0;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		private title: string,
		private lines: string[],
		private theme: Theme,
		private rows: () => number,
		private requestRender: () => void,
		private done: () => void,
	) {}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || matchesKey(data, "ctrl+c")) {
			this.done();
			return;
		}
		if (matchesKey(data, Key.down) || data === "j") this.scrollBy(1);
		if (matchesKey(data, Key.up) || data === "k") this.scrollBy(-1);
		if (matchesKey(data, Key.pageDown)) this.scrollBy(this.pageSize());
		if (matchesKey(data, Key.pageUp)) this.scrollBy(-this.pageSize());
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const rows = Math.max(6, this.rows());
		const contentRows = Math.max(1, rows - 5);
		const innerWidth = Math.max(1, width - 2);
		const content = this.contentLines(innerWidth);
		this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, content.length - contentRows)));
		const visible = content.slice(this.scroll, this.scroll + contentRows);
		const footer = `↑↓/j/k scroll • enter/esc close • ${Math.min(content.length, this.scroll + contentRows)}/${content.length}`;
		const out = [
			this.theme.fg("accent", `╭${"─".repeat(Math.max(0, width - 2))}╮`),
			this.theme.fg("accent", "│") + truncateToWidth(` ${this.title}`, innerWidth, "", true) + this.theme.fg("accent", "│"),
			...visible.map((line) => this.theme.fg("accent", "│") + truncateToWidth(line, innerWidth, "", true) + this.theme.fg("accent", "│")),
			this.theme.fg("accent", "│") + truncateToWidth(` ${this.theme.fg("dim", footer)}`, innerWidth, "", true) + this.theme.fg("accent", "│"),
			this.theme.fg("accent", `╰${"─".repeat(Math.max(0, width - 2))}╯`),
		];
		this.cachedWidth = width;
		this.cachedLines = out;
		return out;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	private scrollBy(delta: number): void {
		this.scroll = Math.max(0, this.scroll + delta);
		this.invalidate();
		this.requestRender();
	}

	private pageSize(): number {
		return Math.max(1, this.rows() - 6);
	}

	private contentLines(width: number): string[] {
		const out: string[] = [];
		for (const line of this.lines.length ? this.lines : [this.theme.fg("dim", "No backlog items found.")]) {
			out.push(...wrapTextWithAnsi(line, width).map((wrapped: string) => truncateToWidth(wrapped, width, "", true)));
		}
		return out;
	}
}

async function showPanel(ctx: ExtensionContext, title: string, lines: string[]): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify(lines.join("\n"), "info");
		return;
	}
	await ctx.ui.custom<void>((tui, theme, _kb, done) => new BacklogPanel(title, lines, theme, () => terminalRows(tui), () => tui.requestRender(), done));
}

function splitArgs(input: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: string | undefined;
	for (let index = 0; index < input.length; index += 1) {
		const char = input[index];
		if (quote) {
			if (char === quote) quote = undefined;
			else current += char;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}
		if (/\s/.test(char)) {
			if (current) tokens.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	if (current) tokens.push(current);
	return tokens;
}

function completionItem(value: string, description?: string): AutocompleteItem {
	return { value, label: value, ...(description ? { description } : {}) };
}

function matchingCompletions(values: readonly string[], prefix: string, descriptions: Record<string, string> = {}): AutocompleteItem[] | null {
	const matches = values.filter((value) => value.startsWith(prefix)).map((value) => completionItem(value, descriptions[value]));
	return matches.length > 0 ? matches : null;
}

function backlogArgumentCompletions(prefix: string): AutocompleteItem[] | null {
	const parts = prefix.split(/\s+/);
	const endsWithSpace = /\s$/.test(prefix);
	const action = parts[0] ?? "";
	const current = endsWithSpace ? "" : parts.at(-1) ?? "";

	if (parts.length <= 1 && !endsWithSpace) {
		return matchingCompletions(BACKLOG_ACTIONS, action, {
			list: "Show open backlog items",
			add: "Capture a new candidate item",
			show: "Show one item by id",
			status: "Set item status",
			stale: "Mark an item stale",
			depends: "Add dependency IDs to an item",
			review: "Show review-due summary",
			analyze: "Ask the agent to analyze one item",
			"analyze-all": "Ask the agent to analyze every open item",
			promote: "Prefill /eforge:plan for an item",
			curate: "Ask the agent to curate backlog items",
		});
	}

	if (action === "status" && (parts.length === 3 || (parts.length === 2 && endsWithSpace))) {
		return matchingCompletions(STATUS_VALUES, current);
	}

	return null;
}

async function handleBacklogCommand(pi: ExtensionAPI, args: string, ctx: ExtensionContext): Promise<void> {
	const [action = "list", ...rest] = splitArgs(args.trim());
	if (["list", "ls", ""].includes(action)) {
		const allItems = await listItems(ctx.cwd);
		const items = filterItems(allItems, { query: rest.join(" ") || undefined });
		await showPanel(ctx, "Backlog", formatSummaryList(items.map(summarize), allItems.map(summarize)));
		return;
	}

	if (action === "add") {
		const title = rest.join(" ").trim() || await ctx.ui.input("Backlog item", "short title");
		if (!title?.trim()) return;
		const item = await createItem(ctx.cwd, { title, source: "manual" });
		ctx.ui.notify(`Backlog item added: ${item.id}`, "info");
		return;
	}

	if (action === "show") {
		const id = rest[0];
		if (!id) return ctx.ui.notify("Usage: /backlog show <id>", "error");
		const item = await readItem(ctx.cwd, id);
		await showPanel(ctx, item.id, serializeItem(item).split("\n"));
		return;
	}

	if (action === "status" || action === "mark") {
		const [id, status, ...reasonParts] = rest;
		if (!id || !isStatus(status)) return ctx.ui.notify("Usage: /backlog status <id> candidate|planned|active|shipped|stale|superseded [reason]", "error");
		const item = await readItem(ctx.cwd, id);
		item.status = status;
		if (reasonParts.length > 0) item.body = appendToSection(item.body, "Evidence", `${today()}: marked ${status} — ${reasonParts.join(" ")}`);
		await writeItem(ctx.cwd, item);
		ctx.ui.notify(`Backlog item ${id} marked ${status}`, "info");
		return;
	}

	if (action === "stale") {
		const [id, ...reasonParts] = rest;
		if (!id) return ctx.ui.notify("Usage: /backlog stale <id> [reason]", "error");
		const item = await readItem(ctx.cwd, id);
		item.status = "stale";
		item.last_checked = today();
		item.body = appendToSection(item.body, "Evidence", `${today()}: marked stale${reasonParts.length ? ` — ${reasonParts.join(" ")}` : ""}`);
		await writeItem(ctx.cwd, item);
		ctx.ui.notify(`Backlog item ${id} marked stale`, "info");
		return;
	}

	if (action === "depends") {
		const [id, ...dependencyIds] = rest;
		if (!id || dependencyIds.length === 0) return ctx.ui.notify("Usage: /backlog depends <id> <dependency-id...>|--clear", "error");
		const item = await readItem(ctx.cwd, id);
		if (dependencyIds[0] === "--clear") item.depends_on = [];
		else {
			const knownIds = new Set((await listItems(ctx.cwd)).map((knownItem) => knownItem.id));
			const nextDependencies = uniqueValues([...item.depends_on, ...dependencyIds]).filter((dependencyId) => dependencyId !== id);
			const missing = nextDependencies.filter((dependencyId) => !knownIds.has(dependencyId));
			if (missing.length) return ctx.ui.notify(`Unknown dependency id(s): ${missing.join(", ")}`, "error");
			item.depends_on = nextDependencies;
		}
		await writeItem(ctx.cwd, item);
		ctx.ui.notify(`Backlog item ${id} dependencies: ${item.depends_on.length ? item.depends_on.join(", ") : "none"}`, "info");
		return;
	}

	if (action === "review" || action === "stale-due") {
		const items = await listItems(ctx.cwd);
		const due = items.filter(isStale);
		const active = items.filter((item) => !CLOSED_STATUSES.has(item.status));
		const itemsById = itemById(items);
		const blocked = active.filter((item) => blockedBy(item, itemsById).length > 0);
		await showPanel(ctx, "Backlog review", [
			`Open items: ${active.length}`,
			`Analysis due: ${due.length}`,
			`Blocked: ${blocked.length}`,
			"",
			...(due.length ? ["Analysis due", ...formatSummaryList(due.map(summarize), items.map(summarize)), ""] : []),
			...(blocked.length ? ["Blocked", ...formatSummaryList(blocked.map(summarize), items.map(summarize))] : []),
		]);
		return;
	}

	if (action === "analyze") {
		const id = rest[0];
		if (!id) return ctx.ui.notify("Usage: /backlog analyze <id>", "error");
		sendAgentPrompt(pi, ctx, buildAnalyzePrompt(id));
		return;
	}

	if (action === "analyze-all") {
		sendAgentPrompt(pi, ctx, buildAnalyzeAllPrompt());
		return;
	}

	if (action === "promote") {
		const id = rest[0];
		if (!id) return ctx.ui.notify("Usage: /backlog promote <id>", "error");
		const item = await readItem(ctx.cwd, id);
		const prompt = buildPromotePrompt(item);
		ctx.ui.setEditorText(prompt);
		ctx.ui.notify(`Prefilled editor with /eforge:plan for ${id}`, "info");
		return;
	}

	if (action === "curate") {
		sendAgentPrompt(pi, ctx, buildCuratorPrompt());
		return;
	}

	ctx.ui.notify("Usage: /backlog [list|add|show|status|stale|depends|review|analyze|analyze-all|promote|curate]", "error");
}

function sendAgentPrompt(pi: ExtensionAPI, ctx: ExtensionContext, prompt: string): void {
	if (ctx.isIdle()) pi.sendUserMessage(prompt);
	else pi.sendUserMessage(prompt, { deliverAs: "followUp" });
}

function buildPromotePrompt(item: BacklogItem): string {
	const claim = sectionContent(item.body, "Claim");
	return `/eforge:plan ${item.title}\n\nBacklog source: ${item.id}\n\nClaim:\n${claim || "TBD"}\n\nUse the backlog item at .eforge/backlog/items/${item.id}.md as context. Validate assumptions before marking the plan ready.`;
}

function buildAnalyzeInstructions(scope: string): string {
	return `${scope}\n\nAnalyze backlog staleness semantically, not by date alone. The stale_after field is only a review reminder.\n\nFor each item you analyze:\n- call backlog_show before changing it;\n- use last_checked, updated, or created as the start point for git/history inspection;\n- inspect recent git history, docs, and relevant code when cheap;\n- decide whether the item is still valid, shipped, superseded, genuinely stale, blocked, or needs claim/evidence/tag/dependency updates;\n- use backlog_update with evidence for any status, claim, tag, dependency, lastChecked, or staleAfter changes;\n- if still valid, set lastChecked to ${today()} and choose a future staleAfter/review date;\n- do not enqueue builds.\n\nStart with backlog_list includeClosed=false unless a specific item ID is provided.`;
}

function buildAnalyzePrompt(id: string): string {
	return buildAnalyzeInstructions(`Analyze backlog item ${id}.`);
}

function buildAnalyzeAllPrompt(): string {
	return buildAnalyzeInstructions("Analyze every open backlog item.");
}

function buildCuratorPrompt(): string {
	return `Review the lightweight backlog in .eforge/backlog/items without starting an eforge build.\n\nGoals:\n- list open, blocked, and analysis-due items;\n- inspect recent git history and relevant docs/code for evidence when cheap;\n- use backlog_update to mark shipped/stale/superseded items or maintain dependsOn relationships when evidence is clear;\n- suggest which items should be promoted to /eforge:plan, Schaake OS epics, roadmap updates, or discarded;\n- do not enqueue builds.\n\nStart by calling backlog_list with includeClosed=false.`;
}

function createDetails(item: BacklogItem | BacklogItem[] | BacklogSummary | BacklogSummary[]): Record<string, unknown> {
	return { backlog: item };
}

export default function backlogExtension(pi: ExtensionAPI): void {
	pi.registerCommand("backlog", {
		description: "Capture and review lightweight project backlog items",
		getArgumentCompletions: backlogArgumentCompletions,
		handler: async (args, ctx) => handleBacklogCommand(pi, args, ctx),
	});

	pi.registerTool({
		name: "backlog_add",
		label: "Backlog Add",
		description: "Capture a lightweight project backlog item without creating an eforge build.",
		promptSnippet: "Capture lightweight project backlog items in .eforge/backlog/items.",
		promptGuidelines: [
			"Use backlog_add when the user wants to remember an issue, follow-up, idea, or concern without starting an eforge build.",
			"Set dependsOn when a backlog item should wait for other backlog item IDs to be completed first.",
			"Do not use backlog_add for work that is already ready to build; ask whether to promote it to /eforge:plan instead.",
		],
		parameters: AddParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const item = await createItem(ctx.cwd, params);
			return {
				content: [{ type: "text", text: `Added backlog item ${item.id}: ${item.title}` }],
				details: createDetails(item),
			};
		},
		renderCall(args, theme) {
			return new Text(`${theme.fg("toolTitle", theme.bold("backlog_add "))}${theme.fg("muted", args.title)}`, 0, 0);
		},
		renderResult(result, _options, theme) {
			const item = (result.details as { backlog?: BacklogItem } | undefined)?.backlog;
			return new Text(item ? `${theme.fg("success", "✓")} ${theme.fg("accent", item.id)} ${theme.fg("muted", item.title)}` : "Backlog item added", 0, 0);
		},
	});

	pi.registerTool({
		name: "backlog_list",
		label: "Backlog List",
		description: "List lightweight project backlog items from .eforge/backlog/items.",
		promptSnippet: "List and filter lightweight backlog items.",
		promptGuidelines: ["Use backlog_list before curating or updating project backlog items."],
		parameters: ListParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const allItems = await listItems(ctx.cwd);
			const items = filterItems(allItems, params).map(summarize);
			return {
				content: [{ type: "text", text: items.length ? formatSummaryList(items, allItems.map(summarize)).join("\n") : "No matching backlog items." }],
				details: createDetails(items),
			};
		},
		renderCall(args, theme) {
			const filter = [args.status, args.query && `q=${args.query}`, args.tag && `tag=${args.tag}`].filter(Boolean).join(" ");
			return new Text(`${theme.fg("toolTitle", theme.bold("backlog_list "))}${theme.fg("muted", filter || "open")}`, 0, 0);
		},
		renderResult(result, _options, theme) {
			const items = (result.details as { backlog?: BacklogSummary[] } | undefined)?.backlog ?? [];
			return new Text(theme.fg(items.length ? "muted" : "dim", `${items.length} backlog item(s)`), 0, 0);
		},
	});

	pi.registerTool({
		name: "backlog_show",
		label: "Backlog Show",
		description: "Read one lightweight project backlog item by id.",
		parameters: ShowParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const item = await readItem(ctx.cwd, params.id);
			return {
				content: [{ type: "text", text: serializeItem(item) }],
				details: createDetails(item),
			};
		},
	});

	pi.registerTool({
		name: "backlog_update",
		label: "Backlog Update",
		description: "Update status, priority, tags, evidence, or recheck notes for a lightweight backlog item.",
		promptSnippet: "Update lightweight backlog item status and evidence after checking for staleness or completion.",
		promptGuidelines: [
			"Use backlog_update to mark backlog items shipped, stale, or superseded only when you have evidence.",
			"Use dependsOn, addDependsOn, or removeDependsOn to maintain backlog dependency relationships.",
			"When changing backlog item status, add evidence explaining why the status changed.",
		],
		parameters: UpdateParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const item = await readItem(ctx.cwd, params.id);
			if (params.status) item.status = params.status;
			if (params.priority) item.priority = params.priority;
			if (params.claim) item.body = upsertSection(item.body, "Claim", params.claim);
			if (params.addEvidence) item.body = appendToSection(item.body, "Evidence", `${today()}: ${params.addEvidence}`);
			if (params.addRecheck) item.body = appendToSection(item.body, "Recheck", params.addRecheck);
			if (params.tags) item.tags = params.tags;
			if (params.dependsOn) item.depends_on = uniqueValues(params.dependsOn).filter((dependencyId) => dependencyId !== item.id);
			if (params.addDependsOn) item.depends_on = uniqueValues([...item.depends_on, ...params.addDependsOn]).filter((dependencyId) => dependencyId !== item.id);
			if (params.removeDependsOn) item.depends_on = item.depends_on.filter((dependencyId) => !params.removeDependsOn?.includes(dependencyId));
			if (params.epic !== undefined) item.epic = params.epic || undefined;
			if (params.lastChecked) item.last_checked = params.lastChecked;
			else if (params.status === "shipped" || params.status === "stale" || params.status === "superseded") item.last_checked = today();
			if (params.staleAfter) item.stale_after = params.staleAfter;
			await writeItem(ctx.cwd, item);
			return {
				content: [{ type: "text", text: `Updated backlog item ${item.id}: ${item.status}` }],
				details: createDetails(item),
			};
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const items = await listItems(ctx.cwd).catch(() => []);
		const dueCount = items.filter(isStale).length;
		const openItems = items.filter((item) => !CLOSED_STATUSES.has(item.status));
		const blockedCount = openItems.filter((item) => blockedBy(item, itemById(items)).length > 0).length;
		if (openItems.length > 0) {
			ctx.ui.setStatus("backlog", `${ctx.ui.theme.fg("accent", "backlog:")}${openItems.length}${blockedCount ? ctx.ui.theme.fg("warning", `/${blockedCount} blocked`) : ""}${dueCount ? ctx.ui.theme.fg("warning", `/${dueCount} due`) : ""}`);
		}
	});
}
