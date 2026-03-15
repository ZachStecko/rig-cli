import { exec } from '../utils/shell.js';

/**
 * GitService wraps git commands for repository operations.
 *
 * All commands use `git -C <projectRoot>` to run in the correct directory.
 * Throws errors when git commands fail (non-zero exit code).
 */
export class GitService {
  private projectRoot: string;

  /**
   * Creates a new GitService instance.
   *
   * @param projectRoot - Absolute path to the git repository root
   */
  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Checks if the working tree is clean (no uncommitted changes).
   *
   * @returns true if clean, false if there are uncommitted changes
   * @throws Error if git command fails
   */
  async isClean(): Promise<boolean> {
    const result = await this.git('status --porcelain');
    return result.stdout.trim() === '';
  }

  /**
   * Gets the raw git status output (porcelain format).
   * Useful for comparing git state before and after operations.
   *
   * @returns Raw git status output (one line per changed file)
   * @throws Error if git command fails
   */
  async getStatus(): Promise<string> {
    const result = await this.git('status --porcelain');
    return result.stdout.trim();
  }

  /**
   * Gets the current commit hash (HEAD).
   * Useful for detecting if new commits were made during an operation.
   *
   * @returns Current commit SHA hash
   * @throws Error if git command fails or not in a git repository
   */
  async getCurrentCommit(): Promise<string> {
    const result = await this.git('rev-parse HEAD');
    return result.stdout.trim();
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
   * Checks if currently on the master/main branch.
   *
   * @returns true if on master or main, false otherwise
   * @throws Error if git command fails
   */
  async isOnMaster(): Promise<boolean> {
    const branch = await this.currentBranch();
    return branch === 'master' || branch === 'main';
  }

  /**
   * Checks if currently on a feature branch (not master/main).
   *
   * @returns true if on a feature branch, false if on master/main
   * @throws Error if git command fails
   */
  async isOnFeatureBranch(): Promise<boolean> {
    return !(await this.isOnMaster());
  }

  /**
   * Creates and checks out a new branch.
   *
   * @param branchName - Name of the branch to create
   * @throws Error if branch name is invalid, branch already exists, or git command fails
   */
  async createBranch(branchName: string): Promise<void> {
    this.validateBranchName(branchName);
    await this.git(`checkout -b ${branchName}`);
  }

  /**
   * Checks out the master/main branch.
   * Tries "main" first, falls back to "master" if main doesn't exist.
   *
   * @throws Error if neither master nor main branch exists
   */
  async checkoutMaster(): Promise<void> {
    // Try main first (modern default)
    const mainResult = await this.git('checkout main', { ignoreErrors: true });
    if (mainResult.exitCode === 0) {
      return;
    }

    // Fall back to master
    await this.git('checkout master');
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
   * Deletes a branch both locally and remotely.
   *
   * @param branchName - Name of the branch to delete
   * @param options - Options for branch deletion
   * @param options.force - Force delete even if not fully merged (default: true)
   * @param options.remote - Also delete from remote (default: false)
   * @throws Error if branch deletion fails
   */
  async deleteBranch(branchName: string, options: { force?: boolean; remote?: boolean } = {}): Promise<void> {
    const { force = true, remote = false } = options;
    this.validateBranchName(branchName);

    // Delete local branch
    const deleteFlag = force ? '-D' : '-d';
    await this.git(`branch ${deleteFlag} ${branchName}`, { ignoreErrors: true });

    // Delete remote branch if requested
    if (remote) {
      await this.git(`push origin --delete ${branchName}`, { ignoreErrors: true });
    }
  }

  /**
   * Checks if a branch exists locally.
   *
   * @param branchName - Name of the branch to check
   * @returns True if branch exists, false otherwise
   */
  async branchExists(branchName: string): Promise<boolean> {
    const result = await this.git(`rev-parse --verify ${branchName}`, { ignoreErrors: true });
    return result.exitCode === 0;
  }

  /**
   * Checks if a branch exists on remote.
   *
   * @param branchName - Name of the branch to check
   * @returns True if branch exists on remote, false otherwise
   */
  async remoteBranchExists(branchName: string): Promise<boolean> {
    this.validateBranchName(branchName);
    const result = await this.git(`ls-remote --heads origin ${branchName}`, { ignoreErrors: true });
    return result.exitCode === 0 && result.stdout.trim().length > 0;
  }

  /**
   * Gets diff statistics against master/main branch.
   * Returns lines added/removed/changed.
   *
   * @returns Diff stat output (e.g., "3 files changed, 42 insertions(+), 7 deletions(-)")
   * @throws Error if git command fails
   */
  async diffStatVsMaster(): Promise<string> {
    const master = await this.getMasterBranchName();
    const result = await this.git(`diff --stat ${master}...HEAD`);
    return result.stdout.trim();
  }

  /**
   * Gets list of new files added in current branch vs master/main.
   * Returns relative file paths from repository root.
   *
   * @returns Array of new file paths (relative to repository root)
   * @throws Error if git command fails
   */
  async newFilesVsMaster(): Promise<string[]> {
    const master = await this.getMasterBranchName();
    const result = await this.git(`diff --name-only --diff-filter=A ${master}...HEAD`);

    const files = result.stdout
      .trim()
      .split('\n')
      .filter(line => line.length > 0);

    return files;
  }

  /**
   * Counts commits in current branch that aren't in master/main.
   *
   * @returns Number of commits ahead of master
   * @throws Error if git command fails or returns invalid output
   */
  async commitCountVsMaster(): Promise<number> {
    const master = await this.getMasterBranchName();
    const result = await this.git(`rev-list --count ${master}..HEAD`);
    const count = parseInt(result.stdout.trim(), 10);

    if (isNaN(count)) {
      throw new Error(`Invalid commit count from git: "${result.stdout.trim()}"`);
    }

    return count;
  }

  /**
   * Gets commit log for current branch vs master/main.
   * Returns formatted commit messages.
   *
   * @returns Commit log output
   * @throws Error if git command fails
   */
  async logVsMaster(): Promise<string> {
    const master = await this.getMasterBranchName();
    const result = await this.git(`log ${master}..HEAD --oneline`);
    return result.stdout.trim();
  }

  /**
   * Counts total changed files in current branch vs master/main.
   * Includes new, modified, and deleted files.
   *
   * @returns Number of changed files
   * @throws Error if git command fails
   */
  async changedFilesCountVsMaster(): Promise<number> {
    const master = await this.getMasterBranchName();
    const result = await this.git(`diff --name-only ${master}...HEAD`);

    const files = result.stdout
      .trim()
      .split('\n')
      .filter(line => line.length > 0);

    return files.length;
  }

  /**
   * Counts total lines changed (insertions + deletions) in current branch vs master/main.
   * Parses the summary line from git diff --stat output.
   *
   * @returns Total lines changed (insertions + deletions)
   * @throws Error if git command fails or output is unparseable
   */
  async diffLinesVsMaster(): Promise<number> {
    const master = await this.getMasterBranchName();
    const result = await this.git(`diff --stat ${master}...HEAD`);

    // Parse the summary line (last line) which looks like:
    // " 5 files changed, 123 insertions(+), 45 deletions(-)"
    const lines = result.stdout.trim().split('\n');
    if (lines.length === 0) {
      return 0; // No changes
    }

    const summaryLine = lines[lines.length - 1];

    // Extract insertions
    const insertionMatch = summaryLine.match(/(\d+) insertion/);
    const insertions = insertionMatch ? parseInt(insertionMatch[1], 10) : 0;

    // Extract deletions
    const deletionMatch = summaryLine.match(/(\d+) deletion/);
    const deletions = deletionMatch ? parseInt(deletionMatch[1], 10) : 0;

    return insertions + deletions;
  }

  /**
   * Gets the repository root directory (git toplevel).
   *
   * @returns Absolute path to the repository root
   * @throws Error if not in a git repository
   */
  async repoRoot(): Promise<string> {
    const result = await this.git('rev-parse --show-toplevel');
    return result.stdout.trim();
  }

  /**
   * Gets the name of the master branch (main or master).
   * Checks which one exists in the repository.
   *
   * @private
   * @returns "main" or "master"
   * @throws Error if neither branch exists
   */
  private async getMasterBranchName(): Promise<string> {
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
