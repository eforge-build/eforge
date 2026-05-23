import { readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type SelectItem, SelectList, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

type CheckStatus = "pending" | "running" | "passed" | "failed" | "skipped";

type DevState = {
	insideGit: boolean;
	branch: string | null;
	isMain: boolean;
	dirtyCount: number;
	aheadBehind: string | null;
	lastChecks: "unknown" | "running" | "passed" | "failed";
};

type Step = {
	label: string;
	command: string;
	args: string[];
	timeout?: number;
};

type StepResult = Step & {
	status: CheckStatus;
	code?: number;
	stdout?: string;
	stderr?: string;
	durationMs?: number;
};

const CHECK_STEPS: Step[] = [
	{ label: "Build workspace", command: "pnpm", args: ["build"], timeout: 120_000 },
	{ label: "Type check", command: "pnpm", args: ["type-check"], timeout: 120_000 },
	{ label: "Test", command: "pnpm", args: ["test"], timeout: 180_000 },
	{ label: "Docs drift check", command: "pnpm", args: ["docs:check"], timeout: 120_000 },
	{ label: "Docs site build", command: "pnpm", args: ["docs:build"], timeout: 180_000 },
];

const BRANCH_NAME_RE = /^(feat|fix|docs|refactor|test|chore|release)\/[a-z0-9][a-z0-9._-]*$/;

const DEV_ACTION = {
	BRANCH: "branch",
	CHECKS: "checks",
	PR: "pr",
	LAND: "land",
	RELEASE: "release",
	RELEASE_FINALIZE: "release-finalize",
	RESTART: "restart",
	PLAN: "plan",
	REFRESH: "refresh",
} as const;

const DEV_ACTIONS = [
	DEV_ACTION.BRANCH,
	DEV_ACTION.CHECKS,
	DEV_ACTION.PR,
	DEV_ACTION.LAND,
	DEV_ACTION.RELEASE,
	DEV_ACTION.RELEASE_FINALIZE,
	DEV_ACTION.RESTART,
	DEV_ACTION.PLAN,
	DEV_ACTION.REFRESH,
];

const CHECK_CHOICE = {
	RUN: "Run checks",
	SKIP: "Skip checks",
	CANCEL: "Cancel",
} as const;

const CHECK_CHOICES = [CHECK_CHOICE.RUN, CHECK_CHOICE.SKIP, CHECK_CHOICE.CANCEL];

const LAND_MODE = {
	CREATE_AUTO_MERGE: "Open PR + auto-merge on CI pass",
	CREATE_PR_ONLY: "Open PR only",
	UPDATE_AUTO_MERGE: "Update PR + auto-merge on CI pass",
	UPDATE_PR_ONLY: "Update PR only",
	LOCAL_FAST_FORWARD: "Local fast-forward merge",
	CANCEL: "Cancel",
} as const;

const NEW_PR_LAND_MODES = [LAND_MODE.CREATE_AUTO_MERGE, LAND_MODE.CREATE_PR_ONLY, LAND_MODE.LOCAL_FAST_FORWARD, LAND_MODE.CANCEL];
const EXISTING_PR_LAND_MODES = [LAND_MODE.UPDATE_AUTO_MERGE, LAND_MODE.UPDATE_PR_ONLY, LAND_MODE.LOCAL_FAST_FORWARD, LAND_MODE.CANCEL];

function isPrLandMode(mode: string): boolean {
	return [LAND_MODE.CREATE_AUTO_MERGE, LAND_MODE.CREATE_PR_ONLY, LAND_MODE.UPDATE_AUTO_MERGE, LAND_MODE.UPDATE_PR_ONLY].includes(mode as never);
}

function isAutoMergeLandMode(mode: string): boolean {
	return mode === LAND_MODE.CREATE_AUTO_MERGE || mode === LAND_MODE.UPDATE_AUTO_MERGE;
}

function getMutationPath(input: unknown): string | undefined {
	if (!input || typeof input !== "object") return undefined;
	const maybePath = (input as { path?: unknown }).path;
	return typeof maybePath === "string" ? maybePath : undefined;
}

function isProjectLocalEforgePath(cwd: string, filePath: string): boolean {
	const absolute = resolve(cwd, filePath);
	const rel = relative(cwd, absolute);
	if (rel === "" || rel.startsWith("..") || rel.includes(`..${sep}`)) return false;
	return rel === ".eforge" || rel.startsWith(`.eforge${sep}`);
}

const RELEASE_BUMP_TYPES = ["patch", "minor", "major"] as const;
type ReleaseBumpType = (typeof RELEASE_BUMP_TYPES)[number];

function oneLine(value: string | undefined, fallback = ""): string {
	return (value ?? fallback).trim().split("\n").filter(Boolean).at(-1) ?? fallback;
}

function statusIcon(status: CheckStatus): string {
	switch (status) {
		case "passed":
			return "✓";
		case "failed":
			return "✗";
		case "running":
			return "●";
		case "skipped":
			return "-";
		default:
			return "○";
	}
}

function formatDuration(ms: number | undefined): string {
	if (ms === undefined) return "";
	return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const FALLBACK_TERMINAL_ROWS = 12;
const INFO_RESERVED_ROWS = 4;
const PROGRESS_RESERVED_ROWS = 4;
const MAX_COCKPIT_VISIBLE = 15;

function terminalRows(tui: { terminal?: { rows?: number } }): number {
	const rows = tui.terminal?.rows;
	return typeof rows === "number" && Number.isFinite(rows) && rows > 0 ? rows : FALLBACK_TERMINAL_ROWS;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(value, max));
}

function borderedLineBudget(tui: { terminal?: { rows?: number } }): number {
	return Math.max(1, terminalRows(tui));
}

function renderBorderedLines(lines: string[], width: number, color: (text: string) => string, maxRows?: number): string[] {
	const rowBudget = maxRows === undefined ? undefined : Math.max(1, Math.floor(maxRows));
	if (width < 3) {
		const rendered = (lines.length > 0 ? lines : [""]).map((line) => truncateToWidth(line, width, "", true));
		return rowBudget === undefined ? rendered : rendered.slice(0, rowBudget);
	}

	const innerWidth = width - 2;
	const contentRows = rowBudget === undefined ? undefined : Math.max(0, rowBudget - 2);
	const contentLines = (lines.length > 0 ? lines : [""]).slice(0, contentRows);
	const rendered = [
		color(`╭${"─".repeat(innerWidth)}╮`),
		...contentLines.map((line) => color("│") + truncateToWidth(line, innerWidth, "", true) + color("│")),
		color(`╰${"─".repeat(innerWidth)}╯`),
	];
	return rowBudget === undefined ? rendered : rendered.slice(0, rowBudget);
}

async function getGitState(pi: ExtensionAPI): Promise<DevState> {
	const inside = await pi.exec("git", ["rev-parse", "--is-inside-work-tree"], { timeout: 5_000 });
	if (inside.code !== 0 || inside.stdout.trim() !== "true") {
		return { insideGit: false, branch: null, isMain: false, dirtyCount: 0, aheadBehind: null, lastChecks: "unknown" };
	}

	const [branchResult, statusResult] = await Promise.all([
		pi.exec("git", ["branch", "--show-current"], { timeout: 5_000 }),
		pi.exec("git", ["status", "--porcelain=v1", "--branch"], { timeout: 5_000 }),
	]);

	const branch = branchResult.stdout.trim() || null;
	const statusLines = statusResult.stdout.split("\n").filter(Boolean);
	const branchHeader = statusLines.find((line) => line.startsWith("## "));
	const dirtyCount = statusLines.filter((line) => !line.startsWith("## ")).length;
	const aheadBehind = branchHeader?.match(/\[(.+)]/)?.[1] ?? null;

	return {
		insideGit: true,
		branch,
		isMain: branch === "main",
		dirtyCount,
		aheadBehind,
		lastChecks: "unknown",
	};
}

function mergeCheckState(current: DevState, previous: DevState | undefined): DevState {
	return { ...current, lastChecks: previous?.lastChecks ?? "unknown" };
}

function renderStateLines(state: DevState, theme: any): string[] {
	if (!state.insideGit) return [theme.fg("warning", "Not in a git repository")];

	const branchText = state.isMain
		? theme.fg("warning", `${state.branch} ⚠`)
		: theme.fg("success", state.branch ?? "detached");
	const dirtyText = state.dirtyCount === 0 ? theme.fg("success", "clean") : theme.fg("warning", `${state.dirtyCount} changed`);
	const checksColor = state.lastChecks === "passed" ? "success" : state.lastChecks === "failed" ? "error" : "muted";

	return [
		`Branch: ${branchText}`,
		`Worktree: ${dirtyText}`,
		`Ahead/behind: ${theme.fg("muted", state.aheadBehind ?? "none")}`,
		`Checks: ${theme.fg(checksColor, state.lastChecks)}`,
	];
}

async function updateDevUi(pi: ExtensionAPI, ctx: ExtensionContext, previous?: DevState): Promise<DevState> {
	const state = mergeCheckState(await getGitState(pi), previous);
	const theme = ctx.ui.theme;

	if (!state.insideGit) {
		ctx.ui.setStatus("eforge-dev", theme.fg("warning", "dev:no-git"));
		ctx.ui.setWidget("eforge-dev", undefined);
		return state;
	}

	const branch = state.branch ?? "detached";
	const dirty = state.dirtyCount === 0 ? "clean" : `${state.dirtyCount} dirty`;
	const branchStyled = state.isMain ? theme.fg("warning", branch) : theme.fg("success", branch);
	ctx.ui.setStatus("eforge-dev", `${theme.fg("accent", "dev:")}${branchStyled} ${theme.fg("dim", dirty)}`);

	if (state.isMain) {
		ctx.ui.setWidget(
			"eforge-dev",
			[
				theme.fg("warning", "⚠ eforge-dev: you are on main."),
				theme.fg("dim", "Use /dev branch before planning or building non-release work."),
			],
			{ placement: "belowEditor" },
		);
	} else {
		ctx.ui.setWidget("eforge-dev", undefined);
	}

	return state;
}

async function confirmIfDirty(pi: ExtensionAPI, ctx: ExtensionContext, action: string): Promise<boolean> {
	const state = await getGitState(pi);
	if (state.dirtyCount === 0) return true;
	if (!ctx.hasUI) return false;
	return ctx.ui.confirm("Dirty worktree", `${state.dirtyCount} changed file(s). ${action} anyway?`);
}

async function promptForBranch(ctx: ExtensionContext): Promise<string | undefined> {
	const input = await ctx.ui.input("Feature branch", "feat/short-description");
	const branch = input?.trim();
	if (!branch) return undefined;
	if (!BRANCH_NAME_RE.test(branch)) {
		ctx.ui.notify("Use a branch like feat/name, fix/name, docs/name, refactor/name, test/name, chore/name, or release/name", "warning");
		return undefined;
	}
	return branch;
}

class InfoPanel {
	private scrollOffset = 0;
	private lastRenderWidth = 80;

	constructor(
		private title: string,
		private lines: string[],
		private theme: any,
		private rows: () => number,
		private requestRender: () => void,
		private done: () => void,
	) {}

	private contentLines(width: number): string[] {
		const innerWidth = Math.max(1, width);
		const out: string[] = [];
		for (const line of this.lines) {
			out.push(...wrapTextWithAnsi(line, innerWidth).map((wrapped) => truncateToWidth(wrapped, innerWidth, "", true)));
		}
		return out;
	}

	private viewportRows(): number {
		return Math.max(0, this.rows() - INFO_RESERVED_ROWS);
	}

	render(width: number): string[] {
		const innerWidth = Math.max(20, width - 2);
		this.lastRenderWidth = innerWidth;
		const content = this.contentLines(innerWidth);
		const viewportRows = this.viewportRows();
		const maxScroll = Math.max(0, content.length - viewportRows);
		this.scrollOffset = clamp(this.scrollOffset, 0, maxScroll);
		const visibleEnd = Math.min(content.length, this.scrollOffset + viewportRows);
		const scrollText = content.length > viewportRows ? ` • lines ${this.scrollOffset + 1}-${visibleEnd}/${content.length}` : "";
		const out = [
			truncateToWidth(this.theme.fg("accent", this.theme.bold(this.title)), innerWidth, "", true),
			...content.slice(this.scrollOffset, visibleEnd),
			this.theme.fg("dim", `↑↓/PgUp/PgDn/Home/End scroll • esc/enter close${scrollText}`),
		];
		return renderBorderedLines(out, width, (s: string) => this.theme.fg("accent", s), this.rows());
	}

	handleInput(data: string): void {
		const content = this.contentLines(this.lastRenderWidth);
		const viewportRows = this.viewportRows();
		const maxScroll = Math.max(0, content.length - viewportRows);
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) {
			this.done();
		} else if (matchesKey(data, Key.up)) {
			this.scrollOffset = clamp(this.scrollOffset - 1, 0, maxScroll);
			this.requestRender();
		} else if (matchesKey(data, Key.down)) {
			this.scrollOffset = clamp(this.scrollOffset + 1, 0, maxScroll);
			this.requestRender();
		} else if (matchesKey(data, Key.pageUp)) {
			this.scrollOffset = clamp(this.scrollOffset - viewportRows, 0, maxScroll);
			this.requestRender();
		} else if (matchesKey(data, Key.pageDown)) {
			this.scrollOffset = clamp(this.scrollOffset + viewportRows, 0, maxScroll);
			this.requestRender();
		} else if (matchesKey(data, Key.home)) {
			this.scrollOffset = 0;
			this.requestRender();
		} else if (matchesKey(data, Key.end)) {
			this.scrollOffset = maxScroll;
			this.requestRender();
		}
	}

	invalidate(): void {}
}

