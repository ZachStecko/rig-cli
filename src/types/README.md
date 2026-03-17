# Type Definitions

This directory contains TypeScript type definitions for the rig-cli project.

## Label System (`labels.types.ts`)

**This file is the single source of truth for all GitHub issue labels used in rig-cli.**

### Purpose

The label system provides:
- Type-safe label references throughout the codebase
- Validation of user-provided labels in `.rig.yml`
- Centralized label management (add/remove labels in one place)
- Auto-completion and IntelliSense support in IDEs

### Usage

#### Importing Labels

```typescript
import {
  COMPONENT_LABELS,
  PRIORITY_LABELS,
  isValidLabel,
  type ValidLabel
} from '../types/labels.types.js';
```

#### Using Label Constants

```typescript
// Reference labels by constant instead of string literals
const labels = [COMPONENT_LABELS.BACKEND, PRIORITY_LABELS.P0];

// Instead of:
const labels = ['backend', 'P0']; // ❌ Not type-safe
```

#### Validating Labels

```typescript
import { isValidLabel, getAllValidLabels } from '../types/labels.types.js';

if (!isValidLabel(userProvidedLabel)) {
  console.error(`Invalid label: ${userProvidedLabel}`);
  console.log(`Valid labels: ${getAllValidLabels().join(', ')}`);
}
```

#### Type Safety in Config

```typescript
import { ValidLabel } from '../types/labels.types.js';

interface Config {
  defaultLabels?: ValidLabel[]; // ✅ Type-safe
  // Instead of:
  // defaultLabels?: string[]; // ❌ Not type-safe
}
```

### Adding New Labels

To add a new label to the system:

1. **Choose the appropriate category** in `labels.types.ts`:
   - `COMPONENT_LABELS` - System components (backend, frontend, etc.)
   - `PRIORITY_LABELS` - Priority levels (P0-P4)
   - `PHASE_LABELS` - Project phases (Phase 1: MVP, etc.)
   - `TYPE_LABELS` - Work types (bug, feature, enhancement, etc.)
   - `STATUS_LABELS` - Workflow states (needs-triage, in-progress, etc.)
   - `SPECIAL_LABELS` - Rig-specific markers (rig-generated, etc.)

2. **Add the constant**:
   ```typescript
   export const COMPONENT_LABELS = {
     BACKEND: 'backend',
     FRONTEND: 'frontend',
     NEW_COMPONENT: 'new-component', // Add this
   } as const;
   ```

3. **The label is automatically included** in `ALL_LABELS` and `ValidLabel` type via the spread operator.

4. **Update documentation** in `docs/configuration.md` to reflect the new label.

5. **Create the label in GitHub** (this is manual, rig doesn't create labels):
   ```bash
   gh label create "new-component" --description "New component" --color "0366d6"
   ```

### Removing Labels

To remove a label:

1. **Delete the constant** from the appropriate category in `labels.types.ts`
2. **Update documentation** in `docs/configuration.md`
3. **Search for usages** across the codebase and update accordingly
4. **(Optional) Archive the label in GitHub** if no longer needed

### Label Categories

#### Component Labels
Indicate which part of the system an issue affects. Used for:
- Test runner selection (which tests to run)
- Component detection in `PromptBuilderService`
- Issue filtering in queue commands

#### Priority Labels
Indicate urgency/importance. Used for:
- Issue queue sorting
- Priority-based filtering
- SLA tracking

#### Phase Labels
Indicate project milestone/phase. Used for:
- Roadmap organization
- Queue filtering by phase
- Priority calculation (phase multipliers)

#### Type Labels
Indicate the kind of work. Used for:
- Issue categorization
- Commit message prefixes
- Workflow routing

#### Status Labels
Indicate workflow state. Used for:
- Kanban/status tracking
- Automatic label updates during rig commands
- Issue lifecycle management

#### Special Labels
Rig-specific markers. Used for:
- Identifying AI-generated issues
- Tracking rig-created content
- Special handling in workflows

### Best Practices

1. **Always use constants, not strings**:
   ```typescript
   // ✅ Good
   labels: [COMPONENT_LABELS.BACKEND]

   // ❌ Bad
   labels: ['backend']
   ```

2. **Validate user input**:
   ```typescript
   const userLabels = config.defaultLabels || [];
   const invalid = userLabels.filter(l => !isValidLabel(l));
   if (invalid.length > 0) {
     throw new Error(`Invalid labels: ${invalid.join(', ')}`);
   }
   ```

3. **Use TypeScript types for function parameters**:
   ```typescript
   function processLabels(labels: ValidLabel[]): void {
     // Function signature enforces valid labels
   }
   ```

4. **Document why labels exist** if the purpose isn't obvious.

### Migration from Free-Form Strings

Before this system, labels were free-form strings throughout the codebase. Benefits of the new system:

- **Type Safety**: Catch typos at compile time instead of runtime
- **Discoverability**: IDE auto-completion shows all available labels
- **Refactoring**: Rename labels safely using IDE refactoring tools
- **Documentation**: Single source of truth for what labels exist
- **Validation**: User-provided labels are validated against the canonical set

### Related Files

- `src/types/config.types.ts` - Uses `ValidLabel` type for `defaultLabels` config
- `src/commands/create-issue.command.ts` - Validates labels before issue creation
- `docs/configuration.md` - User-facing documentation of valid labels
- `tests/types/labels.types.test.ts` - Comprehensive tests for label system
- `tests/commands/create-issue.command.test.ts` - Tests for label validation in commands
