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
  createMockRunConfigurationService,
  createMockRunConfigImportService,
  createMockRunProcessManager,
  sampleProject,
  sampleRunConfiguration,
} from '../../helpers/mock-factories';
import { RunConfigurationService } from '../../../../src/services/run-config/types';
import { RunConfigImportService } from '../../../../src/services/run-config/import-types';
import { RunProcessManager } from '../../../../src/services/run-config/run-process-types';
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

describe('Run Configs Routes', () => {
  let app: Express;
  let mockRunConfigService: jest.Mocked<RunConfigurationService>;
  let mockImportService: jest.Mocked<RunConfigImportService>;
  let mockRunProcessManager: jest.Mocked<RunProcessManager>;
  const projectId = sampleProject.id;
  const basePath = `/api/projects/${projectId}/run-configs`;

  interface SetupOptions {
    runConfigService?: RunConfigurationService | null;
    importService?: RunConfigImportService | null;
    runProcessManager?: RunProcessManager | null;
  }

  function setupApp(options: SetupOptions = {}): void {
    const deps: ProjectRouterDependencies = {
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
      runConfigurationService: options.runConfigService === null
        ? undefined
        : (options.runConfigService || mockRunConfigService),
      runConfigImportService: options.importService === null
        ? undefined
        : (options.importService || mockImportService),
      runProcessManager: options.runProcessManager === null
        ? undefined
        : (options.runProcessManager || mockRunProcessManager),
    };

    app = express();
    app.use(express.json());
    app.use('/api/projects', createProjectsRouter(deps));
    app.use(createErrorHandler());
  }

  beforeEach(() => {
    mockRunConfigService = createMockRunConfigurationService();
    mockImportService = createMockRunConfigImportService();
    mockRunProcessManager = createMockRunProcessManager();
    setupApp();
  });

  describe('GET /:id/run-configs', () => {
    it('should list run configurations', async () => {
      mockRunConfigService.list.mockResolvedValue([sampleRunConfiguration]);

      const res = await request(app).get(basePath);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('Dev Server');
    });

    it('should return empty array when no configs', async () => {
      mockRunConfigService.list.mockResolvedValue([]);

      const res = await request(app).get(basePath);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('should return 503 when service unavailable', async () => {
      setupApp({ runConfigService: null });

      const res = await request(app).get(basePath);

      expect(res.status).toBe(503);
    });
  });

  describe('POST /:id/run-configs', () => {
    it('should create a run configuration', async () => {
      mockRunConfigService.create.mockResolvedValue(sampleRunConfiguration);

      const res = await request(app)
        .post(basePath)
        .send({ name: 'Dev Server', command: 'npm run dev' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Dev Server');
      expect(mockRunConfigService.create).toHaveBeenCalledWith(
        projectId,
        expect.objectContaining({ name: 'Dev Server', command: 'npm run dev' }),
      );
    });

    it('should reject missing name', async () => {
      const res = await request(app)
        .post(basePath)
        .send({ command: 'npm run dev' });

      expect(res.status).toBe(400);
    });

    it('should reject missing command', async () => {
      const res = await request(app)
        .post(basePath)
        .send({ name: 'Test' });

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /:id/run-configs/:configId', () => {
    it('should update a run configuration', async () => {
      const updated = { ...sampleRunConfiguration, name: 'Updated' };
      mockRunConfigService.update.mockResolvedValue(updated);

      const res = await request(app)
        .put(`${basePath}/${sampleRunConfiguration.id}`)
        .send({ name: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated');
    });

    it('should return 404 when config not found', async () => {
      mockRunConfigService.update.mockResolvedValue(null);

      const res = await request(app)
        .put(`${basePath}/nonexistent`)
        .send({ name: 'Updated' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /:id/run-configs/:configId', () => {
    it('should delete a run configuration', async () => {
      mockRunConfigService.delete.mockResolvedValue(true);

      const res = await request(app)
        .delete(`${basePath}/${sampleRunConfiguration.id}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 404 when config not found', async () => {
      mockRunConfigService.delete.mockResolvedValue(false);

      const res = await request(app)
        .delete(`${basePath}/nonexistent`);

      expect(res.status).toBe(404);
    });
  });

  describe('POST /:id/run-configs/:configId/start', () => {
    const configPath = `${basePath}/${sampleRunConfiguration.id}/start`;

    it('should start a run configuration process', async () => {
      mockRunConfigService.getById.mockResolvedValue(sampleRunConfiguration);

      const res = await request(app).post(configPath);

      expect(res.status).toBe(200);
      expect(res.body.configId).toBe(sampleRunConfiguration.id);
      expect(res.body.state).toBe('running');
      expect(mockRunProcessManager.start).toHaveBeenCalledWith(
        projectId,
        sampleProject.path,
        sampleRunConfiguration.id,
      );
    });

    it('should return 404 when config not found', async () => {
      mockRunConfigService.getById.mockResolvedValue(null);

      const res = await request(app).post(configPath);

      expect(res.status).toBe(404);
      expect(mockRunProcessManager.start).not.toHaveBeenCalled();
    });

    it('should return 503 when run process manager unavailable', async () => {
      setupApp({ runProcessManager: null });

      const res = await request(app).post(configPath);

      expect(res.status).toBe(503);
    });

    it('should return 503 when run config service unavailable', async () => {
      setupApp({ runConfigService: null });

      const res = await request(app).post(configPath);

      expect(res.status).toBe(503);
    });
  });

  describe('POST /:id/run-configs/:configId/stop', () => {
    const configPath = `${basePath}/${sampleRunConfiguration.id}/stop`;

    it('should stop a run configuration process', async () => {
      const res = await request(app).post(configPath);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockRunProcessManager.stop).toHaveBeenCalledWith(
        projectId,
        sampleRunConfiguration.id,
      );
    });

    it('should return 503 when run process manager unavailable', async () => {
      setupApp({ runProcessManager: null });

      const res = await request(app).post(configPath);

      expect(res.status).toBe(503);
    });
  });

  describe('GET /:id/run-configs/:configId/status', () => {
    const configPath = `${basePath}/${sampleRunConfiguration.id}/status`;

    it('should return status of a run configuration process', async () => {
      const res = await request(app).get(configPath);

      expect(res.status).toBe(200);
      expect(res.body.configId).toBe(sampleRunConfiguration.id);
      expect(mockRunProcessManager.getStatus).toHaveBeenCalledWith(
        projectId,
        sampleRunConfiguration.id,
      );
    });

    it('should return stopped status when process not running', async () => {
      const res = await request(app).get(configPath);

      expect(res.status).toBe(200);
      expect(res.body.state).toBe('stopped');
    });

    it('should return 503 when run process manager unavailable', async () => {
      setupApp({ runProcessManager: null });

      const res = await request(app).get(configPath);

      expect(res.status).toBe(503);
    });
  });

  describe('GET /:id/run-configs/importable', () => {
    it('should return importable configs', async () => {
      mockImportService.scan.mockResolvedValue({
        projectPath: sampleProject.path,
        importable: [{
          source: 'package.json',
          sourceFile: 'package.json',
          configs: [{ name: 'npm: dev', command: 'npm', args: ['run', 'dev'] }],
        }],
      });

      const res = await request(app).get(`${basePath}/importable`);

      expect(res.status).toBe(200);
      expect(res.body.importable).toHaveLength(1);
      expect(res.body.importable[0].source).toBe('package.json');
    });

    it('should return empty when no importable configs found', async () => {
      mockImportService.scan.mockResolvedValue({
        projectPath: sampleProject.path,
        importable: [],
      });

      const res = await request(app).get(`${basePath}/importable`);

      expect(res.status).toBe(200);
      expect(res.body.importable).toHaveLength(0);
    });

    it('should return 503 when import service unavailable', async () => {
      setupApp({ importService: null });

      const res = await request(app).get(`${basePath}/importable`);

      expect(res.status).toBe(503);
    });
  });
});
