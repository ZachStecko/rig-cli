import { exec } from '../utils/shell.js';
import { Issue } from '../types/issue.types.js';
import { writeFile, unlink, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * GitHubService wraps the GitHub CLI (gh) for GitHub operations.
 *
 * Requires the `gh` CLI to be installed and authenticated.
 * All commands return parsed data or throw errors on failure.
 */
export class GitHubService {
  private projectRoot: string;

  /**
   * Creates a new GitHubService instance.
   *
   * @param projectRoot - Absolute path to the git repository root
   */
  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Checks if the gh CLI is installed.
   *
   * @returns true if gh is installed, false otherwise
   */
  async isInstalled(): Promise<boolean> {
    const result = await exec('gh --version');
    return result.exitCode === 0;
  }

  /**
   * Checks if the gh CLI is authenticated.
   *
   * @returns true if authenticated, false otherwise
   */
  async isAuthenticated(): Promise<boolean> {
    const result = await exec('gh auth status');
    return result.exitCode === 0;
  }

  /**
   * Gets the repository name (owner/repo format).
   *
   * @returns Repository name (e.g., "owner/repo")
   * @throws Error if not in a GitHub repository or gh command fails
   */
  async repoName(): Promise<string> {
    const result = await this.gh('repo view --json nameWithOwner --jq .nameWithOwner');
    return result.stdout.trim();
  }

  /**
   * Lists issues from the repository with optional filters.
   *
   * @param options - Filter options (state, labels, assignee, etc.)
   * @returns Array of issues
   * @throws Error if gh command fails or JSON parsing fails
   */
  async listIssues(options: {
    state?: 'open' | 'closed' | 'all';
    labels?: string[];
    assignee?: string;
    limit?: number;
  } = {}): Promise<Issue[]> {
    const args = ['issue', 'list', '--json', 'number,title,body,labels,assignees'];

    if (options.state) {
      args.push('--state', options.state);
    }

    if (options.labels && options.labels.length > 0) {
      // Validate all labels to prevent command injection
      options.labels.forEach(label => this.validateLabel(label));
      args.push('--label', options.labels.join(','));
    }

    if (options.assignee) {
      this.validateUsername(options.assignee);
      args.push('--assignee', options.assignee);
    }

    if (options.limit) {
      args.push('--limit', String(options.limit));
    }

    const result = await this.gh(args.join(' '));
    try {
      return JSON.parse(result.stdout) as Issue[];
    } catch (error) {
      throw new Error(
        `Failed to parse GitHub CLI JSON output: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
  }

  /**
   * Gets detailed information about an issue.
   *
   * @param issueNumber - Issue number
   * @returns Issue object with full details
   * @throws Error if issue doesn't exist or gh command fails
   */
  async viewIssue(issueNumber: number): Promise<Issue> {
    const result = await this.gh(
      `issue view ${issueNumber} --json number,title,body,labels,assignees,state`
    );
    try {
      return JSON.parse(result.stdout) as Issue;
    } catch (error) {
      throw new Error(
        `Failed to parse GitHub CLI JSON output: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
  }

  /**
   * Gets the body text of an issue.
   *
   * @param issueNumber - Issue number
   * @returns Issue body text
   * @throws Error if issue doesn't exist or gh command fails
   */
  async issueBody(issueNumber: number): Promise<string> {
    const result = await this.gh(`issue view ${issueNumber} --json body --jq .body`);
    return result.stdout.trim();
  }

  /**
   * Gets the title of an issue.
   *
   * @param issueNumber - Issue number
   * @returns Issue title
   * @throws Error if issue doesn't exist or gh command fails
   */
  async issueTitle(issueNumber: number): Promise<string> {
    const result = await this.gh(`issue view ${issueNumber} --json title --jq .title`);
    return result.stdout.trim();
  }

  /**
   * Gets the labels of an issue.
   *
   * @param issueNumber - Issue number
   * @returns Array of label names
   * @throws Error if issue doesn't exist or gh command fails
   */
  async issueLabels(issueNumber: number): Promise<string[]> {
    const result = await this.gh(`issue view ${issueNumber} --json labels --jq '.labels[].name'`);
    const labels = result.stdout
      .trim()
      .split('\n')
      .filter(line => line.length > 0);
    return labels;
  }

  /**
   * Gets the state of an issue (open or closed).
   *
   * @param issueNumber - Issue number
   * @returns Issue state ("OPEN" or "CLOSED")
   * @throws Error if issue doesn't exist or gh command fails
   */
  async issueState(issueNumber: number): Promise<string> {
    const result = await this.gh(`issue view ${issueNumber} --json state --jq .state`);
    return result.stdout.trim();
  }

  /**
   * Checks if an issue has an open pull request.
   *
   * @param issueNumber - Issue number
   * @returns true if there's an open PR, false otherwise
   * @throws Error if gh command fails
   */
  async hasOpenPr(issueNumber: number): Promise<boolean> {
    // Search for open PRs that reference this issue number in the title or body
    const result = await this.gh(
      `pr list --search "${issueNumber} in:title,body" --state open --json number --limit 1`
    );

    try {
      const prs = JSON.parse(result.stdout);
      return Array.isArray(prs) && prs.length > 0;
    } catch (error) {
      throw new Error(
        `Failed to parse GitHub CLI JSON output: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
  }

  /**
   * Lists pull requests by head branch name.
   *
   * @param branchName - Head branch name
   * @returns Array of PR objects
   * @throws Error if branch name is invalid or gh command fails
   */
  async prListByHead(branchName: string): Promise<Array<{ number: number; title: string }>> {
    this.validateBranchName(branchName);
    const result = await this.gh(`pr list --head ${branchName} --json number,title`);
    try {
      return JSON.parse(result.stdout);
    } catch (error) {
      throw new Error(
        `Failed to parse GitHub CLI JSON output: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
  }

  /**
   * Creates a new issue.
   *
   * @param options - Issue creation options
   * @returns Created issue number
   * @throws Error if issue creation fails
   */
  async createIssue(options: {
    title: string;
    body: string;
    labels?: string[];
    assignees?: string[];
  }): Promise<number> {
    // Use temporary files to avoid shell injection with backticks, dollar signs, etc.
    const tmpDir = await mkdtemp(join(tmpdir(), 'rig-gh-'));
    const bodyFile = join(tmpDir, 'body.txt');

    try {
      // Write body to temp file
      await writeFile(bodyFile, options.body, 'utf-8');

      const args = [
        'issue',
        'create',
        '--title',
        `"${this.escapeQuotes(options.title)}"`,
        '--body-file',
        `"${bodyFile}"`
      ];

      if (options.labels && options.labels.length > 0) {
        // Validate all labels to prevent command injection
        options.labels.forEach(label => this.validateLabel(label));
        args.push('--label', options.labels.join(','));
      }

      if (options.assignees && options.assignees.length > 0) {
        // Validate all assignees to prevent command injection
        options.assignees.forEach(assignee => this.validateUsername(assignee));
        args.push('--assignee', options.assignees.join(','));
      }

      const result = await this.gh(args.join(' '));
      // gh issue create returns the issue URL on stdout (e.g., https://github.com/owner/repo/issues/123)
      // Extract the issue number from the URL (handles trailing slashes, query params, anchors)
      const urlMatch = result.stdout.trim().match(/\/issues\/(\d+)(?:[/?#].*)?$/);
      if (!urlMatch) {
        throw new Error(`Failed to extract issue number from gh output: ${result.stdout}`);
      }
      return parseInt(urlMatch[1], 10);
    } finally {
      // Clean up temporary files
      try {
        await unlink(bodyFile).catch(() => {});
        await unlink(tmpDir).catch(() => {});
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Creates a new pull request.
   *
   * @param options - PR creation options
   * @returns PR URL
   * @throws Error if PR creation fails
   */
  async createPr(options: {
    title: string;
    body: string;
    draft?: boolean;
    base?: string;
  }): Promise<string> {
    // Use temporary files to avoid shell injection
    const tmpDir = await mkdtemp(join(tmpdir(), 'rig-gh-'));
    const bodyFile = join(tmpDir, 'body.txt');

    try {
      await writeFile(bodyFile, options.body, 'utf-8');

      const args = [
        'pr',
        'create',
        '--title',
        `"${this.escapeQuotes(options.title)}"`,
        '--body-file',
        `"${bodyFile}"`
      ];

      if (options.draft) {
        args.push('--draft');
      }

      if (options.base) {
        this.validateBranchName(options.base);
        args.push('--base', options.base);
      }

      const result = await this.gh(args.join(' '));
      // gh pr create returns the PR URL on stdout
      return result.stdout.trim();
    } finally {
      try {
        await unlink(bodyFile).catch(() => {});
        await unlink(tmpDir).catch(() => {});
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Edits an existing pull request.
   *
   * @param prNumber - PR number
   * @param options - Fields to update
   * @throws Error if PR doesn't exist or edit fails
   */
  async editPr(
    prNumber: number,
    options: {
      title?: string;
      body?: string;
    }
  ): Promise<void> {
    // Use temporary file for body if provided
    if (options.body) {
      const tmpDir = await mkdtemp(join(tmpdir(), 'rig-gh-'));
      const bodyFile = join(tmpDir, 'body.txt');

      try {
        await writeFile(bodyFile, options.body, 'utf-8');

        const args = ['pr', 'edit', String(prNumber)];

        if (options.title) {
          args.push('--title', `"${this.escapeQuotes(options.title)}"`);
        }

        args.push('--body-file', `"${bodyFile}"`);

        await this.gh(args.join(' '));
      } finally {
        try {
          await unlink(bodyFile).catch(() => {});
          await unlink(tmpDir).catch(() => {});
        } catch {
          // Ignore cleanup errors
        }
      }
    } else {
      // Only updating title, no need for temp file
      const args = ['pr', 'edit', String(prNumber)];

      if (options.title) {
        args.push('--title', `"${this.escapeQuotes(options.title)}"`);
      }

      await this.gh(args.join(' '));
    }
  }

  /**
   * Adds a comment to a pull request.
   *
   * @param prNumber - PR number
   * @param comment - Comment text
   * @throws Error if PR doesn't exist or comment fails
   */
  async prComment(prNumber: number, comment: string): Promise<void> {
    // Use temporary file to avoid shell injection
    const tmpDir = await mkdtemp(join(tmpdir(), 'rig-gh-'));
    const commentFile = join(tmpDir, 'comment.txt');

    try {
      await writeFile(commentFile, comment, 'utf-8');
      await this.gh(`pr comment ${prNumber} --body-file "${commentFile}"`);
    } finally {
      try {
        await unlink(commentFile).catch(() => {});
        await unlink(tmpDir).catch(() => {});
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Gets pull request details.
   *
   * @param prNumber - PR number
   * @returns PR object with number, title, body, headRefName (branch)
   * @throws Error if PR doesn't exist or gh command fails
   */
  async viewPr(prNumber: number): Promise<{ number: number; title: string; body?: string; headRefName: string }> {
    const result = await this.gh(
      `pr view ${prNumber} --json number,title,body,headRefName`
    );
    try {
      return JSON.parse(result.stdout);
    } catch (error) {
      throw new Error(
        `Failed to parse GitHub CLI JSON output: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
  }

  /**
   * Closes a pull request.
   *
   * @param prNumber - PR number to close
   * @param comment - Optional comment to add when closing
   * @throws Error if PR doesn't exist or close operation fails
   */
  async closePr(prNumber: number, comment?: string): Promise<void> {
    // Close the PR first
    await this.gh(`pr close ${prNumber}`);

    // Add comment separately if provided (reuses existing safe method)
    if (comment) {
      await this.prComment(prNumber, comment);
    }
  }

  /**
   * Validates a git branch name to prevent command injection.
   * Uses the same validation as GitService for consistency.
   *
   * @private
   * @param branchName - Branch name to validate
   * @throws Error if branch name contains invalid characters
   */
  private validateBranchName(branchName: string): void {
    const validBranchPattern = /^[a-zA-Z0-9/_.-]+$/;

    if (!validBranchPattern.test(branchName)) {
      throw new Error(
        `Invalid branch name: "${branchName}". ` +
        `Branch names must only contain alphanumeric characters, slashes, dashes, underscores, or dots.`
      );
    }

    if (branchName.startsWith('-')) {
      throw new Error(`Invalid branch name: "${branchName}". Branch names cannot start with a dash.`);
    }
  }

  /**
   * Validates a GitHub username to prevent command injection.
   * GitHub usernames can only contain alphanumeric characters and hyphens.
   *
   * @private
   * @param username - Username to validate
   * @throws Error if username contains invalid characters
   */
  private validateUsername(username: string): void {
    const validUsernamePattern = /^[a-zA-Z0-9-]+$/;

    if (!validUsernamePattern.test(username)) {
      throw new Error(
        `Invalid username: "${username}". ` +
        `Usernames must only contain alphanumeric characters and hyphens.`
      );
    }

    if (username.startsWith('-')) {
      throw new Error(`Invalid username: "${username}". Usernames cannot start with a hyphen.`);
    }
  }

  /**
   * Validates a GitHub label name to prevent command injection.
   * Label names should not contain shell metacharacters.
   *
   * @private
   * @param label - Label name to validate
   * @throws Error if label contains invalid characters
   */
  private validateLabel(label: string): void {
    const validLabelPattern = /^[a-zA-Z0-9:_. -]+$/;

    if (!validLabelPattern.test(label)) {
      throw new Error(
        `Invalid label: "${label}". ` +
        `Labels must only contain alphanumeric characters, colons, underscores, dots, spaces, or hyphens.`
      );
    }

    if (label.startsWith('-')) {
      throw new Error(`Invalid label: "${label}". Labels cannot start with a hyphen.`);
    }
  }

  /**
   * Escapes double quotes in strings to prevent quote injection.
   * Required for passing text to gh CLI commands that use double quotes.
   *
   * @private
   * @param text - Text to escape
   * @returns Text with escaped double quotes
   */
  private escapeQuotes(text: string): string {
    return text.replace(/"/g, '\\"');
  }

  /**
   * Executes a gh command in the project root.
   *
   * @private
   * @param command - gh command (without 'gh' prefix)
   * @returns Command result with stdout, stderr, exitCode
   * @throws Error if command fails
   */
  private async gh(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const result = await exec(`gh ${command}`, { cwd: this.projectRoot });

    if (result.exitCode !== 0) {
      throw new Error(
        `GitHub CLI command failed: gh ${command}\nExit code: ${result.exitCode}\nStderr: ${result.stderr}`
      );
    }

    return result;
  }
}
