/**
 * Capabilities that a code agent may support.
 */
export interface AgentCapabilities {
  /** Agent supports file operations (read, write, edit) */
  fileOperations: boolean;
  /** Agent supports shell command execution */
  shellExecution: boolean;
  /** Agent supports code search (grep, glob) */
  codeSearch: boolean;
  /** Agent supports structured streaming (JSON events) */
  structuredStreaming: boolean;
  /** Agent supports tool permission control */
  toolPermissions: boolean;
  /** Agent supports iteration/turn limits */
  maxIterations: boolean;
  /** Agent supports web search */
  webSearch: boolean;
}

/**
 * Events emitted during agent execution.
 *
 * Agents emit these events to communicate progress, tool usage, errors, etc.
 */
export type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_use'; tool: string; input: any }
  | { type: 'tool_result'; tool: string; output: any; error?: string }
  | { type: 'error'; message: string; fatal: boolean }
  | { type: 'progress'; step: number; total?: number }
  | { type: 'complete'; success: boolean };

/**
 * Configuration for creating an agent session.
 */
export interface AgentSessionConfig {
  /** Prompt to send to agent */
  prompt: string;
  /** Maximum iterations/turns (if supported by agent) */
  maxIterations?: number;
  /** Tools to allow (if supported by agent) */
  allowedTools?: string[];
  /** Working directory for agent operations */
  workingDirectory?: string;
  /** Log file path for verbose output */
  logFile?: string;
  /** Verbose logging enabled */
  verbose?: boolean;
  /** Agent-specific options (pass-through to implementation) */
  providerOptions?: Record<string, any>;
}

/**
 * A running agent session.
 *
 * Represents an active agent execution with streaming events.
 */
export interface AgentSession {
  /** Session ID for logging/debugging */
  id: string;
  /** Stream of events from the agent */
  events: AsyncIterableIterator<AgentEvent>;
  /** Wait for session completion and get result */
  wait(): Promise<AgentResult>;
  /** Cancel the running session */
  cancel(): Promise<void>;
}

/**
 * Result of a completed agent session.
 */
export interface AgentResult {
  /** Whether the session completed successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** List of files that were modified during session */
  filesChanged: string[];
  /** Optional summary of what was accomplished */
  summary?: string;
}

/**
 * Authentication status for an agent.
 */
export interface AuthStatus {
  /** Whether the agent is authenticated and ready to use */
  authenticated: boolean;
  /** Authentication method used */
  method?: 'subscription' | 'api_key' | 'oauth';
  /** Error message if not authenticated */
  error?: string;
}
