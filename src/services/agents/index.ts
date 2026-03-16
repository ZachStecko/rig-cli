/**
 * Agent abstraction layer for rig-cli.
 *
 * This module provides a unified interface for working with different AI coding agents.
 */

export { CodeAgent } from './base.agent.js';
export { ClaudeSdkAgent } from './claude-sdk.agent.js';
export { ClaudeBinaryAgent } from './claude-binary.agent.js';
export { ClaudeSdkAgent as ClaudeCodeAgent } from './claude-sdk.agent.js';
export { createAgent } from './agent-factory.js';
export type {
  AgentCapabilities,
  AgentEvent,
  AgentResult,
  AgentSession,
  AgentSessionConfig,
  AuthStatus,
} from './types.js';
