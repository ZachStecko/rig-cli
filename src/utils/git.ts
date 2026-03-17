import { exec } from './shell.js';

/**
 * Result of auto-commit operation for .rig-state.json file.
 */
export interface AutoCommitResult {
  committed: boolean;
  message?: string;
}

/**
 * Automatically commits .rig-state.json if it has uncommitted changes.
 *
 * This function ensures state tracking updates are persisted to git history,
 * preventing state inconsistencies when switching branches or resetting the repo.
 *
 * Behavior:
 * - Checks if .rig-state.json has uncommitted changes
 * - If yes and not in .gitignore: stages and commits with conventional message
 * - If yes but in .gitignore: warns user (returns result with warning message)
 * - If no changes: no-op (returns result indicating no commit needed)
 *
 * Error handling:
 * - If git is not initialized: throws descriptive error
 * - If git user config missing: throws descriptive error
 * - If detached HEAD or other git issues: throws descriptive error
 * - Only stages .rig-state.json, never other modified files
 *
 * @param projectRoot - Absolute path to the git repository root
 * @returns Promise resolving to result object with committed flag and optional message
 * @throws Error if git is not configured properly or repository is in invalid state
 *
 * @example
 * const result = await autoCommitRigState('/path/to/project');
 * if (result.committed) {
 *   console.log('State committed successfully');
 * } else if (result.message) {
 *   console.warn(result.message);
 * }
 */
export async function autoCommitRigState(projectRoot: string): Promise<AutoCommitResult> {
  const stateFile = '.rig-state.json';

  const gitCmd = (cmd: string) => exec(`git -C "${projectRoot}" ${cmd}`);

  const statusCheck = await gitCmd('rev-parse --git-dir');
  if (statusCheck.exitCode !== 0) {
    throw new Error(
      'Git repository not initialized. Run "git init" first.\n' +
      `Error: ${statusCheck.stderr.trim()}`
    );
  }

  const userCheck = await gitCmd('config user.name');
  if (userCheck.exitCode !== 0 || !userCheck.stdout.trim()) {
    throw new Error(
      'Git user.name not configured. Run:\n' +
      '  git config user.name "Your Name"\n' +
      '  git config user.email "your@email.com"'
    );
  }

  const emailCheck = await gitCmd('config user.email');
  if (emailCheck.exitCode !== 0 || !emailCheck.stdout.trim()) {
    throw new Error(
      'Git user.email not configured. Run:\n' +
      '  git config user.email "your@email.com"'
    );
  }

  const headCheck = await gitCmd('symbolic-ref -q HEAD');
  if (headCheck.exitCode !== 0) {
    throw new Error(
      'Repository is in detached HEAD state. Cannot auto-commit.\n' +
      'Checkout a branch first: git checkout <branch-name>'
    );
  }

  const statusResult = await gitCmd(`status --porcelain ${stateFile}`);
  if (statusResult.exitCode !== 0) {
    throw new Error(`Failed to check git status: ${statusResult.stderr.trim()}`);
  }

  if (!statusResult.stdout.trim()) {
    return { committed: false };
  }

  const addResult = await gitCmd(`add ${stateFile}`);
  if (addResult.exitCode !== 0) {
    if (addResult.stderr.includes('ignored') || addResult.stderr.includes('.gitignore')) {
      return {
        committed: false,
        message: `Warning: ${stateFile} is in .gitignore and will not be committed.\n` +
                 'State tracking will not persist across branch switches.\n' +
                 `Consider removing ${stateFile} from .gitignore if you want to track pipeline state in git.`
      };
    }
    throw new Error(`Failed to stage ${stateFile}: ${addResult.stderr.trim()}`);
  }

  const statusAfterAdd = await gitCmd(`diff --cached --name-only ${stateFile}`);
  if (!statusAfterAdd.stdout.trim()) {
    return {
      committed: false,
      message: `Warning: ${stateFile} could not be staged (likely in .gitignore).\n` +
               'State tracking will not persist across branch switches.\n' +
               `Consider removing ${stateFile} from .gitignore if you want to track pipeline state in git.`
    };
  }

  const commitMessage = 'chore: update .rig-state after review';
  const commitResult = await gitCmd(`commit -m "${commitMessage}"`);
  if (commitResult.exitCode !== 0) {
    if (commitResult.stdout.includes('nothing to commit')) {
      return { committed: false };
    }
    throw new Error(`Failed to commit ${stateFile}: ${commitResult.stderr.trim()}`);
  }

  return { committed: true };
}
