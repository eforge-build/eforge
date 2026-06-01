import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text, type AutocompleteItem } from "@earendil-works/pi-tui";
import { showBacklogBrowser, showBacklogItem, showPanel, type BacklogBrowserAction } from "./browser";
import { AddParams, ListParams, ShowParams, UpdateParams } from "./schemas";
import {
	BACKLOG_ACTIONS,
	CLOSED_STATUSES,
	PRIORITY_VALUES,
	STATUS_VALUES,
	appendToSection,
	blockedBy,
	createItem,
	filterBlockedItems,
	filterItems,
	filterReadyItems,
	formatDependencyGraph,
	formatSummaryList,
	isStale,
	isStatus,
	itemById,
	listItems,
	readItem,
	sectionContent,
	serializeItem,
	summarize,
	today,
	uniqueValues,
	writeItem,
	type BacklogItem,
	type BacklogStatus,
	type BacklogSummary,
} from "./store";

// --- eforge:region command-runtime ---
async function handleBrowserAction(pi: ExtensionAPI, ctx: ExtensionContext, action: BacklogBrowserAction | undefined): Promise<void> {
	if (!action) return;
	if (action.kind === "analyze") return sendAgentPrompt(pi, ctx, buildAnalyzePrompt(action.id));
	if (action.kind === "promote") return prefillPromotePrompt(ctx, action.id);
	if (action.kind === "cycle-status") return cycleOpenStatus(ctx, action.id);
	if (action.kind === "cycle-priority") return cyclePriority(ctx, action.id);
}

async function prefillPromotePrompt(ctx: ExtensionContext, id: string): Promise<void> {
	const item = await readItem(ctx.cwd, id);
	ctx.ui.setEditorText(buildPromotePrompt(item));
	ctx.ui.notify(`Prefilled editor with /eforge:plan for ${id}`, "info");
}

async function cycleOpenStatus(ctx: ExtensionContext, id: string): Promise<void> {
	const item = await readItem(ctx.cwd, id);
	const openStatuses: BacklogStatus[] = ["candidate", "planned", "active"];
	item.status = openStatuses[(openStatuses.indexOf(item.status) + 1) % openStatuses.length] ?? "candidate";
	item.body = appendToSection(item.body, "Evidence", `${today()}: quick browser status change to ${item.status}`);
	await writeItem(ctx.cwd, item);
	ctx.ui.notify(`Backlog item ${id} marked ${item.status}`, "info");
}

async function cyclePriority(ctx: ExtensionContext, id: string): Promise<void> {
	const item = await readItem(ctx.cwd, id);
	const nextPriority = PRIORITY_VALUES[(PRIORITY_VALUES.indexOf(item.priority) + 1) % PRIORITY_VALUES.length] ?? "medium";
	item.priority = nextPriority;
	await writeItem(ctx.cwd, item);
	ctx.ui.notify(`Backlog item ${id} priority ${item.priority}`, "info");
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
			ready: "Show ready items not blocked by dependencies",
			blocked: "Show items blocked by dependencies",
			graph: "Show dependency tree",
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
		await handleBrowserAction(pi, ctx, await showBacklogBrowser(ctx, "Backlog", items, allItems));
		return;
	}

	if (action === "ready") {
		const allItems = await listItems(ctx.cwd);
		const items = filterItems(allItems, { query: rest.join(" ") || undefined });
		await handleBrowserAction(pi, ctx, await showBacklogBrowser(ctx, "Ready backlog", items, allItems, true));
		return;
	}

	if (action === "blocked") {
		const allItems = await listItems(ctx.cwd);
		const items = filterBlockedItems(filterItems(allItems, { query: rest.join(" ") || undefined }), allItems);
		await handleBrowserAction(pi, ctx, await showBacklogBrowser(ctx, "Blocked backlog", items, allItems));
		return;
	}

	if (action === "graph") {
		const allItems = await listItems(ctx.cwd);
		const items = filterItems(allItems, { query: rest.join(" ") || undefined });
		await showPanel(ctx, "Backlog dependency graph", formatDependencyGraph(items));
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
		const allItems = await listItems(ctx.cwd);
		const item = allItems.find((candidate) => candidate.id === id) ?? await readItem(ctx.cwd, id);
		await showBacklogItem(ctx, item, allItems);
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
		await prefillPromotePrompt(ctx, id);
		return;
	}

	if (action === "curate") {
		sendAgentPrompt(pi, ctx, buildCuratorPrompt());
		return;
	}

	ctx.ui.notify("Usage: /backlog [list|ready|blocked|graph|add|show|status|stale|depends|review|analyze|analyze-all|promote|curate]", "error");
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
		promptGuidelines: [
			"Use backlog_list before curating or updating project backlog items.",
			"Set readyOnly=true when the user asks for ready, unblocked, or actionable backlog items.",
			"Set blockedOnly=true when the user asks for blocked backlog items.",
		],
		parameters: ListParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const allItems = await listItems(ctx.cwd);
			const filtered = filterItems(allItems, params);
			const visible = params.readyOnly ? filterReadyItems(filtered, allItems) : params.blockedOnly ? filterBlockedItems(filtered, allItems) : filtered;
			const items = visible.map(summarize);
			return {
				content: [{ type: "text", text: items.length ? formatSummaryList(items, allItems.map(summarize)).join("\n") : "No matching backlog items." }],
				details: createDetails(items),
			};
		},
		renderCall(args, theme) {
			const filter = [args.readyOnly && "ready", args.blockedOnly && "blocked", args.status, args.query && `q=${args.query}`, args.tag && `tag=${args.tag}`].filter(Boolean).join(" ");
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
// --- eforge:endregion command-runtime ---
