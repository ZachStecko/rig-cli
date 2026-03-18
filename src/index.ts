#!/usr/bin/env node
/**
 * rig-cli: Automated issue-to-PR pipeline using Claude Code
 *
 * This is the main entry point for the CLI. Commands will be registered here
 * as they are implemented.
 */
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Logger } from './services/logger.service.js';
import { ConfigManager } from './services/config-manager.service.js';
import { StateManager } from './services/state-manager.service.js';
import { GitService } from './services/git.service.js';
import { GitHubService } from './services/github.service.js';
import { GuardService } from './services/guard.service.js';
import { StatusCommand } from './commands/status.command.js';
import { QueueCommand } from './commands/queue.command.js';
import { NextCommand } from './commands/next.command.js';
import { ResetCommand } from './commands/reset.command.js';
import { RollbackCommand } from './commands/rollback.command.js';
import { ImplementCommand } from './commands/implement.command.js';
import { TestCommand } from './commands/test.command.js';
// import { DemoCommand } from './commands/demo.command.js'; // DISABLED: Demo feature disabled for redesign
import { PrCommand } from './commands/pr.command.js';
import { ReviewCommand } from './commands/review.command.js';
import { ShipCommand } from './commands/ship.command.js';
import { BootstrapCommand } from './commands/bootstrap.command.js';
import { CreateIssueCommand } from './commands/create-issue.command.js';
import { SetupLabelsCommand } from './commands/setup-labels.command.js';
import { StoryCommand } from './commands/story.command.js';

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8')
);

const program = new Command();

program
  .name('rig')
  .description('Automated issue-to-PR pipeline using Claude Code')
  .version(packageJson.version);

// Initialize services
const projectRoot = process.cwd();
const logger = new Logger();
const config = new ConfigManager(projectRoot);
const state = new StateManager(projectRoot);
const git = new GitService(projectRoot);
const github = new GitHubService(projectRoot);
const guard = new GuardService(git, github, state);

async function loadConfig(): Promise<void> {
  await config.load();
  logger.setVerbose(config.get().verbose || false);
  const baseBranch = config.get().git?.base_branch;
  if (baseBranch) {
    git.setBaseBranch(baseBranch);
  }
}

// Register status command
program
  .command('status')
  .description('Display current pipeline status')
  .action(async () => {
    await loadConfig();
    const statusCommand = new StatusCommand(logger, config, state, git, github, guard, projectRoot);
    await statusCommand.execute();
  });

// Register queue command
program
  .command('queue')
  .description('Display prioritized issue backlog')
  .option('--phase <phase>', 'Filter by phase (e.g., "Phase 1: MVP")')
  .option('--component <component>', 'Filter by component (backend, frontend, fullstack, devnet, node)')
  .action(async (options) => {
    await loadConfig();
    const queueCommand = new QueueCommand(logger, config, state, git, github, guard, projectRoot);
    await queueCommand.execute(options);
  });

// Register next command
program
  .command('next')
  .description('Pick the next issue from the queue and initialize pipeline')
  .option('--phase <phase>', 'Filter by phase (e.g., "Phase 1: MVP")')
  .option('--component <component>', 'Filter by component (backend, frontend, fullstack, devnet, node)')
  .action(async (options) => {
    await loadConfig();
    const nextCommand = new NextCommand(logger, config, state, git, github, guard, projectRoot);
    await nextCommand.execute(options);
  });

// Register reset command
program
  .command('reset')
  .description('Abort current pipeline and clean up state')
  .action(async () => {
    await loadConfig();
    const resetCommand = new ResetCommand(logger, config, state, git, github, guard, projectRoot);
    await resetCommand.execute();
  });

// Register rollback command
program
  .command('rollback')
  .description('Completely undo all work for current issue (deletes branch, closes PR, clears state)')
  .option('--no-close-pr', 'Do not close any open PRs')
  .action(async (options) => {
    await loadConfig();
    const rollbackCommand = new RollbackCommand(logger, config, state, git, github, guard, projectRoot);
    await rollbackCommand.execute(options);
  });

