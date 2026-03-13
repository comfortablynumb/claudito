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
  DEFAULT_TEST_SETTINGS,
} from '../../helpers/mock-factories';
import { createProjectsRouter, ProjectRouterDependencies } from '../../../../src/routes/projects';
import { createErrorHandler } from '../../../../src/utils';
import { DEFAULT_AGENT_PROFILE } from '../../../../src/repositories/settings';

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

let mockWebSocketServer: any = null;
let mockRalphLoopService: any = null;

jest.mock('../../../../src/routes', () => ({
  ...jest.requireActual('../../../../src/routes'),
  getWebSocketServer: jest.fn(() => mockWebSocketServer),
  getAgentManager: jest.fn(() => null),
  getProcessTracker: jest.fn(() => null),
  getRalphLoopService: jest.fn(() => mockRalphLoopService),
}));

import fs from 'fs';

// ============================================================================
// Test Helpers
// ============================================================================

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
const PROJECT_PATH = sampleProject.path;

// ============================================================================
// GET /:id/docker
// ============================================================================

describe('GET /:id/docker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWebSocketServer = null;
    mockRalphLoopService = null;
  });

  it('should return effectiveDocker=false when global docker is disabled', async () => {
    const deps = buildDeps({
      settingsRepository: createMockSettingsRepository({ docker: { enabled: false, baseImage: 'img:latest', resourceLimits: { cpus: 2, memoryMb: 4096 }, networkMode: 'bridge' } }),
    });
    const app = buildApp(deps);

    const response = await request(app).get(`/api/projects/${PROJECT_ID}/docker`);

    expect(response.status).toBe(200);
    expect(response.body.effectiveDocker).toBe(false);
    expect(response.body.imageName).toBeNull();
  });

  it('should return effectiveDocker=true when global docker is enabled and no override', async () => {
    const deps = buildDeps({
      settingsRepository: createMockSettingsRepository({ docker: { enabled: true, baseImage: 'base:img', resourceLimits: { cpus: 2, memoryMb: 4096 }, networkMode: 'bridge' } }),
    });
    const app = buildApp(deps);

    const response = await request(app).get(`/api/projects/${PROJECT_ID}/docker`);

    expect(response.status).toBe(200);
    expect(response.body.effectiveDocker).toBe(true);
    expect(response.body.imageName).toBe('base:img');
  });

  it('should return effectiveDocker=false when project overrides docker to disabled', async () => {
    const projectWithOverride = { ...sampleProject, dockerOverride: false };
    const deps = buildDeps({
      projectRepository: createMockProjectRepository([projectWithOverride]),
      settingsRepository: createMockSettingsRepository({ docker: { enabled: true, baseImage: 'base:img', resourceLimits: { cpus: 2, memoryMb: 4096 }, networkMode: 'bridge' } }),
    });
    const app = buildApp(deps);

    const response = await request(app).get(`/api/projects/${PROJECT_ID}/docker`);

    expect(response.status).toBe(200);
    expect(response.body.effectiveDocker).toBe(false);
    expect(response.body.imageName).toBeNull();
  });

  it('should prefer project dockerImage over settings baseImage', async () => {
    const projectWithImage = { ...sampleProject, dockerImage: 'my-custom:img' };
    const deps = buildDeps({
      projectRepository: createMockProjectRepository([projectWithImage]),
      settingsRepository: createMockSettingsRepository({ docker: { enabled: true, baseImage: 'base:img', resourceLimits: { cpus: 2, memoryMb: 4096 }, networkMode: 'bridge' } }),
    });
    const app = buildApp(deps);

    const response = await request(app).get(`/api/projects/${PROJECT_ID}/docker`);

    expect(response.status).toBe(200);
    expect(response.body.effectiveDocker).toBe(true);
    expect(response.body.imageName).toBe('my-custom:img');
  });

  it('should return 404 for non-existent project', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app).get('/api/projects/non-existent/docker');

    expect(response.status).toBe(404);
  });

  it('should return dockerOverride and dockerImage from project', async () => {
    const projectWithData = { ...sampleProject, dockerOverride: true, dockerImage: 'custom:latest' };
    const deps = buildDeps({
      projectRepository: createMockProjectRepository([projectWithData]),
      settingsRepository: createMockSettingsRepository({ docker: { enabled: true, baseImage: 'base:img', resourceLimits: { cpus: 2, memoryMb: 4096 }, networkMode: 'bridge' } }),
    });
    const app = buildApp(deps);

    const response = await request(app).get(`/api/projects/${PROJECT_ID}/docker`);

    expect(response.status).toBe(200);
    expect(response.body.dockerOverride).toBe(true);
    expect(response.body.dockerImage).toBe('custom:latest');
  });
});

