---
id: plan-01-release-skill
name: Extend eforge-release Skill with Release Notes & Release Type
depends_on: []
branch: extend-eforge-release-skill-with-release-notes-release-type/release-skill
---

# Extend eforge-release Skill with Release Notes & Release Type

## Architecture Context

The `/eforge-release` skill is a standalone Claude Code skill defined in a single SKILL.md file. It currently supports only patch releases with no release notes, no changelog, and no GitHub Release creation. This plan rewrites the skill to support configurable release types and auto-generated release notes.

Skills are declarative markdown files that Claude Code executes step-by-step. They have YAML frontmatter for metadata and markdown sections describing the workflow. The `disable-model-invocation: true` flag must be preserved since release workflows must not auto-trigger.

## Implementation

### Overview

Rewrite `.claude/skills/eforge-release/SKILL.md` to:
1. Parse `$ARGUMENTS` for `--patch`, `--minor`, `--major` flags (default: patch)
2. Keep existing git status check and staged commit steps
3. Add release notes generation from `git log` between previous tag and HEAD
4. Add rolling `CHANGELOG.md` update (prepend new entry, trim to 20 entries)
5. Replace hardcoded `pnpm version patch` with `pnpm version <bump-type>`
6. Add `gh release create` step
7. Enhance summary output

### Key Decisions

1. **Release notes use mechanical extraction, not LLM summarization** - commit messages already follow conventional commits, so grouping by type prefix is sufficient and deterministic.
2. **Noise filtering uses pattern matching on commit subjects** - patterns include `enqueue(`, `cleanup(`, `plan(`, version bumps (`^\w+ \d+\.\d+\.\d+$`), `Merge `, and `bump plugin version`.
3. **Deduplication by description text** - eforge workflow produces duplicate `feat(plan-NN-...)` messages when builds retry; keep only the first occurrence of each description.
4. **Changelog commit is separate from version bump** - `git add CHANGELOG.md && git commit -m "docs: update CHANGELOG.md for vX.Y.Z"` runs before `pnpm version` so the version bump commit stays clean.
5. **Rolling window of 20 entries** - keeps CHANGELOG.md scannable; older entries trimmed with a pointer to GitHub Releases.
6. **Scope stripping from conventional commit scopes** - strip `plan-NN-` prefixes from scopes (e.g., `feat(plan-01-foo)` becomes `feat(foo)`).

## Scope

### In Scope
- Update SKILL.md frontmatter (`description`, `argument-hint`)
- Argument parsing for `--patch`, `--minor`, `--major`
- Release notes generation from `git log` with noise filtering, deduplication, and conventional commit grouping
- Rolling `CHANGELOG.md` creation/update with 20-entry trim
- `gh release create` with generated notes
- Enhanced summary with version, release type, GitHub release link, npm publish reminder

### Out of Scope
- Changes to any file other than `.claude/skills/eforge-release/SKILL.md`
- LLM-based summarization of commits
- npm publish automation
- Changes to the GitHub Action that handles npm publish

## Files

### Modify
- `.claude/skills/eforge-release/SKILL.md` - Complete rewrite of skill workflow to add release type selection, release notes generation, CHANGELOG.md management, and GitHub Release creation

## Verification

- [ ] Frontmatter `argument-hint` is set to `"[--patch|--minor|--major]"`
- [ ] Frontmatter `description` mentions release notes and does not say "patch" specifically
- [ ] Frontmatter `disable-model-invocation: true` is preserved
- [ ] Step 1 parses `$ARGUMENTS` for `--major`, `--minor`, `--patch` flags; defaults to patch when no flag is provided
- [ ] Git status check step lists three outcomes: clean, all staged, unstaged/untracked (stop)
- [ ] Staged commit step uses `/git:commit-message-policy` skill (preserved from current version)
- [ ] Release notes step finds previous tag via `git describe --tags --abbrev=0` with fallback to root commit
- [ ] Release notes step collects commits via `git log $PREV_TAG..HEAD --oneline`
- [ ] Noise filter patterns match: version bumps (`^\w+ \d+\.\d+\.\d+$`), `enqueue(`, `cleanup(`, `plan(`, `Merge `, `bump plugin version`
- [ ] Commit messages are cleaned: hash stripped, `plan-NN-` removed from scopes, description extracted after `: `
- [ ] Commits are deduplicated by description text (first occurrence kept)
- [ ] Commits are grouped by conventional commit type into markdown sections (`### Features`, `### Bug Fixes`, `### Refactoring`, `### Performance`, etc.)
- [ ] Empty sections are omitted from output
- [ ] When no meaningful commits remain after filtering, release notes default to "Maintenance release"
- [ ] CHANGELOG.md is created with `# Changelog` heading if it does not exist
- [ ] New changelog entry uses format `## [X.Y.Z] - YYYY-MM-DD` and is prepended after the `# Changelog` heading
- [ ] CHANGELOG.md is trimmed to 20 `## [` sections maximum; excess entries are removed and a footer links to GitHub Releases
- [ ] Changelog is committed via `git add CHANGELOG.md && git commit -m "docs: update CHANGELOG.md for vX.Y.Z"` before `pnpm version`
- [ ] `pnpm version <bump-type>` uses the resolved bump type (patch, minor, or major)
- [ ] `git push origin --follow-tags` runs after version bump
- [ ] `gh release create v<new-version> --title "v<new-version>" --notes "<release-notes>"` is called
- [ ] Summary reports: new version, release type, GitHub release link, npm publish reminder
