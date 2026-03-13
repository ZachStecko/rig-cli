import { exec } from '../utils/shell.js';
import { Logger } from './logger.service.js';
import { ConfigManager } from './config-manager.service.js';
import { TemplateEngine } from './template-engine.service.js';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ComponentType } from '../types/issue.types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * DemoResult represents the outcome of a demo recording.
 */
export interface DemoResult {
  success: boolean;
  output?: string;
  skipped?: boolean;
  demoPath?: string;
}

/**
 * DISABLED: Demo feature disabled for redesign
 *
 * DemoRecorderService orchestrates demo recording using Playwright and VHS.
 *
 * Records frontend demos using Playwright (browser automation) and backend demos
 * using VHS (terminal recording). Stores artifacts in .rig-reviews/issue-N/.
 *
 * NOTE: This service is currently disabled and all demo operations will be skipped.
 */
export class DemoRecorderService {
  private logger: Logger;
  private config: ConfigManager;
  private templateEngine: TemplateEngine;
  private projectRoot: string;

  /**
   * Creates a new DemoRecorderService instance.
   *
   * @param logger - Logger for output
   * @param config - ConfigManager for demo settings
   * @param templateEngine - TemplateEngine for rendering tape files
   * @param projectRoot - Absolute path to project root
   */
  constructor(
    logger: Logger,
    config: ConfigManager,
    templateEngine: TemplateEngine,
    projectRoot: string
  ) {
    this.logger = logger;
    this.config = config;
    this.templateEngine = templateEngine;
    this.projectRoot = projectRoot;
  }

  /**
   * Records frontend demo using Playwright.
   *
   * Looks for issue-specific demo script or falls back to dashboard demo.
   * Playwright must be installed via `rig bootstrap`.
   *
   * @param issueNumber - Issue number for this demo
   * @param _timestamp - Optional timestamp (not used; Playwright handles naming)
   * @returns Demo result with success status
   */
  async recordFrontendDemo(
    issueNumber: number,
    _timestamp?: string
  ): Promise<DemoResult> {
    const demoDir = resolve(this.projectRoot, `.rig-reviews/issue-${issueNumber}`);

    // Ensure demo directory exists
    if (!existsSync(demoDir)) {
      mkdirSync(demoDir, { recursive: true });
    }

    // Check for issue-specific or fallback demo script
    const rigRoot = resolve(__dirname, '../..');
    const demoScript = resolve(rigRoot, `playwright/demos/issue-${issueNumber}.ts`);
    const fallbackScript = resolve(rigRoot, 'playwright/demos/dashboard-demo.ts');

    let scriptToRun: string;

    if (existsSync(demoScript)) {
      scriptToRun = demoScript;
    } else if (existsSync(fallbackScript)) {
      this.logger.warn('No issue-specific Playwright demo. Using fallback dashboard demo.');
      scriptToRun = fallbackScript;
    } else {
      this.logger.warn('No Playwright demo script found. Skipping frontend demo.');
      return { success: true, skipped: true };
    }

    // Check if Playwright is installed
    const playwrightDir = resolve(rigRoot, 'playwright');
    if (!existsSync(resolve(playwrightDir, 'node_modules'))) {
      this.logger.warn("Playwright not installed. Run 'rig bootstrap' first.");
      return { success: true, skipped: true };
    }

    this.logger.info('Recording frontend demo...');

    // Run Playwright demo
    const result = await exec(
      `cd "${playwrightDir}" && DEMO_OUTPUT_DIR="${demoDir}" npx playwright test "${scriptToRun}" --project=demo`
    );

    if (result.exitCode !== 0) {
      this.logger.warn('Playwright demo recording failed (non-fatal)');
      return { success: true, skipped: true, output: result.stderr };
    }

    // Check for video artifacts
    const files = readdirSync(demoDir);
    const hasVideo = files.some(f => f.endsWith('.webm') || f.endsWith('.mp4'));

    if (hasVideo) {
      this.logger.success(`Frontend demo recorded: ${demoDir}/`);
      return { success: true, demoPath: demoDir };
    }

    return { success: true, skipped: true };
  }

