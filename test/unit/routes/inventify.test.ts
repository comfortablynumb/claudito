import request from 'supertest';
import express from 'express';
import { createInventifyRouter } from '../../../src/routes/projects/inventify';
import {
  createMockSettingsRepository,
  createMockProjectRepository,
  createMockProjectService,
  createMockRoadmapParser,
  createMockRoadmapGenerator,
  createMockRoadmapEditor,
  createMockAgentManager,
  createMockInstructionGenerator,
  createMockConversationRepository,
  createMockGitService,
  createMockInventifyService,
} from '../helpers/mock-factories';
import { ProjectRouterDependencies } from '../../../src/routes/projects/types';

function createTestApp(deps: Partial<ProjectRouterDependencies> = {}) {
  const app = express();
  app.use(express.json());

  const defaultDeps: ProjectRouterDependencies = {
    projectRepository: createMockProjectRepository(),
    projectService: createMockProjectService(),
    roadmapParser: createMockRoadmapParser(),
    roadmapGenerator: createMockRoadmapGenerator(),
    roadmapEditor: createMockRoadmapEditor(),
    agentManager: createMockAgentManager(),
    instructionGenerator: createMockInstructionGenerator(),
    conversationRepository: createMockConversationRepository(),
    settingsRepository: createMockSettingsRepository({
      inventifyFolder: '/test/inventify',
    }),
    gitService: createMockGitService(),
    inventifyService: createMockInventifyService(),
    ...deps,
  };

  app.use('/', createInventifyRouter(defaultDeps));

  return { app, deps: defaultDeps };
}

