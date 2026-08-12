import { exec } from '../utils/shell.js';

/**
 * GitService wraps git commands for repository operations.
 *
 * All commands use `git -C <projectRoot>` to run in the correct directory.
 * Throws errors when git commands fail (non-zero exit code).
 */
export class GitService {
  private projectRoot: string;
  private baseBranch?: string;

  /**
   * Creates a new GitService instance.
   *
   * @param projectRoot - Absolute path to the git repository root
   * @param baseBranch - Optional configured base branch name (e.g. "main", "master", "develop")
   */
  constructor(projectRoot: string, baseBranch?: string) {
    this.projectRoot = projectRoot;
    this.baseBranch = baseBranch;
  }

  /**
   * Sets the base branch for all git operations.
   * Call this after loading config to apply the configured baseBranch.
   *
   * @param baseBranch - Branch name to use as base (e.g. "main", "develop")
   */
  setBaseBranch(baseBranch: string): void {
    this.baseBranch = baseBranch;
  }

  /**
   * Gets the name of the current branch.
   *
   * @returns Current branch name (e.g., "main", "issue-123-fix-bug")
   * @throws Error if not in a git repository or command fails
   */
  async currentBranch(): Promise<string> {
    const result = await this.git('rev-parse --abbrev-ref HEAD');
    return result.stdout.trim();
  }

  /**
   * Pushes the current branch to remote with upstream tracking.
   *
   * @throws Error if push fails (no remote, auth issues, etc.)
   */
  async push(): Promise<void> {
    const branch = await this.currentBranch();
    this.validateBranchName(branch);
    await this.git(`push -u origin ${branch}`);
  }

  /**
   * Gets commit log for current branch vs the base branch.
   * Returns formatted commit messages.
   *
   * @returns Commit log output
   * @throws Error if git command fails
   */
  async logVsMaster(): Promise<string> {
    const master = await this.getBaseBranchName();
    const result = await this.git(`log ${master}..HEAD --oneline`);
    return result.stdout.trim();
  }

  /**
   * Gets the name of the base branch.
   * Returns the configured baseBranch if set, otherwise auto-detects main or master.
   *
   * @returns The base branch name
   * @throws Error if no base branch can be determined
   */
  async getBaseBranchName(): Promise<string> {
    if (this.baseBranch) {
      return this.baseBranch;
    }

    // Check if main exists
    const mainResult = await this.git('rev-parse --verify main', { ignoreErrors: true });
    if (mainResult.exitCode === 0) {
      return 'main';
    }

    // Check if master exists
    const masterResult = await this.git('rev-parse --verify master', { ignoreErrors: true });
    if (masterResult.exitCode === 0) {
      return 'master';
    }

    throw new Error('Neither "main" nor "master" branch found');
  }

  /**
   * Validates a git branch name to prevent command injection.
   *
   * Git branch names must:
   * - Not contain spaces, semicolons, pipes, or other shell metacharacters
   * - Only contain alphanumeric, slash, dash, underscore, or dot
   *
   * @private
   * @param branchName - Branch name to validate
   * @throws Error if branch name contains invalid characters
   */
  private validateBranchName(branchName: string): void {
    // Allow alphanumeric, slash, dash, underscore, dot
    // This is more restrictive than git allows, but safer for shell commands
    const validBranchPattern = /^[a-zA-Z0-9/_.-]+$/;

    if (!validBranchPattern.test(branchName)) {
      throw new Error(
        `Invalid branch name: "${branchName}". ` +
        `Branch names must only contain alphanumeric characters, slashes, dashes, underscores, or dots.`
      );
    }

    // Additional safety: prevent branch names that look like git options
    if (branchName.startsWith('-')) {
      throw new Error(`Invalid branch name: "${branchName}". Branch names cannot start with a dash.`);
    }
  }

  /**
   * Executes a git command in the project root.
   *
   * @private
   * @param command - Git command (without 'git' prefix)
   * @param options - Execution options
   * @returns Command result with stdout, stderr, exitCode
   * @throws Error if command fails and ignoreErrors is false
   */
  private async git(
    command: string,
    options: { ignoreErrors?: boolean } = {}
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const result = await exec(`git -C "${this.projectRoot}" ${command}`);

    if (!options.ignoreErrors && result.exitCode !== 0) {
      throw new Error(
        `Git command failed: git ${command}\nExit code: ${result.exitCode}\nStderr: ${result.stderr}`
      );
    }

    return result;
  }
}
