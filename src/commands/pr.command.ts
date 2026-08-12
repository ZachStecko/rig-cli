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
   */
  async execute(options?: { issue?: string }): Promise<void> {
    // Check GitHub authentication
    await this.guard.requireGhAuth();

    const currentBranch = await this.git.currentBranch();

    // Refuse to run on the base branch: step 1 pushes the current branch,
    // and pushing the base branch directly is a destructive side effect.
    const baseBranch = await this.git.getBaseBranchName().catch(() => null);
    if (baseBranch !== null && currentBranch === baseBranch) {
      this.logger.error(`You are on the base branch '${baseBranch}'.`);
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

      // Step 2: Generate PR body
      this.logger.step(2, 3, 'Generating PR body from template...');
      const prBody = await this.prTemplate.generatePrBody(issueData);
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
   * - "issue-42-slug" or "feat/issue-42-slug"
   * - "42-slug" or "feat/42-slug"
   *
   * The bare-number pattern requires a non-digit after the dash so that
   * date-prefixed branches like "2025-08-cleanup" do not match.
   *
   * @param branch - The branch name
   * @returns The issue number, or null if none found
   */
  private parseIssueFromBranch(branch: string): number | null {
    const patterns = [/(?:^|\/)issue-(\d+)(?:$|-)/, /(?:^|\/)(\d+)-(?!\d)/];
    for (const pattern of patterns) {
      const match = branch.match(pattern);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
    return null;
  }
}
