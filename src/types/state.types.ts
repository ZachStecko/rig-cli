/**
 * Pipeline stage names representing the issue-to-PR workflow.
 * Stages execute in order: pick → branch → implement → test → demo → pr → review
 */
export type StageName = 'pick' | 'branch' | 'implement' | 'test' | 'demo' | 'pr' | 'review';

/**
 * Status of a pipeline stage.
 * - pending: Not yet started
 * - in_progress: Currently executing
 * - completed: Successfully finished
 * - failed: Execution failed
 */
export type StageStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/**
 * The canonical order in which pipeline stages execute.
 * Used for stage progression and resume logic.
 */
export const STAGE_ORDER: StageName[] = ['pick', 'branch', 'implement', 'test', 'demo', 'pr', 'review'];

/**
 * Initial state for all stages when creating a new pipeline.
 * All stages start as 'pending'.
 */
export const INITIAL_STAGES: Record<StageName, StageStatus> = {
  pick: 'pending',
  branch: 'pending',
  implement: 'pending',
  test: 'pending',
  demo: 'pending',
  pr: 'pending',
  review: 'pending',
};

/**
 * Pipeline state persisted to .rig-state.json.
 * Tracks the current issue, branch, and progress through the pipeline stages.
 */
export interface PipelineState {
  issue_number: number;
  issue_title: string;
  branch: string;
  stage: StageName;
  stages: Record<StageName, StageStatus>;
}
