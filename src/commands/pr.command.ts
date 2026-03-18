import { BaseCommand } from './base-command.js';
import { Logger } from '../services/logger.service.js';
import { ConfigManager } from '../services/config-manager.service.js';
import { StateManager } from '../services/state-manager.service.js';
import { GitService } from '../services/git.service.js';
import { GitHubService } from '../services/github.service.js';
import { GuardService } from '../services/guard.service.js';
import { PrTemplateService } from '../services/pr-template.service.js';
import { PromptBuilderService } from '../services/prompt-builder.service.js';
import { TemplateEngine } from '../services/template-engine.service.js';
import { TestRunnerService } from '../services/test-runner.service.js';
import { createAgent } from '../services/agents/agent-factory.js';
import { exec } from '../utils/shell.js';

/**
 * PrCommand creates or updates a pull request for the implemented issue.
 *
 * Auto-detects component from issue labels, generates PR body from template,
 * and handles both create and update flows. Pushes commits to remote if needed.
 */
export class PrCommand extends BaseCommand {
  private prTemplate: PrTemplateService;
  private promptBuilder: PromptBuilderService;

  /**
   * Creates a new PrCommand instance.
   */
  constructor(
    logger: Logger,
    config: ConfigManager,
    state: StateManager,
    git: GitService,
    github: GitHubService,
    guard: GuardService,
    projectRoot?: string
  ) {
    super(logger, config, state, git, github, guard, projectRoot);
    const templateEngine = new TemplateEngine();
    const testRunner = new TestRunnerService(
      this.projectRoot || process.cwd(),
      this.git,
      this.config,
      this.logger
    );
    this.prTemplate = new PrTemplateService(
      this.github,
      this.git,
      templateEngine,
      testRunner,
      this.projectRoot || process.cwd()
    );
    this.promptBuilder = new PromptBuilderService(this.github, this.git, templateEngine);
  }

  /**
   * Executes the pr command.
   *
   * Checks for active pipeline, pushes commits, creates or updates PR,
   * and updates state based on outcome.
   *
   * @param options - Command options
   * @param options.issue - Optional issue number to create PR for (overrides state)
   * @param options.comment - If true, opens interactive prompt for PR feedback
   * @param options.pr - Optional PR number to comment on (auto-detects if not provided)
   */
  async execute(options?: { issue?: string; comment?: boolean; pr?: string }): Promise<void> {
    // If -c flag is present, handle PR feedback workflow
    if (options?.comment) {
      return this.handlePrFeedback(options.pr);
    }
    // Check GitHub authentication
    await this.guard.requireGhAuth();

    // Determine issue number
    let issueNumber: number;
    let state: any;
    let issueData: any; // Cache for issue data to avoid redundant API calls

    if (options?.issue) {
      // Use --issue flag
      issueNumber = parseInt(options.issue, 10);
      if (isNaN(issueNumber)) {
        this.logger.error(`Invalid issue number: ${options.issue}`);
        process.exit(1);
        return; // For testing
      }

      // Fetch issue once (will be reused for component detection)
      issueData = await this.github.viewIssue(issueNumber);

      // Load or create minimal state for this issue
      const stateExists = await this.state.exists();
      if (stateExists) {
        state = await this.state.read();
      } else {
        // Create minimal state for ad-hoc PR creation
        const currentBranch = await this.git.currentBranch();
        state = {
          issue_number: issueNumber,
          issue_title: issueData.title,
          branch: currentBranch,
          stage: 'pr',
          stages: {
            pick: 'completed',
            branch: 'pending',
            implement: 'pending',
            test: 'pending',
            pr: 'pending',
            review: 'pending',
          },
        };
      }
    } else {
      // Use state from active pipeline
      const stateExists = await this.state.exists();

      if (!stateExists) {
        this.logger.error("No active pipeline. Run 'rig next' to start or use --issue <number>.");
        process.exit(1);
        return; // For testing
      }

      state = await this.state.read();
      issueNumber = state.issue_number;

      // Fetch issue for component detection
      issueData = await this.github.viewIssue(issueNumber);
    }

    // Get component using cached issue data
    const labels = issueData.labels.map((l: any) => l.name);
    const component = this.promptBuilder.detectComponentFromConfig(labels, this.config.get());

    // Get current branch
    const currentBranch = await this.git.currentBranch();

    this.logger.header(`Creating Pull Request for Issue #${issueNumber}`);
    console.log('');
    this.logger.info(`Issue: ${state.issue_title}`);
    this.logger.info(`Branch: ${currentBranch}`);
    this.logger.info(`Component: ${component}`);
    console.log('');

    // Update state to mark pr as in_progress
    await this.state.write({
      ...state,
      stage: 'pr',
      stages: {
        ...state.stages,
        pr: 'in_progress',
      },
    });

    try {
      // Step 1: Push commits to remote
      this.logger.step(1, 3, 'Pushing commits to remote...');
      await this.git.push();
      console.log('');

      // Step 2: Generate PR body
      this.logger.step(2, 3, 'Generating PR body from template...');
      const prBody = await this.prTemplate.generatePrBody(issueNumber, component);
      console.log('');

      // Step 3: Check if PR already exists for this branch
      this.logger.step(3, 3, 'Creating or updating pull request...');
      const existingPrs = await this.github.prListByHead(currentBranch);

      let prUrl: string;

      if (existingPrs.length > 0) {
        // Update existing PR
        const prNumber = existingPrs[0].number;
        this.logger.info(`Updating existing PR #${prNumber}...`);

        const prTitle = `${issueData.title}`;
        await this.github.editPr(prNumber, {
          title: prTitle,
          body: prBody,
        });

        // Construct PR URL (gh pr edit doesn't return URL)
        const repoName = await this.github.repoName();
        prUrl = `https://github.com/${repoName}/pull/${prNumber}`;
      } else {
        // Create new PR
        this.logger.info('Creating new pull request...');

        const prTitle = `${issueData.title}`;
        prUrl = await this.github.createPr({
          title: prTitle,
          body: prBody,
        });
      }

      // Mark pr complete
      await this.state.write({
        ...state,
        stage: 'pr',
        stages: {
          ...state.stages,
          pr: 'completed',
        },
      });

      console.log('');
      this.logger.success('Pull request created/updated successfully');
      this.logger.info(`URL: ${prUrl}`);
      this.logger.dim("Run 'rig review' to perform code review, or merge the PR manually.");
    } catch (error) {
      // Mark pr failed
      await this.state.write({
        ...state,
        stage: 'pr',
        stages: {
          ...state.stages,
          pr: 'failed',
        },
      });

      this.logger.error(`PR creation failed: ${(error as Error).message}`);
      this.logger.dim("Fix the issues and run 'rig pr' again.");
      process.exit(1);
      return; // For testing
    }
  }

