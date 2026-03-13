/* eslint-disable @typescript-eslint/unbound-method */
import request from 'supertest';
import express, { Express } from 'express';
import { createSettingsRouter, SettingsChangeEvent } from '../../../src/routes/settings';
import { SettingsRepository } from '../../../src/repositories';
import { DataWipeService, WipeSummary } from '../../../src/services/data-wipe-service';
import { SlackService } from '../../../src/services/slack-service';
import { createErrorHandler } from '../../../src/utils/errors';
import {
  createMockSettingsRepository,
  createMockSlackService,
} from '../helpers/mock-factories';

interface ErrorResponse {
  error: string;
}

function createMockDataWipeService(): jest.Mocked<DataWipeService> {
  return {
    wipeAll: jest.fn<Promise<WipeSummary>, []>().mockResolvedValue({
      projectsWiped: 0,
      globalDataDeleted: true,
      mcpTempDeleted: false,
    }),
  };
}

function buildApp(
  overrides: {
    slackService?: SlackService;
    onSettingsChange?: jest.Mock<void, [SettingsChangeEvent]>;
    settingsRepository?: jest.Mocked<SettingsRepository>;
  } = {}
): { app: Express; mockRepository: jest.Mocked<SettingsRepository>; onSettingsChange: jest.Mock<void, [SettingsChangeEvent]> } {
  const mockRepository = overrides.settingsRepository ?? createMockSettingsRepository();
  const onSettingsChange = overrides.onSettingsChange ?? jest.fn<void, [SettingsChangeEvent]>();
  const app = express();
  app.use(express.json());
  app.use('/settings', createSettingsRouter({
    settingsRepository: mockRepository,
    dataWipeService: createMockDataWipeService(),
    slackService: overrides.slackService,
    onSettingsChange,
  }));
  app.use(createErrorHandler());

  return { app, mockRepository, onSettingsChange };
}

function validAnthropicProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'profile-1',
    name: 'Default',
    provider: 'anthropic',
    isDefault: true,
    anthropicConfig: { runtime: 'claude-binary' },
    ...overrides,
  };
}

describe('SettingsRouter - Slack validation', () => {
  it('should validate slack botToken using slackService when provided', async () => {
    const mockSlack = createMockSlackService();
    const { app } = buildApp({ slackService: mockSlack });

    const response = await request(app)
      .put('/settings')
      .send({ slack: { botToken: 'xoxb-valid-token' } });

    expect(response.status).toBe(200);
    expect(mockSlack.validateBotToken).toHaveBeenCalledWith('xoxb-valid-token');
  });

  it('should throw when slack botToken is set but slackService is missing', async () => {
    const { app } = buildApp({ slackService: undefined });

    const response = await request(app)
      .put('/settings')
      .send({ slack: { botToken: 'xoxb-some-token' } });

    expect(response.status).toBe(400);
    const body = response.body as ErrorResponse;
    expect(body.error).toContain('Slack service not available');
  });

  it('should throw when slackService returns invalid token', async () => {
    const mockSlack = createMockSlackService();
    mockSlack.validateBotToken.mockResolvedValue({
      valid: false,
      error: 'token_revoked',
      workspaceName: null,
      botUserId: null,
    });
    const { app } = buildApp({ slackService: mockSlack });

    const response = await request(app)
      .put('/settings')
      .send({ slack: { botToken: 'xoxb-bad-token' } });

    expect(response.status).toBe(400);
    const body = response.body as ErrorResponse;
    expect(body.error).toContain('Invalid bot token: token_revoked');
  });

  it('should use fallback message when validation error is null', async () => {
    const mockSlack = createMockSlackService();
    mockSlack.validateBotToken.mockResolvedValue({
      valid: false,
      error: null,
      workspaceName: null,
      botUserId: null,
    });
    const { app } = buildApp({ slackService: mockSlack });

    const response = await request(app)
      .put('/settings')
      .send({ slack: { botToken: 'xoxb-bad-token' } });

    expect(response.status).toBe(400);
    const body = response.body as ErrorResponse;
    expect(body.error).toContain('authentication failed');
  });

  it('should skip validation when botToken is empty string', async () => {
    const mockSlack = createMockSlackService();
    const { app } = buildApp({ slackService: mockSlack });

    const response = await request(app)
      .put('/settings')
      .send({ slack: { botToken: '' } });

    expect(response.status).toBe(200);
    expect(mockSlack.validateBotToken).not.toHaveBeenCalled();
  });

  it('should skip validation when botToken is whitespace only', async () => {
    const mockSlack = createMockSlackService();
    const { app } = buildApp({ slackService: mockSlack });

    const response = await request(app)
      .put('/settings')
      .send({ slack: { botToken: '   ' } });

    expect(response.status).toBe(200);
    expect(mockSlack.validateBotToken).not.toHaveBeenCalled();
  });

  it('should trim botToken and appToken before saving', async () => {
    const mockSlack = createMockSlackService();
    const { app, mockRepository } = buildApp({ slackService: mockSlack });

    await request(app)
      .put('/settings')
      .send({ slack: { botToken: '  xoxb-token  ', appToken: '  xapp-token  ' } });

    expect(mockRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        slack: expect.objectContaining({
          botToken: 'xoxb-token',
          appToken: 'xapp-token',
        }),
      })
    );
  });

  it('should notify slackChanged when slack settings differ', async () => {
    const mockSlack = createMockSlackService();
    const { app, onSettingsChange } = buildApp({ slackService: mockSlack });

    const response = await request(app)
      .put('/settings')
      .send({ slack: { botToken: 'xoxb-new-token' } });

    expect(response.status).toBe(200);
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ slackChanged: true })
    );
  });
});

