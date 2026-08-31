import { ValidLabel } from './labels.types.js';

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
  git: GitConfig;
  /** Enable verbose debug output (default: false) */
  verbose?: boolean;
  /** Default labels to apply when creating issues via rig create-issue (default: []) */
  defaultLabels?: ValidLabel[];
}

/**
 * Default configuration values.
 * These are used when .rig.yml is missing or fields are omitted.
 */
export const DEFAULT_CONFIG: RigConfig = {
  git: {},
  verbose: false,
};