// Register implement command
program
  .command('implement')
  .description('Run Claude Code agent to implement the current issue')
  .option('--issue <number>', 'Implement a specific issue number')
  .option('--dry-run', 'Show what would be done without executing')
  .action(async (options) => {
    await loadConfig();
    const implementCommand = new ImplementCommand(logger, config, state, git, github, guard, projectRoot);
    await implementCommand.execute(options);
  });

// Register test command
program
  .command('test')
  .description('Run tests for the current implementation')
  .option('--issue <number>', 'Test a specific issue number (bypasses state)')
  .option('--component <name>', 'Component to test (backend, frontend, devnet, fullstack, node)')
  .action(async (options) => {
    await loadConfig();
    const testCommand = new TestCommand(logger, config, state, git, github, guard, projectRoot);
    await testCommand.execute(options);
  });

// DISABLED: Demo feature disabled for redesign
// // Register demo command
// program
//   .command('demo')
//   .description('Record a demonstration of the implemented feature')
//   .option('--issue <number>', 'Record demo for a specific issue number')
//   .option('--component <name>', 'Component to demo (backend, frontend, devnet, fullstack)')
//   .action(async (options) => {
//     await config.load();
//     logger.setVerbose(config.get().verbose || false);
//     const demoCommand = new DemoCommand(logger, config, state, git, github, guard, projectRoot);
//     await demoCommand.execute(options);
//   });

// Register pr command
program
  .command('pr')
  .description('Create or update pull request for the current issue')
  .option('--issue <number>', 'Create PR for a specific issue number (bypasses state)')
  .option('-c, --comment', 'Provide feedback on a PR with interactive prompt')
  .option('--pr <number>', 'Specify PR number to comment on (auto-detects from branch if not provided)')
  .action(async (options) => {
    await loadConfig();
    const prCommand = new PrCommand(logger, config, state, git, github, guard, projectRoot);
    await prCommand.execute(options);
  });

// Register ship command
program
  .command('ship')
  .description('Run full issue-to-PR pipeline (pick → implement → test → pr → review)')
  .option('--issue <number>', 'Start with a specific issue number')
  .option('--phase <phase>', 'Filter by phase (e.g., "Phase 1: MVP")')
  .option('--component <component>', 'Filter by component (backend, frontend, fullstack, devnet, node)')
  .action(async (options) => {
    await loadConfig();
    const shipCommand = new ShipCommand(logger, config, state, git, github, guard, projectRoot);
    await shipCommand.execute(options);
  });

// Register review command
program
  .command('review')
  .description('Run code review using Claude Code agent')
  .option('--issue <number>', 'Review a specific issue number')
  .option('--pr <number>', 'Review a specific PR number')
  .option('--dry-run', 'Show what would be done without executing')
  .action(async (options) => {
    await loadConfig();
    const reviewCommand = new ReviewCommand(logger, config, state, git, github, guard, projectRoot);
    await reviewCommand.execute(options);
  });

// Register bootstrap command
program
  .command('bootstrap')
  .description('Set up test infrastructure (vitest, testing-library, msw)')
  .option('--component <name>', 'Component to bootstrap (frontend, backend, infra, serverless, node, all)')
  .action(async (options) => {
    await loadConfig();
    const bootstrapCommand = new BootstrapCommand(logger, config, state, git, github, guard, projectRoot);
    await bootstrapCommand.execute(options);
  });

// Register create issue command
program
  .command('create-issue')
  .description('Create a new GitHub issue interactively')
  .action(async () => {
    await loadConfig();
    const createIssueCommand = new CreateIssueCommand(logger, config, state, git, github, guard, projectRoot);
    await createIssueCommand.execute();
  });

// Register setup-labels command
program
  .command('setup-labels')
  .description('Create rig labels on GitHub repo')
  .action(async () => {
    await loadConfig();
    const setupLabelsCommand = new SetupLabelsCommand(logger, config, state, git, github, guard, projectRoot);
    await setupLabelsCommand.execute();
  });

// Register story command
program
  .command('story')
  .description('Decompose a planning spec into atomic GitHub issues')
  .action(async () => {
    await loadConfig();
    const storyCommand = new StoryCommand(logger, config, state, git, github, guard, projectRoot);
    await storyCommand.execute();
  });

program.parse();
