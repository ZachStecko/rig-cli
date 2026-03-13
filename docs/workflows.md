# rig-cli Workflows

This document explains how to use rig-cli in different scenarios, from full automated pipelines to ad-hoc command execution.

## Table of Contents

- [Full Pipeline Workflow](#full-pipeline-workflow)
- [Modular Command Usage](#modular-command-usage)
- [Error Recovery](#error-recovery)
- [Multi-Component Projects](#multi-component-projects)
- [State Lifecycle](#state-lifecycle)

## Full Pipeline Workflow

The standard workflow runs the complete issue-to-PR pipeline.

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              rig ship                                        │
├──────────┬──────────────┬─────────────┬──────────────┬───────────────────────┤
│  pick    │  implement   │    test     │      pr      │       review          │
│          │              │             │              │                       │
│ Fetch    │ Assemble     │ Component   │ Fetch issue  │ Assemble review       │
│ issues   │ prompt       │ detection   │ Generate     │ prompt                │
│ from     │ with issue   │ Run lint    │ PR body      │ Run Claude agent      │
│ GitHub   │ context      │ Run build   │ from         │ (read-only)           │
│          │              │ Run tests   │ template     │                       │
│ Priority │ Run Claude   │             │              │ Parse findings        │
│ calc     │ Code agent   │ On fail:    │ Push to      │ by severity           │
│          │              │ retry 3x    │ remote       │                       │
│ Filter   │ Agent writes │ with fix    │              │ Interactive           │
│ by phase │ code         │ agent       │ Create or    │ triage                │
│ Filter   │              │             │ update PR    │                       │
│ by       │ Detects file │ Each retry  │ via gh CLI   │ Auto-fix selected     │
│ component│ changes or   │ includes    │              │ findings              │
│          │ commits      │ test error  │ Update state │                       │
│ Create   │              │ context     │ with PR URL  │ Commit fixes          │
│ branch   │ Logs to      │             │              │                       │
│          │ .rig-logs/   │ Logs to     │ Logs to      │ Logs to               │
│ Init     │              │ .rig-logs/  │ .rig-logs/   │ .rig-logs/            │
│ state    │              │             │              │ .rig-reviews/         │
└──────────┴──────────────┴─────────────┴──────────────┴───────────────────────┘
     │              │             │              │               │
     ▼              ▼             ▼              ▼               ▼
         .rig-state.json tracks progress across all stages
            Updated after each stage completes or fails
```

### Usage

```bash
# Start with highest priority issue
$ rig ship

# Filter by phase
$ rig ship --phase "Phase 1: MVP"

# Filter by component
$ rig ship --component backend

# Combine filters
$ rig ship --phase "Phase 2" --component frontend
```

### Resume Behavior

Pipeline state persists in `.rig-state.json`. If interrupted, run `rig ship` again:

```
First run (interrupted):

┌───────┬───────────┬───────┬────┬────────┐
│ pick  │implement  │ test  │ pr │ review │
│  ✓    │    ✓      │   ✓   │    │        │
└───────┴───────────┴───────┴────┴────────┘
                              ▲
                         interrupted

Resume:

┌───────┬───────────┬───────┬────┬────────┐
│ pick  │implement  │ test  │ pr │ review │
│  ✓    │    ✓      │   ✓   │ →  │   →    │
└───────┴───────────┴───────┴────┴────────┘
                              ▲
                         resumes here
```

## Modular Command Usage

Commands can run independently without an active pipeline by using the `--issue` flag.

### Use Cases

1. **Run tests for any issue**: Test changes without starting a full pipeline
2. **Create PR from old branch**: Make a PR for work done outside the pipeline
3. **Re-run specific stage**: Repeat a single stage without redoing prior work
4. **Work on multiple issues**: Switch between issues without maintaining pipeline state

### Comparison: Pipeline vs Modular

```
Pipeline Mode                    Modular Mode
─────────────                    ────────────

rig next                         (skip)
  ↓                                 │
Creates .rig-state.json             │
  ↓                                 │
rig ship                         rig test --issue 42
  ↓                                 ↓
Uses state                       Fetches issue
Runs all stages                  Auto-detects component
  ↓                              Creates temp state
State persists                   Runs tests only
                                    ↓
                                 State discarded
```

### Flow: Modular Test Command

```
$ rig test --issue 42
        │
        ▼
┌───────────────────────────┐
│  Parse issue number       │
└───────────────────────────┘
        │
        ▼
┌───────────────────────────┐
│  Fetch issue from GitHub  │
│  (1 API call, cached)     │
└───────────────────────────┘
        │
        ├─────────────────────────┐
        │                         │
        ▼                         ▼
Check for existing      No existing state
.rig-state.json
        │                         │
        ▼                         ▼
Load state             Create minimal temp state:
                       {
                         issue_number: 42,
                         issue_title: "...",
                         branch: "issue-42-...",
                         stage: "test",
                         stages: {...}
                       }
        │                         │
        └────────┬────────────────┘
                 │
                 ▼
        ┌────────────────────┐
        │ Auto-detect        │
        │ component from     │
        │ issue labels       │
        └────────────────────┘
                 │
                 ▼
        ┌────────────────────┐
        │ Run appropriate    │
        │ test suite         │
        │ (lint, build,      │
        │  tests)            │
        └────────────────────┘
                 │
                 ▼
        ┌────────────────────┐
        │ If created temp    │
        │ state: discard it  │
        │                    │
        │ If loaded existing │
        │ state: update it   │
        └────────────────────┘
```

### Flow: Modular PR Command

```
$ git checkout old-feature-branch
$ rig pr --issue 456
        │
        ▼
┌───────────────────────────┐
│  Fetch issue #456         │
│  (1 API call, cached)     │
└───────────────────────────┘
        │
        ▼
┌───────────────────────────┐
│  git.currentBranch()      │
│  → old-feature-branch     │
└───────────────────────────┘
        │
        ▼
┌───────────────────────────┐
│  Auto-detect component    │
│  from issue labels        │
└───────────────────────────┘
        │
        ▼
┌───────────────────────────┐
│  Generate PR body from    │
│  template:                │
│  - Issue summary          │
│  - Commit log             │
│  - AI-generated tests     │
└───────────────────────────┘
        │
        ▼
┌───────────────────────────┐
│  Check for existing PR    │
│  on this branch           │
└───────────────────────────┘
        │
    ┌───┴────┐
    │        │
    ▼        ▼
 Found    Not found
    │        │
    ▼        ▼
Update    Create
  PR        PR
    │        │
    └───┬────┘
        │
        ▼
┌───────────────────────────┐
│  Return PR URL            │
└───────────────────────────┘
```

### Examples

```bash
# Test changes for any issue
$ rig test --issue 123
Testing Issue #123
Component: backend
Running tests...
✓ Tests passed

# Create PR from current branch for any issue
$ git checkout feature-xyz
$ rig pr --issue 456
Creating Pull Request for Issue #456
Branch: feature-xyz
✓ PR created: https://github.com/owner/repo/pull/789

# Override component detection
$ rig test --issue 42 --component frontend
# Runs frontend tests even if issue labeled "backend"

# Combine with pipeline (not recommended)
$ rig ship          # Creates pipeline state
$ rig test          # Uses pipeline state
$ rig test --issue 99  # AVOID: confusing, creates temp state
```

## Error Recovery

### Test Failure with Auto-Retry

```
rig test
    │
    ▼
┌─────────────────────┐
│  Run test suite     │
└─────────────────────┘
    │
┌───┴───┐
│       │
▼       ▼
Pass    Fail
│       │
│       ▼
│   ┌─────────────────────┐
│   │  Increment retry    │
│   │  count (1/3)        │
│   └─────────────────────┘
│       │
│       ▼
│   ┌─────────────────────┐
│   │  Assemble fix       │
│   │  prompt:            │
│   │  - Test errors      │
│   │  - Failed test code │
│   │  - Error messages   │
│   └─────────────────────┘
│       │
│       ▼
│   ┌─────────────────────┐
│   │  Run Claude fix     │
│   │  agent              │
│   └─────────────────────┘
│       │
│       ▼
│   ┌─────────────────────┐
│   │  Retry test suite   │
│   └─────────────────────┘
│       │
│   ┌───┴───┐
│   │       │
│   ▼       ▼
│  Pass    Fail (retry < 3)
│   │       │
│   │       └──────┐
│   │              │
│   └──────┬───────┘
│          │
│          ▼
│  ┌─────────────────────┐
│  │  Retry count >= 3?  │
│  └─────────────────────┘
│          │
│      ┌───┴───┐
│      │       │
│      ▼       ▼
│     Yes      No
│      │       │
│      ▼       └─── (loop back)
│  ┌─────────────────────┐
│  │  Mark test: failed  │
│  │  Exit pipeline      │
│  └─────────────────────┘
│
└────────────────┐
                 │
                 ▼
         ┌─────────────────────┐
         │  Mark test:         │
         │  completed          │
         │  Continue pipeline  │
         └─────────────────────┘
```

### What to Do When Auto-Fix Fails

After 3 failed retry attempts:

```bash
# 1. Check the fix agent logs
$ cat .rig-logs/fix-attempt-3.log

# 2. Review test errors
$ rig test  # Re-run to see current errors

# 3. Fix manually
$ # Make necessary code changes

# 4. Resume pipeline
$ rig test  # Verify tests pass
$ rig ship  # Continue from current stage
```

### Stale State Recovery

Pipeline detects stale state when:
- Issue has been closed on GitHub
- Issue has merged PR already

```
rig ship
    │
    ▼
┌─────────────────────┐
│  Load state         │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Fetch issue from   │
│  GitHub             │
└─────────────────────┘
    │
┌───┴────┐
│        │
▼        ▼
Open     Closed
│        │
│        ▼
│    ┌─────────────────────┐
│    │  Check for merged   │
│    │  PRs on this issue  │
│    └─────────────────────┘
│        │
│    ┌───┴───┐
│    │       │
│    ▼       ▼
│   Found   None
│    │       │
│    ▼       ▼
│    Abort: Issue closed/merged
│    │
│    ▼
│  ┌─────────────────────┐
│  │  Suggest:           │
│  │  rig reset          │
│  │  or rig rollback    │
│  └─────────────────────┘
│
└──────────────┐
               │
               ▼
       ┌─────────────────────┐
       │  Continue pipeline  │
       └─────────────────────┘
```

### Branch Conflict Recovery

```bash
# Conflict detected during git push
$ rig pr
error: failed to push some refs

# Resolution:
$ git pull origin main
$ git rebase main
$ # Resolve conflicts
$ git rebase --continue
$ rig pr  # Retry
```

## Multi-Component Projects

### Component Detection

```
Issue on GitHub
      │
      ▼
┌──────────────────┐
│  Fetch labels    │
└──────────────────┘
      │
      ▼
┌──────────────────┐
│  Check for:      │
│  - frontend      │
│  - backend       │
│  - fullstack     │
│  - devnet        │
│  - serverless    │
│  - infra         │
└──────────────────┘
      │
  ┌───┴───────┬──────────┬─────────┐
  │           │          │         │
  ▼           ▼          ▼         ▼
frontend   backend   fullstack   (none)
  │           │          │         │
  │           │          │         ▼
  │           │          │    ┌──────────┐
  │           │          │    │ Default: │
  │           │          │    │fullstack │
  │           │          │    └──────────┘
  │           │          │         │
  └───────────┴──────────┴─────────┘
              │
              ▼
      ┌──────────────────┐
      │  Run appropriate │
      │  test commands   │
      └──────────────────┘
```

### Fullstack Test Execution

```
Component: fullstack
        │
        ▼
┌───────────────────────┐
│  Run frontend tests   │
│  cd frontend &&       │
│  npm test             │
└───────────────────────┘
        │
        ▼
┌───────────────────────┐
│  Run frontend lint    │
│  cd frontend &&       │
│  npm run lint         │
└───────────────────────┘
        │
        ▼
┌───────────────────────┐
│  Run frontend build   │
│  cd frontend &&       │
│  npm run build        │
└───────────────────────┘
        │
        ▼
┌───────────────────────┐
│  Run backend tests    │
│  cd backend &&        │
│  go test ./...        │
└───────────────────────┘
        │
        ▼
┌───────────────────────┐
│  Aggregate results    │
│  All must pass        │
└───────────────────────┘
```

### Override Component Detection

```bash
# Issue labeled "fullstack" but you only want backend tests
$ rig test --component backend

# Issue labeled "frontend" but you want to run all tests
$ rig test --component fullstack
```

## State Lifecycle

### State Creation and Cleanup

```
No state
    │
    ▼
┌────────────────┐
│  rig next      │
└────────────────┘
    │
    ▼
┌────────────────────────────┐
│  Create .rig-state.json:   │
│  {                         │
│    issue_number: 42,       │
│    issue_title: "...",     │
│    branch: "issue-42-...", │
│    stage: "pick",          │
│    stages: {               │
│      pick: "completed",    │
│      branch: "pending",    │
│      implement: "pending", │
│      test: "pending",      │
│      pr: "pending",        │
│      review: "pending"     │
│    }                       │
│  }                         │
└────────────────────────────┘
    │
    ▼
┌────────────────┐
│  rig ship      │
│  (stages run)  │
└────────────────┘
    │
    ▼
Each stage completion:
    │
    ▼
┌────────────────────────────┐
│  Update state:             │
│  - stage: "test"           │
│  - stages.test: "completed"│
└────────────────────────────┘
    │
    ▼
All stages complete
    │
    ▼
┌────────────────┐
│  rig reset     │
│  or            │
│  rig rollback  │
└────────────────┘
    │
    ▼
┌────────────────────────────┐
│  Delete .rig-state.json    │
└────────────────────────────┘
```

### State File Structure

```json
{
  "issue_number": 42,
  "issue_title": "Add user authentication",
  "branch": "issue-42-add-user-authentication",
  "stage": "test",
  "stages": {
    "pick": "completed",
    "branch": "completed",
    "implement": "completed",
    "test": "in_progress",
    "pr": "pending",
    "review": "pending"
  }
}
```

Stage status values:
- `pending`: Not started
- `in_progress`: Currently running
- `completed`: Successfully finished
- `failed`: Encountered error (pipeline stops)

### Commands and State Interaction

```
Command              State Required?    Creates State?    Modifies State?
─────────────────────────────────────────────────────────────────────────
rig next             No                 Yes               Yes
rig ship             No (resumes)       No                Yes
rig implement        No*                No*               Yes
rig test             No*                No*               Yes
rig pr               No*                No*               Yes
rig review           No*                No*               Yes
rig status           Yes                No                No
rig reset            Yes                No                Deletes
rig rollback         Yes                No                Deletes
rig queue            No                 No                No
rig bootstrap        No                 No                No
rig create-issue     No                 No                No

* With --issue flag: command works without state, creates temp state internally
```

## Best Practices

### When to Use Full Pipeline

Use `rig ship` for:
- Standard development workflow
- Issues that require all stages
- Team consistency (everyone follows same process)
- Tracking progress across interruptions

### When to Use Modular Commands

Use `--issue` flags for:
- Testing someone else's work
- Creating PRs for old branches
- Re-running failed stages
- Working on multiple issues simultaneously
- Debugging specific stages

### State Management

- Don't commit `.rig-state.json` to version control (add to `.gitignore`)
- Use `rig status` to check current progress
- Use `rig reset` when switching issues
- Use `rig rollback` to completely undo work
- Don't manually edit `.rig-state.json` (corruption risk)

### Error Handling

- Check `.rig-logs/` for detailed error information
- Fix agent logs show what automated fixes attempted
- After manual fixes, re-run the failed stage
- If auto-retry fails 3 times, inspect logs before manual intervention
