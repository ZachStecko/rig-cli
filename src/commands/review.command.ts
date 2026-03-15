import { BaseCommand } from './base-command.js';
import { Logger } from '../services/logger.service.js';
import { ConfigManager } from '../services/config-manager.service.js';
import { StateManager } from '../services/state-manager.service.js';
import { GitService } from '../services/git.service.js';
import { GitHubService } from '../services/github.service.js';
import { GuardService } from '../services/guard.service.js';
import { ClaudeCodeAgent } from '../services/agents/claude-code.agent.js';
import { PromptBuilderService } from '../services/prompt-builder.service.js';
import { TemplateEngine } from '../services/template-engine.service.js';
import * as path from 'path';
import { readFile, existsSync } from 'fs';
import { promisify } from 'util';
import * as readline from 'readline';

const readFileAsync = promisify(readFile);

/**
 * Represents a parsed finding from a review file.
 */
interface ReviewFinding {
  severity: 'high' | 'medium' | 'low';
  description: string;
  fullText: string;
}

/**
 * Represents a parsed review result.
 */
interface ReviewResult {
  verdict: 'PASS' | 'CONTESTED' | 'REJECT';
  findings: ReviewFinding[];
  reviewFilePath: string;
}

/**
 * ReviewCommand runs code review using Claude Code agent.
 *
 * Generates review prompt, runs review agent, parses findings,
 * and provides interactive triage to fix selected issues.
 */
export class ReviewCommand extends BaseCommand {
  private promptBuilder: PromptBuilderService;

