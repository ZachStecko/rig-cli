# Agent Abstraction Layer

This module provides a unified interface for working with different AI coding agents in rig-cli.

## Architecture

The agent abstraction layer consists of three main components:

### 1. Types (`types.ts`)

Defines the core interfaces and types used across all agents:

- **`AgentCapabilities`**: Declares what features an agent supports (file operations, shell execution, web search, etc.)
- **`AgentEvent`**: Union type for all events emitted during agent execution (text, thinking, tool_use, tool_result, error, progress, complete)
- **`AgentSessionConfig`**: Configuration for creating a new agent session
- **`AgentSession`**: Represents a running agent session with streaming events
- **`AgentResult`**: Final result after session completion
- **`AuthStatus`**: Authentication status for an agent

### 2. Base Agent (`base.agent.ts`)

Abstract base class that all agent implementations must extend:

```typescript
export abstract class CodeAgent {
  abstract readonly name: string;
  abstract readonly capabilities: AgentCapabilities;
  abstract isAvailable(): Promise<boolean>;
  abstract checkAuth(): Promise<AuthStatus>;
  abstract createSession(config: AgentSessionConfig): Promise<AgentSession>;
  async prompt?(prompt: string): Promise<string>;
}
```

### 3. Concrete Implementations

Each AI coding agent (Claude Code, Anthropic API, Aider, etc.) implements the `CodeAgent` interface.

## Current Implementations

### Claude Code Agent (`claude-code.agent.ts`)

Wraps the Claude Code CLI (`claude` command) for agentic coding sessions.

**Capabilities**:
- ✅ File operations (Read, Write, Edit)
- ✅ Shell execution (Bash)
- ✅ Code search (Grep, Glob)
- ✅ Structured streaming (JSON events)
- ✅ Tool permissions
- ✅ Iteration limits
- ✅ Web search

**Key Features**:
- Streams events in real-time via async iterator
- Detects file changes via git diff
- Supports permission modes (bypass, accept edits, plan, etc.)
- Handles process lifecycle (graceful termination, timeout, kill)
- Validates and sanitizes inputs

**Usage**:
```typescript
const agent = new ClaudeCodeAgent();

// Check availability
if (await agent.isAvailable()) {
  // Create session
  const session = await agent.createSession({
    prompt: 'Fix the bug in auth.ts',
    maxIterations: 50,
    allowedTools: ['Read', 'Edit', 'Bash'],
    workingDirectory: '/path/to/project',
  });

  // Stream events
  for await (const event of session.events) {
    if (event.type === 'text') {
      console.log(event.content);
    } else if (event.type === 'tool_use') {
      console.log(`Using tool: ${event.tool}`);
    }
  }

  // Wait for completion
  const result = await session.wait();
  console.log(`Files changed: ${result.filesChanged.join(', ')}`);
}
```

## Adding a New Agent

To add support for a new AI coding agent:

### 1. Create Agent Implementation

Create a new file `your-agent.agent.ts`:

```typescript
import { CodeAgent } from './base.agent.js';
import {
  AgentCapabilities,
  AgentSession,
  AgentSessionConfig,
  AuthStatus,
} from './types.js';

export class YourAgent extends CodeAgent {
  readonly name = 'Your Agent';

  readonly capabilities: AgentCapabilities = {
    fileOperations: true,  // supports Read/Write/Edit
    shellExecution: true,   // supports Bash
    codeSearch: true,       // supports Grep/Glob
    structuredStreaming: true,  // emits structured events
    toolPermissions: false, // doesn't support permission control
    maxIterations: true,    // supports iteration limits
    webSearch: false,       // doesn't support web search
  };

  async isAvailable(): Promise<boolean> {
    // Check if agent binary/SDK is installed and accessible
    return true;
  }

  async checkAuth(): Promise<AuthStatus> {
    // Verify authentication (API key, OAuth, etc.)
    return {
      authenticated: true,
      method: 'api_key',
    };
  }

  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    // Spawn agent process and return session with event stream
    const sessionId = `your-agent-${Date.now()}`;

    return {
      id: sessionId,
      events: this.streamEvents(),
      wait: () => this.waitForCompletion(),
      cancel: () => this.cancelSession(),
    };
  }

  private async *streamEvents() {
    // Emit events as they occur
    yield { type: 'text', content: 'Starting...' };
    // ... more events
    yield { type: 'complete', success: true };
  }

  private async waitForCompletion() {
    // Wait for agent to finish and return result
    return {
      success: true,
      filesChanged: [],
      summary: 'Task completed',
    };
  }

  private async cancelSession() {
    // Gracefully stop the agent
  }
}
```

