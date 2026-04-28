# Recovery Analysis: replace-backend-with-harness-across-the-eforge-mcp-http-skill-stack

**Generated:** 2026-04-28T18:47:04.673Z
**Set:** replace-backend-with-harness-across-the-eforge-mcp-http-skill-stack
**Feature Branch:** `eforge/replace-backend-with-harness-across-the-eforge-mcp-http-skill-stack`
**Base Branch:** `main`
**Failed At:** 2026-04-28T18:46:30.438Z

## Verdict

**RETRY** (confidence: high)

## Rationale

The failure is a clear infrastructure/environment issue, not a code error. The error message is unambiguous: `sh: tsc: command not found` combined with `WARN Local package.json exists, but node_modules missing, did you mean to install?`. The shard coordinator's `__merge__` worktree was used for the type-check verification step but `pnpm install` had not been run in it, so `tsc` was not available on PATH. No implementation work was attempted — only the initial planning artifacts (orchestration.yaml and plan-01 markdown, 257 lines) landed on the feature branch. There is nothing to preserve via split, and nothing about the PRD itself is flawed — this is a pure environment setup failure that will not recur if the merge worktree is properly initialized before verification runs.

## Plans

| Plan | Status | Error |
|------|--------|-------|
| plan-01-rename-backend-to-harness | failed | Shard coordinator verification failed (pnpm type-check): > eforge-monorepo@ type-check /Users/markschaake/projects/eforge-build/eforge-replace-backend-with-harness-across-the-eforge-mcp-http-skill-stack-worktrees/__merge__ > pnpm -r type-check Scope: 6 of 7 workspace projects packages/engine type-check$ tsc --noEmit packages/engine type-check: sh: tsc: command not found /Users/markschaake/projects/eforge-build/eforge-replace-backend-with-harness-across-the-eforge-mcp-http-skill-stack-worktrees/__merge__/packages/engine:  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @eforge-build/engine@0.7.2 type-check: `tsc --noEmit` spawn ENOENT  WARN   Local package.json exists, but node_modules missing, did you mean to install?  ELIFECYCLE  Command failed with exit code 1.  WARN   Local package.json exists, but node_modules missing, did you mean to install? |

## Failing Plan

**Plan ID:** plan-01-rename-backend-to-harness
**Error:** Shard coordinator verification failed (pnpm type-check): > eforge-monorepo@ type-check /Users/markschaake/projects/eforge-build/eforge-replace-backend-with-harness-across-the-eforge-mcp-http-skill-stack-worktrees/__merge__
> pnpm -r type-check

Scope: 6 of 7 workspace projects
packages/engine type-check$ tsc --noEmit
packages/engine type-check: sh: tsc: command not found
/Users/markschaake/projects/eforge-build/eforge-replace-backend-with-harness-across-the-eforge-mcp-http-skill-stack-worktrees/__merge__/packages/engine:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @eforge-build/engine@0.7.2 type-check: `tsc --noEmit`
spawn ENOENT
 WARN   Local package.json exists, but node_modules missing, did you mean to install?
 ELIFECYCLE  Command failed with exit code 1.
 WARN   Local package.json exists, but node_modules missing, did you mean to install?

## Landed Commits

| SHA | Subject | Author | Date |
|-----|---------|--------|------|
| `d313cb16` | plan(replace-backend-with-harness-across-the-eforge-mcp-http-skill-stack): initial planning artifacts | Mark Schaake | 2026-04-28T11:34:15-07:00 |

## Models Used

- claude-opus-4-7

## Completed Work

- Initial planning artifacts committed: orchestration.yaml and plan-01-rename-backend-to-harness.md (257 lines total)

## Remaining Work

- Section A: Rename engine helpers createBackendProfile → createAgentRuntimeProfile and deleteBackendProfile → deleteAgentRuntimeProfile in packages/engine/src/config.ts; update callers in packages/monitor/src/server.ts
- Section B: Bump DAEMON_API_VERSION from 9 to 10 in packages/client/src/api-version.ts
- Section B: Rename all Backend* client types (BackendProfileInfo, BackendListResponse, BackendShowResponse, BackendUseRequest, BackendCreateRequest, etc.) and their backend: fields to harness: in packages/client/src/types.ts
- Section B: Update re-exports in packages/client/src/index.ts to match new type names
- Section B: Update packages/client/src/api/profile.ts header and type imports
- Section B: Rename sanitizeProfileName parameter backend → harness in packages/client/src/profile-utils.ts; preserve legacy backend? field in parseRawConfigLegacy
- Section B: Rename body.backend → body.harness, query ?backend= → ?harness=, resolved.backend → resolved.harness in packages/monitor/src/server.ts
- Section C: Rename Zod params, descriptions, internal vars in eforge_profile, eforge_models, and eforge_init MCP tools in packages/eforge/src/cli/mcp-proxy.ts
- Section D: Mirror all Section C changes in packages/pi-eforge/extensions/eforge/index.ts including status-footer harness: label
- Section E: Update eforge-plugin/skills/init/init.md with harness language and multi-harness hand-off pointer
- Section E: Update packages/pi-eforge/skills/eforge-init/SKILL.md to mirror init skill changes
- Section E: Update eforge-plugin/skills/profile-new/profile-new.md with harness language and multi-entry note
- Section E: Update packages/pi-eforge/skills/eforge-profile-new/SKILL.md to mirror profile-new skill changes
- Update any test fixtures in test/ that reference BackendProfile*, backend: 'pi', or backend: 'claude-sdk'

## Risks

- If the merge worktree initialization issue is systemic (not a one-off), the same environment failure could recur on retry — but the error is highly specific to missing node_modules, suggesting a transient setup race or omission
- The rename touches many files across the monorepo; TypeScript compilation is the intended safety net — ensuring the merge worktree runs pnpm install before type-check is critical to catching regressions

## Diff Stat

```
.../orchestration.yaml                             | 105 ++++++++++++++
 .../plan-01-rename-backend-to-harness.md           | 152 +++++++++++++++++++++
 2 files changed, 257 insertions(+)
```
