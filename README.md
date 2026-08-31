# rig-cli

![rig-cli logo](./assets/logo.png)

GitHub issue filing and PR opening for coding agents. rig handles the chores around your code: it files agent-authored issue files as well-formed GitHub issues, and turns finished branches into pull requests. Your coding agent drafts the content — it has the repo context — and rig validates and files it.

A side benefit: every change follows a traceable path from issue to branch to pull request. That paper trail doubles as change-management evidence for compliance frameworks like SOC 2.

---

## Workflow

```
rig create-issue  →  implement with your own tools  →  rig pr
```

1. **`rig create-issue`** — your coding agent writes a structured issue file; rig validates it and files it with title, body, and labels.
2. **Implement** — pick up the issue with your editor, Claude Code, Cursor, or anything else. Name the branch `issue-42-short-slug` (or let `rig branch` do it).
3. **`rig pr`** — pushes the branch, builds a PR body from the issue and commits (or takes one verbatim with `--body-file`), and opens or updates the PR.

For a full spec or PRD, use **`rig story`** instead of `create-issue`. It files one parent story issue plus the pre-decomposed child issues from the same file.

---

## Install

**Requirements:** Node.js 20+, [GitHub CLI](https://cli.github.com/) (`gh`), Git. No API keys.

```bash
npm install -g rig-cli
```

---

## Commands

### `rig create-issue`

File a structured issue file verbatim. The file format: optional YAML front matter with labels, one H1 title, then the body. The body must contain the `## Problem / Motivation`, `## Implementation Details`, and `## Acceptance Criteria` sections; rig exits nonzero naming any missing section. Shows a preview and files after you confirm; pass `--yes` for non-interactive use.

```markdown
---
labels: [backend, enhancement]
---
# cli: Add clipboard support

## Problem / Motivation
...

## Implementation Details
...

## Acceptance Criteria
...
```

```bash
rig create-issue --file issue.md --yes
rig create-issue --file issue.md --label P1 --label backend
```

### `rig story`

File a story file: a parent story plus its pre-decomposed child issues. Children are marked with `## Issue: <title>` headings, each with an optional `labels: [...]` first line. Each child is filed with a `Part of #<parent>` reference.

```markdown
---
labels: [feature]
---
# Build the widget system

Story body...

## Issue: Add the widget model
labels: [backend]
Child body...

## Issue: Wire the widget API
Child body...
```

```bash
rig story --file story.md --yes
```

### `rig grab`

Copy an issue's title and body to the clipboard, ready to paste into your coding tool (Claude Code, Cursor, etc.). With no argument, lists open issues and prompts you to pick one. Prints the issue instead if no clipboard is available.

```bash
rig grab 42
rig grab      # pick from open issues
```

### `rig branch`

Create a working branch for an issue off the latest base branch (fetched from origin when available), then push it to origin with upstream tracking. Branches follow `<type>/issue-<n>-<slug>` in lowercase kebab-case: the type comes from the issue's type label (`bug` → `fix`, `feature` → `feat`, etc.), and the slug is derived from the issue title. If a branch for the issue already exists, switches to it instead.

```
fix/issue-21-handle-empty-clipboard
feat/issue-34-add-issue-picker
```

```bash
rig branch 21
```

### `rig pr`

Create or update a pull request for the current branch. The linked issue comes from `--issue`, or from the branch name (`issue-42-slug`, `42-slug`, or `feat/42-slug`). The PR body is generated from the issue and commit history, or taken verbatim from `--body-file` — use that to give reviewers an agent-drafted review guide instead of a template.

Date-like branch names (`2025-08-cleanup`, `8-15-hotfix`) are not treated as issue numbers — pass `--issue` for those. The command refuses to run on `main`, `master`, or the configured base branch.

```bash
rig pr
rig pr --issue 42
rig pr --body-file pr-body.md
```

### `rig setup-labels`

Create rig's label set on the GitHub repo. Safe to run more than once.

```bash
rig setup-labels
```

---

## Configuration

Create `.rig.yml` in your project root. All fields are optional; missing values use defaults. No environment variables are required.

```yaml
git:
  base_branch: main  # auto-detected if omitted (main or master)

defaultLabels: []    # labels added to every created issue

verbose: false
```

---

## Claude Code skill

The repo ships an agent-facing skill at [`.claude/skills/rig/SKILL.md`](./.claude/skills/rig/SKILL.md) that teaches Claude Code the rig workflow: how to draft the structured issue and story files, which commands to run for "pick up issue 22" or "open a PR", and which flags (`--file`, `--yes`) keep the interactive commands from hanging under an agent. Copy the `rig` folder into your own project's `.claude/skills/` directory to use it there.

---

## Disclaimer

rig-cli is an unofficial third-party tool created by Zach Stecko.

## License

MIT
