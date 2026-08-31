#!/usr/bin/env node
/**
 * rig-cli: GitHub issue filing and PR opening for coding agents.
 *
 * Two jobs: file agent-authored issue files as well-formed GitHub
 * issues, and turn finished branches into pull requests. Content is
 * drafted outside rig — by the user's coding agent, which has the repo
 * context — and rig validates and files it.
 */
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Logger } from './services/logger.service.js';
import { ConfigManager } from './services/config-manager.service.js';
import { GitService } from './services/git.service.js';
import { GitHubService } from './services/github.service.js';
import { GuardService } from './services/guard.service.js';
import { PrCommand } from './commands/pr.command.js';
import { CreateIssueCommand } from './commands/create-issue.command.js';
import { SetupLabelsCommand } from './commands/setup-labels.command.js';
import { StoryCommand } from './commands/story.command.js';
import { GrabCommand } from './commands/grab.command.js';
import { BranchCommand } from './commands/branch.command.js';

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8')
);

const program = new Command();

program
  .name('rig')
  .description('GitHub issue filing and PR opening for coding agents')
  .version(packageJson.version);

// Initialize services
const projectRoot = process.cwd();
const logger = new Logger();
const config = new ConfigManager(projectRoot);
const git = new GitService(projectRoot);
const github = new GitHubService(projectRoot);
const guard = new GuardService(github);

async function loadConfig(): Promise<void> {
  await config.load();
  logger.setVerbose(config.get().verbose || false);
  const baseBranch = config.get().git?.base_branch;
  if (baseBranch) {
    git.setBaseBranch(baseBranch);
  }
}

// Register create-issue command
program
  .command('create-issue')
  .description('File a structured issue file (front-matter labels, H1 title, body) verbatim')
  .option('--file <path>', 'The structured issue file to read (required)')
  .option(
    '--label <label>',
    'Label to apply, in addition to front matter (repeatable)',
    (value: string, previous: string[]) => [...previous, value],
    [] as string[]
  )
  .option('-y, --yes', 'Skip the confirmation prompt')
  .action(async (options: { file?: string; label?: string[]; yes?: boolean }) => {
    await loadConfig();
    const createIssueCommand = new CreateIssueCommand(logger, config, git, github, guard, projectRoot);
    await createIssueCommand.execute(options);
  });

// Register story command
program
  .command('story')
  .description('File a story file: a parent story plus its "## Issue:" child issues')
  .option('--file <path>', 'The story file to read (required)')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(async (options: { file?: string; yes?: boolean }) => {
    await loadConfig();
    const storyCommand = new StoryCommand(logger, config, git, github, guard, projectRoot);
    await storyCommand.execute(options);
  });

// Register grab command
program
  .command('grab')
  .description("Copy an issue's title and body to the clipboard for your coding tool")
  .argument('[issue]', 'Issue number to copy (omit to pick from open issues)')
  .action(async (issueArg?: string) => {
    await loadConfig();
    const grabCommand = new GrabCommand(logger, config, git, github, guard, projectRoot);
    await grabCommand.execute(issueArg);
  });

// Register branch command
program
  .command('branch')
  .description('Create (or switch to) the issue-<n>-<slug> branch off the base branch')
  .argument('<issue>', 'Issue number to branch for')
  .action(async (issueArg: string) => {
    await loadConfig();
    const branchCommand = new BranchCommand(logger, config, git, github, guard, projectRoot);
    await branchCommand.execute(issueArg);
  });

// Register pr command
program
  .command('pr')
  .description('Create or update a pull request for the current branch')
  .option('--issue <number>', 'Linked issue number (default: parsed from branch name)')
  .option('--body-file <path>', 'File whose content becomes the PR body verbatim')
  .action(async (options) => {
    await loadConfig();
    const prCommand = new PrCommand(logger, config, git, github, guard, projectRoot);
    await prCommand.execute(options);
  });

// Register setup-labels command
program
  .command('setup-labels')
  .description('Create rig labels on GitHub repo')
  .action(async () => {
    await loadConfig();
    const setupLabelsCommand = new SetupLabelsCommand(logger, config, git, github, guard, projectRoot);
    await setupLabelsCommand.execute();
  });

// parseAsync so async command actions are awaited; without this, thrown
// errors (e.g. GuardError) become unhandled promise rejections with raw
// stack traces instead of clean messages.
program.parseAsync().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  let verbose = false;
  try {
    verbose = config.get().verbose || false;
  } catch {
    // Config not loaded yet; stay non-verbose.
  }
  if (verbose && error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