// ============================================================================
// PUT /:id/docker
// ============================================================================

describe('PUT /:id/docker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWebSocketServer = null;
    mockRalphLoopService = null;
  });

  it('should update dockerOverride to true', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .put(`/api/projects/${PROJECT_ID}/docker`)
      .send({ dockerOverride: true });

    expect(response.status).toBe(200);
    expect(response.body.updated).toBe(true);
    expect(deps.projectRepository.updateDockerOverride).toHaveBeenCalledWith(PROJECT_ID, true);
  });

  it('should update dockerImage', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .put(`/api/projects/${PROJECT_ID}/docker`)
      .send({ dockerImage: 'new-image:latest' });

    expect(response.status).toBe(200);
    expect(response.body.updated).toBe(true);
    expect(deps.projectRepository.updateDockerImage).toHaveBeenCalledWith(PROJECT_ID, 'new-image:latest');
  });

  it('should clear dockerImage with null', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .put(`/api/projects/${PROJECT_ID}/docker`)
      .send({ dockerImage: null });

    expect(response.status).toBe(200);
    expect(deps.projectRepository.updateDockerImage).toHaveBeenCalledWith(PROJECT_ID, null);
  });

  it('should update both dockerOverride and dockerImage', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .put(`/api/projects/${PROJECT_ID}/docker`)
      .send({ dockerOverride: false, dockerImage: 'img:v2' });

    expect(response.status).toBe(200);
    expect(deps.projectRepository.updateDockerOverride).toHaveBeenCalledWith(PROJECT_ID, false);
    expect(deps.projectRepository.updateDockerImage).toHaveBeenCalledWith(PROJECT_ID, 'img:v2');
  });

  it('should return 400 when dockerOverride is not a boolean', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .put(`/api/projects/${PROJECT_ID}/docker`)
      .send({ dockerOverride: 'not-a-boolean' });

    expect(response.status).toBe(400);
  });

  it('should return 400 when dockerImage is not a string or null', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .put(`/api/projects/${PROJECT_ID}/docker`)
      .send({ dockerImage: 42 });

    expect(response.status).toBe(400);
  });

  it('should not call updateDockerOverride when dockerOverride is undefined', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    await request(app)
      .put(`/api/projects/${PROJECT_ID}/docker`)
      .send({ dockerImage: 'only-image:latest' });

    expect(deps.projectRepository.updateDockerOverride).not.toHaveBeenCalled();
    expect(deps.projectRepository.updateDockerImage).toHaveBeenCalled();
  });

  it('should not call updateDockerImage when dockerImage is undefined', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    await request(app)
      .put(`/api/projects/${PROJECT_ID}/docker`)
      .send({ dockerOverride: true });

    expect(deps.projectRepository.updateDockerImage).not.toHaveBeenCalled();
    expect(deps.projectRepository.updateDockerOverride).toHaveBeenCalled();
  });

  it('should return 404 for non-existent project', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .put('/api/projects/non-existent/docker')
      .send({ dockerOverride: true });

    expect(response.status).toBe(404);
  });
});

// ============================================================================
// GET /:id/agent-profile
// ============================================================================

