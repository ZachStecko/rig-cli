import { BaseCommand } from './base-command.js';
import { Logger } from '../services/logger.service.js';
import { ConfigManager } from '../services/config-manager.service.js';
import { StateManager } from '../services/state-manager.service.js';
import { GitService } from '../services/git.service.js';
import { GitHubService } from '../services/github.service.js';
import { GuardService } from '../services/guard.service.js';
import { LLMService } from '../services/llm.service.js';
import * as readline from 'readline';

/**
 * CreateIssueCommand handles interactive issue creation with LLM-powered structuring.
 *
 * Workflow:
 * 1. Prompt user for raw issue description (multiline)
 * 2. Use LLM to structure description into proper GitHub issue format
 * 3. Display structured issue preview
 * 4. Confirm and create issue on GitHub
 */
export class CreateIssueCommand extends BaseCommand {
  private llm: LLMService;

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
    this.llm = new LLMService();
  }

  /**
   * Executes the create issue command.
   *
   * @throws Error if preconditions fail or issue creation fails
   */
  async execute(): Promise<void> {
    // Check preconditions
    await this.guard.requireGhAuth();

    this.logger.header('Create GitHub Issue');
    console.log('');

    // Get raw description from user
    this.logger.info('Describe the issue in your own words (multiline input):');
    this.logger.dim('  Press Ctrl+D when done, or type "EOF" alone on a line');
    console.log('');
    const rawDescription = await this.promptMultiline();

    if (!rawDescription.trim()) {
      this.logger.warn('No description provided. Aborting.');
      return;
    }

    // Check if LLM service is available
    const llmInstalled = await this.llm.isInstalled();
    if (!llmInstalled) {
      this.logger.error('Claude CLI is not installed. Install it with:');
      console.log('  npm install -g @anthropic-ai/claude-code');
      return;
    }

    // Structure the issue using LLM
    this.logger.info('Structuring your issue...');
    console.log('');

    let structured;
    try {
      structured = await this.llm.structureIssue(rawDescription);
    } catch (error) {
      this.logger.error(`Failed to structure issue: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return;
    }

    // Display preview
    this.displayPreview(structured.title, structured.body);

    // Confirm creation
    const confirmed = await this.confirm('\nCreate this issue? (y/n): ');
    if (!confirmed) {
      this.logger.warn('Issue creation cancelled.');
      return;
    }

    // Create the issue
    try {
      const issueNumber = await this.github.createIssue({
        title: structured.title,
        body: structured.body,
      });

      console.log('');
      this.logger.success(`Issue #${issueNumber} created successfully!`);

      // Get repository name and display URL
      const repoName = await this.github.repoName();
      console.log(`  https://github.com/${repoName}/issues/${issueNumber}`);
    } catch (error) {
      this.logger.error(`Failed to create issue: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Prompts for multiline input.
   * Reads until Ctrl+D (EOF) or a line containing only "EOF".
   *
   * @returns The multiline input as a single string
   */
  private promptMultiline(): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    const lines: string[] = [];
    let sigintHandler: (() => void) | null = null;

    return new Promise((resolve, reject) => {
      try {
        // Handle Ctrl+C
        sigintHandler = () => {
          rl.close();
          console.log('');
          resolve('');
        };
        process.once('SIGINT', sigintHandler);

        // Handle line-by-line input
        rl.on('line', (line) => {
          // Check for EOF marker
          if (line.trim() === 'EOF') {
            rl.close();
            return;
          }
          lines.push(line);
        });

        // Handle end of input (Ctrl+D)
        rl.on('close', () => {
          if (sigintHandler) {
            process.removeListener('SIGINT', sigintHandler);
          }
          resolve(lines.join('\n'));
        });

        // Handle errors
        rl.on('error', (err) => {
          if (sigintHandler) {
            process.removeListener('SIGINT', sigintHandler);
          }
          reject(err);
        });
      } catch (err) {
        if (sigintHandler) {
          process.removeListener('SIGINT', sigintHandler);
        }
        reject(err);
      }
    });
  }

  /**
   * Displays a preview of the structured issue.
   *
   * @param title - Issue title
   * @param body - Issue body
   */
  private displayPreview(title: string, body: string): void {
    console.log('');
    this.logger.header('Preview');
    console.log('');
    this.logger.info('Title:');
    console.log(`  ${title}`);

    // Warn if title is very long
    if (title.length > 200) {
      this.logger.warn('  Title is quite long (' + title.length + ' characters)');
    }

    console.log('');
    this.logger.info('Body:');
    // Indent body lines for display
    body.split('\n').forEach(line => {
      console.log(`  ${line}`);
    });

    // Info about body length if it's very large
    if (body.length > 5000) {
      console.log('');
      this.logger.dim(`  (${body.length} characters)`);
    }
  }

  /**
   * Prompts the user for confirmation.
   *
   * @param question - The question to ask
   * @returns True if user confirmed (y/yes), false otherwise
   */
  private confirm(question: string): Promise<boolean> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    let sigintHandler: (() => void) | null = null;

    return new Promise((resolve, reject) => {
      try {
        // Handle Ctrl+C
        sigintHandler = () => {
          rl.close();
          console.log('');
          resolve(false);
        };
        process.once('SIGINT', sigintHandler);

        rl.question(question, (answer) => {
          if (sigintHandler) {
            process.removeListener('SIGINT', sigintHandler);
          }
          rl.close();
          const normalized = answer.trim().toLowerCase();
          resolve(normalized === 'y' || normalized === 'yes');
        });

        // Handle errors
        rl.on('error', (err) => {
          if (sigintHandler) {
            process.removeListener('SIGINT', sigintHandler);
          }
          reject(err);
        });
      } catch (err) {
        if (sigintHandler) {
          process.removeListener('SIGINT', sigintHandler);
        }
        reject(err);
      }
    });
  }
}
