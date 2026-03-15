#### still in beta use at your own risk

# rig-cli

![rig-cli logo](./assets/logo.png)

An AI agent orchestration framework that automates your entire development workflow—from GitHub issue selection to pull request creation and code review—powered by Claude AI.

> **Disclaimer:** rig-cli is an unofficial third-party orchestration tool created by Zach Stecko. It is not affiliated with, endorsed by, or supported by Anthropic PBC. Users must have their own Claude subscription or API key and comply with [Anthropic's Terms of Service](https://www.anthropic.com/legal/consumer-terms).

## Overview

rig-cli is an AI agent orchestration system that automates the software development lifecycle. It coordinates multiple AI agents through a structured pipeline, managing agent execution, state transitions, and inter-agent communication from issue selection through implementation, testing, and code review.

The tool operates in two modes:

1. **Pipeline mode**: Full automated workflow (`rig ship`)
2. **Modular mode**: Run individual commands with `--issue` flags

Each command (implement, test, pr, review) works standalone or as part of the pipeline.

## How It Works

rig-cli is an orchestration layer that coordinates multiple developer tools to automate your workflow. It does **not** make direct API calls to Anthropic or handle authentication itself.

### Architecture

```
rig-cli (orchestrator)
  ├─> Claude Code CLI (official @anthropic-ai/claude-code)
  ├─> GitHub CLI (gh)
  └─> Git
```

**Key technical details:**

- **Spawns official tools**: rig-cli uses Node's `child_process.spawn()` to execute the official `claude` CLI binary installed on your system
- **No token extraction**: Relies on your existing Claude CLI authentication without extracting, manipulating, or storing OAuth tokens
- **No API client**: Does not use third-party API clients or reimplementations
- **Uses documented automation features**: Leverages the `-p` (print and exit), `--output-format json`, and other flags designed for programmatic use

This architectural pattern mirrors Anthropic's own [Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview), which spawns Claude Code CLI as a subprocess for automation workflows.

**What rig-cli does:**
1. Reads your project configuration and GitHub issues
2. Assembles prompts with relevant context
3. Spawns the official `claude` command with appropriate flags
4. Coordinates with git and GitHub CLI for version control and PRs
5. Parses outputs and manages workflow state

**What rig-cli does NOT do:**
- Extract or manipulate authentication tokens
- Make direct API calls to Anthropic
- Bypass Claude's safety features or guardrails
- Modify Claude's responses or behavior

## Features

### Agent Orchestration

- **Multi-Agent Coordination**: Orchestrates specialized AI agents across the development lifecycle (implement, test, fix, review)
- **State-Based Workflow**: Manages agent transitions through a structured state machine
- **Context Passing**: Automatically assembles and passes relevant context between agents
- **Agent Retry Logic**: Implements sophisticated retry mechanisms with context from previous agent failures
- **Parallel Agent Execution**: Supports concurrent agent operations where appropriate

### Full Pipeline Automation

- Issue-to-PR Pipeline: Automated workflow from issue selection to pull request creation
- Resume Capability: Pick up where you left off if the pipeline is interrupted
- State Management: Tracks pipeline progress across all stages
- Multi-stage Workflow: Pick → Branch → Implement → Test → PR → Review

### AI-Powered Development

- Claude AI Integration: Uses Claude Code agents for implementation and fixes
- Intelligent Code Review: Automated code review with interactive triage
- Auto-fix on Test Failures: Orchestrates fix agent on failures (up to 3 retries)
- Context-Aware Prompts: Generates rich prompts with issue context, codebase info, and test results

### Smart Issue Management

- Priority Queue System: Automatically prioritizes issues based on phase and label priorities
- Component Filtering: Filter by component (backend, frontend, fullstack, devnet, serverless, infra)
- Phase Filtering: Focus on specific project phases (e.g., "Phase 1: MVP")
- Open PR Detection: Skips issues that already have open pull requests

### Test Automation

- Multi-Environment Testing: Supports both frontend (Vitest) and backend (Go) test suites
- Test Bootstrapping: Automatically sets up test infrastructure for new projects
- Test Retry Logic: Runs fix agent and retries on test failures
- Coverage Reporting: Displays test coverage information


### Code Review

- Automated Reviews: AI-powered code review with severity-based findings
- Interactive Triage: Select which findings to address
- Auto-fix Findings: Automatically fix selected review findings
- PR-Based Reviews: Review pull requests directly with `--pr` option

## Installation

### Prerequisites

- Node.js: v18 or higher
- GitHub CLI (gh): Installed and authenticated
  ```bash
  brew install gh
  gh auth login
  ```
- Claude CLI: For AI-powered agents
  ```bash
  npm install -g @anthropics/claude-cli
  ```
- Git: For version control operations

### Authentication Methods

rig-cli works with both Claude subscription and API key authentication. Choose the method that fits your use case:

#### For Personal Use (Recommended for Local Development)

Authenticate Claude CLI with your Claude Pro/Max subscription:

```bash
# Login with your Anthropic account
claude login
```

**Best for:**
- Personal productivity on your local machine
- Individual developer workflows
- Ad-hoc issue implementation

#### For Production/CI/CD (Required for Server Deployments)

Use an Anthropic API key for programmatic access:

```bash
# Set your API key as an environment variable
export ANTHROPIC_API_KEY=your_api_key_here

# Or add to your shell profile (.bashrc, .zshrc, etc.)
echo 'export ANTHROPIC_API_KEY=your_api_key_here' >> ~/.zshrc
```

**Required for:**
- Running rig-cli on servers or VPS
- CI/CD pipelines
- Team/business usage
- High-volume automation
- Any non-local development environment

**Why this matters:** Anthropic's [Consumer Terms of Service](https://www.anthropic.com/legal/consumer-terms) prohibit using subscription OAuth tokens in production automation or on servers. For personal use on your local machine, either authentication method works. For production, CI/CD, or server deployments, you must use API keys to ensure compliance with Anthropic's [Commercial Terms](https://www.anthropic.com/legal/commercial-terms).

**Get an API key:** Visit [Anthropic Console](https://console.anthropic.com/) to generate an API key for commercial use.

### Install rig-cli

```bash
npm install -g rig-cli
```

Or install locally for development:

```bash
git clone https://github.com/zachstecko/rig-cli.git
cd rig-cli
npm install
npm link
```

## Quick Start

### 1. Initialize Your Project

Bootstrap test infrastructure for your project:

```bash
rig bootstrap
```

This sets up:

- Frontend testing (Vitest, Testing Library, MSW)
- Test configuration files
- Mock handlers and test utilities

### 2. Pick Your Next Issue

```bash
rig next
```

This will:

- Fetch open issues from GitHub
- Prioritize based on labels and phases
- Create a feature branch
- Initialize pipeline state

### 3. Run the Full Pipeline

```bash
rig ship
```

This orchestrates the complete workflow:

1. Pick: Select next issue from queue
2. Branch: Create feature branch
3. Implement: Run implementation agent
4. Test: Run tests (with auto-retry on failures)
5. PR: Create pull request
6. Review: Run code review agent

## Documentation

For comprehensive guides beyond this README:

- **[Workflows](docs/workflows.md)** - Detailed workflow diagrams and usage patterns
  - Full pipeline flow
  - Modular command usage with `--issue` flags
  - Error recovery procedures
  - Multi-component project handling

- **[Configuration](docs/configuration.md)** - Complete configuration reference
  - All available options with defaults
  - Permission modes explained
  - Component-specific settings
  - Example configs for different project types

- **[Architecture](docs/architecture.md)** - Technical deep dive
  - Service architecture and dependencies
  - State management implementation
  - Agent orchestration patterns
  - API call optimization strategies

- **[Examples](docs/examples/)** - Ready-to-use configuration files
  - Frontend-only projects
  - Backend-only projects
  - Fullstack monorepos
  - Enterprise team workflows

## Commands

### Core Pipeline Commands

#### `rig ship`

Runs the full issue-to-PR pipeline from start to finish.

```bash
rig ship                           # Pick next issue and run pipeline
rig ship --issue 42                # Start with specific issue
rig ship --phase "Phase 1: MVP"    # Filter by phase
rig ship --component backend       # Filter by component
```

Features:

- Automatic resume from last stage if interrupted
- Test retry with fix agent (up to 3 attempts)
- Stale state detection (aborts if issue is closed)

#### `rig next`

Picks the next issue from the priority queue.

```bash
rig next                           # Pick highest priority issue
rig next --phase "Phase 2"         # Filter by phase
rig next --component frontend      # Filter by component
```

Priority Calculation:

- Phase priority × 1000
- Label priority (P0=5, P1=4, P2=3, P3=2, P4=1)
- Issue number (older issues prioritized)

#### `rig implement`

Runs the implementation agent for the current issue.

```bash
rig implement                      # Use current pipeline state
rig implement --issue 42           # Implement specific issue
rig implement --dry-run            # Preview prompt without executing
```

#### `rig test`

Runs the test suite for your project.

```bash
rig test                           # Run tests for current pipeline
rig test --issue 42                # Run tests for specific issue (no pipeline needed)
rig test --component backend       # Run backend tests only
rig test --issue 42 --component backend  # Combine flags
```

Supported Test Runners:

- Frontend: `npm test` (Vitest)
- Backend: `go test ./...`
- Fullstack: Both frontend and backend tests

#### `rig pr`

Creates a pull request for the current branch.

```bash
rig pr                             # Create PR from current pipeline state
rig pr --issue 42                  # Create PR for specific issue (no pipeline needed)
rig pr -c                          # Provide feedback on PR and run AI agent to fix issues
rig pr -c --pr 123                 # Comment on specific PR number
```

Features:

- Auto-generates title and description from issue
- Links to original issue
- Includes implementation summary and commit history
- Adds AI-generated test plan checklist
- Auto-detects component from issue labels
- Can create or update existing PRs

PR Feedback Mode (`-c` / `--comment`):

1. Prompts for multiline feedback on a PR
2. Posts feedback as a GitHub comment
3. Runs Claude agent to address the feedback
4. Pushes fixes to the PR branch
5. Posts a reply comment confirming fixes

The PR number is auto-detected from the current branch, or you can specify it with `--pr <number>`.

#### `rig review`

Runs code review on the current changes.

```bash
rig review                         # Review current pipeline
rig review --issue 42              # Review specific issue
rig review --pr 100                # Review specific PR
rig review --dry-run               # Preview review prompt
```

Review Process:

1. Runs AI code review agent (read-only)
2. Parses findings by severity (high/medium/low)
3. Interactive triage to select findings
4. Auto-fix selected findings

### Utility Commands

#### `rig create-issue`

Create a new GitHub issue interactively with AI-powered structuring.

```bash
rig create-issue
```

Features:

- **Multiline Input**: Describe your issue naturally in your own words
- **AI Structuring**: Claude AI automatically formats your description into a proper GitHub issue with title and body
- **Preview & Confirm**: Review the structured issue before creating
- **No AI Fluff**: Configured to write like a senior developer—direct, technical, no excessive formatting

Workflow:

1. Describe the issue in multiline input (press Ctrl+D or type "EOF" when done)
2. AI structures your description into a proper issue format
3. Preview the generated title and body
4. Confirm to create the issue on GitHub

#### `rig queue`

Displays the current issue queue with priorities.

```bash
rig queue                          # Show all open issues
rig queue --phase "Phase 1: MVP"   # Filter by phase
rig queue --component backend      # Filter by component
rig queue --limit 20               # Limit results
```

#### `rig status`

Shows the current pipeline state.

```bash
rig status
```

Output:

- Current issue number and title
- Current stage
- Status of all stages (completed/pending/failed)
- Branch name
- Next steps

#### `rig reset`

Clears the current pipeline state with interactive confirmation.

```bash
rig reset
```

Warning: This abandons the current issue. Use when:

- Switching to a different issue
- Pipeline is stuck or corrupted
- Issue has been closed/merged externally

Note: This only clears the state file. The feature branch remains intact locally.

#### `rig rollback`

Completely undoes all work for the current issue.

```bash
rig rollback                       # Rollback with PR closure
rig rollback --no-close-pr         # Keep PR open
```

This command:

- Closes any open PRs for this branch (optional)
- Deletes the feature branch locally
- Deletes the remote branch if it was pushed
- Returns to main/master branch
- Cleans up all logs, reviews, and demos
- Clears pipeline state

Use when:

- You want to completely start over on an issue
- The implementation went in the wrong direction
- You want to abandon the issue entirely

Difference from `rig reset`:

- `rig reset`: Only clears state, keeps branch and code
- `rig rollback`: Deletes everything, complete rollback to before you started

#### `rig bootstrap`

Sets up test infrastructure for your project.

```bash
rig bootstrap                      # Auto-detect component
rig bootstrap --component frontend # Bootstrap frontend only
rig bootstrap --component backend  # Bootstrap backend only
```

Frontend Setup:

- Installs Vitest, Testing Library, MSW
- Creates `vitest.config.ts`
- Sets up test utilities in `src/test/`
- Adds npm scripts

Backend Setup:

- Currently a no-op (Go projects work out of the box)

## Configuration

### `.rig.yml`

Create a configuration file in your project root using YAML format:

```yaml
# Agent configuration
agent:
  max_turns: 80  # Maximum turns for Claude Code agent (default: 80)
  permission_mode: bypassPermissions  # default, bypassPermissions, acceptEdits, dontAsk, plan, auto

# Queue and prioritization
queue:
  default_phase: null  # Default phase filter (null = no filter)
  default_component: null  # Default component filter (null = no filter)
  phase_priorities:
    "Phase 1: MVP": 3
    "Phase 2: Enhancement": 2
    "Phase 3: Polish": 1
  label_priorities:
    "P0": 5
    "P1": 4
    "P2": 3
    "P3": 2
    "P4": 1

# Test configuration
test:
  require_new_tests: true  # Require new test files for implementation

# Pull request configuration
pr:
  draft: false  # Create PRs as drafts
  reviewers: []  # Auto-assign reviewers (e.g., ["username1", "username2"])

# GitHub repository
github:
  repo: owner/repo

# Component-specific configuration
components:
  frontend:
    path: ./frontend
    test_command: npm test
    lint_command: npm run lint  # Optional
    build_command: npm run build  # Optional

  backend:
    path: ./backend
    test_command: go test ./...
    lint_command: golangci-lint run  # Optional
    build_command: go build ./...  # Optional

  # Additional component types
  serverless:
    path: ./serverless
    test_command: npm test

  infra:
    path: ./infra
    test_command: terraform validate

# Verbose logging
verbose: false
```

### Permission Modes

The `agent.permission_mode` setting controls how Claude Code handles operations that require confirmation:

- `default`: Prompts for approval on all operations (most restrictive)
- `bypassPermissions`: Auto-approves all operations (default, fastest workflow)
- `acceptEdits`: Automatically accepts file edits without confirmation
- `dontAsk`: Skips all confirmation prompts
- `plan`: Runs in plan mode, showing intended changes without executing
- `auto`: Fully automatic mode with no user interaction

For most use cases, `bypassPermissions` (the default) provides the best balance of speed and control.

### Verbose Mode

Enable verbose mode to see detailed diagnostic information during command execution:

```json
{
  "verbose": true
}
```

When enabled, verbose mode shows:
- **Shell commands** being executed
- **Timing information** for each operation
- **Config values** being used
- **Full command output** on success

This is useful for:
- Debugging test runner issues
- Understanding which commands are being used for your component setup
- Tracking performance of different operations
- Verifying configuration is being read correctly

Example verbose output:
```
[config] Backend directory: backend
[config] Test command: go test ./...
  > cd "/path/to/project/backend" && go test ./...
  ⏱  Backend tests: 2.45s
```

### Component Detection

rig-cli automatically detects project components based on issue labels:

- `frontend`: Issues labeled with `frontend`
- `backend`: Issues labeled with `backend`
- `fullstack`: Issues labeled with `fullstack`
- `devnet`: Issues labeled with `devnet`
- `serverless`: Issues labeled with `serverless`
- `infra`: Issues labeled with `infra`

If no component label is found, defaults to `fullstack`.

### Allowed Tools by Component

Different components have access to different Claude Code tools:

Frontend:

- Read, Edit, Write
- Bash (with npm/npx restrictions)
- Glob, Grep
- NotebookEdit

Backend:

- Read, Edit, Write
- Bash (with go restrictions)
- Glob, Grep

Fullstack:

- All frontend + backend tools

## Pipeline Workflow

### Stage Progression

```
pick → branch → implement → test → pr → review
```

### Stage Details

1. Pick (`rig next`)
   - Fetches open issues from GitHub
   - Calculates priority scores
   - Filters by phase/component
   - Skips issues with open PRs
   - Creates initial state

2. Branch (automatic)
   - Creates feature branch: `issue-{number}-{slugified-title}`
   - Checks out new branch
   - Updates state

3. Implement (`rig implement`)
   - Assembles rich prompt with issue context
   - Runs Claude Code agent
   - Agent reads code, makes changes, runs tests
   - Logs to `.rig-logs/implement-issue-{number}.log`

4. Test (`rig test`)
   - Runs appropriate test suite (frontend/backend/both)
   - On failure: runs fix agent (up to 3 retries)
   - Displays test results and coverage
   - Fails pipeline after max retries

5. PR (`rig pr`)
   - Generates PR title and description
   - Creates pull request via GitHub CLI
   - Includes issue link and implementation summary
   - Updates state with PR number

6. Review (`rig review`)
   - Runs AI code review (read-only)
   - Parses findings from review file
   - Interactive triage of findings
   - Auto-fix selected findings
   - Logs to `.rig-logs/review-issue-{number}.log`

### Resume Capability

If the pipeline is interrupted at any stage, simply run `rig ship` again:

```bash
# Pipeline interrupted during test stage
$ rig ship
Resuming pipeline for issue #42: Add user dashboard
Current stage: test
...
```

The pipeline will resume from the current stage and continue through completion.

### State Management

Pipeline state is stored in `.rig-state.json` in your project root:

```json
{
  "issue_number": 42,
  "issue_title": "Add user dashboard",
  "branch": "issue-42-add-user-dashboard",
  "stage": "test",
  "stages": {
    "pick": "completed",
    "branch": "completed",
    "implement": "completed",
    "test": "pending",
    "pr": "pending",
    "review": "pending"
  }
}
```

## Directory Structure

```
your-project/
├── .rig.yml                 # Configuration
├── .rig-state.json          # Pipeline state (auto-generated)
├── .rig-logs/               # Agent execution logs
│   ├── implement-issue-42.log
│   ├── test-issue-42.log
│   ├── fix-attempt-1.log
│   └── review-issue-42.log
└── .rig-reviews/            # Code review outputs
    └── issue-42/
        └── review-2024-01-15-120000.md
```

## Examples

### Example 1: Full Pipeline

```bash
# Start fresh pipeline
$ rig ship

Ship: Full Issue-to-PR Pipeline

Picking next issue from queue...
Selected issue #42: Add user dashboard
Priority: 3004 (Phase 1: MVP, P1)
Branch: issue-42-add-user-dashboard

Stage: implement
Running implementation agent...
[Agent output...]
Implementation complete

Stage: test
Running tests...
All tests passed (42 passed, 0 failed)

Stage: pr
Creating pull request...
PR created: https://github.com/owner/repo/pull/100

Stage: review
Running code review agent...
Code review completed
Verdict: PASS
Findings: 0

Pipeline complete!
Issue has been implemented, tested, and submitted for review.
```

### Example 2: Test Failure with Auto-Fix

```bash
$ rig ship

Stage: test
Running tests...
Tests failed (40 passed, 2 failed)

Tests failed on attempt 1/3.
Running fix agent to address test failures...
[Fix agent output...]
Fix agent completed. Retrying tests...

Running tests...
All tests passed (42 passed, 0 failed)

[Pipeline continues...]
```

### Example 3: Code Review with Findings

```bash
$ rig review

Code Review for Issue #42

[1/3] Assembling review prompt...
[2/3] Running code review agent...
[Agent output...]
[3/3] Parsing review and triaging findings...

Verdict: CONTESTED
Findings: 3 (1 high, 2 medium, 0 low)

Finding 1/3 [high]:
Missing error handling in API call at src/api/users.ts:42
Fix this finding? (y/n/q): y

Finding 2/3 [medium]:
Component could be memoized for better performance at src/Dashboard.tsx:15
Fix this finding? (y/n/q): n

Finding 3/3 [medium]:
Magic number should be a named constant at src/utils/pagination.ts:8
Fix this finding? (y/n/q): y

Selected 2 findings to fix.

[1/2] Fixing: Missing error handling in API call...
[Agent output...]

[2/2] Fixing: Magic number should be a named constant...
[Agent output...]

All selected findings addressed.
```

### Example 4: Resume After Interruption

```bash
# First run (interrupted during test)
$ rig ship
[...]
Stage: test
Running tests...
^C

# Resume later
$ rig ship
Resuming pipeline for issue #42: Add user dashboard
Current stage: test

Stage: test
Running tests...
[Pipeline continues from test stage...]
```

### Example 5: Interactive PR Feedback

```bash
$ git checkout issue-42-add-user-dashboard
$ rig pr -c

PR Feedback & Fix

Detecting PR from branch: issue-42-add-user-dashboard
Found PR #123
PR: Add user dashboard
Branch: issue-42-add-user-dashboard

Describe the issues to fix (multiline input):
  Press Ctrl+D when done

> The loading state is not showing properly when fetching user data.
> Also, the error handling needs to display a user-friendly message.
> ^D

Feedback received. Processing...

[1/4] Posting feedback to GitHub PR...
✓ Comment posted

[2/4] Preparing fix prompt for agent...
✓ Prompt assembled

[3/4] Running Claude agent to address feedback...
[Agent output...]
✓ Agent completed

[4/4] Pushing changes to remote...
✓ Changes pushed

✓ Reply posted to PR

PR feedback workflow complete!
```

## Development

### Building

```bash
npm run build
```

### Testing

```bash
npm test                    # Run all tests
npm test -- --watch         # Watch mode
npm test -- tests/commands  # Specific directory
```

### Running Locally

```bash
npm link
rig --help
```

### Project Structure

```
rig-cli/
├── src/
│   ├── commands/           # Command implementations
│   │   ├── ship.command.ts
│   │   ├── next.command.ts
│   │   ├── implement.command.ts
│   │   ├── test.command.ts
│   │   ├── demo.command.ts
│   │   ├── pr.command.ts
│   │   └── review.command.ts
│   ├── services/           # Core services
│   │   ├── agents/
│   │   │   ├── base.agent.ts
│   │   │   ├── claude-code.agent.ts
│   │   │   └── types.ts
│   │   ├── github.service.ts
│   │   ├── git.service.ts
│   │   ├── state-manager.service.ts
│   │   ├── prompt-builder.service.ts
│   │   └── issue-queue.service.ts
│   ├── types/              # TypeScript types
│   └── utils/              # Utility functions
├── tests/                  # Test files
│   ├── commands/
│   ├── services/
│   └── integration/
└── templates/              # Prompt templates
```

## FAQ

### Is it okay to use rig-cli with my Claude Pro/Max subscription?

**Yes, for personal use on your local machine.** rig-cli spawns the official Claude Code CLI, which is designed for both interactive and programmatic use through its documented automation features (`-p`, `--output-format json`, etc.).

**However, for the following scenarios, you must use API keys:**
- Server/VPS deployments
- CI/CD pipelines
- Business/team usage
- High-volume automation

This aligns with Anthropic's distinction between Consumer Terms (subscription) and Commercial Terms (API keys). See the [Authentication Methods](#authentication-methods) section for setup instructions.

### How is rig-cli different from tools that were banned?

In February 2026, Anthropic clarified their terms to prohibit tools that **extract OAuth tokens** from Claude subscriptions to build third-party API clients. rig-cli is fundamentally different:

**What banned tools did:**
- Extracted OAuth tokens from subscription authentication
- Built custom API clients using those tokens
- Created "unusual traffic patterns without telemetry" (per Anthropic)
- Bypassed Anthropic's official tools entirely

**What rig-cli does:**
1. Uses the official `claude` binary (not a reimplementation)
2. Does not extract, manipulate, or store authentication tokens
3. Relies on Claude CLI's own authentication mechanism
4. Uses documented automation features (`-p`, `--output-format json`, `--allowedTools`)
5. Preserves all of Anthropic's telemetry and safety features

The architectural pattern is nearly identical to Anthropic's own [Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview), which spawns Claude CLI as a subprocess for automation.

### Can I get in trouble for using rig-cli?

Using rig-cli on your own computer for personal development follows documented patterns and uses official tools. The tool itself doesn't do anything that Anthropic's Agent SDK doesn't do.

**To ensure compliance:**
- Use it locally on your own machine for personal projects (with subscription or API key)
- Use API keys (not subscription auth) for server/VPS/CI deployments
- Don't run 24/7 high-volume automation on consumer subscription plans
- Follow Anthropic's [Usage Policy](https://www.anthropic.com/legal/aup)

**If you're uncertain:** Use an API key - there's zero ambiguity with Commercial Terms. API keys are designed specifically for programmatic use and automation.

### Why does rig-cli spawn Claude programmatically? Isn't that against the ToS?

Anthropic's Consumer Terms prohibit "automated or non-human means" **except** when accessing via an API key or "where we otherwise explicitly permit it."

The Claude Code CLI includes specific flags for automation:
- `-p, --print` - Documentation states "useful for pipes"
- `--output-format json` - For programmatic parsing
- `--no-session-persistence` - For stateless automation

These documented features indicate explicit permission for programmatic use. Additionally, Anthropic's own Agent SDK uses the same pattern: spawning `claude` as a subprocess.

**The key distinction:**
- ❌ Prohibited: Extracting tokens to build third-party API clients
- ✅ Allowed: Spawning the official `claude` binary with its documented automation flags

### What if I want official clarification from Anthropic?

If you need absolute certainty for your specific use case, contact Anthropic support with details about:
- Your usage pattern (local development vs server deployment)
- Authentication method (subscription vs API key)
- Volume and frequency of automation

Get their response in writing for your records.

### Does rig-cli send data to third parties?

No. rig-cli is a local orchestration tool that:
- Runs entirely on your machine
- Spawns official tools (Claude CLI, GitHub CLI, Git)
- Does not send data to any third parties
- Does not include telemetry or tracking

All data flows through official Anthropic and GitHub channels, governed by their respective privacy policies.

## Troubleshooting

### Pipeline Stuck or Corrupted

```bash
rig reset
rig status  # Verify state is cleared
rig ship    # Start fresh
```

### Test Failures Not Auto-Fixing

Check agent logs:

```bash
cat .rig-logs/fix-attempt-1.log
```

Common issues:

- Test configuration errors
- Missing dependencies
- Environment-specific test failures

### Claude CLI Not Found

```bash
npm install -g @anthropics/claude-cli
claude --version
```

### GitHub Authentication Issues

```bash
gh auth status
gh auth login  # If not authenticated
```

### Branch Name Conflicts

```bash
git branch -D issue-42-add-user-dashboard  # Delete old branch
rig reset                                   # Clear state
rig next                                    # Start fresh
```

## Best Practices

### Issue Management

- Use clear, descriptive issue titles
- Add component labels (frontend/backend/fullstack)
- Add priority labels (P0-P4)
- Add phase labels for milestone tracking
- Keep issue descriptions detailed with acceptance criteria

### Testing

- Run `rig bootstrap` when starting a new project
- Ensure tests pass locally before using `rig ship`
- Review fix agent logs when auto-fixes fail
- Monitor test output during pipeline execution

### Code Review

- Review the findings before auto-fixing
- Use "q" to quit triage if you want to fix manually
- Check `.rig-reviews/` for full review reports
- Re-run `rig review` after making changes

### State Management

- Use `rig status` frequently to check progress
- Use `rig reset` when switching issues
- Don't manually edit `.rig-state.json`
- Avoid committing `.rig-state.json` (add to .gitignore)

## License

MIT License 


