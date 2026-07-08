---
id: direct-base-sync-budget-config
name: Direct base-sync budget configuration
branch: direct-pr-base-sync-recovery-ux/direct-base-sync-budget-config
---

# Direct base-sync budget configuration

Implement and synchronize the direct PR base-sync budget config surface: defaults, resolved counts, override precedence, lower/upper bounds, and clamping. Follow the existing config key naming/shape and derive exact bounds from current config owners.

## Traceability

Criteria: ac-001, ac-003, ac-006, ac-010
Aspects: ac-001:interface:config, ac-001:interface:configuration, ac-001:subsystem:config, ac-003:interface:config, ac-003:interface:configuration, ac-003:subsystem:config, ac-006:interface:config, ac-006:interface:configuration, ac-006:subsystem:config, ac-010:evidence:override-default-clamping, ac-010:interface:command-surface, ac-010:interface:config, ac-010:interface:configuration, ac-010:interface:test

## Validation

Author tests for defaults, explicit overrides, precedence, boundary clamps, and resolved count behavior; update existing docs that describe the changed config behavior.

## Fragment: Implementation plan for config override/default/clamping coverage

Add focused tests for ac-010's config override/default/clamping slice.

- Use temp project/config fixtures rather than the repo's live `eforge/config.yaml` as the default source.
- Cover absent compile config -> documented default budget values from `docs/config.md`.
- Cover explicit `eforge/config.yaml` compile values overriding defaults; include at least one value analogous to `compile.planningUnitParallelism: 4` from the delivered root config evidence.
- Cover clamping/validation for out-of-range values by deriving the exact expected bounds from the existing config resolver/schema. If no shared resolver exists, factor a small pure resolver so config loading and command/API overrides use one path.
- Where an existing command or direct build option can provide compile-budget overrides, add precedence tests modeled after `test/onsuccess-override-precedence.test.ts`: explicit override > config > default, with clamping applied after effective value selection.
- Validation: run the targeted Vitest suite(s), `pnpm type-check`, and keep broader `pnpm test` green if touched code is shared.
## Fragment: Configure direct PR base-sync attempt budget

- Locate the engine config schema/default normalizer and the direct PR base-sync recovery consumer.
- Add one named config option for the recovery conflict-attempt budget; absent config must continue to resolve to 12.
- Define centralized default/min/max constants used by parser, docs, tests, and message formatting.
- Validate invalid and non-integer values, and clamp or reject out-of-range values according to the existing config style with clear feedback.
- Pass the normalized count to exhausted-budget messaging so the text includes the configured count and suggests raising config or completing the rebase manually.
- Sync existing config docs and integration-facing config help if they enumerate config keys.