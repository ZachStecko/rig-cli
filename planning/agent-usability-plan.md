# Agent usability plan: let coding agents drive rig

Goal: a Claude Code (or any agent) session can run every rig command
without a human at the keyboard, and can parse the result without
scraping decorated log lines.

Status: proposed. Awaiting sign-off.

## Where rig stands today (surveyed 2026-08-14, v0.2.1)

| Command | Agent-usable today? | Blocker |
|---|---|---|
| `rig branch <n>` | Yes | Output is decorated text only |
| `rig pr [--issue N]` | Yes | PR URL must be scraped from a log line |
| `rig setup-labels` | Yes | None |
| `rig grab <n>` | No | Copies to clipboard; prints only when clipboard is missing |
| `rig create-issue` | No | Interactive multiline prompt plus y/n confirm |
| `rig story` | No | Interactive prompt plus two confirms |

Two structural findings:

1. **The LLM step is a cost for agents, not a feature.** An agent can
   write the title, body, and labels itself. For agents, the Kimi call
   adds latency, a `MOONSHOT_API_KEY` requirement in the agent's shell,
   and nondeterminism. rig's durable value to an agent is the chore
   layer: labels, branch naming, issue-to-PR linking, `gh` plumbing.
2. **All output goes to stdout as decorated text** (chalk, ora, headers).
   There is no machine-readable mode. Agents must regex
   `Issue #(\d+)` out of styled logs.

Piping stdin into `rig create-issue` (description, `EOF` line, `y`)
may work by accident, but it is undocumented, fragile, and still
requires the API key. Do not build agent workflows on it.

## Tickets

### R1 — Non-interactive `create-issue`

**Build.** Flags: `--title <t>`, `--body <b>`, `--body-file <path>`
(`-` reads stdin), repeatable `--label <l>`, `--yes` to skip the
confirm. When `--title` and a body source are both given, skip the
LLM entirely and file the issue directly. When only raw text is given
(`--body-file` without `--title`), keep the LLM structuring path.
**Accept.** `rig create-issue --title X --body-file plan.md --yes`
files an issue with no prompt, no API key, and exits 0. Missing
`--yes` in a non-TTY session fails fast with a clear message instead
of hanging.

### R2 — `--json` output mode

**Build.** Global `--json` flag. On success, stdout carries exactly one
JSON object (`{"number": 43, "url": "...", "title": "...", "labels":
[...]}` for issues; `{"url": ...}` for PRs; `{"branch": ...}` for
branch). All human decoration moves to stderr. Suppress the spinner
and color when stdout is not a TTY (respect `NO_COLOR`).
**Accept.** `rig create-issue ... --json | jq .number` returns the
issue number. Same for `pr` and `branch`.

### R3 — `grab` prints to stdout

**Build.** `--print` flag, plus auto-print when stdout is not a TTY.
`--json` emits `{number, title, body, labels, url}`.
**Accept.** `rig grab 42 --json` returns the issue as JSON with no
clipboard involvement.

### R4 — Non-interactive `story`

**Build.** `--file <spec.md>` for input, `--yes` to skip both
confirms, `--json` emitting parent and child issue numbers. Keeps the
LLM (decomposition is the point of `story`), so document the
`MOONSHOT_API_KEY` requirement in the error path.
**Accept.** `rig story --file spec.md --yes --json` creates the parent
and children unattended and prints their numbers as JSON.

### R5 — `--dry-run`

**Build.** For `create-issue` and `story`: run everything up to the
GitHub write, print the would-be issue(s) as JSON, exit 0. This is the
agent's preview-and-confirm loop: dry-run, show the human, then rerun
with `--yes`.
**Accept.** `--dry-run` never calls `gh issue create` (test asserts
zero write calls) and its output matches what a real run would file.

### R6 — Agent docs and Claude Code skill

**Build.** `AGENTS.md` in the repo root: the four-command agent
workflow (`create-issue --json` → `branch` → implement → `pr --json`),
flag reference, exit codes, and the "skip the LLM, write your own
body" guidance. Ship `skills/rig/SKILL.md` that users drop into
`.claude/skills/`, and add a README section pointing at both.
**Accept.** A fresh Claude Code session pointed at `AGENTS.md` files
an issue and opens a PR with zero interactive prompts.

## Sequencing

R1 and R2 are the whole unlock: after them an agent can run the core
loop end to end. R3 through R5 are quality of life. R6 lands last so
it documents real flags, not planned ones.

Estimated size: small. The codebase is ~2.8k lines with clean
commander wiring; each ticket is a focused diff with tests in the
existing vitest suite.

## Quick checklist

- [ ] **R1** Non-interactive `create-issue`
- [ ] **R2** `--json` output mode
- [ ] **R3** `grab` prints to stdout
- [ ] **R4** Non-interactive `story`
- [ ] **R5** `--dry-run`
- [ ] **R6** Agent docs and Claude Code skill
