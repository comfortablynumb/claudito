import {
  DefaultSlackService,
  SlackWebClientFactory,
  SlackWebClientAdapter,
  SlackError,
  DefaultSlackSocketService,
  createSlackService,
  createSlackSocketService,
} from '../../../src/services/slack-service';

// ============================================================================
// Helpers
// ============================================================================

function createMockClientAdapter(overrides: Partial<SlackWebClientAdapter> = {}): jest.Mocked<SlackWebClientAdapter> {
  return {
    authTest: jest.fn().mockResolvedValue({
      ok: true,
      team: 'Acme Corp',
      user_id: 'U12345',
      user: 'claudito-bot',
    }),
    postMessage: jest.fn().mockResolvedValue({ ts: '1234567890.000100' }),
    conversationsList: jest.fn().mockResolvedValue({
      channels: [
        { id: 'C001', name: 'general' },
        { id: 'C002', name: 'random' },
      ],
    }),
    getUserInfo: jest.fn().mockResolvedValue({ displayName: 'John Doe' }),
    updateMessage: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as jest.Mocked<SlackWebClientAdapter>;
}

function createMockFactory(adapter: SlackWebClientAdapter): SlackWebClientFactory {
  return { create: jest.fn().mockReturnValue(adapter) };
}

function createService(factory?: SlackWebClientFactory) {
  const adapter = createMockClientAdapter();
  const resolvedFactory = factory ?? createMockFactory(adapter);
  return { service: new DefaultSlackService(resolvedFactory), factory: resolvedFactory, adapter };
}

// ============================================================================
// getStatus
// ============================================================================

describe('DefaultSlackService.getStatus', () => {
  it('returns disconnected with error when botToken is null', async () => {
    const { service } = createService();
    const status = await service.getStatus(null);

    expect(status.connected).toBe(false);
    expect(status.error).toContain('No bot token');
    expect(status.workspaceName).toBeNull();
    expect(status.botUserId).toBeNull();
  });

  it('returns disconnected with error when botToken is empty string', async () => {
    const { service } = createService();
    const status = await service.getStatus('');

    expect(status.connected).toBe(false);
    expect(status.error).toBeDefined();
  });

  it('returns connected status with workspace info on success', async () => {
    const adapter = createMockClientAdapter();
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    const status = await service.getStatus('xoxb-valid-token');

    expect(status.connected).toBe(true);
    expect(status.workspaceName).toBe('Acme Corp');
    expect(status.botUserId).toBe('U12345');
    expect(status.botUserName).toBe('claudito-bot');
    expect(status.error).toBeNull();
  });

  it('creates client with the provided token', async () => {
    const adapter = createMockClientAdapter();
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    await service.getStatus('xoxb-my-token');

    expect(factory.create).toHaveBeenCalledWith('xoxb-my-token');
  });

  it('returns disconnected with API error message when authTest throws', async () => {
    const adapter = createMockClientAdapter({
      authTest: jest.fn().mockRejectedValue(new Error('invalid_auth')),
    });
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    const status = await service.getStatus('xoxb-bad-token');

    expect(status.connected).toBe(false);
    expect(status.error).toBe('invalid_auth');
    expect(status.workspaceName).toBeNull();
  });

  it('handles missing fields in authTest response gracefully', async () => {
    const adapter = createMockClientAdapter({
      authTest: jest.fn().mockResolvedValue({ ok: true }),
    });
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    const status = await service.getStatus('xoxb-token');

    expect(status.connected).toBe(true);
    expect(status.workspaceName).toBeNull();
    expect(status.botUserId).toBeNull();
    expect(status.botUserName).toBeNull();
  });
});

// ============================================================================
// validateBotToken
// ============================================================================

describe('DefaultSlackService.validateBotToken', () => {
  it('returns invalid with error when token is empty', async () => {
    const { service } = createService();
    const result = await service.validateBotToken('');

    expect(result.valid).toBe(false);
    expect(result.error).toContain('required');
  });

  it('returns invalid with error when token is whitespace only', async () => {
    const { service } = createService();
    const result = await service.validateBotToken('   ');

    expect(result.valid).toBe(false);
    expect(result.error).toContain('required');
  });

  it('returns valid with workspace info on successful authTest', async () => {
    const adapter = createMockClientAdapter();
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    const result = await service.validateBotToken('xoxb-valid');

    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
    expect(result.workspaceName).toBe('Acme Corp');
    expect(result.botUserId).toBe('U12345');
  });

  it('returns invalid with Slack error message when authTest rejects', async () => {
    const adapter = createMockClientAdapter({
      authTest: jest.fn().mockRejectedValue(new Error('token_revoked')),
    });
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    const result = await service.validateBotToken('xoxb-revoked');

    expect(result.valid).toBe(false);
    expect(result.error).toBe('token_revoked');
    expect(result.workspaceName).toBeNull();
    expect(result.botUserId).toBeNull();
  });

  it('trims the token before calling authTest', async () => {
    const adapter = createMockClientAdapter();
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    await service.validateBotToken('  xoxb-trimmed  ');

    expect(factory.create).toHaveBeenCalledWith('xoxb-trimmed');
  });

  it('handles missing fields in authTest response gracefully', async () => {
    const adapter = createMockClientAdapter({
      authTest: jest.fn().mockResolvedValue({ ok: true }),
    });
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    const result = await service.validateBotToken('xoxb-token');

    expect(result.valid).toBe(true);
    expect(result.workspaceName).toBeNull();
    expect(result.botUserId).toBeNull();
  });
});

// ============================================================================
// updateMessage
// ============================================================================

describe('DefaultSlackService.updateMessage', () => {
  it('calls client.updateMessage with correct params', async () => {
    const updateMessage = jest.fn().mockResolvedValue(undefined);
    const adapter = createMockClientAdapter({ updateMessage });
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    await service.updateMessage('xoxb-token', 'C_CHANNEL', '1234567890.000100', 'Updated text', [{ type: 'section' }]);

    expect(updateMessage).toHaveBeenCalledWith({
      channel: 'C_CHANNEL',
      ts: '1234567890.000100',
      text: 'Updated text',
      blocks: [{ type: 'section' }],
    });
  });

  it('creates client with the provided token', async () => {
    const adapter = createMockClientAdapter();
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    await service.updateMessage('xoxb-my-token', 'C_CHANNEL', 'ts-123', 'text');

    expect(factory.create).toHaveBeenCalledWith('xoxb-my-token');
  });

  it('throws SlackError when update fails', async () => {
    const updateMessage = jest.fn().mockRejectedValue(new Error('channel_not_found'));
    const adapter = createMockClientAdapter({ updateMessage });
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    await expect(
      service.updateMessage('xoxb-token', 'C_CHANNEL', 'ts-123', 'text')
    ).rejects.toThrow('Failed to update message');
  });
});

// ============================================================================
// sendMessage
// ============================================================================

describe('DefaultSlackService.sendMessage', () => {
  it('sends message and returns timestamp', async () => {
    const adapter = createMockClientAdapter();
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    const ts = await service.sendMessage('xoxb-token', 'C001', 'Hello!');

    expect(ts).toBe('1234567890.000100');
    expect(adapter.postMessage).toHaveBeenCalledWith({
      channelId: 'C001',
      text: 'Hello!',
      blocks: undefined,
    });
  });

  it('passes blocks when provided', async () => {
    const adapter = createMockClientAdapter();
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: '*Bold*' } }];
    await service.sendMessage('xoxb-token', 'C001', 'Hello!', blocks);

    expect(adapter.postMessage).toHaveBeenCalledWith({
      channelId: 'C001',
      text: 'Hello!',
      blocks,
    });
  });

  it('returns null when response has no ts', async () => {
    const adapter = createMockClientAdapter({
      postMessage: jest.fn().mockResolvedValue({}),
    });
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    const ts = await service.sendMessage('xoxb-token', 'C001', 'Hello!');

    expect(ts).toBeNull();
  });

  it('throws SlackError when postMessage fails', async () => {
    const adapter = createMockClientAdapter({
      postMessage: jest.fn().mockRejectedValue(new Error('not_in_channel')),
    });
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    await expect(
      service.sendMessage('xoxb-token', 'C001', 'Hello!')
    ).rejects.toThrow('Failed to send message');
  });

  it('creates client with the provided token', async () => {
    const adapter = createMockClientAdapter();
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    await service.sendMessage('xoxb-my-token', 'C001', 'text');

    expect(factory.create).toHaveBeenCalledWith('xoxb-my-token');
  });
});

