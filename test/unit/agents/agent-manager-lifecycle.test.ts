import { EventEmitter } from 'events';
import {
  DefaultAgentManager,
  AgentManagerDependencies,
  AgentFactory,
  AgentFactoryOptions,
  ImageData,
} from '../../../src/agents/agent-manager';
import { ClaudeAgent, AgentMessage, AgentStatus, ProcessInfo, ContextUsage, AgentEvents } from '../../../src/agents/claude-agent';
import {
  createMockProjectRepository,
  createMockConversationRepository,
  createMockSettingsRepository,
  createMockInstructionGenerator,
  createMockRoadmapParser,
  createTestConversation,
} from '../helpers/mock-factories';
import { ProjectStatus } from '../../../src/repositories/project';

jest.mock('../../../src/utils', () => ({
  getLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    withProject: jest.fn().mockReturnThis(),
  }),
  getPidTracker: jest.fn().mockReturnValue({
    addProcess: jest.fn(),
    removeProcess: jest.fn(),
    getTrackedProcesses: jest.fn().mockReturnValue([]),
    cleanupOrphanProcesses: jest.fn().mockResolvedValue({
      foundCount: 0,
      killedCount: 0,
      killedPids: [],
      failedPids: [],
      skippedPids: [],
    }),
  }),
  isValidUUID: jest.fn((str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str)),
  ConflictError: class ConflictError extends Error {
    statusCode = 409;
    code = 'CONFLICT';
    constructor(message: string) {
      super(message);
      this.name = 'ConflictError';
    }
  },
}));

// Mock permission generator
const mockPermissionGenerator = {
  generateArgs: jest.fn().mockReturnValue({
    skipPermissions: false,
    allowedTools: [],
    disallowedTools: [],
    permissionMode: 'acceptEdits' as const,
  }),
};

jest.mock('../../../src/services/permission-generator', () => ({
  DefaultPermissionGenerator: jest.fn().mockImplementation(() => mockPermissionGenerator),
}));

