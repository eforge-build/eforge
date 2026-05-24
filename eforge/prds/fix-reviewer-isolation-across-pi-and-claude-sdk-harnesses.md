---
title: Fix Reviewer Isolation Across Pi and Claude SDK Harnesses
created: 2026-05-24
profile: gpt-claude-combo
landing: pr
---

# Fix Reviewer Isolation Across Pi and Claude SDK Harnesses

## Problem / Motivation

Build-time reviewer agents are intended to be blind review sensors that identify issues and describe recommended fixes, leaving mutation to `review-fixer` and acceptance to `evaluator`.

In practice, reviewers are launched with full coding tools. A real run showed reviewer agent `9632b2d2-5049-4cf4-814b-2897254f6642` using an `edit` tool to modify `packages/engine/src/eforge.ts` while its final `<fix>` text used past tense.

This breaks stage separation, makes the review-fixer/evaluator boundary ambiguous, and can cause evaluator snapshots to include reviewer-authored changes that were never supposed to exist.

Affected users: anyone running eforge builds, especially with parallel review or Pi harness profiles.

Impact:

- Reviewer mutation can silently bypass the intended review-fixer role.
- Monitor output can become confusing or misleading.
- The blind-review control model described in the README is undermined.

Evidence gathered:

- The project policy in `eforge/AGENTS.md` emphasizes engine/plugin boundaries and real-code tests; no special roadmap item directly covers reviewer isolation.
- `docs/roadmap.md` has adjacent maturity/extensibility items, but this is a defect fix, not a new roadmap feature.
- The reviewer prompt contract in `packages/engine/src/prompts/reviewer.md` says build reviewers must not write fixes and should only describe fixes in `<fix>` elements.
- Runtime code violates that contract:
  - `packages/engine/src/agents/reviewer.ts` launches the single build reviewer with `tools: 'coding'`.
  - `packages/engine/src/agents/parallel-reviewer.ts` launches built-in and extension review perspectives with `tools: 'coding'`.
- Pi harness behavior in `packages/engine/src/harnesses/pi.ts`:
  - `tools: 'coding'` registers `createCodingTools`:
    - `read`
    - `bash`
    - `edit`
    - `write`
  - Non-coding mode registers `createReadOnlyTools`:
    - `read`
    - `grep`
    - `find`
    - `ls`
  - Pi filters `allowedTools` / `disallowedTools` exactly and case-sensitively.
- Claude SDK harness behavior in `packages/engine/src/harnesses/claude-sdk.ts`:
  - `tools: 'coding'` passes the Claude Code preset, including mutating tools.
  - Non-coding mode passes no tools.
  - Claude-side read-only-with-custom-tools is currently achieved by using the coding preset plus `disallowedTools` such as:
    - `Write`
    - `Edit`
    - `MultiEdit`
    - `NotebookEdit`
    - `Bash`
- Compile reviewers:
  - `plan-reviewer`
  - `architecture-reviewer`
  - `cohesion-reviewer`

  already use engine submission tools for candidate planning-artifact fixes and pass a mutation denylist, but that denylist is Claude-cased and does not block Pi lowercase tool names.
- Evaluators already deny:
  - `Write`
  - `Edit`
  - `MultiEdit`
  - `NotebookEdit`
  - `Bash`

  but the same Pi casing issue applies if they run under Pi with coding tools.
- Monitor DB validation of the reported run shows the screenshot reviewer agent `9632b2d2-5049-4cf4-814b-2897254f6642` invoked an `edit` tool against `packages/engine/src/eforge.ts`, proving this is not only misleading wording; build reviewer mutation happened in practice.

Confirmed reproduction steps from current code and monitor data:

1. Run a build that reaches a build `review-cycle` with `review.strategy: parallel` or single review.
2. The engine calls `runReview()` or `runParallelReview()`.
3. Those functions call `harness.run(..., 'reviewer', ...)` with `tools: 'coding'`.
4. Under Pi, `tools: 'coding'` registers `read`, `bash`, `edit`, and `write`; under Claude SDK it enables the Claude Code preset including Write/Edit/Bash.
5. A reviewer can therefore invoke a mutating tool despite the prompt saying not to.
6. Observed evidence: `.eforge/monitor.db` contains an `agent:tool_use` event for run `ba561322-7a1f-496a-859d-5f564f98139c`, plan `plan-01-runtime-artifact-diagnostics`, reviewer agent `9632b2d2-5049-4cf4-814b-2897254f6642`, tool `edit`, path `packages/engine/src/eforge.ts`.

Expected behavior:

- Build reviewer perspectives can inspect code and run/read only what is safe for review.
- Build reviewers cannot create working-tree mutations.
- Any reviewer mutation attempt should be prevented by tool availability, and ideally detected as a contract violation if it somehow occurs.

Actual behavior:

- Build reviewers have mutation-capable tool registries and can edit files before the review-fixer stage starts.

Confirmed root causes:

1. Build reviewer call sites use the wrong tool mode.
   - `packages/engine/src/agents/reviewer.ts` calls `harness.run({ ..., tools: 'coding', ... }, 'reviewer', ...)`.
   - `packages/engine/src/agents/parallel-reviewer.ts` does the same for built-in reviewer perspectives and extension reviewer perspectives.
   - This conflicts with the prompt contract in `packages/engine/src/prompts/reviewer.md`.

2. The `ToolPreset` abstraction only has `coding | none`, but the two harnesses interpret non-coding differently.
   - Pi `none` currently maps to `createReadOnlyTools` (`read`, `grep`, `find`, `ls`).
   - Claude SDK `none` maps to an empty tool list, not read-only tools.
   - Because reviewers need file/diff inspection, existing code used `coding`, unintentionally granting mutation.

3. Mutation denylist handling is harness-name dependent and currently inconsistent.
   - Existing denylist examples use Claude tool names:
     - `Write`
     - `Edit`
     - `MultiEdit`
     - `NotebookEdit`
     - `Bash`
   - Pi built-in tool names are lowercase:
     - `write`
     - `edit`
     - `bash`
   - `filterTools` is exact/case-sensitive.
   - Therefore Claude-shaped denylists do not reliably protect Pi runs.

4. There is no post-review invariant check.
   - `reviewStageInner` records parsed issues but does not check that the worktree remained clean after review.
   - If the reviewer mutates files, those changes can flow into `review-fix` / `evaluate` candidate snapshots as though they were fixer changes.

## Goal

Fix reviewer isolation so review agents cannot mutate files and tool denylist/read-only behavior is enforced consistently across Pi and Claude SDK harnesses.

Build reviewers should be read-only/no-mutation sensors, while mutation remains the responsibility of `review-fixer` and acceptance remains the responsibility of `evaluator`.

## Approach

This is a **bugfix / focused** change. The defect is well-scoped but crosses both harnesses and several reviewer/evaluator call sites, so focused planning is appropriate.

Recommended profile: **Excursion**.

Rationale:

- This is a focused bugfix with a clear root cause.
- It crosses shared harness contracts, Pi and Claude SDK behavior, build reviewer call sites, and tests.
- It is not trivial enough for Errand because a one-file fix would likely miss the cross-harness casing/read-only semantics.
- It does not need Expedition because a single cohesive plan can cover the tool-mode contract, reviewer call-site changes, and regression tests without delegated module planning.

Implementation direction:

- Introduce an explicit harness-level read-only capability rather than overloading `none`, for example extend `ToolPreset` to:

  ```ts
  coding | read-only | none
  ```

- Pi `read-only` should register Pi read-only tools and not bridge MCP/extension tools unless there is a clear read-only guarantee.
  - Since project MCP tools may mutate, keep bridged MCP and extension tools available only for `coding` unless a future API marks them read-only.

- Claude SDK `read-only` should use Claude Code preset with a normalized mutation denylist so Read/Grep/Glob remain available.
  - Deny mutation tools:
    - `Write`
    - `Edit`
    - `MultiEdit`
    - `NotebookEdit`
    - `Bash`
  - Likely also deny subagent spawning:
    - `Task`

