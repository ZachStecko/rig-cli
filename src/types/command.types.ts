/** Options for the 'queue' command (list available issues) */
export interface QueueOptions {
  phase?: string;
  component?: string;
}

/** Options for the 'next' command (pick next issue and create branch) */
export interface NextOptions {
  phase?: string;
  component?: string;
}

/** Options for the 'implement' command (run Claude agent on issue) */
export interface ImplementOptions {
  issue?: number;
  dryRun?: boolean;
}

/** Options for the 'test' command (run tests for component) */
export interface TestOptions {
  component?: string;
}

/** Options for the 'demo' command (record demo for issue) */
export interface DemoOptions {
  issue?: number;
  component?: string;
}

/** Options for the 'ship' command (full pipeline orchestration) */
export interface ShipOptions {
  issue?: number;
  phase?: string;
  component?: string;
}

/** Options for the 'review' command (run code review agent) */
export interface ReviewOptions {
  issue?: number;
  pr?: number;
  dryRun?: boolean;
}

/** Options for the 'reset' command (clear pipeline state) */
export interface ResetOptions {}

/** Options for the 'status' command (display current pipeline status) */
export interface StatusOptions {}

/** Options for the 'bootstrap' command (install test infrastructure) */
export interface BootstrapOptions {}
