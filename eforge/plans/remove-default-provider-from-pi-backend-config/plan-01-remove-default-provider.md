---
id: plan-01-remove-default-provider
name: Remove Default Provider from Pi Backend Config
depends_on: []
branch: remove-default-provider-from-pi-backend-config/remove-default-provider
---

# Remove Default Provider from Pi Backend Config

## Architecture Context

The Pi backend (`src/engine/backends/pi.ts`) currently falls back to `openrouter` when no provider is configured. The `PiConfig` type and `DEFAULT_CONFIG` in `src/engine/config.ts` also encode this default. Since Pi supports 23 providers, silently defaulting to one is an opinionated choice - users should explicitly declare their provider.

## Implementation

### Overview

Remove the `openrouter` default from three locations: `resolveModel` in `pi.ts`, `DEFAULT_CONFIG.pi` in `config.ts`, and `resolveConfig` in `config.ts`. Make `provider` optional in the `PiConfig` type. Add a runtime error when provider is missing.

### Key Decisions

1. Throw a descriptive error in `resolveModel` when `piConfig?.provider` is undefined, guiding users to set `pi.provider` in `eforge/config.yaml`.
2. Make `provider` optional in `PiConfig` rather than required-with-no-default, since the config merge chain produces `PiConfig` objects that may lack a provider until runtime validation catches it.
3. Handle `getModel` returning `undefined` for unknown provider/model combos by checking the result before the fallback path.

## Scope

### In Scope
- Remove `'openrouter'` fallback in `resolveModel` (`pi.ts` line 99) and throw if provider is missing
- Update JSDoc comment on `resolveModel` (`pi.ts` line 94) to remove "defaults to 'openrouter'"
- Guard `getModel` return value against `undefined` (`pi.ts` line 102)
- Make `provider` optional in `PiConfig` type (`config.ts` line 307)
- Remove `provider: 'openrouter'` from `DEFAULT_CONFIG.pi` (`config.ts` line 395)
- Remove provider fallback in `resolveConfig` (`config.ts` line 505)

### Out of Scope
- The main bug fix from commit d0e5feb (already completed)
- Any other Pi backend changes or features

## Files

### Modify
- `src/engine/backends/pi.ts` - Remove `openrouter` fallback in `resolveModel`, update JSDoc, guard `getModel` return value
- `src/engine/config.ts` - Make `provider` optional in `PiConfig`, remove default from `DEFAULT_CONFIG.pi`, remove fallback in `resolveConfig`

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes with zero failures
- [ ] `resolveModel` throws `Error` with message containing "No provider configured for Pi backend" when `piConfig.provider` is undefined
- [ ] No occurrence of the string `'openrouter'` remains in `src/engine/backends/pi.ts`
- [ ] No occurrence of `provider: 'openrouter'` remains in `src/engine/config.ts`
- [ ] `PiConfig.provider` is typed as `string | undefined` (optional field)