// ============================================================================
// replyInThread
// ============================================================================

describe('DefaultSlackService.replyInThread', () => {
  it('replies in thread and returns timestamp', async () => {
    const adapter = createMockClientAdapter();
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    const ts = await service.replyInThread('xoxb-token', 'C001', '1111.0001', 'Reply text');

    expect(ts).toBe('1234567890.000100');
    expect(adapter.postMessage).toHaveBeenCalledWith({
      channelId: 'C001',
      text: 'Reply text',
      blocks: undefined,
      threadTs: '1111.0001',
    });
  });

  it('passes blocks when provided', async () => {
    const adapter = createMockClientAdapter();
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    const blocks = [{ type: 'section' }];
    await service.replyInThread('xoxb-token', 'C001', '1111.0001', 'text', blocks);

    expect(adapter.postMessage).toHaveBeenCalledWith({
      channelId: 'C001',
      text: 'text',
      blocks,
      threadTs: '1111.0001',
    });
  });

  it('throws SlackError when reply fails', async () => {
    const adapter = createMockClientAdapter({
      postMessage: jest.fn().mockRejectedValue(new Error('thread_not_found')),
    });
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    await expect(
      service.replyInThread('xoxb-token', 'C001', '1111.0001', 'text')
    ).rejects.toThrow('Failed to reply in thread');
  });
});

