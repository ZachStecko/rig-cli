/**
 * Overall verdict from the review agent.
 * - PASS: Changes are acceptable
 * - CONTESTED: Some concerns but not blocking
 * - REJECT: Changes must be addressed
 * - UNKNOWN: Unable to determine verdict
 */
export type ReviewVerdict = 'PASS' | 'CONTESTED' | 'REJECT' | 'UNKNOWN';

/**
 * Severity level of a review finding.
 */
export type ReviewSeverity = 'high' | 'medium' | 'low';

/**
 * A single issue found during code review.
 * Parsed from the review agent's markdown output.
 */
export interface ReviewFinding {
  severity: ReviewSeverity;
  description: string;
  lens?: string;
  principle?: string;
  recommendation?: string;
}

/**
 * User decision on how to handle a review finding.
 * - fix: Run the fix agent to address this finding
 * - skip: Ignore this finding and move on
 */
export type TriageDecision = 'fix' | 'skip';

/**
 * A review finding with a user's triage decision attached.
 * Used after interactive triage to track which findings to fix.
 */
export interface TriagedFinding extends ReviewFinding {
  decision: TriageDecision;
}
