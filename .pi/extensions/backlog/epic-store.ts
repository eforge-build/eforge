import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	DEFAULT_STALE_DAYS,
	addDays,
	backlogRoot,
	exists,
	isPriority,
	isSource,
	isStatus,
	parseFrontmatter,
	parseInlineList,
	serializeList,
	slugify,
	titleFromBody,
	today,
	uniqueValues,
	type BacklogPriority,
	type BacklogSource,
	type BacklogStatus,
} from "./store";

// --- eforge:region epic-store ---
export type BacklogEpic = {
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
	body: string;
};

export type BacklogEpicSummary = Omit<BacklogEpic, "body"> & { stale: boolean };

export function epicDir(cwd: string): string {
	return join(backlogRoot(cwd), "epics");
}

export function epicPath(cwd: string, id: string): string {
	return join(epicDir(cwd), `${id}.md`);
}

export async function ensureEpicDir(cwd: string): Promise<void> {
	await mkdir(epicDir(cwd), { recursive: true });
}

export async function nextEpicId(cwd: string, title: string): Promise<string> {
	const base = `backlog-epic-${today()}-${slugify(title)}`;
	let candidate = base;
	let suffix = 2;
	while (await exists(epicPath(cwd, candidate))) {
		candidate = `${base}-${suffix}`;
		suffix += 1;
	}
	return candidate;
}

export function parseEpic(content: string, fallbackId: string): BacklogEpic {
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
		tags: uniqueValues(parseInlineList(attrs.tags)),
		body: body.trimEnd() + "\n",
	};
}

export function serializeEpic(epic: BacklogEpic): string {
	const attrs = [
		"---",
		`id: ${epic.id}`,
		`status: ${epic.status}`,
		`priority: ${epic.priority}`,
		`source: ${epic.source}`,
		`created: ${epic.created}`,
		`updated: ${epic.updated}`,
		...(epic.last_checked ? [`last_checked: ${epic.last_checked}`] : []),
		...(epic.stale_after ? [`stale_after: ${epic.stale_after}`] : []),
		`tags: ${serializeList(epic.tags)}`,
		"---",
		"",
	];
	return attrs.join("\n") + epic.body.trimEnd() + "\n";
}

export function defaultEpicBody(title: string, goal?: string, evidence?: string): string {
	return `# ${title}\n\n## Goal\n\n${goal?.trim() || "TBD"}\n\n## Evidence\n\n${evidence?.trim() || "- Source: manual capture"}\n\n## Recheck\n\n- Review linked backlog items before marking this epic shipped.\n\n## Notes\n\n- Link backlog items to this epic when they contribute to the goal.\n`;
}

export async function createEpic(cwd: string, input: {
	title: string;
	goal?: string;
	evidence?: string;
	tags?: string[];
	priority?: BacklogPriority;
	source?: BacklogSource;
	staleAfter?: string;
}): Promise<BacklogEpic> {
	const id = await nextEpicId(cwd, input.title);
	const date = today();
	const epic: BacklogEpic = {
		id,
		title: input.title.trim(),
		status: "candidate",
		priority: input.priority ?? "medium",
		source: input.source ?? "manual",
		created: date,
		updated: date,
		stale_after: input.staleAfter ?? addDays(date, DEFAULT_STALE_DAYS),
		tags: input.tags ?? [],
		body: defaultEpicBody(input.title.trim(), input.goal, input.evidence),
	};
	await writeEpic(cwd, epic);
	return epic;
}

export async function readEpic(cwd: string, id: string): Promise<BacklogEpic> {
	return parseEpic(await readFile(epicPath(cwd, id), "utf8"), id);
}

export async function writeEpic(cwd: string, epic: BacklogEpic): Promise<void> {
	await ensureEpicDir(cwd);
	await writeFile(epicPath(cwd, epic.id), serializeEpic({ ...epic, updated: today() }), "utf8");
}

export async function listEpics(cwd: string): Promise<BacklogEpic[]> {
	await ensureEpicDir(cwd);
	const names = await readdir(epicDir(cwd));
	const epics = await Promise.all(
		names
			.filter((name) => name.endsWith(".md"))
			.map(async (name) => parseEpic(await readFile(join(epicDir(cwd), name), "utf8"), name.replace(/\.md$/, ""))),
	);
	return epics.sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id));
}

export function epicExists(cwd: string, id: string): Promise<boolean> {
	return exists(epicPath(cwd, id));
}

export async function validateLocalEpic(cwd: string, epicId: string | undefined): Promise<void> {
	if (!epicId) return;
	if (!(await epicExists(cwd, epicId))) throw new Error(`Unknown backlog epic id: ${epicId}`);
}

export function epicIsStale(epic: BacklogEpic): boolean {
	if (["shipped", "stale", "superseded"].includes(epic.status)) return false;
	return epic.stale_after !== undefined && epic.stale_after < today();
}

export function summarizeEpic(epic: BacklogEpic): BacklogEpicSummary {
	const { body: _body, ...rest } = epic;
	return { ...rest, stale: epicIsStale(epic) };
}

export function filterEpics(epics: BacklogEpic[], params: { status?: BacklogStatus; query?: string; tag?: string; includeClosed?: boolean }): BacklogEpic[] {
	const query = params.query?.toLowerCase().trim();
	return epics.filter((epic) => {
		if (params.status && epic.status !== params.status) return false;
		if (!params.includeClosed && !params.status && ["shipped", "stale", "superseded"].includes(epic.status)) return false;
		if (params.tag && !epic.tags.includes(params.tag)) return false;
		if (query && !`${epic.id}\n${epic.title}\n${epic.tags.join(" ")}\n${epic.body}`.toLowerCase().includes(query)) return false;
		return true;
	});
}

export function epicById(epics: BacklogEpic[]): Map<string, BacklogEpic> {
	return new Map(epics.map((epic) => [epic.id, epic]));
}

export function formatEpicSummaryLines(epic: BacklogEpicSummary | BacklogEpic, itemCount?: number): string[] {
	const labels = [epic.status, epic.priority, ...("stale" in epic && epic.stale ? ["review-due"] : [])];
	const lines = [`• ${epic.title} [${labels.join("/")}]`, `  id: ${epic.id}`];
	if (epic.tags.length) lines.push(`  tags: ${epic.tags.join(", ")}`);
	if (itemCount !== undefined) lines.push(`  items: ${itemCount}`);
	return lines;
}

export function formatEpicSummaryList(epics: (BacklogEpicSummary | BacklogEpic)[], itemCounts: Map<string, number> = new Map()): string[] {
	return epics.flatMap((epic, index) => [...formatEpicSummaryLines(epic, itemCounts.get(epic.id)), ...(index < epics.length - 1 ? [""] : [])]);
}
// --- eforge:endregion epic-store ---
