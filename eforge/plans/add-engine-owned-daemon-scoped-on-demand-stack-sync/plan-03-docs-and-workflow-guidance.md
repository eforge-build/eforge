---
id: plan-03-docs-and-workflow-guidance
name: Documentation and Workflow Guidance
branch: add-engine-owned-daemon-scoped-on-demand-stack-sync/plan-03-docs-and-workflow-guidance
agents:
  builder:
    effort: medium
    rationale: Mostly documentation and generated-reference updates, with care
      needed to keep plugin/Pi guidance and generated docs in sync.
  doc-author:
    effort: high
    rationale: User-facing docs must replace unsafe automation guidance with precise
      daemon-owned sync, deferred retry, and after-build trigger semantics.
  reviewer:
    effort: medium
    rationale: Review should focus on docs parity, plugin version bump, and absence
      of unsafe postMergeCommands recommendations.
---

# Documentation and Workflow Guidance

## Architecture Context

Plans 01 and 02 change stack sync from a shell-friendly helper into a daemon-owned operation with durable status, active-build deferral, and console-visible triggers. Documentation and skills must stop recommending `build.postMergeCommands: ["eforge stack sync"]` for automation and must explain the safer on-demand workflow.

Follow the repository rule: bump the Claude plugin version when changing files under `eforge-plugin/`. Do not bump `packages/pi-eforge/package.json`.

## Implementation

### Overview

Update docs, skills, generated docs, and static tests to describe manual daemon sync, after-build daemon sync, deferred/retry behavior, conflict recovery, status visibility, and provider-boundary concepts. Regenerate docs artifacts with the existing docs generator.

### Key Decisions

1. Present `eforge stack sync` as a daemon-routed manual trigger, not as a safe shell command for `build.postMergeCommands`.
2. Present automatic stack sync as daemon-owned `stacking.sync.afterBuild: true` when implemented by Plans 01/02, with active-build deferral and retry semantics.
3. Keep outcome vocabulary consistent across docs: `complete`, `skipped`, `deferred`, `failed`, and `conflict`.
4. Keep Claude plugin and Pi skill docs semantically aligned.

## Scope

### In Scope

- Update stacking docs to describe daemon-owned execution from project root, dry-run, manual console/CLI/MCP/Pi triggers, after-build daemon trigger, deferred active-build behavior, status route/snapshot visibility, and conflict/failure diagnostics.
- Remove or strongly discourage `build.postMergeCommands: ["eforge stack sync"]` automation guidance.
- Update configuration docs for `stacking.sync.afterBuild` and changed workflow preset behavior.
- Update public web content and generated reference docs after source docs/generator changes.
- Update Claude plugin stack/workflow skills and Pi stack/workflow skills for the new guidance.
- Bump `eforge-plugin/.claude-plugin/plugin.json` version.
- Update docs/static tests to assert unsafe post-merge sync is not presented as the recommended automatic mechanism.

### Out of Scope

- New stack provider documentation beyond stating only git-spice is supported.
- Periodic sync configuration docs.
- Queue priority/back-burner docs.

## Files

### Modify

- `docs/stacking.md` — replace opt-in post-merge command guidance with daemon-owned manual, after-build, deferred, retry, status, and conflict guidance.
- `docs/config.md` — document `stacking.sync.afterBuild` and update workflow preset table.
- `web/content/docs/stacking.md` — sync public docs content.
- `web/content/docs/configuration.md` — document new config field and relationship to trunk sync/post-merge validation.
- `web/content/reference/cli.md` — update generated CLI reference after CLI description changes.
- `web/public/docs/stacking.md`, `web/public/docs/configuration.md`, and other generated public artifacts touched by `pnpm docs:generate` — keep generated docs in sync.
- `packages/docs-gen/src/generators/config.ts` — generate `stacking.sync.afterBuild` docs and updated workflow preset table.
- `eforge-plugin/skills/stack/stack.md` — update response fields/outcomes, deferred retry guidance, and daemon-owned trigger wording.
- `eforge-plugin/skills/workflow/workflow.md` — replace shell post-merge auto-sync preset guidance with daemon-owned after-build sync config.
- `eforge-plugin/.claude-plugin/plugin.json` — bump plugin version.
- `packages/pi-eforge/skills/eforge-stack/SKILL.md` — mirror stack sync skill guidance.
- `packages/pi-eforge/skills/eforge-workflow/SKILL.md` — mirror workflow preset guidance.
- `packages/pi-eforge/README.md` — update summary of workflow wizard and stack sync.
- `test/stack-sync-surface-docs.test.ts` — update docs assertions for `deferred`, daemon-owned after-build sync, and no recommended post-merge command automation.
- `test/trunk-sync.test.ts` — keep regression asserting project config does not include `eforge stack sync` in post-merge commands.
- Add or update docs drift tests if existing snapshots fail after generation.

## Verification

- [ ] `docs/stacking.md` contains `deferred`, `retry-deferred`, `activeBuildSkips`, and daemon/project-root execution guidance.
- [ ] `docs/stacking.md` does not recommend `build.postMergeCommands: ["eforge stack sync"]` as automatic sync.
- [ ] Config docs list `stacking.sync.afterBuild` and state that it triggers daemon-owned after-build sync.
- [ ] Claude plugin stack skill and Pi stack skill both mention `deferred` and conflict recovery.
- [ ] Claude plugin workflow skill and Pi workflow skill both map automatic stack sync to `stacking.sync.afterBuild`, not `build.postMergeCommands`.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` version is greater than the pre-change version.
- [ ] `pnpm docs:generate` updates generated docs without leaving drift.
- [ ] Static docs tests fail if `build.postMergeCommands: ["eforge stack sync"]` returns as recommended automation guidance.