- Preserve existing `none` semantics as no tools.

- Normalize or map denylist names in Pi so Claude-style safety denylists also block lowercase Pi built-ins, or provide a shared mutation denylist helper that expands to both harness variants before filtering.

- Run all build reviewer paths with read-only tools:
  - `packages/engine/src/agents/reviewer.ts`
  - Built-in reviewer dispatches in `packages/engine/src/agents/parallel-reviewer.ts`
  - Extension reviewer dispatches in `packages/engine/src/agents/parallel-reviewer.ts`

- Add a clean-worktree assertion around review stages:
  - Snapshot worktree status before review.
  - After review, if tracked or untracked changes appeared, revert those changes if safe and emit a synthetic critical review-contract issue / warning.
  - This is defense-in-depth; primary prevention should be tool availability.

- Keep compile reviewers’ structured submission tools working.
  - They intentionally submit controlled candidate fixes through engine custom tools.
  - Direct file mutation tools should also be blocked consistently across harnesses.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Build reviewers are intended to be non-mutating sensors. | `README.md` describes blind review as a sensor followed by fixer/evaluator. `packages/engine/src/prompts/reviewer.md` explicitly says not to write fixes. | high | low | Re-read README/prompt after implementation; add tests around reviewer run options. | If wrong, the proposed change would remove intentional reviewer autonomy. Current docs/prompt strongly contradict that. |
| The reported screenshot run involved actual reviewer mutation. | `.eforge/monitor.db` query showed reviewer agent `9632b2d2-5049-4cf4-814b-2897254f6642` tool `edit` on `packages/engine/src/eforge.ts`. | high | low | Keep a regression test independent of local DB; monitor DB is only diagnostic evidence. | If wrong, the issue would still exist statically because reviewers receive mutation-capable tools. |
| Pi read-only mode should exclude `bash`, not attempt to allowlist safe shell commands. | Pi `createReadOnlyTools` already excludes bash; command safety allowlisting is more complex and not present in eforge harness. | high | medium | Future enhancement could add read-only bash allowlist, but not needed for bug fix. | If reviewers need shell for `git diff`, they must use grep/find/read or Claude SDK inspection tools; plan should ensure reviewer prompt/tooling still permits diff inspection. |
| Claude SDK read-only can be implemented by Claude Code preset plus `disallowedTools`. | Existing evaluator code uses coding preset with mutation denylist; Claude SDK exposes `allowedTools`/`disallowedTools` passthrough. | medium-high | low | Add a Claude SDK debug-payload/unit test verifying read-only mode produces preset plus denylist. | If Claude SDK cannot support read-only inspection this way, fallback would be no tools, making reviewers less capable. |
| Project MCP and extension tools should not be exposed in read-only mode. | Current harness only distinguishes built-in/bridged/custom tools, and no read-only metadata was found for project MCP/extension tools. | medium | medium | Inspect extension SDK/tool metadata if builder wants a finer-grained future design. | If some safe tools are useful, reviewers may lose optional context. Safety is higher priority for this bug. |
| Defense-in-depth worktree checks can safely discard reviewer mutations. | Evaluation code already has snapshot/restore utilities, but review stage currently has no invariant. | medium | medium | Implement with existing git status/diff helpers; test on tracked and untracked reviewer mutations. | If restore is unsafe around pre-existing dirty state, the check should fail/emit without destructive reset. Builds normally run in isolated worktrees, reducing risk. |

No unresolved low-confidence/high-impact assumptions remain.

The main uncertainty is exact implementation shape:

- `read-only` preset
- shared denylist helper

The acceptance criteria allow either typed equivalent as long as harness behavior and regression tests prove no reviewer mutation tools are available.

## Scope

In scope:

- Build reviewer isolation for:
  - Single build reviewer via `runReview`
  - Parallel built-in reviewer perspectives via `runParallelReview`
  - Parallel extension reviewer perspectives via `runParallelReview`
