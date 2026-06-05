import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { EpicAddParams, EpicLinkParams, EpicListParams, EpicShowParams, EpicUpdateParams } from "./schemas";
import { showPanel } from "./browser";
import {
	appendToSection,
	isStatus,
	listItems,
	readItem,
	today,
	upsertSection,
	writeItem,
	type BacklogItem,
} from "./store";
import {
	createEpic,
	filterEpics,
	formatEpicSummaryList,
	listEpics,
	readEpic,
	serializeEpic,
	summarizeEpic,
	validateLocalEpic,
	writeEpic,
	type BacklogEpic,
	type BacklogEpicSummary,
} from "./epic-store";

// --- eforge:region epic-runtime ---
export async function handleEpicCommand(args: string[], ctx: ExtensionContext): Promise<void> {
	const [subcommand = "list", ...rest] = args;
	if (["list", "ls", ""].includes(subcommand)) return showEpicList(ctx, rest.join(" ").trim() || undefined);
	if (subcommand === "add") return addEpicFromCommand(ctx, rest);
	if (subcommand === "show") return showEpicFromCommand(ctx, rest[0]);
	if (subcommand === "status" || subcommand === "mark") return setEpicStatusFromCommand(ctx, rest);
	if (subcommand === "link") return linkEpicFromCommand(ctx, rest);
	if (subcommand === "unlink") return unlinkEpicFromCommand(ctx, rest[0]);
	ctx.ui.notify("Usage: /backlog epic [list|add|show|status|link|unlink]", "error");
}

export function registerEpicTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "backlog_epic_add",
		label: "Backlog Epic Add",
		description: "Create a local backlog epic record under .backlog/epics without external integration.",
		promptSnippet: "Create local backlog epic records in .backlog/epics.",
		promptGuidelines: [
			"Use backlog_epic_add when the user wants a local backlog epic, not a Schaake OS epic.",
			"Use backlog_epic_link or backlog_update to connect backlog items to one local epic.",
		],
		parameters: EpicAddParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const epic = await createEpic(ctx.cwd, params);
			return { content: [{ type: "text", text: `Added backlog epic ${epic.id}: ${epic.title}` }], details: createEpicDetails(epic) };
		},
		renderCall(args, theme) {
			return new Text(`${theme.fg("toolTitle", theme.bold("backlog_epic_add "))}${theme.fg("muted", args.title)}`, 0, 0);
		},
	});

	pi.registerTool({
		name: "backlog_epic_list",
		label: "Backlog Epic List",
		description: "List local backlog epic records from .backlog/epics.",
		promptSnippet: "List and filter local backlog epics.",
		promptGuidelines: ["Use backlog_epic_list before linking items when the user references an existing local backlog epic."],
		parameters: EpicListParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const epics = filterEpics(await listEpics(ctx.cwd), params).map(summarizeEpic);
			return {
				content: [{ type: "text", text: epics.length ? formatEpicSummaryList(epics).join("\n") : "No matching backlog epics." }],
				details: createEpicDetails(epics),
			};
		},
	});

	pi.registerTool({
		name: "backlog_epic_show",
		label: "Backlog Epic Show",
		description: "Read one local backlog epic by id.",
		parameters: EpicShowParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const epic = await readEpic(ctx.cwd, params.id);
			return { content: [{ type: "text", text: serializeEpic(epic) }], details: createEpicDetails(epic) };
		},
	});

	pi.registerTool({
		name: "backlog_epic_update",
		label: "Backlog Epic Update",
		description: "Update status, priority, tags, goal, evidence, or review metadata for a local backlog epic.",
		parameters: EpicUpdateParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const epic = await readEpic(ctx.cwd, params.id);
			if (params.status) epic.status = params.status;
			if (params.priority) epic.priority = params.priority;
			if (params.goal) epic.body = upsertSection(epic.body, "Goal", params.goal);
			if (params.addEvidence) epic.body = appendToSection(epic.body, "Evidence", `${today()}: ${params.addEvidence}`);
			if (params.addRecheck) epic.body = appendToSection(epic.body, "Recheck", params.addRecheck);
			if (params.tags) epic.tags = params.tags;
			if (params.lastChecked) epic.last_checked = params.lastChecked;
			else if (params.status === "shipped" || params.status === "stale" || params.status === "superseded") epic.last_checked = today();
			if (params.staleAfter) epic.stale_after = params.staleAfter;
			await writeEpic(ctx.cwd, epic);
			return { content: [{ type: "text", text: `Updated backlog epic ${epic.id}: ${epic.status}` }], details: createEpicDetails(epic) };
		},
	});

	pi.registerTool({
		name: "backlog_epic_link",
		label: "Backlog Epic Link",
		description: "Link or unlink one backlog item to one local backlog epic.",
		parameters: EpicLinkParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const item = await linkItemToEpic(ctx.cwd, params.itemId, params.epicId || undefined);
			return { content: [{ type: "text", text: `Backlog item ${item.id} epic: ${item.epic ?? "none"}` }], details: { backlog: item } };
		},
	});
}