async function showInfo(ctx: ExtensionContext, title: string, lines: string[]): Promise<void> {
	await ctx.ui.custom<void>((tui, theme, _kb, done) => new InfoPanel(title, lines, theme, () => borderedLineBudget(tui), () => tui.requestRender(), done));
}

class ProgressPanel {
	private cachedWidth?: number;
	private cachedRows?: number;
	private cachedLines?: string[];

	constructor(
		private title: string,
		private results: StepResult[],
		private theme: any,
		private rows: () => number,
		private abort: () => void,
	) {}

	setResults(results: StepResult[]): void {
		this.results = results;
		this.invalidate();
	}

	render(width: number): string[] {
		const rows = this.rows();
		if (this.cachedWidth === width && this.cachedRows === rows && this.cachedLines) return this.cachedLines;

		const innerWidth = Math.max(1, width - 2);
		const stepLines: string[] = [];

		for (const result of this.results) {
			const color = result.status === "passed" ? "success" : result.status === "failed" ? "error" : result.status === "running" ? "accent" : "muted";
			const duration = formatDuration(result.durationMs);
			stepLines.push(truncateToWidth(`${this.theme.fg(color, statusIcon(result.status))} ${result.label}${duration ? ` ${this.theme.fg("dim", duration)}` : ""}`, innerWidth, "", true));
			if (result.status === "failed") {
				const detail = oneLine(result.stderr) || oneLine(result.stdout) || `exit ${result.code ?? "unknown"}`;
				stepLines.push(truncateToWidth(`  ${this.theme.fg("error", detail)}`, innerWidth, "", true));
			}
		}

		const stepBudget = Math.max(0, rows - PROGRESS_RESERVED_ROWS);
		const runningIndex = this.results.findIndex((result) => result.status === "running");
		const failedIndex = this.results.findIndex((result) => result.status === "failed");
		const focusIndex = failedIndex >= 0 ? failedIndex : runningIndex;
		let visibleSteps = stepLines.slice(0, stepBudget);
		if (stepLines.length > stepBudget && focusIndex >= 0) {
			const start = clamp(focusIndex - Math.floor(stepBudget / 2), 0, Math.max(0, stepLines.length - stepBudget));
			visibleSteps = stepLines.slice(start, start + stepBudget);
		}

		const lines = [
			truncateToWidth(this.theme.fg("accent", this.theme.bold(this.title)), innerWidth, "", true),
			...visibleSteps,
			this.theme.fg("dim", "esc/ctrl-c cancel"),
		];
		this.cachedWidth = width;
		this.cachedRows = rows;
		this.cachedLines = renderBorderedLines(lines, width, (s: string) => this.theme.fg("accent", s), rows);
		return this.cachedLines;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) this.abort();
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedRows = undefined;
		this.cachedLines = undefined;
	}
}

