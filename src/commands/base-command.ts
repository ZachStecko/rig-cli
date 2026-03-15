import { Logger } from '../services/logger.service.js';
import { ConfigManager } from '../services/config-manager.service.js';
import { StateManager } from '../services/state-manager.service.js';
import { GitService } from '../services/git.service.js';
import { GitHubService } from '../services/github.service.js';
import { GuardService } from '../services/guard.service.js';
import { AgentEvent } from '../services/agents/types.js';
import * as readline from 'readline';

/**
 * BaseCommand provides shared infrastructure for all CLI commands.
 *
 * Wires up common services (Logger, ConfigManager, StateManager, GitService,
 * GitHubService, GuardService) and provides helper methods like resolveProjectRoot().
 *
 * All commands extend this class and implement the abstract execute() method.
 */
export abstract class BaseCommand {
  protected logger: Logger;
  protected config: ConfigManager;
  protected state: StateManager;
  protected git: GitService;
  protected github: GitHubService;
  protected guard: GuardService;
  protected projectRoot: string;

  /**
   * Creates a new BaseCommand instance.
   *
   * Wires up all required services and resolves the project root directory.
   *
   * @param logger - Logger service for output
   * @param config - ConfigManager for reading .rig.yml
   * @param state - StateManager for reading/writing .rig-state.json
   * @param git - GitService for git operations
   * @param github - GitHubService for GitHub API calls
   * @param guard - GuardService for pre-flight checks
   * @param projectRoot - Optional project root (defaults to process.cwd())
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
    this.logger = logger;
    this.config = config;
    this.state = state;
    this.git = git;
    this.github = github;
    this.guard = guard;
    this.projectRoot = this.resolveProjectRoot(projectRoot);
  }

  /**
   * Executes the command.
   *
   * Subclasses must implement this method to define command behavior.
   *
   * @param args - Command-specific arguments
   */
  abstract execute(...args: any[]): Promise<void>;

  /**
   * Resolves the project root directory.
   *
   * Uses provided path if given, otherwise defaults to process.cwd().
   *
   * @param path - Optional project root path
   * @returns Absolute path to project root
   * @protected
   */
  protected resolveProjectRoot(path?: string): string {
    return path || process.cwd();
  }

  /**
   * Prompts the user for confirmation.
   *
   * @param question - The question to ask
   * @returns True if user confirmed (y/yes), false otherwise
   * @protected
   */
  protected confirm(question: string): Promise<boolean> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      // Handle Ctrl+C
      const sigintHandler = () => {
        rl.close();
        console.log(''); // Newline after ^C
        resolve(false);
      };
      process.once('SIGINT', sigintHandler);

      rl.question(question, (answer) => {
        process.removeListener('SIGINT', sigintHandler);
        rl.close();
        const normalized = answer.trim().toLowerCase();
        resolve(normalized === 'y' || normalized === 'yes');
      });
    });
  }

  /**
   * Prompts for multiline input.
   * Reads until Ctrl+D (EOF) or a line containing only "EOF".
   *
   * @returns The multiline input as a single string
   * @protected
   */
  protected promptMultiline(): Promise<string> {
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
   * Handles agent events and outputs them to console.
   *
   * @param event - Agent event to handle
   * @protected
   */
  protected handleAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'text':
        process.stdout.write(event.content);
        break;

      case 'thinking':
        // Skip thinking events (internal)
        break;

      case 'tool_use':
        this.formatToolUse(event.tool, event.input);
        break;

      case 'tool_result':
        if (event.error) {
          if (event.error.includes('requested permissions')) {
            this.logger.warn('Permission required - operation skipped');
          } else {
            this.logger.error(event.error);
          }
        }
        break;

      case 'error':
        this.logger.error(event.message);
        if (event.fatal) {
          throw new Error(event.message);
        }
        break;

      case 'progress':
        // Skip progress events
        break;

      case 'complete':
        // Session complete - handled by iterator completion
        break;
    }
  }

  /**
   * Formats tool usage messages in a human-readable way.
   *
   * @param toolName - Name of the tool being used
   * @param input - Tool input parameters
   * @protected
   */
  protected formatToolUse(toolName: string, input: any): void {
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
      case 'Bash': {
        const cmd = input.command || input.cmd || 'command';
        const displayCmd = cmd.length > 60 ? cmd.substring(0, 60) + '...' : cmd;
        this.logger.dim(`  Running: ${displayCmd}`);
        break;
      }
      case 'Glob':
        this.logger.dim(`  Searching files: ${input.pattern || '*'}`);
        break;
      case 'Grep':
        this.logger.dim(`  Searching code: "${input.pattern || ''}"`);
        break;
      default:
        this.logger.dim(`  Using tool: ${toolName}`);
    }
  }
}
