import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

type EventRow = {
	timestamp: string;
	type: string;
	runId?: string | null;
	planId?: string | null;
	agent?: string | null;
	extensionName?: string | null;
	role?: string | null;
	stage?: string | null;
	providerName?: string | null;
	perspectiveKey?: string | null;
	status?: string | null;
	message?: string | null;
};

type EventTailOptions = {
	limit: number;
	typePattern?: string;
	extensionName?: string;
	planId?: string;
	runId?: string;
};

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 200;
const POLL_MS = 2_000;

function terminalRows(tui: { terminal?: { rows?: number } }): number {
	const rows = tui.terminal?.rows;
	return typeof rows === "number" && Number.isFinite(rows) && rows > 0 ? rows : 12;
}

function renderBorder(lines: string[], width: number, color: (text: string) => string, maxRows: number): string[] {
	if (width < 3) return lines.slice(0, maxRows).map((line) => truncateToWidth(line, width, "", true));
	const innerWidth = width - 2;
	const contentRows = Math.max(0, maxRows - 2);
	return [
		color(`╭${"─".repeat(innerWidth)}╮`),
		...lines.slice(0, contentRows).map((line) => color("│") + truncateToWidth(line, innerWidth, "", true) + color("│")),
		color(`╰${"─".repeat(innerWidth)}╯`),
	];
}

function oneLine(value: string | undefined, fallback = ""): string {
	return (value ?? fallback).trim().split("\n").filter(Boolean).at(-1) ?? fallback;
}