async function runSteps(pi: ExtensionAPI, ctx: ExtensionContext, title: string, steps: Step[]): Promise<StepResult[]> {
	const initial: StepResult[] = steps.map((step) => ({ ...step, status: "pending" }));
	const controller = new AbortController();

	const results = await ctx.ui.custom<StepResult[]>(
		(tui, theme, _kb, done) => {
			let panelResults = [...initial];
			const panel = new ProgressPanel(title, panelResults, theme, () => borderedLineBudget(tui), () => controller.abort());

			async function execute() {
				for (let i = 0; i < panelResults.length; i++) {
					if (controller.signal.aborted) {
						panelResults = panelResults.map((result, index) => (index >= i ? { ...result, status: "skipped" } : result));
						panel.setResults(panelResults);
						tui.requestRender();
						break;
					}

					const current = panelResults[i]!;
					panelResults[i] = { ...current, status: "running" };
					panel.setResults(panelResults);
					tui.requestRender();

					const start = Date.now();
					const result = await pi.exec(current.command, current.args, { timeout: current.timeout, signal: controller.signal });
					const status: CheckStatus = result.code === 0 ? "passed" : "failed";
					panelResults[i] = {
						...current,
						status,
						code: result.code,
						stdout: result.stdout,
						stderr: result.stderr,
						durationMs: Date.now() - start,
					};

					if (status === "failed") {
						panelResults = panelResults.map((item, index) => (index > i ? { ...item, status: "skipped" } : item));
						panel.setResults(panelResults);
						tui.requestRender();
						break;
					}
				}
				done(panelResults);
			}

			void execute().catch((error: unknown) => {
				panelResults = panelResults.map((result) =>
					result.status === "running" ? { ...result, status: "failed", stderr: error instanceof Error ? error.message : String(error) } : result,
				);
				done(panelResults);
			});

			return panel;
		},
	);

	return results;
}

async function runChecks(pi: ExtensionAPI, ctx: ExtensionContext, setLastChecks: (status: DevState["lastChecks"]) => Promise<void>): Promise<boolean> {
	await setLastChecks("running");
	const results = await runSteps(pi, ctx, "eforge checks", CHECK_STEPS);
	const ok = results.every((result) => result.status === "passed");
	await setLastChecks(ok ? "passed" : "failed");
	ctx.ui.notify(ok ? "Checks passed" : "Checks failed", ok ? "info" : "error");
	return ok;
}

async function createBranch(pi: ExtensionAPI, ctx: ExtensionContext, branchArg?: string): Promise<void> {
	const branch = branchArg?.trim() || (await promptForBranch(ctx));
	if (!branch) return;
	if (!BRANCH_NAME_RE.test(branch)) {
		ctx.ui.notify("Invalid branch name. Use feat/name, fix/name, docs/name, refactor/name, test/name, chore/name, or release/name", "error");
		return;
	}

	const okDirty = await confirmIfDirty(pi, ctx, `Create/switch to ${branch}`);
	if (!okDirty) return;

	const exists = await pi.exec("git", ["rev-parse", "--verify", branch], { timeout: 5_000 });
	const result = exists.code === 0 ? await pi.exec("git", ["switch", branch], { timeout: 10_000 }) : await pi.exec("git", ["switch", "-c", branch], { timeout: 10_000 });

	if (result.code === 0) {
		ctx.ui.notify(`Now on ${branch}`, "info");
	} else {
		ctx.ui.notify(oneLine(result.stderr, `Failed to switch to ${branch}`), "error");
	}
}

