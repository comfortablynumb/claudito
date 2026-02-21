/* eslint-disable @typescript-eslint/unbound-method */
import request from 'supertest';
import express, { Express } from 'express';
import { createSettingsRouter, SettingsChangeEvent } from '../../../src/routes/settings';
import { SettingsRepository } from '../../../src/repositories';
import { DataWipeService, WipeSummary } from '../../../src/services/data-wipe-service';
import { createErrorHandler } from '../../../src/utils/errors';
import {
  createMockSettingsRepository,
  DEFAULT_TEST_SETTINGS,
} from '../helpers/mock-factories';

interface ErrorResponse {
  error: string;
}

function createMockDataWipeService(): jest.Mocked<DataWipeService> {
  return {
    wipeAll: jest.fn<Promise<WipeSummary>, []>().mockResolvedValue({
      projectsWiped: 2,
      globalDataDeleted: true,
      mcpTempDeleted: true,
    }),
  };
}

describe('SettingsRouter', () => {
  let mockRepository: jest.Mocked<SettingsRepository>;
  let mockDataWipeService: jest.Mocked<DataWipeService>;
  let app: Express;
  let onSettingsChange: jest.Mock<void, [SettingsChangeEvent]>;

  beforeEach(() => {
    mockRepository = createMockSettingsRepository();
    mockDataWipeService = createMockDataWipeService();
    onSettingsChange = jest.fn<void, [SettingsChangeEvent]>();
    app = express();
    app.use(express.json());
    app.use('/settings', createSettingsRouter({
      settingsRepository: mockRepository,
      dataWipeService: mockDataWipeService,
      onSettingsChange,
    }));
    // Add error handler to convert ValidationError to proper response
    app.use(createErrorHandler());
  });

  describe('GET /settings', () => {
    it('should return current settings', async () => {
      const response = await request(app).get('/settings');

      expect(response.status).toBe(200);
      expect(mockRepository.get).toHaveBeenCalled();
      expect(response.body).toMatchObject({
        maxConcurrentAgents: DEFAULT_TEST_SETTINGS.maxConcurrentAgents,
        sendWithCtrlEnter: DEFAULT_TEST_SETTINGS.sendWithCtrlEnter,
      });
    });
  });

  describe('GET /settings/models', () => {
    it('should return list of available models', async () => {
      const response = await request(app).get('/settings/models');

      expect(response.status).toBe(200);
      expect(response.body.models).toBeDefined();
      expect(Array.isArray(response.body.models)).toBe(true);
      expect(response.body.models.length).toBeGreaterThan(0);

      // Check that each model has id and displayName
      for (const model of response.body.models) {
        expect(model.id).toBeDefined();
        expect(model.displayName).toBeDefined();
      }
    });

    it('should include sonnet model', async () => {
      const response = await request(app).get('/settings/models');

      expect(response.status).toBe(200);
      const opusModel = response.body.models.find(
        (m: { id: string }) => m.id === 'claude-opus-4-6'
      );
      expect(opusModel).toBeDefined();
      expect(opusModel.displayName).toBe('Claude Opus 4.6');
    });

    it('should include sonnet model', async () => {
      const response = await request(app).get('/settings/models');

      expect(response.status).toBe(200);
      const sonnetModel = response.body.models.find(
        (m: { id: string }) => m.id === 'claude-sonnet-4-5-20250929'
      );
      expect(sonnetModel).toBeDefined();
      expect(sonnetModel.displayName).toBe('Claude Sonnet 4.5');
    });
  });

  describe('PUT /settings', () => {
    it('should update maxConcurrentAgents', async () => {
      const response = await request(app)
        .put('/settings')
        .send({ maxConcurrentAgents: 5 });

      expect(response.status).toBe(200);
      expect(mockRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ maxConcurrentAgents: 5 })
      );
      expect(onSettingsChange).toHaveBeenCalledWith({ maxConcurrentAgents: 5 });
    });

    it('should reject invalid maxConcurrentAgents (non-number)', async () => {
      const response = await request(app)
        .put('/settings')
        .send({ maxConcurrentAgents: 'five' });

      expect(response.status).toBe(400);
      const body = response.body as ErrorResponse;
      expect(body.error).toContain('maxConcurrentAgents must be a positive number');
    });

    it('should reject invalid maxConcurrentAgents (less than 1)', async () => {
      const response = await request(app)
        .put('/settings')
        .send({ maxConcurrentAgents: 0 });

      expect(response.status).toBe(400);
      const body = response.body as ErrorResponse;
      expect(body.error).toContain('maxConcurrentAgents must be a positive number');
    });

    it('should reject negative maxConcurrentAgents', async () => {
      const response = await request(app)
        .put('/settings')
        .send({ maxConcurrentAgents: -1 });

      expect(response.status).toBe(400);
      const body = response.body as ErrorResponse;
      expect(body.error).toContain('maxConcurrentAgents must be a positive number');
    });

    it('should update sendWithCtrlEnter', async () => {
      const response = await request(app)
        .put('/settings')
        .send({ sendWithCtrlEnter: false });

      expect(response.status).toBe(200);
      expect(mockRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ sendWithCtrlEnter: false })
      );
    });

    it('should update historyLimit', async () => {
      const response = await request(app)
        .put('/settings')
        .send({ historyLimit: 50 });

      expect(response.status).toBe(200);
      expect(mockRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ historyLimit: 50 })
      );
    });

    it('should update agentPromptTemplate', async () => {
      const template = 'New template content';
      const response = await request(app)
        .put('/settings')
        .send({ agentPromptTemplate: template });

      expect(response.status).toBe(200);
      expect(mockRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ agentPromptTemplate: template })
      );
    });

    it('should update enableDesktopNotifications', async () => {
      const response = await request(app)
        .put('/settings')
        .send({ enableDesktopNotifications: false });

      expect(response.status).toBe(200);
      expect(mockRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ enableDesktopNotifications: false })
      );
    });

    it('should notify when appendSystemPrompt changes', async () => {
      const response = await request(app)
        .put('/settings')
        .send({ appendSystemPrompt: 'New prompt' });

      expect(response.status).toBe(200);
      expect(onSettingsChange).toHaveBeenCalledWith({ appendSystemPromptChanged: true });
    });

    it('should not notify when appendSystemPrompt is same as current', async () => {
      // Set initial appendSystemPrompt
      mockRepository = createMockSettingsRepository({ appendSystemPrompt: 'Same prompt' });
      app = express();
      app.use(express.json());
      app.use('/settings', createSettingsRouter({
        settingsRepository: mockRepository,
        dataWipeService: mockDataWipeService,
        onSettingsChange,
      }));
      app.use(createErrorHandler());

      const response = await request(app)
        .put('/settings')
        .send({ appendSystemPrompt: 'Same prompt' });

      expect(response.status).toBe(200);
      expect(onSettingsChange).not.toHaveBeenCalled();
    });

    describe('claudePermissions validation', () => {
      it('should accept valid allowRules', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            claudePermissions: {
              allowRules: ['Read', 'Write', 'Bash(npm run:*)'],
            },
          });

        expect(response.status).toBe(200);
        expect(mockRepository.update).toHaveBeenCalled();
      });

      it('should accept valid denyRules', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            claudePermissions: {
              denyRules: ['Read(./.env)', 'Bash(rm -rf:*)'],
            },
          });

        expect(response.status).toBe(200);
        expect(mockRepository.update).toHaveBeenCalled();
      });

      it('should accept valid askRules', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            claudePermissions: {
              askRules: ['Write', 'Bash(git:*)'],
            },
          });

        expect(response.status).toBe(200);
        expect(mockRepository.update).toHaveBeenCalled();
      });

      it('should reject invalid rule format (empty string)', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            claudePermissions: {
              allowRules: [''],
            },
          });

        expect(response.status).toBe(400);
        const body = response.body as ErrorResponse;
        expect(body.error).toContain('Invalid permission rule');
      });

      it('should reject invalid rule format (starts with number)', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            claudePermissions: {
              allowRules: ['123Invalid'],
            },
          });

        expect(response.status).toBe(400);
        const body = response.body as ErrorResponse;
        expect(body.error).toContain('Invalid permission rule');
      });

      it('should reject non-string rules', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            claudePermissions: {
              allowRules: [123],
            },
          });

        expect(response.status).toBe(400);
        const body = response.body as ErrorResponse;
        expect(body.error).toContain('must contain only strings');
      });

      it('should reject non-array rules', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            claudePermissions: {
              allowRules: 'Read',
            },
          });

        expect(response.status).toBe(400);
        const body = response.body as ErrorResponse;
        expect(body.error).toContain('must be an array');
      });

      it('should accept rules with specifiers containing special characters', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            claudePermissions: {
              allowRules: ['Bash(npm run test:*)', 'Read(./src/**/*.ts)'],
            },
          });

        expect(response.status).toBe(200);
        expect(mockRepository.update).toHaveBeenCalled();
      });
    });

    it('should update multiple settings at once', async () => {
      const response = await request(app)
        .put('/settings')
        .send({
          maxConcurrentAgents: 5,
          sendWithCtrlEnter: false,
          historyLimit: 50,
        });

      expect(response.status).toBe(200);
      expect(mockRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          maxConcurrentAgents: 5,
          sendWithCtrlEnter: false,
          historyLimit: 50,
        })
      );
    });

    it('should return updated settings', async () => {
      const response = await request(app)
        .put('/settings')
        .send({ maxConcurrentAgents: 7 });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ maxConcurrentAgents: 7 });
    });

    it('should not call onSettingsChange when no relevant changes', async () => {
      const response = await request(app)
        .put('/settings')
        .send({ historyLimit: 50 });

      expect(response.status).toBe(200);
      expect(onSettingsChange).not.toHaveBeenCalled();
    });


    describe('promptTemplates validation', () => {
      it('should accept valid promptTemplates', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            promptTemplates: [
              { id: 'template-1', name: 'Test Template', content: 'Hello ${text:name}' },
              { id: 'template-2', name: 'Another Template', content: 'Content here', description: 'A description' },
            ],
          });

        expect(response.status).toBe(200);
        expect(mockRepository.update).toHaveBeenCalledWith(
          expect.objectContaining({
            promptTemplates: expect.arrayContaining([
              expect.objectContaining({ id: 'template-1', name: 'Test Template' }),
            ]),
          })
        );
      });

      it('should reject non-array promptTemplates', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            promptTemplates: 'not-an-array',
          });

        expect(response.status).toBe(400);
        const body = response.body as ErrorResponse;
        expect(body.error).toContain('promptTemplates must be an array');
      });

      it('should reject non-object templates', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            promptTemplates: ['not-an-object'],
          });

        expect(response.status).toBe(400);
        const body = response.body as ErrorResponse;
        expect(body.error).toContain('Each template must be an object');
      });

      it('should reject null templates', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            promptTemplates: [null],
          });

        expect(response.status).toBe(400);
        const body = response.body as ErrorResponse;
        expect(body.error).toContain('Each template must be an object');
      });

      it('should reject templates without id', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            promptTemplates: [{ name: 'Test', content: 'Hello' }],
          });

        expect(response.status).toBe(400);
        const body = response.body as ErrorResponse;
        expect(body.error).toContain('Each template must have a non-empty id');
      });

      it('should reject templates with empty id', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            promptTemplates: [{ id: '  ', name: 'Test', content: 'Hello' }],
          });

        expect(response.status).toBe(400);
        const body = response.body as ErrorResponse;
        expect(body.error).toContain('Each template must have a non-empty id');
      });

      it('should reject duplicate template ids', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            promptTemplates: [
              { id: 'same-id', name: 'First', content: 'Content 1' },
              { id: 'same-id', name: 'Second', content: 'Content 2' },
            ],
          });

        expect(response.status).toBe(400);
        const body = response.body as ErrorResponse;
        expect(body.error).toContain('Duplicate template id: same-id');
      });

      it('should reject templates without name', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            promptTemplates: [{ id: 'test-id', content: 'Hello' }],
          });

        expect(response.status).toBe(400);
        const body = response.body as ErrorResponse;
        expect(body.error).toContain('Each template must have a non-empty name');
      });

      it('should reject templates with empty name', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            promptTemplates: [{ id: 'test-id', name: '  ', content: 'Hello' }],
          });

        expect(response.status).toBe(400);
        const body = response.body as ErrorResponse;
        expect(body.error).toContain('Each template must have a non-empty name');
      });

      it('should reject templates without content', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            promptTemplates: [{ id: 'test-id', name: 'Test' }],
          });

        expect(response.status).toBe(400);
        const body = response.body as ErrorResponse;
        expect(body.error).toContain('Each template must have content');
      });

      it('should reject templates with non-string description', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            promptTemplates: [{ id: 'test-id', name: 'Test', content: 'Hello', description: 123 }],
          });

        expect(response.status).toBe(400);
        const body = response.body as ErrorResponse;
        expect(body.error).toContain('Template description must be a string');
      });

      it('should accept templates without description', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            promptTemplates: [{ id: 'test-id', name: 'Test', content: 'Hello' }],
          });

        expect(response.status).toBe(200);
      });
    });

    describe('chromeEnabled', () => {
      it('should forward chromeEnabled=true to repository', async () => {
        const response = await request(app)
          .put('/settings')
          .send({ chromeEnabled: true });

        expect(response.status).toBe(200);
        expect(mockRepository.update).toHaveBeenCalledWith(
          expect.objectContaining({ chromeEnabled: true })
        );
      });

      it('should forward chromeEnabled=false to repository', async () => {
        const response = await request(app)
          .put('/settings')
          .send({ chromeEnabled: false });

        expect(response.status).toBe(200);
        expect(mockRepository.update).toHaveBeenCalledWith(
          expect.objectContaining({ chromeEnabled: false })
        );
      });
    });

    describe('MCP validation', () => {
      it('should accept valid MCP configuration', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            mcp: {
              enabled: true,
              servers: [
                {
                  id: 'mcp-1',
                  name: 'Test Server',
                  enabled: true,
                  type: 'stdio',
                  command: 'npx @modelcontextprotocol/test',
                  args: ['--verbose'],
                  env: { API_KEY: 'test' },
                },
              ],
            },
          });

        expect(response.status).toBe(200);
        expect(mockRepository.update).toHaveBeenCalledWith(
          expect.objectContaining({
            mcp: expect.objectContaining({
              enabled: true,
              servers: expect.arrayContaining([
                expect.objectContaining({ id: 'mcp-1', name: 'Test Server' }),
              ]),
            }),
          })
        );
      });

      it('should notify when MCP configuration changes', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            mcp: {
              enabled: false,
              servers: [],
            },
          });

        expect(response.status).toBe(200);
        expect(onSettingsChange).toHaveBeenCalledWith({ mcpChanged: true });
      });

      it('should reject duplicate server IDs', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            mcp: {
              servers: [
                { id: 'dup-id', name: 'Server 1', type: 'stdio', command: 'cmd1', enabled: true },
                { id: 'dup-id', name: 'Server 2', type: 'stdio', command: 'cmd2', enabled: true },
              ],
            },
          });

        expect(response.status).toBe(400);
        const body = response.body as ErrorResponse;
        expect(body.error).toContain('Duplicate server ID');
      });

      it('should reject servers without name', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            mcp: {
              servers: [
                { id: 'test-id', name: '', type: 'stdio', command: 'cmd', enabled: true },
              ],
            },
          });

        expect(response.status).toBe(400);
        const body = response.body as ErrorResponse;
        expect(body.error).toContain('Server name is required');
      });

      it('should reject stdio servers without command', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            mcp: {
              servers: [
                { id: 'test-id', name: 'Test', type: 'stdio', command: '', enabled: true },
              ],
            },
          });

        expect(response.status).toBe(400);
        const body = response.body as ErrorResponse;
        expect(body.error).toContain('Command is required for stdio servers');
      });

      it('should reject http servers without URL', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            mcp: {
              servers: [
                { id: 'test-id', name: 'Test', type: 'http', url: '', enabled: true },
              ],
            },
          });

        expect(response.status).toBe(400);
        const body = response.body as ErrorResponse;
        expect(body.error).toContain('URL is required for http servers');
      });

      it('should reject http servers with invalid URL', async () => {
        const response = await request(app)
          .put('/settings')
          .send({
            mcp: {
              servers: [
                { id: 'test-id', name: 'Test', type: 'http', url: 'not-a-url', enabled: true },
              ],
            },
          });

        expect(response.status).toBe(400);
        const body = response.body as ErrorResponse;
        expect(body.error).toContain('Invalid URL');
      });
    });
  });

  describe('Docker validation', () => {
    it('should accept valid Docker settings', async () => {
      const response = await request(app)
        .put('/settings')
        .send({
          docker: {
            enabled: true,
            baseImage: 'claudito-agent:latest',
            resourceLimits: { cpus: 4, memoryMb: 8192 },
            networkMode: 'bridge',
          },
        });

      expect(response.status).toBe(200);
    });

    it('should accept partial Docker settings', async () => {
      const response = await request(app)
        .put('/settings')
        .send({ docker: { enabled: true } });

      expect(response.status).toBe(200);
    });

    it('should reject non-boolean enabled', async () => {
      const response = await request(app)
        .put('/settings')
        .send({ docker: { enabled: 'yes' } });

      expect(response.status).toBe(400);
      const body = response.body as ErrorResponse;
      expect(body.error).toContain('boolean');
    });

    it('should reject empty base image', async () => {
      const response = await request(app)
        .put('/settings')
        .send({ docker: { baseImage: '' } });

      expect(response.status).toBe(400);
      const body = response.body as ErrorResponse;
      expect(body.error).toContain('non-empty');
    });

    it('should reject invalid network mode', async () => {
      const response = await request(app)
        .put('/settings')
        .send({ docker: { networkMode: 'host' } });

      expect(response.status).toBe(400);
      const body = response.body as ErrorResponse;
      expect(body.error).toContain('bridge');
    });

    it('should reject negative CPU limit', async () => {
      const response = await request(app)
        .put('/settings')
        .send({ docker: { resourceLimits: { cpus: -1 } } });

      expect(response.status).toBe(400);
      const body = response.body as ErrorResponse;
      expect(body.error).toContain('positive');
    });

    it('should reject zero memory limit', async () => {
      const response = await request(app)
        .put('/settings')
        .send({ docker: { resourceLimits: { memoryMb: 0 } } });

      expect(response.status).toBe(400);
      const body = response.body as ErrorResponse;
      expect(body.error).toContain('positive');
    });

    it('should reject non-number CPU limit', async () => {
      const response = await request(app)
        .put('/settings')
        .send({ docker: { resourceLimits: { cpus: 'fast' } } });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /settings/wipe-all-data', () => {
    it('should call dataWipeService.wipeAll and return summary', async () => {
      const response = await request(app).post('/settings/wipe-all-data');

      expect(response.status).toBe(200);
      expect(mockDataWipeService.wipeAll).toHaveBeenCalled();
      expect(response.body).toEqual({
        projectsWiped: 2,
        globalDataDeleted: true,
        mcpTempDeleted: true,
      });
    });

    it('should return 500 when wipeAll fails', async () => {
      mockDataWipeService.wipeAll.mockRejectedValue(new Error('Wipe failed'));

      const response = await request(app).post('/settings/wipe-all-data');

      expect(response.status).toBe(500);
    });
  });
});