### 2. Export from Index

Add your agent to `index.ts`:

```typescript
export { YourAgent } from './your-agent.agent.js';
```

### 3. Add Tests

Create `tests/services/agents/your-agent.agent.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { YourAgent } from '../../../src/services/agents/your-agent.agent.js';

describe('YourAgent', () => {
  it('creates agent with correct name', () => {
    const agent = new YourAgent();
    expect(agent.name).toBe('Your Agent');
  });

  // ... more tests
});
```

### 4. Use in Commands

Update commands to support multiple agents:

```typescript
import { ClaudeCodeAgent, YourAgent } from '../services/agents/index.js';

// Select agent based on config or flag
const agent = useYourAgent ? new YourAgent() : new ClaudeCodeAgent();

// Check availability
if (!(await agent.isAvailable())) {
  console.error(`${agent.name} is not available`);
  return;
}

// Use unified interface
const session = await agent.createSession({
  prompt: 'Implement feature',
  maxIterations: 80,
});

for await (const event of session.events) {
  // Handle events same way regardless of agent
  handleEvent(event);
}
```

## Design Principles

1. **Capability Detection**: Commands check `agent.capabilities` before using agent-specific features
2. **Streaming First**: All agents emit events via async iterators for real-time feedback
3. **Graceful Degradation**: Unsupported features should be handled gracefully, not crash
4. **Session Lifecycle**: Clear session creation → streaming → completion → cleanup flow
5. **Error Handling**: Emit error events rather than throwing exceptions during streaming
6. **Resource Cleanup**: Agents must implement proper cleanup in `cancel()` method

## Event Types

All agents should emit these event types when applicable:

- **`text`**: Human-readable text output from the agent
- **`thinking`**: Agent's internal reasoning (if supported)
- **`tool_use`**: Agent is using a tool (Read, Write, Bash, etc.)
- **`tool_result`**: Result of tool execution
- **`error`**: Error occurred (fatal or non-fatal)
- **`progress`**: Progress update (step X of Y)
- **`complete`**: Session completed (success or failure)

## Testing Strategy

Each agent implementation should have tests covering:

1. **Construction**: Agent instantiates with correct name and capabilities
2. **Availability**: `isAvailable()` returns boolean
3. **Authentication**: `checkAuth()` returns proper status
4. **Session Creation**: `createSession()` returns valid session object
5. **Event Streaming**: Events are emitted in correct format
6. **Error Handling**: Process errors and tool errors are handled
7. **Cancellation**: Sessions can be gracefully cancelled

## Production Checklist

Before shipping a new agent implementation:

- [ ] All required methods implemented (`isAvailable`, `checkAuth`, `createSession`)
- [ ] Capabilities accurately declared
- [ ] Event types match spec (use TypeScript discriminated unions)
- [ ] Process lifecycle handled (exit, error, signals)
- [ ] Resource cleanup implemented (`cancel()`)
- [ ] Tests pass with >80% coverage
- [ ] Error handling for edge cases (process crashes, invalid JSON, etc.)
- [ ] Session IDs are unique (use counter + timestamp)
- [ ] File change detection implemented (if applicable)
- [ ] Documentation added to this README
