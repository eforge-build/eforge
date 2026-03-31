---
id: plan-01-rewrite-release-skill
name: Rewrite eforge-release skill with release notes and release type
depends_on: []
branch: implement-eforge-release-skill-with-release-notes-and-release-type/rewrite-release-skill
---

# Rewrite eforge-release skill with release notes and release type

## Architecture Context

The eforge-release skill is a standalone Claude Code skill file (`.claude/skills/eforge-release/SKILL.md`) that orchestrates the release process via shell commands. It has `disable-model-invocation: true`, meaning Claude executes the steps directly without additional LLM calls beyond the skill runner itself. The skill delegates commit message generation to `/git:commit-message-policy`.

This is a complete rewrite of the single skill file - expanding from a 4-step patch-only workflow to a 7-step workflow with configurable release types, release notes generation, changelog management, and GitHub Release creation.

## Implementation

### Overview

Replace the entire content of `SKILL.md` with the new 7-step workflow. The frontmatter changes to mention release type support and adds an `argument-hint`. The body expands from 4 steps to 7 steps with detailed instructions for argument parsing, release notes generation from git log, CHANGELOG.md maintenance, and GitHub Release creation.

### Key Decisions

1. **Default to patch** - When no argument is provided (`$ARGUMENTS` is empty or doesn't match `--patch`/`--minor`/`--major`), default to `patch`. This preserves backward compatibility with the current skill behavior.
2. **Noise filtering via regex patterns** - The skill specifies exact patterns to filter out eforge workflow commits (`enqueue(`, `cleanup(`, `plan(`, `Merge `, version bumps matching `^\w+ \d+\.\d+\.\d+$`, and `bump plugin version`). These are string-match rules, not conventional commit type filters.
3. **Semver increment via node -e** - Use inline Node.js to compute the next version from `package.json`'s current version rather than depending on an external semver package. Pattern: split version string, increment the relevant segment, join back.
4. **CHANGELOG.md trimming** - Cap at 20 `## [` sections to prevent unbounded growth. When trimmed, append a footer linking to GitHub Releases for historical entries.
5. **Release notes grouping by conventional commit type** - Group commits into sections (Features, Bug Fixes, Refactoring, Documentation, Maintenance, Other) based on the conventional commit prefix before the colon.

## Scope

### In Scope
- Complete rewrite of `.claude/skills/eforge-release/SKILL.md`
- Frontmatter updates: new description mentioning release types/notes, `argument-hint` for `--patch|--minor|--major`
- Step 1: Parse `$ARGUMENTS` for release type flag, default to `patch`
- Step 2: Check git status (unchanged logic from current skill)
- Step 3: Commit staged changes via `/git:commit-message-policy` (unchanged logic)
- Step 4: Generate release notes from git log with noise filtering, scope cleanup, deduplication, and grouping
- Step 5: Update/create CHANGELOG.md with new version entry, trim to 20 sections
- Step 6: Bump version with `pnpm version <type>` and push with tags
- Step 7: Create GitHub Release via `gh release create` and output summary

### Out of Scope
- Changes to any other files
- Adding npm dependencies
- Modifying CI workflows

## Files

### Modify
- `.claude/skills/eforge-release/SKILL.md` - Complete rewrite from 4-step patch-only workflow to 7-step workflow with release type selection, release notes generation, CHANGELOG.md management, and GitHub Release creation

## Verification

- [ ] Frontmatter `description` mentions release types and release notes (does not contain "patch version")
- [ ] Frontmatter `argument-hint` is `"[--patch|--minor|--major]"`
- [ ] Frontmatter `disable-model-invocation` remains `true`
- [ ] Step 1 parses `$ARGUMENTS` for `--patch`, `--minor`, `--major` and defaults to `patch`
- [ ] Step 2 checks git status with three outcomes: clean, all staged, unstaged/untracked (stop)
- [ ] Step 3 delegates to `/git:commit-message-policy` for committing staged changes
- [ ] Step 4 finds previous tag via `git describe --tags --abbrev=0` with fallback to `git rev-list --max-parents=0 HEAD`
- [ ] Step 4 collects commits via `git log $PREV_TAG..HEAD --oneline`
- [ ] Step 4 filters noise: version bumps (`^\w+ \d+\.\d+\.\d+$`), `enqueue(`, `cleanup(`, `plan(`, `Merge `, `bump plugin version`
- [ ] Step 4 strips `plan-NN-` prefixes from conventional commit scopes
- [ ] Step 4 deduplicates by description text (keeps first occurrence)
- [ ] Step 4 groups by conventional commit type: Features (`feat`), Bug Fixes (`fix`), Refactoring (`refactor`), Documentation (`docs`), Maintenance (`chore`/`ci`/`build`/`test`), Other
- [ ] Step 4 omits empty sections; uses "Maintenance release" when all commits filtered
- [ ] Step 5 computes new version via `node -e` semver increment on `package.json` version
- [ ] Step 5 creates CHANGELOG.md with `# Changelog` heading if it does not exist
- [ ] Step 5 prepends `## [X.Y.Z] - YYYY-MM-DD` entry after the heading
- [ ] Step 5 trims to 20 `## [` sections max with GitHub Releases footer if trimmed
- [ ] Step 5 commits CHANGELOG.md with message `docs: update CHANGELOG.md for vX.Y.Z`
- [ ] Step 6 runs `pnpm version <bump-type>` and `git push origin --follow-tags`
- [ ] Step 7 creates GitHub Release via `gh release create v<version> --title "v<version>" --notes "<release-notes>"`
- [ ] Step 7 reports new version, release type, GitHub release link, and npm publish reminder
