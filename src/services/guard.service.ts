import { GitHubService } from './github.service.js';
import { GuardError } from '../types/error.types.js';

/**
 * GuardService validates preconditions before operations.
 *
 * All `require*` methods throw GuardError on failure.
 * This allows callers to catch and handle failures without process.exit.
 *
 * Takes service dependencies via constructor for testability.
 */
export class GuardService {
  private github: GitHubService;

  /**
   * Creates a new GuardService instance.
   *
   * @param github - GitHubService instance for GitHub operations
   */
  constructor(github: GitHubService) {
    this.github = github;
  }

  /**
   * Requires that the GitHub CLI (gh) is installed and authenticated.
   *
   * @throws GuardError if gh is not installed or not authenticated
   */
  async requireGhAuth(): Promise<void> {
    const isInstalled = await this.github.isInstalled();
    if (!isInstalled) {
      throw new GuardError(
        'GitHub CLI (gh) is not installed. Install it from: https://cli.github.com/'
      );
    }

    const isAuthenticated = await this.github.isAuthenticated();
    if (!isAuthenticated) {
      throw new GuardError(
        'GitHub CLI (gh) is not authenticated. Run: gh auth login'
      );
    }
  }
}