// ============================================================================
// listChannels
// ============================================================================

describe('DefaultSlackService.listChannels', () => {
  it('returns mapped channel list', async () => {
    const adapter = createMockClientAdapter();
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    const channels = await service.listChannels('xoxb-token');

    expect(channels).toEqual([
      { id: 'C001', name: 'general', isMember: false },
      { id: 'C002', name: 'random', isMember: false },
    ]);
  });

  it('returns empty array when no channels', async () => {
    const adapter = createMockClientAdapter({
      conversationsList: jest.fn().mockResolvedValue({ channels: undefined }),
    });
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    const channels = await service.listChannels('xoxb-token');

    expect(channels).toEqual([]);
  });

  it('throws SlackError when listing fails', async () => {
    const adapter = createMockClientAdapter({
      conversationsList: jest.fn().mockRejectedValue(new Error('missing_scope')),
    });
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    await expect(
      service.listChannels('xoxb-token')
    ).rejects.toThrow('Failed to list channels');
  });
});

// ============================================================================
// getUserName
// ============================================================================

describe('DefaultSlackService.getUserName', () => {
  it('returns display name for valid user', async () => {
    const adapter = createMockClientAdapter();
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    const name = await service.getUserName('xoxb-token', 'U001');

    expect(name).toBe('John Doe');
    expect(adapter.getUserInfo).toHaveBeenCalledWith('U001');
  });

  it('returns null when getUserInfo returns null', async () => {
    const adapter = createMockClientAdapter({
      getUserInfo: jest.fn().mockResolvedValue(null),
    });
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    const name = await service.getUserName('xoxb-token', 'U999');

    expect(name).toBeNull();
  });

  it('returns null when getUserInfo throws', async () => {
    const adapter = createMockClientAdapter({
      getUserInfo: jest.fn().mockRejectedValue(new Error('user_not_found')),
    });
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    const name = await service.getUserName('xoxb-token', 'U999');

    expect(name).toBeNull();
  });

  it('returns null when displayName is undefined', async () => {
    const adapter = createMockClientAdapter({
      getUserInfo: jest.fn().mockResolvedValue({}),
    });
    const factory = createMockFactory(adapter);
    const service = new DefaultSlackService(factory);

    const name = await service.getUserName('xoxb-token', 'U001');

    expect(name).toBeNull();
  });
});

// ============================================================================
// SlackError
// ============================================================================

describe('SlackError', () => {
  it('creates error with correct properties', () => {
    const error = new SlackError('test error');

    expect(error.message).toBe('test error');
    expect(error.statusCode).toBe(500);
    expect(error.code).toBe('SLACK_ERROR');
  });

  it('is an instance of Error', () => {
    const error = new SlackError('test');

    expect(error).toBeInstanceOf(Error);
  });
});

// ============================================================================
// DefaultSlackSocketService
// ============================================================================

jest.mock('@slack/socket-mode', () => ({
  SocketModeClient: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
  })),
}));

describe('DefaultSlackSocketService', () => {
  it('is not connected initially', () => {
    const service = new DefaultSlackSocketService();

    expect(service.isConnected()).toBe(false);
  });

  it('connects and becomes connected', async () => {
    const service = new DefaultSlackSocketService();
    await service.connect('xapp-token');

    expect(service.isConnected()).toBe(true);
  });

  it('disconnects and becomes not connected', async () => {
    const service = new DefaultSlackSocketService();
    await service.connect('xapp-token');
    await service.disconnect();

    expect(service.isConnected()).toBe(false);
  });

  it('disconnect is a no-op when not connected', async () => {
    const service = new DefaultSlackSocketService();
    await service.disconnect();

    expect(service.isConnected()).toBe(false);
  });

  it('reconnects by disconnecting first', async () => {
    const service = new DefaultSlackSocketService();
    await service.connect('xapp-token-1');
    await service.connect('xapp-token-2');

    expect(service.isConnected()).toBe(true);
  });

  it('registers slash command handler', () => {
    const service = new DefaultSlackSocketService();
    const handler = jest.fn();
    service.onSlashCommand(handler);
    // No error thrown
  });

  it('registers interactive action handler', () => {
    const service = new DefaultSlackSocketService();
    const handler = jest.fn();
    service.onInteractiveAction(handler);
  });

  it('registers message event handler', () => {
    const service = new DefaultSlackSocketService();
    const handler = jest.fn();
    service.onMessageEvent(handler);
  });
});

