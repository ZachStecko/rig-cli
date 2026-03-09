#!/usr/bin/env node
/**
 * rig-cli: Automated issue-to-PR pipeline using Claude Code
 *
 * This is the main entry point for the CLI. Commands will be registered here
 * as they are implemented.
 */
import { Command } from 'commander';

const program = new Command();

program
  .name('rig')
  .description('Automated issue-to-PR pipeline using Claude Code')
  .version('0.1.0');

program.parse();
