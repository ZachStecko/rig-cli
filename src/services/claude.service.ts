import { spawn, ChildProcess } from 'child_process';
import { exec } from '../utils/shell.js';

/**
 * Options for running the Claude CLI.
 */
export interface ClaudeRunOptions {
  /** The prompt to send to Claude */
  prompt: string;
  /** Maximum number of turns for the agent conversation */
  maxTurns: number;
  /** Comma-separated list of allowed tools (e.g., "Read,Write,Bash") */
  allowedTools: string;
  /** Path to write verbose log output */
  logFile: string;
  /** Enable verbose output (default: false) */
  verbose?: boolean;
  /** Permission mode for file operations: 'default', 'bypassPermissions', 'acceptEdits', 'dontAsk', 'plan', or 'auto' (default: 'bypassPermissions') */
  permissionMode?: 'default' | 'bypassPermissions' | 'acceptEdits' | 'dontAsk' | 'plan' | 'auto';
}

/**
 * ClaudeService wraps the Claude CLI for running agent sessions.
 *
 * Spawns the `claude` command with appropriate flags and streams output.
 * The Claude CLI must be installed and available in PATH.
 */
export class ClaudeService {
  /**
   * Checks if the Claude CLI is installed.
   *
   * @returns true if claude is available, false otherwise
   */
  async isInstalled(): Promise<boolean> {
    const result = await exec('claude --version');
    return result.exitCode === 0;
  }

  /**
   * Detects if the current environment is a server/CI environment.
   *
   * @returns true if running in CI/server environment, false for local development
   */
  private isServerEnvironment(): boolean {
    // Check for common CI environment variables
    const ciEnvVars = [
      'CI',           // Generic CI flag
      'GITHUB_ACTIONS',
      'GITLAB_CI',
      'CIRCLECI',
      'TRAVIS',
      'JENKINS_HOME',
      'BUILDKITE',
      'DRONE',
      'CODEBUILD_BUILD_ID',  // AWS CodeBuild
    ];

    // Check if any CI variable is set to 'true' or '1'
    const isCI = ciEnvVars.some(envVar => {
      const value = process.env[envVar];
      return value === 'true' || value === '1';
    });

    // Additional heuristics for server detection
    const hasDockerEnv = process.env.DOCKER_CONTAINER === 'true';

    // Consider it a server if CI or Docker
    return isCI || hasDockerEnv;
  }

  /**
   * Sends a simple prompt to Claude and returns the text response.
   *
   * Uses: claude -p "prompt" --output-format json
   *
   * @param prompt - The prompt to send to Claude
   * @returns Promise that resolves with Claude's response text
   * @throws Error if Claude CLI is not available or we're in a nested session
   */
  async prompt(prompt: string): Promise<string> {
    // Check if we're in a nested Claude Code session
    if (process.env.CLAUDECODE) {
      throw new Error('Cannot call Claude CLI from within a Claude Code session (nested sessions not supported)');
    }

    const result = await exec(`claude -p ${JSON.stringify(prompt)} --output-format json`);

    if (result.exitCode !== 0) {
      throw new Error(`Claude prompt failed: ${result.stderr}`);
    }

    try {
      const response = JSON.parse(result.stdout);
      // Extract text from the response content
      if (response.content && Array.isArray(response.content)) {
        const textBlocks = response.content
          .filter((block: any) => block.type === 'text')
          .map((block: any) => block.text);
        return textBlocks.join('\n');
      }
      return response.text || response.content || '';
    } catch (error) {
      // If JSON parsing fails, return raw stdout
      return result.stdout.trim();
    }
  }

  /**
   * Runs a Claude agent session with the specified options.
   *
   * Spawns: claude -p "prompt" --max-turns N --allowedTools "tools" [--verbose] --output-format stream-json
   *
   * The process runs asynchronously and streams output.
   * Verbose logs are written to the specified log file.
   *
   * @param options - Claude run options
   * @returns Promise that resolves with the spawned ChildProcess
   */
  async run(options: ClaudeRunOptions): Promise<ChildProcess> {
    // Check authentication method and environment
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
    const isServerEnv = this.isServerEnvironment();

    if (isServerEnv && !hasApiKey) {
      console.warn('\n⚠️  Warning: Running rig-cli in a CI/server environment without ANTHROPIC_API_KEY.');
      console.warn('   Anthropic\'s Terms of Service require API key authentication for production use.');
      console.warn('   For personal use on your local machine, subscription auth is fine.');
      console.warn('   See: https://console.anthropic.com/ to get an API key\n');
    }

    const args = [
      '-p',
      options.prompt,
      '--max-turns',
      String(options.maxTurns),
      '--allowedTools',
      options.allowedTools,
    ];

    // Add permission mode if specified
    if (options.permissionMode) {
      args.push('--permission-mode', options.permissionMode);
    }

    // stream-json requires --verbose, so always enable it
    args.push('--verbose');
    args.push('--output-format', 'stream-json');

    // Spawn claude process
    const child = spawn('claude', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CLAUDE_LOG_FILE: options.logFile,
      },
    });

    return child;
  }
}
