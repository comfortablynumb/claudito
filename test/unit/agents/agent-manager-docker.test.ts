import {
  DefaultAgentManager,
  AgentManagerDependencies,
} from '../../../src/agents/agent-manager';
import { Agent } from '../../../src/agents/agent';
import {
  createMockAgentFactory,
  createMockAgent,
  createMockProjectRepository,
  createMockConversationRepository,
  createMockInstructionGenerator,
  createMockRoadmapParser,
  createMockPermissionGenerator,
  createMockSettingsRepository,
  createMockContainerManager,
  createTestProject,
  DEFAULT_TEST_SETTINGS,
} from '../helpers/mock-factories';
import { ContainerManager } from '../../../src/services/docker/types';

jest.mock('../../../src/utils', () => {
  const originalModule = jest.requireActual('../../../src/utils');
  return {
    ...originalModule,
    getPidTracker: jest.fn().mockReturnValue({
      addProcess: jest.fn(),
      removeProcess: jest.fn(),
      cleanupOrphanProcesses: jest.fn().mockResolvedValue({
        foundCount: 0, killedCount: 0, killedPids: [], failedPids: [], skippedPids: [],
      }),
      getTrackedProcesses: jest.fn().mockReturnValue([]),
    }),
  };
});

describe('DefaultAgentManager - Docker Integration', () => {
  let agentManager: DefaultAgentManager;
  let mockAgent: jest.Mocked<Agent>;
  let mockAgentFactory: ReturnType<typeof createMockAgentFactory>;
  let mockProjectRepo: ReturnType<typeof createMockProjectRepository>;
  let mockConversationRepo: ReturnType<typeof createMockConversationRepository>;
  let mockSettingsRepo: ReturnType<typeof createMockSettingsRepository>;
  let mockContainerManager: jest.Mocked<ContainerManager>;

  const testProject = createTestProject({ id: 'test-project', path: '/test/path' });

  function createAgentManager(containerManager?: ContainerManager): DefaultAgentManager {
    const deps: AgentManagerDependencies = {
      maxConcurrentAgents: 3,
      agentFactory: mockAgentFactory,
      projectRepository: mockProjectRepo,
      conversationRepository: mockConversationRepo,
      instructionGenerator: createMockInstructionGenerator(),
      roadmapParser: createMockRoadmapParser(),
      permissionGenerator: createMockPermissionGenerator(),
      settingsRepository: mockSettingsRepo,
      containerManager,
    };

    return new DefaultAgentManager(deps);
  }

  beforeEach(() => {
    mockAgent = createMockAgent('test-project');
    mockAgentFactory = createMockAgentFactory(mockAgent);
    mockProjectRepo = createMockProjectRepository([testProject]);
    mockConversationRepo = createMockConversationRepository();
    mockSettingsRepo = createMockSettingsRepository();
    mockContainerManager = createMockContainerManager();
  });

  afterEach(async () => {
    if (agentManager) {
      await agentManager.stopAllAgents();
    }
  });

  describe('Docker disabled (default)', () => {
    it('should not pass processSpawner when Docker is disabled', async () => {
      agentManager = createAgentManager(mockContainerManager);

      await agentManager.startInteractiveAgent('test-project');

      const factoryCall = mockAgentFactory.create.mock.calls[0]![0];
      expect(factoryCall.processSpawner).toBeUndefined();
    });

    it('should not pass processSpawner when no containerManager', async () => {
      agentManager = createAgentManager(undefined);

      await agentManager.startInteractiveAgent('test-project');

      const factoryCall = mockAgentFactory.create.mock.calls[0]![0];
      expect(factoryCall.processSpawner).toBeUndefined();
    });
  });

  describe('Docker enabled', () => {
    beforeEach(() => {
      mockSettingsRepo.get.mockResolvedValue({
        ...DEFAULT_TEST_SETTINGS,
        docker: {
          ...DEFAULT_TEST_SETTINGS.docker,
          enabled: true,
        },
      });
    });

    it('should pass processSpawner when Docker is enabled', async () => {
      agentManager = createAgentManager(mockContainerManager);

      await agentManager.startInteractiveAgent('test-project');

      expect(mockContainerManager.ensureContainer).toHaveBeenCalledWith(
        'test-project',
        testProject.path,
        undefined,
      );

      const factoryCall = mockAgentFactory.create.mock.calls[0]![0];
      expect(factoryCall.processSpawner).toBeDefined();
    });

    it('should propagate containerImageName from ensureContainer result', async () => {
      mockContainerManager.ensureContainer.mockResolvedValue({
        containerId: 'abc123',
        imageName: 'my-custom-image:v2',
        wasCreated: true,
        wasRestarted: false,
      });
      agentManager = createAgentManager(mockContainerManager);

      const result = await agentManager.startInteractiveAgent('test-project');

      expect(result.containerImageName).toBe('my-custom-image:v2');
    });

    it('should fallback to host when ensureContainer fails', async () => {
      mockContainerManager.ensureContainer.mockRejectedValue(new Error('Docker not running'));
      agentManager = createAgentManager(mockContainerManager);

      const result = await agentManager.startInteractiveAgent('test-project');

      const factoryCall = mockAgentFactory.create.mock.calls[0]![0];
      expect(factoryCall.processSpawner).toBeUndefined();
      expect(result.dockerFallback).toBe(true);
      expect(result.dockerFallbackReason).toBe('Docker not running');
    });

    it('should not set dockerFallback when Docker works normally', async () => {
      agentManager = createAgentManager(mockContainerManager);

      const result = await agentManager.startInteractiveAgent('test-project');

      expect(result.dockerFallback).toBe(false);
      expect(result.dockerFallbackReason).toBeUndefined();
    });

    it('should respect per-project dockerOverride=false', async () => {
      const projectWithOverride = createTestProject({
        id: 'test-project',
        path: '/test/path',
      });
      projectWithOverride.dockerOverride = false;

      mockProjectRepo = createMockProjectRepository([projectWithOverride]);
      agentManager = createAgentManager(mockContainerManager);

      await agentManager.startInteractiveAgent('test-project');

      expect(mockContainerManager.ensureContainer).not.toHaveBeenCalled();

      const factoryCall = mockAgentFactory.create.mock.calls[0]![0];
      expect(factoryCall.processSpawner).toBeUndefined();
    });
  });

  describe('stopAllAgents with Docker', () => {
    it('should stop all containers when Docker manager is present', async () => {
      agentManager = createAgentManager(mockContainerManager);

      await agentManager.stopAllAgents();

      expect(mockContainerManager.stopAllContainers).toHaveBeenCalled();
    });

    it('should not fail when no container manager', async () => {
      agentManager = createAgentManager(undefined);

      await expect(agentManager.stopAllAgents()).resolves.not.toThrow();
    });
  });
});