  /**
   * Creates a new ReviewCommand instance.
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
    this.promptBuilder = new PromptBuilderService(this.github, this.git, templateEngine);
  }

  /**
   * Executes the review command.
   *
   * Runs review agent, parses findings, performs interactive triage,
   * and runs fix agent for selected findings.
   *
   * @param options - Command options
   * @param options.issue - Optional issue number to review (overrides state)
   * @param options.pr - Optional PR number to review
   * @param options.dryRun - If true, show prompt without executing
   */
  async execute(options?: { issue?: string; pr?: string; dryRun?: boolean }): Promise<void> {
    // Check GitHub authentication
    await this.guard.requireGhAuth();

    // Determine issue number
    let issueNumber: number;
    let state: any;

    if (options?.issue) {
      // Use --issue flag
      issueNumber = parseInt(options.issue, 10);
      if (isNaN(issueNumber)) {
        this.logger.error(`Invalid issue number: ${options.issue}`);
        process.exit(1);
        return; // For testing
      }

      // Load or create minimal state for this issue
      const stateExists = await this.state.exists();
      if (stateExists) {
        state = await this.state.read();
      } else {
        // Create minimal state for ad-hoc review
        const issue = await this.github.viewIssue(issueNumber);
        state = {
          issue_number: issueNumber,
          issue_title: issue.title,
          branch: `issue-${issueNumber}`,
          stage: 'review',
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
    } else if (options?.pr) {
      // Use --pr flag to fetch PR and extract issue number
      const prNumber = parseInt(options.pr, 10);
      if (isNaN(prNumber)) {
        this.logger.error(`Invalid PR number: ${options.pr}`);
        process.exit(1);
        return; // For testing
      }

      // Fetch PR details
      const pr = await this.github.viewPr(prNumber);

      // Extract issue number from branch name (format: issue-{number}-...)
      const branchMatch = pr.headRefName.match(/^issue-(\d+)/);
      if (!branchMatch) {
        this.logger.error(`Cannot determine issue number from PR #${prNumber} branch: ${pr.headRefName}`);
        this.logger.info('Branch name must start with "issue-{number}" format.');
        process.exit(1);
        return; // For testing
      }

      issueNumber = parseInt(branchMatch[1], 10);

      // Load or create minimal state for this issue
      const stateExists = await this.state.exists();
      if (stateExists) {
        state = await this.state.read();
      } else {
        // Create minimal state for ad-hoc review
        const issue = await this.github.viewIssue(issueNumber);
        state = {
          issue_number: issueNumber,
          issue_title: issue.title,
          branch: pr.headRefName,
          stage: 'review',
          stages: {
            pick: 'completed',
            branch: 'completed',
            implement: 'completed',
            test: 'completed',
            pr: 'completed',
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
    }

    // Check Claude agent is available (skip if dry-run)
    if (!options?.dryRun) {
      const agent = new ClaudeCodeAgent();
      const available = await agent.isAvailable();
      if (!available) {
        this.logger.error('ANTHROPIC_API_KEY environment variable is not set.');
        this.logger.info('Set your API key: export ANTHROPIC_API_KEY=sk-...');
        process.exit(1);
        return; // For testing
      }
    }

    this.logger.header(`Code Review for Issue #${issueNumber}`);
    console.log('');
    this.logger.info(`Issue: ${state.issue_title}`);
    if (options?.dryRun) {
      this.logger.warn('[DRY RUN MODE - No changes will be made]');
    }
    console.log('');

    // Update state to mark review as in_progress (skip if dry-run)
    if (!options?.dryRun) {
      await this.state.write({
        ...state,
        stage: 'review',
        stages: {
          ...state.stages,
          review: 'in_progress',
        },
      });
    }

    // Assemble review prompt
    this.logger.step(1, 3, 'Assembling review prompt...');
    const prompt = await this.promptBuilder.assembleReviewPrompt(issueNumber);

    // Extract review file path from prompt (it's in the template)
    const reviewFilePathMatch = prompt.match(/`(\.rig-reviews\/issue-\d+\/review-[^`]+\.md)`/);
    const reviewFilePath = reviewFilePathMatch
      ? path.join(this.projectRoot || process.cwd(), reviewFilePathMatch[1])
      : path.join(this.projectRoot || process.cwd(), `.rig-reviews/issue-${issueNumber}/review-latest.md`);

    // Get max turns, verbose, and permission mode from config
    const rigConfig = this.config.get();
    const maxTurns = rigConfig.agent.max_turns || 20;
    const verbose = rigConfig.verbose || false;
    const permissionMode = rigConfig.agent.permission_mode || 'default';

    // Get issue for component detection
    const issue = await this.github.viewIssue(issueNumber);
    const labels = issue.labels.map((l: any) => l.name);
    const component = this.promptBuilder.detectComponent(labels, issue.title, issue.body);

    // Build allowed tools - read-only for review
    const allowedToolsReview = 'Read,Grep,Glob';
    // Full tools for fixes
    const allowedToolsFix = this.promptBuilder.buildAllowedTools(component);

    // Prepare log file
    const logFile = path.join(
      this.projectRoot || process.cwd(),
      '.rig-logs',
      `review-issue-${issueNumber}.log`
    );

    // Handle dry-run mode
    if (options?.dryRun) {
      this.logger.step(2, 3, 'Preview (dry-run)');
      console.log('');
      this.logger.info('Review prompt preview:');
      console.log('---');
      console.log(prompt.substring(0, 500) + (prompt.length > 500 ? '...' : ''));
      console.log('---');
      console.log('');
      this.logger.info('Configuration:');
      this.logger.info(`  Max turns: ${maxTurns}`);
      this.logger.info(`  Review file: ${reviewFilePath}`);
      this.logger.info(`  Log file: ${logFile}`);
      console.log('');
      this.logger.success('Dry-run complete. Use without --dry-run to execute.');
      return;
    }

    try {
      // Step 2: Run review agent
      this.logger.step(2, 3, 'Running code review agent...');
      console.log('');

      const reviewAgent = new ClaudeCodeAgent();
      const reviewSession = await reviewAgent.createSession({
        prompt,
        maxIterations: maxTurns,
        allowedTools: allowedToolsReview.split(','),
        logFile,
        verbose,
        providerOptions: { permissionMode },
      });

      // Stream events to console
      for await (const event of reviewSession.events) {
        this.handleAgentEvent(event);
      }

      console.log('');

      // Step 3: Parse review and triage
      this.logger.step(3, 3, 'Parsing review and triaging findings...');
      console.log('');

      const review = await this.parseReview(reviewFilePath);

      this.logger.info(`Verdict: ${review.verdict}`);
      this.logger.info(`Findings: ${review.findings.length} (${review.findings.filter(f => f.severity === 'high').length} high, ${review.findings.filter(f => f.severity === 'medium').length} medium, ${review.findings.filter(f => f.severity === 'low').length} low)`);
      console.log('');

      if (review.findings.length === 0) {
        this.logger.success('No findings to triage.');
      } else {
        // Interactive triage
        const findingsToFix = await this.triageFindings(review.findings);

        if (findingsToFix.length > 0) {
          this.logger.info(`Selected ${findingsToFix.length} findings to fix.`);
          console.log('');

          // Run fix agent for each finding
          for (let i = 0; i < findingsToFix.length; i++) {
            const finding = findingsToFix[i];
            this.logger.info(`[${i + 1}/${findingsToFix.length}] Fixing: ${finding.description.substring(0, 80)}...`);

            const fixPrompt = this.buildFixPrompt(finding, issueNumber);
            const fixLogFile = path.join(
              this.projectRoot || process.cwd(),
              '.rig-logs',
              `fix-issue-${issueNumber}-finding-${i + 1}.log`
            );

            const fixAgent = new ClaudeCodeAgent();
            const fixSession = await fixAgent.createSession({
              prompt: fixPrompt,
              maxIterations: 10,
              allowedTools: allowedToolsFix.split(','),
              logFile: fixLogFile,
              verbose,
              providerOptions: { permissionMode },
            });

            // Stream fix events to console
            for await (const event of fixSession.events) {
              this.handleAgentEvent(event);
            }
            console.log('');
          }

          this.logger.success('All selected findings addressed.');
        } else {
          this.logger.info('No findings selected for fixing.');
        }
      }

      // Mark review complete
      await this.state.write({
        ...state,
        stage: 'review',
        stages: {
          ...state.stages,
          review: 'completed',
        },
      });

      console.log('');
      this.logger.success(`Code review completed for issue #${issueNumber}`);
      this.logger.dim(`Review file: ${reviewFilePath}`);
      this.logger.info("Review complete. Merge the PR or continue with next stage.");
    } catch (error) {
      // Mark review failed
      await this.state.write({
        ...state,
        stage: 'review',
        stages: {
          ...state.stages,
          review: 'failed',
        },
      });

      this.logger.error(`Review failed: ${(error as Error).message}`);
      this.logger.dim(`Check log: ${logFile}`);
      process.exit(1);
      return; // For testing
    }
  }

  /**
   * Parses a review file to extract verdict and findings.
   *
   * @param reviewFilePath - Path to review markdown file
   * @returns Parsed review result
   */
  private async parseReview(reviewFilePath: string): Promise<ReviewResult> {
    if (!existsSync(reviewFilePath)) {
      throw new Error(`Review file not found: ${reviewFilePath}`);
    }

    const content = await readFileAsync(reviewFilePath, 'utf-8');

    // Extract verdict
    const verdictMatch = content.match(/##\s+Verdict:\s+(PASS|CONTESTED|REJECT)/i);
    const verdict = (verdictMatch?.[1]?.toUpperCase() as 'PASS' | 'CONTESTED' | 'REJECT') || 'PASS';

    // Extract findings from Findings section
    const findingsSection = content.match(/##\s+Findings\s+([\s\S]*?)(?=\n##|$)/i);
    const findings: ReviewFinding[] = [];

    if (findingsSection) {
      const findingsText = findingsSection[1];

      // Match findings with severity tags
      const findingPattern = /\*\*\[(high|medium|low)\]\*\*\s+([^\n]+(?:\n(?!\*\*\[)[^\n]+)*)/gi;
      let match;

      while ((match = findingPattern.exec(findingsText)) !== null) {
        findings.push({
          severity: match[1].toLowerCase() as 'high' | 'medium' | 'low',
          description: match[2].trim(),
          fullText: match[0],
        });
      }
    }

    return {
      verdict,
      findings,
      reviewFilePath,
    };
  }

  /**
   * Performs interactive triage of findings using readline.
   *
   * @param findings - List of findings to triage
   * @returns List of findings to fix
   */
  private async triageFindings(findings: ReviewFinding[]): Promise<ReviewFinding[]> {
    const findingsToFix: ReviewFinding[] = [];

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    for (let i = 0; i < findings.length; i++) {
      const finding = findings[i];

      console.log('');
      this.logger.info(`Finding ${i + 1}/${findings.length} [${finding.severity}]:`);
      console.log(finding.description);
      console.log('');

      const answer = await this.askQuestion(rl, 'Fix this finding? (y/n/q): ');

      if (answer.toLowerCase() === 'q') {
        this.logger.info('Triage interrupted by user.');
        break;
      } else if (answer.toLowerCase() === 'y') {
        findingsToFix.push(finding);
      }
    }

    rl.close();

    return findingsToFix;
  }

  /**
   * Asks a question using readline and returns the answer.
   *
   * @param rl - Readline interface
   * @param question - Question to ask
   * @returns User's answer
   */
  private async askQuestion(rl: readline.Interface, question: string): Promise<string> {
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        resolve(answer);
      });
    });
  }

  /**
   * Builds a fix prompt for a specific finding.
   *
   * @param finding - Finding to fix
   * @param issueNumber - Issue number
   * @returns Fix prompt text
   */
  private buildFixPrompt(finding: ReviewFinding, issueNumber: number): string {
    return `# Fix Code Review Finding

Issue #${issueNumber}

## Finding to Address

${finding.fullText}

## Your Task

Fix the issue described in the finding above. Make the minimal changes necessary to address the specific problem. Do not make unrelated changes or improvements.

Follow these steps:
1. Locate the relevant file(s) and code sections
2. Understand the current implementation
3. Make targeted changes to fix the issue
4. Verify the fix doesn't break anything

Be surgical in your changes - fix only what's broken.`;
  }

}
