import { getMarkdownTheme, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Key, Markdown, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { blockedBy, filterReadyItems, formatIdList, formatSummaryList, itemById, matchesBacklogQuery, shortId, summarize, summaryLabels, type BacklogDisplayItem, type BacklogItem } from "./store";

// --- eforge:region interactive-browser ---
const MAX_PANEL_ROWS_FALLBACK = 20;

function terminalRows(tui: { terminal?: { rows?: number } }): number {
	const rows = tui.terminal?.rows;
	return typeof rows === "number" && Number.isFinite(rows) && rows > 0 ? rows : MAX_PANEL_ROWS_FALLBACK;
}

function backlogItemMarkdown(item: BacklogItem, contextItems: BacklogItem[] = [item]): string {
	const itemsById = itemById(contextItems);
	const dependencies = item.depends_on.length ? item.depends_on.map(shortId).join(", ") : "none";
	const blockers = blockedBy(item, itemsById);
	const blocked = blockers.length ? blockers.map(shortId).join(", ") : "none";
	const tags = item.tags.length ? item.tags.join(", ") : "none";
	const metadata = [
		`> **Status:** ${item.status}  `,
		`> **Priority:** ${item.priority}  `,
		`> **ID:** \`${item.id}\`  `,
		`> **Tags:** ${tags}  `,
		`> **Depends on:** ${dependencies}  `,
		`> **Blocked by:** ${blocked}`,
	].join("\n");
	return item.body.trimEnd().replace(/^(# .+)$/m, `$1\n\n${metadata}`);
}

function renderMarkdownContent(markdown: string, width: number): string[] {
	return new Markdown(markdown, 0, 0, getMarkdownTheme()).render(width).map((line) => truncateToWidth(line, width, "", true));
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

export type BacklogBrowserAction =
	| { kind: "analyze"; id: string }
	| { kind: "promote"; id: string }
	| { kind: "cycle-status"; id: string }
	| { kind: "cycle-priority"; id: string };

class BacklogBrowser {
	private mode: "list" | "detail" = "list";
	private selected = 0;
	private listScroll = 0;
	private detailScroll = 0;
	private readyOnly: boolean;
	private search = "";
	private searchEditing = false;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		private title: string,
		private items: BacklogItem[],
		private contextItems: BacklogItem[],
		private theme: Theme,
		private rows: () => number,
		private requestRender: () => void,
		private done: (action?: BacklogBrowserAction) => void,
		initialReadyOnly = false,
	) {
		this.readyOnly = initialReadyOnly;
	}

	handleInput(data: string): void {
		if (this.searchEditing) return this.handleSearchInput(data);
		if (matchesKey(data, "ctrl+c") || data === "q") return this.done();
		if (this.mode === "detail") return this.handleDetailInput(data);
		this.handleListInput(data);
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const rows = Math.max(6, this.rows());
		const innerWidth = Math.max(1, width - 2);
		const contentRows = Math.max(1, rows - 5);
		const content = this.mode === "detail" ? this.renderDetailContent(innerWidth, contentRows) : this.renderListContent(innerWidth, contentRows);
		const footer = this.footerText();
		const search = this.search ? ` search=${this.search}` : "";
		const header = this.mode === "detail" ? `${this.title} / ${this.currentItem()?.title ?? "item"}` : `${this.title}${this.readyOnly ? " (ready)" : ""}${search}`;
		const out = [
			this.theme.fg("accent", `╭${"─".repeat(Math.max(0, width - 2))}╮`),
			this.theme.fg("accent", "│") + truncateToWidth(` ${header}`, innerWidth, "", true) + this.theme.fg("accent", "│"),
			...content.map((line) => this.theme.fg("accent", "│") + truncateToWidth(line, innerWidth, "", true) + this.theme.fg("accent", "│")),
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

	private handleListInput(data: string): void {
		if (matchesKey(data, Key.escape)) return this.done();
		if (matchesKey(data, Key.enter) || matchesKey(data, Key.right)) return this.openDetail();
		if (data === "/") return this.startSearch();
		if (data === "r") return this.toggleReadyOnly();
		if (data === "a") return this.finishWith("analyze");
		if (data === "p") return this.finishWith("promote");
		if (data === "s") return this.finishWith("cycle-status");
		if (data === "!") return this.finishWith("cycle-priority");
		if (matchesKey(data, Key.down) || data === "j") return this.moveSelection(1);
		if (matchesKey(data, Key.up) || data === "k") return this.moveSelection(-1);
		if (matchesKey(data, Key.pageDown)) return this.moveSelection(this.pageItems());
		if (matchesKey(data, Key.pageUp)) return this.moveSelection(-this.pageItems());
	}

	private handleDetailInput(data: string): void {
		if (matchesKey(data, Key.escape)) return this.done();
		if (matchesKey(data, Key.left) || matchesKey(data, Key.backspace) || data === "b") return this.closeDetail();
		if (data === "/") return this.startSearch();
		if (data === "a") return this.finishWith("analyze");
		if (data === "p") return this.finishWith("promote");
		if (data === "s") return this.finishWith("cycle-status");
		if (data === "!") return this.finishWith("cycle-priority");
		if (matchesKey(data, Key.down) || data === "j") return this.scrollDetail(1);
		if (matchesKey(data, Key.up) || data === "k") return this.scrollDetail(-1);
		if (matchesKey(data, Key.pageDown)) return this.scrollDetail(this.rows() - 6);
		if (matchesKey(data, Key.pageUp)) return this.scrollDetail(-(this.rows() - 6));
	}

	private visibleItems(): BacklogItem[] {
		const scoped = this.readyOnly ? filterReadyItems(this.items, this.contextItems) : this.items;
		return scoped.filter((item) => matchesBacklogQuery(item, this.search));
	}

	private currentItem(): BacklogItem | undefined {
		return this.visibleItems()[this.selected];
	}

	private openDetail(): void {
		if (!this.currentItem()) return;
		this.mode = "detail";
		this.detailScroll = 0;
		this.changed();
	}

	private closeDetail(): void {
		this.mode = "list";
		this.changed();
	}

	private toggleReadyOnly(): void {
		this.readyOnly = !this.readyOnly;
		this.clampSelection();
		this.listScroll = 0;
		this.changed();
	}

	private startSearch(): void {
		this.searchEditing = true;
		this.changed();
	}

	private handleSearchInput(data: string): void {
		if (matchesKey(data, Key.enter)) {
			this.searchEditing = false;
			return this.changed();
		}
		if (matchesKey(data, Key.escape)) {
			this.searchEditing = false;
			return this.changed();
		}
		if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) this.search = this.search.slice(0, -1);
		else if (data.length === 1 && data.charCodeAt(0) >= 32) this.search += data;
		this.clampSelection();
		this.listScroll = 0;
		this.changed();
	}

	private finishWith(kind: BacklogBrowserAction["kind"]): void {
		const item = this.currentItem();
		if (!item) return;
		this.done({ kind, id: item.id });
	}

	private clampSelection(): void {
		this.selected = Math.min(this.selected, Math.max(0, this.visibleItems().length - 1));
	}

	private moveSelection(delta: number): void {
		const count = this.visibleItems().length;
		if (count === 0) return;
		this.selected = Math.max(0, Math.min(count - 1, this.selected + delta));
		const page = this.pageItems();
		this.listScroll = Math.max(0, Math.min(this.listScroll, Math.max(0, count - page)));
		if (this.selected < this.listScroll) this.listScroll = this.selected;
		if (this.selected >= this.listScroll + page) this.listScroll = this.selected - page + 1;
		this.changed();
	}

	private scrollDetail(delta: number): void {
		this.detailScroll = Math.max(0, this.detailScroll + delta);
		this.changed();
	}

	private pageItems(): number {
		return Math.max(1, Math.floor((this.rows() - 5) / 2));
	}

	private renderListContent(width: number, contentRows: number): string[] {
		const items = this.visibleItems();
		if (items.length === 0) return [this.theme.fg("dim", this.emptyMessage())];
		const pageItems = Math.max(1, Math.floor(contentRows / 2));
		this.listScroll = Math.max(0, Math.min(this.listScroll, Math.max(0, items.length - pageItems)));
		const visible = items.slice(this.listScroll, this.listScroll + pageItems);
		const itemsById = itemById(this.contextItems);
		return visible.flatMap((item, offset) => this.renderListItem(item, this.listScroll + offset === this.selected, itemsById, width)).slice(0, contentRows);
	}

	private renderListItem(item: BacklogItem, selected: boolean, itemsById: Map<string, BacklogDisplayItem>, width: number): string[] {
		const prefix = selected ? this.theme.fg("accent", "> ") : "  ";
		const title = `${prefix}${item.title} [${summaryLabels(item, itemsById).join("/")}]`;
		const blocked = blockedBy(item, itemsById);
		const meta = [`id: ${shortId(item.id)}`, item.tags.length && `tags: ${item.tags.join(", ")}`, blocked.length && `blocked by: ${formatIdList(blocked)}`].filter(Boolean).join(" • ");
		return [truncateToWidth(title, width, "", true), truncateToWidth(`  ${this.theme.fg("dim", meta)}`, width, "", true)];
	}

	private renderDetailContent(width: number, contentRows: number): string[] {
		const item = this.currentItem();
		if (!item) return [this.theme.fg("dim", "No selected backlog item.")];
		const content = this.detailLines(item, width);
		this.detailScroll = Math.max(0, Math.min(this.detailScroll, Math.max(0, content.length - contentRows)));
		return content.slice(this.detailScroll, this.detailScroll + contentRows);
	}

	private detailLines(item: BacklogItem, width: number): string[] {
		return renderMarkdownContent(backlogItemMarkdown(item, this.contextItems), width);
	}

	private footerText(): string {
		if (this.searchEditing) return `/ search: ${this.search} • enter apply • esc close search`;
		if (this.mode === "detail") return "↑↓ scroll • b/← back • a analyze • p promote • s status • ! priority • q/esc close";
		return "↑↓/j/k navigate • enter view • / search • r ready • a analyze • p promote • s status • ! priority • q close";
	}

	private emptyMessage(): string {
		if (this.search) return `No backlog items match search: ${this.search}`;
		return this.readyOnly ? "No ready backlog items." : "No backlog items found.";
	}

	private changed(): void {
		this.invalidate();
		this.requestRender();
	}
}

export async function showPanel(ctx: ExtensionContext, title: string, lines: string[]): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify(lines.join("\n"), "info");
		return;
	}
	await ctx.ui.custom<void>((tui, theme, _kb, done) => new BacklogPanel(title, lines, theme, () => terminalRows(tui), () => tui.requestRender(), done));
}

export async function showBacklogItem(ctx: ExtensionContext, item: BacklogItem, contextItems: BacklogItem[] = [item]): Promise<void> {
	const markdown = backlogItemMarkdown(item, contextItems);
	if (!ctx.hasUI) {
		ctx.ui.notify(markdown, "info");
		return;
	}
	await ctx.ui.custom<void>((tui, theme, _kb, done) => new BacklogPanel(item.title, renderMarkdownContent(markdown, Math.max(1, tui.terminal?.columns ?? 80)), theme, () => terminalRows(tui), () => tui.requestRender(), done));
}

export async function showBacklogBrowser(ctx: ExtensionContext, title: string, items: BacklogItem[], contextItems: BacklogItem[], readyOnly = false): Promise<BacklogBrowserAction | undefined> {
	if (!ctx.hasUI) {
		const visible = readyOnly ? filterReadyItems(items, contextItems) : items;
		ctx.ui.notify(formatSummaryList(visible.map(summarize), contextItems.map(summarize)).join("\n"), "info");
		return undefined;
	}
	return ctx.ui.custom<BacklogBrowserAction | undefined>((tui, theme, _kb, done) => new BacklogBrowser(title, items, contextItems, theme, () => terminalRows(tui), () => tui.requestRender(), done, readyOnly));
}

// --- eforge:endregion interactive-browser ---
