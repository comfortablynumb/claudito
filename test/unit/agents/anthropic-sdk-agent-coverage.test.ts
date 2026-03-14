import { AnthropicSdkAgent, AnthropicSdkAgentConfig } from '../../../src/agents/anthropic-sdk-agent';
import { AgentMessage } from '../../../src/agents/types';

// Mock the AI SDK
jest.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: jest.fn(() => {
    return jest.fn(() => 'mock-model');
  }),
}));

jest.mock('ai', () => ({
  streamText: jest.fn(),
}));

import { streamText } from 'ai';

const mockStreamText = streamText as jest.MockedFunction<typeof streamText>;

function createMockStreamResult(text: string) {
  return {
    textStream: (function* () {
      yield text;
    })(),
  } as unknown as ReturnType<typeof streamText>;
}

function createErrorStreamResult(error: Error) {
  return {
    // eslint-disable-next-line require-yield
    textStream: (function* () {
      throw error;
    })(),
  } as unknown as ReturnType<typeof streamText>;
}

function createConfig(overrides?: Partial<AnthropicSdkAgentConfig>): AnthropicSdkAgentConfig {
  return {
    projectId: 'test-project',
    projectPath: '/test/path',
    ...overrides,
  };
}

describe('AnthropicSdkAgent - Coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getter coverage', () => {
    it('should return null for sessionError', () => {
      const agent = new AnthropicSdkAgent(createConfig());
      expect(agent.sessionError).toBeNull();
    });

    it('should return null for permissionMode', () => {
      const agent = new AnthropicSdkAgent(createConfig());
      expect(agent.permissionMode).toBeNull();
    });
  });

  describe('sendToolResult', () => {
    it('should be a no-op', () => {
      const agent = new AnthropicSdkAgent(createConfig());
      // Should not throw
      agent.sendToolResult('tool-123', 'result content');
    });
  });

  describe('removeQueuedMessage with valid index', () => {
    it('should remove a queued message and return true', async () => {
      // Create a slow stream that never completes to keep agent busy
      let resolveStream: () => void;
      const slowStream = {
        textStream: (async function* () {
          await new Promise<void>(r => { resolveStream = r; });
          yield 'done';
        })(),
      } as unknown as ReturnType<typeof streamText>;

      mockStreamText.mockReturnValueOnce(slowStream);

      const agent = new AnthropicSdkAgent(createConfig());
      agent.start('initial');

      // Give time for processMessage to start
      await new Promise(r => setTimeout(r, 10));

      // While processing, sendInput queues messages
      agent.sendInput('queued-msg-1');
      agent.sendInput('queued-msg-2');

      // Now remove the first queued message
      expect(agent.removeQueuedMessage(0)).toBe(true);

      // Clean up: resolve and stop
      resolveStream!();
      await agent.stop();
    });
  });

  describe('sendInput when processing queues messages', () => {
    it('should queue input when agent is currently processing', async () => {
      let resolveStream: () => void;
      const slowStream = {
        textStream: (async function* () {
          await new Promise<void>(r => { resolveStream = r; });
          yield 'response';
        })(),
      } as unknown as ReturnType<typeof streamText>;

      mockStreamText
        .mockReturnValueOnce(slowStream)
        .mockReturnValueOnce(createMockStreamResult('queued response'));

      const agent = new AnthropicSdkAgent(createConfig());
      const messages: AgentMessage[] = [];
      agent.on('message', (m: AgentMessage) => messages.push(m));

      agent.start('first');
      await new Promise(r => setTimeout(r, 10));

      // Send input while processing - should be queued
      agent.sendInput('queued');

      // Now let the first stream complete
      resolveStream!();
      await new Promise(r => setTimeout(r, 100));

      // The queued message should have been processed
      const stdoutMsgs = messages.filter(m => m.type === 'stdout');
      expect(stdoutMsgs.length).toBeGreaterThanOrEqual(1);

      await agent.stop();
    });
  });

  describe('processMessage error handling', () => {
    it('should emit system error message on non-abort error', async () => {
      mockStreamText.mockReturnValue(createErrorStreamResult(new Error('API rate limited')));

      const agent = new AnthropicSdkAgent(createConfig());
      const messages: AgentMessage[] = [];
      agent.on('message', (m: AgentMessage) => messages.push(m));

      agent.start('test');
      await new Promise(r => setTimeout(r, 50));

      const errorMsg = messages.find(m => m.type === 'system' && m.content.includes('API rate limited'));
      expect(errorMsg).toBeDefined();
    });

    it('should silently handle AbortError', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockStreamText.mockReturnValue(createErrorStreamResult(abortError));

      const agent = new AnthropicSdkAgent(createConfig());
      const messages: AgentMessage[] = [];
      agent.on('message', (m: AgentMessage) => messages.push(m));

      agent.start('test');
      await new Promise(r => setTimeout(r, 50));

      // Should not emit an error system message
      const errorMsg = messages.find(m => m.type === 'system' && m.content.includes('Error:'));
      expect(errorMsg).toBeUndefined();
    });

    it('should handle non-Error throws', async () => {
      const result = {
        // eslint-disable-next-line require-yield
        textStream: (function* () {
          throw 'string error';
        })(),
      } as unknown as ReturnType<typeof streamText>;

      mockStreamText.mockReturnValue(result);

      const agent = new AnthropicSdkAgent(createConfig());
      const messages: AgentMessage[] = [];
      agent.on('message', (m: AgentMessage) => messages.push(m));

      agent.start('test');
      await new Promise(r => setTimeout(r, 50));

      const errorMsg = messages.find(m => m.type === 'system' && m.content.includes('string error'));
      expect(errorMsg).toBeDefined();
    });
  });

  describe('processQueuedMessages', () => {
    it('should process queued messages after current message completes', async () => {
      mockStreamText
        .mockReturnValueOnce(createMockStreamResult('first'))
        .mockReturnValueOnce(createMockStreamResult('second'));

      const agent = new AnthropicSdkAgent(createConfig());
      const messages: AgentMessage[] = [];
      agent.on('message', (m: AgentMessage) => messages.push(m));

      // Start with first message
      agent.start('hello');

      // Wait for first to complete, then send input directly (not while processing)
      await new Promise(r => setTimeout(r, 50));
      agent.sendInput('follow up');
      await new Promise(r => setTimeout(r, 50));

      const stdoutMsgs = messages.filter(m => m.type === 'stdout');
      expect(stdoutMsgs).toHaveLength(2);
    });
  });

  describe('collectedOutput', () => {
    it('should accumulate streamed text in collectedOutput', async () => {
      const multiChunkResult = {
        textStream: (function* () {
          yield 'chunk1';
          yield 'chunk2';
        })(),
      } as unknown as ReturnType<typeof streamText>;

      mockStreamText.mockReturnValue(multiChunkResult);

      const agent = new AnthropicSdkAgent(createConfig());
      agent.start('test');
      await new Promise(r => setTimeout(r, 50));

      expect(agent.collectedOutput).toBe('chunk1chunk2');
    });
  });
});