  /**
   * Handles PR feedback workflow: fetches review comments, generates specific responses
   * addressing each comment with file/line context, and posts replies.
   *
   * @param prNumberOption - Optional PR number (auto-detects if not provided)
   */
  private async handlePrFeedback(prNumberOption?: string): Promise<void> {
    // Check GitHub authentication
    await this.guard.requireGhAuth();

    this.logger.header('PR Review Reply');
    console.log('');

    // Determine PR number
    let prNumber: number;

    if (prNumberOption) {
      // Use explicit PR number
      prNumber = parseInt(prNumberOption, 10);
      if (isNaN(prNumber)) {
        this.logger.error(`Invalid PR number: ${prNumberOption}`);
        process.exit(1);
        return;
      }
      this.logger.info(`Using PR #${prNumber}`);
    } else {
      // Auto-detect from current branch
      const currentBranch = await this.git.currentBranch();
      this.logger.info(`Detecting PR from branch: ${currentBranch}`);

      const detectedPr = await this.github.detectPrFromBranch(currentBranch);
      if (!detectedPr) {
        this.logger.error(`No PR found for branch: ${currentBranch}`);
        this.logger.dim('Use --pr <number> to specify a PR explicitly.');
        process.exit(1);
        return;
      }

      prNumber = detectedPr;
      this.logger.info(`Found PR #${prNumber}`);
    }

    // Fetch PR details
    const prData = await this.github.viewPr(prNumber);
    console.log('');
    this.logger.info(`PR: ${prData.title}`);
    this.logger.info(`Branch: ${prData.headRefName}`);
    console.log('');

    // Fetch review comments
    this.logger.step(1, 3, 'Fetching PR review comments...');
    const reviewComments = await this.github.getPrReviewComments(prNumber);

    if (reviewComments.length === 0) {
      this.logger.warn('No review comments found on this PR.');
      console.log('');
      this.logger.info('Nothing to reply to.');
      return;
    }

    this.logger.info(`Found ${reviewComments.length} review comment${reviewComments.length > 1 ? 's' : ''}`);
    console.log('');

    // Generate replies for each comment using LLM
    this.logger.step(2, 3, 'Generating specific replies for each comment...');
    console.log('');

    // Get config for agent
    const configData = this.config.get();
    const maxTurns = configData.agent?.max_turns || 20;
    const verbose = configData.verbose || false;

    const replies: Array<{ commentId: number; reply: string; file: string; line: number | null }> = [];

    for (let i = 0; i < reviewComments.length; i++) {
      const comment = reviewComments[i];
      const lineInfo = comment.line
        ? `line ${comment.line}`
        : comment.start_line
        ? `lines ${comment.start_line}-${comment.line || '?'}`
        : 'unknown line';

      this.logger.info(`[${i + 1}/${reviewComments.length}] ${comment.path}:${lineInfo}`);
      this.logger.dim(`  Comment: ${comment.body.substring(0, 80)}${comment.body.length > 80 ? '...' : ''}`);

      // Build prompt with full context for this specific comment
      const prompt = this.buildReviewCommentReplyPrompt(comment, prData.title);

      // Create log file for this reply
      const logFile = `${this.projectRoot}/.rig-logs/pr-${prNumber}-reply-${comment.id}.log`;

      try {
        const agent = createAgent(this.config.get());
        const session = await agent.createSession({
          prompt,
          maxIterations: maxTurns,
          logFile,
          verbose,
          providerOptions: { permissionMode: 'default' },
        });

        let replyText = '';
        for await (const event of session.events) {
          if (event.type === 'text') {
            replyText += event.content;
            if (verbose) {
              process.stdout.write(event.content);
            }
          }
        }

        // Extract reply from agent output (agent should output just the reply text)
        const reply = replyText.trim();

        if (reply.length === 0) {
          this.logger.warn(`  No reply generated for comment ${comment.id}`);
          continue;
        }

        replies.push({
          commentId: comment.id,
          reply,
          file: comment.path,
          line: comment.line,
        });

        this.logger.success(`  Reply generated (${reply.length} chars)`);
      } catch (error) {
        this.logger.error(`  Failed to generate reply: ${(error as Error).message}`);
        continue;
      }

      console.log('');
    }

    if (replies.length === 0) {
      this.logger.error('No replies were generated successfully.');
      process.exit(1);
      return;
    }

    // Post all replies
    this.logger.step(3, 3, `Posting ${replies.length} repl${replies.length === 1 ? 'y' : 'ies'} to PR...`);
    console.log('');

    for (let i = 0; i < replies.length; i++) {
      const { commentId, reply, file, line } = replies[i];
      const lineInfo = line ? `line ${line}` : 'unknown line';

      this.logger.info(`[${i + 1}/${replies.length}] Replying to ${file}:${lineInfo}`);

      try {
        await this.github.replyToPrReviewComment(prNumber, commentId, reply);
        this.logger.success('  Posted successfully');
      } catch (error) {
        this.logger.error(`  Failed to post reply: ${(error as Error).message}`);
      }
    }

    console.log('');
    this.logger.success(`PR review replies posted successfully (${replies.length}/${reviewComments.length})`);

    // Get repository name and display PR URL
    const repoName = await this.github.repoName();
    console.log(`  https://github.com/${repoName}/pull/${prNumber}`);
  }

