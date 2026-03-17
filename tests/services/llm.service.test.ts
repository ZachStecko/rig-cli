import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LLMService, StructuredIssue } from '../../src/services/llm.service.js';
import { CodeAgent } from '../../src/services/agents/base.agent.js';

describe('LLMService', () => {
  let llmService: LLMService;
  let mockAgent: CodeAgent;

  beforeEach(() => {
    mockAgent = {
      isAvailable: vi.fn(),
      checkAuth: vi.fn(),
      prompt: vi.fn(),
      waitForCompletion: vi.fn(),
    } as any;

    llmService = new LLMService(mockAgent);
  });

  describe('isAvailable', () => {
    it('returns true when agent is available', async () => {
      vi.mocked(mockAgent.isAvailable).mockResolvedValue(true);

      const result = await llmService.isAvailable();

      expect(result).toBe(true);
      expect(mockAgent.isAvailable).toHaveBeenCalled();
    });

    it('returns false when agent is not available', async () => {
      vi.mocked(mockAgent.isAvailable).mockResolvedValue(false);

      const result = await llmService.isAvailable();

      expect(result).toBe(false);
    });
  });

  describe('structureIssue', () => {
    beforeEach(() => {
      vi.mocked(mockAgent.checkAuth).mockResolvedValue({
        authenticated: true,
        error: null,
      });
    });

    it('throws error when agent is not authenticated', async () => {
      vi.mocked(mockAgent.checkAuth).mockResolvedValue({
        authenticated: false,
        error: 'API key not set',
      });

      await expect(
        llmService.structureIssue('Add authentication')
      ).rejects.toThrow('API key not set');
    });

    it('throws error when agent does not support prompt method', async () => {
      const agentWithoutPrompt = {
        isAvailable: vi.fn(),
        checkAuth: vi.fn().mockResolvedValue({ authenticated: true, error: null }),
        waitForCompletion: vi.fn(),
      } as any;

      const service = new LLMService(agentWithoutPrompt);

      await expect(
        service.structureIssue('Add authentication')
      ).rejects.toThrow('Agent does not support the prompt() method');
    });

    it('parses valid JSON response from agent', async () => {
      const mockResponse = JSON.stringify({
        title: 'feat: Add user authentication',
        body: 'Implementation details here',
      });
      vi.mocked(mockAgent.prompt).mockResolvedValue(mockResponse);

      const result = await llmService.structureIssue('Add authentication');

      expect(result).toEqual({
        title: 'feat: Add user authentication',
        body: 'Implementation details here',
      });
    });

    it('strips markdown code fences from response', async () => {
      const mockResponse = '```json\n{"title": "Add auth", "body": "Details"}\n```';
      vi.mocked(mockAgent.prompt).mockResolvedValue(mockResponse);

      const result = await llmService.structureIssue('Add authentication');

      expect(result).toEqual({
        title: 'Add auth',
        body: 'Details',
      });
    });

    it('extracts JSON from response with preamble text', async () => {
      const mockResponse = 'Sure, here is the structured issue:\n{"title": "Add auth", "body": "Details"}';
      vi.mocked(mockAgent.prompt).mockResolvedValue(mockResponse);

      const result = await llmService.structureIssue('Add authentication');

      expect(result).toEqual({
        title: 'Add auth',
        body: 'Details',
      });
    });

    it('throws error when response has no JSON', async () => {
      vi.mocked(mockAgent.prompt).mockResolvedValue('This is just text without JSON');

      await expect(
        llmService.structureIssue('Add authentication')
      ).rejects.toThrow('Failed to parse structured issue response');
    });

    it('throws error when title is empty', async () => {
      const mockResponse = JSON.stringify({
        title: '',
        body: 'Details',
      });
      vi.mocked(mockAgent.prompt).mockResolvedValue(mockResponse);

      await expect(
        llmService.structureIssue('Add authentication')
      ).rejects.toThrow('LLM returned an empty title');
    });

    it('throws error when body is empty', async () => {
      const mockResponse = JSON.stringify({
        title: 'Add auth',
        body: '',
      });
      vi.mocked(mockAgent.prompt).mockResolvedValue(mockResponse);

      await expect(
        llmService.structureIssue('Add authentication')
      ).rejects.toThrow('LLM returned an empty body');
    });

    it('truncates title exceeding GitHub limit', async () => {
      const longTitle = 'a'.repeat(300);
      const mockResponse = JSON.stringify({
        title: longTitle,
        body: 'Details',
      });
      vi.mocked(mockAgent.prompt).mockResolvedValue(mockResponse);

      const result = await llmService.structureIssue('Add authentication');

      expect(result.title.length).toBe(256);
      expect(result.title).toMatch(/\.\.\.$/);
    });

    it('builds prompt with code fence instructions', async () => {
      const mockResponse = JSON.stringify({
        title: 'Add auth',
        body: 'Details',
      });
      vi.mocked(mockAgent.prompt).mockResolvedValue(mockResponse);

      await llmService.structureIssue('Add authentication');

      expect(mockAgent.prompt).toHaveBeenCalled();
      const promptArg = vi.mocked(mockAgent.prompt).mock.calls[0][0];

      // Verify prompt includes instructions for proper code fences
      expect(promptArg).toContain('ALWAYS use proper markdown code fences with triple backticks and language identifier');
      expect(promptArg).toContain('```typescript');
      expect(promptArg).toContain('ALWAYS use proper markdown code fences: ```language for opening and ``` for closing');
    });

    it('generates body with proper code fence formatting when LLM responds correctly', async () => {
      const bodyWithCodeFence = `## Implementation Details
Create a new authentication service.

\`\`\`typescript
export class AuthService {
  async login(username: string, password: string) {
    // implementation
  }
}
\`\`\`

## Testing Strategy
- Test login flow
- Test invalid credentials`;

      const mockResponse = JSON.stringify({
        title: 'feat: Add authentication service',
        body: bodyWithCodeFence,
      });
      vi.mocked(mockAgent.prompt).mockResolvedValue(mockResponse);

      const result = await llmService.structureIssue('Add user authentication with JWT');

      expect(result.body).toContain('```typescript');
      expect(result.body).toContain('```');
      expect(result.body).toMatch(/```typescript[\s\S]*?```/);
    });

    it('prompt explicitly forbids outputting language name without backticks', async () => {
      const mockResponse = JSON.stringify({
        title: 'Add auth',
        body: 'Details',
      });
      vi.mocked(mockAgent.prompt).mockResolvedValue(mockResponse);

      await llmService.structureIssue('Add authentication');

      const promptArg = vi.mocked(mockAgent.prompt).mock.calls[0][0];
      expect(promptArg).toContain('never output just "typescript" or "javascript" without the backticks');
    });
  });
});
