import express, { Express } from 'express';
import request from 'supertest';
import {
  createProjectsRouter,
  ProjectRouterDependencies,
} from '../../../../src/routes/projects';
import {
  createMockProjectRepository,
  createMockProjectService,
  createMockRoadmapParser,
  createMockRoadmapGenerator,
  createMockRoadmapEditor,
  createMockAgentManager,
  createMockConversationRepository,
  createMockSettingsRepository,
  createMockGitService,
  createMockInstructionGenerator,
  sampleProject,
} from '../../helpers/mock-factories';
import { ProjectRepository, SlackNotificationConfig } from '../../../../src/repositories/project';
import { createErrorHandler } from '../../../../src/utils';

jest.mock('../../../../src/middleware/rate-limit', () => ({
  roadmapGenerationRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
  agentOperationRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
  moderateRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
  strictRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../../../src/routes', () => ({
  ...jest.requireActual('../../../../src/routes'),
  getWebSocketServer: jest.fn(() => null),
  getAgentManager: jest.fn(() => null),
  getProcessTracker: jest.fn(() => null),
  getRalphLoopService: jest.fn(() => null),
}));

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
    existsSync: jest.fn().mockReturnValue(false),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    statSync: jest.fn(),
  };
});

describe('Slack Routes', () => {
  let app: Express;
  let mockProjectRepo: jest.Mocked<ProjectRepository> & { getProjectPath: jest.Mock };
  const projectId = sampleProject.id;
  const basePath = `/api/projects/${projectId}/slack`;

  function setupApp(): void {
    mockProjectRepo = createMockProjectRepository([{ ...sampleProject }]);

    const deps: ProjectRouterDependencies = {
      projectRepository: mockProjectRepo,
      projectService: createMockProjectService(),
      roadmapParser: createMockRoadmapParser(),
      roadmapGenerator: createMockRoadmapGenerator(),
      roadmapEditor: createMockRoadmapEditor(),
      agentManager: createMockAgentManager(),
      instructionGenerator: createMockInstructionGenerator(),
      conversationRepository: createMockConversationRepository(),
      settingsRepository: createMockSettingsRepository(),
      gitService: createMockGitService(),
    };

    app = express();
    app.use(express.json());
    app.use('/api/projects', createProjectsRouter(deps));
    app.use(createErrorHandler());
  }

  beforeEach(() => {
    setupApp();
  });

  describe('GET /:id/slack', () => {
    it('returns null when no slack config exists', async () => {
      const res = await request(app).get(basePath);

      expect(res.status).toBe(200);
      expect(res.body).toBeNull();
    });

    it('returns slack config when it exists', async () => {
      const config: SlackNotificationConfig = {
        channelId: 'C_TEST',
        events: ['agent_completed', 'agent_failed'],
        mentionUsers: ['U123'],
        threadReplies: true,
      };
      mockProjectRepo.findById.mockResolvedValue({
        ...sampleProject,
        slackNotification: config,
      } as never);

      const res = await request(app).get(basePath);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(config);
    });

    it('returns 404 for non-existent project', async () => {
      const res = await request(app).get('/api/projects/nonexistent/slack');

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /:id/slack', () => {
    it('saves a valid slack config', async () => {
      const config: SlackNotificationConfig = {
        channelId: 'C_NEW',
        events: ['agent_completed', 'ralph_loop_complete'],
        mentionUsers: ['U456'],
        threadReplies: false,
      };
      mockProjectRepo.updateSlackNotification.mockResolvedValue({
        ...sampleProject,
        slackNotification: config,
      });

      const res = await request(app)
        .put(basePath)
        .send(config);

      expect(res.status).toBe(200);
      expect(mockProjectRepo.updateSlackNotification).toHaveBeenCalledWith(
        projectId,
        expect.objectContaining({ channelId: 'C_NEW' }),
      );
    });

    it('returns 400 when body has no channelId (null-like body)', async () => {
      const res = await request(app)
        .put(basePath)
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 400 when channelId is missing', async () => {
      const res = await request(app)
        .put(basePath)
        .send({ events: ['agent_completed'] });

      expect(res.status).toBe(400);
    });

    it('filters out invalid events', async () => {
      mockProjectRepo.updateSlackNotification.mockResolvedValue({
        ...sampleProject,
        slackNotification: {
          channelId: 'C_CHAN',
          events: ['agent_completed'],
          mentionUsers: [],
          threadReplies: false,
        },
      });

      const res = await request(app)
        .put(basePath)
        .send({
          channelId: 'C_CHAN',
          events: ['agent_completed', 'invalid_event', 'agent_failed'],
        });

      expect(res.status).toBe(200);
      expect(mockProjectRepo.updateSlackNotification).toHaveBeenCalledWith(
        projectId,
        expect.objectContaining({
          events: ['agent_completed', 'agent_failed'],
        }),
      );
    });

    it('filters out non-string mentionUsers', async () => {
      mockProjectRepo.updateSlackNotification.mockResolvedValue({
        ...sampleProject,
        slackNotification: {
          channelId: 'C_CHAN',
          events: [],
          mentionUsers: ['U123'],
          threadReplies: false,
        },
      });

      const res = await request(app)
        .put(basePath)
        .send({
          channelId: 'C_CHAN',
          mentionUsers: ['U123', 42, null, 'U456'],
        });

      expect(res.status).toBe(200);
      expect(mockProjectRepo.updateSlackNotification).toHaveBeenCalledWith(
        projectId,
        expect.objectContaining({
          mentionUsers: ['U123', 'U456'],
        }),
      );
    });

    it('defaults threadReplies to false when not provided', async () => {
      mockProjectRepo.updateSlackNotification.mockResolvedValue({
        ...sampleProject,
        slackNotification: {
          channelId: 'C_CHAN',
          events: [],
          mentionUsers: [],
          threadReplies: false,
        },
      });

      const res = await request(app)
        .put(basePath)
        .send({ channelId: 'C_CHAN' });

      expect(res.status).toBe(200);
      expect(mockProjectRepo.updateSlackNotification).toHaveBeenCalledWith(
        projectId,
        expect.objectContaining({ threadReplies: false }),
      );
    });
  });

  describe('DELETE /:id/slack', () => {
    it('deletes slack config and returns success', async () => {
      mockProjectRepo.updateSlackNotification.mockResolvedValue({
        ...sampleProject,
        slackNotification: undefined,
      });

      const res = await request(app).delete(basePath);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(mockProjectRepo.updateSlackNotification).toHaveBeenCalledWith(
        projectId,
        null,
      );
    });

    it('returns 404 for non-existent project', async () => {
      const res = await request(app).delete('/api/projects/nonexistent/slack');

      expect(res.status).toBe(404);
    });
  });
});
