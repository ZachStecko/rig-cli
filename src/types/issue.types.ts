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
