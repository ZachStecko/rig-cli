# Configuration Reference

rig-cli uses a YAML configuration file (`.rig.yml`) in your project root. All settings are optional; omitted values use defaults.

## Table of Contents

- [File Location and Format](#file-location-and-format)
- [Agent Configuration](#agent-configuration)
- [Queue Configuration](#queue-configuration)
- [Test Configuration](#test-configuration)
- [PR Configuration](#pr-configuration)
- [GitHub Configuration](#github-configuration)
- [Component Configuration](#component-configuration)
- [Verbose Mode](#verbose-mode)
- [Configuration Precedence](#configuration-precedence)
- [Example Configurations](#example-configurations)

## File Location and Format

### File: `.rig.yml`

Must be in your project root (same directory where you run `rig` commands).

Format: YAML (not JSON)

### Partial Configuration

You don't need to specify every option. Provide only what you want to override:

```yaml
# Minimal config - just change max turns
agent:
  max_turns: 100
```

This works. Missing options use defaults.

### Deep Merging

Configuration merges at the field level:

```yaml
# Your .rig.yml
agent:
  max_turns: 100
  # permission_mode omitted - uses default

# Effective configuration:
agent:
  max_turns: 100  # Your override
  permission_mode: bypassPermissions  # Default
```

## Agent Configuration

Controls Claude Code agent behavior during implementation and fix stages.

### `agent.max_turns`

**Type:** `number`
**Default:** `80`
**Range:** `1-200`

Maximum conversation turns the agent can take before stopping.

One turn = one agent response (may include multiple tool calls).

**When to increase:**
- Complex features requiring many file edits
- Large codebases where agent needs extensive exploration
- Issues with many edge cases requiring iteration

**When to decrease:**
- Simple bug fixes
- Small features
- Want faster failures on problematic issues

```yaml
agent:
  max_turns: 120  # Give agent more time for complex work
```

### `agent.permission_mode`

**Type:** `string`
**Default:** `bypassPermissions`
**Options:** `default | bypassPermissions | acceptEdits | dontAsk | plan | auto`

Controls Claude Code's permission system.

#### Permission Modes Explained

**`bypassPermissions`** (default, recommended)
- Auto-approves all tool calls
- Fastest workflow
- Use when: You trust the agent and want minimal friction

**`default`**
- Prompts for approval on each tool call
- Most restrictive
- Use when: Learning the tool, debugging agent behavior

**`acceptEdits`**
- Auto-approves file edits (Read, Write, Edit)
- Prompts for Bash commands
- Use when: Concerned about unintended command execution

**`dontAsk`**
- Skips all prompts
- Similar to bypassPermissions but different internal handling
- Use when: Full automation, no user interaction

**`plan`**
- Shows intended actions without executing
- Useful for understanding what agent will do
- Use when: Reviewing agent strategy before committing

**`auto`**
- Fully automatic mode
- No user interaction at all
- Use when: CI/CD integration, batch processing

```yaml
agent:
  permission_mode: acceptEdits  # Approve edits, prompt for commands
```

## Queue Configuration

Controls issue prioritization and filtering.

### `queue.default_phase`

**Type:** `string | null`
**Default:** `null`

Default phase filter applied to `rig next` and `rig queue`.

When `null`: shows all issues regardless of phase
When set: only shows issues with matching phase label

```yaml
queue:
  default_phase: "Phase 1: MVP"
```

Now `rig next` only considers "Phase 1: MVP" issues unless overridden with `--phase`.

### `queue.default_component`

**Type:** `string | null`
**Default:** `null`
**Options:** `backend | frontend | fullstack | devnet | serverless | infra | null`

Default component filter.

```yaml
queue:
  default_component: backend
```

Now `rig next` only shows backend issues unless overridden with `--component`.

### `queue.phase_priorities`

**Type:** `object`
**Default:** `{}`

Maps phase label to priority multiplier.

Priority calculation:
```
total_priority = phase_priority * 1000 + label_priority + (100000 - issue_number)
```

Higher priority issues are picked first.

```yaml
queue:
  phase_priorities:
    "Phase 1: MVP": 3
    "Phase 2: Enhancement": 2
    "Phase 3: Polish": 1
```

Phase 1 issues get 3000 points, Phase 2 gets 2000, Phase 3 gets 1000.

### `queue.label_priorities`

**Type:** `object`
**Default:** `{}`

Maps priority label to points.

```yaml
queue:
  label_priorities:
    "P0": 5  # Critical
    "P1": 4  # High
    "P2": 3  # Medium
    "P3": 2  # Low
    "P4": 1  # Nice to have
```

## Test Configuration

Controls test runner behavior.

### `test.require_new_tests`

**Type:** `boolean`
**Default:** `true`

Whether to enforce new test files for implementations.

When `true`: Warns if no new test files detected
When `false`: Skips new test file check

```yaml
test:
  require_new_tests: false  # Don't enforce test coverage
```

**When to set false:**
- Pure refactors (no new functionality)
- Infrastructure changes
- Documentation-only changes
- Projects with existing comprehensive test coverage

**When to keep true:**
- Feature development
- Bug fixes (should add regression tests)
- New API endpoints

## PR Configuration

Controls pull request creation behavior.

### `pr.draft`

**Type:** `boolean`
**Default:** `false`

Create PRs as drafts by default.

```yaml
pr:
  draft: true
```

Draft PRs:
- Not mergeable until marked ready
- Don't trigger certain CI workflows
- Signal work-in-progress

**When to set true:**
- Want to review before marking ready
- CI is expensive (don't trigger until confirmed)
- Team workflow uses draft → ready transition

### `pr.reviewers`

**Type:** `array<string>`
**Default:** `[]`

Auto-assign reviewers to created PRs.

```yaml
pr:
  reviewers:
    - senior-dev-1
    - team-lead
```

GitHub usernames only (not email addresses).

**Limitations:**
- Reviewers must have repo access
- Maximum reviewers per PR: 15 (GitHub limit)
- Fails silently if user doesn't exist

## GitHub Configuration

### `github.repo`

**Type:** `string`
**Default:** Auto-detected from git remote

Repository in `owner/repo` format.

```yaml
github:
  repo: myorg/myproject
```

**When to set explicitly:**
- Multiple remotes configured
- Working in fork (want to target upstream)
- Override auto-detection

**Auto-detection logic:**
```bash
# Runs: gh repo view --json nameWithOwner
# Falls back to: git remote get-url origin
```

## Component Configuration

Defines component-specific paths and commands.

### Component Structure

Each component can have:
- `path`: Directory path (required)
- `test_command`: Test command (required)
- `lint_command`: Lint command (optional)
- `build_command`: Build command (optional)

### `components.frontend`

```yaml
components:
  frontend:
    path: ./frontend
    test_command: npm test
    lint_command: npm run lint
    build_command: npm run build
```

**Test execution order:**
1. `lint_command` (if specified)
2. `build_command` (if specified)
3. `test_command`

All must succeed (exit code 0).

### `components.backend`

```yaml
components:
  backend:
    path: ./backend
    test_command: go test ./...
    lint_command: golangci-lint run
    build_command: go build ./...
```

### `components.serverless`

```yaml
components:
  serverless:
    path: ./serverless
    test_command: npm test
    lint_command: npm run lint
    build_command: sls package
```

### `components.infra`

```yaml
components:
  infra:
    path: ./infra
    test_command: terraform validate
    lint_command: tflint
    build_command: terraform plan
```

### Monorepo Configuration

```yaml
components:
  frontend:
    path: ./packages/web
    test_command: npm test
    lint_command: npm run lint
    build_command: npm run build

  backend:
    path: ./packages/api
    test_command: go test ./...

  mobile:
    path: ./packages/mobile
    test_command: npm test
```

Component detection uses issue labels (`frontend`, `backend`, etc.).

## Default Labels Configuration

### `defaultLabels`

**Type:** `array<string>`
**Default:** `[]`

Default labels to automatically apply when creating issues via `rig create-issue`.

```yaml
defaultLabels:
  - rig-generated
  - needs-triage
```

**Use cases:**
- Automatically tag AI-generated issues for team awareness
- Apply triage or workflow labels by default
- Categorize issues for better organization

**Example:**
```yaml
defaultLabels:
  - enhancement
  - rig-created
  - needs-review
```

**Notes:**
- Labels must already exist in your GitHub repository
- Invalid label names will cause issue creation to fail
- Empty array or omitted field means no labels are applied

## Verbose Mode

### `verbose`

**Type:** `boolean`
**Default:** `false`

Enables detailed diagnostic logging.

```yaml
verbose: true
```

**Output includes:**
- Shell commands being executed
- Timing information
- Configuration values loaded
- Full command output (even on success)

**Example verbose output:**
```
[config] Backend directory: /path/to/backend
[config] Test command: go test ./...
  > cd "/path/to/backend" && go test ./...
  ⏱  Backend tests: 2.45s
```

**When to enable:**
- Debugging test failures
- Understanding performance bottlenecks
- Verifying configuration is correct
- Troubleshooting CI integration

**When to disable:**
- Normal development (too noisy)
- Clean console output preferred

## Configuration Precedence

Configuration merges in this order (later overrides earlier):

```
1. DEFAULT_CONFIG (hardcoded in code)
       ↓
2. .rig.yml in project root
       ↓
3. Command-line flags (--component, --phase)
```

### Example

**DEFAULT_CONFIG:**
```typescript
agent: { max_turns: 80 }
queue: { default_phase: null }
```

**Your .rig.yml:**
```yaml
agent:
  max_turns: 100
```

**Effective config:**
```yaml
agent:
  max_turns: 100  # From .rig.yml
  permission_mode: bypassPermissions  # From DEFAULT_CONFIG
queue:
  default_phase: null  # From DEFAULT_CONFIG
```

### Command-Line Overrides

```bash
$ rig next --component frontend
# Overrides queue.default_component for this run only
```

## Example Configurations

### Minimal Configuration

Just the essentials:

```yaml
github:
  repo: myorg/myproject

components:
  frontend:
    path: ./frontend
    test_command: npm test

  backend:
    path: ./backend
    test_command: go test ./...
```

### Standard Configuration

Common settings for team workflow:

```yaml
# Agent settings
agent:
  max_turns: 80
  permission_mode: bypassPermissions

# Queue priority
queue:
  default_phase: null
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

# Testing
test:
  require_new_tests: true

# Pull requests
pr:
  draft: false
  reviewers:
    - tech-lead

# GitHub
github:
  repo: myorg/myproject

# Components
components:
  frontend:
    path: ./frontend
    test_command: npm test
    lint_command: npm run lint
    build_command: npm run build

  backend:
    path: ./backend
    test_command: go test ./... -v
    lint_command: golangci-lint run

# Default labels for created issues
defaultLabels:
  - rig-generated
  - needs-review

verbose: false
```

### Conservative Configuration

For sensitive codebases, require manual approval:

```yaml
agent:
  max_turns: 50  # Shorter to catch issues faster
  permission_mode: default  # Prompt for every action

test:
  require_new_tests: true  # Enforce test coverage

pr:
  draft: true  # Always create as draft
  reviewers:
    - senior-dev-1
    - senior-dev-2

verbose: true  # Full visibility
```

### Fast Iteration Configuration

Optimized for speed:

```yaml
agent:
  max_turns: 120  # More room for iteration
  permission_mode: auto  # Zero prompts

test:
  require_new_tests: false  # Don't block on test coverage

pr:
  draft: false  # Ready for review immediately
  reviewers: []  # Manual assignment

verbose: false  # Clean output
```

### Monorepo Configuration

Multiple components in single repo:

```yaml
queue:
  default_component: null  # Don't default to one component
  phase_priorities:
    "Phase 1: Core": 3
    "Phase 2: Features": 2
    "Phase 3: Polish": 1

components:
  frontend-web:
    path: ./packages/web
    test_command: npm test
    lint_command: npm run lint
    build_command: npm run build

  frontend-mobile:
    path: ./packages/mobile
    test_command: npm test
    lint_command: npm run lint

  backend-api:
    path: ./packages/api
    test_command: go test ./...
    lint_command: golangci-lint run

  backend-workers:
    path: ./packages/workers
    test_command: go test ./...

  infra:
    path: ./infrastructure
    test_command: terraform validate
```

Issue labels would be: `frontend-web`, `backend-api`, etc.

### CI/CD Configuration

For automated environments:

```yaml
agent:
  max_turns: 60  # Reasonable limit
  permission_mode: auto  # No interaction

test:
  require_new_tests: true

pr:
  draft: false  # CI creates ready-for-review PRs
  reviewers:
    - auto-reviewer-bot

verbose: true  # Detailed logs for debugging
```

## Troubleshooting Configuration

### Config Not Loading

```bash
# Verify file location
$ ls .rig.yml

# Check YAML syntax
$ cat .rig.yml | python3 -c "import sys,yaml; yaml.safe_load(sys.stdin)"
```

### Wrong Values Applied

```bash
# Enable verbose to see loaded config
$ rig queue --verbose
[config] Loaded .rig.yml
[config] queue.default_phase: Phase 1: MVP
[config] queue.default_component: null
```

### Commands Ignore Config

Command-line flags override config:

```bash
$ rig next --component backend
# Ignores queue.default_component from config
```

### Permission Errors

If agent stops with permission errors:

```yaml
agent:
  permission_mode: bypassPermissions  # Auto-approve
```

Or use command flag:
```bash
$ claude --permission-mode bypassPermissions
```
