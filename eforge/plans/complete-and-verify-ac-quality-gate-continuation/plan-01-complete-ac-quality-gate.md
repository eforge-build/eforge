---
id: plan-01-complete-ac-quality-gate
name: Complete Acceptance Criteria Quality Gate
branch: complete-and-verify-ac-quality-gate-continuation/plan-01-complete-ac-quality-gate
---

# Complete Acceptance Criteria Quality Gate

## Architecture Context

The branch currently contains the existing acceptance-criteria extraction and verdict-matching utilities in `packages/engine/src/validation/acceptance-criteria.ts`, but the continuation PRD requirements are not yet fully present in this merge worktree: the focused quality test file is absent, enqueue does not gate formatted PRDs before queue writes, the formatter prompt lacks the flat-AC instruction, and session-plan readiness only checks for non-placeholder content.

The implementation must keep the existing extraction/verdict behavior for final PRD validation fail-closed while adding a deterministic pre-enqueue and planning-time quality gate for malformed acceptance criteria. The same validatable-shape analysis must be reused by the engine enqueue path and session-plan readiness; avoid Pi-only heuristics.

## Implementation

### Overview

Audit the current WIP state, then add a shared acceptance-criteria quality analyzer, wire it into engine enqueue after formatting and before dependency detection / `enqueuePrd()`, wire the same analyzer into session-plan readiness, update Pi and Claude plugin plan-skill guidance in parity, and add focused tests for analyzer, enqueue, prompt text, skill text, and daemon/session-plan readiness.

### Key Decisions

1. Put the pure AC quality analyzer in `@eforge-build/input` and have engine code import it, because session-plan readiness already lives in `@eforge-build/input` and Pi/daemon routes consume that package. Keep engine-specific verdict synthesis in `packages/engine/src/validation/acceptance-criteria.ts`.
2. Preserve existing engine import paths by re-exporting or wrapping quality helpers from `packages/engine/src/validation/acceptance-criteria.ts` when tests or callers import from the engine validation module.
3. Reject invalid AC content before queue write instead of silently normalizing vague or incomplete criteria out of the expected inventory. Grouping parent bullets may be ignored by extraction only when doing so prevents synthetic parent criteria; enqueue/session readiness must still reject grouped structures with flattening guidance.
4. Gate `set-status: ready` in the daemon route so clients cannot mark a session plan ready when the readiness helper reports invalid `acceptance-criteria` content.
5. Update both `packages/pi-eforge/skills/eforge-plan/SKILL.md` and `eforge-plugin/skills/plan/plan.md` in sync, then bump `eforge-plugin/.claude-plugin/plugin.json` because plugin files change. Do not bump `packages/pi-eforge/package.json`.

## Scope

### In Scope

- Audit the files named in the continuation PRD and repair incomplete or broken WIP edits.
- Add deterministic detection for grouping/header bullets ending in `:`, nested/grouped AC structures, bare command fragments such as `` `pnpm type-check`. ``, and vague criteria such as `Works correctly.` / `Improves reliability.`
- Accept concrete command, event, test, file, API, and observable UI criteria, including `` `pnpm type-check` exits 0. ``.
- Run the gate in `EforgeEngine.enqueue()` after formatter output and before dependency detection / `enqueuePrd()`.
- Extend session-plan readiness so invalid `acceptance-criteria` content prevents readiness and returns actionable diagnostics through helper and daemon route responses.
- Update Pi and Claude `/eforge:plan` skill guidance with flat, standalone, atomic, objectively validatable AC rules and valid/invalid examples that match the analyzer.
- Add or update targeted tests for analyzer behavior, enqueue no-write behavior, extractor grouped-parent behavior, formatter prompt text, skill text, session-plan helper readiness, daemon route readiness/status gating, and existing PRD validator fail-closed behavior.

### Out of Scope

- Rewriting PRD validation or formatter preprocessing beyond the acceptance-criteria quality gate.
- Event schema changes.
- Database migrations.
- Broad Pi UI redesign.
- New Claude Code plugin workflow capabilities beyond required skill parity text and plugin version bump.

## Files

### Create

- `packages/input/src/acceptance-criteria-quality.ts` — shared pure analyzer and diagnostic formatter for AC text/list items.
- `test/acceptance-criteria-quality.test.ts` — focused analyzer, prompt-text, and enqueue no-queue-write tests.

