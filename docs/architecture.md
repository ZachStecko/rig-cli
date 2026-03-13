# rig-cli Architecture

Technical documentation for engineers who want to understand implementation details, design decisions, and internal mechanisms.

## Table of Contents

- [System Overview](#system-overview)
- [Service Architecture](#service-architecture)
- [State Management](#state-management)
- [Agent Orchestration](#agent-orchestration)
- [Test Retry Logic](#test-retry-logic)
- [PR Template Generation](#pr-template-generation)
- [Component Detection](#component-detection)
- [API Call Optimization](#api-call-optimization)
- [Error Handling](#error-handling)

## System Overview

rig-cli is a command-line orchestrator that coordinates multiple services to automate the software development lifecycle. It manages state transitions, executes commands, and delegates AI tasks to Claude Code agents.

### Architecture Pattern

```
┌─────────────────────────────────────────────────────────────┐
│                      CLI Layer                               │
│  (index.ts - Command registration and routing)              │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                   Command Layer                              │
│  (Commands: ship, next, implement, test, pr, review, etc.)  │
│  - Orchestrates workflow                                     │
│  - Manages state transitions                                 │
│  - Delegates to services                                     │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                   Service Layer                              │
│  - GitHubService: GitHub API operations                      │
│  - GitService: Git operations via shell                      │
│  - ClaudeService: Claude Code agent execution                │
│  - StateManager: State file persistence                      │
│  - TestRunnerService: Test execution and retry logic         │
│  - PrTemplateService: PR body generation                     │
│  - PromptBuilderService: Agent prompt assembly               │
│  - IssueQueueService: Issue prioritization                   │
│  - ConfigManager: Configuration loading                      │
│  - GuardService: Precondition checks                         │
└─────────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Composition over inheritance**: Commands compose services rather than extending base classes
2. **Single responsibility**: Each service handles one domain
3. **Fail-fast**: Validate preconditions before executing operations
4. **Idempotent operations**: Commands can be re-run safely
5. **State persistence**: All progress tracked in `.rig-state.json`

## Service Architecture

### Dependency Graph

```
ShipCommand
    ├─> NextCommand
    │       ├─> GitHubService
    │       ├─> GitService
    │       ├─> IssueQueueService
    │       │       └─> GitHubService
    │       ├─> StateManager
    │       └─> GuardService
    │
    ├─> ImplementCommand
    │       ├─> ClaudeService
    │       ├─> PromptBuilderService
    │       │       ├─> GitHubService
    │       │       ├─> GitService
    │       │       └─> TemplateEngine
    │       ├─> GitService
    │       ├─> StateManager
    │       └─> GuardService
    │
    ├─> TestCommand
    │       ├─> TestRunnerService
    │       │       ├─> GitService
    │       │       ├─> ConfigManager
    │       │       └─> Logger
    │       ├─> PromptBuilderService
    │       ├─> StateManager
    │       └─> GuardService
    │
    ├─> PrCommand
    │       ├─> PrTemplateService
    │       │       ├─> GitHubService
    │       │       ├─> GitService
    │       │       └─> TemplateEngine
    │       ├─> GitHubService
    │       ├─> GitService
    │       ├─> StateManager
    │       └─> GuardService
    │
    └─> ReviewCommand
            ├─> ClaudeService
            ├─> PromptBuilderService
            ├─> GitHubService
            ├─> StateManager
            └─> GuardService
```

### Service Descriptions

**GitHubService** (`src/services/github.service.ts`)
- Wraps GitHub CLI (`gh`)
- Operations: issue fetching, PR creation/editing, comment posting
- Returns parsed JSON from `gh` commands
- Throws on non-zero exit codes

**GitService** (`src/services/git.service.ts`)
- Wraps git commands via shell execution
- Operations: branch creation, status checking, diff generation, push/pull
- Returns stdout/stderr
- Used for both read (diff, log) and write (commit, push) operations

**ClaudeService** (`src/services/claude.service.ts`)
- Spawns Claude Code agent as child process
- Streams JSON output for real-time feedback
- Parameters: prompt, max_turns, allowed_tools, permission_mode
- Returns when agent completes or hits turn limit

**StateManager** (`src/services/state-manager.service.ts`)
- Reads/writes `.rig-state.json`
- Single source of truth for pipeline progress
- Atomic writes (write to temp file, then rename)
- Schema validation on read

**TestRunnerService** (`src/services/test-runner.service.ts`)
- Executes component-specific test commands
- Implements retry logic with fix agent
- Tracks test file changes (for coverage reporting)
- Aggregates results across multiple test suites

**PrTemplateService** (`src/services/pr-template.service.ts`)
- Assembles PR body from template
- Fetches issue data, commit history, diff stats
- Generates AI-powered test instructions
- Renders Mustache-style templates

**PromptBuilderService** (`src/services/prompt-builder.service.ts`)
- Constructs prompts for Claude agents
- Includes: issue context, codebase structure, previous errors
- Different prompt types: implement, fix, review
- Template-based with variable substitution

**IssueQueueService** (`src/services/issue-queue.service.ts`)
- Fetches open issues from GitHub
- Calculates priority scores
- Filters by phase, component, existing PRs
- Returns sorted list

**ConfigManager** (`src/services/config-manager.service.ts`)
- Loads and merges `.rig.yml`
- Deep merges with DEFAULT_CONFIG
- Caches parsed config
- Returns cloned config to prevent mutations

**GuardService** (`src/services/guard.service.ts`)
- Precondition checks: gh auth, git repo, etc.
- Throws descriptive errors on failures
- Used at command entry points

## State Management

### State File Structure

Location: `.rig-state.json` in project root

```typescript
interface State {
  issue_number: number;
  issue_title: string;
  branch: string;
  stage: StageName;
  stages: Record<StageName, StageStatus>;
}

type StageName = 'pick' | 'branch' | 'implement' | 'test' | 'pr' | 'review';
type StageStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
```

### State Transitions

```
State machine for each stage:

pending ─────────────> in_progress ──────────> completed
                             │
                             │
                             └──────────────────> failed
```

**Rules:**
- Stages execute in order: pick → branch → implement → test → pr → review
- Can't skip stages (must complete prerequisites)
- Failed stage stops pipeline
- Stages can transition: pending → in_progress → completed
- Failed stages require manual intervention (fix code, then retry)

### State Persistence Strategy

**Atomic Writes:**
```typescript
async write(state: State): Promise<void> {
  const tempFile = `${this.statePath}.tmp`;

  // Write to temp file
  await writeFile(tempFile, JSON.stringify(state, null, 2));

  // Atomic rename
  await rename(tempFile, this.statePath);
}
```

Prevents corruption if process is killed mid-write.

**Read Validation:**
```typescript
async read(): Promise<State> {
  const content = await readFile(this.statePath, 'utf-8');
  const state = JSON.parse(content);

  // Validate schema
  if (!state.issue_number || !state.stage || !state.stages) {
    throw new Error('Invalid state file');
  }

  return state;
}
```

### Stale State Detection

**Implementation:**
```typescript
// In ship.command.ts
const issue = await this.github.viewIssue(state.issue_number);

if (issue.state === 'closed') {
  const prs = await this.github.prListByIssue(state.issue_number);
  const hasMergedPr = prs.some(pr => pr.state === 'merged');

  if (hasMergedPr) {
    throw new Error('Issue already merged. Run `rig reset` to clear state.');
  }
}
```

Prevents working on issues that have been completed externally.

## Agent Orchestration

### Claude Code Integration

**Agent Invocation:**
```typescript
// In claude.service.ts
async run(params: {
  prompt: string;
  maxTurns: number;
  allowedTools: string;
  logFile: string;
  permissionMode: string;
}): Promise<ChildProcess> {
  const args = [
    '--max-turns', params.maxTurns.toString(),
    '--allowed-tools', params.allowedTools,
    '--log-file', params.logFile,
    '--permission-mode', params.permissionMode,
    '--stream-json',
    params.prompt
  ];

  return spawn('claude', args, { cwd: this.projectRoot });
}
```

**Stream Processing:**
```typescript
// In implement.command.ts
child.stdout.on('data', (data: Buffer) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    const parsed = JSON.parse(line);

    if (parsed.type === 'tool_use') {
      this.formatToolUse(parsed.name, parsed.input);
    } else if (parsed.type === 'text') {
      process.stdout.write(parsed.text);
    }
  }
});
```

Real-time feedback as agent executes.

### Allowed Tools by Component

**Decision Logic:**
```typescript
// In prompt-builder.service.ts
buildAllowedTools(component: ComponentType): string {
  const baseTools = ['Read', 'Edit', 'Write', 'Glob', 'Grep'];

  if (component === 'frontend') {
    return [...baseTools, 'Bash(npm:*,npx:*)', 'NotebookEdit'].join(',');
  }

  if (component === 'backend') {
    return [...baseTools, 'Bash(go:*)'].join(',');
  }

  if (component === 'fullstack') {
    return [...baseTools, 'Bash(npm:*,npx:*,go:*)', 'NotebookEdit'].join(',');
  }

  return baseTools.join(',');
}
```

**Rationale:**
- Restrict Bash access to prevent unintended commands
- Frontend: needs npm/npx for package management
- Backend: needs go commands for builds/tests
- Notebook editing only for frontend (Jupyter notebooks rare in backend)

### Change Detection

**Problem:** Agent may run without making changes (permission errors, already correct)

**Solution:**
```typescript
// In implement.command.ts
const changesBefore = await this.git.getStatus();
const commitBefore = await this.git.getCurrentCommit();

await this.claude.run({...});

const changesAfter = await this.git.getStatus();
const commitAfter = await this.git.getCurrentCommit();

const hasChanges = changesBefore !== changesAfter || commitBefore !== commitAfter;

if (!hasChanges) {
  // Mark as failed - no work done
  throw new Error('No file changes detected');
}
```

Catches scenarios where agent exits successfully but didn't modify code.

## Test Retry Logic

### Retry Mechanism

**Flow:**
```
Run tests
    │
    ▼
┌─────────────┐
│   Pass?     │
└─────────────┘
    │
    ├─> Yes: Continue pipeline
    │
    └─> No: Start retry loop
            │
            ▼
        ┌───────────────────┐
        │ Attempt < 3?      │
        └───────────────────┘
            │
            ├─> No: Fail pipeline
            │
            └─> Yes: Run fix agent
                    │
                    ▼
                ┌───────────────────┐
                │ Assemble fix      │
                │ prompt with:      │
                │ - Test errors     │
                │ - Failed tests    │
                │ - Test output     │
                └───────────────────┘
                    │
                    ▼
                ┌───────────────────┐
                │ Run Claude fix    │
                │ agent             │
                └───────────────────┘
                    │
                    ▼
                ┌───────────────────┐
                │ Retry tests       │
                └───────────────────┘
                    │
                    └──> (loop)
```

### Implementation

```typescript
// In ship.command.ts
let testAttempt = 0;
const MAX_TEST_RETRIES = 3;

while (testAttempt < MAX_TEST_RETRIES) {
  const testResult = await this.testRunner.runAllTests(component);

  if (testResult.success) {
    break; // Tests passed
  }

  testAttempt++;

  if (testAttempt >= MAX_TEST_RETRIES) {
    throw new Error('Tests failed after 3 attempts');
  }

  // Run fix agent
  const fixPrompt = this.promptBuilder.assembleFixPrompt(
    issueNumber,
    testResult.output
  );

  await this.claude.run({
    prompt: fixPrompt,
    maxTurns: this.config.getAgent().max_turns,
    allowedTools: this.promptBuilder.buildAllowedTools(component),
    logFile: `.rig-logs/fix-attempt-${testAttempt}.log`
  });
}
```

### Fix Prompt Construction

```typescript
// In prompt-builder.service.ts
assembleFixPrompt(issueNumber: number, testOutput: string): string {
  const template = `
Tests failed for issue #${issueNumber}.

Test output:
\`\`\`
${testOutput}
\`\`\`

Your task:
1. Analyze the test failures
2. Fix the code to make tests pass
3. Do not modify tests unless they are incorrect

Constraints:
- Only fix what's broken
- Preserve existing functionality
- Follow project conventions
`;

  return template;
}
```

**Context provided to fix agent:**
- Test error messages
- Stack traces
- Failed test names
- Full test output

## PR Template Generation

### Template Processing

**Flow:**
```
Issue number
    │
    ▼
┌──────────────────────┐
│ Fetch issue from     │
│ GitHub (1 API call)  │
└──────────────────────┘
    │
    ▼
┌──────────────────────┐
│ Extract summary:     │
│ - Look for Summary   │
│   section            │
│ - Fallback: first    │
│   paragraph          │
│ - Fallback: title    │
└──────────────────────┘
    │
    ▼
┌──────────────────────┐
│ Extract context:     │
│ - Acceptance         │
│   Criteria section   │
│ - Fallback:          │
│   Implementation     │
│   section            │
└──────────────────────┘
    │
    ▼
┌──────────────────────┐
│ Get commit log       │
│ git log master..HEAD │
└──────────────────────┘
    │
    ▼
┌──────────────────────┐
│ Generate AI test     │
│ steps based on:      │
│ - Issue content      │
│ - Commit messages    │
│ - Component type     │
└──────────────────────┘
    │
    ▼
┌──────────────────────┐
│ Render template      │
│ with variables       │
└──────────────────────┘
```

### AI-Powered Test Instructions

**Generation Logic:**
```typescript
// In pr-template.service.ts
private async generateManualTestSteps(
  issueBody: string,
  issueSummary: string,
  commitLog: string,
  component: ComponentType
): Promise<string> {
  // First: Check for existing testing section in issue
  const testingSectionMatch = issueBody.match(
    /(###?\\s+(Manual Testing|Testing Steps)[\\s\\S]*?)(?=\\n###|$)/i
  );

  if (testingSectionMatch) {
    return testingSectionMatch[1].trim();
  }

  // Second: Generate based on content analysis
  const combined = `${issueSummary} ${commitLog} ${issueBody}`.toLowerCase();
  const steps: string[] = [];

  if (combined.includes('responsive') || combined.includes('mobile')) {
    steps.push('Test at different viewport widths (mobile: 375px, tablet: 768px, desktop: 1920px)');
  }

  if (combined.includes('api') || combined.includes('endpoint')) {
    steps.push('Test API endpoints using curl or Postman with valid and invalid inputs');
  }

  // Fallback: generic steps
  if (steps.length === 0) {
    steps.push('Test the main user flow affected by this change');
    steps.push('Verify the changes work as described in the issue');
  }

  return steps.map((s, i) => `${i + 1}. ${s}`).join('\\n');
}
```

**Keywords analyzed:**
- `responsive`, `viewport`, `mobile` → viewport testing steps
- `button`, `click`, `ui` → interactive element testing
- `api`, `endpoint`, `backend` → API testing steps
- `css`, `style`, `design` → visual regression steps
- `error`, `validation` → error handling steps

## Component Detection

### Label-Based Detection

```typescript
// In prompt-builder.service.ts
detectComponent(labels: string[]): ComponentType {
  const labelNames = labels.map(l => l.toLowerCase());

  if (labelNames.includes('frontend')) return 'frontend';
  if (labelNames.includes('backend')) return 'backend';
  if (labelNames.includes('fullstack')) return 'fullstack';
  if (labelNames.includes('devnet')) return 'devnet';
  if (labelNames.includes('serverless')) return 'serverless';
  if (labelNames.includes('infra')) return 'infra';

  // Default: fullstack (safest - runs all tests)
  return 'fullstack';
}
```

**Rationale for fullstack default:**
- Safest option: runs all available test suites
- Catches issues that span multiple components
- Better to over-test than under-test

### Implications

Component determines:
1. **Which tests run**: frontend vs backend vs both
2. **Allowed tools**: npm/npx vs go commands vs both
3. **PR template**: different test instructions
4. **Directory context**: which paths to include in prompts

## API Call Optimization

### Problem

Original implementation fetched issue data twice:

```typescript
// First fetch: create state
const issue = await this.github.viewIssue(issueNumber);
state = { issue_title: issue.title, ... };

// Second fetch: component detection
const issue = await this.github.viewIssue(issueNumber);  // REDUNDANT!
const labels = issue.labels.map(...);
```

**Cost:**
- 2 GitHub API calls per command
- ~200-500ms latency each
- Consumes rate limit (5000/hour)

### Solution

**Issue Data Caching:**
```typescript
// In test.command.ts
async execute(options?: { issue?: string }): Promise<void> {
  let issueData: any;  // Cache issue data

  if (options?.issue) {
    // Fetch once
    issueData = await this.github.viewIssue(issueNumber);

    state = {
      issue_title: issueData.title,  // Use cached data
      ...
    };
  } else {
    state = await this.state.read();
    issueNumber = state.issue_number;

    // Fetch once for this path too
    issueData = await this.github.viewIssue(issueNumber);
  }

  // Reuse cached data
  const labels = issueData.labels.map(...);
  const component = this.promptBuilder.detectComponent(labels);
}
```

**Benefits:**
- 50% reduction in GitHub API calls
- 200-500ms faster per command
- Lower rate limit consumption
- Consistent data (no race condition if issue updated between calls)

**Applied to:**
- `test.command.ts`
- `pr.command.ts`
- `implement.command.ts`
- `review.command.ts`

## Error Handling

### Error Propagation Strategy

**Fail-fast at command entry:**
```typescript
// In pr.command.ts
async execute(): Promise<void> {
  // Guard checks first
  await this.guard.requireGhAuth();

  const stateExists = await this.state.exists();
  if (!stateExists) {
    throw new Error("No active pipeline");
  }

  // ... proceed with work
}
```

**Wrap external commands:**
```typescript
// In github.service.ts
async viewIssue(issueNumber: number): Promise<Issue> {
  const result = await exec(`gh issue view ${issueNumber} --json ...`);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to fetch issue: ${result.stderr}`);
  }

  return JSON.parse(result.stdout);
}
```

**Catch and contextualize:**
```typescript
// In ship.command.ts
try {
  await this.testCommand.execute();
} catch (error) {
  await this.state.write({
    ...state,
    stages: { ...state.stages, test: 'failed' }
  });

  this.logger.error(`Tests failed: ${error.message}`);
  this.logger.dim("Fix the issues and run 'rig test' again.");
  process.exit(1);
}
```

### State Recovery

Commands update state before and after operations:

**Before:**
```typescript
await this.state.write({
  ...state,
  stage: 'test',
  stages: { ...state.stages, test: 'in_progress' }
});
```

**After success:**
```typescript
await this.state.write({
  ...state,
  stages: { ...state.stages, test: 'completed' }
});
```

**After failure:**
```typescript
await this.state.write({
  ...state,
  stages: { ...state.stages, test: 'failed' }
});
```

This allows `rig ship` to resume from failure point.

### Logging Strategy

**Structured logs:**
```
.rig-logs/
  ├── implement-issue-42.log  # Full Claude agent output
  ├── test-issue-42.log       # Test run output
  ├── fix-attempt-1.log       # First fix attempt
  ├── fix-attempt-2.log       # Second fix attempt
  ├── fix-attempt-3.log       # Third fix attempt
  └── review-issue-42.log     # Review agent output
```

**Log file naming:**
```typescript
const logFile = path.join(
  this.projectRoot,
  '.rig-logs',
  `${stage}-issue-${issueNumber}.log`
);
```

Predictable paths for debugging.

## Performance Characteristics

### Command Latencies

Typical execution times (network-dependent):

- `rig queue`: ~500ms (1 GitHub API call)
- `rig next`: ~1-2s (fetch issues, create branch)
- `rig implement`: ~2-10min (agent execution)
- `rig test`: ~30s-5min (test suite dependent)
- `rig pr`: ~2-3s (generate template, create PR)
- `rig review`: ~1-3min (agent execution)

### Optimization Opportunities

**Current:**
- Issue data fetched once per command (optimized)
- State file read/written atomically (safe)
- No caching between command invocations (stateless)

**Potential improvements:**
- Cache issue data across commands in same session
- Parallel execution of lint/build/test (currently sequential)
- Incremental test running (only changed files)
- Pre-fetch issue data while agent is running

### Resource Usage

- Memory: <100MB (lightweight, mostly I/O bound)
- Disk: Logs can grow large (100KB-10MB per issue)
- Network: Dominated by GitHub API calls and Claude API
- CPU: Minimal (spawns child processes for git/gh/claude)
