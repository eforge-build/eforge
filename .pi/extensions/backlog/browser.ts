import { getMarkdownTheme, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Key, Markdown, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { blockedBy, CLOSED_STATUSES, filterReadyItems, formatIdList, formatSummaryList, itemById, matchesBacklogQuery, PRIORITY_VALUES, shortId, STATUS_VALUES, summarize, summaryLabels, type BacklogDisplayItem, type BacklogItem, type BacklogPriority, type BacklogStatus } from "./store";

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

export type BacklogBrowserAction = { kind: "analyze"; id: string } | { kind: "promote"; id: string };

export type BacklogBrowserMutationHandlers = {
	setStatus(id: string, status: BacklogStatus, reason?: string): Promise<BacklogItem>;
	setPriority(id: string, priority: BacklogPriority): Promise<BacklogItem>;
};

type BacklogBrowserMode = "list" | "detail" | "status-picker" | "priority-picker" | "status-reason"; type BacklogReturnMode = Extract<BacklogBrowserMode, "list" | "detail">;

const STATUS_DESCRIPTIONS: Record<BacklogStatus, string> = { candidate: "Captured, not yet committed to doing", planned: "Accepted as likely future work", active: "Currently being investigated or worked", shipped: "Completed; dependency blockers are satisfied", stale: "No longer current after review", superseded: "Replaced by another item or approach" };
const PRIORITY_DESCRIPTIONS: Record<BacklogPriority, string> = { low: "Nice-to-have or low urgency", medium: "Normal priority", high: "Important or time-sensitive" };

function replaceById(items: BacklogItem[], updated: BacklogItem, appendIfMissing: boolean): BacklogItem[] {
	const index = items.findIndex((item) => item.id === updated.id);
	if (index === -1) return appendIfMissing ? [...items, updated] : items;
	return [...items.slice(0, index), updated, ...items.slice(index + 1)];
}

class BacklogBrowser {
	private mode: BacklogBrowserMode = "list";
	private selected = 0;
	private activeItemId?: string;
	private pickerReturnMode: BacklogReturnMode = "list";
	private statusChoiceIndex = 0; private priorityChoiceIndex = 0;
	private pendingStatus?: BacklogStatus; private reasonInput = "";
	private busyText?: string; private errorText?: string;
	private listScroll = 0; private detailScroll = 0;
	private readyOnly: boolean;
	private search = ""; private searchEditing = false;
	private cachedWidth?: number; private cachedLines?: string[];

	constructor(
		private title: string,
		private items: BacklogItem[],
		private contextItems: BacklogItem[],
		private theme: Theme,
		private rows: () => number,
		private requestRender: () => void,
		private done: (action?: BacklogBrowserAction) => void,
		private mutations: BacklogBrowserMutationHandlers,
		initialReadyOnly = false,
	) {
		this.readyOnly = initialReadyOnly;
	}

	handleInput(data: string): void {
		if (this.busyText) return;
		if (this.searchEditing) return this.handleSearchInput(data);
		if (this.mode === "status-picker") return this.handleStatusPickerInput(data);
		if (this.mode === "priority-picker") return this.handlePriorityPickerInput(data);
		if (this.mode === "status-reason") return this.handleStatusReasonInput(data);
		if (matchesKey(data, "ctrl+c") || data === "q") return this.done();
		if (this.mode === "detail") return this.handleDetailInput(data);
		this.handleListInput(data);
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const rows = Math.max(6, this.rows());
		const innerWidth = Math.max(1, width - 2);
		const contentRows = Math.max(1, rows - 5);
		const content = this.renderModeContent(innerWidth, contentRows);
		const footer = this.footerText();
		const header = this.headerText();
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
		if (data === "s") return this.openStatusPicker();
		if (data === "!") return this.openPriorityPicker();
		if (matchesKey(data, Key.down) || data === "j") return this.moveSelection(1);
		if (matchesKey(data, Key.up) || data === "k") return this.moveSelection(-1);
		if (matchesKey(data, Key.pageDown)) return this.moveSelection(this.pageItems());
		if (matchesKey(data, Key.pageUp)) return this.moveSelection(-this.pageItems());
	}

	private handleDetailInput(data: string): void {
		if (matchesKey(data, Key.escape)) return this.done();
		if (matchesKey(data, Key.left) || matchesKey(data, Key.backspace) || data === "b") return this.closeDetail();
		if (data === "a") return this.finishWith("analyze");
		if (data === "p") return this.finishWith("promote");
		if (data === "s") return this.openStatusPicker();
		if (data === "!") return this.openPriorityPicker();
		if (matchesKey(data, Key.down) || data === "j") return this.scrollDetail(1);
		if (matchesKey(data, Key.up) || data === "k") return this.scrollDetail(-1);
		if (matchesKey(data, Key.pageDown)) return this.scrollDetail(this.rows() - 6);
		if (matchesKey(data, Key.pageUp)) return this.scrollDetail(-(this.rows() - 6));
	}

	private handleStatusPickerInput(data: string): void {
		if (this.isCancelKey(data)) return this.cancelPicker();
		if (matchesKey(data, Key.enter)) return this.chooseStatus();
		if (matchesKey(data, Key.down) || data === "j") return this.moveStatusChoice(1);
		if (matchesKey(data, Key.up) || data === "k") return this.moveStatusChoice(-1);
	}
	private handlePriorityPickerInput(data: string): void {
		if (this.isCancelKey(data)) return this.cancelPicker();
		if (matchesKey(data, Key.enter)) return this.choosePriority();
		if (matchesKey(data, Key.down) || data === "j") return this.movePriorityChoice(1);
		if (matchesKey(data, Key.up) || data === "k") return this.movePriorityChoice(-1);
	}

	private handleStatusReasonInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c")) {
			this.mode = "status-picker";
			this.changed();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			const status = this.pendingStatus;
			if (status) void this.applyStatus(status, this.reasonInput.trim() || undefined);
			return;
		}
		if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) this.reasonInput = this.reasonInput.slice(0, -1);
		else if (data.length === 1 && data.charCodeAt(0) >= 32) this.reasonInput += data;
		this.changed();
	}

	private isCancelKey(data: string): boolean {
		return matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c") || matchesKey(data, Key.left) || matchesKey(data, Key.backspace) || data === "b";
	}

	private openStatusPicker(): void {
		const item = this.currentItem();
		if (!item) return;
		this.activeItemId = item.id;
		this.pickerReturnMode = this.mode === "detail" ? "detail" : "list";
		this.statusChoiceIndex = Math.max(0, STATUS_VALUES.indexOf(item.status));
		this.errorText = undefined;
		this.mode = "status-picker";
		this.changed();
	}

	private openPriorityPicker(): void {
		const item = this.currentItem();
		if (!item) return;
		this.activeItemId = item.id;
		this.pickerReturnMode = this.mode === "detail" ? "detail" : "list";
		this.priorityChoiceIndex = Math.max(0, PRIORITY_VALUES.indexOf(item.priority));
		this.errorText = undefined;
		this.mode = "priority-picker";
		this.changed();
	}

	private moveStatusChoice(delta: number): void {
		this.statusChoiceIndex = Math.max(0, Math.min(STATUS_VALUES.length - 1, this.statusChoiceIndex + delta)); this.changed();
	}
	private movePriorityChoice(delta: number): void {
		this.priorityChoiceIndex = Math.max(0, Math.min(PRIORITY_VALUES.length - 1, this.priorityChoiceIndex + delta)); this.changed();
	}

	private chooseStatus(): void {
		const item = this.currentItem();
		const status = STATUS_VALUES[this.statusChoiceIndex];
		if (!item || !status) return;
		if (item.status === status) return this.returnFromPicker();
		if (CLOSED_STATUSES.has(status)) {
			this.pendingStatus = status;
			this.reasonInput = "";
			this.mode = "status-reason";
			this.changed();
			return;
		}
		void this.applyStatus(status);
	}

	private choosePriority(): void {
		const item = this.currentItem();
		const priority = PRIORITY_VALUES[this.priorityChoiceIndex];
		if (!item || !priority) return;
		if (item.priority === priority) return this.returnFromPicker();
		void this.applyPriority(priority);
	}

	private async applyStatus(status: BacklogStatus, reason?: string): Promise<void> {
		const item = this.currentItem();
		if (!item) return;
		this.busyText = `Setting status to ${status}...`;
		this.errorText = undefined;
		this.changed();
		try {
			const updated = await this.mutations.setStatus(item.id, status, reason);
			this.replaceItem(updated);
			this.returnFromPicker();
		} catch (error) {
			this.busyText = undefined;
			this.errorText = error instanceof Error ? error.message : String(error);
			this.changed();
		}
	}

	private async applyPriority(priority: BacklogPriority): Promise<void> {
		const item = this.currentItem();
		if (!item) return;
		this.busyText = `Setting priority to ${priority}...`;
		this.errorText = undefined;
		this.changed();
		try {
			const updated = await this.mutations.setPriority(item.id, priority);
			this.replaceItem(updated);
			this.returnFromPicker();
		} catch (error) {
			this.busyText = undefined;
			this.errorText = error instanceof Error ? error.message : String(error);
			this.changed();
		}
	}

	private cancelPicker(): void { this.returnFromPicker(); }

	private returnFromPicker(): void {
		const returnMode = this.pickerReturnMode;
		this.busyText = undefined;
		this.pendingStatus = undefined;
		this.reasonInput = "";
		this.mode = returnMode;
		if (returnMode === "list") this.activeItemId = undefined;
		this.clampSelection();
		this.changed();
	}

	private replaceItem(updated: BacklogItem): void {
		this.items = replaceById(this.items, updated, false);
		this.contextItems = replaceById(this.contextItems, updated, true);
		this.selectItemId(updated.id);
	}

	private selectItemId(id: string): void {
		const index = this.visibleItems().findIndex((item) => item.id === id);
		if (index >= 0) this.selected = index;
		else this.clampSelection();
	}

	private visibleItems(): BacklogItem[] {
		const scoped = this.readyOnly ? filterReadyItems(this.items, this.contextItems) : this.items;
		return scoped.filter((item) => matchesBacklogQuery(item, this.search));
	}

	private currentItem(): BacklogItem | undefined {
		if (this.mode !== "list" && this.activeItemId) return this.itemByActiveId();
		return this.visibleItems()[this.selected];
	}

	private itemByActiveId(): BacklogItem | undefined {
		return [...this.contextItems, ...this.items].find((item) => item.id === this.activeItemId);
	}

	private openDetail(): void {
		const item = this.currentItem();
		if (!item) return;
		this.activeItemId = item.id;
		this.mode = "detail";
		this.detailScroll = 0;
		this.changed();
	}

	private closeDetail(): void {
		this.mode = "list";
		this.activeItemId = undefined;
		this.clampSelection();
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

	private renderModeContent(width: number, contentRows: number): string[] {
		if (this.mode === "detail") return this.renderDetailContent(width, contentRows);
		if (this.mode === "status-picker") return this.renderStatusPickerContent(contentRows);
		if (this.mode === "priority-picker") return this.renderPriorityPickerContent(contentRows);
		if (this.mode === "status-reason") return this.renderStatusReasonContent(width, contentRows);
		return this.renderListContent(width, contentRows);
	}
	private headerText(): string {
		const search = this.search ? ` search=${this.search}` : "";
		if (this.mode === "detail") return `${this.title} / ${this.currentItem()?.title ?? "item"}`;
		if (this.mode === "status-picker") return `${this.title} / set status`;
		if (this.mode === "priority-picker") return `${this.title} / set priority`;
		if (this.mode === "status-reason") return `${this.title} / status evidence`;
		return `${this.title}${this.readyOnly ? " (ready)" : ""}${search}`;
	}

	private renderStatusPickerContent(contentRows: number): string[] {
		const item = this.currentItem();
		if (!item) return [this.theme.fg("dim", "No selected backlog item.")];
		const lines = [
			`Set status for ${this.theme.fg("accent", item.title)}`,
			this.theme.fg("dim", `Current: ${item.status}`),
			"",
			...STATUS_VALUES.map((status, index) => {
				const selected = index === this.statusChoiceIndex;
				const current = status === item.status ? " (current)" : "";
				const prefix = selected ? this.theme.fg("accent", "> ") : "  ";
				return `${prefix}${status}${current} ${this.theme.fg("dim", `— ${STATUS_DESCRIPTIONS[status]}`)}`;
			}),
			...this.statusLines(),
		];
		return lines.slice(0, contentRows);
	}

	private renderPriorityPickerContent(contentRows: number): string[] {
		const item = this.currentItem();
		if (!item) return [this.theme.fg("dim", "No selected backlog item.")];
		const lines = [
			`Set priority for ${this.theme.fg("accent", item.title)}`,
			this.theme.fg("dim", `Current: ${item.priority}`),
			"",
			...PRIORITY_VALUES.map((priority, index) => {
				const selected = index === this.priorityChoiceIndex;
				const current = priority === item.priority ? " (current)" : "";
				const prefix = selected ? this.theme.fg("accent", "> ") : "  ";
				return `${prefix}${priority}${current} ${this.theme.fg("dim", `— ${PRIORITY_DESCRIPTIONS[priority]}`)}`;
			}),
			...this.statusLines(),
		];
		return lines.slice(0, contentRows);
	}

	private renderStatusReasonContent(width: number, contentRows: number): string[] {
		const item = this.currentItem();
		const status = this.pendingStatus;
		if (!item || !status) return [this.theme.fg("dim", "No pending status change.")];
		const reason = this.reasonInput || this.theme.fg("dim", "(optional but recommended)");
		const lines = [
			`Evidence for marking ${this.theme.fg("accent", item.title)} ${this.theme.fg("accent", status)}`,
			this.theme.fg("dim", "This note will be appended to the Evidence section."),
			"",
			truncateToWidth(`Reason: ${reason}`, width, "", true),
			...this.statusLines(),
		];
		return lines.slice(0, contentRows);
	}

	private statusLines(): string[] {
		return [...(this.busyText ? ["", this.theme.fg("warning", this.busyText)] : []), ...(this.errorText ? ["", this.theme.fg("error", `Error: ${this.errorText}`)] : [])];
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
		if (this.busyText) return "Working...";
		if (this.searchEditing) return `/ search: ${this.search} • enter apply • esc close search`;
		if (this.mode === "status-picker") return "↑↓/j/k choose • enter set status • b/←/esc cancel";
		if (this.mode === "priority-picker") return "↑↓/j/k choose • enter set priority • b/←/esc cancel";
		if (this.mode === "status-reason") return "type evidence • enter save • esc back";
		if (this.mode === "detail") return "↑↓ scroll • b/← back • a analyze • p promote • s set status • ! set priority • q/esc close";
		return "↑↓/j/k navigate • enter view • / search • r ready • a analyze • p promote • s set status • ! set priority • q close";
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

export async function showBacklogBrowser(
	ctx: ExtensionContext,
	title: string,
	items: BacklogItem[],
	contextItems: BacklogItem[],
	mutations: BacklogBrowserMutationHandlers,
	readyOnly = false,
): Promise<BacklogBrowserAction | undefined> {
	if (!ctx.hasUI) {
		const visible = readyOnly ? filterReadyItems(items, contextItems) : items;
		ctx.ui.notify(formatSummaryList(visible.map(summarize), contextItems.map(summarize)).join("\n"), "info");
		return undefined;
	}
	return ctx.ui.custom<BacklogBrowserAction | undefined>((tui, theme, _kb, done) => new BacklogBrowser(title, items, contextItems, theme, () => terminalRows(tui), () => tui.requestRender(), done, mutations, readyOnly));
}

// --- eforge:endregion interactive-browser ---
