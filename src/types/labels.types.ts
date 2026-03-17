/**
 * Label definitions for GitHub issues.
 * This file serves as the single source of truth for all labels used in the rig-cli system.
 */

/**
 * Component labels - indicate which part of the system an issue affects
 */
export const COMPONENT_LABELS = {
  BACKEND: 'backend',
  FRONTEND: 'frontend',
  FULLSTACK: 'fullstack',
  DEVNET: 'devnet',
  NODE: 'node',
  INFRA: 'infra',
  SERVERLESS: 'serverless',
} as const;

/**
 * Priority labels - indicate urgency/importance
 */
export const PRIORITY_LABELS = {
  P0: 'P0',
  P1: 'P1',
  P2: 'P2',
  P3: 'P3',
  P4: 'P4',
} as const;

/**
 * Phase labels - indicate project phase
 */
export const PHASE_LABELS = {
  PHASE_1_MVP: 'Phase 1: MVP',
  PHASE_2_ENHANCEMENT: 'Phase 2: Enhancement',
  PHASE_3_POLISH: 'Phase 3: Polish',
} as const;

/**
 * Type labels - indicate the kind of work
 */
export const TYPE_LABELS = {
  BUG: 'bug',
  ENHANCEMENT: 'enhancement',
  FEATURE: 'feature',
  REFACTOR: 'refactor',
  DOCS: 'docs',
  CHORE: 'chore',
  TEST: 'test',
} as const;

/**
 * Status labels - indicate workflow state
 */
export const STATUS_LABELS = {
  NEEDS_TRIAGE: 'needs-triage',
  NEEDS_REVIEW: 'needs-review',
  IN_PROGRESS: 'in-progress',
  BLOCKED: 'blocked',
  READY: 'ready',
} as const;

/**
 * Special labels - rig-specific markers
 */
export const SPECIAL_LABELS = {
  RIG_GENERATED: 'rig-generated',
  RIG_CREATED: 'rig-created',
} as const;

/**
 * All label constants grouped together
 */
export const ALL_LABELS = {
  ...COMPONENT_LABELS,
  ...PRIORITY_LABELS,
  ...PHASE_LABELS,
  ...TYPE_LABELS,
  ...STATUS_LABELS,
  ...SPECIAL_LABELS,
} as const;

/**
 * Union type of all valid label values
 */
export type ValidLabel = (typeof ALL_LABELS)[keyof typeof ALL_LABELS];

/**
 * Helper function to check if a string is a valid label
 */
export function isValidLabel(label: string): label is ValidLabel {
  return Object.values(ALL_LABELS).includes(label as ValidLabel);
}

/**
 * Helper function to get all valid label values as an array
 */
export function getAllValidLabels(): ValidLabel[] {
  return Object.values(ALL_LABELS);
}
