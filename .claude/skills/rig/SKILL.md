---
name: rig
description: >
  Use the rig CLI for the GitHub issue-to-PR workflow. Trigger when asked to
  work on an issue ("do issue 22", "pick up issue 22"), create an issue or
  story, or open a PR. You draft all content; rig validates and files it.
---

# rig

rig is a globally installed CLI that runs the GitHub issue-to-PR
workflow for the current repo. It talks to GitHub through `gh` and
needs an authenticated `gh` — nothing else. rig makes no AI calls: you
draft every issue and PR body yourself (you have the repo context), and
rig validates the format and files it verbatim. Optional config lives
in `.rig.yml` at the repo root.

## Commands you can run

### Start work on issue N

```bash
rig branch 22
```

- Creates `<type>/issue-22-<slug>` off the latest remote base branch
  and pushes it to origin. The type comes from the issue's type label
  (`bug` → `fix`, `feature` → `feat`). The slug is derived from the
  issue title.
- If a branch for the issue already exists, it switches to it instead.
- Never invent branch names by hand. `rig pr` parses the issue number
  from the branch name, so the `issue-<n>` segment must be exact.

Then read the issue content directly:

```bash
gh issue view 22
```

(`rig grab 22` copies the issue to the clipboard — that is for humans
pasting into a chat, not for you. Use `gh issue view`.)

### Open or update the PR

After implementing and committing on the issue branch:

```bash
rig pr
```

- Pushes the branch, then creates or updates the PR. By default the
  body is generated from the issue sections and the commit log.
- Better: draft the body yourself and pass it verbatim:

```bash
rig pr --body-file /tmp/pr-body.md
```

  Write the body as a reviewer's guide, from the diff you just made:
  start with the one file that carries the real risk and why; then an
  ordered review path (each entry: file, ~minutes, what to verify,
  why it matters); then a "skip without loss" list for mechanical or
  generated files; end with a total time estimate and a concrete first
  action. Add one small ASCII diagram only when the change has real
  structure (pipeline, seam, data flow). No status-report sections, no
  exhaustive testing bullets — one line on verification is enough.
- It refuses to run on the base branch (`master`/`main`). If the
  branch name has no issue number, pass `--issue 22`.
- Rerunning it is safe: it updates the existing PR.

### File an issue

Draft the full structured issue yourself, write it to a file, then:

```bash
rig create-issue --file /tmp/issue.md --yes
```

File format — front-matter labels, one H1 title, body verbatim:

```markdown
---
labels: [backend, enhancement]
---
# cli: Imperative title with component prefix

## Problem / Motivation
Concrete symptom or gap. 2 paragraphs max.

## Implementation Details
File paths, function names, type signatures. Only reference files you
have verified exist — never invent paths.

## Acceptance Criteria
- Observable, binary pass/fail outcomes
```

The three sections above are required; rig exits nonzero naming any
that are missing. Add `## Approach`, `## Testing Strategy`,
`## Dependencies`, `## Notes` when they earn their place. Extra labels:
repeat `--label <label>`.

You are the author: ground every file path and symbol in the actual
codebase before writing it. Do not substitute `gh issue create` — rig
validates the format and applies the label set.

### File a story with child issues

Decompose the spec yourself into a parent story plus atomic children,
write one file, then:

```bash
rig story --file /tmp/story.md --yes
```

File format:

```markdown
---
labels: [feature]
---
# Story title

Story body summarizing the whole effort.

## Issue: First child title
labels: [backend]
Child body — small, independently implementable.

## Issue: Second child title
Child body...
```

Each `## Issue:` heading starts a child; the optional `labels: [...]`
line directly under it sets that child's labels. rig files the parent
first, then each child with a "Part of #<parent>" reference. Order
children by implementation dependency. Use `story` for multi-issue
plans; use `create-issue` for a single piece of work.

### One-time repo setup

```bash
rig setup-labels
```

Creates rig's label set. Safe to rerun.

## Rules

- Never run `rig create-issue` or `rig story` WITHOUT `--file` and
  `--yes`: the interactive confirmation reads from the terminal and
  will hang or self-cancel under an agent.
- `--yes` files issues without a human preview. Only use it when the
  human asked you to create the issue(s); otherwise show them the
  drafted file first.
- You draft, rig files. Structure the content yourself with verified
  file paths; rig never rewrites what you give it.

## The full loop

1. Issues are filed with `rig create-issue` or `rig story`
   (by the human, or by you with `--file`/`--yes` when asked).
2. You: `rig branch <n>` → `gh issue view <n>` → implement → commit
   (follow the repo's commit conventions) → draft the PR body →
   `rig pr --body-file <path>`.
3. Human reviews and merges the PR.
