/* eslint-disable @typescript-eslint/unbound-method */
import request from 'supertest';
import express, { Express } from 'express';
import { createAgentRouter } from '../../../src/routes/projects/agent';
import { createErrorHandler } from '../../../src/utils/errors';
import { createMockAgentManager } from '../helpers/mock-factories';
import { AgentManager, FullAgentStatus } from '../../../src/agents/agent-manager';
import { ProjectRepository } from '../../../src/repositories';

describe('Agent Router - One-off endpoints', () => {
  let app: Express;
  let mockAgentManager: jest.Mocked<AgentManager>;
  let mockProjectRepository: jest.Mocked<ProjectRepository>;

  beforeEach(() => {
    mockAgentManager = createMockAgentManager();
    mockProjectRepository = {
      findById: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as jest.Mocked<ProjectRepository>;

    app = express();
    app.use(express.json());
    app.use('/agent', createAgentRouter({
      projectRepository: mockProjectRepository,
      agentManager: mockAgentManager,
    } as any));
    app.use(createErrorHandler());
  });

  describe('POST /agent/oneoff/:oneOffId/send', () => {
    it('should send message to one-off agent', async () => {
      const response = await request(app)
        .post('/agent/oneoff/oneoff-123/send')
        .send({ message: 'test message' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockAgentManager.sendOneOffInput).toHaveBeenCalledWith(
        'oneoff-123', 'test message', undefined
      );
    });

    it('should return 400 for empty message', async () => {
      const response = await request(app)
        .post('/agent/oneoff/oneoff-123/send')
        .send({});

      expect(response.status).toBe(400);
    });

    it('should accept images with message', async () => {
      const images = [{ type: 'image/png', data: 'abc' }];
      const response = await request(app)
        .post('/agent/oneoff/oneoff-123/send')
        .send({ message: 'with image', images });

      expect(response.status).toBe(200);
      expect(mockAgentManager.sendOneOffInput).toHaveBeenCalledWith(
        'oneoff-123', 'with image', images
      );
    });
  });

  describe('GET /agent/oneoff/:oneOffId/status', () => {
    it('should return agent status', async () => {
      const mockStatus: FullAgentStatus = {
        status: 'running',
        mode: 'interactive',
        queued: false,
        queuedMessageCount: 0,
        isWaitingForInput: false,
        waitingVersion: 0,
        sessionId: null,
        permissionMode: 'acceptEdits',
        hasActiveOneOffAgents: false,
      };

      mockAgentManager.getOneOffStatus.mockReturnValue(mockStatus);

      const response = await request(app)
        .get('/agent/oneoff/oneoff-123/status');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('running');
      expect(response.body.mode).toBe('interactive');
    });

    it('should return 404 for unknown agent', async () => {
      mockAgentManager.getOneOffStatus.mockReturnValue(null);

      const response = await request(app)
        .get('/agent/oneoff/nonexistent/status');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('One-off agent not found');
    });
  });

  describe('GET /agent/oneoff/:oneOffId/context', () => {
    it('should return context usage', async () => {
      const mockContext = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        maxContextTokens: 200000,
        percentUsed: 0.0075,
      };

      mockAgentManager.getOneOffContextUsage.mockReturnValue(mockContext);

      const response = await request(app)
        .get('/agent/oneoff/oneoff-123/context');

      expect(response.status).toBe(200);
      expect(response.body.contextUsage).toEqual(mockContext);
    });

    it('should return null context for unknown agent', async () => {
      mockAgentManager.getOneOffContextUsage.mockReturnValue(null);

      const response = await request(app)
        .get('/agent/oneoff/nonexistent/context');

      expect(response.status).toBe(200);
      expect(response.body.contextUsage).toBeNull();
    });
  });
});
