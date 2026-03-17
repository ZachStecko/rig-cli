/**
 * GitHub issue label structure.
 */
export interface IssueLabel {
  name: string;
}

/**
 * GitHub issue data structure.
 * Fetched from the GitHub API via the gh CLI.
 */
export interface Issue {
  number: number;
  title: string;
  body?: string;
  labels: IssueLabel[];
  assignees?: { login: string }[];
  state?: 'OPEN' | 'CLOSED';
}

/**
 * Issue with computed priority score.
 * Score formula: phaseScore * 10000 + priorityScore * 1000 + issueNumber
 * - Phase 1 scores highest, then Phase 2, etc.
 * - Within a phase, higher priority scores higher (p0 > p1 > p2)
 * - Within same phase+priority, lower issue numbers score higher
 */
export interface ScoredIssue {
  number: number;
  title: string;
  labels: string[];
  score: number;
}

/**
 * Component type detected from issue labels.
 * Used to determine which tests to run and which demo to record.
 */
export type ComponentType = 'backend' | 'frontend' | 'devnet' | 'fullstack' | 'node';