### Modify

- `packages/input/src/index.ts` — export shared AC quality analyzer types/functions.
- `packages/input/src/session-plan.ts` — call the shared analyzer for required `acceptance-criteria`; mark invalid criteria as readiness blockers and include diagnostics in detailed readiness output.
- `packages/input/package.json` — add any dependency needed only if the analyzer imports a workspace package; prefer zero new dependencies.
- `packages/client/src/routes.ts` — if route responses need diagnostics, add an optional non-breaking readiness diagnostics field without changing event schemas.
- `packages/engine/package.json` — add `@eforge-build/input` if engine imports the shared analyzer directly.
- `packages/engine/src/validation/acceptance-criteria.ts` — integrate/re-export quality helpers and ensure grouped parent bullets do not become expected inventory entries when grouped content is rejected or flattened.
- `packages/engine/src/eforge.ts` — run the AC quality gate after formatter output and before dependency detection / `enqueuePrd()`; emit `enqueue:failed` and return without queue writes on diagnostics.
- `packages/engine/src/prompts/formatter.md` — instruct formatter agents to produce flat, standalone, objectively validatable AC bullets with no grouping labels or bare command fragments.
- `packages/monitor/src/server.ts` — propagate readiness diagnostics in session-plan list/show/mutation/readiness responses and reject `set-status: ready` when readiness fails.
- `packages/pi-eforge/extensions/eforge/index.ts` — render readiness diagnostics returned by the session-plan tool so Pi planning surfaces invalid AC content.
- `packages/pi-eforge/skills/eforge-plan/SKILL.md` — add the AC shape guidance and examples.
- `eforge-plugin/skills/plan/plan.md` — mirror the Pi skill guidance for parity.
- `eforge-plugin/.claude-plugin/plugin.json` — bump plugin version for the skill change.
- `test/acceptance-criteria-extractor.test.ts` — cover grouped parent bullets with child bullets, asserting rejected guidance via the analyzer or leaf-only expected extraction.
- `test/session-plan-helpers.test.ts` and/or `test/session-plan.test.ts` — cover invalid AC readiness diagnostics and valid command AC readiness.
- `test/daemon-session-plan-routes.test.ts` — cover readiness route diagnostics and `set-status: ready` rejection for invalid AC content.
- `test/skills-docs-wiring.test.ts` — assert Pi and plugin plan skills contain the new rule text and valid/invalid examples.
- `test/prd-validator-fail-closed.test.ts` — update only if existing assertions need import-path changes after helper relocation; fail-closed expectations must remain intact.

## Verification

- [ ] Analyzer reports a grouping-label diagnostic for `- Tests cover:` and `- Targeted validation passes:`.
- [ ] Analyzer reports a bare-command diagnostic for ``- `pnpm type-check`.``.
- [ ] Analyzer accepts ``- `pnpm type-check` exits 0.``.
- [ ] Analyzer rejects `Works correctly.` and `Improves reliability.`.
- [ ] Analyzer accepts concrete event, test, file, command, and API criteria.
- [ ] Engine enqueue with formatted PRD containing `Tests cover:` emits `enqueue:failed` and leaves `.eforge/queue/` with zero queued markdown files.
- [ ] Engine enqueue with formatted PRD containing `` `pnpm type-check`.`` emits `enqueue:failed` and leaves `.eforge/queue/` with zero queued markdown files.
- [ ] Engine enqueue with formatted PRD containing `` `pnpm type-check` exits 0.`` reaches `enqueue:complete` and writes one queued markdown file.
- [ ] Formatter prompt includes flat, standalone, validatable AC instructions and forbids grouping labels / bare command fragments.
- [ ] Pi and Claude plan skills include flat, standalone, atomic, observable AC guidance plus matching valid/invalid examples.
- [ ] Session-plan helper readiness returns `ready: false` with diagnostics for `Tests cover:` and `` `pnpm type-check`.``.
- [ ] Session-plan helper readiness returns `ready: true` for `` `pnpm type-check` exits 0.`` when other required dimensions have substantive content.
- [ ] Daemon session-plan readiness route surfaces AC diagnostics and daemon `set-status: ready` rejects invalid AC content without changing the plan file status.
- [ ] Existing PRD validator fail-closed tests still pass.