async function getCommitsAheadOfMain(pi: ExtensionAPI): Promise<string[]> {
	const commits = await pi.exec("git", ["log", "--oneline", "main..HEAD"], { timeout: 5_000 });
	if (commits.code !== 0) return [];
	return commits.stdout.trim().split("\n").filter(Boolean);
}

async function getExistingPr(pi: ExtensionAPI): Promise<string | undefined> {
	const existingPr = await pi.exec("gh", ["pr", "view", "--json", "number,url", "--jq", '"#" + (.number|tostring) + " " + .url'], { timeout: 30_000 });
	return existingPr.code === 0 ? existingPr.stdout.trim() : undefined;
}

async function showPrReadiness(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const state = await getGitState(pi);
	if (!state.insideGit) {
		ctx.ui.notify("Not in a git repository", "error");
		return;
	}

	const [baseExists, stat, docsDrift] = await Promise.all([
		pi.exec("git", ["rev-parse", "--verify", "main"], { timeout: 5_000 }),
		pi.exec("git", ["diff", "--stat", "main...HEAD"], { timeout: 5_000 }),
		pi.exec("git", ["status", "--porcelain", "docs", "web"], { timeout: 5_000 }),
	]);

	if (baseExists.code !== 0) {
		ctx.ui.notify("Cannot find local main branch", "error");
		return;
	}

	const commitLines = await getCommitsAheadOfMain(pi);
	const lines = [
		`Branch: ${state.branch ?? "detached"}${state.isMain ? " ⚠ on main" : ""}`,
		`Worktree: ${state.dirtyCount === 0 ? "clean" : `${state.dirtyCount} changed file(s)`}`,
		`Commits ahead of main: ${commitLines.length}`,
		`Last checks: ${state.lastChecks}`,
		"",
		"Changed files:",
		stat.stdout.trim() || "No diff against main.",
		"",
		"Docs/web working-tree drift:",
		docsDrift.stdout.trim() || "none",
		"",
		"Suggested next steps:",
		state.isMain ? "- Create a feature branch with /dev branch before opening a PR." : "- Run /dev checks or /dev land before opening a PR.",
		"- Include tests/docs notes and call out any breaking changes in the PR body.",
	];

	await showInfo(ctx, "PR readiness", lines);
}

async function stageAllChanges(pi: ExtensionAPI, ctx: ExtensionContext): Promise<boolean> {
	const results = await runSteps(pi, ctx, "prepare /skill:commit", [{ label: "Stage all changes", command: "git", args: ["add", "-A"], timeout: 30_000 }]);
	return results.every((result) => result.status === "passed");
}

async function landBranch(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	setLastChecks: (status: DevState["lastChecks"]) => Promise<void>,
	options: { autoCommitDirtyWorktree?: boolean; onCommitQueued?: (branch: string) => void } = { autoCommitDirtyWorktree: true },
): Promise<void> {
	const initial = await getGitState(pi);
	if (!initial.insideGit) {
		ctx.ui.notify("Not in a git repository", "error");
		return;
	}
	if (!initial.branch) {
		ctx.ui.notify("Cannot land a detached HEAD", "error");
		return;
	}
	if (initial.isMain) {
		ctx.ui.notify("You are already on main. Create a feature branch before landing work.", "warning");
		return;
	}

	const mainExists = await pi.exec("git", ["rev-parse", "--verify", "main"], { timeout: 5_000 });
	if (mainExists.code !== 0) {
		ctx.ui.notify("Cannot find local main branch", "error");
		return;
	}

	if (initial.dirtyCount > 0) {
		if (!options.autoCommitDirtyWorktree) {
			ctx.ui.notify("Worktree is still dirty after /skill:commit. Resolve it and run /dev land again.", "error");
			return;
		}
		const staged = await stageAllChanges(pi, ctx);
		if (!staged) return;
		options.onCommitQueued?.(initial.branch);
		ctx.ui.notify("Staged changes and queued /skill:commit. /dev land will resume after the commit.", "info");
		pi.sendUserMessage(`/skill:commit\n\nAfter committing, do not push. The eforge-dev extension will continue landing branch ${initial.branch}.`);
		return;
	}

	const commitsAhead = await getCommitsAheadOfMain(pi);
	if (commitsAhead.length === 0) {
		ctx.ui.notify("No commits ahead of main to land", "warning");
		return;
	}

	const checkChoice = await ctx.ui.select("Checks before landing", CHECK_CHOICES);
	if (!checkChoice || checkChoice === CHECK_CHOICE.CANCEL) return;
	if (checkChoice === CHECK_CHOICE.RUN) {
		const checksPassed = await runChecks(pi, ctx, setLastChecks);
		if (!checksPassed) return;
	}

	const existingPrBeforePush = await getExistingPr(pi);
	const mode = await ctx.ui.select("Land branch", existingPrBeforePush ? EXISTING_PR_LAND_MODES : NEW_PR_LAND_MODES);
	if (!mode || mode === LAND_MODE.CANCEL) return;

	if (isPrLandMode(mode)) {
		const pushResults = await runSteps(pi, ctx, "push branch", [{ label: `Push ${initial.branch}`, command: "git", args: ["push", "-u", "origin", initial.branch], timeout: 60_000 }]);
		if (!pushResults.every((result) => result.status === "passed")) {
			ctx.ui.notify("Push failed; check the progress output", "error");
			return;
		}

		const existingPr = existingPrBeforePush ?? (await getExistingPr(pi));
		if (existingPr) {
			ctx.ui.notify(`Updated existing PR ${existingPr}`, "info");
		} else {
			const createResults = await runSteps(pi, ctx, "open PR", [{ label: "Create GitHub PR", command: "gh", args: ["pr", "create", "--fill"], timeout: 60_000 }]);
			if (!createResults.every((result) => result.status === "passed")) {
				ctx.ui.notify("PR creation failed; check the progress output", "error");
				return;
			}
		}

		if (isAutoMergeLandMode(mode)) {
			const mergeResults = await runSteps(pi, ctx, "enable PR auto-merge", [
				{ label: "Enable PR auto-merge", command: "gh", args: ["pr", "merge", "--auto", "--merge", "--delete-branch"], timeout: 60_000 },
			]);
			const ok = mergeResults.every((result) => result.status === "passed");
			ctx.ui.notify(ok ? "PR auto-merge enabled" : "Auto-merge failed; check the progress output", ok ? "info" : "error");
			return;
		}

		ctx.ui.notify(existingPr ? "Existing PR is up to date" : "PR created", "info");
		return;
	}

	const confirmed = await ctx.ui.confirm("Local merge", `Fast-forward merge ${initial.branch} into local main?`);
	if (!confirmed) return;

	const mergeResults = await runSteps(pi, ctx, "land branch locally", [
		{ label: "Checkout main", command: "git", args: ["checkout", "main"], timeout: 30_000 },
		{ label: "Update main", command: "git", args: ["pull", "--ff-only"], timeout: 60_000 },
		{ label: `Fast-forward merge ${initial.branch}`, command: "git", args: ["merge", "--ff-only", initial.branch], timeout: 60_000 },
	]);
	const merged = mergeResults.every((result) => result.status === "passed");
	if (!merged) {
		ctx.ui.notify("Local landing failed. Rebase/update the branch, then try again.", "error");
		return;
	}

	const pushMain = await ctx.ui.confirm("Push main", "Push local main to origin now?");
	if (!pushMain) {
		ctx.ui.notify("Branch landed locally on main. Push when ready with: git push origin main", "info");
		return;
	}

	const pushResults = await runSteps(pi, ctx, "push main", [{ label: "Push main", command: "git", args: ["push", "origin", "main"], timeout: 60_000 }]);
	const pushed = pushResults.every((result) => result.status === "passed");
	ctx.ui.notify(pushed ? "main pushed" : "Push failed", pushed ? "info" : "error");
}

