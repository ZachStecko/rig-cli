import {
  AgentCapabilities,
  AgentSession,
  AgentSessionConfig,
  AuthStatus,
} from './types.js';

/**
 * Abstract base class for code agents.
 *
 * Each agent provider (ClaudeCode, Anthropic API, Aider, etc.) extends this class
 * and implements the required methods.
 *
 * This provides a unified interface for working with different AI coding agents
 * while allowing agent-specific features through capabilities and provider options.
 */
export abstract class CodeAgent {
  /**
   * Human-readable name of the agent (e.g., "Claude Code", "Anthropic API").
   */
  abstract readonly name: string;

  /**
   * Capabilities this agent supports.
   *
   * Commands can check capabilities before using agent-specific features.
   */
  abstract readonly capabilities: AgentCapabilities;

  /**
   * Check if the agent is available and ready to use.
   *
   * This should verify:
   * - Agent binary/SDK is installed (for CLI agents)
   * - Authentication is configured
   * - Required environment variables are set
   *
   * @returns Promise resolving to true if agent is available
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * Check authentication status for this agent.
   *
   * @returns Promise resolving to authentication status
   */
  abstract checkAuth(): Promise<AuthStatus>;

  /**
   * Create and start a new agent session.
   *
   * The session runs asynchronously and emits events via the `events` iterator.
   * Use `session.wait()` to wait for completion and get the final result.
   *
   * @param config - Session configuration (prompt, tools, iterations, etc.)
   * @returns Promise resolving to an active AgentSession
   */
  abstract createSession(config: AgentSessionConfig): Promise<AgentSession>;

  /**
   * Simple prompt/response for non-agentic tasks.
   *
   * This is optional - not all agents need to support simple prompting.
   * Use for tasks like issue structuring where you just need a single LLM response.
   *
   * @param prompt - Text prompt to send to agent
   * @returns Promise resolving to agent's text response
   */
  async prompt?(prompt: string): Promise<string>;
}
