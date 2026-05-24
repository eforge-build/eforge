---
id: plan-01-reviewer-isolation
name: Reviewer Isolation and Read-Only Harness Tools
branch: fix-reviewer-isolation-across-pi-and-claude-sdk-harnesses/plan-01-reviewer-isolation
agents:
  builder:
    effort: high
    rationale: The change crosses shared harness contracts, Pi and Claude SDK tool
      composition, reviewer/evaluator call sites, prompt contracts, and
      review-stage worktree invariants.
  reviewer:
    effort: high
    rationale: Tool isolation is a safety boundary involving subprocess and mutation
      permissions across both harnesses.
  tester:
    effort: high
    rationale: Regression coverage must prove tool composition and worktree
      restoration across multiple reviewer paths.
---

# Reviewer Isolation and Read-Only Harness Tools

## Architecture Context

Reviewer agents are intended to be non-mutating blind sensors. The current engine violates that boundary by launching build reviewers with `tools: 'coding'`, and several perspective prompts even instruct reviewers to write fixes. The fix must make read-only review a harness-level capability rather than relying on prompt obedience.

This plan keeps mutation with `review-fixer`, keeps acceptance with `evaluator`, and blocks reviewer mutations in both Pi and Claude SDK harnesses. It also adds a review-stage invariant so any unexpected mutation is discarded before review-fixer/evaluator stages can treat it as candidate fixer work.

## Implementation

### Overview

Add a first-class `read-only` tool preset, implement harness-specific read-only tool composition, switch all build reviewer dispatches to that preset, normalize mutation denylists across Claude/Pi tool names, harden compile-reviewer/evaluator denylists, and guard review stages with a pre/post worktree snapshot.

### Key Decisions