describe('SettingsRouter - agentProfiles validation', () => {
  it('should accept valid agent profiles with anthropic provider', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .put('/settings')
      .send({ agentProfiles: [validAnthropicProfile()] });

    expect(response.status).toBe(200);
  });

  it('should accept valid agent profiles with opencode provider', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .put('/settings')
      .send({
        agentProfiles: [{
          id: 'oc-1',
          name: 'Opencode',
          provider: 'opencode',
          isDefault: true,
          opencodeConfig: { configPath: '/tmp/opencode.json' },
        }],
      });

    expect(response.status).toBe(200);
  });

  it('should reject non-array agentProfiles', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .put('/settings')
      .send({ agentProfiles: 'not-array' });

    expect(response.status).toBe(400);
    const body = response.body as ErrorResponse;
    expect(body.error).toContain('agentProfiles must be an array');
  });

  it('should reject empty agentProfiles array', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .put('/settings')
      .send({ agentProfiles: [] });

    expect(response.status).toBe(400);
    const body = response.body as ErrorResponse;
    expect(body.error).toContain('At least one agent profile is required');
  });

  it('should reject non-object profile', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .put('/settings')
      .send({ agentProfiles: ['not-an-object'] });

    expect(response.status).toBe(400);
    const body = response.body as ErrorResponse;
    expect(body.error).toContain('Each profile must be an object');
  });

  it('should reject profile without id', async () => {
    const { app } = buildApp();

    const profile = validAnthropicProfile();
    delete profile.id;
    const response = await request(app)
      .put('/settings')
      .send({ agentProfiles: [profile] });

    expect(response.status).toBe(400);
    const body = response.body as ErrorResponse;
    expect(body.error).toContain('Each profile must have a non-empty id');
  });

  it('should reject profile with empty id', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .put('/settings')
      .send({ agentProfiles: [validAnthropicProfile({ id: '  ' })] });

    expect(response.status).toBe(400);
    const body = response.body as ErrorResponse;
    expect(body.error).toContain('Each profile must have a non-empty id');
  });

  it('should reject duplicate profile ids', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .put('/settings')
      .send({
        agentProfiles: [
          validAnthropicProfile({ id: 'dup', isDefault: true }),
          validAnthropicProfile({ id: 'dup', isDefault: false }),
        ],
      });

    expect(response.status).toBe(400);
    const body = response.body as ErrorResponse;
    expect(body.error).toContain('Duplicate profile id: dup');
  });

  it('should reject profile without name', async () => {
    const { app } = buildApp();

    const profile = validAnthropicProfile();
    delete profile.name;
    const response = await request(app)
      .put('/settings')
      .send({ agentProfiles: [profile] });

    expect(response.status).toBe(400);
    const body = response.body as ErrorResponse;
    expect(body.error).toContain('Each profile must have a non-empty name');
  });

  it('should reject profile with empty name', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .put('/settings')
      .send({ agentProfiles: [validAnthropicProfile({ name: '' })] });

    expect(response.status).toBe(400);
    const body = response.body as ErrorResponse;
    expect(body.error).toContain('Each profile must have a non-empty name');
  });

  it('should reject profile with invalid provider', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .put('/settings')
      .send({ agentProfiles: [validAnthropicProfile({ provider: 'openai' })] });

    expect(response.status).toBe(400);
    const body = response.body as ErrorResponse;
    expect(body.error).toContain('Profile provider must be');
  });

  it('should reject profiles with no default', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .put('/settings')
      .send({ agentProfiles: [validAnthropicProfile({ isDefault: false })] });

    expect(response.status).toBe(400);
    const body = response.body as ErrorResponse;
    expect(body.error).toContain('Exactly one profile must be marked as default');
  });

  it('should reject profiles with multiple defaults', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .put('/settings')
      .send({
        agentProfiles: [
          validAnthropicProfile({ id: 'p1', isDefault: true }),
          { id: 'p2', name: 'Second', provider: 'anthropic', isDefault: true, anthropicConfig: { runtime: 'sdk', authMode: 'pro-plan' } },
        ],
      });

    expect(response.status).toBe(400);
    const body = response.body as ErrorResponse;
    expect(body.error).toContain('Exactly one profile must be marked as default');
  });

  describe('anthropicConfig validation', () => {
    it('should reject missing anthropicConfig', async () => {
      const { app } = buildApp();

      const profile = validAnthropicProfile();
      delete profile.anthropicConfig;
      const response = await request(app)
        .put('/settings')
        .send({ agentProfiles: [profile] });

      expect(response.status).toBe(400);
      const body = response.body as ErrorResponse;
      expect(body.error).toContain('anthropicConfig is required');
    });

    it('should reject invalid runtime', async () => {
      const { app } = buildApp();

      const response = await request(app)
        .put('/settings')
        .send({
          agentProfiles: [validAnthropicProfile({ anthropicConfig: { runtime: 'unknown' } })],
        });

      expect(response.status).toBe(400);
      const body = response.body as ErrorResponse;
      expect(body.error).toContain('anthropicConfig.runtime must be');
    });

    it('should accept sdk runtime with pro-plan authMode', async () => {
      const { app } = buildApp();

      const response = await request(app)
        .put('/settings')
        .send({
          agentProfiles: [validAnthropicProfile({ anthropicConfig: { runtime: 'sdk', authMode: 'pro-plan' } })],
        });

      expect(response.status).toBe(200);
    });

    it('should accept sdk runtime with api-key authMode and apiKey', async () => {
      const { app } = buildApp();

      const response = await request(app)
        .put('/settings')
        .send({
          agentProfiles: [validAnthropicProfile({
            anthropicConfig: { runtime: 'sdk', authMode: 'api-key', apiKey: 'sk-test-key' },
          })],
        });

      expect(response.status).toBe(200);
    });

    it('should reject sdk with invalid authMode', async () => {
      const { app } = buildApp();

      const response = await request(app)
        .put('/settings')
        .send({
          agentProfiles: [validAnthropicProfile({
            anthropicConfig: { runtime: 'sdk', authMode: 'oauth' },
          })],
        });

      expect(response.status).toBe(400);
      const body = response.body as ErrorResponse;
      expect(body.error).toContain('anthropicConfig.authMode must be');
    });

    it('should reject sdk with api-key authMode but missing apiKey', async () => {
      const { app } = buildApp();

      const response = await request(app)
        .put('/settings')
        .send({
          agentProfiles: [validAnthropicProfile({
            anthropicConfig: { runtime: 'sdk', authMode: 'api-key' },
          })],
        });

      expect(response.status).toBe(400);
      const body = response.body as ErrorResponse;
      expect(body.error).toContain('API key is required');
    });

    it('should reject sdk with api-key authMode but empty apiKey', async () => {
      const { app } = buildApp();

      const response = await request(app)
        .put('/settings')
        .send({
          agentProfiles: [validAnthropicProfile({
            anthropicConfig: { runtime: 'sdk', authMode: 'api-key', apiKey: '   ' },
          })],
        });

      expect(response.status).toBe(400);
      const body = response.body as ErrorResponse;
      expect(body.error).toContain('API key is required');
    });
  });

  describe('opencodeConfig validation', () => {
    it('should accept opencode profile without opencodeConfig', async () => {
      const { app } = buildApp();

      const response = await request(app)
        .put('/settings')
        .send({
          agentProfiles: [{
            id: 'oc-1',
            name: 'Opencode',
            provider: 'opencode',
            isDefault: true,
          }],
        });

      expect(response.status).toBe(200);
    });

    it('should accept opencode profile with null opencodeConfig', async () => {
      const { app } = buildApp();

      const response = await request(app)
        .put('/settings')
        .send({
          agentProfiles: [{
            id: 'oc-1',
            name: 'Opencode',
            provider: 'opencode',
            isDefault: true,
            opencodeConfig: null,
          }],
        });

      expect(response.status).toBe(200);
    });

    it('should reject non-object opencodeConfig', async () => {
      const { app } = buildApp();

      const response = await request(app)
        .put('/settings')
        .send({
          agentProfiles: [{
            id: 'oc-1',
            name: 'Opencode',
            provider: 'opencode',
            isDefault: true,
            opencodeConfig: 'invalid',
          }],
        });

      expect(response.status).toBe(400);
      const body = response.body as ErrorResponse;
      expect(body.error).toContain('opencodeConfig must be an object');
    });

    it('should reject non-string configPath in opencodeConfig', async () => {
      const { app } = buildApp();

      const response = await request(app)
        .put('/settings')
        .send({
          agentProfiles: [{
            id: 'oc-1',
            name: 'Opencode',
            provider: 'opencode',
            isDefault: true,
            opencodeConfig: { configPath: 123 },
          }],
        });

      expect(response.status).toBe(400);
      const body = response.body as ErrorResponse;
      expect(body.error).toContain('opencodeConfig.configPath must be a string');
    });
  });
});