describe('Inventify Router', () => {
  describe('POST /start', () => {
    it('should return 201 with oneOffId and projectId', async () => {
      const { app } = createTestApp();

      const res = await request(app)
        .post('/start')
        .send({
          projectTypes: ['web'],
          themes: ['games'],
        })
        .expect(201);

      expect(res.body.oneOffId).toBe('inventify-oneoff-id');
      expect(res.body.placeholderProjectId).toBe('inventify-project-id');
    });

    it('should return 400 if inventifyFolder is not configured', async () => {
      const { app } = createTestApp({
        settingsRepository: createMockSettingsRepository({
          inventifyFolder: '',
        }),
      });

      const res = await request(app)
        .post('/start')
        .send({
          projectTypes: ['web'],
          themes: ['games'],
        })
        .expect(400);

      expect(res.body.error).toContain('Inventify folder not configured');
    });

    it('should return 400 if projectTypes is empty', async () => {
      const { app } = createTestApp();

      await request(app)
        .post('/start')
        .send({
          projectTypes: [],
          themes: ['games'],
        })
        .expect(400);
    });

    it('should return 400 if themes is empty', async () => {
      const { app } = createTestApp();

      await request(app)
        .post('/start')
        .send({
          projectTypes: ['web'],
          themes: [],
        })
        .expect(400);
    });

    it('should return 400 if body is missing fields', async () => {
      const { app } = createTestApp();

      await request(app)
        .post('/start')
        .send({})
        .expect(400);
    });

    it('should return 503 if inventify service is not available', async () => {
      const { app } = createTestApp({
        inventifyService: undefined,
      });

      await request(app)
        .post('/start')
        .send({
          projectTypes: ['web'],
          themes: ['games'],
        })
        .expect(503);
    });

    it('should return 500 if service throws', async () => {
      const mockInventifyService = createMockInventifyService();
      mockInventifyService.start.mockRejectedValue(
        new Error('Already running'),
      );

      const { app } = createTestApp({
        inventifyService: mockInventifyService,
      });

      const res = await request(app)
        .post('/start')
        .send({
          projectTypes: ['web'],
          themes: ['games'],
        })
        .expect(500);

      expect(res.body.error).toBe('Already running');
    });
  });

  describe('GET /ideas', () => {
    it('should return ideas when available', async () => {
      const mockInventifyService = createMockInventifyService();
      mockInventifyService.getIdeas.mockReturnValue([
        { name: 'idea-1', tagline: 'Tagline 1', description: 'Desc 1' },
        { name: 'idea-2', tagline: 'Tagline 2', description: 'Desc 2' },
      ]);

      const { app } = createTestApp({
        inventifyService: mockInventifyService,
      });

      const res = await request(app)
        .get('/ideas')
        .expect(200);

      expect(res.body.ideas).toHaveLength(2);
      expect(res.body.ideas[0].name).toBe('idea-1');
    });

    it('should return 404 when no ideas available', async () => {
      const { app } = createTestApp();

      const res = await request(app)
        .get('/ideas')
        .expect(404);

      expect(res.body.error).toContain('No ideas available');
    });

    it('should return 503 if service not available', async () => {
      const { app } = createTestApp({
        inventifyService: undefined,
      });

      await request(app)
        .get('/ideas')
        .expect(503);
    });
  });

  describe('POST /cancel', () => {
    it('should return 200 on successful cancel', async () => {
      const mockInventifyService = createMockInventifyService();
      mockInventifyService.cancel.mockResolvedValue(undefined);

      const { app } = createTestApp({
        inventifyService: mockInventifyService,
      });

      const res = await request(app)
        .post('/cancel')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockInventifyService.cancel).toHaveBeenCalled();
    });

    it('should return 500 if cancel throws', async () => {
      const mockInventifyService = createMockInventifyService();
      mockInventifyService.cancel.mockRejectedValue(
        new Error('Cancel failed'),
      );

      const { app } = createTestApp({
        inventifyService: mockInventifyService,
      });

      const res = await request(app)
        .post('/cancel')
        .expect(500);

      expect(res.body.error).toBe('Cancel failed');
    });

    it('should return 500 with generic message for non-Error throws', async () => {
      const mockInventifyService = createMockInventifyService();
      mockInventifyService.cancel.mockRejectedValue('string error');

      const { app } = createTestApp({
        inventifyService: mockInventifyService,
      });

      const res = await request(app)
        .post('/cancel')
        .expect(500);

      expect(res.body.error).toBe('Unknown error');
    });

    it('should return 503 if service not available', async () => {
      const { app } = createTestApp({
        inventifyService: undefined,
      });

      await request(app)
        .post('/cancel')
        .expect(503);
    });
  });

  describe('POST /suggest-names', () => {
    it('should return 201 with oneOffId', async () => {
      const { app } = createTestApp();

      const res = await request(app)
        .post('/suggest-names')
        .send({ selectedIndex: 2 })
        .expect(201);

      expect(res.body.oneOffId).toBe('inventify-names-oneoff-id');
      expect(res.body.placeholderProjectId).toBe('inventify-project-id');
    });

    it('should return 400 for invalid index', async () => {
      const { app } = createTestApp();

      await request(app)
        .post('/suggest-names')
        .send({ selectedIndex: 10 })
        .expect(400);
    });

    it('should return 503 if service not available', async () => {
      const { app } = createTestApp({
        inventifyService: undefined,
      });

      await request(app)
        .post('/suggest-names')
        .send({ selectedIndex: 0 })
        .expect(503);
    });

    it('should return 500 if suggestNames throws', async () => {
      const mockInventifyService = createMockInventifyService();
      mockInventifyService.suggestNames.mockRejectedValue(
        new Error('No pending ideas'),
      );

      const { app } = createTestApp({
        inventifyService: mockInventifyService,
      });

      const res = await request(app)
        .post('/suggest-names')
        .send({ selectedIndex: 0 })
        .expect(500);

      expect(res.body.error).toBe('No pending ideas');
    });
  });

  describe('GET /name-suggestions', () => {
    it('should return name suggestions when available', async () => {
      const mockInventifyService = createMockInventifyService();
      mockInventifyService.getNameSuggestions.mockReturnValue({
        names: ['alpha', 'beta', 'gamma'],
        ideaIndex: 1,
      });

      const { app } = createTestApp({
        inventifyService: mockInventifyService,
      });

      const res = await request(app)
        .get('/name-suggestions')
        .expect(200);

      expect(res.body.names).toHaveLength(3);
      expect(res.body.ideaIndex).toBe(1);
    });

    it('should return 404 when no suggestions available', async () => {
      const { app } = createTestApp();

      await request(app)
        .get('/name-suggestions')
        .expect(404);
    });

    it('should return 503 if service not available', async () => {
      const { app } = createTestApp({
        inventifyService: undefined,
      });

      await request(app)
        .get('/name-suggestions')
        .expect(503);
    });
  });

  describe('GET /build-result', () => {
    it('should return build result when available', async () => {
      const mockInventifyService = createMockInventifyService();
      mockInventifyService.getBuildResult.mockReturnValue({
        newProjectId: 'final-project-id',
        projectName: 'my-project',
      });

      const { app } = createTestApp({
        inventifyService: mockInventifyService,
      });

      const res = await request(app)
        .get('/build-result')
        .expect(200);

      expect(res.body.newProjectId).toBe('final-project-id');
      expect(res.body.projectName).toBe('my-project');
    });

    it('should return 404 when no build result available', async () => {
      const { app } = createTestApp();

      const res = await request(app)
        .get('/build-result')
        .expect(404);

      expect(res.body.error).toContain('No build result available');
    });

    it('should return 503 if service not available', async () => {
      const { app } = createTestApp({
        inventifyService: undefined,
      });

      await request(app)
        .get('/build-result')
        .expect(503);
    });
  });

  describe('POST /complete-build', () => {
    it('should return 200 on success', async () => {
      const mockInventifyService = createMockInventifyService();
      const mockProjectRepo = createMockProjectRepository([
        {
          id: 'proj-1',
          name: 'my-project',
          path: '/test/my-project',
          status: 'stopped',
          currentConversationId: null,
          nextItem: null,
          currentItem: null,
          lastContextUsage: null,
          permissionOverrides: null,
          modelOverride: null,
          mcpOverrides: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ]);

      const { app } = createTestApp({
        inventifyService: mockInventifyService,
        projectRepository: mockProjectRepo,
      });

      const res = await request(app)
        .post('/complete-build')
        .send({ projectId: 'proj-1' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockInventifyService.completeBuild).toHaveBeenCalledWith(
        'proj-1',
        '/test/my-project',
      );
    });

    it('should return 404 if project not found', async () => {
      const { app } = createTestApp();

      const res = await request(app)
        .post('/complete-build')
        .send({ projectId: 'nonexistent' })
        .expect(404);

      expect(res.body.error).toContain('Project not found');
    });

    it('should return 400 if projectId is missing', async () => {
      const { app } = createTestApp();

      await request(app)
        .post('/complete-build')
        .send({})
        .expect(400);
    });

    it('should return 503 if service not available', async () => {
      const { app } = createTestApp({
        inventifyService: undefined,
      });

      await request(app)
        .post('/complete-build')
        .send({ projectId: 'proj-1' })
        .expect(503);
    });

    it('should return 500 if service throws', async () => {
      const mockInventifyService = createMockInventifyService();
      mockInventifyService.completeBuild.mockRejectedValue(
        new Error('Plan not found'),
      );
      const mockProjectRepo = createMockProjectRepository([
        {
          id: 'proj-1',
          name: 'my-project',
          path: '/test/my-project',
          status: 'stopped',
          currentConversationId: null,
          nextItem: null,
          currentItem: null,
          lastContextUsage: null,
          permissionOverrides: null,
          modelOverride: null,
          mcpOverrides: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ]);

      const { app } = createTestApp({
        inventifyService: mockInventifyService,
        projectRepository: mockProjectRepo,
      });

      const res = await request(app)
        .post('/complete-build')
        .send({ projectId: 'proj-1' })
        .expect(500);

      expect(res.body.error).toBe('Plan not found');
    });
  });

  describe('POST /select', () => {
    it('should return 201 with prompt and newProjectId', async () => {
      const { app } = createTestApp();

      const res = await request(app)
        .post('/select')
        .send({ selectedIndex: 2, projectName: 'my-project' })
        .expect(201);

      expect(res.body.placeholderProjectId).toBe('inventify-project-id');
      expect(res.body.newProjectId).toBe('inventify-new-project-id');
      expect(res.body.prompt).toBeDefined();
    });

    it('should return 400 for invalid index', async () => {
      const { app } = createTestApp();

      await request(app)
        .post('/select')
        .send({ selectedIndex: 10, projectName: 'my-project' })
        .expect(400);
    });

    it('should return 400 for negative index', async () => {
      const { app } = createTestApp();

      await request(app)
        .post('/select')
        .send({ selectedIndex: -1, projectName: 'my-project' })
        .expect(400);
    });

    it('should return 400 for missing body', async () => {
      const { app } = createTestApp();

      await request(app)
        .post('/select')
        .send({})
        .expect(400);
    });

    it('should return 400 for missing projectName', async () => {
      const { app } = createTestApp();

      await request(app)
        .post('/select')
        .send({ selectedIndex: 0 })
        .expect(400);
    });

    it('should return 400 for invalid projectName format', async () => {
      const { app } = createTestApp();

      await request(app)
        .post('/select')
        .send({ selectedIndex: 0, projectName: 'My Project!' })
        .expect(400);
    });

    it('should return 500 if service throws', async () => {
      const mockInventifyService = createMockInventifyService();
      mockInventifyService.selectIdea.mockRejectedValue(
        new Error('No pending ideas'),
      );

      const { app } = createTestApp({
        inventifyService: mockInventifyService,
      });

      const res = await request(app)
        .post('/select')
        .send({ selectedIndex: 0, projectName: 'my-project' })
        .expect(500);

      expect(res.body.error).toBe('No pending ideas');
    });

    it('should return 503 if service not available', async () => {
      const { app } = createTestApp({
        inventifyService: undefined,
      });

      await request(app)
        .post('/select')
        .send({ selectedIndex: 0, projectName: 'my-project' })
        .expect(503);
    });
  });
});
