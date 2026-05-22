---
id: plan-04-ux-init-build-and-docs
name: "UX surface: eforge_init schema, init/build skills, CLI confirmation, docs"
branch: branch-aware-landing-and-queue-provenance-split-for-eforge-builds/plan-04-ux-init-build-and-docs
agents:
  builder:
    effort: high
    rationale: Cross-cuts MCP tool schemas, two parallel skill markdown files, CLI
      confirmation flow, and four+ doc files; needs careful parity between Pi
      and Claude Code surfaces.
  doc-author:
    effort: high
    rationale: Multiple user-facing docs need new sections on queue/provenance
      split, branch policy, solo-dev opt-in.
  doc-syncer:
    effort: high
    rationale: Existing docs reference 'eforge/queue', enqueue commits, and issue-pr
      semantics that all change.
---

## Architecture Context

With engine semantics in place (plans 01-03), the user-facing surface must teach those semantics. This plan:

1. Extends the `eforge_init` MCP tool schema (both in `packages/eforge/src/cli/mcp-proxy.ts` for the Claude Code plugin and `packages/pi-eforge/extensions/eforge/index.ts` for the Pi extension) to accept `trunkBranch` and `allowLocalMergeToTrunk` and persist them under `build.trunkBranch` and `build.allowLocalMergeToTrunk` in `eforge/config.yaml`.
2. Updates the init skills (`eforge-plugin/skills/init/init.md` and `packages/pi-eforge/skills/eforge-init/SKILL.md`) to detect the local trunk branch via `origin/HEAD` (with `main` fallback), confirm it with the user, and ask whether trunk should be protected (default) or whether local trunk merge is allowed for solo/unprotected projects.
3. Updates the build skills (`eforge-plugin/skills/build/build.md` and `packages/pi-eforge/skills/eforge-build/SKILL.md`) to describe branch-aware workflows: from trunk the build will produce a PR (or be rejected with a remediation message), from a feature branch the user is offered PR-after-local-merge vs local merge.
4. Adds a CLI confirmation step in `packages/eforge/src/cli/run-or-delegate.ts` (and any related entry in `packages/eforge/src/cli/index.ts`) that surfaces the planned landing workflow before enqueue when running interactively on trunk.
5. Bumps the Claude Code plugin version in `eforge-plugin/.claude-plugin/plugin.json` because plugin files change.
6. Updates user-facing docs (`docs/config.md`, `docs/architecture.md`, `web/content/docs/configuration.md`, `web/content/docs/concepts.md`, `web/content/docs/glossary.md`) and the parity check / generated reference docs.

## Implementation

### Overview

1. **MCP tool schema** — Extend the `eforge_init` Zod (Claude Code plugin) and TypeBox (Pi extension) schemas with `trunkBranch?: string` and `allowLocalMergeToTrunk?: boolean`. When provided, the handler writes them under `build.trunkBranch` and `build.allowLocalMergeToTrunk` in the generated `eforge/config.yaml`. Honor both the `existingProfile` and fresh-init code paths.
2. **Init skill flow (parity)** — Add a new step between Step 1.3 (on-success) and Step 1.5 (existing profiles): Step 1.4 "Confirm trunk branch and protection policy". The skill must:
   - Run `git symbolic-ref refs/remotes/origin/HEAD --short` (skill-side via shell tool) to detect the trunk branch, stripping `origin/`; fall back to `main` on failure.
   - Show the detected trunk to the user and accept a correction.
   - Ask: "Should `merge-to-base-branch` be allowed to land on `<trunk>` locally without a PR? Recommended for solo developers on unprotected branches. Most team workflows should answer no."
   - Pass the chosen `trunkBranch` and `allowLocalMergeToTrunk` into `eforge_init`.
3. **Build skill** — Add a section that explains:
   - On trunk: by default the build will produce a PR. Local trunk merge requires `build.allowLocalMergeToTrunk: true` in `eforge/config.yaml`. If the user picks `merge-to-base-branch` on trunk without opt-in, the engine will reject with a clear message.
   - On non-trunk: PR opens from the user's feature branch to trunk (after a local merge of the eforge work branch into the user's feature branch); local merge lands the eforge work branch in the user's feature branch.