async function showEpicList(ctx: ExtensionContext, query?: string): Promise<void> {
	const epics = filterEpics(await listEpics(ctx.cwd), { query });
	const itemCounts = await countItemsByEpic(ctx.cwd);
	await showPanel(ctx, "Backlog epics", formatEpicSummaryList(epics.map(summarizeEpic), itemCounts));
}

async function addEpicFromCommand(ctx: ExtensionContext, args: string[]): Promise<void> {
	const title = args.join(" ").trim() || await ctx.ui.input("Backlog epic", "short title");
	if (!title?.trim()) return;
	const epic = await createEpic(ctx.cwd, { title, source: "manual" });
	ctx.ui.notify(`Backlog epic added: ${epic.id}`, "info");
}

async function showEpicFromCommand(ctx: ExtensionContext, id: string | undefined): Promise<void> {
	if (!id) return ctx.ui.notify("Usage: /backlog epic show <epic-id>", "error");
	const epic = await readEpic(ctx.cwd, id);
	await showPanel(ctx, epic.title, serializeEpic(epic).split("\n"));
}

async function setEpicStatusFromCommand(ctx: ExtensionContext, args: string[]): Promise<void> {
	const [id, status, ...reasonParts] = args;
	if (!id || !isStatus(status)) return ctx.ui.notify("Usage: /backlog epic status <epic-id> candidate|planned|active|shipped|stale|superseded [reason]", "error");
	const epic = await readEpic(ctx.cwd, id);
	epic.status = status;
	if (reasonParts.length > 0) epic.body = appendToSection(epic.body, "Evidence", `${today()}: marked ${status} — ${reasonParts.join(" ")}`);
	if (["shipped", "stale", "superseded"].includes(status)) epic.last_checked = today();
	await writeEpic(ctx.cwd, epic);
	ctx.ui.notify(`Backlog epic ${id} marked ${status}`, "info");
}

async function linkEpicFromCommand(ctx: ExtensionContext, args: string[]): Promise<void> {
	const [itemId, epicId] = args;
	if (!itemId || !epicId) return ctx.ui.notify("Usage: /backlog epic link <item-id> <epic-id>", "error");
	try {
		const item = await linkItemToEpic(ctx.cwd, itemId, epicId);
		ctx.ui.notify(`Backlog item ${item.id} linked to ${item.epic}`, "info");
	} catch (error) {
		ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
	}
}

async function unlinkEpicFromCommand(ctx: ExtensionContext, itemId: string | undefined): Promise<void> {
	if (!itemId) return ctx.ui.notify("Usage: /backlog epic unlink <item-id>", "error");
	try {
		const item = await linkItemToEpic(ctx.cwd, itemId, undefined);
		ctx.ui.notify(`Backlog item ${item.id} unlinked from epic`, "info");
	} catch (error) {
		ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
	}
}

async function linkItemToEpic(cwd: string, itemId: string, epicId: string | undefined): Promise<BacklogItem> {
	await validateLocalEpic(cwd, epicId);
	const item = await readItem(cwd, itemId);
	item.epic = epicId;
	await writeItem(cwd, item);
	return readItem(cwd, itemId);
}

async function countItemsByEpic(cwd: string): Promise<Map<string, number>> {
	const counts = new Map<string, number>();
	for (const item of await listItems(cwd)) {
		if (item.epic) counts.set(item.epic, (counts.get(item.epic) ?? 0) + 1);
	}
	return counts;
}

function createEpicDetails(epic: BacklogEpic | BacklogEpic[] | BacklogEpicSummary | BacklogEpicSummary[]): Record<string, unknown> {
	return { backlogEpic: epic };
}
// --- eforge:endregion epic-runtime ---
