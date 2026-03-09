import { GitService } from './git.service.js';
import { GitHubService } from './github.service.js';
import { StateManager } from './state-manager.js';
import { GuardError } from '../types/error.types.js';
import { exec } from '../utils/shell.js';

/**
 * GuardService validates preconditions before operations.
 *
 * All `require*` methods throw GuardError on failure.
 * This allows callers to catch and handle failures without process.exit.
 *
 * Takes service dependencies via constructor for testability.
 */
export class GuardService {
  private git: GitService;
  private github: GitHubService;
  private stateManager: StateManager;

  /**
   * Creates a new GuardService instance.
   *
   * @param git - GitService instance for git operations
   * @param github - GitHubService instance for GitHub operations
   * @param stateManager - StateManager instance for state checking
   */
  constructor(
    git: GitService,
    github: GitHubService,
    stateManager: StateManager
  ) {
    this.git = git;
    this.github = github;
    this.stateManager = stateManager;
  }

  /**
   * Requires that the git working tree is clean (no uncommitted changes).
   *
   * @throws GuardError if working tree has uncommitted changes
   */
  async requireGitClean(): Promise<void> {
    const isClean = await this.git.isClean();
    if (!isClean) {
      throw new GuardError(
        'Working directory has uncommitted changes. Please commit or stash them first.'
      );
    }
  }

  /**
   * Requires that the current branch is main or master.
   *
   * @throws GuardError if not on master/main branch
   */
  async requireOnMaster(): Promise<void> {
    const isOnMaster = await this.git.isOnMaster();
    if (!isOnMaster) {
      const currentBranch = await this.git.currentBranch();
      throw new GuardError(
        `Must be on main or master branch. Currently on: ${currentBranch}`
      );
    }
  }

  /**
   * Requires that the current branch is a feature branch (not main/master).
   *
   * @throws GuardError if on master/main branch
   */
  async requireOnFeatureBranch(): Promise<void> {
    const isOnFeatureBranch = await this.git.isOnFeatureBranch();
    if (!isOnFeatureBranch) {
      const currentBranch = await this.git.currentBranch();
      throw new GuardError(
        `Must be on a feature branch. Currently on: ${currentBranch}`
      );
    }
  }

  /**
   * Requires that the GitHub CLI (gh) is installed and authenticated.
   *
   * @throws GuardError if gh is not installed or not authenticated
   */
  async requireGhAuth(): Promise<void> {
    const isInstalled = await this.github.isInstalled();
    if (!isInstalled) {
      throw new GuardError(
        'GitHub CLI (gh) is not installed. Install it from: https://cli.github.com/'
      );
    }

    const isAuthenticated = await this.github.isAuthenticated();
    if (!isAuthenticated) {
      throw new GuardError(
        'GitHub CLI (gh) is not authenticated. Run: gh auth login'
      );
    }
  }

  /**
   * Requires that the Claude CLI is installed.
   *
   * @throws GuardError if claude CLI is not found
   */
  async requireClaude(): Promise<void> {
    const result = await exec('claude --version');
    if (result.exitCode !== 0) {
      throw new GuardError(
        'Claude CLI is not installed. Install it from: https://github.com/anthropics/claude-cli'
      );
    }
  }

  /**
   * Requires that .rig-state.json exists (pipeline is in progress).
   *
   * @throws GuardError if state file does not exist
   */
  async requireState(): Promise<void> {
    const exists = await this.stateManager.exists();
    if (!exists) {
      throw new GuardError(
        'No active pipeline state found (.rig-state.json). Start a new pipeline first.'
      );
    }
  }

  /**
   * Checks if Docker is available on the system.
   * Unlike require* methods, this returns a boolean instead of throwing.
   *
   * @returns true if docker is available, false otherwise
   */
  async checkDocker(): Promise<boolean> {
    const result = await exec('docker --version');
    return result.exitCode === 0;
  }
}
