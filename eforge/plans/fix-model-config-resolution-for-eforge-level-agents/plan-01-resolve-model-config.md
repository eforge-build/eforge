---
id: plan-01-resolve-model-config
name: Resolve Model Config for Eforge-Level Agents
dependsOn: []
branch: fix-model-config-resolution-for-eforge-level-agents/resolve-model-config
---

# Resolve Model Config for Eforge-Level Agents

## Architecture Context

Seven agents launched from `eforge.ts` bypass `resolveAgentConfig()`, so the SDK receives `model: undefined` and falls back to its own default. Pipeline agents in `pipeline.ts` already follow the correct pattern: call `resolveAgentConfig(role, config, backend)` and spread the result into agent options. This plan replicates that pattern at the 7 eforge-level call sites.

## Implementation

### Overview

Add `resolveAgentConfig` to the existing import from `./pipeline.js` in `eforge.ts`, then add a resolve-and-spread at each of the 7 agent call sites. Each agent's options interface already extends `SdkPassthroughConfig`, so the spread is type-safe. Inside each agent, `pickSdkOptions(options)` already strips undefined fields before passing to `backend.run()`.

### Key Decisions

1. **Spread resolved config into existing options objects** - follows the exact pattern used by pipeline agents (e.g., `runPlanner`, `runBuilder`). No changes needed to agent internals.
2. **No changes to gap-closer.ts** - it already calls `resolveAgentConfig` internally for `maxTurns`. After this change, the model arrives via the spread from `eforge.ts`. The internal resolve call is harmless (kept for `maxTurns`), and `pickSdkOptions(options)` passes the model through from caller options.
3. **Role names match existing agent role strings** - each `resolveAgentConfig` call uses the same role string the agent already uses internally or that matches its identity (e.g., `'formatter'`, `'dependency-detector'`, `'staleness-assessor'`, `'prd-validator'`, `'validation-fixer'`, `'merge-conflict-resolver'`, `'gap-closer'`).

## Scope

### In Scope
- `src/engine/eforge.ts` - add `resolveAgentConfig` import, add resolve+spread at 7 call sites

### Out of Scope
- Changes to `gap-closer.ts` (no modification needed)
- Changes to pipeline agents (already working)
- Changes to agent option interfaces or `pickSdkOptions`

## Files

### Modify
- `src/engine/eforge.ts` - Add `resolveAgentConfig` to the import from `./pipeline.js`. At each of the 7 agent call sites, add a `const agentConfig = resolveAgentConfig(role, config, config.backend)` call and spread `...agentConfig` into the agent options object. Specific call sites:
  1. ~line 360: `runFormatter` - use `this.config`, role `'formatter'`
  2. ~line 394: `runDependencyDetector` - use `this.config`, role `'dependency-detector'`
  3. ~line 555: `runValidationFixer` - use local `config`, role `'validation-fixer'`
  4. ~line 587: `runMergeConflictResolver` - use local `config`, role `'merge-conflict-resolver'`
  5. ~line 635: `runPrdValidator` - use local `config`, role `'prd-validator'`
  6. ~line 668: `runGapCloser` - use local `config`, role `'gap-closer'`
  7. ~line 807: `runStalenessAssessor` - use `this.config`, role `'staleness-assessor'`

## Verification

- [ ] `pnpm build` compiles with zero errors
- [ ] `pnpm test` passes all existing tests
- [ ] `resolveAgentConfig` is imported from `./pipeline.js` in `eforge.ts`
- [ ] Each of the 7 call sites has a `resolveAgentConfig()` call immediately before the agent invocation
- [ ] Each of the 7 call sites spreads the resolved config (`...agentConfig`) into the agent options object
- [ ] No changes made to any file other than `src/engine/eforge.ts`
