import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
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
	constructor(
		private title: string,
		private lines: string[],
		private theme: any,
		private done: () => void,
	) {}

	render(width: number): string[] {
		const innerWidth = Math.max(20, width - 2);
		const out: string[] = [];
		out.push(this.theme.fg("accent", "─".repeat(Math.min(width, 80))));
		out.push(truncateToWidth(this.theme.fg("accent", this.theme.bold(this.title)), width));
		out.push("");
		for (const line of this.lines) {
			out.push(...wrapTextWithAnsi(line, innerWidth).map((wrapped) => truncateToWidth(wrapped, width)));
		}
		out.push("");
		out.push(this.theme.fg("dim", "esc/enter close"));
		out.push(this.theme.fg("accent", "─".repeat(Math.min(width, 80))));
		return out;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) this.done();
	}

	invalidate(): void {}
}

async function showInfo(ctx: ExtensionContext, title: string, lines: string[]): Promise<void> {
	await ctx.ui.custom<void>(
		(_tui, theme, _kb, done) => new InfoPanel(title, lines, theme, done),
		{ overlay: true, overlayOptions: { width: "75%", minWidth: 60, maxHeight: "80%", margin: 2 } },
	);
}

class ProgressPanel {
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		private title: string,
		private results: StepResult[],
		private theme: any,
		private abort: () => void,
	) {}

	setResults(results: StepResult[]): void {
		this.results = results;
		this.invalidate();
	}

	render(width: number): string[] {
		if (this.cachedWidth === width && this.cachedLines) return this.cachedLines;

		const lines: string[] = [];
		lines.push(this.theme.fg("accent", "─".repeat(Math.min(width, 90))));
		lines.push(truncateToWidth(this.theme.fg("accent", this.theme.bold(this.title)), width));
		lines.push("");

		for (const result of this.results) {
			const color = result.status === "passed" ? "success" : result.status === "failed" ? "error" : result.status === "running" ? "accent" : "muted";
			const duration = formatDuration(result.durationMs);
			lines.push(truncateToWidth(`${this.theme.fg(color, statusIcon(result.status))} ${result.label}${duration ? ` ${this.theme.fg("dim", duration)}` : ""}`, width));
			if (result.status === "failed") {
				const detail = oneLine(result.stderr) || oneLine(result.stdout) || `exit ${result.code ?? "unknown"}`;
				lines.push(truncateToWidth(`  ${this.theme.fg("error", detail)}`, width));
			}
		}

		lines.push("");
		lines.push(this.theme.fg("dim", "esc cancel"));
		lines.push(this.theme.fg("accent", "─".repeat(Math.min(width, 90))));
		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) this.abort();
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

