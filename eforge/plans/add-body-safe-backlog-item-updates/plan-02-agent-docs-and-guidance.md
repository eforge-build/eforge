---
id: plan-02-agent-docs-and-guidance
name: Agent workflow docs and guidance for body-safe updates
branch: add-body-safe-backlog-item-updates/plan-02-agent-docs-and-guidance
---

# Agent workflow docs and guidance for body-safe updates

## Architecture Context

After the action and storage boundary supports body-safe updates, user-facing and agent-facing documentation must direct callers through `eforge-plan:get-item` and `eforge-plan:update-item` instead of direct Markdown edits. Documentation must describe lock tokens, section patch inputs, metadata-only compatibility, search/recommendation invalidation, and the remaining role of Markdown mirrors.

## Implementation

### Overview

Update the eforge-plan README, public docs summary, and contract tests so direct backlog edits use extension contributions. Audit Claude Code plugin and Pi skill text for any backlog-specific instruction that tells agents to edit `.backlog` or private mirror Markdown directly; only change those packages when such text exists.

### Key Decisions

1. Document `expectedBodySha256` from `get-item` as the primary lock token for title and section edits.
2. State that metadata-only updates preserve body content and do not require a lock.
3. State the priority convention as a free-form non-empty single-line string.
4. Keep Markdown mirrors documented as compatibility/import outputs, not the normal mutation path.
5. Keep plugin and Pi guidance in sync if either integration package needs backlog-edit wording changes; bump `eforge-plugin/.claude-plugin/plugin.json` only if `eforge-plugin/` changes.

## Scope

### In Scope

- Direct-agent workflow documentation for safe backlog item edits.
- Examples for reading a lock token and updating title/sections.
- Documentation for canonical sections, unknown section operations, optimistic-lock mismatch behavior, output fields, and storage side effects.
- README/public docs contract tests.
- Audit and conditional updates for `eforge-plugin/` and `packages/pi-eforge/` skill text.

### Out of Scope

- New dedicated Claude Code or Pi commands for eforge-plan backlog editing.
- Workstation rich body-editor UX.
- Changes to daemon, queue, engine, or kernel docs unrelated to this action.

## Files

### Create

- None expected.

### Modify

- `eforge/extensions/eforge-plan/README.md` — update `capture-item`/`update-item` examples, direct-agent workflow guidance, action table row, storage model notes, and workstation backlog drawer wording to describe body-safe updates and discourage direct Markdown edits except manual recovery.
- `web/content/docs/eforge-plan.md` — summarize body-safe `update-item`, lock-token reads, and Markdown mirror boundaries for docs-site users.
- `web/public/docs/eforge-plan.md` — sync generated/public docs output if the docs generator updates this artifact.
- `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` — assert the README documents lock-token read/update flow, section patching, metadata-only compatibility, Markdown-edit discouragement, and output fields.
- `eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts` — update docs contract expectations if they mention the older metadata-only update wording.
- `eforge-plugin/skills/**` — update only if a fresh grep finds backlog item body edits or `.backlog` item edits as normal guidance; if changed, bump `eforge-plugin/.claude-plugin/plugin.json`.
- `packages/pi-eforge/skills/**` — mirror any Claude Code skill wording changes when technically applicable. Do not bump `packages/pi-eforge/package.json`.

## Database Migration

No database migration is required.

## Implementation Notes

- README examples must show this flow: invoke `get-item` for `bodySha256`, then invoke `update-item` with `expectedBodySha256` plus `title`, `sections`, or `sectionOperations`.
- Include at least one example that updates `Claim` through `sections` and one example that appends an unknown section through `sectionOperations`.
- Name the canonical sections exactly: `Claim`, `Evidence`, `Acceptance Criteria`, `Recheck`, and `Notes`.
- Explain that action responses include `itemId`, `title`, `status`, `updatedAt`, `bodySha256`, `recordSha256`, `path`, `storage`, `changedFields`, and `changedSections`.
- Explain that successful updates write canonical SQLite, recompute section rows for body edits, update Markdown mirrors, mark search documents dirty, and mark recommendation metadata stale.
- Explain that stale lock failures require a fresh `get-item` read before retry.
- Keep `.backlog/items/<id>.md` and `.eforge/storage/extensions/eforge-plan/backlog/items/<id>.md` described as legacy/import/mirror paths, not normal agent mutation targets.

## Verification

- [ ] README direct-agent workflow contains `get-item`, `bodySha256`, `expectedBodySha256`, `sections`, `sectionOperations`, and `changedSections`.
- [ ] README states direct Markdown edits are limited to explicit manual recovery.
- [ ] README action table says `update-item` edits title, canonical sections, selected additional sections, and metadata in private storage.
- [ ] README documents metadata-only updates without lock and body/title/section updates with lock.
- [ ] README documents the free-form non-empty single-line priority convention.
- [ ] Web docs mention body-safe `update-item` and lock-token reads.
- [ ] A grep of `eforge-plugin/` and `packages/pi-eforge/` finds no backlog-specific normal workflow that instructs direct Markdown edits; if edits are made, both packages contain matching guidance and the Claude Code plugin version is bumped.
- [ ] README and docs contract tests pass.
