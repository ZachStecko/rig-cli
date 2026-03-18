# Configuration Examples

Real-world configuration examples for different project types.

Copy the appropriate example to your project root as `.rig.yml` and modify as needed.

## Available Examples

1. **frontend-only.yml** - React/Vue/Angular single-page application
2. **backend-only.yml** - Go/Node API server
3. **fullstack-monorepo.yml** - Monorepo with multiple components
4. **enterprise-team.yml** - Team workflow with strict controls
5. **minimal.yml** - Bare minimum configuration

## Usage

```bash
# Copy example to your project
cp docs/examples/frontend-only.yml .rig.yml

# Edit to match your project structure
vim .rig.yml

# Verify configuration
rig queue  # Should load without errors
```

## Configuration Tips

- Start with minimal config, add settings as needed
- Test locally before committing to team config
- Use verbose mode to debug config issues: `verbose: true`
- Keep component paths relative to project root
- Don't commit `.rig-state.json` (add to .gitignore)

## Common Modifications

### Change Test Commands

```yaml
components:
  frontend:
    test_command: npm run test:ci  # Your CI test script
```

### Add Priority Labels

```yaml
queue:
  label_priorities:
    "urgent": 10
    "high": 5
    "medium": 3
    "low": 1
```

### Restrict to Specific Phase

```yaml
queue:
  default_phase: "Sprint 3"  # Only show Sprint 3 issues
```

### Change Base Branch

```yaml
git:
  base_branch: develop  # Use "develop" instead of auto-detected main/master
```

### Auto-Assign Reviewers

```yaml
pr:
  reviewers:
    - senior-dev-username
    - team-lead-username
```
