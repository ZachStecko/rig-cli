#### still in beta use at your own risk

# rig-cli

![rig-cli logo](./assets/logo.png)

**rig-cli** is an intelligent CLI tool that orchestrates your entire development workflow—from GitHub issue selection to pull request creation and code review—powered by Claude AI.

## Overview

rig-cli automates the full software development lifecycle by managing a structured pipeline that takes you from issue selection through implementation, testing, demonstration, and code review. It's designed for teams working with GitHub issues and leverages AI agents to assist with code generation, testing, and review.

## Features

### Full Pipeline Automation
- **Issue-to-PR Pipeline**: Automated workflow from issue selection to pull request creation
- **Resume Capability**: Pick up where you left off if the pipeline is interrupted
- **State Management**: Tracks pipeline progress across all stages
- **Multi-stage Workflow**: Pick → Branch → Implement → Test → Demo → PR → Review

### AI-Powered Development
- **Claude AI Integration**: Uses Claude Code agent for implementation and fixes
- **Intelligent Code Review**: Automated code review with interactive triage
- **Auto-fix on Test Failures**: Automatically attempts to fix failing tests (up to 3 retries)
- **Context-Aware Prompts**: Generates rich prompts with issue context, codebase info, and test results

### Smart Issue Management
- **Priority Queue System**: Automatically prioritizes issues based on phase and label priorities
- **Component Filtering**: Filter by component (backend, frontend, fullstack, devnet)
- **Phase Filtering**: Focus on specific project phases (e.g., "Phase 1: MVP")
- **Open PR Detection**: Skips issues that already have open pull requests

### Test Automation
- **Multi-Environment Testing**: Supports both frontend (Vitest) and backend (Go) test suites
- **Test Bootstrapping**: Automatically sets up test infrastructure for new projects
- **Test Retry Logic**: Runs fix agent and retries on test failures
- **Coverage Reporting**: Displays test coverage information

### Demo Recording
- **Automated Demos**: Records demonstrations of implemented features
- **Logger Integration**: Captures structured logs during demo runs
- **Component-Specific**: Tailored demo scripts for frontend, backend, and fullstack

### Code Review
- **Automated Reviews**: AI-powered code review with severity-based findings
- **Interactive Triage**: Select which findings to address
- **Auto-fix Findings**: Automatically fix selected review findings
- **PR-Based Reviews**: Review pull requests directly with `--pr` option

## Installation

### Prerequisites

- **Node.js**: v18 or higher
- **GitHub CLI (gh)**: Installed and authenticated
  ```bash
  brew install gh
  gh auth login
  ```
- **Claude CLI**: For AI-powered agents
  ```bash
  npm install -g @anthropics/claude-cli
  ```
- **Git**: For version control operations

### Install rig-cli

```bash
npm install -g rig-cli
```

Or install locally for development:

```bash
git clone https://github.com/yourusername/rig-cli.git
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
1. **Pick**: Select next issue from queue
2. **Branch**: Create feature branch
3. **Implement**: Run implementation agent
4. **Test**: Run tests (with auto-retry on failures)
5. **Demo**: Record demonstration
6. **PR**: Create pull request
7. **Review**: Run code review agent

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

**Features**:
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

**Priority Calculation**:
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
rig test --component backend       # Run backend tests only
```

**Supported Test Runners**:
- **Frontend**: `npm test` (Vitest)
- **Backend**: `go test ./...`
- **Fullstack**: Both frontend and backend tests

#### `rig demo`
Records a demonstration of the implemented feature.

```bash
rig demo                           # Demo current pipeline
rig demo --issue 42                # Demo specific issue
rig demo --component frontend      # Demo frontend only
```

#### `rig pr`
Creates a pull request for the current branch.

```bash
rig pr                             # Create PR from current state
```

**Features**:
- Auto-generates title and description
- Links to original issue
- Includes implementation summary
- Adds test plan checklist

#### `rig review`
Runs code review on the current changes.

```bash
rig review                         # Review current pipeline
rig review --issue 42              # Review specific issue
rig review --pr 100                # Review specific PR
rig review --dry-run               # Preview review prompt
```

**Review Process**:
1. Runs AI code review agent (read-only)
2. Parses findings by severity (high/medium/low)
3. Interactive triage to select findings
4. Auto-fix selected findings

### Utility Commands

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

**Output**:
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

**Warning**: This abandons the current issue. Use when:
- Switching to a different issue
- Pipeline is stuck or corrupted
- Issue has been closed/merged externally

#### `rig bootstrap`
Sets up test infrastructure for your project.

