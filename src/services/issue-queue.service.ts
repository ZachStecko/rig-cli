import { GitHubService } from './github.service.js';
import { Issue, ScoredIssue } from '../types/issue.types.js';

/**
 * Options for fetching and filtering issues.
 */
export interface FetchOptions {
  /** Filter by phase label (e.g., "Phase 1: MVP") */
  phase?: string;
  /** Filter by component label (e.g., "backend", "frontend") */
  component?: string;
}

/**
 * IssueQueueService fetches, filters, scores, and sorts GitHub issues.
 *
 * Scoring formula: phaseScore * 10000 + priorityScore * 1000 + issueNumber
 * - Lower phase numbers score higher (Phase 1 > Phase 2 > Phase 3)
 * - Higher priorities score higher (p0 > p1 > p2)
 * - Lower issue numbers score higher within same phase+priority
 *
 * This is a pure TypeScript port of the Python scoring logic from harbourflow.
 */
export class IssueQueueService {
  private github: GitHubService;

  /**
   * Creates a new IssueQueueService instance.
   *
   * @param github - GitHubService instance for fetching issues
   */
  constructor(github: GitHubService) {
    this.github = github;
  }

  /**
   * Fetches issues from GitHub, applies filters, scores, and sorts them.
   *
   * Filters applied:
   * - Excludes issues labeled "epic" or "Epic"
   * - Filters by phase if specified (e.g., "Phase 1: MVP")
   * - Filters by component if specified (e.g., "backend", "frontend")
   *
   * @param options - Filter options (phase, component)
   * @returns Array of scored issues, sorted by score (highest first)
   */
  async fetch(options: FetchOptions = {}): Promise<ScoredIssue[]> {
    // Fetch all open issues
    const issues = await this.github.listIssues({ state: 'open' });

    // Filter and score issues
    const scoredIssues = issues
      .filter(issue => this.applyFilters(issue, options))
      .map(issue => this.scoreIssue(issue));

    // Sort by score descending (highest score first)
    scoredIssues.sort((a, b) => b.score - a.score);

    return scoredIssues;
  }

  /**
   * Fetches issues and returns the first one without an open PR.
   *
   * @param options - Filter options (phase, component)
   * @returns First issue without an open PR, or null if none found
   */
  async next(options: FetchOptions = {}): Promise<ScoredIssue | null> {
    const issues = await this.fetch(options);

    // Find first issue without an open PR
    for (const issue of issues) {
      const hasOpenPr = await this.github.hasOpenPr(issue.number);
      if (!hasOpenPr) {
        return issue;
      }
    }

    return null;
  }

  /**
   * Applies filters to an issue.
   *
   * @private
   * @param issue - Issue to filter
   * @param options - Filter options
   * @returns true if issue passes all filters, false otherwise
   */
  private applyFilters(issue: Issue, options: FetchOptions): boolean {
    const labelNames = issue.labels.map(l => l.name);

    // Exclude epics
    if (this.isEpic(labelNames)) {
      return false;
    }

    // Apply phase filter
    if (options.phase && !this.hasPhase(labelNames, options.phase)) {
      return false;
    }

    // Apply component filter
    if (options.component && !this.hasComponent(labelNames, options.component)) {
      return false;
    }

    return true;
  }

  /**
   * Checks if issue is an epic.
   *
   * @private
   * @param labels - Array of label names
   * @returns true if issue has "epic" or "Epic" label
   */
  private isEpic(labels: string[]): boolean {
    return labels.some(label => label.toLowerCase() === 'epic');
  }

  /**
   * Checks if issue has the specified phase.
   *
   * @private
   * @param labels - Array of label names
   * @param phase - Phase to match (e.g., "Phase 1: MVP")
   * @returns true if issue has matching phase label
   */
  private hasPhase(labels: string[], phase: string): boolean {
    return labels.some(label => label === phase);
  }

  /**
   * Checks if issue has the specified component.
   *
   * @private
   * @param labels - Array of label names
   * @param component - Component to match (e.g., "backend")
   * @returns true if issue has matching component label
   */
  private hasComponent(labels: string[], component: string): boolean {
    return labels.some(label => label.toLowerCase() === component.toLowerCase());
  }

  /**
   * Scores an issue based on phase, priority, and issue number.
   *
   * Formula: phaseScore * 10000 + priorityScore * 1000 - issueNumber
   * Note: Issue number is SUBTRACTED so lower numbers score higher
   *
   * @private
   * @param issue - Issue to score
   * @returns Scored issue with computed score
   */
  private scoreIssue(issue: Issue): ScoredIssue {
    const labelNames = issue.labels.map(l => l.name);
    const phaseScore = this.getPhaseScore(labelNames);
    const priorityScore = this.getPriorityScore(labelNames);

    const score = phaseScore * 10000 + priorityScore * 1000 - issue.number;

    return {
      number: issue.number,
      title: issue.title,
      labels: labelNames,
      score,
    };
  }

  /**
   * Extracts phase score from labels.
   *
   * Phase format: "Phase N: Description" where N is 1, 2, 3, etc.
   * Lower phase numbers get higher scores (Phase 1 = 100, Phase 2 = 99, etc.)
   *
   * @private
   * @param labels - Array of label names
   * @returns Phase score (100 - phaseNumber), or 0 if no phase label
   */
  private getPhaseScore(labels: string[]): number {
    const phaseLabel = labels.find(label => label.startsWith('Phase '));
    if (!phaseLabel) {
      return 0;
    }

    // Extract phase number from "Phase N: Description"
    const match = phaseLabel.match(/^Phase (\d+)/);
    if (!match) {
      return 0;
    }

    const phaseNumber = parseInt(match[1], 10);
    // Lower phase numbers get higher scores
    return 100 - phaseNumber;
  }

  /**
   * Extracts priority score from labels.
   *
   * Priority labels: p0, p1, p2
   * p0 = 3, p1 = 2, p2 = 1, none = 0
   *
   * @private
   * @param labels - Array of label names
   * @returns Priority score
   */
  private getPriorityScore(labels: string[]): number {
    if (labels.includes('p0')) {
      return 3;
    }
    if (labels.includes('p1')) {
      return 2;
    }
    if (labels.includes('p2')) {
      return 1;
    }
    return 0;
  }
}
