---
id: plan-03-consumer-parity
name: Pi and Claude Consumer Parity
branch: resume-failed-compiled-builds/plan-03-consumer-parity
---

# Pi and Claude Consumer Parity

## Architecture Context

The repository requires consumer-facing behavior to stay aligned between `eforge-plugin/` and `packages/pi-eforge/`. The Claude Code plugin consumes MCP proxy tools and skill docs; Pi has native tools plus skill docs. Plugin changes require a plugin version bump, while the Pi package version must not be bumped.

## Implementation

### Overview

Expose compiled-build resume in the Pi extension tool surface and update both Pi and Claude recovery skill docs so users can choose compiled-build resume alongside PRD-level retry, split, abandon, and manual recovery.

### Key Decisions

1. Add a Pi tool named consistently with the MCP proxy, such as `eforge_resume_build`.
2. Update the recover skills to distinguish PRD-level retry from compiled-build resume.
3. Require user confirmation before calling resume from skill workflows.
4. Bump only `eforge-plugin/.claude-plugin/plugin.json` because plugin content changes.

## Scope

### In Scope

- Pi native tool for triggering compiled-build resume through the daemon API helper or route constant.
- Pi recovery skill documentation that offers resume when a failed PRD has compiled artifacts and a feature branch.
- Claude recovery skill documentation that offers the MCP resume tool under the same conditions.
- Plugin version bump.
- Parity and docs tests affected by skills/tool declarations.

### Out of Scope

- Rich Console UI action buttons.
- Pi package version changes.
- Automatic resume without explicit user confirmation.

## Files

### Create

- No new files expected.

### Modify

- `packages/pi-eforge/extensions/eforge/index.ts` — register the Pi `eforge_resume_build` tool and call the shared resume API helper or `API_ROUTES.resumeBuild`.
- `packages/pi-eforge/skills/eforge-recover/SKILL.md` — document when to choose compiled-build resume, the confirmation step, and the `eforge_resume_build` call.
- `eforge-plugin/skills/recover/recover.md` — mirror the Pi recovery workflow with MCP tool names.
- `eforge-plugin/.claude-plugin/plugin.json` — bump the plugin version.
- `packages/pi-eforge/README.md` or other generated skill/tool listings if existing tests require manual updates.
- `test/extension-tooling-wiring.test.ts`, `test/extension-docs-content.test.ts`, or skill parity tests if they enumerate Pi/Claude tools or skill content.

## Verification

- [ ] Pi registers an `eforge_resume_build` tool that accepts `prdId` and optional `setName`.
- [ ] The Pi tool sends a POST request to the shared resume route and returns `{ sessionId, pid }`.
- [ ] Claude recover skill instructions mention `mcp__eforge__eforge_resume_build` and keep `mcp__eforge__eforge_apply_recovery` for verdict actions.
- [ ] Pi recover skill instructions mention `eforge_resume_build` and keep `eforge_apply_recovery` for verdict actions.
- [ ] Both skills require user confirmation before invoking resume.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` version changes from its current value.
- [ ] `packages/pi-eforge/package.json` version remains unchanged.
- [ ] `pnpm docs:check` exits 0.
- [ ] `pnpm vitest run test/extension-tooling-wiring.test.ts test/extension-docs-content.test.ts` exits 0 when those tests exist in the checkout.