function sqlStringLiteral(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

function sqlLikePattern(pattern: string): string {
	const inferred = pattern === "all" ? "*" : pattern.includes(":") || pattern.includes("*") ? pattern : `${pattern}:*`;
	return inferred.replace(/[%_]/g, (char) => `\\${char}`).replace(/\*/g, "%");
}

function parseEventArgs(args: string, defaults: Partial<EventTailOptions> = {}): EventTailOptions {
	const options: EventTailOptions = { limit: DEFAULT_LIMIT, ...defaults };
	for (const token of args.trim().split(/\s+/).filter(Boolean)) {
		const parsed = Number(token);
		if (Number.isInteger(parsed) && parsed > 0) options.limit = Math.min(parsed, MAX_LIMIT);
		else if (token.startsWith("type=")) options.typePattern = token.slice("type=".length);
		else if (token.startsWith("extension=")) options.extensionName = token.slice("extension=".length);
		else if (token.startsWith("plan=")) options.planId = token.slice("plan=".length);
		else if (token.startsWith("run=")) options.runId = token.slice("run=".length);
		else if (defaults.typePattern === "extension:*" && token !== "all") options.extensionName = token;
		else if (token !== "all") options.typePattern = token;
	}
	return options;
}

function buildWhere(options: EventTailOptions): string {
	const clauses: string[] = [];
	if (options.typePattern && options.typePattern !== "all") {
		clauses.push(`type like ${sqlStringLiteral(sqlLikePattern(options.typePattern))} escape '\\'`);
	}
	if (options.extensionName) clauses.push(`json_extract(data, '$.extensionName') = ${sqlStringLiteral(options.extensionName)}`);
	if (options.planId) clauses.push(`plan_id = ${sqlStringLiteral(options.planId)}`);
	if (options.runId) clauses.push(`run_id = ${sqlStringLiteral(options.runId)}`);
	return clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
}

async function queryEvents(pi: ExtensionAPI, cwd: string, options: EventTailOptions): Promise<EventRow[]> {
	const query = `
select timestamp, type, run_id as runId, plan_id as planId, agent,
  json_extract(data, '$.extensionName') as extensionName,
  json_extract(data, '$.role') as role,
  json_extract(data, '$.stage') as stage,
  json_extract(data, '$.providerName') as providerName,
  json_extract(data, '$.perspectiveKey') as perspectiveKey,
  json_extract(data, '$.status') as status,
  json_extract(data, '$.message') as message
from events
${buildWhere(options)}
order by id desc
limit ${options.limit};`.trim();
	const result = await pi.exec("sqlite3", ["-json", join(cwd, ".eforge", "monitor.db"), query], { timeout: 5_000 });
	if (result.code !== 0) throw new Error(oneLine(result.stderr, "Failed to query .eforge/monitor.db"));
	const rows = result.stdout.trim() ? (JSON.parse(result.stdout.trim()) as EventRow[]) : [];
	return rows.reverse();
}

function formatTime(timestamp: string): string {
	return timestamp.replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function formatEvent(row: EventRow, theme: any): string {
	const details = [
		row.extensionName,
		row.planId ? `plan=${row.planId}` : undefined,
		row.runId ? `run=${row.runId.slice(0, 8)}` : undefined,
		row.agent ? `agent=${row.agent}` : undefined,
		row.role ? `role=${row.role}` : undefined,
		row.stage ? `stage=${row.stage}` : undefined,
		row.providerName ? `provider=${row.providerName}` : undefined,
		row.perspectiveKey ? `perspective=${row.perspectiveKey}` : undefined,
		row.status ? `status=${row.status}` : undefined,
		row.message,
	].filter(Boolean);
	const color = row.type.includes(":error") || row.type.endsWith(":failed") || row.type.endsWith(":timeout") ? "error" : row.type.endsWith(":skipped") ? "warning" : row.type.endsWith(":applied") || row.type.endsWith(":complete") ? "success" : "accent";
	return `${theme.fg("dim", formatTime(row.timestamp))} ${theme.fg(color, row.type)} ${theme.fg("muted", details.join(" "))}`;
}

class EventTailPanel {
	private events: EventRow[] = [];
	private error: string | undefined;
	private updatedAt = "loading...";

	constructor(
		private title: string,
		private options: EventTailOptions,
		private theme: any,
		private rows: () => number,
		private requestRender: () => void,
		private refresh: () => void,
		private done: () => void,
	) {}

	setSnapshot(events: EventRow[], error?: string): void {
		this.events = events;
		this.error = error;
		this.updatedAt = new Date().toLocaleTimeString();
		this.requestRender();
	}

	render(width: number): string[] {
		const innerWidth = Math.max(1, width - 2);
		const scope = [this.options.typePattern ?? "all", this.options.extensionName && `extension=${this.options.extensionName}`, this.options.planId && `plan=${this.options.planId}`, this.options.runId && `run=${this.options.runId}`].filter(Boolean).join(" • ");
		const lines = [
			this.theme.fg("accent", this.theme.bold(this.title)),
			this.theme.fg("dim", `${scope} • latest ${this.options.limit} • updated ${this.updatedAt}`),
		];
		if (this.error) lines.push(this.theme.fg("error", this.error));
		else if (this.events.length === 0) lines.push(this.theme.fg("muted", "No matching monitor events found yet."));
		else lines.push(...this.events.map((event) => truncateToWidth(formatEvent(event, this.theme), innerWidth, "", true)));
		lines.push(this.theme.fg("dim", `auto-refresh ${POLL_MS / 1000}s • r refresh • esc/enter close`));
		return renderBorder(lines, width, (s) => this.theme.fg("accent", s), terminalRows({ terminal: { rows: this.rows() } }));
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) this.done();
		else if (data === "r" || data === "R") this.refresh();
	}

	invalidate(): void {}
}

async function showTail(pi: ExtensionAPI, ctx: ExtensionContext, title: string, options: EventTailOptions): Promise<void> {
	let interval: ReturnType<typeof setInterval> | undefined;
	let inFlight = false;
	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		let panel: EventTailPanel;
		async function refreshNow(): Promise<void> {
			if (inFlight) return;
			inFlight = true;
			try {
				panel.setSnapshot(await queryEvents(pi, ctx.cwd, options));
			} catch (error) {
				panel.setSnapshot([], error instanceof Error ? error.message : String(error));
			} finally {
				inFlight = false;
			}
		}
		panel = new EventTailPanel(title, options, theme, () => terminalRows(tui), () => tui.requestRender(), () => void refreshNow(), done);
		void refreshNow();
		interval = setInterval(() => void refreshNow(), POLL_MS);
		return panel;
	});
	if (interval) clearInterval(interval);
}

export function showMonitorEventsTail(pi: ExtensionAPI, ctx: ExtensionContext, args: string): Promise<void> {
	return showTail(pi, ctx, "eforge monitor events", parseEventArgs(args));
}

export function showExtensionEventsTail(pi: ExtensionAPI, ctx: ExtensionContext, args: string): Promise<void> {
	return showTail(pi, ctx, "eforge extension events", parseEventArgs(args, { typePattern: "extension:*" }));
}