async function runSteps(pi: ExtensionAPI, ctx: ExtensionContext, title: string, steps: Step[]): Promise<StepResult[]> {
	const initial: StepResult[] = steps.map((step) => ({ ...step, status: "pending" }));
	const controller = new AbortController();

	const results = await ctx.ui.custom<StepResult[]>(
		(tui, theme, _kb, done) => {
			let panelResults = [...initial];
			const panel = new ProgressPanel(title, panelResults, theme, () => controller.abort());

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
		{ overlay: true, overlayOptions: { width: "82%", minWidth: 70, maxHeight: "80%", margin: 2 } },
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

async function showPrReadiness(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const state = await getGitState(pi);
	if (!state.insideGit) {
		ctx.ui.notify("Not in a git repository", "error");
		return;
	}

	const [baseExists, commits, stat, docsDrift] = await Promise.all([
		pi.exec("git", ["rev-parse", "--verify", "main"], { timeout: 5_000 }),
		pi.exec("git", ["log", "--oneline", "main..HEAD"], { timeout: 5_000 }),
		pi.exec("git", ["diff", "--stat", "main...HEAD"], { timeout: 5_000 }),
		pi.exec("git", ["status", "--porcelain", "docs", "web"], { timeout: 5_000 }),
	]);

	if (baseExists.code !== 0) {
		ctx.ui.notify("Cannot find local main branch", "error");
		return;
	}

	const commitLines = commits.stdout.trim().split("\n").filter(Boolean);
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
		state.isMain ? "- Create a feature branch with /dev branch before opening a PR." : "- Run /dev checks before opening a PR.",
		"- Include tests/docs notes and call out any breaking changes in the PR body.",
	];

	await showInfo(ctx, "PR readiness", lines);
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

async function releaseWizard(pi: ExtensionAPI, ctx: ExtensionContext, setLastChecks: (status: DevState["lastChecks"]) => Promise<void>): Promise<void> {
	const state = await getGitState(pi);
	if (!state.insideGit) {
		ctx.ui.notify("Not in a git repository", "error");
		return;
	}
	if (!state.isMain) {
		ctx.ui.notify("Releases must be cut from main", "error");
		return;
	}
	if (state.dirtyCount > 0) {
		ctx.ui.notify("Release requires a clean working tree", "error");
		return;
	}

	const checksOk = await ctx.ui.confirm("Release checks", "Run the full release check suite before bumping?");
	if (!checksOk) return;
	const passed = await runChecks(pi, ctx, setLastChecks);
	if (!passed) return;

	const bump = await ctx.ui.select("Version bump", ["patch", "minor", "major"]);
	if (!bump) return;

	const bumpResult = await runSteps(pi, ctx, `pnpm release ${bump}`, [{ label: `Bump ${bump}`, command: "pnpm", args: ["release", bump], timeout: 30_000 }]);
	if (!bumpResult.every((result) => result.status === "passed")) return;

	const version = await readPackageVersion(ctx.cwd);
	const tag = version ? `v${version}` : "new tag";
	const tagCheck = version ? await pi.exec("git", ["rev-parse", "--verify", tag], { timeout: 5_000 }) : undefined;
	if (tagCheck && tagCheck.code !== 0) {
		ctx.ui.notify(`Expected tag ${tag} was not created`, "error");
		return;
	}

	const push = await ctx.ui.confirm("Push release", `Created ${tag}. Push main and tags to trigger npm publish?`);
	if (!push) {
		ctx.ui.notify(`Release bump created locally. Push with: git push origin HEAD --follow-tags`, "warning");
		return;
	}

	const pushResult = await runSteps(pi, ctx, "push release", [{ label: "Push main + tags", command: "git", args: ["push", "origin", "HEAD", "--follow-tags"], timeout: 60_000 }]);
	const ok = pushResult.every((result) => result.status === "passed");
	ctx.ui.notify(ok ? `${tag} pushed; npm publish workflow should start` : "Push failed", ok ? "info" : "error");
}

async function prefillEforgePlan(ctx: ExtensionContext): Promise<void> {
	ctx.ui.setEditorText("/eforge:plan ");
	ctx.ui.notify("Prefilled /eforge:plan. Add the topic and press Enter.", "info");
}

async function showCockpit(pi: ExtensionAPI, ctx: ExtensionContext, state: DevState): Promise<string | null> {
	const items: SelectItem[] = [
		{ value: "branch", label: "Create/switch feature branch", description: "Keep main releasable before eforge work" },
		{ value: "plan", label: "Prefill /eforge:plan", description: "Start the published pi-eforge planning flow" },
		{ value: "checks", label: "Run checks", description: "build, type-check, test, docs:check, docs:build" },
		{ value: "pr", label: "Show PR readiness", description: "Branch, diff, docs drift, and next steps" },
		{ value: "restart", label: "Rebuild + restart daemon", description: "Use after local engine/CLI changes" },
		{ value: "release", label: "Release wizard", description: "Main-only checks, version bump, tag, optional push" },
		{ value: "refresh", label: "Refresh status", description: "Update footer/widget state" },
	];

	return ctx.ui.custom<string | null>(
		(tui, theme, _kb, done) => {
			const selectList = new SelectList(items, Math.min(items.length, 10), {
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
					const lines: string[] = [];
					const border = new DynamicBorder((s: string) => theme.fg("accent", s));
					lines.push(...border.render(width));
					lines.push(truncateToWidth(theme.fg("accent", theme.bold("eforge dev cockpit")), width));
					lines.push("");
					for (const line of renderStateLines(state, theme)) lines.push(truncateToWidth(line, width));
					lines.push("");
					lines.push(...selectList.render(width));
					lines.push("");
					lines.push(theme.fg("dim", "↑↓ navigate • enter select • esc cancel"));
					lines.push(...border.render(width));
					return lines;
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
		{ overlay: true, overlayOptions: { width: "78%", minWidth: 68, maxHeight: "85%", margin: 2 } },
	);
}

export default function eforgeDevExtension(pi: ExtensionAPI) {
	let state: DevState | undefined;

	async function refresh(ctx: ExtensionContext): Promise<void> {
		state = await updateDevUi(pi, ctx, state);
	}

	async function setLastChecks(status: DevState["lastChecks"]): Promise<void> {
		if (state) state = { ...state, lastChecks: status };
	}

	pi.registerCommand("dev", {
		description: "Open the eforge maintainer cockpit",
		getArgumentCompletions: (prefix: string) => {
			const values = ["branch", "checks", "pr", "release", "restart", "plan", "refresh"];
			return values.filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
		},
		handler: async (args, ctx) => {
			await refresh(ctx);
			const [subcommand, ...rest] = (args ?? "").trim().split(/\s+/).filter(Boolean);

			switch (subcommand) {
				case "branch":
					await createBranch(pi, ctx, rest.join(" "));
					await refresh(ctx);
					return;
				case "checks":
					await runChecks(pi, ctx, setLastChecks);
					await refresh(ctx);
					return;
				case "pr":
					await showPrReadiness(pi, ctx);
					return;
				case "release":
					await releaseWizard(pi, ctx, setLastChecks);
					await refresh(ctx);
					return;
				case "restart":
					await restartDaemon(pi, ctx);
					return;
				case "plan":
					await prefillEforgePlan(ctx);
					return;
				case "refresh":
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

	pi.on("before_agent_start", async (event, ctx) => {
		if (!state) await refresh(ctx);
		if (!state?.isMain) return;

		return {
			systemPrompt: `${event.systemPrompt}\n\nProject-local eforge-dev policy: the current git branch is main. main should remain releasable. Before making non-release code changes or starting eforge implementation work, ask the user to create a short-lived feature branch with /dev branch.`,
		};
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!state) await refresh(ctx);
		if (!state?.isMain) return;

		const mutationTools = new Set(["edit", "write"]);
		if (mutationTools.has(event.toolName)) {
			if (!ctx.hasUI) return { block: true, reason: "eforge-dev blocks file mutation on main" };
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
