import {
  DefaultSlackService,
  SlackWebClientFactory,
  SlackWebClientAdapter,
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
