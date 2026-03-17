import { ValidLabel } from './labels.types.js';

/**
 * Configuration for Claude agent behavior.
 */
export interface AgentConfig {
  /** Agent provider: 'binary' uses the Claude CLI (works with Max subscription), 'sdk' uses the Anthropic API (requires ANTHROPIC_API_KEY) (default: 'binary') */
  provider?: 'sdk' | 'binary';
  /** Maximum turns for Claude agent execution (default: 80) */
  max_turns: number;
  /** Permission mode for file operations: 'default' requires approval, 'bypassPermissions' auto-approves all, 'acceptEdits' accepts edits, 'dontAsk' skips prompts, 'plan' for plan mode, 'auto' for automatic (default: 'bypassPermissions') */
  permission_mode?: 'default' | 'bypassPermissions' | 'acceptEdits' | 'dontAsk' | 'plan' | 'auto';
  /** Timeout in seconds for Claude prompt calls (default: 120) */
  timeout?: number;
}

/**
 * Configuration for issue queue filtering.
 */
export interface QueueConfig {
  /** Default phase filter (e.g., "Phase 1: MVP") */
  default_phase: string | null;
  /** Default component filter (e.g., "backend", "frontend") */
  default_component: string | null;
}

/**
 * Configuration for test execution requirements.
 */
export interface TestConfig {
  /** Whether new code requires new test files (default: true) */
  require_new_tests: boolean;
}

// DISABLED: Demo feature disabled for redesign
// /**
//  * Configuration for demo recording.
//  */
// export interface DemoConfig {
//   /** Whether to record demos (default: true) */
//   enabled: boolean;
// }

/**
 * Configuration for pull request creation.
 */
export interface PrConfig {
  /** Whether to create PRs as drafts (default: false) */
  draft: boolean;
  /** GitHub usernames to request reviews from */
  reviewers: string[];
}

/**
 * Configuration for a single component (frontend/backend).
 */
export interface ComponentConfig {
  /** Path to component directory */
  path: string;
  /** Command to run tests for this component */
  test_command: string;
  /** Command to run linting (optional) */
  lint_command?: string;
  /** Command to build/compile (optional) */
  build_command?: string;
}

/**
 * Configuration for project components.
 */
export interface ComponentsConfig {
  frontend?: ComponentConfig;
  backend?: ComponentConfig;
  infra?: ComponentConfig;
  serverless?: ComponentConfig;
  node?: ComponentConfig;
}

/**
 * Root configuration object loaded from .rig.yml.
 * All fields are optional in the YAML file; missing values use defaults.
 */
export interface RigConfig {
  agent: AgentConfig;
  queue: QueueConfig;
  test: TestConfig;
  // demo: DemoConfig; // DISABLED: Demo feature disabled for redesign
  pr: PrConfig;
  /** Enable verbose debug output (default: false) */
  verbose?: boolean;
  components?: ComponentsConfig;
  /** Default labels to apply when creating issues via rig create-issue (default: []) */
  defaultLabels?: ValidLabel[];
}

/**
 * Default configuration values.
 * These are used when .rig.yml is missing or fields are omitted.
 */
export const DEFAULT_CONFIG: RigConfig = {
  agent: { provider: 'binary', max_turns: 80, permission_mode: 'bypassPermissions', timeout: 120 },
  queue: { default_phase: null, default_component: null },
  test: { require_new_tests: true },
  // demo: { enabled: true }, // DISABLED: Demo feature disabled for redesign
  pr: { draft: false, reviewers: [] },
  verbose: false,
};
