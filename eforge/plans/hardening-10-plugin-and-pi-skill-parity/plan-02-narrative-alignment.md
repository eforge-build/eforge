---
id: plan-02-narrative-alignment
name: Align paired-skill narrative across plugin and Pi
depends_on:
  - plan-01-plan-skill-and-parity-script
branch: hardening-10-plugin-and-pi-skill-parity/narrative-alignment
---

# Align paired-skill narrative across plugin and Pi

## Architecture Context

After plan-01 lands, the plugin and Pi extension each expose 9 skills. The parity-check script from plan-01 (`scripts/check-skill-parity.mjs`) normalizes tool-reference syntax and diffs the rest. The script currently fails because real narrative drift exists between paired skills — for example, the `build` skill pair differs in Step 4 (plugin uses a plain-text confirmation prompt; Pi calls the `eforge_confirm_build` tool for an interactive overlay), and Step 1 Branch C (Pi scans `.eforge/session-plans/`; plugin looks at `~/.claude/plans/`). Several of these differences are legitimate platform affordances (Pi has interactive overlay TUIs that Claude Code cannot replicate 1:1) and must be preserved; others are pure drift from one side being updated and the other not.

The source document is explicit: "Tool-reference syntax legitimately differs; everything else (when to invoke, what to do first, how to interpret results) should be identical." Platform affordance gaps are a third category the script must tolerate — the approach is to pick the superset narrative, keep platform-specific steps gated by a clear marker, and let the script match the rest.

## Implementation

### Overview

Run the parity script to enumerate every divergent pair. For each diff, classify each hunk:

1. **Pure drift** — one side is newer/better. Pick the better version and port it to the other side.
2. **Platform affordance** — Pi has a native interactive tool (e.g., `eforge_confirm_build` TUI overlay) that the plugin cannot invoke; plugin must use plain-text prompts. Keep both, but make the parity script's normalization rules recognize the pattern and treat matched hunks as equivalent. If the script cannot reasonably normalize a hunk, the narrative around it must be identical — only the tool-call bullet differs.
3. **Tool reference** — already handled by the script's normalization rules from plan-01.

At the end, `node scripts/check-skill-parity.mjs` must exit 0 and the script is wired into `pnpm test`.

### Key Decisions

1. **Picking the "better" version** — When two narratives diverge on pure drift, prefer the version with more detail, clearer error handling, and more recent language. If unsure, prefer the Pi version (Pi was updated more recently and has the interactive overlay features that imply more recent authoring work).
2. **Platform-gated hunks** — For paragraphs that legitimately differ (Pi uses `eforge_confirm_build` tool; plugin uses plain-text preview + confirm/edit/cancel prompt), extend the script's normalization to strip the specific lines inside the `Step 4` / `Step 5` confirmation blocks when they match known templates, OR accept the divergence by having the script treat a one-line tool-call swap as equivalent. Choose whichever keeps the script simpler. Document the decision in a comment at the top of `scripts/check-skill-parity.mjs`.
3. **Session-plan references** — The plugin's `build` skill currently references `~/.claude/plans/` while Pi references `.eforge/session-plans/`. After plan-01 adds `/eforge:plan` to the plugin, the plugin should also reference `.eforge/session-plans/` (the canonical location), matching Pi. Update the plugin `build` skill accordingly.
4. **Frontmatter stays platform-specific** — Plugin uses `description` + `argument-hint`; Pi uses `name` + `description` + `disable-model-invocation`. The script strips frontmatter before diffing — do not try to unify these.
5. **Wire into test** — Once the script exits 0, add `pnpm docs:check-parity` as a pretest step or as a direct entry in the `test` script. Match the repo's existing pattern (the root `package.json` has `"test": "vitest run"`; change it to `"test": "node scripts/check-skill-parity.mjs && vitest run"` so CI fails fast on parity drift).

## Scope

### In Scope
- Align narrative across all 9 skill pairs: `build`, `config`, `init`, `status`, `update`, `restart`, `backend`, `backend-new`, `plan`. For each divergent pair, edit either the plugin file (`eforge-plugin/skills/<name>/<name>.md`) or the Pi file (`packages/pi-eforge/skills/eforge-<name>/SKILL.md`) or both until the parity script passes.
- Extend `scripts/check-skill-parity.mjs` normalization only where needed to handle legitimate platform-affordance differences (e.g., Pi overlay-tool calls vs plugin plain-text prompts). Keep added normalization rules narrow and documented.
- Wire `pnpm docs:check-parity` into the root `package.json` `test` script so `pnpm test` fails on drift.

