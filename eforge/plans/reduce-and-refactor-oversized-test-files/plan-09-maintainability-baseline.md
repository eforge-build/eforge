---
id: plan-09-maintainability-baseline
name: Remove Stale Test Baseline Entries and Run Final Gates
branch: reduce-and-refactor-oversized-test-files/plan-09-maintainability-baseline
---

# Remove Stale Test Baseline Entries and Run Final Gates

## Architecture Context

`scripts/agent-maintainability-baseline.json` is the ratchet for legacy files above the repository caps. After plans 01-08 reduce all targeted tests below the 1,000-line working cap and below the 1,200-line policy cap, stale `category: "test"` exemptions must be removed so future growth fails fast.

## Implementation

### Overview

Run a final line-count scan for all test files outside `node_modules/`, `dist/`, and `.git`. Remove test baseline entries for files that are now 1,200 lines or fewer. Because the goal requires zero test files above 1,000 lines, the final scan must fail if any `*.test.ts` remains above 1,000 lines.

### Key Decisions

1. Remove stale test entries in one final plan to avoid baseline merge conflicts across the independent refactor plans.
2. Keep implementation-file baseline entries unchanged.
3. Treat any remaining over-1,000-line test file as a failed prerequisite rather than preserving a stale test exemption.

## Scope

### In Scope

- Modify `scripts/agent-maintainability-baseline.json` after the split plans have landed.
- Remove all `category: "test"` entries whose files are now at or below 1,200 lines.
- Run the final global line-count gate, maintainability check, type-check, and test suite.

### Out of Scope

- Lowering implementation-file ceilings.
- Adding new baseline exemptions for test files.
- Changing maintainability scripts or Vitest include patterns.

## Files

### Modify

- `scripts/agent-maintainability-baseline.json` — remove stale test exemptions after confirming all split test files are below the policy cap.

## Verification

- [ ] `find . \( -path './node_modules' -o -path './dist' -o -path './.git' \) -prune -o -name '*.test.ts' -print0 | xargs -0 wc -l | awk '$2 != "total" && $1 > 1000 { found=1; print } END { exit found }'` exits 0 with no over-limit file output.
- [ ] `node -e "const b=require('./scripts/agent-maintainability-baseline.json'); if (b.files.some(f => f.category === 'test')) { console.error(b.files.filter(f => f.category === 'test').map(f => f.path).join('\n')); process.exit(1); }"` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.