4. **CLI** — Add a confirmation prompt before enqueue when the CLI is interactive (`!options.auto`), `gitCurrentBranch === resolvedTrunk`, and the chosen `onSuccess` is `merge-to-base-branch` without opt-in. The CLI should explain the situation, surface the four choices (confirm PR by switching to `issue-pr`, cancel, create/switch to a local feature branch, or enable the solo-dev opt-in), and only proceed once the user picks a valid option. When `--auto` is set, the CLI falls back to the engine's runtime rejection.
5. **Plugin version bump** — Increment patch version in `eforge-plugin/.claude-plugin/plugin.json`.
6. **Docs**:
   - `docs/config.md` and `web/content/docs/configuration.md`: document `build.trunkBranch` and `build.allowLocalMergeToTrunk`; document the new `prdQueue.dir` default `.eforge/queue`.
   - `docs/architecture.md` and `web/content/docs/concepts.md`: describe the queue/provenance split, the temporary `eforge/prds/` artifact, the branch-aware landing matrix.
   - `web/content/docs/glossary.md`: replace `eforge/queue/` with `.eforge/queue/` and add entries for `eforge/prds/` and "trunk branch policy".
7. **Parity check** — Run `node scripts/check-skill-parity.mjs` (already in `pnpm test`) to ensure the two init skills stay in parity, and the two build skills stay in parity.

### Key Decisions

1. **Single, shared skill flow** — Pi and Claude Code init skills mirror each other section-by-section. Add the trunk policy step to both in lockstep.
2. **CLI confirmation is interactive-only** — When `--auto` or daemon-driven, defer to engine rejection. Skills handle interactive UX before the engine ever sees the request.
3. **Docs lean on architectural framing** — `docs/architecture.md` already explains the queue and recovery; this is the right place to document the queue/provenance split. User-facing docs in `web/content/` get the practical "how to configure" treatment.
4. **No new docs files** — Update existing pages instead of creating standalone branch-policy docs. The information belongs in the existing config/concepts pages.

## Scope

### In Scope

- Extend `eforge_init` MCP tool schemas (Claude Code + Pi) with `trunkBranch` and `allowLocalMergeToTrunk`; persist them under `build.trunkBranch` / `build.allowLocalMergeToTrunk` in `eforge/config.yaml`.
- Update init skills with a Step 1.4 "Trunk branch and protection policy" section.
- Update build skills with a branch-aware workflow section and per-build override guidance.
- CLI confirmation step before enqueue on trunk when `onSuccess === 'merge-to-base-branch'` and opt-in is not enabled.
- Bump `eforge-plugin/.claude-plugin/plugin.json` version (patch).
- Update `docs/config.md`, `docs/architecture.md`, `web/content/docs/configuration.md`, `web/content/docs/concepts.md`, `web/content/docs/glossary.md`.
- Run `pnpm docs:generate` and commit any updated generated reference docs / schemas to keep `pnpm docs:check` green.
- Skill parity tests: ensure `node scripts/check-skill-parity.mjs` still passes after both skill pairs are updated.

### Out of Scope

- Backfilling new branch-policy fields into historical project configs (no migration tool).
- Changes to monitor UI presentation beyond what existing event schema additions already enable.
- New ADRs.
- Adding more onSuccess values or per-build base/target override flags.

## Files

### Modify

