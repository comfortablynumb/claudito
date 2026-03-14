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
  createMockRalphLoopService,
  sampleProject,
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

describe('Ralph Loop Routes', () => {
  const projectId = sampleProject.id;

  describe('POST /:id/ralph-loop/start', () => {
    it('should start a ralph loop with valid body', async () => {
      const ralphLoopService = createMockRalphLoopService();
      const deps = buildDeps({ ralphLoopService });
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${projectId}/ralph-loop/start`)
        .send({ taskDescription: 'Build a feature' });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('taskId');
      expect(res.body).toHaveProperty('config');
      expect(ralphLoopService.start).toHaveBeenCalledWith(
        projectId,
        expect.objectContaining({ taskDescription: 'Build a feature' })
      );
    });

    it('should use default settings when no models specified', async () => {
      const ralphLoopService = createMockRalphLoopService();
      const deps = buildDeps({ ralphLoopService });
      const app = buildApp(deps);

      await request(app)
        .post(`/api/projects/${projectId}/ralph-loop/start`)
        .send({ taskDescription: 'Do something' });

      expect(ralphLoopService.start).toHaveBeenCalledWith(
        projectId,
        expect.objectContaining({
          taskDescription: 'Do something',
          maxTurns: expect.any(Number),
        })
      );
    });

    it('should return 503 when ralph loop service is not available', async () => {
      const deps = buildDeps({ ralphLoopService: undefined });
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${projectId}/ralph-loop/start`)
        .send({ taskDescription: 'Build a feature' });

      expect(res.status).toBe(503);
      expect(res.body.error).toContain('not available');
    });

    it('should return 400 when task description is missing', async () => {
      const ralphLoopService = createMockRalphLoopService();
      const deps = buildDeps({ ralphLoopService });
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${projectId}/ralph-loop/start`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('should reject invalid worker model', async () => {
      const ralphLoopService = createMockRalphLoopService();
      const deps = buildDeps({ ralphLoopService });
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${projectId}/ralph-loop/start`)
        .send({ taskDescription: 'Do it', workerModel: 'invalid-model-xyz' });

      expect(res.status).toBe(400);
    });

    it('should reject invalid reviewer model', async () => {
      const ralphLoopService = createMockRalphLoopService();
      const deps = buildDeps({ ralphLoopService });
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${projectId}/ralph-loop/start`)
        .send({ taskDescription: 'Do it', reviewerModel: 'invalid-model-xyz' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /:id/ralph-loop', () => {
    it('should list ralph loops for a project', async () => {
      const ralphLoopService = createMockRalphLoopService();
      const deps = buildDeps({ ralphLoopService });
      const app = buildApp(deps);

      const res = await request(app)
        .get(`/api/projects/${projectId}/ralph-loop`);

      expect(res.status).toBe(200);
      expect(ralphLoopService.listByProject).toHaveBeenCalledWith(projectId);
    });

    it('should return 503 when service is not available', async () => {
      const deps = buildDeps({ ralphLoopService: undefined });
      const app = buildApp(deps);

      const res = await request(app)
        .get(`/api/projects/${projectId}/ralph-loop`);

      expect(res.status).toBe(503);
    });
  });

  describe('GET /:id/ralph-loop/:taskId', () => {
    it('should get a specific ralph loop state', async () => {
      const ralphLoopService = createMockRalphLoopService();
      // Start a loop so getState returns something
      const startResult = await ralphLoopService.start(projectId, {
        taskDescription: 'test',
        maxTurns: 5,
        workerModel: 'claude-sonnet-4-6',
        reviewerModel: 'claude-sonnet-4-6',
      });
      const taskId = startResult.taskId;

      const deps = buildDeps({ ralphLoopService });
      const app = buildApp(deps);

      const res = await request(app)
        .get(`/api/projects/${projectId}/ralph-loop/${taskId}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('taskId', taskId);
    });

    it('should return 404 when ralph loop not found', async () => {
      const ralphLoopService = createMockRalphLoopService();
      const deps = buildDeps({ ralphLoopService });
      const app = buildApp(deps);

      const res = await request(app)
        .get(`/api/projects/${projectId}/ralph-loop/nonexistent-task`);

      expect(res.status).toBe(404);
    });

    it('should return 503 when service is not available', async () => {
      const deps = buildDeps({ ralphLoopService: undefined });
      const app = buildApp(deps);

      const res = await request(app)
        .get(`/api/projects/${projectId}/ralph-loop/some-task`);

      expect(res.status).toBe(503);
    });
  });

  describe('POST /:id/ralph-loop/:taskId/stop', () => {
    it('should stop a running ralph loop', async () => {
      const ralphLoopService = createMockRalphLoopService();
      const startResult = await ralphLoopService.start(projectId, {
        taskDescription: 'test',
        maxTurns: 5,
        workerModel: 'claude-sonnet-4-6',
        reviewerModel: 'claude-sonnet-4-6',
      });
      const taskId = startResult.taskId;

      const deps = buildDeps({ ralphLoopService });
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${projectId}/ralph-loop/${taskId}/stop`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(ralphLoopService.stop).toHaveBeenCalledWith(projectId, taskId);
    });

    it('should return 404 when ralph loop not found', async () => {
      const ralphLoopService = createMockRalphLoopService();
      const deps = buildDeps({ ralphLoopService });
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${projectId}/ralph-loop/nonexistent-task/stop`);

      expect(res.status).toBe(404);
    });

    it('should return 503 when service is not available', async () => {
      const deps = buildDeps({ ralphLoopService: undefined });
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${projectId}/ralph-loop/some-task/stop`);

      expect(res.status).toBe(503);
    });
  });

  describe('POST /:id/ralph-loop/:taskId/pause', () => {
    it('should pause a running ralph loop', async () => {
      const ralphLoopService = createMockRalphLoopService();
      const startResult = await ralphLoopService.start(projectId, {
        taskDescription: 'test',
        maxTurns: 5,
        workerModel: 'claude-sonnet-4-6',
        reviewerModel: 'claude-sonnet-4-6',
      });
      const taskId = startResult.taskId;

      // Mock getState to return worker_running status
      ralphLoopService.getState.mockResolvedValueOnce({
        taskId,
        projectId,
        config: startResult.config,
        currentIteration: 1,
        status: 'worker_running',
        summaries: [],
        feedback: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const deps = buildDeps({ ralphLoopService });
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${projectId}/ralph-loop/${taskId}/pause`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(ralphLoopService.pause).toHaveBeenCalledWith(projectId, taskId);
    });

    it('should return 409 when loop is already paused', async () => {
      const ralphLoopService = createMockRalphLoopService();
      const startResult = await ralphLoopService.start(projectId, {
        taskDescription: 'test',
        maxTurns: 5,
        workerModel: 'claude-sonnet-4-6',
        reviewerModel: 'claude-sonnet-4-6',
      });
      const taskId = startResult.taskId;

      ralphLoopService.getState.mockResolvedValueOnce({
        taskId,
        projectId,
        config: startResult.config,
        currentIteration: 1,
        status: 'paused',
        summaries: [],
        feedback: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const deps = buildDeps({ ralphLoopService });
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${projectId}/ralph-loop/${taskId}/pause`);

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('already paused');
    });

    it('should return 409 when loop is not running', async () => {
      const ralphLoopService = createMockRalphLoopService();
      const startResult = await ralphLoopService.start(projectId, {
        taskDescription: 'test',
        maxTurns: 5,
        workerModel: 'claude-sonnet-4-6',
        reviewerModel: 'claude-sonnet-4-6',
      });
      const taskId = startResult.taskId;

      ralphLoopService.getState.mockResolvedValueOnce({
        taskId,
        projectId,
        config: startResult.config,
        currentIteration: 1,
        status: 'completed',
        summaries: [],
        feedback: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const deps = buildDeps({ ralphLoopService });
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${projectId}/ralph-loop/${taskId}/pause`);

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('not running');
    });

    it('should return 404 when loop not found', async () => {
      const ralphLoopService = createMockRalphLoopService();
      const deps = buildDeps({ ralphLoopService });
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${projectId}/ralph-loop/nonexistent/pause`);

      expect(res.status).toBe(404);
    });

    it('should return 503 when service is not available', async () => {
      const deps = buildDeps({ ralphLoopService: undefined });
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${projectId}/ralph-loop/some-task/pause`);

      expect(res.status).toBe(503);
    });
  });

  describe('POST /:id/ralph-loop/:taskId/resume', () => {
    it('should resume a paused ralph loop', async () => {
      const ralphLoopService = createMockRalphLoopService();
      const startResult = await ralphLoopService.start(projectId, {
        taskDescription: 'test',
        maxTurns: 5,
        workerModel: 'claude-sonnet-4-6',
        reviewerModel: 'claude-sonnet-4-6',
      });
      const taskId = startResult.taskId;

      ralphLoopService.getState.mockResolvedValueOnce({
        taskId,
        projectId,
        config: startResult.config,
        currentIteration: 1,
        status: 'paused',
        summaries: [],
        feedback: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const deps = buildDeps({ ralphLoopService });
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${projectId}/ralph-loop/${taskId}/resume`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(ralphLoopService.resume).toHaveBeenCalledWith(projectId, taskId);
    });

    it('should return 409 when loop is not paused', async () => {
      const ralphLoopService = createMockRalphLoopService();
      const startResult = await ralphLoopService.start(projectId, {
        taskDescription: 'test',
        maxTurns: 5,
        workerModel: 'claude-sonnet-4-6',
        reviewerModel: 'claude-sonnet-4-6',
      });
      const taskId = startResult.taskId;

      ralphLoopService.getState.mockResolvedValueOnce({
        taskId,
        projectId,
        config: startResult.config,
        currentIteration: 1,
        status: 'worker_running',
        summaries: [],
        feedback: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const deps = buildDeps({ ralphLoopService });
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${projectId}/ralph-loop/${taskId}/resume`);

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('not paused');
    });

    it('should return 404 when loop not found', async () => {
      const ralphLoopService = createMockRalphLoopService();
      const deps = buildDeps({ ralphLoopService });
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${projectId}/ralph-loop/nonexistent/resume`);

      expect(res.status).toBe(404);
    });

    it('should return 503 when service is not available', async () => {
      const deps = buildDeps({ ralphLoopService: undefined });
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${projectId}/ralph-loop/some-task/resume`);

      expect(res.status).toBe(503);
    });
  });

  describe('DELETE /:id/ralph-loop/:taskId', () => {
    it('should delete a ralph loop', async () => {
      const ralphLoopService = createMockRalphLoopService();
      // Start a loop so it exists for deletion
      const startResult = await ralphLoopService.start(projectId, {
        taskDescription: 'test',
        maxTurns: 5,
        workerModel: 'claude-sonnet-4-6',
        reviewerModel: 'claude-sonnet-4-6',
      });
      const taskId = startResult.taskId;

      const deps = buildDeps({ ralphLoopService });
      const app = buildApp(deps);

      const res = await request(app)
        .delete(`/api/projects/${projectId}/ralph-loop/${taskId}`);

      expect(res.status).toBe(204);
      expect(ralphLoopService.delete).toHaveBeenCalledWith(projectId, taskId);
    });

    it('should return 404 when ralph loop not found for delete', async () => {
      const ralphLoopService = createMockRalphLoopService();
      ralphLoopService.delete.mockResolvedValueOnce(false);
      const deps = buildDeps({ ralphLoopService });
      const app = buildApp(deps);

      const res = await request(app)
        .delete(`/api/projects/${projectId}/ralph-loop/nonexistent`);

      expect(res.status).toBe(404);
    });

    it('should return 503 when service is not available', async () => {
      const deps = buildDeps({ ralphLoopService: undefined });
      const app = buildApp(deps);

      const res = await request(app)
        .delete(`/api/projects/${projectId}/ralph-loop/some-task`);

      expect(res.status).toBe(503);
    });
  });
});