  /**
   * Records backend demo using VHS (terminal recorder).
   *
   * Looks for issue-specific tape file or uses template.
   * VHS must be installed: https://github.com/charmbracelet/vhs
   *
   * @param issueNumber - Issue number for this demo
   * @param timestamp - Optional timestamp (defaults to current time)
   * @returns Demo result with success status
   */
  async recordBackendDemo(
    issueNumber: number,
    timestamp?: string
  ): Promise<DemoResult> {
    const ts = timestamp || this.generateTimestamp();
    const demoDir = resolve(this.projectRoot, `.rig-reviews/issue-${issueNumber}`);

    // Ensure demo directory exists
    if (!existsSync(demoDir)) {
      mkdirSync(demoDir, { recursive: true });
    }

    // Check if VHS is available
    const vhsCheck = await exec('which vhs');
    if (vhsCheck.exitCode !== 0) {
      this.logger.warn('VHS not installed. Skipping terminal demo.');
      this.logger.dim('Install: https://github.com/charmbracelet/vhs');
      return { success: true, skipped: true };
    }

    // Check for issue-specific tape file
    const rigRoot = resolve(__dirname, '../..');
    const tapeFile = resolve(rigRoot, `templates/demo-issue-${issueNumber}.tape`);
    const templateTape = resolve(rigRoot, 'src/templates/demo-backend.tape');

    let tapeToRun: string;

    if (existsSync(tapeFile)) {
      tapeToRun = tapeFile;
    } else if (existsSync(templateTape)) {
      // Generate from template with variable substitution
      const tapeTmp = resolve(demoDir, `demo-${ts}.tape`);
      const template = await readFile(templateTape, 'utf-8');
      const rendered = this.templateEngine.render(template, { issue_number: issueNumber });
      writeFileSync(tapeTmp, rendered, 'utf-8');
      tapeToRun = tapeTmp;
    } else {
      this.logger.warn('No VHS tape file found. Skipping terminal demo.');
      return { success: true, skipped: true };
    }

    this.logger.info('Recording terminal demo with VHS...');

    const outputGif = resolve(demoDir, `demo-${ts}.gif`);
    const result = await exec(`cd "${this.projectRoot}" && vhs "${tapeToRun}" -o "${outputGif}"`);

    if (result.exitCode !== 0) {
      this.logger.warn('VHS demo recording failed (non-fatal)');
      return { success: true, skipped: true, output: result.stderr };
    }

    if (existsSync(outputGif)) {
      this.logger.success(`Terminal demo recorded: ${outputGif}`);
      return { success: true, demoPath: outputGif };
    }

    return { success: true, skipped: true };
  }

  /**
   * Records demo based on component type.
   *
   * - frontend: Records Playwright demo only
   * - backend: Records VHS terminal demo only
   * - fullstack: Records both
   * - devnet: No demos recorded (returns skipped)
   *
   * Respects demo.enabled config setting.
   *
   * @param issueNumber - Issue number for this demo
   * @param component - Component type
   * @returns Demo result with success status
   */
  async recordDemo(issueNumber: number, component: ComponentType): Promise<DemoResult> {
    // DISABLED: Demo feature disabled for redesign - always skip
    this.logger.dim('Demo recording disabled - feature being redesigned');
    return { success: true, skipped: true };

    // const config = this.config.get();
    // if (config.demo?.enabled === false) {
    //   this.logger.dim('Demo recording disabled (demo.enabled: false)');
    //   return { success: true, skipped: true };
    // }

    const results: DemoResult[] = [];

    if (component === 'frontend' || component === 'fullstack') {
      results.push(await this.recordFrontendDemo(issueNumber));
    }

    if (component === 'backend' || component === 'fullstack') {
      results.push(await this.recordBackendDemo(issueNumber));
    }

    // Aggregate results
    const allSuccess = results.every(r => r.success);
    const allSkipped = results.every(r => r.skipped);
    const demoPaths = results.map(r => r.demoPath).filter(Boolean);

    return {
      success: allSuccess,
      skipped: allSkipped,
      demoPath: demoPaths[0], // Return first demo path if any
    };
  }

  /**
   * Gets path to demo directory for a given issue.
   *
   * Only returns path if directory exists and contains demo-*.gif files.
   *
   * @param issueNumber - Issue number to check
   * @returns Demo directory path or null if no demos exist
   */
  getDemoPath(issueNumber: number): string | null {
    const demoDir = resolve(this.projectRoot, `.rig-reviews/issue-${issueNumber}`);

    if (!existsSync(demoDir)) {
      return null;
    }

    try {
      const files = readdirSync(demoDir);
      const hasGif = files.some(f => f.startsWith('demo-') && f.endsWith('.gif'));
      return hasGif ? demoDir : null;
    } catch {
      return null;
    }
  }

  /**
   * Generates timestamp string in format YYYY-MM-DD-HHMMSS.
   *
   * @private
   * @returns Timestamp string
   */
  private generateTimestamp(): string {
    return new Date()
      .toISOString()
      .replace(/:/g, '')
      .replace(/\..+/, '')
      .replace('T', '-');
  }
}