function createTestProject(overrides: Partial<ProjectStatus> = {}): ProjectStatus {
  return {
    id: 'test-project',
    name: 'Test Project',
    path: '/test/project',
    status: 'stopped',
    currentConversationId: null,
    nextItem: null,
    currentItem: null,
    lastContextUsage: null,
    permissionOverrides: null,
    modelOverride: null,
    mcpOverrides: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createTestContextUsage(overrides: Partial<ContextUsage> = {}): ContextUsage {
  return {
    inputTokens: 600,
    outputTokens: 400,
    totalTokens: 1000,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    maxContextTokens: 10000,
    percentUsed: 0.1,
    ...overrides,
  };
}

describe('AgentManager Lifecycle Tests', () => {
  let agentManager: DefaultAgentManager;
  let mockProjectRepository: any;
  let mockConversationRepository: any;
  let mockSettingsRepository: any;
  let mockInstructionGenerator: any;
  let mockRoadmapParser: any;
  let mockAgentFactory: jest.Mocked<AgentFactory>;
  let deps: AgentManagerDependencies;

  // Mock agent creation
  class MockClaudeAgent extends EventEmitter implements ClaudeAgent {
    readonly projectId: string;
    readonly projectPath: string;
    mode: 'autonomous' | 'interactive' = 'autonomous';
    status: AgentStatus = 'stopped';
    isWaitingForInput = false;
    waitingVersion = 0;
    sessionId: string | null = null;
    sessionError: string | null = null;
    permissionMode: 'acceptEdits' | 'plan' | null = null;
    collectedOutput = '';
    lastCommand: string | null = null;
    processInfo: ProcessInfo | null = null;
    contextUsage: ContextUsage | null = null;
    queuedMessageCount = 0;
    queuedMessages: string[] = [];

    constructor(options: AgentFactoryOptions) {
      super();
      this.projectId = options.projectId;
      this.projectPath = options.projectPath;
      this.mode = options.mode;
      this.sessionId = options.sessionId || null;
      this.permissionMode = options.permissions?.permissionMode || null;

      // Simulate process info
      this.processInfo = {
        pid: Math.floor(Math.random() * 10000) + 1000,
        cwd: options.projectPath,
        startedAt: new Date().toISOString(),
      };
    }

    start(_instructions: string): void {
      this.status = 'running';
      this.emit('status', this.status);

      // Simulate starting delay
      setTimeout(() => {
        if (this.sessionError) {
          this.emit('sessionNotFound', this.sessionId || 'unknown');
        }
      }, 10);
    }

    stop(): Promise<void> {
      this.status = 'stopped';
      this.emit('status', this.status);
      this.emit('exit', 0);
      return Promise.resolve();
    }

    sendInput(_input: string): void {
      if (this.mode !== 'interactive') {
        throw new Error('Agent is not in interactive mode');
      }
    }

    sendToolResult(_toolUseId: string, _content: string): void {
      if (this.mode !== 'interactive') {
        throw new Error('Agent is not in interactive mode');
      }
    }

    removeQueuedMessage(index: number): boolean {
      if (index >= 0 && index < this.queuedMessages.length) {
        this.queuedMessages.splice(index, 1);
        return true;
      }
      return false;
    }

    // Test helpers
    simulateMessage(message: AgentMessage): void {
      this.emit('message', message);
    }

    simulateExit(code: number): void {
      this.emit('exit', code);
    }

    simulateSessionError(error: string): void {
      this.sessionError = error;
    }

    simulateContextUsage(usage: ContextUsage): void {
      this.contextUsage = usage;
    }

    simulateWaiting(isWaiting: boolean, version: number = 1): void {
      this.isWaitingForInput = isWaiting;
      this.waitingVersion = version;
      this.emit('waitingForInput', { isWaiting, version });
    }

    override on<K extends keyof AgentEvents>(event: K, listener: AgentEvents[K]): this {
      super.on(event, listener as any);
      return this;
    }

    override off<K extends keyof AgentEvents>(event: K, listener: AgentEvents[K]): this {
      super.off(event, listener as any);
      return this;
    }
  }

  // Helper to manage projects in the mock repository
  const projectsMap = new Map<string, ProjectStatus>();

  const addProjectToRepository = (project: ProjectStatus) => {
    projectsMap.set(project.id, project);
  };

  const clearProjectRepository = () => {
    projectsMap.clear();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    clearProjectRepository();

    mockProjectRepository = createMockProjectRepository();
    mockConversationRepository = createMockConversationRepository();
    mockSettingsRepository = createMockSettingsRepository();
    mockInstructionGenerator = createMockInstructionGenerator();
    mockRoadmapParser = createMockRoadmapParser();

    // Set up the findById mock to use our projectsMap
    mockProjectRepository.findById.mockImplementation((id: string) => {
      const project = projectsMap.get(id);
      return Promise.resolve(project || null);
    });

    // Mock settings
    mockSettingsRepository.get.mockResolvedValue({
      maxConcurrentAgents: 3,
      agentPromptTemplate: 'Test template',
      appendSystemPrompt: '',
      sendWithCtrlEnter: false,
      historyLimit: 25,
      enableDesktopNotifications: false,
      claudeMdMaxSizeKB: 50,
      promptTemplates: [],
      claudePermissions: {
        dangerouslySkipPermissions: false,
        defaultMode: 'acceptEdits',
        allowedTools: [],
        allowRules: [],
        denyRules: [],
        askRules: [],
      },
      agentLimits: {
        maxTurns: 0,
      },
      agentStreaming: {
        includePartialMessages: false,
        noSessionPersistence: false,
      },
      ralphLoop: {
        defaultMaxTurns: 5,
        defaultWorkerModel: 'claude-opus-4-6',
        defaultReviewerModel: 'claude-sonnet-4-5-20250929',
        defaultWorkerSystemPrompt: 'Worker prompt',
        defaultReviewerSystemPrompt: 'Reviewer prompt',
        historyLimit: 5,
      },
      mcp: {
        enabled: true,
        servers: [],
      },
    });

    // Mock agent factory
    mockAgentFactory = {
      create: jest.fn().mockImplementation((options: AgentFactoryOptions) => new MockClaudeAgent(options)),
    };

    deps = {
      projectRepository: mockProjectRepository,
      conversationRepository: mockConversationRepository,
      settingsRepository: mockSettingsRepository,
      instructionGenerator: mockInstructionGenerator,
      roadmapParser: mockRoadmapParser,
      agentFactory: mockAgentFactory,
      maxConcurrentAgents: 2, // Low limit for testing queue
    };

    agentManager = new DefaultAgentManager(deps);
  });

  describe('Agent Lifecycle Management', () => {
    const projectId = 'test-project';
    const projectPath = '/test/project';

    beforeEach(() => {
      const mockProject = createTestProject({
        id: projectId,
        path: projectPath,
        currentConversationId: 'test-conversation-id',
      });

      addProjectToRepository(mockProject);
    });

    it('should start agent immediately when under concurrent limit', async () => {
      await agentManager.startAgent(projectId, 'test instructions');

      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId,
          projectPath,
          mode: 'autonomous',
        })
      );

      expect(agentManager.getAgentStatus(projectId)).toBe('running');
      expect(agentManager.isRunning(projectId)).toBe(true);
    });

    it('should queue agent when at concurrent limit', async () => {
      // Set up additional projects for this test
      addProjectToRepository(createTestProject({
        id: 'project-1',
        path: '/test/project-1',
        currentConversationId: 'conv-1'
      }));
      addProjectToRepository(createTestProject({
        id: 'project-2',
        path: '/test/project-2',
        currentConversationId: 'conv-2'
      }));

      // Fill up the concurrent agent limit
      await agentManager.startAgent('project-1', 'instructions 1');
      await agentManager.startAgent('project-2', 'instructions 2');

      // This should be queued
      await agentManager.startAgent(projectId, 'test instructions');

      expect(agentManager.isQueued(projectId)).toBe(true);
      expect(agentManager.isRunning(projectId)).toBe(false);

      const resourceStatus = agentManager.getResourceStatus();
      expect(resourceStatus.runningCount).toBe(2);
      expect(resourceStatus.queuedCount).toBe(1);
      expect(resourceStatus.queuedProjects).toHaveLength(1);
      expect(resourceStatus.queuedProjects[0]?.projectId).toBe(projectId);
    });

    it('should process queue when agent stops', async () => {
      // Set up additional projects for this test
      addProjectToRepository(createTestProject({
        id: 'project-1',
        path: '/test/project-1',
        currentConversationId: 'conv-1'
      }));
      addProjectToRepository(createTestProject({
        id: 'project-2',
        path: '/test/project-2',
        currentConversationId: 'conv-2'
      }));

      // Fill concurrent limit
      await agentManager.startAgent('project-1', 'instructions 1');
      await agentManager.startAgent('project-2', 'instructions 2');

      // Queue a third project
      await agentManager.startAgent(projectId, 'test instructions');
      expect(agentManager.isQueued(projectId)).toBe(true);

      // Stop one agent to free up slot
      await agentManager.stopAgent('project-1');

      // Wait for queue processing
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(agentManager.isQueued(projectId)).toBe(false);
      expect(agentManager.isRunning(projectId)).toBe(true);
    });

    it('should reject starting already running agent', async () => {
      await agentManager.startAgent(projectId, 'instructions 1');

      await expect(
        agentManager.startAgent(projectId, 'instructions 2')
      ).rejects.toThrow('Agent is already running for this project');
    });

    it('should reject starting already queued agent', async () => {
      // Set up additional projects for this test
      addProjectToRepository(createTestProject({
        id: 'project-1',
        path: '/test/project-1',
        currentConversationId: 'conv-1'
      }));
      addProjectToRepository(createTestProject({
        id: 'project-2',
        path: '/test/project-2',
        currentConversationId: 'conv-2'
      }));

      // Fill concurrent limit
      await agentManager.startAgent('project-1', 'instructions 1');
      await agentManager.startAgent('project-2', 'instructions 2');
      await agentManager.startAgent(projectId, 'instructions 3');

      await expect(
        agentManager.startAgent(projectId, 'instructions 4')
      ).rejects.toThrow('Agent is already queued for this project');
    });

    it('should throw error for non-existent project', async () => {
      // No need to add project to repository - it should return null for non-existent

      await expect(
        agentManager.startAgent('non-existent', 'instructions')
      ).rejects.toThrow('Project not found');
    });
  });

  describe('Interactive Agent Lifecycle', () => {
    const projectId = 'test-project';
    const projectPath = '/test/project';
    const validUUID = '123e4567-e89b-12d3-a456-426614174000';
    const invalidUUID = 'invalid-uuid';

    beforeEach(() => {
      const mockProject = createTestProject({
        id: projectId,
        path: projectPath,
      });

      addProjectToRepository(mockProject);
    });

    it('should create new conversation when none exists', async () => {
      const mockConversation = createTestConversation();
      mockConversationRepository.create.mockResolvedValue(mockConversation);

      await agentManager.startInteractiveAgent(projectId, {
        initialMessage: 'Hello',
      });

      expect(mockConversationRepository.create).toHaveBeenCalledWith(projectId, null);
      expect(mockProjectRepository.setCurrentConversation).toHaveBeenCalledWith(
        projectId,
        mockConversation.id
      );

      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'interactive',
          sessionId: mockConversation.id,
          isNewSession: true,
        })
      );
    });

    it('should resume existing conversation with valid UUID', async () => {
      const mockProject = createTestProject({
        id: projectId,
        name: 'Test Project',
        path: projectPath,
        currentConversationId: validUUID,
      });

      addProjectToRepository(mockProject);

      // Mock the conversation exists for validation
      mockConversationRepository.findById.mockResolvedValue(
        createTestConversation({ id: validUUID })
      );

      await agentManager.startInteractiveAgent(projectId);

      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: validUUID,
          isNewSession: false,
        })
      );

      // Should not create new conversation
      expect(mockConversationRepository.create).not.toHaveBeenCalled();
    });

    it('should handle invalid UUID in existing conversation', async () => {
      const mockProject = createTestProject({
        id: projectId,
        name: 'Test Project',
        path: projectPath,
        currentConversationId: invalidUUID,
      });

      addProjectToRepository(mockProject);

      const mockNewConversation = createTestConversation();
      mockConversationRepository.create.mockResolvedValue(mockNewConversation);

      // Listen for session recovery event
      const sessionRecoveryListener = jest.fn();
      agentManager.on('sessionRecovery', sessionRecoveryListener);

      await agentManager.startInteractiveAgent(projectId);

      // Invalid UUID doesn't trigger deletion, just recovery
      expect(mockConversationRepository.deleteConversation).not.toHaveBeenCalled();
      expect(mockConversationRepository.create).toHaveBeenCalled();
      expect(sessionRecoveryListener).toHaveBeenCalledWith(
        projectId,
        invalidUUID,
        mockNewConversation.id,
        'Session not found'
      );
    });

    it('should handle session error during agent start', async () => {
      const mockConversation = createTestConversation();
      mockConversationRepository.create.mockResolvedValue(mockConversation);

      // Create agent that will fail with session error
      mockAgentFactory.create.mockImplementation((options) => {
        const agent = new MockClaudeAgent(options);
        agent.simulateSessionError('Session already in use');
        return agent;
      });

      const sessionRecoveryListener = jest.fn();
      agentManager.on('sessionRecovery', sessionRecoveryListener);

      await agentManager.startInteractiveAgent(projectId);

      // Wait for session error handling
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(sessionRecoveryListener).toHaveBeenCalledWith(
        projectId,
        expect.any(String),
        expect.any(String),
        'Session not found by Claude'
      );
    });

    it('should handle multimodal content with images', async () => {
      const mockConversation = createTestConversation();
      mockConversationRepository.create.mockResolvedValue(mockConversation);

      const images: ImageData[] = [
        { type: 'image/png', data: 'base64data' },
      ];

      await agentManager.startInteractiveAgent(projectId, {
        initialMessage: 'Describe this image',
        images,
      });

      // Verify agent was created and started with multimodal content
      expect(mockAgentFactory.create).toHaveBeenCalled();
    });

    it('should handle permission mode override', async () => {
      const mockConversation = createTestConversation();
      mockConversationRepository.create.mockResolvedValue(mockConversation);

      await agentManager.startInteractiveAgent(projectId, {
        permissionMode: 'plan',
      });

      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          permissions: expect.objectContaining({
            permissionMode: 'plan',
          }),
        })
      );
    });

    it('should force new session when requested', async () => {
      const mockProject = createTestProject({
        id: projectId,
        name: 'Test Project',
        path: projectPath,
        currentConversationId: validUUID,
      });

      addProjectToRepository(mockProject);

      await agentManager.startInteractiveAgent(projectId, {
        isNewSession: true,
        sessionId: validUUID,
      });

      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          isNewSession: true,
        })
      );
    });
  });

  describe('Queue Management', () => {
    const projectId1 = 'project-1';
    const projectId2 = 'project-2';
    const projectId3 = 'project-3';

    beforeEach(() => {
      ['project-1', 'project-2', 'project-3'].forEach(id => {
        const mockProject = createTestProject({
          id,
          name: `Project ${id}`,
          path: `/test/${id}`,
          currentConversationId: 'conv-123',
        });

        addProjectToRepository(mockProject);
      });
    });

    it('should maintain queue order', async () => {
      // Fill concurrent limit
      await agentManager.startAgent(projectId1, 'instructions 1');
      await agentManager.startAgent(projectId2, 'instructions 2');

      // Queue third project
      await agentManager.startAgent(projectId3, 'instructions 3');

      const resourceStatus = agentManager.getResourceStatus();
      expect(resourceStatus.queuedProjects[0]?.projectId).toBe(projectId3);
    });

    it('should remove from queue correctly', async () => {
      // Fill concurrent limit
      await agentManager.startAgent(projectId1, 'instructions 1');
      await agentManager.startAgent(projectId2, 'instructions 2');

      // Queue third project
      await agentManager.startAgent(projectId3, 'instructions 3');

      expect(agentManager.isQueued(projectId3)).toBe(true);

      agentManager.removeFromQueue(projectId3);

      expect(agentManager.isQueued(projectId3)).toBe(false);
      expect(agentManager.getResourceStatus().queuedCount).toBe(0);
    });

    it('should emit queue change events', async () => {
      const queueChangeListener = jest.fn();
      agentManager.on('queueChange', queueChangeListener);

      // Fill concurrent limit and queue a project
      await agentManager.startAgent(projectId1, 'instructions 1');
      await agentManager.startAgent(projectId2, 'instructions 2');
      await agentManager.startAgent(projectId3, 'instructions 3');

      expect(queueChangeListener).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ projectId: projectId3 }),
        ])
      );

      queueChangeListener.mockClear();

      agentManager.removeFromQueue(projectId3);

      expect(queueChangeListener).toHaveBeenCalledWith([]);
    });

    it('should process queue when max concurrent changes', async () => {
      // Start with max of 2, fill both slots
      await agentManager.startAgent(projectId1, 'instructions 1');
      await agentManager.startAgent(projectId2, 'instructions 2');
      await agentManager.startAgent(projectId3, 'instructions 3'); // Queued

      expect(agentManager.isQueued(projectId3)).toBe(true);

      // Increase max concurrent
      agentManager.setMaxConcurrentAgents(3);

      // Wait for queue processing
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(agentManager.isQueued(projectId3)).toBe(false);
    });

    it('should enforce minimum of 1 for max concurrent agents', () => {
      agentManager.setMaxConcurrentAgents(-1);
      expect(agentManager.getResourceStatus().maxConcurrent).toBe(1);

      agentManager.setMaxConcurrentAgents(0);
      expect(agentManager.getResourceStatus().maxConcurrent).toBe(1);

      agentManager.setMaxConcurrentAgents(5);
      expect(agentManager.getResourceStatus().maxConcurrent).toBe(5);
    });

    it('should throw ConflictError when starting interactive agent at concurrent limit', async () => {
      // Fill the concurrent limit with autonomous agents
      await agentManager.startAgent(projectId1, 'instructions 1');
      await agentManager.startAgent(projectId2, 'instructions 2');

      expect(agentManager.getResourceStatus().runningCount).toBe(2);

      // Interactive agent on a third project should throw, not queue
      await expect(
        agentManager.startInteractiveAgent(projectId3, { initialMessage: 'hello' })
      ).rejects.toThrow('limit');

      expect(agentManager.isQueued(projectId3)).toBe(false);
      expect(agentManager.getResourceStatus().runningCount).toBe(2);
      expect(agentManager.getResourceStatus().queuedCount).toBe(0);
    });

    it('should start interactive agent immediately when under concurrent limit', async () => {
      // Only one running agent — limit is 2
      await agentManager.startAgent(projectId1, 'instructions 1');

      await agentManager.startInteractiveAgent(projectId2, { initialMessage: 'hello' });

      expect(agentManager.isQueued(projectId2)).toBe(false);
      expect(agentManager.getResourceStatus().runningCount).toBe(2);
    });
  });

  describe('Agent Communication', () => {
    const projectId = 'test-project';

    beforeEach(() => {
      const mockProject = createTestProject({
        id: projectId,
        name: 'Test Project',
        path: '/test/project',
        currentConversationId: 'conv-123',
      });

      addProjectToRepository(mockProject);
    });

    it('should send input to interactive agent', async () => {
      await agentManager.startInteractiveAgent(projectId);

      // Let promises resolve
      await new Promise(resolve => setTimeout(resolve, 10));

      // Get the actual session/conversation ID from the agent
      const sessionId = agentManager.getSessionId(projectId);
      expect(sessionId).toBeTruthy();

      agentManager.sendInput(projectId, 'Hello Claude');

      // Let the save promise resolve
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify user message was saved to conversation
      expect(mockConversationRepository.addMessage).toHaveBeenCalledWith(
        projectId,
        sessionId,
        expect.objectContaining({
          type: 'user',
          content: 'Hello Claude',
        })
      );
    });

    it('should handle send input to non-existent agent', () => {
      expect(() => {
        agentManager.sendInput('non-existent', 'Hello');
      }).toThrow('No agent running for this project');
    });

    it('should handle send input to autonomous agent', async () => {
      await agentManager.startAgent(projectId, 'instructions');

      expect(() => {
        agentManager.sendInput(projectId, 'Hello');
      }).toThrow('Agent is not in interactive mode');
    });

    it('should handle multimodal input', async () => {
      await agentManager.startInteractiveAgent(projectId);

      // Let promises resolve
      await new Promise(resolve => setTimeout(resolve, 10));

      const images: ImageData[] = [
        { type: 'image/png', data: 'base64data' },
      ];

      agentManager.sendInput(projectId, 'Describe this image', images);

      // Let the save promise resolve
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should not throw and should save user message
      expect(mockConversationRepository.addMessage).toHaveBeenCalled();
    });

    it('should remove queued messages', async () => {
      const mockAgent = new MockClaudeAgent({
        projectId,
        projectPath: '/test/project',
        mode: 'interactive',
      });

      mockAgent.queuedMessages = ['message 1', 'message 2', 'message 3'];

      mockAgentFactory.create.mockReturnValue(mockAgent);

      await agentManager.startInteractiveAgent(projectId);

      // Now the agent manager delegates to the agent which has messages
      const result = agentManager.removeQueuedMessage(projectId, 1);

      expect(result).toBe(true); // Agent successfully removed message at index 1
      // Agent should now have 2 messages (removed the middle one)
      expect(mockAgent.queuedMessages).toEqual(['message 1', 'message 3']);

      // Try to remove invalid index
      const failResult = agentManager.removeQueuedMessage(projectId, 10);
      expect(failResult).toBe(false);

      // Try with non-existent project
      const noAgentResult = agentManager.removeQueuedMessage('non-existent', 0);
      expect(noAgentResult).toBe(false);
    });
  });

  describe('Event Handling', () => {
    const projectId = 'test-project';
    let mockAgent: MockClaudeAgent;

    beforeEach(() => {
      const mockProject = createTestProject({
        id: projectId,
        name: 'Test Project',
        path: '/test/project',
        currentConversationId: 'conv-123',
      });

      addProjectToRepository(mockProject);

      mockAgentFactory.create.mockImplementation((options) => {
        mockAgent = new MockClaudeAgent(options);
        return mockAgent;
      });
    });

    it('should forward agent messages', async () => {
      const messageListener = jest.fn();
      agentManager.on('message', messageListener);

      await agentManager.startAgent(projectId, 'instructions');

      const testMessage: AgentMessage = {
        type: 'stdout',
        content: 'Hello',
        timestamp: new Date().toISOString(),
      };

      mockAgent.simulateMessage(testMessage);

      expect(messageListener).toHaveBeenCalledWith(projectId, testMessage);
    });

    it('should save agent messages to conversation', async () => {
      await agentManager.startInteractiveAgent(projectId);

      // Get the actual session/conversation ID from the agent
      const sessionId = agentManager.getSessionId(projectId);
      expect(sessionId).toBeTruthy();

      const testMessage: AgentMessage = {
        type: 'stdout',
        content: 'Hello',
        timestamp: new Date().toISOString(),
      };

      mockAgent.simulateMessage(testMessage);

      // Wait for async save
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockConversationRepository.addMessage).toHaveBeenCalledWith(
        projectId,
        sessionId,
        testMessage
      );
    });

    it('should update project status on status change', async () => {
      await agentManager.startAgent(projectId, 'instructions');

      // Status should be updated when agent becomes running
      expect(mockProjectRepository.updateStatus).toHaveBeenCalledWith(projectId, 'running');

      // Simulate status change to stopped
      mockAgent.status = 'stopped';
      mockAgent.emit('status', 'stopped');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockProjectRepository.updateStatus).toHaveBeenCalledWith(projectId, 'stopped');
    });

    it('should handle waiting for input events', async () => {
      const waitingListener = jest.fn();
      agentManager.on('waitingForInput', waitingListener);

      await agentManager.startInteractiveAgent(projectId);

      mockAgent.simulateWaiting(true, 1);

      expect(waitingListener).toHaveBeenCalledWith(projectId, { isWaiting: true, version: 1 });
      expect(agentManager.isWaitingForInput(projectId)).toBe(true);
      expect(agentManager.getWaitingVersion(projectId)).toBe(1);
    });

    it('should handle agent exit', async () => {
      await agentManager.startAgent(projectId, 'instructions');

      expect(agentManager.isRunning(projectId)).toBe(true);

      mockAgent.simulateExit(0);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(agentManager.isRunning(projectId)).toBe(false);
    });

    it('should save context usage on exit', async () => {
      const contextUsage = createTestContextUsage();

      await agentManager.startAgent(projectId, 'instructions');

      mockAgent.simulateContextUsage(contextUsage);
      mockAgent.simulateExit(0);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockProjectRepository.updateContextUsage).toHaveBeenCalledWith(
        projectId,
        contextUsage
      );
    });
  });

  describe('Session Recovery', () => {
    const projectId = 'test-project';

    it('should handle session not found error', async () => {
      const mockProject = createTestProject({
        id: projectId,
        name: 'Test Project',
        path: '/test/project',
        currentConversationId: 'old-conv-id',
      });

      addProjectToRepository(mockProject);

      const sessionRecoveryListener = jest.fn();
      agentManager.on('sessionRecovery', sessionRecoveryListener);

      const mockAgent = new MockClaudeAgent({
        projectId,
        projectPath: '/test/project',
        mode: 'interactive',
      });

      mockAgentFactory.create.mockReturnValue(mockAgent);

      await agentManager.startInteractiveAgent(projectId);

      // Simulate session not found
      mockAgent.emit('sessionNotFound', 'missing-session-id');

      await new Promise(resolve => setTimeout(resolve, 10));

      // The session manager creates a new conversation and sets it as current
      expect(mockProjectRepository.setCurrentConversation).toHaveBeenCalledWith(
        projectId,
        expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      );
      expect(sessionRecoveryListener).toHaveBeenCalledWith(
        projectId,
        'missing-session-id',
        expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
        expect.stringContaining('Session not found')
      );
    });
  });

  describe('Process and Orphan Management', () => {
    const projectId = 'test-project';

    beforeEach(() => {
      const mockProject = createTestProject({
        id: projectId,
        name: 'Test Project',
        path: '/test/project',
        currentConversationId: 'conv-123',
      });

      addProjectToRepository(mockProject);
    });

    it('should track process PIDs', async () => {
      const mockAgent = new MockClaudeAgent({
        projectId,
        projectPath: '/test/project',
        mode: 'autonomous',
      });

      mockAgent.processInfo = {
        pid: 12345,
        cwd: '/test/project',
        startedAt: new Date().toISOString(),
      };

      mockAgentFactory.create.mockReturnValue(mockAgent);

      await agentManager.startAgent(projectId, 'instructions');

      const { getPidTracker } = require('../../../src/utils');
      const mockPidTracker = getPidTracker();

      expect(mockPidTracker.addProcess).toHaveBeenCalledWith(12345, projectId);
    });

    it('should cleanup PIDs on agent stop', async () => {
      const mockAgent = new MockClaudeAgent({
        projectId,
        projectPath: '/test/project',
        mode: 'autonomous',
      });

      mockAgent.processInfo = {
        pid: 12345,
        cwd: '/test/project',
        startedAt: new Date().toISOString(),
      };

      mockAgentFactory.create.mockReturnValue(mockAgent);

      await agentManager.startAgent(projectId, 'instructions');
      await agentManager.stopAgent(projectId);

      const { getPidTracker } = require('../../../src/utils');
      const mockPidTracker = getPidTracker();

      expect(mockPidTracker.removeProcess).toHaveBeenCalledWith(12345);
    });

    it('should delegate orphan cleanup', async () => {
      // AgentManager uses its internal process tracker, not getPidTracker
      // The test should verify that cleanupOrphanProcesses works
      const result = await agentManager.cleanupOrphanProcesses();

      // The default mock returns empty results
      expect(result).toEqual({
        foundCount: 0,
        killedCount: 0,
        killedPids: [],
        failedPids: [],
        skippedPids: [],
      });
    });

    it('should get tracked processes', () => {
      // AgentManager uses its internal process tracker
      // Initially it should be empty
      const result = agentManager.getTrackedProcesses();

      expect(result).toEqual([]);
    });
  });

  describe('Agent Restart on Settings Change', () => {
    const projectId1 = 'project-1';
    const projectId2 = 'project-2';

    beforeEach(() => {
      [projectId1, projectId2].forEach(id => {
        const mockProject = createTestProject({
          id,
          name: `Project ${id}`,
          path: `/test/${id}`,
          currentConversationId: `conv-${id}`,
        });

        addProjectToRepository(mockProject);
      });
    });

    it('should restart interactive agents', async () => {
      // Start interactive agents
      await agentManager.startInteractiveAgent(projectId1);
      await agentManager.startInteractiveAgent(projectId2);

      expect(agentManager.getRunningProjectIds()).toEqual([projectId1, projectId2]);

      // Restart all running agents
      await agentManager.restartAllRunningAgents();

      // Wait for restart process
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should still be running after restart
      expect(agentManager.getRunningProjectIds()).toEqual([projectId1, projectId2]);
    });

    it('should not restart autonomous agents', async () => {
      // Start autonomous agent
      await agentManager.startAgent(projectId1, 'instructions');

      const runningIds = agentManager.getRunningProjectIds();
      expect(runningIds).toContain(projectId1);

      // Restart all
      await agentManager.restartAllRunningAgents();

      // Autonomous agents should be stopped, not restarted
      expect(agentManager.getRunningProjectIds()).not.toContain(projectId1);
    });

    it('should handle restart errors gracefully', async () => {
      await agentManager.startInteractiveAgent(projectId1);

      // Mock project repository to fail on second lookup (for restart)
      const originalFindById = mockProjectRepository.findById.getMockImplementation();
      let callCount = 0;
      mockProjectRepository.findById.mockImplementation((projectId: string) => {
        callCount++;
        // First few calls succeed (for initial setup), subsequent calls fail
        if (callCount > 2 && projectId === projectId1) {
          return Promise.reject(new Error('Project lookup failed'));
        }
        return originalFindById ? originalFindById(projectId) : Promise.resolve(null);
      });

      // Should not throw
      await expect(agentManager.restartAllRunningAgents()).resolves.not.toThrow();
    });
  });

  describe('Shutdown and Cleanup', () => {
    const projectId1 = 'project-1';
    const projectId2 = 'project-2';

    beforeEach(() => {
      [projectId1, projectId2].forEach(id => {
        const mockProject = createTestProject({
          id,
          name: `Project ${id}`,
          path: `/test/${id}`,
          currentConversationId: 'conv-123',
        });

        addProjectToRepository(mockProject);
      });
    });

    it('should stop all agents and clear queue', async () => {
      // Register queue change listener before starting agents
      const queueChangeListener = jest.fn();
      agentManager.on('queueChange', queueChangeListener);

      // Start agents - with maxConcurrentAgents = 2, both should run immediately
      await agentManager.startAgent(projectId1, 'instructions 1');
      await agentManager.startAgent(projectId2, 'instructions 2');

      // Clear any previous calls from starting agents
      queueChangeListener.mockClear();

      await agentManager.stopAllAgents();

      expect(agentManager.getRunningProjectIds()).toEqual([]);
      expect(agentManager.getResourceStatus().queuedCount).toBe(0);

      // The queue change event might not be emitted if there was nothing in queue
      // So we just verify the state is correct
    });

    it('should flush pending message saves on shutdown', async () => {
      await agentManager.startInteractiveAgent(projectId1);

      // Add some pending saves (simulate async operations)
      const savePromise = new Promise<void>(resolve => setTimeout(resolve, 100));
      mockConversationRepository.addMessage.mockReturnValue(savePromise);

      // Trigger a message save
      agentManager.sendInput(projectId1, 'test message');

      // Stop all agents (should wait for pending saves)
      await agentManager.stopAllAgents();

      // Verify conversation repository flush was called
      expect(mockConversationRepository.flush).toHaveBeenCalled();
    });
  });

  describe('Status and Information Retrieval', () => {
    const projectId = 'test-project';

    beforeEach(() => {
      const mockProject = createTestProject({
        id: projectId,
        name: 'Test Project',
        path: '/test/project',
        currentConversationId: 'conv-123',
      });

      addProjectToRepository(mockProject);
    });

    it('should return full agent status', async () => {
      const fullStatus = agentManager.getFullStatus(projectId);

      expect(fullStatus).toEqual({
        status: 'stopped',
        mode: null,
        queued: false,
        queuedMessageCount: 0,
        isWaitingForInput: false,
        waitingVersion: 0,
        sessionId: null,
        permissionMode: null,
      });

      await agentManager.startInteractiveAgent(projectId);

      const runningStatus = agentManager.getFullStatus(projectId);

      expect(runningStatus.status).toBe('running');
      expect(runningStatus.mode).toBe('interactive');
      expect(runningStatus.queued).toBe(false);
    });

    it('should return agent information', async () => {
      const mockAgent = new MockClaudeAgent({
        projectId,
        projectPath: '/test/project',
        mode: 'interactive',
      });

      mockAgent.lastCommand = 'test command';
      mockAgent.contextUsage = createTestContextUsage();

      mockAgentFactory.create.mockReturnValue(mockAgent);

      await agentManager.startInteractiveAgent(projectId);

      expect(agentManager.getLastCommand(projectId)).toBe('test command');
      // Queue messages are managed separately, not on the agent
      expect(agentManager.getQueuedMessages(projectId)).toEqual([]);
      expect(agentManager.getQueuedMessageCount(projectId)).toBe(0);
      expect(agentManager.getContextUsage(projectId)).toEqual(mockAgent.contextUsage);
      expect(agentManager.getProcessInfo(projectId)).toEqual(mockAgent.processInfo);
    });

    it('should return null for non-existent agents', () => {
      expect(agentManager.getLastCommand('non-existent')).toBeNull();
      expect(agentManager.getProcessInfo('non-existent')).toBeNull();
      expect(agentManager.getContextUsage('non-existent')).toBeNull();
      expect(agentManager.getQueuedMessages('non-existent')).toEqual([]);
      expect(agentManager.getQueuedMessageCount('non-existent')).toBe(0);
      expect(agentManager.getSessionId('non-existent')).toBeNull();
    });
  });

  describe('Model Selection', () => {
    const projectId = 'test-project';

    it('should use project model override', async () => {
      const mockProject = createTestProject({
        id: projectId,
        name: 'Test Project',
        path: '/test/project',
        currentConversationId: 'conv-123',
        modelOverride: 'claude-opus-4-5-20251101',
      });

      addProjectToRepository(mockProject);

      await agentManager.startAgent(projectId, 'instructions');

      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-opus-4-5-20251101',
        })
      );
    });

    it('should fall back to global default model', async () => {
      const mockProject = createTestProject({
        id: projectId,
        name: 'Test Project',
        path: '/test/project',
        currentConversationId: 'conv-123',
      });

      addProjectToRepository(mockProject);

      await agentManager.startAgent(projectId, 'instructions');

      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-6',  // This is the DEFAULT_MODEL from config/models.ts
        })
      );
    });
  });

  describe('One-off agent interactive features', () => {
    const projectId = 'test-project';

    beforeEach(() => {
      const mockProject = createTestProject({
        id: projectId,
        name: 'Test Project',
        path: '/test/project',
      });

      addProjectToRepository(mockProject);
    });

    async function startOneOff(): Promise<string> {
      return agentManager.startOneOffAgent({
        projectId,
        message: 'test task',
        label: 'Test Task',
      });
    }

    it('should send input to one-off agent', async () => {
      const oneOffId = await startOneOff();
      const createdAgent = mockAgentFactory.create.mock.results[0]!.value as MockClaudeAgent;
      const sendInputSpy = jest.spyOn(createdAgent, 'sendInput');

      agentManager.sendOneOffInput(oneOffId, 'hello');

      expect(sendInputSpy).toHaveBeenCalledWith('hello');
    });

    it('should throw when sendOneOffInput called with invalid id', () => {
      expect(() => {
        agentManager.sendOneOffInput('nonexistent', 'hello');
      }).toThrow('No one-off agent found: nonexistent');
    });

    it('should return full status for one-off agent', async () => {
      const oneOffId = await startOneOff();
      const status = agentManager.getOneOffStatus(oneOffId);

      expect(status).not.toBeNull();
      expect(status!.status).toBe('running');
      expect(status!.mode).toBe('interactive');
      expect(status!.isWaitingForInput).toBe(false);
    });

    it('should return null status for unknown one-off agent', () => {
      expect(agentManager.getOneOffStatus('nonexistent')).toBeNull();
    });

    it('should return context usage from one-off agent', async () => {
      const oneOffId = await startOneOff();
      const createdAgent = mockAgentFactory.create.mock.results[0]!.value as MockClaudeAgent;

      createdAgent.simulateContextUsage(createTestContextUsage({ totalTokens: 5000 }));

      const context = agentManager.getOneOffContextUsage(oneOffId);

      expect(context).not.toBeNull();
      expect(context!.totalTokens).toBe(5000);
    });

    it('should return null context for unknown one-off agent', () => {
      expect(agentManager.getOneOffContextUsage('nonexistent')).toBeNull();
    });

    it('should emit oneOffWaiting event', async () => {
      const oneOffId = await startOneOff();
      const createdAgent = mockAgentFactory.create.mock.results[0]!.value as MockClaudeAgent;

      const waitingHandler = jest.fn();
      agentManager.on('oneOffWaiting', waitingHandler);

      createdAgent.simulateWaiting(true, 1);

      expect(waitingHandler).toHaveBeenCalledWith(oneOffId, true, 1);
    });

    it('should track waiting state via isOneOffWaitingForInput', async () => {
      const oneOffId = await startOneOff();
      const createdAgent = mockAgentFactory.create.mock.results[0]!.value as MockClaudeAgent;

      expect(agentManager.isOneOffWaitingForInput(oneOffId)).toBe(false);

      createdAgent.simulateWaiting(true, 1);

      expect(agentManager.isOneOffWaitingForInput(oneOffId)).toBe(true);

      createdAgent.simulateWaiting(false, 2);

      expect(agentManager.isOneOffWaitingForInput(oneOffId)).toBe(false);
    });

    it('should return false for isOneOffWaitingForInput with unknown id', () => {
      expect(agentManager.isOneOffWaitingForInput('nonexistent')).toBe(false);
    });

    it('should clean up waiting versions on stopOneOffAgent', async () => {
      const oneOffId = await startOneOff();
      const createdAgent = mockAgentFactory.create.mock.results[0]!.value as MockClaudeAgent;

      createdAgent.simulateWaiting(true, 1);

      expect(agentManager.isOneOffWaitingForInput(oneOffId)).toBe(true);

      await agentManager.stopOneOffAgent(oneOffId);

      expect(agentManager.getOneOffStatus(oneOffId)).toBeNull();
    });
  });
});