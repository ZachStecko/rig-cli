import { RigConfig } from '../../types/config.types.js';
import { CodeAgent } from './base.agent.js';
import { ClaudeSdkAgent } from './claude-sdk.agent.js';
import { ClaudeBinaryAgent } from './claude-binary.agent.js';

/**
 * Creates an agent instance based on the provider setting in config.
 *
 * @param config - Optional RigConfig; defaults to 'binary' provider if omitted
 * @returns A CodeAgent implementation matching the configured provider
 */
export function createAgent(config?: RigConfig): CodeAgent {
  const provider = config?.agent?.provider ?? 'binary';
  const verbose = config?.verbose ?? false;
  const timeoutMs = ((config?.agent?.timeout ?? 120) * 1000);
  switch (provider) {
    case 'binary':
      return new ClaudeBinaryAgent(verbose, timeoutMs);
    case 'sdk':
      return new ClaudeSdkAgent();
    default:
      console.warn(`Unknown agent provider: ${provider}. Falling back to 'binary'.`);
      return new ClaudeBinaryAgent(verbose, timeoutMs);
  }
}