describe('GET /:id/agent-profile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWebSocketServer = null;
    mockRalphLoopService = null;
  });

  it('should return default profile when no agentProfileId is set', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app).get(`/api/projects/${PROJECT_ID}/agent-profile`);

    expect(response.status).toBe(200);
    expect(response.body.agentProfileId).toBeNull();
    expect(response.body.effectiveProfile).toBeDefined();
    expect(response.body.effectiveProfile.id).toBe(DEFAULT_AGENT_PROFILE.id);
  });

  it('should return the matching profile when agentProfileId is set', async () => {
    const customProfile = {
      id: 'custom-profile',
      name: 'Custom',
      provider: 'anthropic' as const,
      isDefault: false,
    };
    const projectWithProfile = { ...sampleProject, agentProfileId: 'custom-profile' };
    const deps = buildDeps({
      projectRepository: createMockProjectRepository([projectWithProfile]),
      settingsRepository: createMockSettingsRepository({ agentProfiles: [{ ...DEFAULT_AGENT_PROFILE }, customProfile] }),
    });
    const app = buildApp(deps);

    const response = await request(app).get(`/api/projects/${PROJECT_ID}/agent-profile`);

    expect(response.status).toBe(200);
    expect(response.body.agentProfileId).toBe('custom-profile');
    expect(response.body.effectiveProfile.id).toBe('custom-profile');
  });

  it('should fall back to default profile when agentProfileId does not match any', async () => {
    const projectWithProfile = { ...sampleProject, agentProfileId: 'nonexistent-profile' };
    const deps = buildDeps({
      projectRepository: createMockProjectRepository([projectWithProfile]),
      settingsRepository: createMockSettingsRepository({ agentProfiles: [{ ...DEFAULT_AGENT_PROFILE }] }),
    });
    const app = buildApp(deps);

    const response = await request(app).get(`/api/projects/${PROJECT_ID}/agent-profile`);

    expect(response.status).toBe(200);
    expect(response.body.effectiveProfile.isDefault).toBe(true);
  });

  it('should fall back to first profile when no default is marked', async () => {
    const profile1 = { id: 'p1', name: 'Profile 1', provider: 'anthropic' as const, isDefault: false };
    const profile2 = { id: 'p2', name: 'Profile 2', provider: 'anthropic' as const, isDefault: false };
    const projectWithProfile = { ...sampleProject, agentProfileId: 'nonexistent' };
    const deps = buildDeps({
      projectRepository: createMockProjectRepository([projectWithProfile]),
      settingsRepository: createMockSettingsRepository({ agentProfiles: [profile1, profile2] }),
    });
    const app = buildApp(deps);

    const response = await request(app).get(`/api/projects/${PROJECT_ID}/agent-profile`);

    expect(response.status).toBe(200);
    expect(response.body.effectiveProfile.id).toBe('p1');
  });

  it('should fall back to DEFAULT_AGENT_PROFILE when profiles array is empty', async () => {
    const deps = buildDeps({
      settingsRepository: createMockSettingsRepository({ agentProfiles: [] }),
    });
    const app = buildApp(deps);

    const response = await request(app).get(`/api/projects/${PROJECT_ID}/agent-profile`);

    expect(response.status).toBe(200);
    expect(response.body.effectiveProfile.id).toBe(DEFAULT_AGENT_PROFILE.id);
  });

  it('should return 404 for non-existent project', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app).get('/api/projects/non-existent/agent-profile');

    expect(response.status).toBe(404);
  });
});

// ============================================================================
// PUT /:id/agent-profile
// ============================================================================

