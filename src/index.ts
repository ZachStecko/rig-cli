#!/usr/bin/env node
/**
 * rig-cli: Automated issue-to-PR pipeline using Claude Code
 *
 * This is the main entry point for the CLI. Commands will be registered here
 * as they are implemented.
 */
import { Command } from 'commander';
import { Logger } from './services/logger.service.js';
import { ConfigManager } from './services/config-manager.service.js';
import { StateManager } from './services/state-manager.service.js';
import { GitService } from './services/git.service.js';
import { GitHubService } from './services/github.service.js';
import { GuardService } from './services/guard.service.js';
import { StatusCommand } from './commands/status.command.js';
import { QueueCommand } from './commands/queue.command.js';

const program = new Command();

program
  .name('rig')
  .description('Automated issue-to-PR pipeline using Claude Code')
  .version('0.1.0');

// Initialize services
const projectRoot = process.cwd();
const logger = new Logger();
const config = new ConfigManager(projectRoot);
const state = new StateManager(projectRoot);
const git = new GitService(projectRoot);
const github = new GitHubService(projectRoot);
const guard = new GuardService(git, github, state);

// Register status command
program
  .command('status')
  .description('Display current pipeline status')
  .action(async () => {
    const statusCommand = new StatusCommand(logger, config, state, git, github, guard, projectRoot);
    await statusCommand.execute();
  });

// Register queue command
program
  .command('queue')
  .description('Display prioritized issue backlog')
  .option('--phase <phase>', 'Filter by phase (e.g., "Phase 1: MVP")')
  .option('--component <component>', 'Filter by component (backend, frontend, fullstack, devnet)')
  .action(async (options) => {
    const queueCommand = new QueueCommand(logger, config, state, git, github, guard, projectRoot);
    await queueCommand.execute(options);
  });

program.parse();