async function restartDaemon(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const ok = await ctx.ui.confirm("Restart eforge daemon", "Run pnpm build and restart the local eforge daemon?");
	if (!ok) return;

	const steps: Step[] = [
		{ label: "Build workspace", command: "pnpm", args: ["build"], timeout: 120_000 },
		{ label: "Stop daemon", command: "eforge", args: ["daemon", "stop"], timeout: 30_000 },
		{ label: "Start daemon", command: "eforge", args: ["daemon", "start"], timeout: 30_000 },
	];
	const results = await runSteps(pi, ctx, "rebuild + restart daemon", steps);
	const okResults = results.every((result) => result.status === "passed");
	ctx.ui.notify(okResults ? "Daemon restarted" : "Daemon restart failed", okResults ? "info" : "error");
}

async function readPackageVersion(cwd: string): Promise<string | undefined> {
	try {
		const raw = await readFile(join(cwd, "packages", "eforge", "package.json"), "utf8");
		return JSON.parse(raw).version as string | undefined;
	} catch {
		return undefined;
	}
}

function bumpVersionString(version: string, bump: ReleaseBumpType): string | undefined {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
	if (!match) return undefined;
	const major = Number(match[1]);
	const minor = Number(match[2]);
	const patch = Number(match[3]);
	switch (bump) {
		case "major":
			return `${major + 1}.0.0`;
		case "minor":
			return `${major}.${minor + 1}.0`;
		case "patch":
			return `${major}.${minor}.${patch + 1}`;
	}
}

function normalizeReleaseVersion(input: string | undefined): { version: string; tag: string } | undefined {
	const raw = input?.trim().split(/\s+/)[0]?.trim() ?? "";
	const version = raw.replace(/^v/, "");
	if (!/^\d+\.\d+\.\d+$/.test(version)) return undefined;
	return { version, tag: `v${version}` };
}

function releaseSectionTitle(type: string): string {
	switch (type) {
		case "feat": return "Features";
		case "fix": return "Bug Fixes";
		case "refactor": return "Refactoring";
		case "perf": return "Performance";
		case "docs": return "Documentation";
		case "chore":
		case "ci":
		case "build":
		case "test": return "Maintenance";
		default: return "Other";
	}
}

function normalizeReleaseScope(scope: string | undefined): string | undefined {
	if (!scope) return "core";
	const cleaned = scope.replace(/^(plan-\d+-|hardening-\d+-)/, "");
	if (["engine", "client", "monitor", "monitor-ui", "eforge", "pi-eforge", "plugin", "mcp", "backends", "queue"].includes(cleaned)) return cleaned;
	if (cleaned === "deps" || cleaned === "dependencies") return "deps";
	if (cleaned === "cleanup") return undefined;
	if (cleaned === "revert" || cleaned.startsWith("revert-") || cleaned === "gap-close") return "core";
	return cleaned;
}