  /**
   * Builds a prompt for generating a specific reply to a review comment.
   * Includes file path, line numbers, code context, and reviewer's feedback.
   *
   * @param comment - Review comment object with path, line, body, diff_hunk
   * @param prTitle - PR title for context
   * @returns Prompt string for LLM
   */
  private buildReviewCommentReplyPrompt(
    comment: {
      path: string;
      line: number | null;
      start_line: number | null;
      body: string;
      diff_hunk: string;
    },
    prTitle: string
  ): string {
    const lineInfo = comment.line
      ? `Line: ${comment.line}`
      : comment.start_line
      ? `Lines: ${comment.start_line}-${comment.line || 'end'}`
      : 'Line: (not specified)';

    return `You are responding to a PR review comment.

PR: ${prTitle}
File: ${comment.path}
${lineInfo}

Reviewer's comment:
${comment.body}

Code context:
\`\`\`
${comment.diff_hunk || '(no diff context available)'}
\`\`\`

Provide a specific response that:
- References the exact file (${comment.path}) and the concern mentioned
- Addresses what will be changed or why the current code is correct
- Avoids generic responses like "I'll look into that" or "Thanks for the feedback"
- Is concise and actionable (2-4 sentences)

Your response should demonstrate that you understand the specific code and concern, not give a vague acknowledgment.

Output only the reply text, nothing else.`;
  }
}
