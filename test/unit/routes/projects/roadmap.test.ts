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

const ROADMAP_CONTENT = `# Roadmap

## Phase 1: Setup
### Milestone 1.1: Init
- [ ] Task A
- [x] Task B
`;

const PARSED_ROADMAP = {
  phases: [{
    id: 'phase-1',
    title: 'Setup',
    milestones: [{
      id: 'milestone-1-1',
      title: 'Init',
      items: [
        { title: 'Task A', completed: false },
        { title: 'Task B', completed: true },
      ],
    }],
  }],
};

function buildApp(deps: ProjectRouterDependencies): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/projects', createProjectsRouter(deps));
  app.use(createErrorHandler());
  return app;
}

function buildDeps(
  overrides?: Partial<ProjectRouterDependencies>,
): ProjectRouterDependencies {
  return {
    projectRepository: createMockProjectRepository([{ ...sampleProject }]),
    projectService: createMockProjectService(),
    roadmapParser: createMockRoadmapParser(PARSED_ROADMAP as any),
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

describe('Roadmap Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // GET /:id/roadmap
  // ==========================================================================
  describe('GET /:id/roadmap', () => {
    it('should return roadmap from doc/ directory', async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValueOnce(ROADMAP_CONTENT);
      const deps = buildDeps();
      const app = buildApp(deps);

      const res = await request(app).get(`/api/projects/${PROJECT_ID}/roadmap`);

      expect(res.status).toBe(200);
      expect(res.body.content).toBe(ROADMAP_CONTENT);
      expect(res.body.parsed).toEqual(PARSED_ROADMAP);
      expect(deps.roadmapParser.parse).toHaveBeenCalledWith(ROADMAP_CONTENT);
    });

    it('should fall back to root ROADMAP.md when doc/ not found', async () => {
      (fs.promises.readFile as jest.Mock)
        .mockRejectedValueOnce(new Error('ENOENT'))
        .mockResolvedValueOnce(ROADMAP_CONTENT);
      const deps = buildDeps();
      const app = buildApp(deps);

      const res = await request(app).get(`/api/projects/${PROJECT_ID}/roadmap`);

      expect(res.status).toBe(200);
      expect(res.body.content).toBe(ROADMAP_CONTENT);
    });

    it('should return 404 when no roadmap exists', async () => {
      (fs.promises.readFile as jest.Mock)
        .mockRejectedValueOnce(new Error('ENOENT'))
        .mockRejectedValueOnce(new Error('ENOENT'));
      const deps = buildDeps();
      const app = buildApp(deps);

      const res = await request(app).get(`/api/projects/${PROJECT_ID}/roadmap`);

      expect(res.status).toBe(404);
    });

    it('should return 404 for unknown project', async () => {
      const deps = buildDeps();
      const app = buildApp(deps);

      const res = await request(app).get('/api/projects/unknown-id/roadmap');

      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // POST /:id/roadmap/generate
  // ==========================================================================
  describe('POST /:id/roadmap/generate', () => {
    it('should generate a roadmap successfully', async () => {
      const deps = buildDeps();
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${PROJECT_ID}/roadmap/generate`)
        .send({ prompt: 'Create a web app roadmap' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(deps.roadmapGenerator.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: PROJECT_ID,
          projectPath: sampleProject.path,
          projectName: sampleProject.name,
          prompt: 'Create a web app roadmap',
        }),
      );
    });

    it('should return error when generation fails', async () => {
      const deps = buildDeps();
      (deps.roadmapGenerator.generate as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'Claude not available',
      });
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${PROJECT_ID}/roadmap/generate`)
        .send({ prompt: 'Create roadmap' });

      expect(res.status).toBe(500);
    });

    it('should return 400 when prompt is missing', async () => {
      const deps = buildDeps();
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${PROJECT_ID}/roadmap/generate`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('should return error with default message when error is empty', async () => {
      const deps = buildDeps();
      (deps.roadmapGenerator.generate as jest.Mock).mockResolvedValueOnce({
        success: false,
      });
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${PROJECT_ID}/roadmap/generate`)
        .send({ prompt: 'Create' });

      expect(res.status).toBe(500);
    });
  });

  // ==========================================================================
  // PUT /:id/roadmap (modify)
  // ==========================================================================
  describe('PUT /:id/roadmap', () => {
    it('should modify an existing roadmap', async () => {
      const updatedContent = '# Updated Roadmap\n...';
      (fs.promises.readFile as jest.Mock)
        .mockResolvedValueOnce(ROADMAP_CONTENT) // readRoadmap
        .mockResolvedValueOnce(updatedContent); // read updated file
      const deps = buildDeps();
      const app = buildApp(deps);

      const res = await request(app)
        .put(`/api/projects/${PROJECT_ID}/roadmap`)
        .send({ prompt: 'Add a testing phase' });

      expect(res.status).toBe(200);
      expect(res.body.content).toBe(updatedContent);
      expect(res.body.parsed).toBeDefined();
      expect(deps.roadmapGenerator.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('Add a testing phase'),
        }),
      );
    });

    it('should return error when modify generation fails', async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValueOnce(ROADMAP_CONTENT);
      const deps = buildDeps();
      (deps.roadmapGenerator.generate as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'Generation failed',
      });
      const app = buildApp(deps);

      const res = await request(app)
        .put(`/api/projects/${PROJECT_ID}/roadmap`)
        .send({ prompt: 'Modify roadmap' });

      expect(res.status).toBe(500);
    });

    it('should return 400 when prompt is missing for modify', async () => {
      const deps = buildDeps();
      const app = buildApp(deps);

      const res = await request(app)
        .put(`/api/projects/${PROJECT_ID}/roadmap`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ==========================================================================
  // DELETE /:id/roadmap/task
  // ==========================================================================
  describe('DELETE /:id/roadmap/task', () => {
    it('should delete a task from the roadmap', async () => {
      const updatedContent = '# Roadmap (task removed)';
      (fs.promises.readFile as jest.Mock).mockResolvedValueOnce(ROADMAP_CONTENT);
      (fs.promises.writeFile as jest.Mock).mockResolvedValueOnce(undefined);
      const deps = buildDeps();
      (deps.roadmapEditor.deleteTask as jest.Mock).mockReturnValueOnce(updatedContent);
      const app = buildApp(deps);

      const res = await request(app)
        .delete(`/api/projects/${PROJECT_ID}/roadmap/task`)
        .send({ phaseId: 'phase-1', milestoneId: 'milestone-1-1', taskIndex: 0 });

      expect(res.status).toBe(200);
      expect(res.body.content).toBe(updatedContent);
      expect(deps.roadmapEditor.deleteTask).toHaveBeenCalledWith(
        ROADMAP_CONTENT,
        { phaseId: 'phase-1', milestoneId: 'milestone-1-1', taskIndex: 0 },
      );
      expect(fs.promises.writeFile).toHaveBeenCalled();
    });

    it('should return 400 when taskIndex is missing', async () => {
      const deps = buildDeps();
      const app = buildApp(deps);

      const res = await request(app)
        .delete(`/api/projects/${PROJECT_ID}/roadmap/task`)
        .send({ phaseId: 'phase-1', milestoneId: 'milestone-1-1' });

      expect(res.status).toBe(400);
    });

    it('should return 400 when phaseId is empty', async () => {
      const deps = buildDeps();
      const app = buildApp(deps);

      const res = await request(app)
        .delete(`/api/projects/${PROJECT_ID}/roadmap/task`)
        .send({ phaseId: '', milestoneId: 'ms-1', taskIndex: 0 });

      expect(res.status).toBe(400);
    });
  });

  // ==========================================================================
  // DELETE /:id/roadmap/milestone
  // ==========================================================================
  describe('DELETE /:id/roadmap/milestone', () => {
    it('should delete a milestone from the roadmap', async () => {
      const updatedContent = '# Roadmap (milestone removed)';
      (fs.promises.readFile as jest.Mock).mockResolvedValueOnce(ROADMAP_CONTENT);
      (fs.promises.writeFile as jest.Mock).mockResolvedValueOnce(undefined);
      const deps = buildDeps();
      (deps.roadmapEditor.deleteMilestone as jest.Mock)
        .mockReturnValueOnce(updatedContent);
      const app = buildApp(deps);

      const res = await request(app)
        .delete(`/api/projects/${PROJECT_ID}/roadmap/milestone`)
        .send({ phaseId: 'phase-1', milestoneId: 'milestone-1-1' });

      expect(res.status).toBe(200);
      expect(res.body.content).toBe(updatedContent);
      expect(deps.roadmapEditor.deleteMilestone).toHaveBeenCalledWith(
        ROADMAP_CONTENT,
        { phaseId: 'phase-1', milestoneId: 'milestone-1-1' },
      );
    });

    it('should return 400 when milestoneId is missing', async () => {
      const deps = buildDeps();
      const app = buildApp(deps);

      const res = await request(app)
        .delete(`/api/projects/${PROJECT_ID}/roadmap/milestone`)
        .send({ phaseId: 'phase-1' });

      expect(res.status).toBe(400);
    });
  });

  // ==========================================================================
  // DELETE /:id/roadmap/phase
  // ==========================================================================
  describe('DELETE /:id/roadmap/phase', () => {
    it('should delete a phase from the roadmap', async () => {
      const updatedContent = '# Roadmap (phase removed)';
      (fs.promises.readFile as jest.Mock).mockResolvedValueOnce(ROADMAP_CONTENT);
      (fs.promises.writeFile as jest.Mock).mockResolvedValueOnce(undefined);
      const deps = buildDeps();
      (deps.roadmapEditor.deletePhase as jest.Mock)
        .mockReturnValueOnce(updatedContent);
      const app = buildApp(deps);

      const res = await request(app)
        .delete(`/api/projects/${PROJECT_ID}/roadmap/phase`)
        .send({ phaseId: 'phase-1' });

      expect(res.status).toBe(200);
      expect(res.body.content).toBe(updatedContent);
      expect(deps.roadmapEditor.deletePhase).toHaveBeenCalledWith(
        ROADMAP_CONTENT,
        { phaseId: 'phase-1' },
      );
    });

    it('should return 400 when phaseId is missing', async () => {
      const deps = buildDeps();
      const app = buildApp(deps);

      const res = await request(app)
        .delete(`/api/projects/${PROJECT_ID}/roadmap/phase`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ==========================================================================
  // POST /:id/roadmap/respond
  // ==========================================================================
  describe('POST /:id/roadmap/respond', () => {
    it('should send a response to active generation', async () => {
      const deps = buildDeps();
      (deps.roadmapGenerator.isGenerating as jest.Mock).mockReturnValueOnce(true);
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${PROJECT_ID}/roadmap/respond`)
        .send({ response: 'Yes, include testing' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(deps.roadmapGenerator.sendResponse).toHaveBeenCalledWith(
        PROJECT_ID,
        'Yes, include testing',
      );
    });

    it('should return error when no active generation', async () => {
      const deps = buildDeps();
      (deps.roadmapGenerator.isGenerating as jest.Mock).mockReturnValueOnce(false);
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${PROJECT_ID}/roadmap/respond`)
        .send({ response: 'Yes' });

      expect(res.status).toBe(400);
    });

    it('should return 400 when response is empty', async () => {
      const deps = buildDeps();
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${PROJECT_ID}/roadmap/respond`)
        .send({ response: '' });

      expect(res.status).toBe(400);
    });
  });

  // ==========================================================================
  // POST /:id/roadmap/task (add)
  // ==========================================================================
  describe('POST /:id/roadmap/task', () => {
    it('should add a task to the roadmap', async () => {
      const updatedContent = '# Roadmap (task added)';
      (fs.promises.readFile as jest.Mock).mockResolvedValueOnce(ROADMAP_CONTENT);
      (fs.promises.writeFile as jest.Mock).mockResolvedValueOnce(undefined);
      const deps = buildDeps();
      (deps.roadmapEditor.addTask as jest.Mock).mockReturnValueOnce(updatedContent);
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${PROJECT_ID}/roadmap/task`)
        .send({
          phaseId: 'phase-1',
          milestoneId: 'milestone-1-1',
          taskTitle: 'New task',
        });

      expect(res.status).toBe(200);
      expect(res.body.content).toBe(updatedContent);
      expect(deps.roadmapEditor.addTask).toHaveBeenCalledWith(
        ROADMAP_CONTENT,
        { phaseId: 'phase-1', milestoneId: 'milestone-1-1', taskTitle: 'New task' },
      );
      expect(fs.promises.writeFile).toHaveBeenCalled();
    });

    it('should return 400 when taskTitle is missing', async () => {
      const deps = buildDeps();
      const app = buildApp(deps);

      const res = await request(app)
        .post(`/api/projects/${PROJECT_ID}/roadmap/task`)
        .send({ phaseId: 'phase-1', milestoneId: 'milestone-1-1' });

      expect(res.status).toBe(400);
    });
  });

  // ==========================================================================
  // PUT /:id/roadmap/next-item
  // ==========================================================================
  describe('PUT /:id/roadmap/next-item', () => {
    it('should set the next item', async () => {
      const deps = buildDeps();
      const app = buildApp(deps);

      const res = await request(app)
        .put(`/api/projects/${PROJECT_ID}/roadmap/next-item`)
        .send({
          phaseId: 'phase-1',
          milestoneId: 'milestone-1-1',
          itemIndex: 0,
          taskTitle: 'Task A',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.nextItem).toEqual({
        phaseId: 'phase-1',
        milestoneId: 'milestone-1-1',
        itemIndex: 0,
        taskTitle: 'Task A',
      });
      expect(deps.projectRepository.updateNextItem).toHaveBeenCalledWith(
        PROJECT_ID,
        expect.objectContaining({ phaseId: 'phase-1', itemIndex: 0 }),
      );
    });

    it('should clear the next item with empty body', async () => {
      const deps = buildDeps();
      const app = buildApp(deps);

      const res = await request(app)
        .put(`/api/projects/${PROJECT_ID}/roadmap/next-item`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.nextItem).toBeNull();
      expect(deps.projectRepository.updateNextItem).toHaveBeenCalledWith(
        PROJECT_ID,
        null,
      );
    });

    it('should clear next item with null values', async () => {
      const deps = buildDeps();
      const app = buildApp(deps);

      const res = await request(app)
        .put(`/api/projects/${PROJECT_ID}/roadmap/next-item`)
        .send({ phaseId: null, milestoneId: null });

      expect(res.status).toBe(200);
      expect(res.body.nextItem).toBeNull();
    });

    it('should default taskTitle to empty string', async () => {
      const deps = buildDeps();
      const app = buildApp(deps);

      const res = await request(app)
        .put(`/api/projects/${PROJECT_ID}/roadmap/next-item`)
        .send({
          phaseId: 'phase-1',
          milestoneId: 'milestone-1-1',
          itemIndex: 2,
        });

      expect(res.status).toBe(200);
      expect(res.body.nextItem.taskTitle).toBe('');
    });

    it('should return 400 when partial fields provided', async () => {
      const deps = buildDeps();
      const app = buildApp(deps);

      const res = await request(app)
        .put(`/api/projects/${PROJECT_ID}/roadmap/next-item`)
        .send({ phaseId: 'phase-1' });

      expect(res.status).toBe(400);
    });
  });
});