- Harness-level read-only/no-mutation tool behavior across:
  - Pi harness
  - Claude SDK harness
- Tool name normalization or shared denylist expansion so Claude-cased mutation denylists protect Pi lowercase built-ins.
- Defense-in-depth clean-worktree checking around review stages.
- Tests for reviewer call sites, harness tool composition, denylist behavior, and mutation regression.
- Reviewer prompt clarity improvements so `<fix>` examples use imperative wording such as `Update ...` rather than past tense such as `Updated ...`.
- Keeping compile reviewers’ structured submission tools working while blocking direct mutation tools consistently.
- Keeping docs that describe review/review-fixer/evaluator roles accurate after the change.

Out of scope:

- Treating this as a new roadmap feature.
- Adding a read-only metadata system for project MCP or extension tools.
- Exposing bridged MCP or extension tools in read-only mode unless explicitly proven read-only by future infrastructure.
- Adding read-only shell command allowlisting for Pi reviewers.
- Changing `none` semantics unexpectedly.
- Removing intentional engine submission tools from compile reviewers.
- Relying on local `.eforge/monitor.db` as the regression mechanism; it is diagnostic evidence only.

## Acceptance Criteria

1. Build reviewers cannot receive mutation-capable tools in either harness.
   - Single build reviewer (`runReview`) uses a read-only/no-mutation tool mode.
   - Parallel built-in reviewer perspectives use the same read-only/no-mutation tool mode.
   - Extension reviewer perspectives also use the same read-only/no-mutation tool mode.
   - Extension prompt context may still be appended.
   - Extension/MCP tools are not exposed unless explicitly proven read-only by future infrastructure.

2. Harness behavior is explicit and tested.
   - `AgentRunOptions.tools` supports an explicit read-only mode, or equivalent typed API, without changing `none` semantics unexpectedly.
   - Pi read-only mode registers only read-only built-ins:
     - `read`
     - `grep`
     - `find`
     - `ls`
   - Pi read-only mode excludes:
     - `bash`
     - `edit`
     - `write`
   - Claude SDK read-only mode keeps useful inspection tools available while denying mutation tools:
     - `Write`
     - `Edit`
     - `MultiEdit`
     - `NotebookEdit`
     - `Bash`
   - Claude SDK read-only mode also denies subagent spawning:
     - `Task`

     unless already globally handled.

3. Tool name normalization protects Pi from Claude-cased denylists.
   - A shared helper or Pi harness normalization ensures denylisting `Write`/`Edit`/`Bash` also removes Pi `write`/`edit`/`bash`.
   - Existing evaluator and compile-reviewer mutation denylist tests are updated/expanded to cover Pi casing behavior.

4. Defense-in-depth detects reviewer mutation.
   - Review stages assert that no working-tree changes were introduced by reviewer agents.
   - If a reviewer somehow mutates files, the engine does not let those changes silently proceed as review-fixer changes.
   - The engine emits a clear contract-violation event/issue.
   - The engine restores or discards the mutation when safe.

5. Tests cover the regression.
   - Unit tests verify `runReview` and `runParallelReview` pass read-only/no-mutation options to the harness.
   - Harness tests verify Pi and Claude SDK read-only tool composition / denylist behavior.
   - A pipeline or agent-wiring test simulates a reviewer that mutates the worktree and verifies the review stage surfaces a contract violation rather than passing the mutation into evaluation.

6. Documentation/prompt clarity is improved.
   - Reviewer prompt examples use imperative wording for `<fix>` such as:

     ```text
     Update ...
     ```

     rather than past tense such as:

     ```text
     Updated ...
     ```

   - Recommended fixes are not confused with already-applied changes.
   - Any docs that describe review/review-fixer/evaluator roles remain accurate after the change.

Validation commands expected after implementation:

```bash
pnpm type-check
pnpm test -- agent-wiring reviewer
pnpm test
```

Use `pnpm test -- agent-wiring reviewer` or the closest targeted Vitest subset added for this fix. Run `pnpm test` if the targeted subset passes and runtime is acceptable.