- `packages/eforge/src/cli/mcp-proxy.ts` — In the `eforge_init` tool: add `trunkBranch: z.string().optional()` and `allowLocalMergeToTrunk: z.boolean().optional()` to the schema. In both `existingProfile` and fresh-init handlers, attach `trunkBranch` and `allowLocalMergeToTrunk` to the constructed `buildBlock` when provided. Update the tool description to mention the new fields.
- `packages/pi-eforge/extensions/eforge/index.ts` — Mirror the same changes on the TypeBox schema and the Pi handler.
- `eforge-plugin/skills/init/init.md` — Add Step 1.4 "Confirm trunk branch and protection policy" between the existing Step 1.3 (on-success) and Step 1.5. Pass `trunkBranch` and `allowLocalMergeToTrunk` into the `eforge_init` calls in Step 1.5 (existing profile path) and Step 5 (fresh init).
- `packages/pi-eforge/skills/eforge-init/SKILL.md` — Mirror identical Step 1.4 with Pi-native UI hooks (`showSelectOverlay` for the protection question, `showInput` for trunk correction).
- `eforge-plugin/skills/build/build.md` — Add a "Branch-aware landing" subsection under Step 4 that describes trunk vs feature-branch behavior and how to opt into solo-dev local trunk merge. Update the `onSuccess` argument description to mention that `merge-to-base-branch` on trunk requires `build.allowLocalMergeToTrunk: true`.
- `packages/pi-eforge/skills/eforge-build/SKILL.md` — Mirror the same content.
- `packages/eforge/src/cli/run-or-delegate.ts` — Before calling `engine.enqueue(...)` from the interactive CLI path, when `!options.auto` and `git rev-parse --abbrev-ref HEAD` equals the resolved trunk, and the effective `onSuccess` resolves to `merge-to-base-branch` without opt-in, prompt the user (via the existing `interactive.ts` prompting helpers) with four options: switch to PR, cancel, create/switch a feature branch (printed instructions), or enable solo-dev opt-in (printed instructions). Continue with the chosen action; default to PR.
- `packages/eforge/src/cli/interactive.ts` (if a new helper is required) — Add a `confirmTrunkLanding(...)` helper used by `run-or-delegate.ts`.
- `eforge-plugin/.claude-plugin/plugin.json` — Bump `version` patch (e.g. `x.y.z` → `x.y.(z+1)`).
- `docs/config.md` — Document `build.trunkBranch` and `build.allowLocalMergeToTrunk`; update the `prdQueue.dir` default to `.eforge/queue`; add a note about `eforge/prds/` temporary artifacts.
- `docs/architecture.md` — Update the queue section's `eforge/queue/` reference to `.eforge/queue/`; add a paragraph on PRD provenance via `eforge/prds/{prdId}.md`; add a branch-policy paragraph and the four-cell landing matrix.
- `web/content/docs/configuration.md` — Mirror the `docs/config.md` updates for the published doc site.
- `web/content/docs/concepts.md` — Update the queue paragraph to reference `.eforge/queue/` and add the queue/provenance split explanation.
- `web/content/docs/glossary.md` — Update the queue entry to `.eforge/queue/`; add `eforge/prds/` and "trunk branch policy".
- Generated reference artifacts under `web/content/docs/reference/` (if `pnpm docs:check` detects drift after the schema additions) — let the doc generator update them via `pnpm docs:generate`.

## Verification

- [ ] `eforge_init` accepts `{ trunkBranch: 'main', allowLocalMergeToTrunk: true, postMergeCommands: [...], onSuccess: 'merge-to-base-branch' }` and produces an `eforge/config.yaml` whose `build` block contains `trunkBranch: main`, `allowLocalMergeToTrunk: true`, plus the other fields.
- [ ] Both init skills include a Step 1.4 that detects trunk, confirms with the user, and asks the protection question; `node scripts/check-skill-parity.mjs` exits 0.
- [ ] Both build skills describe the branch-aware landing matrix in the same shape; parity check exits 0.
- [ ] CLI on trunk with `onSuccess: merge-to-base-branch` and no opt-in surfaces the four-option confirmation prompt and does NOT enqueue until the user picks one (verified by interactive-CLI unit test or snapshot of the printed prompt text).
- [ ] CLI with `--auto` bypasses the confirmation and lets engine rejection handle the case (the existing engine error event is surfaced through normal output).
- [ ] `eforge-plugin/.claude-plugin/plugin.json` version is bumped relative to the previous commit.
- [ ] `docs/config.md` and `web/content/docs/configuration.md` document `build.trunkBranch`, `build.allowLocalMergeToTrunk`, and the `.eforge/queue` default.
- [ ] `web/content/docs/glossary.md` no longer mentions `eforge/queue/` as the queue location; it references `.eforge/queue/` and the new `eforge/prds/` artifact.
- [ ] `pnpm docs:check` passes (regenerated reference artifacts committed).
- [ ] `pnpm type-check` and `pnpm test` pass.