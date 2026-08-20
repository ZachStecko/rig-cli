---
name: rig
description: Use the rig CLI for the GitHub issue-to-PR workflow. Trigger when asked to work on an issue ("do issue 22", "pick up #22"), start a branch for an issue, or open a PR for finished work. Also trigger when asked to create issues or decompose a plan into issues — those flows are interactive and must be handed back to the human.
---

# rig

rig is a globally installed CLI that runs the GitHub issue-to-PR
workflow for the current repo. It talks to GitHub through `gh` and uses
an LLM provider (Groq by default) for AI text generation. It
needs the provider's API key in the environment (`GROQ_API_KEY` for
the default provider) and an authenticated `gh`. Optional config lives
in `.rig.yml` at the repo root.

## Commands you can run

### Start work on issue N

```bash
rig branch 22
```

- Creates `<type>/issue-22-<slug>` off the latest remote base branch
  and pushes it to origin. The type comes from the issue's type label
  (`bug` → `fix`, `feature` → `feat`). The slug is AI-generated.
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

- Pushes the branch, then creates or updates the PR. The body is
  generated from the issue sections and the commit log — do not write
  a PR body yourself.
- It refuses to run on the base branch (`master`/`main`). If the
  branch name has no issue number, pass `--issue 22`.
- Rerunning it is safe: it updates the existing PR.

### File an issue

Write the raw description to a file, then:

```bash
rig create-issue --file /tmp/issue.md --yes
```

The AI structures the description into a titled, labeled issue and
files it. Do not pre-structure the file into sections — write plain
prose and let rig do the structuring. Do not substitute
`gh issue create`.

### Decompose a plan into issues

Write the full spec/PRD to a file, then:

```bash
rig story --file /tmp/spec.md --yes
```

Creates a parent story issue plus atomic child issues. Use this for
multi-issue plans; use `create-issue` for a single piece of work.

### One-time repo setup

```bash
rig setup-labels
```

Creates rig's label set. Safe to rerun.

## Rules

- Never run `rig create-issue` or `rig story` WITHOUT `--file` and
  `--yes`: the interactive forms read from the terminal and will hang
  or self-cancel under an agent.
- `--yes` files issues without a human preview. Only use it when the
  human asked you to create the issue(s); otherwise show them the
  description first.

## The full loop

1. Issues are filed with `rig create-issue` or `rig story`
   (by the human, or by you with `--file`/`--yes` when asked).
2. You: `rig branch <n>` → `gh issue view <n>` → implement → commit
   (follow the repo's commit conventions) → `rig pr`.
3. Human reviews and merges the PR.
