# rig-cli

![rig-cli logo](./assets/logo.png)

AI-assisted GitHub issue creation and PR opening. rig handles the chores around your code: it turns plans into well-formed GitHub issues, and finished branches into well-formed pull requests. You implement with whatever coding tool you prefer.

---

## Workflow

```
rig create-issue  →  implement with your own tools  →  rig pr
```

1. **`rig create-issue`** — paste a plan in plain text. AI structures it into a GitHub issue with title, body, and labels.
2. **Implement** — pick up the issue with your editor, Claude Code, Cursor, or anything else. Name the branch `issue-42-short-slug`.
3. **`rig pr`** — pushes the branch, generates a PR body from the issue and commits, and opens (or updates) the PR.

For a full spec or PRD, use **`rig story`** instead of `create-issue`. It creates one parent story issue plus a set of small, independently implementable child issues.

---

## Install

**Requirements:** Node.js 20+, [GitHub CLI](https://cli.github.com/) (`gh`), Git. For AI calls: the [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude`) or an `ANTHROPIC_API_KEY`.

```bash
npm install -g rig-cli
```

---

## Commands

### `rig create-issue`

Describe an issue in plain text. AI structures it into a proper GitHub issue with title, body, and labels, shows a preview, and files it after you confirm.

```bash
rig create-issue
```

### `rig story`

Paste a planning spec or PRD. AI creates a parent story issue plus atomic child issues, each sized for one branch and one PR. You confirm before each step.

```bash
rig story
```

### `rig pr`

Create or update a pull request for the current branch. The linked issue comes from `--issue`, or from the branch name (`issue-42-slug`, `42-slug`, or `feat/42-slug`). The PR body is generated from the issue and commit history.

Date-like branch names (`2025-08-cleanup`, `8-15-hotfix`) are not treated as issue numbers — pass `--issue` for those. The command refuses to run on `main`, `master`, or the configured base branch.

```bash
rig pr
rig pr --issue 42
```

### `rig setup-labels`

Create rig's label set on the GitHub repo. Safe to run more than once.

```bash
rig setup-labels
```

---

## Configuration

Create `.rig.yml` in your project root. All fields are optional; missing values use defaults.

```yaml
agent:
  provider: binary   # 'binary' (Claude CLI, default) or 'sdk' (API key)
  timeout: 120       # seconds per AI call

git:
  base_branch: main  # auto-detected if omitted (main or master)

defaultLabels: []    # labels added to every created issue

# Optional: a markdown style guide injected into every AI prompt, so
# generated issues follow your writing rules. Relative to the project
# root; ~/ expands to your home directory.
style_file: ~/style/writing-rules.md

verbose: false
```

---

## AI Providers

**Binary** (default): Spawns the official `claude` CLI. Works with a Claude subscription. No API key needed.

**SDK**: Uses the Anthropic API directly. Requires `ANTHROPIC_API_KEY`. Set `provider: sdk` in `.rig.yml`.

AI is used only for text generation — issue bodies and spec decomposition. rig never runs an agent on your code.

---

## Disclaimer

rig-cli is an unofficial third-party tool created by Zach Stecko. Not affiliated with or endorsed by Anthropic. You must have your own Claude subscription or API key and comply with [Anthropic's Terms of Service](https://www.anthropic.com/legal/consumer-terms).

## License

MIT
