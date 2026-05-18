---
id: plan-03-observability-docs-examples
name: Observability, Management Surfaces, Docs, and Examples
branch: runtime-reviewer-perspective-extension-point/plan-03-observability-docs-examples
agents:
  builder:
    effort: medium
    rationale: This plan combines management surface shaping and documentation
      updates after runtime behavior is available.
  doc-author:
    effort: high
    rationale: User-facing extension docs and two integration skills must stay in
      sync and accurately describe security, applicability, and runtime limits.
  reviewer:
    effort: high
    rationale: Consumer-facing docs and plugin skill changes need review for parity
      and no over-promising of out-of-scope extension capabilities.
---

# Observability, Management Surfaces, Docs, and Examples

## Architecture Context

Runtime support is not complete until extension authors can discover registered perspectives, understand why they ran or did not run, and copy a supported example. Project convention requires Claude Code plugin skills and Pi extension skills to stay in sync. The Claude Code plugin version must be bumped when its skill content changes; the Pi package version must not be bumped.

## Implementation

### Overview

Expose reviewer perspective metadata in extension list/show/validate/test outputs, update monitor/CLI formatting for provenance details, add an example extension, and revise docs/skills from “deferred” to “runtime-supported with limits.”

### Key Decisions

1. Management projections expose safe metadata only: key, label, description, extension name/path, and normalized applicability summary. Do not expose function source text.
2. Replay/test output no longer lists reviewer perspectives as deferred once runtime execution ships; it may list them under a runtime-supported registration details section.
3. Docs explain the trust model: TypeScript extensions are unsandboxed trusted code, while reviewer perspective contexts are read-only API snapshots and reviewer perspectives cannot mutate orchestration state.
4. Example focuses on a practical declarative rule, such as accessibility review for UI/TSX files, and includes an optional function only if tests cover timeout/fail-open behavior.

## Scope

### In Scope

- Add reviewer perspective metadata/details to extension management response types and engine projections.
- Render reviewer perspective details in CLI `eforge extension show`, JSON list/show/validate responses, and test summaries.
- Update monitor timeline/event-card or decision detail rendering to surface extension perspective provenance/rationale when present.
- Remove reviewer perspectives from deferred registration language in replay/test output.
- Add `examples/extensions/reviewer-perspective.ts` and reference it from examples README.
- Update `docs/extensions.md`, `docs/extensions-api.md`, and `packages/extension-sdk/README.md` to describe runtime-supported reviewer perspectives, applicability rules, events/decisions, security/trust, and limitations.
- Update both `/eforge:extend` skills: `packages/pi-eforge/skills/eforge-extend/SKILL.md` and `eforge-plugin/skills/extend/extend.md`.
- Bump `eforge-plugin/.claude-plugin/plugin.json` version because plugin skill content changes.
- Add focused CLI/monitor/doc tests for rendering and skill parity.

### Out of Scope

- Bumping `packages/pi-eforge/package.json`.
- Runtime validation providers.
- Approval workflows, stateful applicability, or custom schemas per extension perspective.
- Public docs that promise planner agents will automatically name dynamic extension keys in generated plans.

## Files

### Create

- `examples/extensions/reviewer-perspective.ts` — runtime-supported custom reviewer perspective example, likely `accessibility` for UI/TSX files.

### Modify

- `packages/client/src/types.ts` — add optional reviewer perspective detail types to extension management responses.
- `packages/engine/src/extensions/projector.ts` — project reviewer perspective metadata/details for list/show/validate responses.
- `packages/engine/src/extensions/replay.ts` — move reviewer perspectives out of deferred summaries and include supported registration details.
- `packages/eforge/src/cli/index.ts` — render reviewer perspective details in extension show/test output and preserve JSON shape.
- `packages/eforge/src/cli/display.ts` — render any new runtime events/decisions with custom perspective names and provenance fields.
- `packages/monitor-ui/src/lib/decision-format.ts`, `packages/monitor-ui/src/components/timeline/event-card.tsx`, `packages/monitor-ui/src/lib/reducer/__tests__/handle-decisions.test.ts` — display extension perspective provenance/rationale where available.
- `docs/extensions.md` — update capability matrix, runtime sections, security/trust notes, and links to the new example.
- `docs/extensions-api.md` — update `registerReviewerPerspective` signature, spec, applicability context, runtime status, events, and limits.
- `packages/extension-sdk/README.md` — change runtime status from deferred to supported and point to docs/example.
- `examples/extensions/README.md` — list the new reviewer perspective example and when to use it.
- `packages/pi-eforge/skills/eforge-extend/SKILL.md` — classify reviewer perspectives as runtime-supported and describe authoring constraints.
- `eforge-plugin/skills/extend/extend.md` — same content update as the Pi skill where technically applicable.
- `eforge-plugin/.claude-plugin/plugin.json` — bump patch version from the current value.
- `test/extension-replay.test.ts`, `test/extension-cli-commands.test.ts`, `test/extension-authoring-skill.test.ts`, `test/extension-tooling-routes.test.ts` — update expected summaries/rendering and skill guidance.
- `packages/client/src/__tests__/events-schemas.test.ts` — add summary assertions if new event registry summaries are introduced in plan 2.

## Verification

- [ ] `eforge extension show` output for a fixture extension includes the custom reviewer perspective key, label, description, and declarative applicability summary.
- [ ] Extension test/replay output no longer lists `reviewerPerspectives` under “Deferred registrations” and still lists `validationProviders` as deferred.
- [ ] JSON extension management responses include reviewer perspective metadata without function source text.
- [ ] Monitor decision or event detail tests render a custom perspective name such as `accessibility` and its extension provenance when present.
- [ ] Docs and both `/eforge:extend` skill files say reviewer perspectives execute during review-cycle and validation providers remain deferred.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` patch version is incremented and `packages/pi-eforge/package.json` is unchanged.
- [ ] The new example imports only public extension SDK APIs and passes TypeScript type checking.