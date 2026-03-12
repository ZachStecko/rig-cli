import { BaseCommand } from './base-command.js';
import { Logger } from '../services/logger.service.js';
import { ConfigManager } from '../services/config-manager.service.js';
import { StateManager } from '../services/state-manager.service.js';
import { GitService } from '../services/git.service.js';
import { GitHubService } from '../services/github.service.js';
import { GuardService } from '../services/guard.service.js';
import { ClaudeService } from '../services/claude.service.js';
import { PromptBuilderService } from '../services/prompt-builder.service.js';
import { TemplateEngine } from '../services/template-engine.service.js';
import { ChildProcess } from 'child_process';
import * as path from 'path';

/**
 * ImplementCommand runs Claude Code agent to implement an issue.
 *
 * Uses PromptBuilderService to construct the implementation prompt,
 * then executes Claude Code to implement the changes.
 * Logs output and updates pipeline state.
 */
export class ImplementCommand extends BaseCommand {
  private claude: ClaudeService;
  private promptBuilder: PromptBuilderService;

  /**
   * Creates a new ImplementCommand instance.
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
    this.claude = new ClaudeService();
    const templateEngine = new TemplateEngine();
    this.promptBuilder = new PromptBuilderService(this.github, this.git, templateEngine);
  }

  /**
   * Executes the implement command.
   *
   * Checks for active pipeline, assembles prompt, runs Claude agent,
   * and updates state based on outcome.
   *
   * @param options - Command options
   * @param options.issue - Optional issue number to implement (overrides state)
   * @param options.dryRun - If true, show prompt without executing
   */
  async execute(options?: { issue?: string; dryRun?: boolean }): Promise<void> {
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
        // Create minimal state for ad-hoc implementation
        const issue = await this.github.viewIssue(issueNumber);
        state = {
          issue_number: issueNumber,
          issue_title: issue.title,
          branch: `issue-${issueNumber}`,
          stage: 'implement',
          stages: {
            pick: 'completed',
            branch: 'pending',
            implement: 'pending',
            test: 'pending',
            demo: 'pending',
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
    }

    // Check Claude is installed (skip if dry-run)
    if (!options?.dryRun) {
      const claudeInstalled = await this.claude.isInstalled();
      if (!claudeInstalled) {
        this.logger.error('Claude CLI is not installed. Install it first: npm install -g @anthropics/claude-cli');
        process.exit(1);
        return; // For testing
      }
    }

    this.logger.header(`Implementing Issue #${issueNumber}`);
    console.log('');
    this.logger.info(`Issue: ${state.issue_title}`);
    this.logger.info(`Branch: ${state.branch}`);
    if (options?.dryRun) {
      this.logger.warn('[DRY RUN MODE - No changes will be made]');
    }
    console.log('');

    // Update state to mark implement as in_progress (skip if dry-run)
    if (!options?.dryRun) {
      await this.state.write({
        ...state,
        stage: 'implement',
        stages: {
          ...state.stages,
          implement: 'in_progress',
        },
      });
    }

    // Assemble prompt
    this.logger.step(1, 2, 'Assembling implementation prompt...');
    const prompt = await this.promptBuilder.assemblePrompt(issueNumber);

    // Get issue for component detection
    const issue = await this.github.viewIssue(state.issue_number);
    const labels = issue.labels.map((l: any) => l.name);
    const component = this.promptBuilder.detectComponent(labels);
    const allowedTools = this.promptBuilder.buildAllowedTools(component);

    // Get max turns and verbose from config
    const rigConfig = this.config.get();
    const maxTurns = rigConfig.agent.max_turns || 20;
    const verbose = rigConfig.verbose || false;

    // Prepare log file
    const logFile = path.join(
      this.projectRoot || process.cwd(),
      '.rig-logs',
      `issue-${issueNumber}.log`
    );

    // Handle dry-run mode
    if (options?.dryRun) {
      this.logger.step(2, 2, 'Preview (dry-run)');
      console.log('');
      this.logger.info('Prompt preview:');
      console.log('---');
      console.log(prompt.substring(0, 500) + (prompt.length > 500 ? '...' : ''));
      console.log('---');
      console.log('');
      this.logger.info('Configuration:');
      this.logger.info(`  Max turns: ${maxTurns}`);
      this.logger.info(`  Allowed tools: ${allowedTools}`);
      this.logger.info(`  Verbose: ${verbose}`);
      this.logger.info(`  Log file: ${logFile}`);
      console.log('');
      this.logger.success('Dry-run complete. Use without --dry-run to execute.');
      return;
    }

    // Run Claude agent
    this.logger.step(2, 2, 'Running Claude Code agent...');
    console.log('');

    try {
      const child = await this.claude.run({
        prompt,
        maxTurns,
        allowedTools,
        logFile,
        verbose,
      });

      // Stream output to console
      await this.streamProcess(child);

      // Mark implementation complete
      await this.state.write({
        ...state,
        stage: 'implement',
        stages: {
          ...state.stages,
          implement: 'completed',
        },
      });

      console.log('');
      this.logger.success(`Issue #${issueNumber} implemented`);
      this.logger.info("Run 'rig test' to verify, or continue with next stage.");
    } catch (error) {
      // Mark implementation failed
      await this.state.write({
        ...state,
        stage: 'implement',
        stages: {
          ...state.stages,
          implement: 'failed',
        },
      });

      this.logger.error(`Implementation failed: ${(error as Error).message}`);
      this.logger.dim(`Check log: ${logFile}`);
      process.exit(1);
      return; // For testing
    }
  }

  /**
   * Streams process output to console.
   *
   * Parses stream-json output and formats it for human readability.
   * Filters out verbose tool call JSON and shows clean progress messages.
   *
   * @param child - Child process to stream
   */
  private async streamProcess(child: ChildProcess): Promise<void> {
    return new Promise((resolve, reject) => {
      let buffer = '';

      // Stream stdout with JSON parsing
      child.stdout?.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');

        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || '';

        // Process complete lines
        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            // Try to parse as JSON (stream-json format)
            const parsed = JSON.parse(line);

            // Format based on the type of message
            if (parsed.type === 'tool_use') {
              // Show tool usage in a clean format
              const toolName = parsed.name || parsed.tool || 'unknown';
              this.formatToolUse(toolName, parsed.input);
            } else if (parsed.type === 'text' || parsed.text) {
              // Show text output
              const text = parsed.text || parsed.content || '';
              if (text.trim()) {
                process.stdout.write(text);
              }
            } else if (parsed.type === 'error') {
              // Show errors in red
              this.logger.error(parsed.message || JSON.stringify(parsed));
            } else {
              // Unknown JSON format - only show if it looks important
              if (parsed.type !== 'thinking' && parsed.type !== 'debug') {
                process.stdout.write(line + '\n');
              }
            }
          } catch (e) {
            // Not JSON, treat as regular output
            process.stdout.write(line + '\n');
          }
        }
      });

