#### still in beta — use at your own risk

# rig-cli

![rig-cli logo](./assets/logo.png)

Automates the GitHub issue-to-PR pipeline using Claude Code.

---

## Workflow

:

```bash
# 1. Plan with Claude Code (you do this manually in your editor)
#    Discuss the feature, hash out the approach, agree on a plan.

# 2. File the plan as a GitHub issue
rig create-issue
# Copy the plan you made into the prompt.

# 3. Ship it — picks the issue, implements, tests, and opens a PR
rig ship
# pick → branch → implement → test → pr → review

# 4. Review the PR — AI reviews, you triage findings, auto-fix what you approve
rig review --pr 47
```

That's the loop: plan, issue, ship, review.

---

## Install

**Requirements:** Node.js 20+, [GitHub CLI](https://cli.github.com/) (`gh`), [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude`), Git.

```bash
npm install -g rig-cli
```

---

## Configuration

Create `.rig.yml` in your project root:

```yaml
agent:
  provider: binary        # 'binary' (Claude CLI, default) or 'sdk' (API key)
  max_turns: 80
  permission_mode: bypassPermissions  # default | bypassPermissions | acceptEdits | dontAsk | plan | auto

queue:
  default_phase: null      # e.g. "Phase 1: MVP"
  default_component: null  # e.g. "backend"

test:
  require_new_tests: true

pr:
  draft: false
  reviewers: []            # ["username1", "username2"]

components:
  frontend:
    path: ./frontend
    test_command: npm test
  backend:
    path: ./backend
    test_command: go test ./...

verbose: false
```

All fields are optional. Missing values use defaults.

---

## Commands

### `rig ship`

Full pipeline: pick issue → branch → implement → test → PR → review. Resumes from last stage if interrupted.

```bash
rig ship
rig ship --issue 42
rig ship --phase "Phase 1: MVP" --component backend
```

### `rig next`

Pick the next issue from the priority queue and create a feature branch.

```bash
rig next
rig next --phase "Phase 2" --component frontend
```

### `rig implement`

Run the implementation agent for the current or specified issue.

```bash
rig implement
rig implement --issue 42
rig implement --dry-run
```

### `rig test`

Run the test suite. Auto-retries with a fix agent on failures (up to 3 attempts).

```bash
rig test
rig test --issue 42 --component backend
```

### `rig pr`

Create or update a pull request. Use `-c` to post feedback and auto-fix.

```bash
rig pr
rig pr --issue 42
rig pr -c              # interactive feedback → AI fixes → push
rig pr -c --pr 123
```

### `rig review`

AI code review with interactive triage and auto-fix.

```bash
rig review
rig review --issue 42
rig review --pr 100
rig review --dry-run
```

### `rig create-issue`

Describe an issue in plain text. AI structures it into a proper GitHub issue with title and body.

```bash
rig create-issue
```

### `rig queue`

Display the prioritized issue backlog.

```bash
rig queue
rig queue --phase "Phase 1: MVP" --component backend --limit 20
```

### `rig status`

Show current pipeline state (issue, stage, branch, progress).

### `rig reset`

Clear pipeline state. Keeps the branch and code intact.

### `rig rollback`

Undo everything: close PR, delete branch (local + remote), clear state.

```bash
rig rollback
rig rollback --no-close-pr
```

### `rig bootstrap`

Set up test infrastructure (Vitest, Testing Library, MSW).

```bash
rig bootstrap
rig bootstrap --component frontend
```

---

## Agent Providers

**Binary** (default): Spawns the official `claude` CLI binary. Works with a Claude Max subscription. No API key needed.

**SDK**: Uses the Anthropic API directly. Requires `ANTHROPIC_API_KEY`. Set `provider: sdk` in `.rig.yml`.

---

## Disclaimer

rig-cli is an unofficial third-party tool created by Zach Stecko. Not affiliated with or endorsed by Anthropic. You must have your own Claude subscription or API key and comply with [Anthropic's Terms of Service](https://www.anthropic.com/legal/consumer-terms).

## License

MIT