### Out of Scope
- Any change to frontmatter conventions.
- Any change to the MCP tool surface or Pi tool surface.
- Any change to `plugin.json` (version already bumped in plan-01).
- New skills or capability additions beyond narrative alignment.

## Files

### Create
- (none — all files exist after plan-01)

### Modify
- `eforge-plugin/skills/build/build.md` — Reconcile Step 1 Branch C session-plan handling with Pi (reference `.eforge/session-plans/` instead of `~/.claude/plans/`); reconcile Step 4 confirmation narrative with Pi such that post-normalization the bodies match.
- `eforge-plugin/skills/config/config.md` — Reconcile with `packages/pi-eforge/skills/eforge-config/SKILL.md`; diff shows 3-line delta — align the narrative.
- `eforge-plugin/skills/init/init.md` — Reconcile with Pi's `eforge-init/SKILL.md`. Pi's version describes only Pi backend (since it runs in Pi); plugin's covers both backends. Expand both so they describe the full interactive flow identically, keeping backend-specific tool-call examples as parallel bullets.
- `eforge-plugin/skills/status/status.md` — Reconcile with Pi's `eforge-status/SKILL.md`.
- `eforge-plugin/skills/update/update.md` — Reconcile with Pi's `eforge-update/SKILL.md`.
- `eforge-plugin/skills/restart/restart.md` — Reconcile with Pi's `eforge-restart/SKILL.md`.
- `eforge-plugin/skills/backend/backend.md` — Reconcile with Pi's `eforge-backend/SKILL.md`.
- `eforge-plugin/skills/backend-new/backend-new.md` — Reconcile with Pi's `eforge-backend-new/SKILL.md`.
- `eforge-plugin/skills/plan/plan.md` — Reconcile with Pi's `eforge-plan/SKILL.md` (this pair was just created in plan-01; validate parity).
- `packages/pi-eforge/skills/eforge-build/SKILL.md` — Counterpart edits where Pi's version needs to adopt plugin-side improvements.
- `packages/pi-eforge/skills/eforge-config/SKILL.md` — Counterpart edits.
- `packages/pi-eforge/skills/eforge-init/SKILL.md` — Counterpart edits.
- `packages/pi-eforge/skills/eforge-status/SKILL.md` — Counterpart edits.
- `packages/pi-eforge/skills/eforge-update/SKILL.md` — Counterpart edits.
- `packages/pi-eforge/skills/eforge-restart/SKILL.md` — Counterpart edits.
- `packages/pi-eforge/skills/eforge-backend/SKILL.md` — Counterpart edits.
- `packages/pi-eforge/skills/eforge-backend-new/SKILL.md` — Counterpart edits.
- `packages/pi-eforge/skills/eforge-plan/SKILL.md` — Counterpart edits if any gaps surface during alignment.
- `scripts/check-skill-parity.mjs` — Extend normalization only where legitimate platform-affordance differences exist (e.g., overlay-tool vs plain-text confirmation). Keep changes narrow and add a comment block explaining each added rule.
- `package.json` (repo root) — Change `"test": "vitest run"` to `"test": "node scripts/check-skill-parity.mjs && vitest run"` so CI fails fast on parity drift.

Note: Not every listed file will necessarily change. The parity script's output for each pair determines whether that pair needs edits. Files listed under Modify but already in parity after plan-01 should be left untouched.

## Verification

- [ ] `node scripts/check-skill-parity.mjs` exits with status 0 and prints a summary line confirming all 9 pairs are in sync.
- [ ] `pnpm docs:check-parity` exits with status 0.
- [ ] `pnpm test` runs the parity script before vitest and fails the whole command if the parity script fails (verify by temporarily inserting a known diff into one skill file, running `pnpm test`, confirming non-zero exit, then reverting).
- [ ] `ls eforge-plugin/skills/ | wc -l` equals `ls packages/pi-eforge/skills/ | wc -l` (both 9).
- [ ] For every skill pair, `diff <(node -e "...normalize...") <(node -e "...normalize...")` produces no output (equivalent to the script's internal check).
- [ ] Every new normalization rule added to `scripts/check-skill-parity.mjs` has an inline comment explaining what platform-affordance difference it tolerates.
- [ ] `grep -n 'doesn.t need a separate planning skill' README.md` returns no matches (sanity re-check from plan-01).
- [ ] `pnpm type-check` still passes (no TypeScript code changed, but run to confirm nothing regressed).
