import express, { Express } from 'express';
import request from 'supertest';
import {
  createMockProjectRepository,
  createMockProjectService,
  createMockAgentManager,
  createMockSettingsRepository,
  createMockRoadmapParser,
  createMockRoadmapGenerator,
  createMockRoadmapEditor,
  createMockConversationRepository,
  createMockGitService,
  createMockInstructionGenerator,
  sampleProject,
  sampleContextUsage,
} from '../../helpers/mock-factories';
import { createProjectsRouter, ProjectRouterDependencies } from '../../../../src/routes/projects';
import { createErrorHandler } from '../../../../src/utils';

// Mock fs module
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      readFile: jest.fn(),
      writeFile: jest.fn(),
      access: jest.fn(),
      stat: jest.fn(),
      mkdir: jest.fn().mockResolvedValue(undefined),
    },
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    statSync: jest.fn(),
  };
});

// Mock rate limit middleware
jest.mock('../../../../src/middleware/rate-limit', () => ({
  roadmapGenerationRateLimit: (_req: any, _res: any, next: any) => next(),
  agentOperationRateLimit: (_req: any, _res: any, next: any) => next(),
  moderateRateLimit: (_req: any, _res: any, next: any) => next(),
  strictRateLimit: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../../../src/routes', () => ({
  ...jest.requireActual('../../../../src/routes'),
  getWebSocketServer: jest.fn(() => null),
  getAgentManager: jest.fn(() => null),
  getProcessTracker: jest.fn(() => null),
  getRalphLoopService: jest.fn(() => null),
}));

import fs from 'fs';

function buildApp(deps: ProjectRouterDependencies): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/projects', createProjectsRouter(deps));
  app.use(createErrorHandler());
  return app;
}

function buildDeps(overrides?: Partial<ProjectRouterDependencies>): ProjectRouterDependencies {
  return {
    projectRepository: createMockProjectRepository([{ ...sampleProject }]),
    projectService: createMockProjectService(),
    roadmapParser: createMockRoadmapParser(),
    roadmapGenerator: createMockRoadmapGenerator(),
    roadmapEditor: createMockRoadmapEditor(),
    agentManager: createMockAgentManager(),
    instructionGenerator: createMockInstructionGenerator(),
    conversationRepository: createMockConversationRepository(),
    settingsRepository: createMockSettingsRepository(),
    gitService: createMockGitService(),
    ...overrides,
  };
}

const PROJECT_ID = sampleProject.id;