async function generateReleaseNotes(pi: ExtensionAPI): Promise<string> {
	const previousTag = await pi.exec("git", ["describe", "--tags", "--abbrev=0"], { timeout: 5_000 });
	let fromRef = previousTag.stdout.trim();
	if (previousTag.code !== 0 || !fromRef) {
		const root = await pi.exec("git", ["rev-list", "--max-parents=0", "HEAD"], { timeout: 5_000 });
		fromRef = root.stdout.trim().split("\n")[0] ?? "HEAD";
	}

	const log = await pi.exec("git", ["log", `${fromRef}..HEAD`, "--oneline"], { timeout: 10_000 });
	const sections = new Map<string, Array<{ scope: string; description: string }>>();
	const seenDescriptions = new Set<string>();

	for (const line of log.stdout.split("\n").map((l) => l.trim()).filter(Boolean)) {
		const message = line.replace(/^[0-9a-f]+\s+/, "");
		if (/^\d+\.\d+\.\d+$/.test(message)) continue;
		if (/enqueue\(|cleanup\(|plan\(|^Merge\s|bump plugin version/i.test(message)) continue;

		const conventional = /^(\w+)(?:\(([^)]+)\))?!?:\s+(.+)$/.exec(message);
		const type = conventional?.[1] ?? "other";
		const scope = normalizeReleaseScope(conventional?.[2]);
		if (!scope) continue;
		const description = (conventional?.[3] ?? message).trim();
		if (!description || seenDescriptions.has(description)) continue;
		seenDescriptions.add(description);

		const section = releaseSectionTitle(type);
		const entries = sections.get(section) ?? [];
		entries.push({ scope, description });
		sections.set(section, entries);
	}

	const order = ["Features", "Bug Fixes", "Refactoring", "Performance", "Documentation", "Maintenance", "Other"];
	const out: string[] = [];
	for (const section of order) {
		const entries = sections.get(section);
		if (!entries?.length) continue;
		entries.sort((a, b) => a.scope.localeCompare(b.scope) || a.description.localeCompare(b.description));
		out.push(`### ${section}`, "", ...entries.map((entry) => `- **${entry.scope}**: ${entry.description}`), "");
	}
	return out.join("\n").trim() || "Maintenance release";
}

async function updateChangelogAndCommit(pi: ExtensionAPI, ctx: ExtensionContext, version: string, releaseNotes: string): Promise<boolean> {
	const changelogPath = join(ctx.cwd, "CHANGELOG.md");
	let changelog: string;
	try {
		changelog = await readFile(changelogPath, "utf8");
	} catch {
		changelog = "# Changelog\n";
	}

	if (!changelog.startsWith("# Changelog")) changelog = `# Changelog\n\n${changelog.trim()}\n`;
	const today = new Date().toISOString().slice(0, 10);
	const entry = `## [${version}] - ${today}\n\n${releaseNotes.trim()}\n\n`;
	const withoutDuplicate = changelog.replace(new RegExp(`\\n?## \\[${version.replace(/\./g, "\\.")}\\][\\s\\S]*?(?=\\n## \\[|$)`), "\n");
	let next = withoutDuplicate.replace(/^# Changelog\s*\n*/, `# Changelog\n\n${entry}`);

	const parts = next.split(/(?=^## \[)/m);
	if (parts.length > 21) {
		next = parts.slice(0, 21).join("").trimEnd() + "\n\n---\nFor older releases, see [GitHub Releases](https://github.com/eforge-build/eforge/releases).\n";
	}

	await writeFile(changelogPath, next, "utf8");
	const results = await runSteps(pi, ctx, `commit changelog for v${version}`, [
		{ label: "Stage CHANGELOG.md", command: "git", args: ["add", "CHANGELOG.md"], timeout: 30_000 },
		{ label: "Commit changelog", command: "git", args: ["commit", "-m", `docs: update CHANGELOG.md for v${version}`], timeout: 30_000 },
	]);
	return results.every((result) => result.status === "passed");
}

async function readChangelogReleaseNotes(cwd: string, version: string): Promise<string | undefined> {
	try {
		const changelog = await readFile(join(cwd, "CHANGELOG.md"), "utf8");
		const escaped = version.replace(/\./g, "\\.");
		const match = new RegExp(`^## \\[${escaped}\\][^\n]*\n\n([\\s\\S]*?)(?=\n## \\[|\n---|$)`, "m").exec(changelog);
		return match?.[1]?.trim();
	} catch {
		return undefined;
	}
}

async function waitForReleasePrMerge(pi: ExtensionAPI, ctx: ExtensionContext, branch: string, tag: string): Promise<boolean> {
	const wait = await ctx.ui.confirm("Wait for auto-merge", `Auto-merge is enabled for ${branch}. Wait for CI/merge now, then tag ${tag}?`);
	if (!wait) {
		ctx.ui.notify(`Release PR is open. After it merges, run: /dev release-finalize ${tag}`, "info");
		return false;
	}

	const waitResults = await runSteps(pi, ctx, `wait for ${tag} PR merge`, [
		{
			label: "Wait for PR to merge",
			command: "bash",
			args: [
				"-lc",
				'for i in {1..120}; do state=$(gh pr view "$1" --json state --jq .state 2>/dev/null || echo UNKNOWN); if [ "$state" = MERGED ]; then exit 0; fi; if [ "$state" = CLOSED ]; then exit 2; fi; sleep 30; done; exit 1',
				"bash",
				branch,
			],
			timeout: 3_700_000,
		},
	]);
	const merged = waitResults.every((result) => result.status === "passed");
	if (!merged) ctx.ui.notify(`PR did not merge while waiting. After it merges, run: /dev release-finalize ${tag}`, "warning");
	return merged;
}

async function finalizeRelease(pi: ExtensionAPI, ctx: ExtensionContext, versionArg?: string): Promise<void> {
	const release = normalizeReleaseVersion(versionArg);
	if (!release) {
		ctx.ui.notify("Usage: /dev release-finalize vX.Y.Z", "error");
		return;
	}

	const prepResults = await runSteps(pi, ctx, `finalize ${release.tag}`, [
		{ label: "Fetch main + tags", command: "git", args: ["fetch", "origin", "main", "--tags"], timeout: 60_000 },
		{ label: "Checkout main", command: "git", args: ["checkout", "main"], timeout: 30_000 },
		{ label: "Pull main", command: "git", args: ["pull", "--ff-only", "origin", "main"], timeout: 60_000 },
	]);
	if (!prepResults.every((result) => result.status === "passed")) return;

	const mergedVersion = await readPackageVersion(ctx.cwd);
	if (mergedVersion !== release.version) {
		ctx.ui.notify(`main is at version ${mergedVersion ?? "unknown"}, not ${release.version}. Is the release PR merged?`, "error");
		return;
	}

	const remoteTag = await pi.exec("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${release.tag}`], { timeout: 10_000 });
	const tagAlreadyOnOrigin = remoteTag.code === 0;

	const head = (await pi.exec("git", ["rev-parse", "HEAD"], { timeout: 5_000 })).stdout.trim();
	const localTag = await pi.exec("git", ["rev-parse", "--verify", `refs/tags/${release.tag}`], { timeout: 5_000 });
	if (localTag.code === 0) {
		const taggedCommit = (await pi.exec("git", ["rev-list", "-n", "1", release.tag], { timeout: 5_000 })).stdout.trim();
		if (taggedCommit !== head) {
			ctx.ui.notify(`${release.tag} exists locally but does not point at current main`, "error");
			return;
		}
	} else if (!tagAlreadyOnOrigin) {
		const tagResult = await runSteps(pi, ctx, `tag ${release.tag}`, [
			{ label: `Create ${release.tag}`, command: "git", args: ["tag", "-a", release.tag, "-m", release.tag], timeout: 30_000 },
		]);
		if (!tagResult.every((result) => result.status === "passed")) return;
	}

	if (!tagAlreadyOnOrigin) {
		const pushResult = await runSteps(pi, ctx, `push ${release.tag}`, [
			{ label: `Push ${release.tag}`, command: "git", args: ["push", "origin", `refs/tags/${release.tag}`], timeout: 60_000 },
		]);
		const pushed = pushResult.every((result) => result.status === "passed");
		if (!pushed) {
			ctx.ui.notify(`Failed to push ${release.tag}`, "error");
			return;
		}
	}

	const existingRelease = await pi.exec("gh", ["release", "view", release.tag, "--json", "url", "--jq", ".url"], { timeout: 30_000 });
	if (existingRelease.code === 0) {
		ctx.ui.notify(`${release.tag} already has a GitHub Release: ${existingRelease.stdout.trim()}`, "info");
		return;
	}

	const releaseNotes = await readChangelogReleaseNotes(ctx.cwd, release.version) ?? "Maintenance release";
	const releaseResult = await runSteps(pi, ctx, `create GitHub Release ${release.tag}`, [
		{ label: "Create GitHub Release", command: "gh", args: ["release", "create", release.tag, "--title", release.tag, "--notes", releaseNotes], timeout: 60_000 },
	]);
	const releaseCreated = releaseResult.every((result) => result.status === "passed");
	ctx.ui.notify(
		releaseCreated ? `${release.tag} pushed and GitHub Release created; npm publish workflow should start` : `${release.tag} pushed, but GitHub Release creation failed`,
		releaseCreated ? "info" : "error",
	);
}

async function releaseWizard(pi: ExtensionAPI, ctx: ExtensionContext, setLastChecks: (status: DevState["lastChecks"]) => Promise<void>): Promise<void> {
	const state = await getGitState(pi);
	if (!state.insideGit) {
		ctx.ui.notify("Not in a git repository", "error");
		return;
	}
	if (!state.isMain) {
		ctx.ui.notify("Start releases from a clean, up-to-date main checkout", "error");
		return;
	}
	if (state.dirtyCount > 0) {
		ctx.ui.notify("Release requires a clean working tree", "error");
		return;
	}

	const initialSyncResults = await runSteps(pi, ctx, "sync main for release", [
		{ label: "Fetch main + tags", command: "git", args: ["fetch", "origin", "main", "--tags"], timeout: 60_000 },
		{ label: "Update local main", command: "git", args: ["pull", "--ff-only", "origin", "main"], timeout: 60_000 },
	]);
	if (!initialSyncResults.every((result) => result.status === "passed")) return;

	const currentVersion = await readPackageVersion(ctx.cwd);
	if (!currentVersion) {
		ctx.ui.notify("Could not read packages/eforge/package.json version", "error");
		return;
	}

	const bump = await ctx.ui.select("Version bump", [...RELEASE_BUMP_TYPES]);
	if (!bump) return;
	const nextVersion = bumpVersionString(currentVersion, bump as ReleaseBumpType);
	if (!nextVersion) {
		ctx.ui.notify(`Unsupported current version: ${currentVersion}`, "error");
		return;
	}

	const tag = `v${nextVersion}`;
	const releaseBranch = `release/${tag}`;
	const existingTag = await pi.exec("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`], { timeout: 10_000 });
	if (existingTag.code === 0) {
		ctx.ui.notify(`${tag} already exists on origin`, "error");
		return;
	}
	const existingBranch = await pi.exec("git", ["ls-remote", "--exit-code", "--heads", "origin", releaseBranch], { timeout: 10_000 });
	if (existingBranch.code === 0) {
		ctx.ui.notify(`${releaseBranch} already exists on origin`, "error");
		return;
	}

	const checksOk = await ctx.ui.confirm("Release checks", `Run the full release check suite before opening ${releaseBranch}?`);
	if (!checksOk) return;
	const passed = await runChecks(pi, ctx, setLastChecks);
	if (!passed) return;

	const updateResults = await runSteps(pi, ctx, `update main before ${releaseBranch}`, [
		{ label: "Fetch main + tags", command: "git", args: ["fetch", "origin", "main", "--tags"], timeout: 60_000 },
		{ label: "Update local main", command: "git", args: ["pull", "--ff-only", "origin", "main"], timeout: 60_000 },
	]);
	if (!updateResults.every((result) => result.status === "passed")) return;

	const latestVersion = await readPackageVersion(ctx.cwd);
	if (latestVersion !== currentVersion) {
		ctx.ui.notify(`main version changed from ${currentVersion} to ${latestVersion ?? "unknown"}; restart the release wizard`, "error");
		return;
	}

	const prepResults = await runSteps(pi, ctx, `prepare ${releaseBranch}`, [
		{ label: `Create ${releaseBranch}`, command: "git", args: ["checkout", "-b", releaseBranch], timeout: 30_000 },
	]);
	if (!prepResults.every((result) => result.status === "passed")) return;

	const releaseNotes = await generateReleaseNotes(pi);
	const changelogCommitted = await updateChangelogAndCommit(pi, ctx, nextVersion, releaseNotes);
	if (!changelogCommitted) return;

	const bumpResult = await runSteps(pi, ctx, `pnpm release ${bump} --no-tag`, [
		{ label: `Bump ${bump}`, command: "pnpm", args: ["release", bump, "--no-tag"], timeout: 30_000 },
	]);
	if (!bumpResult.every((result) => result.status === "passed")) return;

	const bumpedVersion = await readPackageVersion(ctx.cwd);
	if (bumpedVersion !== nextVersion) {
		ctx.ui.notify(`Expected version ${nextVersion}, found ${bumpedVersion ?? "unknown"}`, "error");
		return;
	}

	const localTag = await pi.exec("git", ["rev-parse", "--verify", `refs/tags/${tag}`], { timeout: 5_000 });
	if (localTag.code === 0) {
		ctx.ui.notify(`${tag} was created locally even though release used --no-tag; aborting before push`, "error");
		return;
	}

	const openPrResults = await runSteps(pi, ctx, `open ${tag} release PR`, [
		{ label: `Push ${releaseBranch}`, command: "git", args: ["push", "-u", "origin", releaseBranch], timeout: 60_000 },
		{ label: "Create release PR", command: "gh", args: ["pr", "create", "--base", "main", "--head", releaseBranch, "--title", `release: ${tag}`, "--body", `Release ${tag}\n\n${releaseNotes}`], timeout: 60_000 },
		{ label: "Enable PR auto-merge", command: "gh", args: ["pr", "merge", releaseBranch, "--auto", "--merge", "--delete-branch"], timeout: 60_000 },
	]);
	if (!openPrResults.every((result) => result.status === "passed")) {
		ctx.ui.notify(`Release branch ${releaseBranch} is prepared, but PR setup failed`, "error");
		return;
	}

	ctx.ui.notify(`${tag} release PR opened with auto-merge. The npm publish tag will be created only after main contains the bump.`, "info");
	if (await waitForReleasePrMerge(pi, ctx, releaseBranch, tag)) {
		await finalizeRelease(pi, ctx, tag);
	}
}

async function prefillEforgePlan(ctx: ExtensionContext): Promise<void> {
	ctx.ui.setEditorText("/eforge:plan ");
	ctx.ui.notify("Prefilled /eforge:plan. Add the topic and press Enter.", "info");
}

async function showCockpit(pi: ExtensionAPI, ctx: ExtensionContext, state: DevState): Promise<string | null> {
	const items: SelectItem[] = [
		{ value: DEV_ACTION.BRANCH, label: "Create/switch feature branch", description: "Keep main releasable before eforge work" },
		{ value: DEV_ACTION.PLAN, label: "Prefill /eforge:plan", description: "Start the published pi-eforge planning flow" },
		{ value: DEV_ACTION.CHECKS, label: "Run checks", description: "build, type-check, test, docs:check, docs:build" },
		{ value: DEV_ACTION.PR, label: "Show PR readiness", description: "Branch, diff, docs drift, and next steps" },
		{ value: DEV_ACTION.LAND, label: "Land current branch", description: "Commit, check, and open a PR or fast-forward merge" },
		{ value: DEV_ACTION.RESTART, label: "Rebuild + restart daemon", description: "Use after local engine/CLI changes" },
		{ value: DEV_ACTION.RELEASE, label: "Release wizard", description: "Open PR, auto-merge, then tag merged main" },
		{ value: DEV_ACTION.RELEASE_FINALIZE, label: "Finalize release tag", description: "After release PR merge: tag main and push only the tag" },
		{ value: DEV_ACTION.REFRESH, label: "Refresh status", description: "Update footer/widget state" },
	];

	return ctx.ui.custom<string | null>(
		(tui, theme, _kb, done) => {
			const stateLines = renderStateLines(state, theme);
			const selectListRowBudget = () => Math.max(1, borderedLineBudget(tui) - 2 - (5 + stateLines.length));
			const initialSelectRows = selectListRowBudget();
			let visibleCount = Math.min(items.length, initialSelectRows, MAX_COCKPIT_VISIBLE);
			if (items.length > visibleCount && initialSelectRows > 1) visibleCount = Math.min(visibleCount, initialSelectRows - 1);
			const selectList = new SelectList(items, clamp(visibleCount, 1, MAX_COCKPIT_VISIBLE), {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			});
			selectList.onSelect = (item) => done(item.value);
			selectList.onCancel = () => done(null);

			const container = {
				render(width: number) {
					const innerWidth = Math.max(1, width - 2);
					const lines: string[] = [];
					lines.push(truncateToWidth(theme.fg("accent", theme.bold("eforge dev cockpit")), innerWidth, "", true));
					lines.push("");
					for (const line of stateLines) lines.push(truncateToWidth(line, innerWidth, "", true));
					lines.push("");
					lines.push(...selectList.render(innerWidth).slice(0, selectListRowBudget()));
					lines.push("");
					lines.push(theme.fg("dim", "↑↓ navigate • enter select • esc cancel"));
					return renderBorderedLines(lines, width, (s: string) => theme.fg("accent", s), borderedLineBudget(tui));
				},
				invalidate() {
					selectList.invalidate();
				},
				handleInput(data: string) {
					selectList.handleInput(data);
					tui.requestRender();
				},
			};

			return container;
		},
	);
}

export default function eforgeDevExtension(pi: ExtensionAPI) {
	let state: DevState | undefined;
	let pendingLandAfterCommit: { branch: string } | undefined;

	async function refresh(ctx: ExtensionContext): Promise<void> {
		state = await updateDevUi(pi, ctx, state);
	}

	async function setLastChecks(status: DevState["lastChecks"]): Promise<void> {
		if (state) state = { ...state, lastChecks: status };
	}

	pi.registerCommand("dev", {
		description: "Open the eforge maintainer cockpit",
		getArgumentCompletions: (prefix: string) => {
			return DEV_ACTIONS.filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
		},
		handler: async (args, ctx) => {
			await refresh(ctx);
			const [subcommand, ...rest] = (args ?? "").trim().split(/\s+/).filter(Boolean);

			switch (subcommand) {
				case DEV_ACTION.BRANCH:
					await createBranch(pi, ctx, rest.join(" "));
					await refresh(ctx);
					return;
				case DEV_ACTION.CHECKS:
					await runChecks(pi, ctx, setLastChecks);
					await refresh(ctx);
					return;
				case DEV_ACTION.PR:
					await showPrReadiness(pi, ctx);
					return;
				case DEV_ACTION.LAND:
					await landBranch(pi, ctx, setLastChecks, {
						autoCommitDirtyWorktree: true,
						onCommitQueued: (branch) => {
							pendingLandAfterCommit = { branch };
						},
					});
					await refresh(ctx);
					return;
				case DEV_ACTION.RELEASE:
					await releaseWizard(pi, ctx, setLastChecks);
					await refresh(ctx);
					return;
				case DEV_ACTION.RELEASE_FINALIZE:
					await finalizeRelease(pi, ctx, rest.join(" "));
					await refresh(ctx);
					return;
				case DEV_ACTION.RESTART:
					await restartDaemon(pi, ctx);
					return;
				case DEV_ACTION.PLAN:
					await prefillEforgePlan(ctx);
					return;
				case DEV_ACTION.REFRESH:
					ctx.ui.notify("eforge-dev status refreshed", "info");
					return;
				case undefined: {
					const action = await showCockpit(pi, ctx, state!);
					if (action) await pi.sendUserMessage(`/dev ${action}`);
					return;
				}
				default:
					ctx.ui.notify(`Unknown /dev action: ${subcommand}`, "error");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		await refresh(ctx);
	});

	pi.on("turn_end", async (_event, ctx) => {
		await refresh(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (!pendingLandAfterCommit) return;
		const pending = pendingLandAfterCommit;
		pendingLandAfterCommit = undefined;

		const current = await getGitState(pi);
		if (current.branch !== pending.branch) {
			ctx.ui.notify(`Not resuming /dev land: branch changed from ${pending.branch} to ${current.branch ?? "detached"}`, "warning");
			return;
		}
		if (current.dirtyCount > 0) {
			ctx.ui.notify("/skill:commit finished but the worktree is still dirty. Resolve it and run /dev land again.", "error");
			return;
		}

		await landBranch(pi, ctx, setLastChecks, { autoCommitDirtyWorktree: false });
		await refresh(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!state) await refresh(ctx);
		if (!state?.isMain) return;

		return {
			systemPrompt: `${event.systemPrompt}\n\nProject-local eforge-dev policy: the current git branch is main. main should remain releasable. Before making tracked non-release code changes or starting eforge implementation work, ask the user to create a short-lived feature branch with /dev branch. Gitignored project-local eforge runtime/planning state under .eforge/ is exempt and may be updated on main.`,
		};
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!state) await refresh(ctx);
		if (!state?.isMain) return;

		const mutationTools = new Set(["edit", "write"]);
		if (mutationTools.has(event.toolName)) {
			const mutationPath = getMutationPath(event.input);
			if (mutationPath && isProjectLocalEforgePath(ctx.cwd, mutationPath)) return;

			if (!ctx.hasUI) return { block: true, reason: "eforge-dev blocks tracked file mutation on main" };
			const ok = await ctx.ui.confirm("Mutation on main", `${event.toolName} would modify files while on main. Allow once?`);
			if (!ok) return { block: true, reason: "Blocked by eforge-dev branch policy" };
		}

		if (event.toolName === "bash") {
			const command = typeof event.input?.command === "string" ? event.input.command : "";
			const guarded = ["git commit", "git tag", "git push", "pnpm release", "eforge build", "pnpm publish", "npm publish"].some((needle) => command.includes(needle));
			if (!guarded) return;
			if (!ctx.hasUI) return { block: true, reason: "eforge-dev blocks guarded bash command on main" };
			const ok = await ctx.ui.confirm("Guarded command on main", `Allow this command on main?\n\n${command}`);
			if (!ok) return { block: true, reason: "Blocked by eforge-dev branch policy" };
		}
	});
}
