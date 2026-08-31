import { BaseCommand } from './base-command.js';
import { Issue } from '../types/issue.types.js';

/**
 * Maps an issue's type label to a conventional branch type prefix.
 * Issues without a recognized type label default to 'feat'.
 */
const BRANCH_TYPE_BY_LABEL: Record<string, string> = {
  bug: 'fix',
  feature: 'feat',
  enhancement: 'feat',
  refactor: 'refactor',
  docs: 'docs',
  chore: 'chore',
  test: 'test',
  story: 'feat',
};

/**
 * BranchCommand creates a working branch for an issue.
 *
 * Fetches the issue and creates a branch named <type>/issue-<n>-<slug>
 * off the base branch: the type comes from the issue's type label, the
 * slug is derived mechanically from the issue title. The issue-<n>-
 * segment is the shape rig pr parses, so the PR auto-links later.
 *
 * Any existing branch for the issue is reused (switched to) instead of
 * creating a second branch.
 */
export class BranchCommand extends BaseCommand {
  /**
   * Executes the branch command.
   *
   * @param issueArg - The issue number to branch for
   */
  async execute(issueArg: string): Promise<void> {
    await this.guard.requireGhAuth();

    const trimmed = issueArg.trim();
    const issueNumber = /^\d+$/.test(trimmed) ? parseInt(trimmed, 10) : NaN;
    if (isNaN(issueNumber) || issueNumber <= 0) {
      this.logger.error(`Invalid issue number: ${trimmed}`);
      process.exit(1);
      return; // For testing
    }

    let issue: Issue;
    try {
      issue = await this.github.viewIssue(issueNumber);
    } catch (error) {
      this.logger.error(`Cannot fetch issue #${issueNumber}: ${(error as Error).message}`);
      process.exit(1);
      return; // For testing
    }

    try {
      // Reuse an existing branch for this issue regardless of its slug or
      // type prefix (also matches pre-typed branches like issue-21-foo)
      const existing = [
        ...new Set([
          ...(await this.git.listBranches(`issue-${issue.number}-*`)),
          ...(await this.git.listBranches(`*/issue-${issue.number}-*`)),
        ]),
      ];
      if (existing.length > 0) {
        const branchName = existing[0];
        const current = await this.git.currentBranch();
        if (current === branchName) {
          this.logger.info(`Already on branch ${branchName}`);
        } else {
          await this.git.checkout(branchName);
          this.logger.success(`Switched to existing branch ${branchName}`);
        }
        return;
      }

      const slug = this.slugFromTitle(issue.title);
      const type = this.typeFromLabels(issue);
      const branchName = `${type}/issue-${issue.number}-${slug}`;
      const baseBranch = await this.git.getBaseBranchName();
      await this.git.createBranch(branchName, baseBranch);
      this.logger.success(`Created branch ${branchName} off ${baseBranch}`);

      // Push with upstream tracking so the branch is visible on GitHub
      // immediately. A failed push is not fatal: the branch exists
      // locally and rig pr pushes again anyway.
      try {
        await this.git.push();
        this.logger.success(`Pushed ${branchName} to origin`);
      } catch (error) {
        this.logger.warn(`Push failed (${(error as Error).message}); branch exists locally only.`);
      }

      this.logger.dim(`  Implement, commit, then open the PR with rig pr.`);
    } catch (error) {
      this.logger.error(`Branch creation failed: ${(error as Error).message}`);
      process.exit(1);
      return; // For testing
    }
  }

  /**
   * Derives the branch type prefix from the issue's type label.
   *
   * @param issue - The issue to inspect
   * @returns A conventional type like "feat" or "fix"
   */
  private typeFromLabels(issue: Issue): string {
    for (const label of issue.labels) {
      const type = BRANCH_TYPE_BY_LABEL[label.name];
      if (type) {
        return type;
      }
    }
    return 'feat';
  }

  /**
   * Derives a short branch slug from an issue title.
   *
   * Drops a leading component prefix ("cli:", "api:"), lowercases,
   * replaces non-alphanumerics with hyphens, and keeps the first four words.
   *
   * @param title - The issue title
   * @returns A slug like "add-clipboard-support"
   */
  private slugFromTitle(title: string): string {
    const withoutPrefix = title.replace(/^[a-z0-9-]+:\s*/i, '');
    const slug = withoutPrefix
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .split('-')
      .filter(Boolean)
      .slice(0, 4)
      .join('-');
    return slug || 'work';
  }
}