describe('Agent routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // POST /:id/agent/start
  // ==========================================================================
  describe('POST /:id/agent/start', () => {
    it('should start autonomous loop when roadmap exists', async () => {
      (fs.promises.access as jest.Mock).mockResolvedValue(undefined);
      const deps = buildDeps();
      const app = buildApp(deps);

      const response = await request(app)
        .post(`/api/projects/${PROJECT_ID}/agent/start`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(deps.agentManager.startAutonomousLoop).toHaveBeenCalledWith(PROJECT_ID);
    });

    it('should return conflict when agent is already running', async () => {
      const deps = buildDeps();
      deps.agentManager.isRunning = jest.fn().mockReturnValue(true);
      const app = buildApp(deps);

      const response = await request(app)
        .post(`/api/projects/${PROJECT_ID}/agent/start`);

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('already running');
    });

    it('should return validation error when roadmap not found', async () => {
      (fs.promises.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));
      const deps = buildDeps();
      const app = buildApp(deps);

      const response = await request(app)
        .post(`/api/projects/${PROJECT_ID}/agent/start`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Roadmap not found');
    });

    it('should return queued status when agent is queued', async () => {
      (fs.promises.access as jest.Mock).mockResolvedValue(undefined);
      const deps = buildDeps();
      deps.agentManager.isQueued = jest.fn().mockReturnValue(true);
      const app = buildApp(deps);

      const response = await request(app)
        .post(`/api/projects/${PROJECT_ID}/agent/start`);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('queued');
    });
  });

  // ==========================================================================
  // POST /:id/agent/stop
  // ==========================================================================
  describe('POST /:id/agent/stop', () => {
    it('should stop agent', async () => {
      const deps = buildDeps();
      const app = buildApp(deps);

      const response = await request(app)
        .post(`/api/projects/${PROJECT_ID}/agent/stop`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, status: 'stopped' });
      expect(deps.agentManager.stopAgent).toHaveBeenCalledWith(PROJECT_ID);
    });
  });

  // ==========================================================================
  // GET /:id/agent/status
  // ==========================================================================
  describe('GET /:id/agent/status', () => {
    it('should return full agent status', async () => {
      const deps = buildDeps();
      const app = buildApp(deps);

      const response = await request(app)
        .get(`/api/projects/${PROJECT_ID}/agent/status`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status');
    });
  });

  // ==========================================================================
  // GET /:id/agent/context
  // ==========================================================================
  describe('GET /:id/agent/context', () => {
    it('should return context from running agent', async () => {
      const deps = buildDeps();
      deps.agentManager.getContextUsage = jest.fn().mockReturnValue(sampleContextUsage);
      const app = buildApp(deps);

      const response = await request(app)
        .get(`/api/projects/${PROJECT_ID}/agent/context`);

      expect(response.status).toBe(200);
      expect(response.body.contextUsage).toEqual(sampleContextUsage);
    });

    it('should fall back to lastContextUsage when agent not running', async () => {
      const projectWithContext = {
        ...sampleProject,
        lastContextUsage: sampleContextUsage,
      };
      const deps = buildDeps({
        projectRepository: createMockProjectRepository([projectWithContext]),
      });
      deps.agentManager.getContextUsage = jest.fn().mockReturnValue(null);
      const app = buildApp(deps);

      const response = await request(app)
        .get(`/api/projects/${PROJECT_ID}/agent/context`);

      expect(response.status).toBe(200);
      expect(response.body.contextUsage).toEqual(sampleContextUsage);
    });

    it('should return null contextUsage when neither available', async () => {
      const deps = buildDeps();
      deps.agentManager.getContextUsage = jest.fn().mockReturnValue(null);
      const app = buildApp(deps);

      const response = await request(app)
        .get(`/api/projects/${PROJECT_ID}/agent/context`);

      expect(response.status).toBe(200);
      expect(response.body.contextUsage).toBeNull();
    });
  });

  // ==========================================================================
  // GET /:id/agent/queue
  // ==========================================================================
  describe('GET /:id/agent/queue', () => {
    it('should return queued messages', async () => {
      const deps = buildDeps();
      deps.agentManager.getQueuedMessages = jest.fn().mockReturnValue(['msg1', 'msg2']);
      const app = buildApp(deps);

      const response = await request(app)
        .get(`/api/projects/${PROJECT_ID}/agent/queue`);

      expect(response.status).toBe(200);
      expect(response.body.messages).toEqual(['msg1', 'msg2']);
    });
  });

  // ==========================================================================
  // GET /:id/agent/loop
  // ==========================================================================
  describe('GET /:id/agent/loop', () => {
    it('should return loop state when looping', async () => {
      const deps = buildDeps();
      const loopState = { isLooping: true, currentMilestone: null, currentConversationId: null };
      deps.agentManager.getLoopState = jest.fn().mockReturnValue(loopState);
      const app = buildApp(deps);

      const response = await request(app)
        .get(`/api/projects/${PROJECT_ID}/agent/loop`);

      expect(response.status).toBe(200);
      expect(response.body.isLooping).toBe(true);
    });

    it('should return not looping when no loop state', async () => {
      const deps = buildDeps();
      deps.agentManager.getLoopState = jest.fn().mockReturnValue(null);
      const app = buildApp(deps);

      const response = await request(app)
        .get(`/api/projects/${PROJECT_ID}/agent/loop`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ isLooping: false, progress: null });
    });
  });

  // ==========================================================================
  // DELETE /:id/agent/queue
  // ==========================================================================
  describe('DELETE /:id/agent/queue', () => {
    it('should remove project from queue', async () => {
      const deps = buildDeps();
      deps.agentManager.isQueued = jest.fn().mockReturnValue(true);
      const app = buildApp(deps);

      const response = await request(app)
        .delete(`/api/projects/${PROJECT_ID}/agent/queue`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(deps.agentManager.removeFromQueue).toHaveBeenCalledWith(PROJECT_ID);
    });

    it('should return error when not queued', async () => {
      const deps = buildDeps();
      deps.agentManager.isQueued = jest.fn().mockReturnValue(false);
      const app = buildApp(deps);

      const response = await request(app)
        .delete(`/api/projects/${PROJECT_ID}/agent/queue`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('not queued');
    });
  });

  // ==========================================================================
  // DELETE /:id/agent/queue/:index
  // ==========================================================================
  describe('DELETE /:id/agent/queue/:index', () => {
    it('should remove queued message by index', async () => {
      const deps = buildDeps();
      deps.agentManager.isRunning = jest.fn().mockReturnValue(true);
      deps.agentManager.removeQueuedMessage = jest.fn().mockReturnValue(true);
      deps.agentManager.getQueuedMessages = jest.fn().mockReturnValue([]);
      const app = buildApp(deps);

      const response = await request(app)
        .delete(`/api/projects/${PROJECT_ID}/agent/queue/0`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.remainingMessages).toEqual([]);
    });

    it('should return error when agent is not running', async () => {
      const deps = buildDeps();
      deps.agentManager.isRunning = jest.fn().mockReturnValue(false);
      const app = buildApp(deps);

      const response = await request(app)
        .delete(`/api/projects/${PROJECT_ID}/agent/queue/0`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('not running');
    });

    it('should return error when message removal fails', async () => {
      const deps = buildDeps();
      deps.agentManager.isRunning = jest.fn().mockReturnValue(true);
      deps.agentManager.removeQueuedMessage = jest.fn().mockReturnValue(false);
      const app = buildApp(deps);

      const response = await request(app)
        .delete(`/api/projects/${PROJECT_ID}/agent/queue/0`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Failed to remove');
    });
  });

  // ==========================================================================
  // POST /:id/agent/interactive
  // ==========================================================================
  describe('POST /:id/agent/interactive', () => {
    it('should start interactive agent session', async () => {
      const deps = buildDeps();
      deps.agentManager.getSessionId = jest.fn().mockReturnValue('session-123');
      const app = buildApp(deps);

      const response = await request(app)
        .post(`/api/projects/${PROJECT_ID}/agent/interactive`)
        .send({ message: 'Hello' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.mode).toBe('interactive');
      expect(response.body.sessionId).toBe('session-123');
    });

    it('should return conflict when autonomous agent is running', async () => {
      const deps = buildDeps();
      deps.agentManager.isRunning = jest.fn().mockReturnValue(true);
      deps.agentManager.getAgentMode = jest.fn().mockReturnValue('autonomous');
      const app = buildApp(deps);

      const response = await request(app)
        .post(`/api/projects/${PROJECT_ID}/agent/interactive`)
        .send({ message: 'Hello' });

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('autonomous');
    });

    it('should return conflict when another agent is running', async () => {
      const deps = buildDeps();
      deps.agentManager.isRunning = jest.fn().mockReturnValue(true);
      deps.agentManager.getAgentMode = jest.fn().mockReturnValue('interactive');
      const app = buildApp(deps);

      const response = await request(app)
        .post(`/api/projects/${PROJECT_ID}/agent/interactive`)
        .send({ message: 'Hello' });

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('already running');
    });

    it('should pass images and permissionMode to startInteractiveAgent', async () => {
      const deps = buildDeps();
      const app = buildApp(deps);

      await request(app)
        .post(`/api/projects/${PROJECT_ID}/agent/interactive`)
        .send({
          message: 'Check this',
          images: [{ type: 'base64', media_type: 'image/png', data: 'abc' }],
          sessionId: 'sess-1',
          permissionMode: 'plan',
        });

      expect(deps.agentManager.startInteractiveAgent).toHaveBeenCalledWith(
        PROJECT_ID,
        expect.objectContaining({
          initialMessage: 'Check this',
          sessionId: 'sess-1',
          permissionMode: 'plan',
        }),
      );
      // Verify images were passed (schema may strip some fields)
      const callArgs = (deps.agentManager.startInteractiveAgent as jest.Mock).mock.calls[0][1];
      expect(callArgs.images).toHaveLength(1);
      expect(callArgs.images[0].data).toBe('abc');
    });
  });

  // ==========================================================================
  // One-off agent routes
  // ==========================================================================
  describe('POST /:id/agent/oneoff/:oneOffId/stop', () => {
    it('should stop one-off agent', async () => {
      const deps = buildDeps();
      const app = buildApp(deps);

      const response = await request(app)
        .post(`/api/projects/${PROJECT_ID}/agent/oneoff/oo-1/stop`);

      expect(response.status).toBe(200);
      expect(deps.agentManager.stopOneOffAgent).toHaveBeenCalledWith('oo-1');
    });
  });

  describe('POST /:id/agent/oneoff/:oneOffId/send', () => {
    it('should send message to one-off agent', async () => {
      const deps = buildDeps();
      const app = buildApp(deps);

      const response = await request(app)
        .post(`/api/projects/${PROJECT_ID}/agent/oneoff/oo-1/send`)
        .send({ message: 'Hello one-off' });

      expect(response.status).toBe(200);
      expect(deps.agentManager.sendOneOffInput).toHaveBeenCalledWith('oo-1', 'Hello one-off', undefined);
    });

    it('should return error when no message or images provided', async () => {
      const deps = buildDeps();
      const app = buildApp(deps);

      const response = await request(app)
        .post(`/api/projects/${PROJECT_ID}/agent/oneoff/oo-1/send`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Message is required');
    });

    it('should accept images without message', async () => {
      const deps = buildDeps();
      const app = buildApp(deps);

      const response = await request(app)
        .post(`/api/projects/${PROJECT_ID}/agent/oneoff/oo-1/send`)
        .send({ images: [{ type: 'base64', media_type: 'image/png', data: 'abc' }] });

      expect(response.status).toBe(200);
      expect(deps.agentManager.sendOneOffInput).toHaveBeenCalledWith(
        'oo-1',
        '',
        [{ type: 'base64', media_type: 'image/png', data: 'abc' }],
      );
    });
  });

  describe('GET /:id/agent/oneoff/:oneOffId/status', () => {
    it('should return one-off agent status', async () => {
      const deps = buildDeps();
      deps.agentManager.getOneOffStatus = jest.fn().mockReturnValue({ status: 'running' });
      const app = buildApp(deps);

      const response = await request(app)
        .get(`/api/projects/${PROJECT_ID}/agent/oneoff/oo-1/status`);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('running');
    });

    it('should return 404 when one-off agent not found', async () => {
      const deps = buildDeps();
      deps.agentManager.getOneOffStatus = jest.fn().mockReturnValue(null);
      const app = buildApp(deps);

      const response = await request(app)
        .get(`/api/projects/${PROJECT_ID}/agent/oneoff/unknown/status`);

      expect(response.status).toBe(404);
    });
  });

  describe('GET /:id/agent/oneoff/:oneOffId/context', () => {
    it('should return one-off context usage', async () => {
      const deps = buildDeps();
      deps.agentManager.getOneOffContextUsage = jest.fn().mockReturnValue(sampleContextUsage);
      const app = buildApp(deps);

      const response = await request(app)
        .get(`/api/projects/${PROJECT_ID}/agent/oneoff/oo-1/context`);

      expect(response.status).toBe(200);
      expect(response.body.contextUsage).toEqual(sampleContextUsage);
    });
  });

  describe('GET /:id/agent/oneoff', () => {
    it('should list active one-off agents', async () => {
      const deps = buildDeps();
      deps.agentManager.getActiveOneOffAgents = jest.fn().mockReturnValue([
        { id: 'oo-1', projectId: PROJECT_ID },
      ]);
      const app = buildApp(deps);

      const response = await request(app)
        .get(`/api/projects/${PROJECT_ID}/agent/oneoff`);

      expect(response.status).toBe(200);
      expect(response.body.agents).toHaveLength(1);
    });
  });

  // ==========================================================================
  // POST /:id/agent/answer
  // ==========================================================================
  describe('POST /:id/agent/answer', () => {
    it('should send tool result when valid', async () => {
      const deps = buildDeps();
      deps.agentManager.isRunning = jest.fn().mockReturnValue(true);
      const app = buildApp(deps);

      const response = await request(app)
        .post(`/api/projects/${PROJECT_ID}/agent/answer`)
        .send({ toolUseId: 'tu-1', answers: { key: 'value' } });

      expect(response.status).toBe(200);
      expect(deps.agentManager.sendToolResult).toHaveBeenCalledWith(
        PROJECT_ID,
        'tu-1',
        JSON.stringify({ answers: { key: 'value' } }),
      );
    });

    it('should return error when toolUseId missing', async () => {
      const deps = buildDeps();
      const app = buildApp(deps);

      const response = await request(app)
        .post(`/api/projects/${PROJECT_ID}/agent/answer`)
        .send({ answers: { key: 'value' } });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('toolUseId');
    });

    it('should return error when answers missing', async () => {
      const deps = buildDeps();
      const app = buildApp(deps);

      const response = await request(app)
        .post(`/api/projects/${PROJECT_ID}/agent/answer`)
        .send({ toolUseId: 'tu-1' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('answers');
    });

    it('should return error when agent not running', async () => {
      const deps = buildDeps();
      deps.agentManager.isRunning = jest.fn().mockReturnValue(false);
      const app = buildApp(deps);

      const response = await request(app)
        .post(`/api/projects/${PROJECT_ID}/agent/answer`)
        .send({ toolUseId: 'tu-1', answers: { key: 'value' } });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('not running');
    });
  });

  // ==========================================================================
  // POST /:id/agent/send
  // ==========================================================================
  describe('POST /:id/agent/send', () => {
    it('should send message to interactive agent', async () => {
      const deps = buildDeps();
      deps.agentManager.isRunning = jest.fn().mockReturnValue(true);
      deps.agentManager.getAgentMode = jest.fn().mockReturnValue('interactive');
      const app = buildApp(deps);

      const response = await request(app)
        .post(`/api/projects/${PROJECT_ID}/agent/send`)
        .send({ message: 'Do something' });

      expect(response.status).toBe(200);
      expect(deps.agentManager.sendInput).toHaveBeenCalledWith(PROJECT_ID, 'Do something', undefined);
    });

    it('should handle plan feedback approval', async () => {
      const deps = buildDeps();
      deps.agentManager.hasPendingPlan = jest.fn().mockReturnValue(true);
      const app = buildApp(deps);

      const response = await request(app)
        .post(`/api/projects/${PROJECT_ID}/agent/send`)
        .send({ message: 'yes', planFeedback: true });

      expect(response.status).toBe(200);
      expect(deps.agentManager.approvePlan).toHaveBeenCalledWith(PROJECT_ID, 'yes');
    });

    it('should return error when agent not running', async () => {
      const deps = buildDeps();
      deps.agentManager.isRunning = jest.fn().mockReturnValue(false);
      deps.agentManager.hasPendingPlan = jest.fn().mockReturnValue(false);
      const app = buildApp(deps);

      const response = await request(app)
        .post(`/api/projects/${PROJECT_ID}/agent/send`)
        .send({ message: 'Hello' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('not running');
    });

    it('should return error when agent not in interactive mode', async () => {
      const deps = buildDeps();
      deps.agentManager.isRunning = jest.fn().mockReturnValue(true);
      deps.agentManager.getAgentMode = jest.fn().mockReturnValue('autonomous');
      const app = buildApp(deps);

      const response = await request(app)
        .post(`/api/projects/${PROJECT_ID}/agent/send`)
        .send({ message: 'Hello' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('not in interactive mode');
    });

    it('should return error when plan approval is pending', async () => {
      const deps = buildDeps();
      deps.agentManager.isRunning = jest.fn().mockReturnValue(true);
      deps.agentManager.getAgentMode = jest.fn().mockReturnValue('interactive');
      deps.agentManager.hasPendingPlan = jest.fn().mockReturnValue(true);
      const app = buildApp(deps);

      const response = await request(app)
        .post(`/api/projects/${PROJECT_ID}/agent/send`)
        .send({ message: 'Hello' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('plan approval');
    });
  });
});
