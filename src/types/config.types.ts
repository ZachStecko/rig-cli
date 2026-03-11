/**
 * Configuration for Claude agent behavior.
 */
export interface AgentConfig {
  /** Maximum turns for Claude agent execution (default: 80) */
  max_turns: number;
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

/**
 * Configuration for demo recording.
 */
export interface DemoConfig {
  /** Whether to record demos (default: true) */
  enabled: boolean;
}

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
}

/**
 * Configuration for project components.
 */
export interface ComponentsConfig {
  frontend?: ComponentConfig;
  backend?: ComponentConfig;
  infra?: ComponentConfig;
  serverless?: ComponentConfig;
}

/**
 * Root configuration object loaded from .rig.yml.
 * All fields are optional in the YAML file; missing values use defaults.
 */
export interface RigConfig {
  agent: AgentConfig;
  queue: QueueConfig;
  test: TestConfig;
  demo: DemoConfig;
  pr: PrConfig;
  components?: ComponentsConfig;
}

/**
 * Default configuration values.
 * These are used when .rig.yml is missing or fields are omitted.
 */
export const DEFAULT_CONFIG: RigConfig = {
  agent: { max_turns: 80 },
  queue: { default_phase: null, default_component: null },
  test: { require_new_tests: true },
  demo: { enabled: true },
  pr: { draft: false, reviewers: [] },
};
