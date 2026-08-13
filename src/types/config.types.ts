import { ValidLabel } from './labels.types.js';

/**
 * Configuration for the LLM provider used to structure issues and PRs.
 */
export interface AgentConfig {
  /** Agent provider: 'binary' uses the Claude CLI (works with Max subscription), 'sdk' uses the Anthropic API (requires ANTHROPIC_API_KEY) (default: 'binary') */
  provider?: 'sdk' | 'binary';
  /** Timeout in seconds for Claude prompt calls (default: 120) */
  timeout?: number;
}

/**
 * Configuration for git operations.
 */
export interface GitConfig {
  /** Base branch name for diff/merge operations (default: auto-detect main or master) */
  base_branch?: string;
}

/**
 * Root configuration object loaded from .rig.yml.
 * All fields are optional in the YAML file; missing values use defaults.
 */
export interface RigConfig {
  agent: AgentConfig;
  git: GitConfig;
  /** Enable verbose debug output (default: false) */
  verbose?: boolean;
  /** Default labels to apply when creating issues via rig create-issue (default: []) */
  defaultLabels?: ValidLabel[];
  /**
   * Path to a markdown style guide injected into every AI prompt, so
   * generated issue titles and bodies follow your writing rules.
   * Relative to the project root; '~/' expands to the home directory.
   */
  style_file?: string;
}

/**
 * Default configuration values.
 * These are used when .rig.yml is missing or fields are omitted.
 */
export const DEFAULT_CONFIG: RigConfig = {
  agent: { provider: 'binary', timeout: 120 },
  git: {},
  verbose: false,
};
