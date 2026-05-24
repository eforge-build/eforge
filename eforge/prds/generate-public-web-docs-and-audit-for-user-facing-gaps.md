---
title: Generate public web docs and audit for user-facing gaps
created: 2026-05-24
profile: docs-heavy
onSuccess: issue-pr
---

# Generate public web docs and audit for user-facing gaps



## Goal

Generate/update the public documentation site artifacts for the `web/` package, then audit the public user-facing docs for gaps, holes, stale content, and missing coverage. Use the current implementation as the source of truth and update the public docs so they accurately explain current eforge behavior.

## Out of scope

- Do not audit or update the legacy root `docs/` directory except where needed to understand source behavior or repo conventions.
- Do not add marketing copy, speculative future behavior, or roadmap promises.
- Do not rewrite public docs wholesale unless necessary for correctness or navigability.
- Do not change implementation code unless required to regenerate docs artifacts or verify documentation accuracy.
- Do not document internal implementation details that are not user-facing.
- Do not hand-edit generated reference outputs when they should be regenerated from source.

## Acceptance criteria

- Public docs editable sources under `web/content/` are audited against the current implementation and user-facing behavior.
- Generated documentation artifacts for the `web/` package are refreshed using the repo’s docs generation workflow.
- `pnpm docs:check` passes, or any failure is explained with concrete follow-up guidance.
- Missing, stale, misleading, or confusing user-facing documentation is corrected.
- Public docs cover the key user journeys: getting started, core concepts, configuration/profiles, playbooks, extensions, CLI/API/reference, integrations, and troubleshooting where applicable.
- Navigation, terminology, and cross-links remain consistent across the public docs.
- Documentation remains concise, task-oriented, and free of fluff.

## Notes for the planner

Focus on `web/content/` as the editable source for public docs. Treat generated `web/public/` reference artifacts as outputs of `pnpm docs:generate` / `pnpm docs:check`, not primary hand-authored content unless the repo convention requires otherwise. Audit docs from a user journey perspective: getting started, core concepts, configuration, profiles, playbooks, extensions, CLI/API/reference, integrations, and troubleshooting. Prefer clear task-oriented explanations over implementation detail. Look for missing “how do I…?” coverage, stale claims, broken navigation, terminology drift, and gaps between current capabilities and public docs. Keep docs concise, accurate, and user-facing.
