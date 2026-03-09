import { resolve } from 'path';
import { readFile, writeFile, unlink } from 'fs/promises';
import { fileExists, ensureDir } from '../utils/file.js';
import { PipelineState, StageName, StageStatus } from '../types/state.types.js';

/**
 * StateManager service for managing .rig-state.json pipeline state.
 *
 * The state file tracks the current issue, branch, and progress through
 * the pipeline stages. Supporting directories (.rig-logs/, .rig-demos/,
 * .rig-reviews/) are created as needed.
 *
 * All read methods return deep clones to prevent accidental mutations.
 */
export class StateManager {
  private projectRoot: string;
  private statePath: string;

  /**
   * Creates a new StateManager instance.
   *
   * @param projectRoot - Absolute path to the project root directory
   */
  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.statePath = resolve(projectRoot, '.rig-state.json');
  }

  /**
   * Checks if the state file exists.
   *
   * @returns true if .rig-state.json exists, false otherwise
   */
  async exists(): Promise<boolean> {
    return await fileExists(this.statePath);
  }

  /**
   * Reads the current pipeline state.
   *
   * @returns The pipeline state (deep cloned to prevent mutations)
   * @throws Error if state file doesn't exist or contains invalid JSON
   */
  async read(): Promise<PipelineState> {
    const content = await readFile(this.statePath, 'utf-8');
    const state = JSON.parse(content) as PipelineState;
    return structuredClone(state);
  }

  /**
   * Reads a specific field from the pipeline state.
   *
   * @param field - The field name to read
   * @returns The field value (deep cloned to prevent mutations)
   * @throws Error if state file doesn't exist or contains invalid JSON
   *
   * @example
   * const issueNumber = await manager.readField('issue_number');
   * const branch = await manager.readField('branch');
   */
  async readField<K extends keyof PipelineState>(field: K): Promise<PipelineState[K]> {
    const state = await this.read();
    return state[field];
  }

  /**
   * Writes pipeline state to .rig-state.json.
   *
   * @param state - The pipeline state to write
   * @throws Error if write fails
   */
  async write(state: PipelineState): Promise<void> {
    const content = JSON.stringify(state, null, 2);
    await writeFile(this.statePath, content, 'utf-8');
  }

  /**
   * Updates the status of a specific pipeline stage.
   * Reads current state, updates the specified stage, and writes back.
   *
   * @param stageName - The stage to update
   * @param status - The new status for the stage
   * @throws Error if state file doesn't exist or write fails
   *
   * @example
   * await manager.updateStage('implement', 'in_progress');
   * await manager.updateStage('test', 'completed');
   */
  async updateStage(stageName: StageName, status: StageStatus): Promise<void> {
    const state = await this.read();
    state.stages[stageName] = status;

    // If marking a stage as in_progress or completed, update the current stage
    if (status === 'in_progress' || status === 'completed') {
      state.stage = stageName;
    }

    await this.write(state);
  }

  /**
   * Deletes the state file.
   * No error if file doesn't exist (idempotent).
   *
   * @throws Error if deletion fails for reasons other than file not existing
   */
  async delete(): Promise<void> {
    try {
      await unlink(this.statePath);
    } catch (error: any) {
      // Ignore if file doesn't exist
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Ensures supporting directories exist.
   * Creates .rig-logs/, .rig-demos/, and .rig-reviews/ directories
   * in the project root. Idempotent - safe to call multiple times.
   *
   * @throws Error if directory creation fails
   */
  async ensureDirs(): Promise<void> {
    await ensureDir(resolve(this.projectRoot, '.rig-logs'));
    await ensureDir(resolve(this.projectRoot, '.rig-demos'));
    await ensureDir(resolve(this.projectRoot, '.rig-reviews'));
  }

  /**
   * Gets the path to the state file.
   * Useful for logging or debugging.
   *
   * @returns Absolute path to .rig-state.json
   */
  getStatePath(): string {
    return this.statePath;
  }
}
