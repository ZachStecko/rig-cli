import { BaseCommand } from './base-command.js';
import { Logger } from '../services/logger.service.js';
import { ConfigManager } from '../services/config-manager.service.js';
import { GitService } from '../services/git.service.js';
import { GitHubService } from '../services/github.service.js';
import { GuardService } from '../services/guard.service.js';
import { PrTemplateService } from '../services/pr-template.service.js';
import { TemplateEngine } from '../services/template-engine.service.js';
import { Issue } from '../types/issue.types.js';

/**
 * PrCommand creates or updates a pull request for the current branch.
 *
 * The linked issue is resolved from the --issue flag or parsed from the
 * branch name (e.g. "issue-42-add-auth", "42-add-auth", "feat/42-auth").
 * Generates the PR body from the issue and commit history, pushes the
 * branch, and creates or updates the PR.
 */
export class PrCommand extends BaseCommand {
  private prTemplate: PrTemplateService;

  /**
   * Creates a new PrCommand instance.
   */
  constructor(
    logger: Logger,
    config: ConfigManager,
    git: GitService,
    github: GitHubService,
    guard: GuardService,
    projectRoot?: string
  ) {
    super(logger, config, git, github, guard, projectRoot);
    this.prTemplate = new PrTemplateService(this.git, new TemplateEngine());
  }

  /**
   * Executes the pr command.
   *
   * Resolves the linked issue, pushes commits, and creates or updates
   * the pull request for the current branch.
   *
   * @param options - Command options
   * @param options.issue - Optional issue number (overrides branch-name detection)
   * @param options.bodyFile - Optional file whose content becomes the PR body verbatim
   */
  async execute(options?: { issue?: string; bodyFile?: string }): Promise<void> {
    // Check GitHub authentication
    await this.guard.requireGhAuth();

    const currentBranch = await this.git.currentBranch();

    // Refuse to run on the base branch: step 1 pushes the current branch,
    // and pushing the base branch directly is a destructive side effect.
    // The base branch is required later anyway (commit log vs base), so an
    // unresolvable base is a hard error, not a skipped check.
    let baseBranch: string;
    try {
      baseBranch = await this.git.getBaseBranchName();
    } catch (error) {
      this.logger.error(`Cannot determine the base branch: ${(error as Error).message}`);
      this.logger.dim('Set git.base_branch in .rig.yml and run rig pr again.');
      process.exit(1);
      return; // For testing
    }
    // 'main' and 'master' stay protected even when a different base branch
    // is configured — pushing them by accident is just as destructive.
    const protectedBranches = new Set([baseBranch, 'main', 'master']);
    if (protectedBranches.has(currentBranch)) {
      this.logger.error(`You are on a protected branch '${currentBranch}'.`);
      this.logger.dim('Create a feature branch first, then run rig pr again.');
      process.exit(1);
      return; // For testing
    }

    // Determine issue number: --issue flag first, then branch name
    let issueNumber: number | null;
    if (options?.issue) {
      const trimmed = options.issue.trim();
      issueNumber = /^\d+$/.test(trimmed) ? parseInt(trimmed, 10) : NaN;
      if (isNaN(issueNumber) || issueNumber <= 0) {
        this.logger.error(`Invalid issue number: ${options.issue}`);
        process.exit(1);
        return; // For testing
      }
    } else {
      issueNumber = this.parseIssueFromBranch(currentBranch);
      if (issueNumber === null) {
        this.logger.error(`Cannot detect an issue number from branch '${currentBranch}'.`);
        this.logger.dim('Use --issue <number>, or name the branch like issue-42-short-slug.');
        process.exit(1);
        return; // For testing
      }
    }

    let issueData: Issue;
    try {
      issueData = await this.github.viewIssue(issueNumber);
    } catch (error) {
      this.logger.error(`Cannot fetch issue #${issueNumber}: ${(error as Error).message}`);
      this.logger.dim('Check the issue number, or pass the right one with --issue <number>.');
      process.exit(1);
      return; // For testing
    }

    this.logger.header(`Creating Pull Request for Issue #${issueNumber}`);
    console.log('');
    this.logger.info(`Issue: ${issueData.title}`);
    this.logger.info(`Branch: ${currentBranch}`);
    console.log('');

    try {
      // Step 1: Push commits to remote
      this.logger.step(1, 3, 'Pushing commits to remote...');
      await this.git.push();
      console.log('');

      // Step 2: Resolve the PR body — an agent-drafted body file wins
      // over the template, since the agent knows the actual diff.
      let prBody: string;
      if (options?.bodyFile) {
        this.logger.step(2, 3, `Reading PR body from ${options.bodyFile}...`);
        prBody = await this.readMultilineInput(options.bodyFile, '');
        if (!prBody.trim()) {
          this.logger.error(`PR body file '${options.bodyFile}' is empty.`);
          process.exit(1);
          return; // For testing
        }
      } else {
        this.logger.step(2, 3, 'Generating PR body from template...');
        prBody = await this.prTemplate.generatePrBody(issueData);
      }
      console.log('');

      // Step 3: Check if PR already exists for this branch
      this.logger.step(3, 3, 'Creating or updating pull request...');
      const existingPrs = await this.github.prListByHead(currentBranch);

      let prUrl: string;

      if (existingPrs.length > 0) {
        // Update existing PR
        const prNumber = existingPrs[0].number;
        this.logger.info(`Updating existing PR #${prNumber}...`);

        await this.github.editPr(prNumber, {
          title: issueData.title,
          body: prBody,
        });

        // Construct PR URL (gh pr edit doesn't return URL)
        const repoName = await this.github.repoName();
        prUrl = `https://github.com/${repoName}/pull/${prNumber}`;
      } else {
        // Create new PR
        this.logger.info('Creating new pull request...');

        const rigConfig = this.config.get();
        prUrl = await this.github.createPr({
          title: issueData.title,
          body: prBody,
          base: rigConfig.git?.base_branch,
        });
      }

      console.log('');
      this.logger.success('Pull request created/updated successfully');
      this.logger.info(`URL: ${prUrl}`);
    } catch (error) {
      this.logger.error(`PR creation failed: ${(error as Error).message}`);
      this.logger.dim("Fix the issues and run 'rig pr' again.");
      process.exit(1);
      return; // For testing
    }
  }

