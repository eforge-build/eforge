---
id: plan-01-shipped-evidence-provider
name: Shipped Evidence Provider
branch: detect-shipped-backlog-items-from-git-and-pr-history/plan-01-shipped-evidence-provider
agents:
  builder:
    effort: high
    rationale: New deterministic evidence collection and confidence classification
      spans git subprocesses, optional PR metadata, and conservative matching
      rules.
  reviewer:
    effort: high
    rationale: Review must check bounded subprocess usage, fail-closed behavior, and
      false-positive classification.
---

# Shipped Evidence Provider

## Architecture Context

`eforge-plan` analyze-all currently builds a bounded JSON source packet from visible open backlog records and lifecycle traces, then sends that packet to a daemon-owned read-only planning task. This plan adds a deterministic, testable shipped-evidence layer that can be called by that source builder in the next plan. The layer must not mutate backlog data, must not require network access, and must cap all git/PR/context payloads.

No daemon/client route contracts change in this plan. The provider types stay extension-local because the evidence packet is embedded inside the existing opaque `sourceText` field rather than a new HTTP or daemon wire shape.

## Implementation

### Overview

Create a narrow shipped-evidence provider for open backlog items. It collects local reachable git history first, optionally enriches matched PR numbers through `gh pr view`, merges lifecycle trace rows when supplied, ranks candidates, and returns compact candidates plus diagnostics. All subprocess failures produce diagnostics and an empty or partial result instead of throwing through analyze-all.

### Key Decisions

1. **Local git is the baseline.** Use reachable `HEAD` history and recent merge commits as the authoritative landed-work signal. PR metadata only enriches candidates extracted from local evidence.
2. **Live PR enrichment, no cache in this slice.** Fetch PR details live with a short timeout when `gh` and auth are available. If `gh` is absent, unauthenticated, rate-limited, or times out, return git-only candidates with a diagnostic.
3. **Conservative confidence matrix.** Strong evidence requires a reachable merge/landing signal plus an exact item id/slug or near-exact title/branch/PR match and either aligned changed paths/excerpts or explicit PR metadata references. Similar wording without id/slug/branch/PR confirmation is ambiguous. Commit-only fuzzy similarity and unreachable/stale PRs are weak.
4. **Caps are part of the API.** Candidate counts, scanned commits, changed paths, PR enrichments, excerpts, excerpt bytes, branch hints, and diagnostics must all be capped by exported limits.

## Scope

### In Scope

- Extension-local shipped-evidence candidate types and provider interfaces.
- Normalization and matching utilities for item id/slug, near-title, branch-name, and broad false-positive classification.
- Bounded local git history collector for reachable merge commits, commit subjects, short hashes, branch-ish hints, changed paths, and short excerpts.
- Optional `gh` PR metadata enrichment with timeout and fail-closed behavior.
- Lifecycle trace candidate conversion from existing trace summary rows when supplied by the caller.
- Unit tests and git-fixture tests for matching, confidence, caps, and PR fallback.

### Out of Scope

- Calling the provider from analyze-all source assembly.
- Prompt changes or curation draft application changes.
- Workstation preview rendering.
- Persistent PR metadata caching.
- Full diff ingestion.

## Files

### Create

- `eforge/extensions/eforge-plan/shipped-evidence-types.ts` — exported candidate, source, confidence, caps, diagnostics, history-record, and provider interface types.
- `eforge/extensions/eforge-plan/shipped-evidence-matching.ts` — slug/title normalization, token scoring, signal counting, confidence classification, ranking, and citation formatting utilities.
- `eforge/extensions/eforge-plan/shipped-evidence-git.ts` — bounded git collector using `execFile` argv arrays for reachable commits, merge commits, branch hints, path summaries, and excerpts.
- `eforge/extensions/eforge-plan/shipped-evidence-pr.ts` — optional `gh pr view` metadata enrichment and GitHub remote parsing helpers, all fail-closed.
- `eforge/extensions/eforge-plan/shipped-evidence.ts` — provider orchestration that merges lifecycle, git, and PR evidence into ranked compact candidates.
- `eforge/extensions/eforge-plan/__tests__/shipped-evidence.test.ts` — normalization, matching, local git fixture, PR fallback, and cap tests.

### Modify

- No existing runtime integration files in this plan, except narrow imports/types if the implementation needs to keep shared extension-local types balanced.

## Implementation Notes

- Keep each new implementation file under 600 lines. If any new file exceeds 300 lines, add durable semantic `// --- eforge:region <slug> ---` markers with balanced end markers.
- Use `execFile` with argv arrays, never shell interpolation.
- Use `git rev-parse --is-inside-work-tree` before collection and return `gitUnavailable` diagnostics when it fails.
- Prefer recent reachable history with `git log --date-order --max-count=<cap>` and merge commits with multiple parents.
- Extract PR numbers and branch-ish hints from merge subjects/bodies such as `Merge pull request #191 from owner/branch`.
- Excerpts must come from capped text snippets that match item tokens in changed files or commit/PR text; do not include full diffs.
- Return weak candidates from direct provider calls for tests, but expose helper functions that callers can use to omit weak candidates from model context.

## Verification

- [ ] `collectShippedEvidence` on a temp git repo with a reachable `--no-ff` merge commit and matching feature branch returns one `strong` `git-history` candidate with item id/title, short merge hash, merge subject, changed path, and citation.
- [ ] PR enrichment provider errors or timeouts return git-only candidates and a PR diagnostic; no exception escapes the provider.
- [ ] Unit tests cover exact item id/slug matches, near-title matches, branch-name matches, broad false positives, and weak commit-only similarities.
- [ ] A hand-crafted unreachable/stale PR record classifies as `weak` and never becomes `strong`.
- [ ] Candidate count, changed-path count, excerpt count, excerpt byte length, and PR enrichment caps are asserted in tests.
- [ ] Evidence excerpts in tests contain no full diff hunk bodies beyond the configured excerpt cap.