describe('PUT /:id/agent-profile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWebSocketServer = null;
    mockRalphLoopService = null;
  });

  it('should set agentProfileId to null to clear override', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .put(`/api/projects/${PROJECT_ID}/agent-profile`)
      .send({ profileId: null });

    expect(response.status).toBe(200);
    expect(response.body.agentProfileId).toBeNull();
    expect(response.body.updated).toBe(true);
    expect(deps.projectRepository.updateAgentProfileId).toHaveBeenCalledWith(PROJECT_ID, null);
  });

  it('should set agentProfileId to an existing profile', async () => {
    const customProfile = {
      id: 'my-profile',
      name: 'My Profile',
      provider: 'anthropic' as const,
      isDefault: false,
    };
    const deps = buildDeps({
      settingsRepository: createMockSettingsRepository({ agentProfiles: [{ ...DEFAULT_AGENT_PROFILE }, customProfile] }),
    });
    const app = buildApp(deps);

    const response = await request(app)
      .put(`/api/projects/${PROJECT_ID}/agent-profile`)
      .send({ profileId: 'my-profile' });

    expect(response.status).toBe(200);
    expect(response.body.agentProfileId).toBe('my-profile');
    expect(response.body.updated).toBe(true);
    expect(deps.projectRepository.updateAgentProfileId).toHaveBeenCalledWith(PROJECT_ID, 'my-profile');
  });

  it('should return 400 when profileId is not a string', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .put(`/api/projects/${PROJECT_ID}/agent-profile`)
      .send({ profileId: 123 });

    expect(response.status).toBe(400);
  });

  it('should return 400 when profileId is empty string', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .put(`/api/projects/${PROJECT_ID}/agent-profile`)
      .send({ profileId: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('non-empty string');
  });

  it('should return 400 when profileId does not exist in settings', async () => {
    const deps = buildDeps({
      settingsRepository: createMockSettingsRepository({ agentProfiles: [{ ...DEFAULT_AGENT_PROFILE }] }),
    });
    const app = buildApp(deps);

    const response = await request(app)
      .put(`/api/projects/${PROJECT_ID}/agent-profile`)
      .send({ profileId: 'nonexistent-profile' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Profile not found');
  });

  it('should return 404 for non-existent project', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .put('/api/projects/non-existent/agent-profile')
      .send({ profileId: null });

    expect(response.status).toBe(404);
  });

  it('should include effectiveProfile in response', async () => {
    const customProfile = {
      id: 'eff-profile',
      name: 'Effective Profile',
      provider: 'anthropic' as const,
      isDefault: false,
    };
    const deps = buildDeps({
      settingsRepository: createMockSettingsRepository({ agentProfiles: [{ ...DEFAULT_AGENT_PROFILE }, customProfile] }),
    });
    const app = buildApp(deps);

    const response = await request(app)
      .put(`/api/projects/${PROJECT_ID}/agent-profile`)
      .send({ profileId: 'eff-profile' });

    expect(response.status).toBe(200);
    expect(response.body.effectiveProfile).toBeDefined();
    expect(response.body.effectiveProfile.id).toBe('eff-profile');
  });
});

// ============================================================================
// Additional branch coverage for existing routes
// ============================================================================

describe('PUT /:id/permissions (additional branches)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWebSocketServer = null;
    mockRalphLoopService = null;
  });

  it('should set permissions with defaultMode when provided', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .put(`/api/projects/${PROJECT_ID}/permissions`)
      .send({
        enabled: true,
        allowRules: ['Read'],
        denyRules: [],
        defaultMode: 'plan',
      });

    expect(response.status).toBe(200);
    expect(deps.projectRepository.updatePermissionOverrides).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({ defaultMode: 'plan' })
    );
  });

  it('should set permissions with undefined defaultMode when not provided', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .put(`/api/projects/${PROJECT_ID}/permissions`)
      .send({ enabled: true });

    expect(response.status).toBe(200);
    expect(deps.projectRepository.updatePermissionOverrides).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({ defaultMode: undefined })
    );
  });
});

describe('PUT /:id/model (additional branches)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWebSocketServer = null;
    mockRalphLoopService = null;
  });

  it('should return effectiveModel as DEFAULT_MODEL when model is null', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .put(`/api/projects/${PROJECT_ID}/model`)
      .send({ model: null });

    expect(response.status).toBe(200);
    expect(response.body.defaultModel).toBeDefined();
    expect(response.body.effectiveModel).toBe(response.body.defaultModel);
  });

  it('should return 400 for invalid model string', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .put(`/api/projects/${PROJECT_ID}/model`)
      .send({ model: 'completely-invalid-model-xyz' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Invalid model');
  });
});