  /**
   * Parses an issue number from a branch name.
   *
   * Supported patterns (first match wins):
   * - "issue-42-slug" or "feat/issue-42-slug" (any separator after the number)
   * - "42-slug" or "feat/42-slug"
   *
   * Bare-number prefixes that look like dates are rejected: numbers with a
   * leading zero ("0815-hotfix"), 4-digit years 1900-2099 ("2025-cleanup"),
   * and two all-digit segments in a row ("8-15-hotfix", "2025-08-cleanup").
   * For those branches, pass --issue.
   *
   * @param branch - The branch name
   * @returns The issue number, or null if none found
   */
  private parseIssueFromBranch(branch: string): number | null {
    const explicit = branch.match(/(?:^|\/)issue-(\d+)(?!\d)/);
    if (explicit) {
      return parseInt(explicit[1], 10);
    }

    const bare = branch.match(/(?:^|\/)(\d+)(?=[-_])/);
    if (bare) {
      const digits = bare[1];
      const value = parseInt(digits, 10);
      const hasLeadingZero = digits.length > 1 && digits.startsWith('0');
      const looksLikeYear = digits.length === 4 && value >= 1900 && value <= 2099;
      const dateLikePair = new RegExp(`(?:^|/)${digits}[-_]\\d+(?:[-_]|$)`).test(branch);
      if (!hasLeadingZero && !looksLikeYear && !dateLikePair) {
        return value;
      }
    }

    return null;
  }
}