// ============================================================================
// DefaultSlackSocketService - event listener callbacks
// ============================================================================

describe('DefaultSlackSocketService event listeners', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let capturedHandlers: Map<string, (...args: any[]) => void>;
  let mockSocketClient: { start: jest.Mock; disconnect: jest.Mock; on: jest.Mock };

  beforeEach(() => {
    capturedHandlers = new Map();
    mockSocketClient = {
      start: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on: jest.fn().mockImplementation((event: string, handler: (...args: any[]) => void) => {
        capturedHandlers.set(event, handler);
      }),
    };

    // Re-mock SocketModeClient to capture handlers
    const socketMode = jest.requireMock('@slack/socket-mode') as { SocketModeClient: jest.Mock };
    socketMode.SocketModeClient.mockImplementation(() => mockSocketClient);
  });

  it('should call slash command handler when registered and event fires', async () => {
    const service = new DefaultSlackSocketService();
    const handler = jest.fn();
    service.onSlashCommand(handler);

    await service.connect('xapp-token');

    // Trigger the slash_commands event
    const slashHandler = capturedHandlers.get('slash_commands');
    expect(slashHandler).toBeDefined();

    const mockAck = jest.fn().mockResolvedValue(undefined);
    const mockBody = { command: '/test', text: 'hello' };

    slashHandler!({ body: mockBody, ack: mockAck });

    // Wait for the async IIFE
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(handler).toHaveBeenCalledWith(mockBody, mockAck);
  });

  it('should ack slash command when no handler registered', async () => {
    const service = new DefaultSlackSocketService();

    await service.connect('xapp-token');

    const slashHandler = capturedHandlers.get('slash_commands');
    expect(slashHandler).toBeDefined();

    const mockAck = jest.fn().mockResolvedValue(undefined);
    slashHandler!({ body: { command: '/test' }, ack: mockAck });

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockAck).toHaveBeenCalled();
  });

  it('should call interactive action handler when registered and event fires', async () => {
    const service = new DefaultSlackSocketService();
    const handler = jest.fn();
    service.onInteractiveAction(handler);

    await service.connect('xapp-token');

    const interactiveHandler = capturedHandlers.get('interactive');
    expect(interactiveHandler).toBeDefined();

    const mockAck = jest.fn().mockResolvedValue(undefined);
    const mockBody = { type: 'block_actions', actions: [] };

    interactiveHandler!({ body: mockBody, ack: mockAck });

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(handler).toHaveBeenCalledWith(mockBody, mockAck);
  });

  it('should ack interactive action when no handler registered', async () => {
    const service = new DefaultSlackSocketService();

    await service.connect('xapp-token');

    const interactiveHandler = capturedHandlers.get('interactive');
    expect(interactiveHandler).toBeDefined();

    const mockAck = jest.fn().mockResolvedValue(undefined);
    interactiveHandler!({ body: {}, ack: mockAck });

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockAck).toHaveBeenCalled();
  });

  it('should call message handler when registered and event fires', async () => {
    const service = new DefaultSlackSocketService();
    const handler = jest.fn();
    service.onMessageEvent(handler);

    await service.connect('xapp-token');

    const messageHandler = capturedHandlers.get('message');
    expect(messageHandler).toBeDefined();

    const mockAck = jest.fn().mockResolvedValue(undefined);
    const mockEvent = { type: 'message', text: 'hello', user: 'U123' };

    messageHandler!({ event: mockEvent, ack: mockAck });

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(handler).toHaveBeenCalledWith(mockEvent, mockAck);
  });

  it('should ack message event when no handler registered', async () => {
    const service = new DefaultSlackSocketService();

    await service.connect('xapp-token');

    const messageHandler = capturedHandlers.get('message');
    expect(messageHandler).toBeDefined();

    const mockAck = jest.fn().mockResolvedValue(undefined);
    messageHandler!({ event: { type: 'message' }, ack: mockAck });

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockAck).toHaveBeenCalled();
  });
});

// ============================================================================
// Factory functions
// ============================================================================

describe('Factory functions', () => {
  it('createSlackService returns a DefaultSlackService', () => {
    const adapter = createMockClientAdapter();
    const factory = createMockFactory(adapter);
    const service = createSlackService(factory);

    expect(service).toBeInstanceOf(DefaultSlackService);
  });

  it('createSlackSocketService returns a DefaultSlackSocketService', () => {
    const service = createSlackSocketService();

    expect(service).toBeInstanceOf(DefaultSlackSocketService);
  });
});