      // Stream stderr as-is
      child.stderr?.on('data', (data: Buffer) => {
        process.stderr.write(data);
      });

      // Handle process completion
      child.on('close', (code) => {
        // Process any remaining buffer
        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer);
            if (parsed.type === 'text' || parsed.text) {
              const text = parsed.text || parsed.content || '';
              if (text.trim()) process.stdout.write(text);
            }
          } catch (e) {
            process.stdout.write(buffer);
          }
        }

        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Process exited with code ${code}`));
        }
      });

      // Handle errors
      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Formats tool usage messages in a human-readable way.
   *
   * @param toolName - Name of the tool being used
   * @param input - Tool input parameters
   */
  private formatToolUse(toolName: string, input: any): void {
    switch (toolName) {
      case 'Read':
        this.logger.dim(`  Reading: ${input.file_path || 'file'}`);
        break;
      case 'Write':
        this.logger.dim(`  Writing: ${input.file_path || 'file'}`);
        break;
      case 'Edit':
        this.logger.dim(`  Editing: ${input.file_path || 'file'}`);
        break;
      case 'Bash':
        const cmd = input.command || input.cmd || 'command';
        // Truncate long commands
        const displayCmd = cmd.length > 60 ? cmd.substring(0, 60) + '...' : cmd;
        this.logger.dim(`  Running: ${displayCmd}`);
        break;
      case 'Glob':
        this.logger.dim(`  Searching files: ${input.pattern || '*'}`);
        break;
      case 'Grep':
        this.logger.dim(`  Searching code: "${input.pattern || ''}"`);
        break;
      default:
        // For unknown tools, show minimal info
        this.logger.dim(`  Using tool: ${toolName}`);
    }
  }
}
