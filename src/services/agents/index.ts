/**
 * Agent abstraction layer for rig-cli.
 *
 * This module provides a unified interface for working with different AI coding agents.
 */

export { CodeAgent } from './base.agent.js';
export { ClaudeCodeAgent } from './claude-code.agent.js';
export type {
  AgentCapabilities,
  AgentEvent,
  AgentResult,
  AgentSession,
  AgentSessionConfig,
  AuthStatus,
} from './types.js';