describe('SettingsRouter - onSettingsChange not provided', () => {
  it('should still update settings when onSettingsChange is undefined', async () => {
    const mockRepository = createMockSettingsRepository();
    const app = express();
    app.use(express.json());
    app.use('/settings', createSettingsRouter({
      settingsRepository: mockRepository,
      dataWipeService: createMockDataWipeService(),
    }));
    app.use(createErrorHandler());

    const response = await request(app)
      .put('/settings')
      .send({ maxConcurrentAgents: 3 });

    expect(response.status).toBe(200);
    expect(mockRepository.update).toHaveBeenCalled();
  });
});

describe('SettingsRouter - Docker resource limits edge cases', () => {
  it('should accept docker settings without resourceLimits', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .put('/settings')
      .send({ docker: { enabled: false, baseImage: 'my-image:v1' } });

    expect(response.status).toBe(200);
  });

  it('should reject non-number memoryMb', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .put('/settings')
      .send({ docker: { resourceLimits: { memoryMb: 'large' } } });

    expect(response.status).toBe(400);
    const body = response.body as ErrorResponse;
    expect(body.error).toContain('positive');
  });
});

describe('SettingsRouter - MCP http server with valid URL', () => {
  it('should accept http server with valid URL', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .put('/settings')
      .send({
        mcp: {
          servers: [
            { id: 'http-1', name: 'HTTP Server', type: 'http', url: 'https://example.com/mcp', enabled: true },
          ],
        },
      });

    expect(response.status).toBe(200);
  });
});