1. Add `ToolPreset = 'coding' | 'read-only' | 'none'` instead of overloading `none`. This gives reviewers inspection tools without mutation tools and lets `none` mean no built-in tools.
2. Use a shared mutation-tool helper so denylist call sites do not drift between Claude-cased names (`Write`, `Edit`, `Bash`) and Pi lowercase names (`write`, `edit`, `bash`).
3. In Pi `read-only`, expose only Pi read-only built-ins (`read`, `grep`, `find`, `ls`) and do not expose bridged MCP, Pi extension, or custom extension tools.
4. In Claude SDK `read-only`, use the Claude Code preset for inspection tools while adding a mutation/subagent denylist (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`, `Bash`, `Task`) and omitting project MCP servers/plugins/settings unless a future API marks them read-only.
5. Reuse the existing evaluation snapshot/restore utilities for review-stage mutation detection so pre-existing staged, unstaged, and untracked files are preserved while reviewer-introduced drift is discarded.
6. Update all reviewer prompts to describe fixes in imperative terms for the review-fixer and remove instructions that tell reviewers to edit files or run mutation-capable shell commands.

## Scope

### In Scope

- Add an explicit read-only tool preset and propagate its type/schema support.
- Implement Pi and Claude SDK read-only tool composition.
- Add shared mutation denylist expansion/merging for Claude and Pi tool names.
- Switch single, parallel built-in, and parallel extension build reviewers to read-only tools.
- Keep compile reviewers' structured submission tools available while blocking direct file/shell mutation tools.
- Harden build and planning evaluators' mutation denylists for Pi lowercase tool names.
- Add worktree mutation detection/restoration around review stages.
- Update generic and built-in perspective reviewer prompts to prohibit direct edits and avoid past-tense `<fix>` wording.
- Add regression tests for reviewer wiring, harness tool composition, denylist normalization, and reviewer worktree mutation restoration.

### Out of Scope

- Read-only metadata for project MCP or extension tools.
- Read-only shell command allowlisting for Pi reviewers.
- Removing compile-reviewer structured submission tools.
- Treating local `.eforge/monitor.db` evidence as a test fixture.
- New roadmap items or product features beyond reviewer isolation.

## Files

### Create

- `packages/engine/src/harnesses/tool-safety.ts` — Shared constants/helpers for mutation tool names and denylist expansion/merging across Claude SDK and Pi.
- `test/harness-read-only-tools.test.ts` — Focused tests for read-only preset composition and denylist aliasing without requiring live model calls.

### Modify

- `packages/engine/src/harness.ts` — Extend `ToolPreset` to include `read-only`; update debug-payload comments for the new mode.
- `packages/engine/src/config.ts` — Include `read-only` in any tool preset schema/type surfaces that mirror `ToolPreset`.
- `packages/engine/src/harnesses/pi.ts` — Select base tools by preset (`coding`, `read-only`, `none`); skip bridged MCP, ambient extension tools, and custom extension tools in read-only mode; apply shared denylist alias expansion before filtering; expose pure helpers for test inspection if needed.
- `packages/engine/src/harnesses/claude-sdk.ts` — Treat `read-only` as Claude Code preset plus mutation/subagent denylist; keep `none` as `[]`; omit project MCP/plugins/settings in read-only; include read-only mode in debug payloads.
- `packages/engine/src/agents/reviewer.ts` — Run the single build reviewer with `tools: 'read-only'`; include engine-computed changed-file/diff context in the prompt so reviewers do not need shell access.
- `packages/engine/src/agents/parallel-reviewer.ts` — Run built-in and extension perspective reviewers with `tools: 'read-only'`; pass the same engine-computed review context into generic and perspective prompts.
- `packages/engine/src/agents/plan-reviewer.ts` — Replace inline Claude-only denylist with the shared mutation denylist helper while preserving the structured submission custom tool.
- `packages/engine/src/agents/architecture-reviewer.ts` — Same compile-reviewer denylist hardening as `plan-reviewer.ts`.
- `packages/engine/src/agents/cohesion-reviewer.ts` — Same compile-reviewer denylist hardening as `plan-reviewer.ts`.
- `packages/engine/src/agents/builder.ts` — Replace duplicated evaluator mutation denylist with the shared helper so Pi lowercase tools are denied during build evaluation.
- `packages/engine/src/agents/plan-evaluator.ts` — Replace duplicated planning evaluator mutation denylist with the shared helper so Pi lowercase tools are denied during planning evaluation.
- `packages/engine/src/pipeline/stages/build-stages.ts` — Capture a review-stage worktree snapshot before reviewer dispatch; hold/augment the aggregate review-complete event until after the invariant check; restore reviewer drift; append a critical `review-contract` issue on violation; fail the stage if restoration fails.
- `packages/engine/src/prompts/reviewer.md` — Remove shell-centric diff instructions, add engine-provided review context instructions, keep no-edit constraints, and use imperative `<fix>` wording.
- `packages/engine/src/prompts/reviewer-code.md` — Remove edit-tool instructions, forbid direct fixes, switch `<fix>` wording to recommended actions, and reference engine-provided changed files/diff context.
- `packages/engine/src/prompts/reviewer-security.md` — Same prompt contract update as `reviewer-code.md` for the security perspective.
- `packages/engine/src/prompts/reviewer-api.md` — Same prompt contract update as `reviewer-code.md` for the API perspective.
- `packages/engine/src/prompts/reviewer-docs.md` — Same prompt contract update as `reviewer-code.md` for the docs perspective.
- `packages/engine/src/prompts/reviewer-tests.md` — Same prompt contract update as `reviewer-code.md` for the test perspective.
- `packages/engine/src/prompts/reviewer-verify.md` — Remove subprocess-running instructions from the reviewer role; make this perspective report verification concerns from provided plan/diff/validation evidence without editing files or running shell commands.
- `test/agent-wiring.test.ts` — Assert `runReview` uses `tools: 'read-only'`; assert compile reviewers/evaluators include both Claude-cased and Pi-lowercase mutation denylist entries.
- `test/parallel-reviewer.test.ts` — Assert built-in and extension perspective reviewer calls use `tools: 'read-only'` and receive appended extension prompt context.
- `test/claude-sdk-backend.test.ts` — Add or update tests for read-only denylist resolution, including `Task` and existing eforge plugin MCP deny patterns.
- `test/build-evaluator-enforcement.test.ts` or `test/reviewer-isolation.test.ts` — Simulate a reviewer mutating tracked and untracked files, then assert the aggregate review result includes a critical `review-contract` issue and the post-review git status output is empty for the isolated build worktree.
- `test/prompt-resolution.test.ts` or a prompt content test — Assert bundled reviewer prompts no longer instruct build reviewers to edit/write fixes and no longer describe `<fix>` as already applied.

## Implementation Notes

### Shared tool safety helper

Implement helpers with concrete behavior similar to:

- `MUTATION_TOOL_DENYLIST_CLAUDE = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash']`
- `SUBAGENT_TOOL_DENYLIST = ['Task']`
- `MUTATION_TOOL_DENYLIST_PI = ['write', 'edit', 'bash']`
- `mergeMutationDisallowedTools(existing, options?)` returns a de-duplicated list containing the existing entries plus Claude and Pi mutation aliases, and `Task` when requested.
- `expandDisallowedToolAliasesForPi(disallowedTools)` maps known Claude mutation names to their Pi lowercase equivalents before `filterTools` runs.

Do not make all Pi tool filtering case-insensitive; only expand known safety aliases so arbitrary MCP/custom tool names retain exact matching semantics.

### Review context without shell access

Reviewer prompts currently tell agents to run `git diff`. Since read-only Pi excludes `bash` and Claude read-only denies `Bash`, compute review context in the engine and inject it into reviewer prompts. Include at minimum:

- changed file paths from `git diff ${baseBranch}...HEAD --name-only`
- diff stat or changed-line count
- a bounded diff excerpt or per-file diff summary using existing diff helpers/truncation patterns

If the diff is too large, include a file list and stat summary; reviewers can then use `read`/`Read`/`grep`/`Grep`/`Glob` to inspect files.

### Review-stage worktree invariant

Use `captureEvaluationSnapshot(ctx.worktreePath)` before reviewer dispatch. After reviewer dispatch, call `assertNoEvaluationDrift(snapshot)`. On drift:

1. Call `restoreEvaluationSnapshotAfterFailure(snapshot)` to restore the exact pre-review staged/unstaged/untracked state.
2. Add a `ReviewIssue` with `severity: 'critical'`, `category: 'review-contract'`, `file: 'reviewer-output'`, and a description naming the drifted paths when available.
3. Ensure the aggregate `plan:build:review:complete` event includes that issue.
4. Set `ctx.reviewIssues` and metadata counts from the augmented aggregate event.
5. If restoration throws, set `ctx.buildFailed = true` and yield `plan:build:failed` so mutated reviewer work cannot reach evaluation as review-fixer output.

Buffer only the aggregate `plan:build:review:complete` event while the review generator runs; continue yielding reviewer lifecycle/tool/message events and perspective-complete events normally.

## Verification

- [ ] `runReview` records a harness call with `tools` equal to `read-only`.
- [ ] `runParallelReview` records every built-in perspective harness call with `tools` equal to `read-only`.
- [ ] `runParallelReview` records every extension perspective harness call with `tools` equal to `read-only` and the extension prompt fragment appears in the prompt.
- [ ] Pi read-only tool composition exposes `read`, `grep`, `find`, and `ls`, and excludes `bash`, `edit`, and `write`.
- [ ] Pi read-only mode does not expose bridged MCP, ambient extension, or custom extension tools.
- [ ] Pi filtering removes lowercase `write`, `edit`, and `bash` when the caller denylist contains `Write`, `Edit`, and `Bash`.
- [ ] Claude SDK read-only debug payload uses the Claude Code preset and its effective denylist contains `Write`, `Edit`, `MultiEdit`, `NotebookEdit`, `Bash`, and `Task`.
- [ ] Claude SDK read-only mode does not expose project MCP servers/plugins/settings while retaining built-in inspection tools.
- [ ] Compile reviewers still receive their structured submission custom tool and their direct mutation denylist contains Claude and Pi mutation aliases.
- [ ] Build and planning evaluators deny Claude and Pi mutation aliases while retaining their evaluation snapshot custom tools.
- [ ] A reviewer-created tracked-file mutation is removed before review-fix/evaluate and the aggregate review-complete event contains a critical `review-contract` issue.
- [ ] A reviewer-created untracked file is removed before review-fix/evaluate and the aggregate review-complete event contains a critical `review-contract` issue.
- [ ] Bundled build reviewer prompts contain no instruction to write fixes directly to files.
- [ ] `pnpm type-check` exits with status 0.
- [ ] `pnpm test -- agent-wiring reviewer` exits with status 0.
- [ ] `pnpm test` exits with status 0.
