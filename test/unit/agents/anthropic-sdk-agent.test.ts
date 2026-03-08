import { AnthropicSdkAgent, AnthropicSdkAgentConfig } from '../../../src/agents/anthropic-sdk-agent';
import { AgentMessage, AgentStatus, WaitingStatus } from '../../../src/agents/types';
import { DEFAULT_AGENT_PROFILE, AgentProfile } from '../../../src/repositories/settings';

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
import { createAnthropic } from '@ai-sdk/anthropic';

const mockStreamText = streamText as jest.MockedFunction<typeof streamText>;

function createMockStreamResult(text: string) {
  return {
    textStream: (async function* () {
      yield text;
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

describe('AnthropicSdkAgent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with stopped status', () => {
      const agent = new AnthropicSdkAgent(createConfig());

      expect(agent.status).toBe('stopped');
      expect(agent.projectId).toBe('test-project');
      expect(agent.mode).toBe('interactive');
      expect(agent.sessionId).toBeNull();
      expect(agent.processInfo).toBeNull();
    });

    it('should use configured model', () => {
      const agent = new AnthropicSdkAgent(createConfig({ model: 'claude-opus-4-6' }));
      expect(agent.lastCommand).toBeNull();
    });
  });

  describe('start', () => {
    it('should transition to running and emit status', () => {
      mockStreamText.mockReturnValue(createMockStreamResult('Hello!'));

      const agent = new AnthropicSdkAgent(createConfig());
      const statusHandler = jest.fn();
      agent.on('status', statusHandler);

      agent.start('Test message');

      expect(agent.status).toBe('running');
      expect(statusHandler).toHaveBeenCalledWith('running');
      expect(agent.lastCommand).toMatch(/^sdk:/);
    });

    it('should emit system message on start', () => {
      mockStreamText.mockReturnValue(createMockStreamResult('response'));

      const agent = new AnthropicSdkAgent(createConfig());
      const messageHandler = jest.fn();
      agent.on('message', messageHandler);

      agent.start('Test');

      expect(messageHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'system',
          content: expect.stringContaining('SDK Agent started'),
        }),
      );
    });

    it('should process user message and stream response', async () => {
      mockStreamText.mockReturnValue(createMockStreamResult('Agent response'));

      const agent = new AnthropicSdkAgent(createConfig());
      const messages: AgentMessage[] = [];
      agent.on('message', (m: AgentMessage) => messages.push(m));

      agent.start('Hello agent');

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have: system, user, stdout messages
      const systemMsg = messages.find(m => m.type === 'system');
      const userMsg = messages.find(m => m.type === 'user');
      const stdoutMsg = messages.find(m => m.type === 'stdout');

      expect(systemMsg).toBeDefined();
      expect(userMsg).toBeDefined();
      expect(userMsg!.content).toBe('Hello agent');
      expect(stdoutMsg).toBeDefined();
      expect(stdoutMsg!.content).toBe('Agent response');
    });
  });

  describe('stop', () => {
    it('should transition to stopped and emit exit', async () => {
      mockStreamText.mockReturnValue(createMockStreamResult('response'));

      const agent = new AnthropicSdkAgent(createConfig());
      const statusHandler = jest.fn();
      const exitHandler = jest.fn();
      agent.on('status', statusHandler);
      agent.on('exit', exitHandler);

      agent.start('test');
      await agent.stop();

      expect(agent.status).toBe('stopped');
      expect(exitHandler).toHaveBeenCalledWith(0);
    });
  });

  describe('sendInput', () => {
    it('should process additional messages', async () => {
      mockStreamText
        .mockReturnValueOnce(createMockStreamResult('first response'))
        .mockReturnValueOnce(createMockStreamResult('second response'));

      const agent = new AnthropicSdkAgent(createConfig());
      const messages: AgentMessage[] = [];
      agent.on('message', (m: AgentMessage) => messages.push(m));

      agent.start('first');
      await new Promise(resolve => setTimeout(resolve, 50));

      agent.sendInput('second');
      await new Promise(resolve => setTimeout(resolve, 50));

      const stdoutMsgs = messages.filter(m => m.type === 'stdout');
      expect(stdoutMsgs.length).toBe(2);
      expect(stdoutMsgs[0]!.content).toBe('first response');
      expect(stdoutMsgs[1]!.content).toBe('second response');
    });
  });

  describe('waiting status', () => {
    it('should emit waiting status during processing', async () => {
      mockStreamText.mockReturnValue(createMockStreamResult('response'));

      const agent = new AnthropicSdkAgent(createConfig());
      const waitingStatuses: WaitingStatus[] = [];
      agent.on('waitingForInput', (s: WaitingStatus) => waitingStatuses.push(s));

      agent.start('test');
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have emitted not-waiting then waiting
      expect(waitingStatuses.length).toBeGreaterThanOrEqual(2);
      expect(waitingStatuses[0]!.isWaiting).toBe(false);
      expect(waitingStatuses[waitingStatuses.length - 1]!.isWaiting).toBe(true);
    });
  });

  describe('context usage', () => {
    it('should estimate context usage after messages', async () => {
      mockStreamText.mockReturnValue(createMockStreamResult('response text'));

      const agent = new AnthropicSdkAgent(createConfig());
      agent.start('hello');
      await new Promise(resolve => setTimeout(resolve, 50));

      const usage = agent.contextUsage;
      expect(usage).not.toBeNull();
      expect(usage!.totalTokens).toBeGreaterThan(0);
      expect(usage!.maxContextTokens).toBe(200000);
    });
  });

  describe('agent profile', () => {
    it('should use API key from profile config', async () => {
      const profile: AgentProfile = {
        id: 'sdk-profile',
        name: 'SDK Profile',
        provider: 'anthropic',
        isDefault: false,
        anthropicConfig: {
          runtime: 'sdk',
          authMode: 'api-key',
          apiKey: 'sk-test-key',
        },
      };

      mockStreamText.mockReturnValue(createMockStreamResult('response'));

      const agent = new AnthropicSdkAgent(createConfig({ agentProfile: profile }));
      agent.start('test');
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify createAnthropic was called with the API key
      expect(createAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-test-key' }),
      );
    });

    it('should not pass API key for pro-plan auth', async () => {
      const profile: AgentProfile = {
        id: 'pro-profile',
        name: 'Pro Profile',
        provider: 'anthropic',
        isDefault: false,
        anthropicConfig: {
          runtime: 'sdk',
          authMode: 'pro-plan',
        },
      };

      mockStreamText.mockReturnValue(createMockStreamResult('response'));

      const agent = new AnthropicSdkAgent(createConfig({ agentProfile: profile }));
      agent.start('test');
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should be called with empty object (no apiKey)
      expect(createAnthropic).toHaveBeenCalledWith({});
    });
  });

  describe('removeQueuedMessage', () => {
    it('should return false for invalid index', () => {
      const agent = new AnthropicSdkAgent(createConfig());
      expect(agent.removeQueuedMessage(0)).toBe(false);
      expect(agent.removeQueuedMessage(-1)).toBe(false);
    });
  });

  describe('event handlers', () => {
    it('should support on/off for events', () => {
      const agent = new AnthropicSdkAgent(createConfig());
      const handler = jest.fn();

      agent.on('status', handler);
      agent.off('status', handler);

      // Starting should not trigger the removed handler
      mockStreamText.mockReturnValue(createMockStreamResult('test'));
      agent.start('test');
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