describe('PUT /:id/mcp-overrides (additional branches)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWebSocketServer = null;
    mockRalphLoopService = null;
  });

  it('should save overrides even when enabled is false if serverOverrides is non-empty', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .put(`/api/projects/${PROJECT_ID}/mcp-overrides`)
      .send({ enabled: false, serverOverrides: { server1: { enabled: true } } });

    expect(response.status).toBe(200);
    // Should NOT call with null because serverOverrides is non-empty
    expect(deps.projectRepository.updateMcpOverrides).toHaveBeenCalledWith(
      PROJECT_ID,
      { enabled: false, serverOverrides: { server1: { enabled: true } } }
    );
  });

  it('should use empty serverOverrides as default when not provided', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .put(`/api/projects/${PROJECT_ID}/mcp-overrides`)
      .send({ enabled: true });

    expect(response.status).toBe(200);
    expect(deps.projectRepository.updateMcpOverrides).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({ serverOverrides: {} })
    );
  });
});

describe('GET /:id/debug (ralph loop branch)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWebSocketServer = null;
  });

  it('should include ralph loop info when service is available', async () => {
    mockRalphLoopService = {
      listByProject: jest.fn().mockResolvedValue([
        { taskId: 'task-1', status: 'worker_running', currentIteration: 2 },
        { taskId: 'task-2', status: 'completed', currentIteration: 3 },
      ]),
    };

    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app).get(`/api/projects/${PROJECT_ID}/debug`);

    expect(response.status).toBe(200);
    expect(response.body.ralphLoops).toBeDefined();
    expect(response.body.ralphLoops.count).toBe(2);
    expect(response.body.ralphLoops.activeLoops).toHaveLength(1);
    expect(response.body.ralphLoops.activeLoops[0].taskId).toBe('task-1');
  });

  it('should not include ralph loop info when service is not available', async () => {
    mockRalphLoopService = null;

    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app).get(`/api/projects/${PROJECT_ID}/debug`);

    expect(response.status).toBe(200);
    expect(response.body.ralphLoops).toBeUndefined();
  });

  it('should mark idle and reviewer_running loops as active', async () => {
    mockRalphLoopService = {
      listByProject: jest.fn().mockResolvedValue([
        { taskId: 'task-idle', status: 'idle', currentIteration: 0 },
        { taskId: 'task-reviewing', status: 'reviewer_running', currentIteration: 1 },
        { taskId: 'task-failed', status: 'failed', currentIteration: 1 },
      ]),
    };

    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app).get(`/api/projects/${PROJECT_ID}/debug`);

    expect(response.status).toBe(200);
    expect(response.body.ralphLoops.activeLoops).toHaveLength(2);
  });
});

describe('GET /:id/model (additional branches)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWebSocketServer = null;
    mockRalphLoopService = null;
  });

  it('should mark correct model as isCurrent when modelOverride is set', async () => {
    const projectWithOverride = { ...sampleProject, modelOverride: 'claude-sonnet-4-6' };
    const deps = buildDeps({
      projectRepository: createMockProjectRepository([projectWithOverride]),
    });
    const app = buildApp(deps);

    const response = await request(app).get(`/api/projects/${PROJECT_ID}/model`);

    expect(response.status).toBe(200);
    const currentModel = response.body.availableModels.find((m: any) => m.isCurrent);
    expect(currentModel.id).toBe('claude-sonnet-4-6');
  });

  it('should mark DEFAULT_MODEL as isDefault in available models', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app).get(`/api/projects/${PROJECT_ID}/model`);

    expect(response.status).toBe(200);
    const defaultModel = response.body.availableModels.find((m: any) => m.isDefault);
    expect(defaultModel).toBeDefined();
    expect(defaultModel.id).toBe(response.body.defaultModel);
  });
});

describe('POST / (additional branches)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWebSocketServer = null;
    mockRalphLoopService = null;
  });

  it('should return 400 when name is missing', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/projects')
      .send({ path: '/test/path' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('name:');
  });

  it('should return 400 with generic message when error is undefined', async () => {
    const deps = buildDeps();
    deps.projectService.createProject = jest.fn().mockResolvedValue({ success: false });
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/projects')
      .send({ name: 'Test Project', path: '/test/path' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Failed to create project');
  });
});