```bash
rig bootstrap                      # Auto-detect component
rig bootstrap --component frontend # Bootstrap frontend only
rig bootstrap --component backend  # Bootstrap backend only
```

**Frontend Setup**:
- Installs Vitest, Testing Library, MSW
- Creates `vitest.config.ts`
- Sets up test utilities in `src/test/`
- Adds npm scripts

**Backend Setup**:
- Currently a no-op (Go projects work out of the box)

## Configuration

### `.rig/config.json`

Create a configuration file in your project root:

```json
{
  "agent": {
    "max_turns": 20
  },
  "queue": {
    "phase_priorities": {
      "Phase 1: MVP": 3,
      "Phase 2: Enhancement": 2,
      "Phase 3: Polish": 1
    },
    "label_priorities": {
      "P0": 5,
      "P1": 4,
      "P2": 3,
      "P3": 2,
      "P4": 1
    }
  },
  "github": {
    "repo": "owner/repo"
  },
  "components": {
    "frontend": {
      "path": "./frontend",
      "test_command": "npm test"
    },
    "backend": {
      "path": "./backend",
      "test_command": "go test ./..."
    }
  }
}
```

### Component Detection

rig-cli automatically detects project components based on issue labels:
- **frontend**: Issues labeled with `frontend`
- **backend**: Issues labeled with `backend`
- **fullstack**: Issues labeled with `fullstack`
- **devnet**: Issues labeled with `devnet`

### Allowed Tools by Component

Different components have access to different Claude Code tools:

**Frontend**:
- Read, Edit, Write
- Bash (with npm/npx restrictions)
- Glob, Grep
- NotebookEdit

**Backend**:
- Read, Edit, Write
- Bash (with go restrictions)
- Glob, Grep

**Fullstack**:
- All frontend + backend tools

## Pipeline Workflow

### Stage Progression

```
pick → branch → implement → test → demo → pr → review
```

### Stage Details

1. **Pick** (`rig next`)
   - Fetches open issues from GitHub
   - Calculates priority scores
   - Filters by phase/component
   - Skips issues with open PRs
   - Creates initial state

2. **Branch** (automatic)
   - Creates feature branch: `issue-{number}-{slugified-title}`
   - Checks out new branch
   - Updates state

3. **Implement** (`rig implement`)
   - Assembles rich prompt with issue context
   - Runs Claude Code agent
   - Agent reads code, makes changes, runs tests
   - Logs to `.rig-logs/implement-issue-{number}.log`

4. **Test** (`rig test`)
   - Runs appropriate test suite (frontend/backend/both)
   - On failure: runs fix agent (up to 3 retries)
   - Displays test results and coverage
   - Fails pipeline after max retries

5. **Demo** (`rig demo`)
   - Runs demo script to exercise feature
   - Captures logs and output
   - Logs to `.rig-logs/demo-issue-{number}.log`

6. **PR** (`rig pr`)
   - Generates PR title and description
   - Creates pull request via GitHub CLI
   - Includes issue link and implementation summary
   - Updates state with PR number

7. **Review** (`rig review`)
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

Pipeline state is stored in `.rig/state.json`:

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
    "demo": "pending",
    "pr": "pending",
    "review": "pending"
  }
}
```

## Directory Structure

```
your-project/
├── .rig/
│   ├── config.json          # Configuration
│   └── state.json           # Pipeline state
├── .rig-logs/               # Agent execution logs
│   ├── implement-issue-42.log
│   ├── test-issue-42.log
│   ├── fix-attempt-1.log
│   ├── demo-issue-42.log
│   └── review-issue-42.log
├── .rig-reviews/            # Code review outputs
│   └── issue-42/
│       └── review-2024-01-15-120000.md
└── .rig-demos/              # Demo recordings
    └── issue-42/
        └── demo-2024-01-15-120000.log
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

Stage: demo
Recording demonstration...
Demo recorded

Stage: pr
Creating pull request...
PR created: https://github.com/owner/repo/pull/100

Stage: review
Running code review agent...
Code review completed
Verdict: PASS
Findings: 0

Pipeline complete!
Issue has been implemented, tested, demoed, and submitted for review.
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
│   │   ├── claude.service.ts
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
- Don't manually edit `.rig/state.json`
- Commit state changes if working across machines

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## License

MIT License - see LICENSE file for details

## Support

- GitHub Issues: [Report bugs or request features](https://github.com/yourusername/rig-cli/issues)
- Documentation: [Full documentation](https://github.com/yourusername/rig-cli/wiki)

---

Built with care by developers, for developers. Powered by Claude AI.
