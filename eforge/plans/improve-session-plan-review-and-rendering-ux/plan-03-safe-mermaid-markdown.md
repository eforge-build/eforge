---
id: plan-03-safe-mermaid-markdown
name: Safe Mermaid Rendering for eforge-plan Markdown
branch: improve-session-plan-review-and-rendering-ux/plan-03-safe-mermaid-markdown
agents:
  builder:
    effort: high
    rationale: Mermaid rendering touches dependency metadata, async React rendering,
      SVG sanitization, and Markdown XSS boundaries.
  reviewer:
    effort: high
    rationale: Security-sensitive Markdown/SVG rendering needs careful review of
      sanitizer configuration and fallback behavior.
---

# Safe Mermaid Rendering for eforge-plan Markdown

## Architecture Context

`SafeMarkdown` currently parses all Markdown with `marked` and sanitizes HTML with `DOMPurify`, while forbidding resource-loading tags and SVG in normal Markdown. Mermaid fences render as code. This plan adds a dedicated Mermaid fence path with strict Mermaid configuration and sanitized rendered SVG while preserving the normal Markdown sanitizer.

## Implementation

### Overview

Add `mermaid` to the workstation bundle, lazy-load it from a Mermaid-only rendering path, and render fenced `mermaid` code blocks into sanitized diagrams. Non-Mermaid Markdown keeps the current GFM table wrapping and resource-forbid sanitizer behavior.

### Key Decisions

1. Detect Mermaid only from fenced code blocks with language `mermaid`; do not allow raw `<svg>` in normal Markdown.
2. Use a marked renderer placeholder or equivalent special fence path so normal Markdown still flows through the existing `marked` plus `DOMPurify` sanitizer.
3. Lazy import Mermaid from the diagram renderer to limit initial bundle impact.
4. Call Mermaid with `securityLevel: 'strict'` and `startOnLoad: false` before rendering.
5. Sanitize Mermaid SVG output before injecting it, forbid script/foreignObject/resource-loading/event-handler surfaces, and use a code-block fallback with an error label on import, parse, or render failure.
6. Update planner guidance to invite Mermaid only when a diagram would clarify flows, dependencies, architecture, or sequencing.

## Scope

### In Scope

- Add Mermaid rendering for fenced `mermaid` blocks in eforge-plan workstation Markdown views.
- Preserve current non-Mermaid sanitization behavior.
- Add accessible fallback rendering for invalid diagrams.
- Add tests for valid render, strict config, unique ids, invalid fallback, and unsafe SVG/link/script sanitization.
- Add optional Mermaid diagram guidance to the planning draft prompt and tests, limited to cases where a diagram clarifies flows, dependencies, architecture, or sequencing.
- Update package manifest and lockfile for the Mermaid dependency.

### Out of Scope

- General-purpose Markdown changes outside eforge-plan workstation.
- Allowing raw SVG or arbitrary HTML diagram embeds in normal Markdown.
- Requiring diagrams in every generated plan.

## Files

### Create

- `eforge/extensions/eforge-plan/workstation-src/plans/src/components/mermaid-diagram.tsx` — Lazy Mermaid renderer with strict config, unique ids, sanitized SVG insertion, loading state, and accessible fallback.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/components/mermaid-diagram.test.tsx` — Optional focused tests if `safe-markdown.test.tsx` becomes too broad.

### Modify

- `eforge/extensions/eforge-plan/workstation-src/plans/src/components/safe-markdown.tsx` — Detect Mermaid fences, render Mermaid placeholders/components, and keep the existing sanitizer path for all other Markdown.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/components/safe-markdown.test.tsx` — Cover valid Mermaid rendering, invalid fallback, unique render ids, strict Mermaid settings, table wrapping, and sanitizer regressions.
- `eforge/extensions/eforge-plan/workstation-src/plans/package.json` — Add `mermaid` as a dependency.
- `pnpm-lock.yaml` — Update from the workspace package dependency change.
- `packages/engine/src/prompts/eforge-plan-planning-draft.md` — Add optional Mermaid guidance limited to cases where diagrams clarify flows, dependencies, architecture, or sequencing.
- `test/prompts.test.ts` — Assert the rendered planning draft prompt contains Mermaid guidance and the usage limits.
- `eforge/extensions/eforge-plan/README.md` or `eforge/extensions/eforge-plan/workstation-src/plans/README.md` — Mention that fenced Mermaid diagrams render in workstation Markdown and raw SVG remains disallowed.

## Verification

- [ ] `safe-markdown.test.tsx` proves a valid Mermaid fence renders sanitized SVG content.
- [ ] `safe-markdown.test.tsx` proves Mermaid initialization receives `securityLevel: 'strict'` and `startOnLoad: false`.
- [ ] `safe-markdown.test.tsx` proves two Mermaid fences use distinct render ids.
- [ ] `safe-markdown.test.tsx` proves an invalid Mermaid diagram renders an accessible code-block fallback with an error label.
- [ ] `safe-markdown.test.tsx` proves non-Mermaid GFM tables still render inside `.plan-table-scroll`.
- [ ] `safe-markdown.test.tsx` proves normal Markdown strips images, raw SVG, style/link/script tags, resource-loading attributes, and inline event handlers.
- [ ] `safe-markdown.test.tsx` proves unsafe script/link content returned from the Mermaid renderer is absent after sanitization.
- [ ] Prompt tests prove Mermaid diagrams are optional and limited to cases where they clarify flows, dependencies, architecture, or sequencing.
- [ ] `pnpm-lock.yaml` contains the Mermaid dependency graph after running the workspace package install/update command.
- [ ] The workstation build command exits 0 with the Mermaid dependency present.