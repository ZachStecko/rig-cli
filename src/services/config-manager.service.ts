import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';
import { readFileIfExists } from '../utils/file.js';
import { RigConfig, DEFAULT_CONFIG } from '../types/config.types.js';

/**
 * ConfigManager service for loading and managing .rig.yml configuration.
 *
 * Configuration is loaded from .rig.yml in the project root and deep-merged
 * with DEFAULT_CONFIG. Missing files or invalid YAML fall back to defaults.
 *
 * Users can override individual fields without providing a complete config:
 * ```yaml
 * agent:
 *   max_turns: 100
 * ```
 * This overrides only agent.max_turns while keeping all other defaults.
 */
export class ConfigManager {
  private projectRoot: string;
  private config: RigConfig | null = null;

  /**
   * Creates a new ConfigManager instance.
   *
   * @param projectRoot - Absolute path to the project root directory
   */
  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Loads configuration from .rig.yml and merges with defaults.
   * Caches the result for subsequent calls.
   *
   * @returns Merged configuration object (deep cloned to prevent mutations)
   */
  async load(): Promise<RigConfig> {
    // Return cached config if already loaded (cloned to prevent mutation)
    if (this.config) {
      return structuredClone(this.config);
    }

    const configPath = resolve(this.projectRoot, '.rig.yml');
    const fileContent = await readFileIfExists(configPath);

    // No config file found, use defaults (clone to prevent mutation of DEFAULT_CONFIG)
    if (!fileContent) {
      this.config = structuredClone(DEFAULT_CONFIG);
      return structuredClone(this.config);
    }

    try {
      // Parse YAML and merge with defaults
      const userConfig = parseYaml(fileContent) as Partial<RigConfig>;
      this.config = this.deepMerge(DEFAULT_CONFIG, userConfig || {});
      return structuredClone(this.config);
    } catch (error) {
      // Invalid YAML, fall back to defaults (clone to prevent mutation)
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`Warning: Failed to parse .rig.yml: ${errorMessage}. Using defaults.`);
      this.config = structuredClone(DEFAULT_CONFIG);
      return structuredClone(this.config);
    }
  }

  /**
   * Gets the loaded configuration. Throws if load() hasn't been called yet.
   *
   * @returns The merged configuration (deep cloned to prevent mutations)
   * @throws Error if configuration hasn't been loaded
   */
  get(): RigConfig {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call load() first.');
    }
    return structuredClone(this.config);
  }

  /**
   * Gets the agent configuration section.
   *
   * @returns Agent configuration
   */
  getAgent() {
    return this.get().agent;
  }

  /**
   * Gets the queue configuration section.
   *
   * @returns Queue configuration
   */
  getQueue() {
    return this.get().queue;
  }

  /**
   * Gets the test configuration section.
   *
   * @returns Test configuration
   */
  getTest() {
    return this.get().test;
  }

  // DISABLED: Demo feature disabled for redesign
  // /**
  //  * Gets the demo configuration section.
  //  *
  //  * @returns Demo configuration
  //  */
  // getDemo() {
  //   return this.get().demo;
  // }

  /**
   * Gets the PR configuration section.
   *
   * @returns PR configuration
   */
  getPr() {
    return this.get().pr;
  }

  /**
   * Deep merges two configuration objects.
   * User values override defaults at the field level.
   *
   * @private
   * @param defaults - Default configuration object
   * @param overrides - User-provided overrides
   * @returns Merged configuration
   *
   * @example
   * deepMerge(
   *   { agent: { max_turns: 80 }, queue: { default_phase: null } },
   *   { agent: { max_turns: 100 } }
   * )
   * // Returns: { agent: { max_turns: 100 }, queue: { default_phase: null } }
   */
  private deepMerge<T extends Record<string, any>>(
    defaults: T,
    overrides: Partial<T>
  ): T {
    const result = { ...defaults };

    for (const key in overrides) {
      const overrideValue = overrides[key];
      const defaultValue = defaults[key];

      // If both are plain objects, recurse
      if (
        overrideValue &&
        typeof overrideValue === 'object' &&
        !Array.isArray(overrideValue) &&
        defaultValue &&
        typeof defaultValue === 'object' &&
        !Array.isArray(defaultValue)
      ) {
        result[key] = this.deepMerge(defaultValue, overrideValue);
      } else if (overrideValue !== undefined) {
        // Otherwise, override takes precedence
        result[key] = overrideValue as T[Extract<keyof T, string>];
      }
    }

    return result;
  }
}
