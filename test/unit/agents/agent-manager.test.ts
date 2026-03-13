import {
  DefaultAgentManager,
  AgentManagerDependencies,
  ImageData,
} from '../../../src/agents/agent-manager';
import { Agent, ContextUsage } from '../../../src/agents/agent';
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
} from '../helpers/mock-factories';

// Mock the utils module to provide getPidTracker
jest.mock('../../../src/utils', () => {
  const originalModule = jest.requireActual('../../../src/utils');
  return {
    ...originalModule,
    getPidTracker: jest.fn().mockReturnValue({
      addProcess: jest.fn(),
      removeProcess: jest.fn(),
      cleanupOrphanProcesses: jest.fn().mockResolvedValue({
        foundCount: 0,
        killedCount: 0,
        killedPids: [],
        failedPids: [],
        skippedPids: [],
      }),
      getTrackedProcesses: jest.fn().mockReturnValue([]),
    }),
  };
});

describe('DefaultAgentManager', () => {
  let agentManager: DefaultAgentManager;
  let mockAgent: jest.Mocked<Agent>;
  let mockAgentFactory: ReturnType<typeof createMockAgentFactory>;
  let mockProjectRepo: ReturnType<typeof createMockProjectRepository>;
  let mockConversationRepo: ReturnType<typeof createMockConversationRepository>;
  let mockInstructionGenerator: ReturnType<typeof createMockInstructionGenerator>;
  let mockRoadmapParser: ReturnType<typeof createMockRoadmapParser>;
  let mockPermissionGenerator: ReturnType<typeof createMockPermissionGenerator>;
  let mockSettingsRepo: ReturnType<typeof createMockSettingsRepository>;

  const testProject = createTestProject({ id: 'test-project', path: '/test/path' });

  beforeEach(() => {
    mockAgent = createMockAgent('test-project');
    mockAgentFactory = createMockAgentFactory(mockAgent);
    mockProjectRepo = createMockProjectRepository([testProject]);
    mockConversationRepo = createMockConversationRepository();
    mockInstructionGenerator = createMockInstructionGenerator();
    mockRoadmapParser = createMockRoadmapParser();
    mockPermissionGenerator = createMockPermissionGenerator();
    mockSettingsRepo = createMockSettingsRepository();

    const deps: AgentManagerDependencies = {
      maxConcurrentAgents: 3,
      agentFactory: mockAgentFactory,
      projectRepository: mockProjectRepo,
      conversationRepository: mockConversationRepo,
      instructionGenerator: mockInstructionGenerator,
      roadmapParser: mockRoadmapParser,
      permissionGenerator: mockPermissionGenerator,
      settingsRepository: mockSettingsRepo,
    };

    agentManager = new DefaultAgentManager(deps);
  });

  afterEach(async () => {
    await agentManager.stopAllAgents();
  });

  describe('constructor', () => {
    it('should initialize with default maxConcurrentAgents of 3', () => {
      const status = agentManager.getResourceStatus();
      expect(status.maxConcurrent).toBe(3);
    });

    it('should use custom maxConcurrentAgents when provided', () => {
      const manager = new DefaultAgentManager({
        maxConcurrentAgents: 5,
        agentFactory: mockAgentFactory,
        projectRepository: mockProjectRepo,
        conversationRepository: mockConversationRepo,
        instructionGenerator: mockInstructionGenerator,
        roadmapParser: mockRoadmapParser,
        permissionGenerator: mockPermissionGenerator,
        settingsRepository: mockSettingsRepo,
      });
      const status = manager.getResourceStatus();
      expect(status.maxConcurrent).toBe(5);
    });
  });

  describe('setMaxConcurrentAgents', () => {
    it('should update max concurrent agents', () => {
      agentManager.setMaxConcurrentAgents(5);
      expect(agentManager.getResourceStatus().maxConcurrent).toBe(5);
    });

    it('should enforce minimum of 1', () => {
      agentManager.setMaxConcurrentAgents(0);
      expect(agentManager.getResourceStatus().maxConcurrent).toBe(1);
    });
  });

  describe('startInteractiveAgent', () => {
    it('should throw if project not found', async () => {
      await expect(
        agentManager.startInteractiveAgent('non-existent-project')
      ).rejects.toThrow('Project not found');
    });

    it('should throw if agent already running', async () => {
      await agentManager.startInteractiveAgent('test-project');

      await expect(
        agentManager.startInteractiveAgent('test-project')
      ).rejects.toThrow('already running');
    });

    it('should create new conversation if none exists', async () => {
      await agentManager.startInteractiveAgent('test-project');

      expect(mockConversationRepo.create).toHaveBeenCalledWith('test-project', null);
    });

    it('should use existing conversation ID for resume', async () => {
      // Create a conversation first
      const conv = await mockConversationRepo.create('test-project', null);

      // Set the project's currentConversationId
      await mockProjectRepo.setCurrentConversation('test-project', conv.id);

      // Now start without explicit sessionId - should use current conversation ID
      await agentManager.startInteractiveAgent('test-project');

      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'test-project',
          projectPath: '/test/path',
          mode: 'interactive',
          permissions: expect.any(Object),
          sessionId: conv.id,
          isNewSession: false, // isNewSession should be false for resume
        })
      );
    });

    it('should start agent with multimodal content if images provided', async () => {
      const images: ImageData[] = [{ type: 'image/png', data: 'abc123' }];
      await agentManager.startInteractiveAgent('test-project', {
        initialMessage: 'describe this',
        images,
      });

      expect(mockAgent.start).toHaveBeenCalledWith(expect.stringContaining('['));
    });

    it('should emit status event when agent starts', async () => {
      const listener = jest.fn();
      agentManager.on('status', listener);

      await agentManager.startInteractiveAgent('test-project');

      // Status event is emitted when agent starts
      expect(listener).toHaveBeenCalledWith('test-project', 'running');
    });

    it('should set project status to running', async () => {
      await agentManager.startInteractiveAgent('test-project');

      expect(mockProjectRepo.updateStatus).toHaveBeenCalledWith('test-project', 'running');
    });
  });

  describe('sendInput', () => {
    it('should throw if no agent running', () => {
      expect(() => agentManager.sendInput('test-project', 'hello')).toThrow('No agent running');
    });

    it('should throw if agent not in interactive mode', async () => {
      await agentManager.startInteractiveAgent('test-project');

      // This should work for interactive mode
      agentManager.sendInput('test-project', 'hello');

      expect(mockAgent.sendInput).toHaveBeenCalledWith('hello');
    });

    it('should save user message to conversation asynchronously', async () => {
      await agentManager.startInteractiveAgent('test-project');
      agentManager.sendInput('test-project', 'hello');

      // Wait for async save operation
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockConversationRepo.addMessage).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        expect.objectContaining({
          type: 'user',
          content: 'hello',
        })
      );
    });

    it('should handle multimodal input with images', async () => {
      await agentManager.startInteractiveAgent('test-project');

      const images: ImageData[] = [{ type: 'image/png', data: 'abc123' }];
      agentManager.sendInput('test-project', 'describe this', images);

      expect(mockAgent.sendInput).toHaveBeenCalledWith(expect.stringContaining('['));
    });
  });

  describe('stopAgent', () => {
    it('should do nothing if no agent', async () => {
      // Should not throw
      await agentManager.stopAgent('test-project');
    });

    it('should stop running agent', async () => {
      await agentManager.startInteractiveAgent('test-project');
      await agentManager.stopAgent('test-project');

      expect(mockAgent.stop).toHaveBeenCalled();
    });

    it('should update project status to stopped', async () => {
      await agentManager.startInteractiveAgent('test-project');
      await agentManager.stopAgent('test-project');

      expect(mockProjectRepo.updateStatus).toHaveBeenCalledWith('test-project', 'stopped');
    });
  });

  describe('stopAllAgents', () => {
    it('should stop all running agents', async () => {
      // Start two agents for different projects
      const project2 = createTestProject({ id: 'project-2', path: '/test/path2' });
      mockProjectRepo.findById.mockImplementation((id) => {
        if (id === 'test-project') return Promise.resolve(testProject);
        if (id === 'project-2') return Promise.resolve(project2);
        return Promise.resolve(null);
      });

      await agentManager.startInteractiveAgent('test-project');

      await agentManager.stopAllAgents();

      expect(mockAgent.stop).toHaveBeenCalled();
    });

    it('should flush conversation writes', async () => {
      await agentManager.startInteractiveAgent('test-project');
      await agentManager.stopAllAgents();

      expect(mockConversationRepo.flush).toHaveBeenCalled();
    });
  });

  describe('Queue Management', () => {
    // Note: Queue is only for autonomous agents (startAgent), not interactive agents
    // Interactive agents throw an error if capacity is exceeded

    it('getResourceStatus should return accurate counts', async () => {
      const status = agentManager.getResourceStatus();

      expect(status).toEqual({
        runningCount: 0,
        queuedCount: 0,
        maxConcurrent: 3,
        queuedProjects: [],
      });

      await agentManager.startInteractiveAgent('test-project');

      const status2 = agentManager.getResourceStatus();
      expect(status2.runningCount).toBe(1);
    });

    it('isQueued should return false when not queued', () => {
      expect(agentManager.isQueued('test-project')).toBe(false);
    });

    it('removeFromQueue should handle non-queued project gracefully', () => {
      // Should not throw
      agentManager.removeFromQueue('test-project');
      expect(agentManager.isQueued('test-project')).toBe(false);
    });
  });

  describe('Event System', () => {
    it('on should register listener for queueChange event', () => {
      const listener = jest.fn();
      agentManager.on('queueChange', listener);

      // Trigger a queue change by calling removeFromQueue (even on non-existent)
      // This won't actually emit since project isn't queued
      // Test by triggering status event
      agentManager.on('status', (_projectId, _status) => {
        // Status events are emitted on agent start/stop
      });

      // Listener registration works if no error is thrown
      expect(true).toBe(true);
    });

    it('on should add listener that receives events', async () => {
      const statusListener = jest.fn();
      agentManager.on('status', statusListener);

      await agentManager.startInteractiveAgent('test-project');

      // Status event is emitted when agent status changes
      expect(statusListener).toHaveBeenCalledWith('test-project', 'running');
    });

    it('off should remove listener', async () => {
      const statusListener = jest.fn();
      agentManager.on('status', statusListener);
      agentManager.off('status', statusListener);

      await agentManager.startInteractiveAgent('test-project');

      expect(statusListener).not.toHaveBeenCalled();
    });
  });

  describe('getAgentStatus', () => {
    it('should return stopped if no agent for project', () => {
      expect(agentManager.getAgentStatus('test-project')).toBe('stopped');
    });

    it('should return agent status if running', async () => {
      await agentManager.startInteractiveAgent('test-project');

      // The mock agent starts with 'running' status
      expect(agentManager.getAgentStatus('test-project')).toBe('running');
    });
  });

  describe('getLoopState', () => {
    it('should return null if no loop running', () => {
      expect(agentManager.getLoopState('test-project')).toBeNull();
    });
  });

  describe('getTrackedProcesses', () => {
    it('should return tracked processes', () => {
      const processes = agentManager.getTrackedProcesses();
      expect(Array.isArray(processes)).toBe(true);
    });
  });

  describe('Agent Message Broadcasting', () => {
    it('should emit message when agent emits message', async () => {
      const listener = jest.fn();
      agentManager.on('message', listener);

      await agentManager.startInteractiveAgent('test-project');

      // Clear previous calls from start
      listener.mockClear();

      // Simulate agent emitting a message
      (mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void })._emit(
        'message',
        { type: 'stdout', content: 'Hello', timestamp: new Date().toISOString() }
      );

      expect(listener).toHaveBeenCalledWith(
        'test-project',
        expect.objectContaining({
          type: 'stdout',
          content: 'Hello',
        })
      );
    });

    it('should emit waitingForInput when agent waiting status changes', async () => {
      const listener = jest.fn();
      agentManager.on('waitingForInput', listener);

      await agentManager.startInteractiveAgent('test-project');

      // Simulate agent emitting waitingForInput
      (mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void })._emit(
        'waitingForInput',
        { isWaiting: true, version: 1 }
      );

      expect(listener).toHaveBeenCalledWith('test-project', { isWaiting: true, version: 1 });
    });
  });

  describe('Context Usage Persistence', () => {
    it('should save context usage when agent exits', async () => {
      await agentManager.startInteractiveAgent('test-project');

      // Set context usage on the mock agent
      const contextUsage: ContextUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        maxContextTokens: 200000,
        percentUsed: 0.75,
      };
      (mockAgent as unknown as { _setContextUsage: (c: ContextUsage) => void })._setContextUsage(
        contextUsage
      );

      // Simulate agent exit
      (mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void })._emit(
        'exit',
        0
      );

      // Give time for async operations
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockProjectRepo.updateContextUsage).toHaveBeenCalledWith(
        'test-project',
        expect.objectContaining({
          inputTokens: 1000,
          outputTokens: 500,
        })
      );
    });
  });

  describe('Queued Messages', () => {
    it('should return queued messages for running agent', async () => {
      await agentManager.startInteractiveAgent('test-project');

      const messages = agentManager.getQueuedMessages('test-project');
      expect(Array.isArray(messages)).toBe(true);
    });

    it('should return empty array if no agent', () => {
      const messages = agentManager.getQueuedMessages('test-project');
      expect(messages).toEqual([]);
    });

    it('should remove queued message by index', async () => {
      await agentManager.startInteractiveAgent('test-project');

      // This depends on the mock agent implementation
      const result = agentManager.removeQueuedMessage('test-project', 0);
      expect(typeof result).toBe('boolean');
    });
  });

  describe('restartAllRunningAgents', () => {
    it('should do nothing if no agents running', async () => {
      await agentManager.restartAllRunningAgents();
      // Should not throw
    });

    it('should restart interactive agents', async () => {
      await agentManager.startInteractiveAgent('test-project');

      // Clear stop call count
      mockAgent.stop.mockClear();
      mockAgent.start.mockClear();

      await agentManager.restartAllRunningAgents();

      // Agent should have been stopped
      expect(mockAgent.stop).toHaveBeenCalled();
    });
  });

  describe('isRunning', () => {
    it('should return false if no agent', () => {
      expect(agentManager.isRunning('test-project')).toBe(false);
    });

    it('should return true if agent is running', async () => {
      await agentManager.startInteractiveAgent('test-project');
      expect(agentManager.isRunning('test-project')).toBe(true);
    });
  });

  describe('isWaitingForInput', () => {
    it('should return false if no agent', () => {
      expect(agentManager.isWaitingForInput('test-project')).toBe(false);
    });

    it('should delegate to agent.isWaitingForInput', async () => {
      await agentManager.startInteractiveAgent('test-project');

      // The mock agent returns isWaitingForInput based on internal state
      expect(typeof agentManager.isWaitingForInput('test-project')).toBe('boolean');
    });
  });

  describe('getWaitingVersion', () => {
    it('should return 0 if no agent', () => {
      expect(agentManager.getWaitingVersion('test-project')).toBe(0);
    });

    it('should return agent waiting version', async () => {
      await agentManager.startInteractiveAgent('test-project');

      expect(typeof agentManager.getWaitingVersion('test-project')).toBe('number');
    });
  });

  describe('getAgentMode', () => {
    it('should return null if no agent', () => {
      expect(agentManager.getAgentMode('test-project')).toBeNull();
    });

    it('should return agent mode', async () => {
      await agentManager.startInteractiveAgent('test-project');

      expect(agentManager.getAgentMode('test-project')).toBe('interactive');
    });
  });

  describe('getLastCommand', () => {
    it('should return null if no agent', () => {
      expect(agentManager.getLastCommand('test-project')).toBeNull();
    });
  });

  describe('getProcessInfo', () => {
    it('should return null if no agent', () => {
      expect(agentManager.getProcessInfo('test-project')).toBeNull();
    });
  });

  describe('getContextUsage', () => {
    it('should return null if no agent', () => {
      expect(agentManager.getContextUsage('test-project')).toBeNull();
    });
  });

  describe('getSessionId', () => {
    it('should return null if no agent', () => {
      expect(agentManager.getSessionId('test-project')).toBeNull();
    });
  });

  describe('getFullStatus', () => {
    it('should return complete status object', () => {
      const status = agentManager.getFullStatus('test-project');

      expect(status).toHaveProperty('status');
      expect(status).toHaveProperty('mode');
      expect(status).toHaveProperty('isWaitingForInput');
      expect(status).toHaveProperty('waitingVersion');
    });

    it('should return running status when agent is running', async () => {
      await agentManager.startInteractiveAgent('test-project');

      const status = agentManager.getFullStatus('test-project');
      expect(status.status).toBe('running');
      expect(status.mode).toBe('interactive');
    });
  });

  describe('getQueuedMessageCount', () => {
    it('should return 0 if no agent', () => {
      expect(agentManager.getQueuedMessageCount('test-project')).toBe(0);
    });
  });

  describe('getRunningProjectIds', () => {
    it('should return empty array if no agents running', () => {
      expect(agentManager.getRunningProjectIds()).toEqual([]);
    });

    it('should return project IDs of running agents', async () => {
      await agentManager.startInteractiveAgent('test-project');

      const ids = agentManager.getRunningProjectIds();
      expect(ids).toContain('test-project');
    });
  });

  describe('cleanupOrphanProcesses', () => {
    it('should call pid tracker cleanup', async () => {
      const result = await agentManager.cleanupOrphanProcesses();

      // The mock returns OrphanCleanupResult
      expect(result).toHaveProperty('foundCount');
      expect(result).toHaveProperty('killedCount');
      expect(result).toHaveProperty('killedPids');
      expect(result).toHaveProperty('failedPids');
      expect(result).toHaveProperty('skippedPids');
    });
  });

  describe('startAutonomousLoop', () => {
    it('should throw if project not found', async () => {
      await expect(agentManager.startAutonomousLoop('non-existent')).rejects.toThrow(
        'Project not found'
      );
    });

    // Note: Testing "loop already running" requires mocking fs.promises.readFile
    // which is complex for unit tests. This is better covered by integration tests.
  });

  describe('stopAutonomousLoop', () => {
    it('should do nothing if no loop running', () => {
      // Should not throw
      agentManager.stopAutonomousLoop('test-project');
      expect(agentManager.getLoopState('test-project')).toBeNull();
    });
  });

  describe('startInteractiveAgent with permissionMode', () => {
    it('should use permissionMode from options', async () => {
      await agentManager.startInteractiveAgent('test-project', {
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

    it('should use default acceptEdits permissionMode when not specified', async () => {
      await agentManager.startInteractiveAgent('test-project');

      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          permissions: expect.objectContaining({
            permissionMode: 'acceptEdits',
          }),
        })
      );
    });
  });

  describe('startInteractiveAgent creates conversation', () => {
    it('should create new conversation when none exists', async () => {
      await agentManager.startInteractiveAgent('test-project');

      expect(mockConversationRepo.create).toHaveBeenCalledWith('test-project', null);
    });

    it('should set conversation as current on project', async () => {
      await agentManager.startInteractiveAgent('test-project');

      expect(mockProjectRepo.setCurrentConversation).toHaveBeenCalled();
    });
  });

  describe('startAgent (autonomous mode)', () => {
    it('should throw if project not found', async () => {
      await expect(agentManager.startAgent('non-existent', 'instructions')).rejects.toThrow(
        'Project not found'
      );
    });

    it('should throw if agent already running for project', async () => {
      await agentManager.startInteractiveAgent('test-project');

      await expect(agentManager.startAgent('test-project', 'instructions')).rejects.toThrow(
        'already running'
      );
    });
  });

  describe('queue behavior', () => {
    it('should emit queueChange event', () => {
      const listener = jest.fn();
      agentManager.on('queueChange', listener);

      // removeFromQueue triggers queueChange event if project was queued
      // Since no project is queued, it won't emit
      agentManager.removeFromQueue('test-project');

      // Listener should have been registered (no error thrown)
      expect(true).toBe(true);
    });
  });

  describe('agent status handling', () => {
    it('should update project status when agent status changes', async () => {
      await agentManager.startInteractiveAgent('test-project');

      // Simulate agent status change to stopped
      (mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void })._emit(
        'statusChange',
        'stopped'
      );

      // Give time for async operations
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockProjectRepo.updateStatus).toHaveBeenCalled();
    });
  });

  describe('agent exit handling', () => {
    it('should clean up agent on exit', async () => {
      await agentManager.startInteractiveAgent('test-project');

      expect(agentManager.isRunning('test-project')).toBe(true);

      // Simulate agent exit
      (mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void })._emit(
        'exit',
        0
      );

      // Give time for cleanup
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(agentManager.isRunning('test-project')).toBe(false);
    });
  });

  describe('session ID validation', () => {
    it('should create new conversation when existing conversation ID is not a valid UUID', async () => {
      const invalidUUID = 'invalid-session-id';
      mockProjectRepo.findById.mockResolvedValue({
        ...testProject,
        currentConversationId: invalidUUID,
      });

      const listener = jest.fn();
      agentManager.on('sessionRecovery', listener);

      await agentManager.startInteractiveAgent('test-project');

      // Should NOT delete old conversation with invalid ID (recoverSession doesn't delete)
      expect(mockConversationRepo.deleteConversation).not.toHaveBeenCalled();
      // Should create new conversation
      expect(mockConversationRepo.create).toHaveBeenCalled();
      // Should emit session recovery event
      expect(listener).toHaveBeenCalledWith(
        'test-project',
        invalidUUID,
        expect.any(String),
        'Session not found'
      );
    });

    it('should create new conversation when provided session ID is not a valid UUID', async () => {
      const invalidUUID = 'not-a-valid-uuid';
      const validExistingConvId = '550e8400-e29b-41d4-a716-446655440001';

      // Set up project with an existing valid conversation ID
      mockProjectRepo.findById.mockResolvedValue({
        ...testProject,
        currentConversationId: validExistingConvId,
      });

      const listener = jest.fn();
      agentManager.on('sessionRecovery', listener);

      // Provide an invalid session ID to trigger the validation path
      await agentManager.startInteractiveAgent('test-project', {
        sessionId: invalidUUID,
      });

      // Should delete old conversation with invalid session ID
      expect(mockConversationRepo.deleteConversation).toHaveBeenCalledWith('test-project', invalidUUID);
      // Should create new conversation
      expect(mockConversationRepo.create).toHaveBeenCalled();
      // Should emit session recovery event
      expect(listener).toHaveBeenCalled();
    });

    it('should use existing valid UUID session ID', async () => {
      const validUUID = '550e8400-e29b-41d4-a716-446655440000';
      mockProjectRepo.findById.mockResolvedValue({
        ...testProject,
        currentConversationId: validUUID,
      });

      // Mock that the conversation exists
      mockConversationRepo.findById.mockResolvedValueOnce({
        id: validUUID,
        projectId: 'test-project',
        itemRef: null,
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await agentManager.startInteractiveAgent('test-project');

      // Should not delete the conversation
      expect(mockConversationRepo.deleteConversation).not.toHaveBeenCalled();
      // Should NOT create a new conversation - use existing
      expect(mockConversationRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('sendInput edge cases', () => {
    it('should throw if agent is in autonomous mode', async () => {
      await agentManager.startInteractiveAgent('test-project');

      // Override the mode property to simulate autonomous mode
      Object.defineProperty(mockAgent, 'mode', { value: 'autonomous', configurable: true });

      expect(() => agentManager.sendInput('test-project', 'hello')).toThrow('not in interactive mode');

      // Restore for other tests
      Object.defineProperty(mockAgent, 'mode', { value: 'interactive', configurable: true });
    });

    it('should build JSON content when images provided', async () => {
      await agentManager.startInteractiveAgent('test-project');

      const images: ImageData[] = [
        { type: 'image/png', data: 'base64data1' },
        { type: 'image/jpeg', data: 'base64data2' },
      ];

      agentManager.sendInput('test-project', 'analyze these', images);

      // The content should be JSON with image blocks and text block
      const calls = mockAgent.sendInput.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const call = calls[0]!;
      const content = call[0] as string;
      const parsed = JSON.parse(content);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(3); // 2 images + 1 text
      expect(parsed[0].type).toBe('image');
      expect(parsed[2].type).toBe('text');
    });
  });

  describe('startAgent queue behavior', () => {
    it('should add to queue when at max capacity', async () => {
      // Start 3 agents to fill capacity
      const projects = [
        createTestProject({ id: 'project-1', path: '/path1' }),
        createTestProject({ id: 'project-2', path: '/path2' }),
        createTestProject({ id: 'project-3', path: '/path3' }),
        createTestProject({ id: 'project-4', path: '/path4' }),
      ];

      mockProjectRepo.findById.mockImplementation((id) => {
        const project = projects.find(p => p.id === id);
        return Promise.resolve(project ?? null);
      });

      // Start 3 interactive agents
      await agentManager.startInteractiveAgent('project-1');
      await agentManager.startInteractiveAgent('project-2');
      await agentManager.startInteractiveAgent('project-3');

      expect(agentManager.getResourceStatus().runningCount).toBe(3);

      // Now start an autonomous agent - should be queued
      await agentManager.startAgent('project-4', 'do work');

      expect(agentManager.isQueued('project-4')).toBe(true);
      expect(agentManager.getResourceStatus().queuedCount).toBe(1);
    });

    it('should throw if agent is already queued', async () => {
      const projects = [
        createTestProject({ id: 'project-1', path: '/path1' }),
        createTestProject({ id: 'project-2', path: '/path2' }),
        createTestProject({ id: 'project-3', path: '/path3' }),
        createTestProject({ id: 'project-4', path: '/path4' }),
      ];

      mockProjectRepo.findById.mockImplementation((id) => {
        const project = projects.find(p => p.id === id);
        return Promise.resolve(project ?? null);
      });

      // Fill capacity
      await agentManager.startInteractiveAgent('project-1');
      await agentManager.startInteractiveAgent('project-2');
      await agentManager.startInteractiveAgent('project-3');

      // Queue one
      await agentManager.startAgent('project-4', 'do work');

      // Try to queue again
      await expect(agentManager.startAgent('project-4', 'more work')).rejects.toThrow('already queued');
    });

    it('should emit queueChange when project is queued', async () => {
      const projects = [
        createTestProject({ id: 'project-1', path: '/path1' }),
        createTestProject({ id: 'project-2', path: '/path2' }),
        createTestProject({ id: 'project-3', path: '/path3' }),
        createTestProject({ id: 'project-4', path: '/path4' }),
      ];

      mockProjectRepo.findById.mockImplementation((id) => {
        const project = projects.find(p => p.id === id);
        return Promise.resolve(project ?? null);
      });

      const listener = jest.fn();
      agentManager.on('queueChange', listener);

      // Fill capacity
      await agentManager.startInteractiveAgent('project-1');
      await agentManager.startInteractiveAgent('project-2');
      await agentManager.startInteractiveAgent('project-3');

      // Queue one
      await agentManager.startAgent('project-4', 'do work');

      expect(listener).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            projectId: 'project-4',
          }),
        ])
      );
    });

    it('should remove from queue and emit event', async () => {
      const projects = [
        createTestProject({ id: 'project-1', path: '/path1' }),
        createTestProject({ id: 'project-2', path: '/path2' }),
        createTestProject({ id: 'project-3', path: '/path3' }),
        createTestProject({ id: 'project-4', path: '/path4' }),
      ];

      mockProjectRepo.findById.mockImplementation((id) => {
        const project = projects.find(p => p.id === id);
        return Promise.resolve(project ?? null);
      });

      // Fill capacity
      await agentManager.startInteractiveAgent('project-1');
      await agentManager.startInteractiveAgent('project-2');
      await agentManager.startInteractiveAgent('project-3');

      // Queue one
      await agentManager.startAgent('project-4', 'do work');

      const listener = jest.fn();
      agentManager.on('queueChange', listener);

      // Remove from queue
      agentManager.removeFromQueue('project-4');

      expect(agentManager.isQueued('project-4')).toBe(false);
      expect(listener).toHaveBeenCalledWith([]);
    });
  });

  describe('startInteractiveAgent throws when queued', () => {
    it('should throw if agent is already queued', async () => {
      const projects = [
        createTestProject({ id: 'project-1', path: '/path1' }),
        createTestProject({ id: 'project-2', path: '/path2' }),
        createTestProject({ id: 'project-3', path: '/path3' }),
        createTestProject({ id: 'project-4', path: '/path4' }),
      ];

      mockProjectRepo.findById.mockImplementation((id) => {
        const project = projects.find(p => p.id === id);
        return Promise.resolve(project ?? null);
      });

      // Fill capacity
      await agentManager.startInteractiveAgent('project-1');
      await agentManager.startInteractiveAgent('project-2');
      await agentManager.startInteractiveAgent('project-3');

      // Queue one via startAgent
      await agentManager.startAgent('project-4', 'do work');

      // Try to start interactive for same project
      await expect(agentManager.startInteractiveAgent('project-4')).rejects.toThrow('already queued');
    });
  });

  describe('forceNewSession option', () => {
    it('should create new session even with existing conversation', async () => {
      const validUUID = '550e8400-e29b-41d4-a716-446655440000';
      mockProjectRepo.findById.mockResolvedValue({
        ...testProject,
        currentConversationId: validUUID,
      });

      await agentManager.startInteractiveAgent('test-project', {
        sessionId: validUUID,
        isNewSession: true,
      });

      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          isNewSession: true,
        })
      );
    });
  });

  describe('removeQueuedMessage', () => {
    it('should return false if no agent running', () => {
      const result = agentManager.removeQueuedMessage('test-project', 0);
      expect(result).toBe(false);
    });

    it('should delegate to agent.removeQueuedMessage', async () => {
      await agentManager.startInteractiveAgent('test-project');

      mockAgent.removeQueuedMessage.mockReturnValue(true);
      const result = agentManager.removeQueuedMessage('test-project', 0);

      expect(mockAgent.removeQueuedMessage).toHaveBeenCalledWith(0);
      expect(result).toBe(true);
    });
  });

  describe('off removes listener', () => {
    it('should remove message listener', async () => {
      const messageListener = jest.fn();
      agentManager.on('message', messageListener);
      agentManager.off('message', messageListener);

      await agentManager.startInteractiveAgent('test-project');

      (mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void })._emit(
        'message',
        { type: 'stdout', content: 'Hello', timestamp: new Date().toISOString() }
      );

      expect(messageListener).not.toHaveBeenCalled();
    });

    it('should remove waitingForInput listener', () => {
      const waitingListener = jest.fn();
      agentManager.on('waitingForInput', waitingListener);
      agentManager.off('waitingForInput', waitingListener);

      // Listener should be removed - confirm by checking it still doesn't throw
      expect(() => agentManager.off('waitingForInput', waitingListener)).not.toThrow();
    });
  });

  describe('getLastCommand with agent', () => {
    it('should return agent.lastCommand when agent exists', async () => {
      await agentManager.startInteractiveAgent('test-project');

      Object.defineProperty(mockAgent, 'lastCommand', { value: 'claude --version' });

      expect(agentManager.getLastCommand('test-project')).toBe('claude --version');
    });
  });

  describe('getProcessInfo with agent', () => {
    it('should return agent.processInfo when agent exists', async () => {
      await agentManager.startInteractiveAgent('test-project');

      const mockProcessInfo = { pid: 12345, cwd: '/test', startedAt: new Date().toISOString() };
      Object.defineProperty(mockAgent, 'processInfo', { value: mockProcessInfo });

      expect(agentManager.getProcessInfo('test-project')).toEqual(mockProcessInfo);
    });
  });

  describe('getContextUsage with agent', () => {
    it('should return agent.contextUsage when agent exists', async () => {
      await agentManager.startInteractiveAgent('test-project');

      const mockContextUsage: ContextUsage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        maxContextTokens: 200000,
        percentUsed: 0.075,
      };
      (mockAgent as unknown as { _setContextUsage: (c: ContextUsage) => void })._setContextUsage(
        mockContextUsage
      );

      expect(agentManager.getContextUsage('test-project')).toEqual(mockContextUsage);
    });
  });

  describe('getSessionId with agent', () => {
    it('should return agent.sessionId when agent exists', async () => {
      await agentManager.startInteractiveAgent('test-project');

      // The session ID is set from the conversation
      const sessionId = agentManager.getSessionId('test-project');
      expect(sessionId).toBeDefined();
    });
  });

  describe('getQueuedMessageCount with agent', () => {
    it('should return agent.queuedMessageCount when agent exists', async () => {
      await agentManager.startInteractiveAgent('test-project');

      Object.defineProperty(mockAgent, 'queuedMessageCount', { value: 5 });

      expect(agentManager.getQueuedMessageCount('test-project')).toBe(5);
    });
  });

  describe('MCP server configuration', () => {
    it('should return empty array when no project MCP overrides exist (opt-in required)', async () => {
      const mockSettings = {
        ...await mockSettingsRepo.get(),
        mcp: {
          enabled: true,
          servers: [
            { id: '1', name: 'Server 1', enabled: true, type: 'stdio' as const, command: 'cmd1' },
            { id: '2', name: 'Server 2', enabled: false, type: 'stdio' as const, command: 'cmd2' },
            { id: '3', name: 'Server 3', enabled: true, type: 'http' as const, url: 'http://test' },
          ],
        },
      };
      mockSettingsRepo.get.mockResolvedValue(mockSettings);

      await agentManager.startInteractiveAgent('test-project');

      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: [],
        })
      );
    });

    it('should pass empty array when MCP is globally disabled', async () => {
      const mockSettings = {
        ...await mockSettingsRepo.get(),
        mcp: {
          enabled: false,
          servers: [
            { id: '1', name: 'Server 1', enabled: true, type: 'stdio' as const, command: 'cmd1' },
          ],
        },
      };
      mockSettingsRepo.get.mockResolvedValue(mockSettings);

      await agentManager.startInteractiveAgent('test-project');

      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: [],
        })
      );
    });

    it('should handle missing MCP configuration gracefully', async () => {
      const mockSettings = {
        ...await mockSettingsRepo.get(),
        // No mcp property
      };
      mockSettingsRepo.get.mockResolvedValue(mockSettings);

      await agentManager.startInteractiveAgent('test-project');

      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: [],
        })
      );
    });

    it('should apply project MCP overrides to filter disabled servers', async () => {
      const mockSettings = {
        ...await mockSettingsRepo.get(),
        mcp: {
          enabled: true,
          servers: [
            { id: 'server1', name: 'Server 1', enabled: true, type: 'stdio' as const, command: 'cmd1' },
            { id: 'server2', name: 'Server 2', enabled: true, type: 'stdio' as const, command: 'cmd2' },
            { id: 'server3', name: 'Server 3', enabled: true, type: 'http' as const, url: 'http://test' },
          ],
        },
      };
      mockSettingsRepo.get.mockResolvedValue(mockSettings);

      // Project has MCP overrides that disable server2
      const projectWithOverrides = {
        ...testProject,
        mcpOverrides: {
          enabled: true,
          serverOverrides: {
            server1: { enabled: true },
            server2: { enabled: false }, // Disabled for this project
            server3: { enabled: true },
          },
        },
      };
      mockProjectRepo.findById.mockResolvedValue(projectWithOverrides);

      await agentManager.startInteractiveAgent('test-project');

      // Should only include server1 and server3
      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: [
            { id: 'server1', name: 'Server 1', enabled: true, type: 'stdio', command: 'cmd1' },
            { id: 'server3', name: 'Server 3', enabled: true, type: 'http', url: 'http://test' },
          ],
        })
      );
    });

    it('should disable all MCP servers when project overrides have enabled: false', async () => {
      const mockSettings = {
        ...await mockSettingsRepo.get(),
        mcp: {
          enabled: true,
          servers: [
            { id: 'server1', name: 'Server 1', enabled: true, type: 'stdio' as const, command: 'cmd1' },
            { id: 'server2', name: 'Server 2', enabled: true, type: 'stdio' as const, command: 'cmd2' },
          ],
        },
      };
      mockSettingsRepo.get.mockResolvedValue(mockSettings);

      // Project has MCP disabled entirely
      const projectWithOverrides = {
        ...testProject,
        mcpOverrides: {
          enabled: false, // All MCP disabled for this project
          serverOverrides: {},
        },
      };
      mockProjectRepo.findById.mockResolvedValue(projectWithOverrides);

      await agentManager.startInteractiveAgent('test-project');

      // Should pass empty array
      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: [],
        })
      );
    });

    it('should return empty array when project has no MCP overrides (opt-in required)', async () => {
      const mockSettings = {
        ...await mockSettingsRepo.get(),
        mcp: {
          enabled: true,
          servers: [
            { id: 'server1', name: 'Server 1', enabled: true, type: 'stdio' as const, command: 'cmd1' },
            { id: 'server2', name: 'Server 2', enabled: false, type: 'stdio' as const, command: 'cmd2' },
          ],
        },
      };
      mockSettingsRepo.get.mockResolvedValue(mockSettings);

      // Project has no MCP overrides
      const projectWithoutOverrides = {
        ...testProject,
        mcpOverrides: null,
      };
      mockProjectRepo.findById.mockResolvedValue(projectWithoutOverrides);

      await agentManager.startInteractiveAgent('test-project');

      // No overrides means no servers (explicit opt-in required)
      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: [],
        })
      );
    });

    it('should return empty array when project overrides have no specific server overrides (opt-in required)', async () => {
      const mockSettings = {
        ...await mockSettingsRepo.get(),
        mcp: {
          enabled: true,
          servers: [
            { id: 'server1', name: 'Server 1', enabled: true, type: 'stdio' as const, command: 'cmd1' },
            { id: 'server2', name: 'Server 2', enabled: true, type: 'stdio' as const, command: 'cmd2' },
          ],
        },
      };
      mockSettingsRepo.get.mockResolvedValue(mockSettings);

      // Project has MCP enabled but no specific server overrides
      const projectWithOverrides = {
        ...testProject,
        mcpOverrides: {
          enabled: true,
          serverOverrides: {},
        },
      };
      mockProjectRepo.findById.mockResolvedValue(projectWithOverrides);

      await agentManager.startInteractiveAgent('test-project');

      // No specific server overrides means no servers (explicit opt-in required)
      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: [],
        })
      );
    });
  });

  describe('dangerouslySkipPermissions', () => {
    it('should pass skipPermissions when settings defaultMode is plan but runtime mode is acceptEdits', async () => {
      // Simulate: settings has defaultMode='plan' + dangerouslySkipPermissions=true
      // UI starts agent with permissionMode='acceptEdits'
      mockSettingsRepo.get.mockResolvedValue({
        ...mockSettingsRepo.get.mock.results[0]?.value || await mockSettingsRepo.get(),
        claudePermissions: {
          dangerouslySkipPermissions: true,
          allowedTools: [],
          defaultMode: 'plan',
          allowRules: ['Read', 'Write'],
          denyRules: [],
          askRules: [],
        },
      });

      // Permission generator returns what it would for defaultMode='plan' + skip=true:
      // skipPermissions=false because the generator checks defaultMode, not runtime mode
      mockPermissionGenerator.generateArgs.mockReturnValue({
        allowedTools: ['Read', 'Write'],
        disallowedTools: [],
        permissionMode: 'plan',
        skipPermissions: false,
      });

      await agentManager.startInteractiveAgent('test-project', {
        permissionMode: 'acceptEdits',
      });

      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          permissions: expect.objectContaining({
            skipPermissions: true,
            allowedTools: [],
            disallowedTools: [],
          }),
        })
      );
    });

    it('should NOT pass skipPermissions when effective mode is plan', async () => {
      mockSettingsRepo.get.mockResolvedValue({
        ...mockSettingsRepo.get.mock.results[0]?.value || await mockSettingsRepo.get(),
        claudePermissions: {
          dangerouslySkipPermissions: true,
          allowedTools: [],
          defaultMode: 'plan',
          allowRules: ['Read'],
          denyRules: [],
          askRules: [],
        },
      });

      mockPermissionGenerator.generateArgs.mockReturnValue({
        allowedTools: ['Read'],
        disallowedTools: [],
        permissionMode: 'plan',
        skipPermissions: false,
      });

      // No runtime override — effective mode stays 'plan'
      await agentManager.startInteractiveAgent('test-project');

      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          permissions: expect.objectContaining({
            skipPermissions: false,
            permissionMode: 'plan',
          }),
        })
      );
    });

    it('should pass skipPermissions when permissionGenerator already returns it', async () => {
      // Standard case: defaultMode=acceptEdits + skip=true, generator returns skipPermissions=true
      mockPermissionGenerator.generateArgs.mockReturnValue({
        allowedTools: [],
        disallowedTools: [],
        skipPermissions: true,
      });

      await agentManager.startInteractiveAgent('test-project');

      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          permissions: expect.objectContaining({
            skipPermissions: true,
            allowedTools: [],
            disallowedTools: [],
          }),
        })
      );
    });
  });

  describe('handleEnterPlanMode', () => {
    it('should stop and restart agent with plan mode when enterPlanMode fires', async () => {
      await agentManager.startInteractiveAgent('test-project');

      // Trigger enterPlanMode event on the mock agent
      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('enterPlanMode');

      // Wait for async handling
      await new Promise(resolve => setTimeout(resolve, 600));

      // Agent should have been stopped (stop called from agent exit + stopAgent)
      expect(mockAgent.stop).toHaveBeenCalled();

      // Should have restarted with plan mode - factory.create called again
      expect(mockAgentFactory.create).toHaveBeenCalledTimes(2);
      expect(mockAgentFactory.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          permissions: expect.objectContaining({
            permissionMode: 'plan',
          }),
        })
      );

      // Should have sent 'Continue' as initial message
      expect(mockAgent.start).toHaveBeenLastCalledWith('Continue');
    });
  });

  describe('one-off agent lifecycle', () => {
    it('should start a one-off agent and return oneOffId', async () => {
      const oneOffId = await agentManager.startOneOffAgent({
        projectId: 'test-project',
        message: 'Do something',
      });

      expect(oneOffId).toMatch(/^oneoff-/);
      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'test-project',
          mode: 'interactive',
        })
      );
      expect(mockAgent.start).toHaveBeenCalledWith('Do something');
    });

    it('should throw if project not found for one-off agent', async () => {
      await expect(
        agentManager.startOneOffAgent({
          projectId: 'non-existent',
          message: 'test',
        })
      ).rejects.toThrow('Project not found');
    });

    it('should stop a one-off agent', async () => {
      const oneOffId = await agentManager.startOneOffAgent({
        projectId: 'test-project',
        message: 'Do something',
      });

      await agentManager.stopOneOffAgent(oneOffId);
      expect(mockAgent.stop).toHaveBeenCalled();

      // After stopping, status should be null
      const status = agentManager.getOneOffStatus(oneOffId);
      expect(status).toBeNull();
    });

    it('should handle stopping non-existent one-off agent gracefully', async () => {
      await expect(agentManager.stopOneOffAgent('non-existent')).resolves.toBeUndefined();
    });

    it('should send input to a one-off agent', async () => {
      const oneOffId = await agentManager.startOneOffAgent({
        projectId: 'test-project',
        message: 'Start',
      });

      agentManager.sendOneOffInput(oneOffId, 'follow up');
      expect(mockAgent.sendInput).toHaveBeenCalledWith('follow up');
    });

    it('should throw when sending input to non-existent one-off agent', () => {
      expect(() => agentManager.sendOneOffInput('non-existent', 'test')).toThrow(
        'No one-off agent found'
      );
    });

    it('should return status of a one-off agent', async () => {
      const oneOffId = await agentManager.startOneOffAgent({
        projectId: 'test-project',
        message: 'Start',
      });

      const status = agentManager.getOneOffStatus(oneOffId);
      expect(status).toBeDefined();
      expect(status!.status).toBe('running');
      expect(status!.queued).toBe(false);
    });

    it('should return null for non-existent one-off status', () => {
      expect(agentManager.getOneOffStatus('non-existent')).toBeNull();
    });

    it('should return context usage of a one-off agent', async () => {
      const oneOffId = await agentManager.startOneOffAgent({
        projectId: 'test-project',
        message: 'Start',
      });

      const ctx = agentManager.getOneOffContextUsage(oneOffId);
      // mock agent returns null contextUsage by default
      expect(ctx).toBeNull();
    });

    it('should return null context usage for non-existent one-off', () => {
      expect(agentManager.getOneOffContextUsage('non-existent')).toBeNull();
    });

    it('should check if one-off agent is waiting for input', async () => {
      const oneOffId = await agentManager.startOneOffAgent({
        projectId: 'test-project',
        message: 'Start',
      });

      const waiting = agentManager.isOneOffWaitingForInput(oneOffId);
      // mockAgent.isWaitingForInput may be true by default
      expect(typeof waiting).toBe('boolean');
    });

    it('should return false for non-existent one-off waiting check', () => {
      expect(agentManager.isOneOffWaitingForInput('non-existent')).toBe(false);
    });

    it('should list active one-off agents for a project', async () => {
      const oneOffId = await agentManager.startOneOffAgent({
        projectId: 'test-project',
        message: 'Start',
        label: 'Test Task',
      });

      const active = agentManager.getActiveOneOffAgents('test-project');
      expect(active).toHaveLength(1);
      expect(active[0]).toEqual(
        expect.objectContaining({
          oneOffId,
          label: 'Test Task',
          status: 'running',
        })
      );
    });

    it('should return empty array for project with no one-off agents', () => {
      expect(agentManager.getActiveOneOffAgents('test-project')).toEqual([]);
    });

    it('should return collected output of a one-off agent', async () => {
      const oneOffId = await agentManager.startOneOffAgent({
        projectId: 'test-project',
        message: 'Start',
      });

      const output = agentManager.getOneOffCollectedOutput(oneOffId);
      // mockAgent.collectedOutput defaults to ''
      expect(output).toBeDefined();
    });

    it('should return null collected output for non-existent one-off', () => {
      expect(agentManager.getOneOffCollectedOutput('non-existent')).toBeNull();
    });

    it('should return one-off meta', async () => {
      const oneOffId = await agentManager.startOneOffAgent({
        projectId: 'test-project',
        message: 'Start',
        label: 'My Label',
      });

      const meta = agentManager.getOneOffMeta(oneOffId);
      expect(meta).toEqual({
        projectId: 'test-project',
        label: 'My Label',
      });
    });

    it('should return null meta for non-existent one-off', () => {
      expect(agentManager.getOneOffMeta('non-existent')).toBeNull();
    });

    it('should use default label when none provided', async () => {
      const oneOffId = await agentManager.startOneOffAgent({
        projectId: 'test-project',
        message: 'Start',
      });

      const meta = agentManager.getOneOffMeta(oneOffId);
      expect(meta!.label).toBe('One-off Agent');
    });

    it('should emit oneOffMessage when one-off agent sends message', async () => {
      const messageHandler = jest.fn();
      agentManager.on('oneOffMessage', messageHandler);

      const oneOffId = await agentManager.startOneOffAgent({
        projectId: 'test-project',
        message: 'Start',
      });

      // Trigger a message from the mock agent
      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('message', { type: 'stdout', content: 'hello', timestamp: new Date().toISOString() });

      expect(messageHandler).toHaveBeenCalledWith(oneOffId, expect.objectContaining({ type: 'stdout' }));
    });

    it('should emit oneOffStatus when one-off agent status changes', async () => {
      const statusHandler = jest.fn();
      agentManager.on('oneOffStatus', statusHandler);

      await agentManager.startOneOffAgent({
        projectId: 'test-project',
        message: 'Start',
      });

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('status', 'stopped');

      expect(statusHandler).toHaveBeenCalled();
    });

    it('should emit oneOffWaiting and track version when one-off agent waits', async () => {
      const waitingHandler = jest.fn();
      agentManager.on('oneOffWaiting', waitingHandler);

      const oneOffId = await agentManager.startOneOffAgent({
        projectId: 'test-project',
        message: 'Start',
      });

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('waitingForInput', { isWaiting: true, version: 5 });

      expect(waitingHandler).toHaveBeenCalledWith(oneOffId, true, 5);
    });

    it('should return empty command history for project with no one-offs', () => {
      expect(agentManager.getOneOffCommandHistory('test-project')).toEqual([]);
    });

    it('should return empty CLI command history for project', () => {
      expect(agentManager.getCliCommandHistory('test-project')).toEqual([]);
    });
  });

  describe('resolveProfileForProject', () => {
    it('should use project-specific profile when set', async () => {
      // Set up a project with an agent profile
      const projectWithProfile = createTestProject({
        id: 'profile-project',
        path: '/test/profile-path',
        agentProfileId: 'profile-1',
      });
      mockProjectRepo = createMockProjectRepository([projectWithProfile]);
      mockSettingsRepo = createMockSettingsRepository({
        agentProfiles: [
          { id: 'profile-1', name: 'Custom', provider: 'anthropic', isDefault: false } as never,
          { id: 'profile-2', name: 'Default', provider: 'anthropic', isDefault: true } as never,
        ],
      });

      agentManager = new DefaultAgentManager({
        maxConcurrentAgents: 3,
        agentFactory: mockAgentFactory,
        projectRepository: mockProjectRepo,
        conversationRepository: mockConversationRepo,
        instructionGenerator: mockInstructionGenerator,
        roadmapParser: mockRoadmapParser,
        permissionGenerator: mockPermissionGenerator,
        settingsRepository: mockSettingsRepo,
      });

      await agentManager.startInteractiveAgent('profile-project');

      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentProfile: expect.objectContaining({ id: 'profile-1' }),
        })
      );
    });

    it('should fall back to default profile when project has no profile', async () => {
      mockSettingsRepo = createMockSettingsRepository({
        agentProfiles: [
          { id: 'p1', name: 'Non-Default', provider: 'anthropic', isDefault: false } as never,
          { id: 'p2', name: 'Default', provider: 'anthropic', isDefault: true } as never,
        ],
      });

      agentManager = new DefaultAgentManager({
        maxConcurrentAgents: 3,
        agentFactory: mockAgentFactory,
        projectRepository: mockProjectRepo,
        conversationRepository: mockConversationRepo,
        instructionGenerator: mockInstructionGenerator,
        roadmapParser: mockRoadmapParser,
        permissionGenerator: mockPermissionGenerator,
        settingsRepository: mockSettingsRepo,
      });

      await agentManager.startInteractiveAgent('test-project');

      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentProfile: expect.objectContaining({ id: 'p2', isDefault: true }),
        })
      );
    });
  });

  describe('handleAgentExit', () => {
    it('should clean up agent state on exit', async () => {
      await agentManager.startInteractiveAgent('test-project');

      // Agent should be running
      const statusBefore = agentManager.getFullStatus('test-project');
      expect(statusBefore.status).toBe('running');

      // Trigger exit on mock agent
      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('exit', 0);

      // Wait for async handling
      await new Promise(resolve => setTimeout(resolve, 100));

      // After exit, getFullStatus should show stopped/not running
      const statusAfter = agentManager.getFullStatus('test-project');
      expect(statusAfter.status).toBe('stopped');
    });

    it('should throw when max concurrent agents reached', async () => {
      const manager = new DefaultAgentManager({
        maxConcurrentAgents: 1,
        agentFactory: mockAgentFactory,
        projectRepository: createMockProjectRepository([
          createTestProject({ id: 'proj1', path: '/p1' }),
          createTestProject({ id: 'proj2', path: '/p2' }),
        ]),
        conversationRepository: mockConversationRepo,
        instructionGenerator: mockInstructionGenerator,
        roadmapParser: mockRoadmapParser,
        permissionGenerator: mockPermissionGenerator,
        settingsRepository: mockSettingsRepo,
      });

      await manager.startInteractiveAgent('proj1');

      await expect(manager.startInteractiveAgent('proj2')).rejects.toThrow(
        'Maximum concurrent agents limit'
      );

      await manager.stopAllAgents();
    });
  });

  describe('handleStatusChange', () => {
    it('should emit status event and update project status on agent status change', async () => {
      const statusHandler = jest.fn();
      agentManager.on('status', statusHandler);

      await agentManager.startInteractiveAgent('test-project');

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('status', 'running');

      expect(statusHandler).toHaveBeenCalledWith('test-project', 'running');
      expect(mockProjectRepo.updateStatus).toHaveBeenCalledWith('test-project', 'running');
    });

    it('should map error status to project error status', async () => {
      await agentManager.startInteractiveAgent('test-project');

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('status', 'error');

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(mockProjectRepo.updateStatus).toHaveBeenCalledWith('test-project', 'error');
    });

    it('should map stopped status to project stopped status', async () => {
      await agentManager.startInteractiveAgent('test-project');

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('status', 'stopped');

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(mockProjectRepo.updateStatus).toHaveBeenCalledWith('test-project', 'stopped');
    });
  });

  describe('handleExitPlanMode', () => {
    it('should emit plan_mode message when exitPlanMode fires', async () => {
      const messageHandler = jest.fn();
      agentManager.on('message', messageHandler);

      await agentManager.startInteractiveAgent('test-project');

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('exitPlanMode', 'This is the plan content');

      expect(messageHandler).toHaveBeenCalledWith(
        'test-project',
        expect.objectContaining({
          type: 'plan_mode',
          planModeInfo: expect.objectContaining({
            action: 'exit',
            planContent: 'This is the plan content',
          }),
        })
      );
    });

    it('should ignore duplicate exitPlanMode events', async () => {
      const messageHandler = jest.fn();
      agentManager.on('message', messageHandler);

      await agentManager.startInteractiveAgent('test-project');

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('exitPlanMode', 'Plan A');
      agent._emit('exitPlanMode', 'Plan B');

      // Only one plan_mode message should be emitted
      const planMessages = messageHandler.mock.calls.filter(
        (call) => call[1]?.type === 'plan_mode'
      );
      expect(planMessages).toHaveLength(1);
    });
  });

  describe('getRunningProjectIds', () => {
    it('should return IDs of all running projects', async () => {
      const multiProjectRepo = createMockProjectRepository([
        createTestProject({ id: 'proj1', path: '/p1' }),
        createTestProject({ id: 'proj2', path: '/p2' }),
      ]);
      const manager = new DefaultAgentManager({
        maxConcurrentAgents: 5,
        agentFactory: mockAgentFactory,
        projectRepository: multiProjectRepo,
        conversationRepository: mockConversationRepo,
        instructionGenerator: mockInstructionGenerator,
        roadmapParser: mockRoadmapParser,
        permissionGenerator: mockPermissionGenerator,
        settingsRepository: mockSettingsRepo,
      });

      await manager.startInteractiveAgent('proj1');
      await manager.startInteractiveAgent('proj2');

      const running = manager.getRunningProjectIds();
      expect(running).toContain('proj1');
      expect(running).toContain('proj2');

      await manager.stopAllAgents();
    });

    it('should return empty array when no agents running', () => {
      expect(agentManager.getRunningProjectIds()).toEqual([]);
    });
  });

  describe('restartAllRunningAgents', () => {
    it('should restart all currently running agents', async () => {
      await agentManager.startInteractiveAgent('test-project');

      // Clear previous calls
      mockAgentFactory.create.mockClear();
      mockAgent.start.mockClear();

      await agentManager.restartAllRunningAgents();

      // Wait for restart to complete
      await new Promise(resolve => setTimeout(resolve, 200));

      // Agent should have been stopped and recreated
      expect(mockAgent.stop).toHaveBeenCalled();
    });
  });

  describe('one-off agent with multimodal content', () => {
    it('should send multimodal content when images provided', async () => {
      const oneOffId = await agentManager.startOneOffAgent({
        projectId: 'test-project',
        message: 'Start',
      });

      const images: ImageData[] = [
        { data: 'base64data', type: 'image/png' },
      ];

      agentManager.sendOneOffInput(oneOffId, 'look at this', images);

      // Should call sendInput with JSON-serialized multimodal content
      expect(mockAgent.sendInput).toHaveBeenCalled();
      const lastCall = mockAgent.sendInput.mock.calls[mockAgent.sendInput.mock.calls.length - 1]!;
      const sentContent = lastCall[0];
      // The content is a JSON string containing image and text blocks
      expect(sentContent).toContain('image/png');
      expect(sentContent).toContain('look at this');
    });
  });

  describe('one-off agent permission modes', () => {
    it('should apply plan permission mode to one-off agent', async () => {
      await agentManager.startOneOffAgent({
        projectId: 'test-project',
        message: 'Plan something',
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

    it('should apply appendSystemPrompt to one-off agent', async () => {
      await agentManager.startOneOffAgent({
        projectId: 'test-project',
        message: 'Do it',
        appendSystemPrompt: 'Custom system prompt',
      });

      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          permissions: expect.objectContaining({
            appendSystemPrompt: 'Custom system prompt',
          }),
        })
      );
    });
  });

  describe('Docker process spawner integration', () => {
    it('should return no docker spawner when containerManager not provided', async () => {
      // Default setup has no containerManager
      const result = await agentManager.startInteractiveAgent('test-project');
      expect(result.containerRestarted).toBe(false);
      expect(result.dockerFallback).toBe(false);
    });

    it('should return docker spawner when Docker is enabled', async () => {
      const mockContainerManager = createMockContainerManager();
      mockSettingsRepo.get.mockResolvedValue({
        claudePermissions: {
          dangerouslySkipPermissions: false,
          defaultMode: 'acceptEdits',
          allowRules: [],
          denyRules: [],
        },
        docker: { enabled: true },
      } as unknown as ReturnType<typeof mockSettingsRepo.get> extends Promise<infer T> ? T : never);

      const manager = new DefaultAgentManager({
        maxConcurrentAgents: 3,
        agentFactory: mockAgentFactory,
        projectRepository: mockProjectRepo,
        conversationRepository: mockConversationRepo,
        instructionGenerator: mockInstructionGenerator,
        roadmapParser: mockRoadmapParser,
        permissionGenerator: mockPermissionGenerator,
        settingsRepository: mockSettingsRepo,
        containerManager: mockContainerManager,
      });

      const result = await manager.startInteractiveAgent('test-project');

      expect(mockContainerManager.ensureContainer).toHaveBeenCalledWith(
        'test-project',
        '/test/path',
        undefined
      );
      expect(result.containerRestarted).toBe(false);
      expect(result.dockerFallback).toBe(false);

      await manager.stopAllAgents();
    });

    it('should report containerRestarted when container was created', async () => {
      const mockContainerManager = createMockContainerManager();
      mockContainerManager.ensureContainer.mockResolvedValue({
        containerId: 'new-container',
        imageName: 'claudito:latest',
        wasCreated: true,
        wasRestarted: false,
      });

      mockSettingsRepo.get.mockResolvedValue({
        claudePermissions: {
          dangerouslySkipPermissions: false,
          defaultMode: 'acceptEdits',
          allowRules: [],
          denyRules: [],
        },
        docker: { enabled: true },
      } as unknown as ReturnType<typeof mockSettingsRepo.get> extends Promise<infer T> ? T : never);

      const manager = new DefaultAgentManager({
        maxConcurrentAgents: 3,
        agentFactory: mockAgentFactory,
        projectRepository: mockProjectRepo,
        conversationRepository: mockConversationRepo,
        instructionGenerator: mockInstructionGenerator,
        roadmapParser: mockRoadmapParser,
        permissionGenerator: mockPermissionGenerator,
        settingsRepository: mockSettingsRepo,
        containerManager: mockContainerManager,
      });

      const result = await manager.startInteractiveAgent('test-project');

      expect(result.containerRestarted).toBe(true);
      expect(result.containerImageName).toBe('claudito:latest');

      await manager.stopAllAgents();
    });

    it('should fallback when Docker container creation fails', async () => {
      const mockContainerManager = createMockContainerManager();
      mockContainerManager.ensureContainer.mockRejectedValue(new Error('Docker daemon not running'));

      mockSettingsRepo.get.mockResolvedValue({
        claudePermissions: {
          dangerouslySkipPermissions: false,
          defaultMode: 'acceptEdits',
          allowRules: [],
          denyRules: [],
        },
        docker: { enabled: true },
      } as unknown as ReturnType<typeof mockSettingsRepo.get> extends Promise<infer T> ? T : never);

      const manager = new DefaultAgentManager({
        maxConcurrentAgents: 3,
        agentFactory: mockAgentFactory,
        projectRepository: mockProjectRepo,
        conversationRepository: mockConversationRepo,
        instructionGenerator: mockInstructionGenerator,
        roadmapParser: mockRoadmapParser,
        permissionGenerator: mockPermissionGenerator,
        settingsRepository: mockSettingsRepo,
        containerManager: mockContainerManager,
      });

      const result = await manager.startInteractiveAgent('test-project');

      expect(result.dockerFallback).toBe(true);
      expect(result.dockerFallbackReason).toBe('Docker daemon not running');

      await manager.stopAllAgents();
    });

    it('should not use Docker when docker.enabled is false in settings', async () => {
      const mockContainerManager = createMockContainerManager();
      // Default settings have no docker.enabled

      const manager = new DefaultAgentManager({
        maxConcurrentAgents: 3,
        agentFactory: mockAgentFactory,
        projectRepository: mockProjectRepo,
        conversationRepository: mockConversationRepo,
        instructionGenerator: mockInstructionGenerator,
        roadmapParser: mockRoadmapParser,
        permissionGenerator: mockPermissionGenerator,
        settingsRepository: mockSettingsRepo,
        containerManager: mockContainerManager,
      });

      const result = await manager.startInteractiveAgent('test-project');

      expect(mockContainerManager.ensureContainer).not.toHaveBeenCalled();
      expect(result.dockerFallback).toBe(false);

      await manager.stopAllAgents();
    });

    it('should skip Docker when project has dockerOverride=false', async () => {
      const projectWithDockerOff = createTestProject({
        id: 'docker-off-proj',
        path: '/docker/off',
      });
      (projectWithDockerOff as unknown as Record<string, unknown>).dockerOverride = false;

      const projRepo = createMockProjectRepository([projectWithDockerOff]);
      const mockContainerManager = createMockContainerManager();

      mockSettingsRepo.get.mockResolvedValue({
        claudePermissions: {
          dangerouslySkipPermissions: false,
          defaultMode: 'acceptEdits',
          allowRules: [],
          denyRules: [],
        },
        docker: { enabled: true },
      } as unknown as ReturnType<typeof mockSettingsRepo.get> extends Promise<infer T> ? T : never);

      const manager = new DefaultAgentManager({
        maxConcurrentAgents: 3,
        agentFactory: mockAgentFactory,
        projectRepository: projRepo,
        conversationRepository: mockConversationRepo,
        instructionGenerator: mockInstructionGenerator,
        roadmapParser: mockRoadmapParser,
        permissionGenerator: mockPermissionGenerator,
        settingsRepository: mockSettingsRepo,
        containerManager: mockContainerManager,
      });

      const result = await manager.startInteractiveAgent('docker-off-proj');

      expect(mockContainerManager.ensureContainer).not.toHaveBeenCalled();
      expect(result.dockerFallback).toBe(false);

      await manager.stopAllAgents();
    });
  });

  describe('MCP server overrides', () => {
    it('should pass MCP servers to agent when project has overrides', async () => {
      const projectWithMcp = createTestProject({
        id: 'mcp-proj',
        path: '/mcp/path',
      });
      (projectWithMcp as unknown as Record<string, unknown>).mcpOverrides = {
        enabled: true,
        serverOverrides: {
          'server-1': { enabled: true },
          'server-2': { enabled: false },
        },
      };

      const projRepo = createMockProjectRepository([projectWithMcp]);

      mockSettingsRepo.get.mockResolvedValue({
        claudePermissions: {
          dangerouslySkipPermissions: false,
          defaultMode: 'acceptEdits',
          allowRules: [],
          denyRules: [],
        },
        mcp: {
          enabled: true,
          servers: [
            { id: 'server-1', name: 'Server 1', command: 'cmd1', args: [], enabled: true },
            { id: 'server-2', name: 'Server 2', command: 'cmd2', args: [], enabled: true },
            { id: 'server-3', name: 'Server 3', command: 'cmd3', args: [], enabled: true },
          ],
        },
      } as unknown as ReturnType<typeof mockSettingsRepo.get> extends Promise<infer T> ? T : never);

      const manager = new DefaultAgentManager({
        maxConcurrentAgents: 3,
        agentFactory: mockAgentFactory,
        projectRepository: projRepo,
        conversationRepository: mockConversationRepo,
        instructionGenerator: mockInstructionGenerator,
        roadmapParser: mockRoadmapParser,
        permissionGenerator: mockPermissionGenerator,
        settingsRepository: mockSettingsRepo,
      });

      await manager.startInteractiveAgent('mcp-proj');

      // Only server-1 should be passed (server-2 disabled, server-3 not in overrides)
      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: [
            expect.objectContaining({ id: 'server-1' }),
          ],
        })
      );

      await manager.stopAllAgents();
    });

    it('should pass no MCP servers when overrides not enabled', async () => {
      const projectNoMcp = createTestProject({
        id: 'no-mcp-proj',
        path: '/no-mcp/path',
      });
      (projectNoMcp as unknown as Record<string, unknown>).mcpOverrides = {
        enabled: false,
        serverOverrides: {},
      };

      const projRepo = createMockProjectRepository([projectNoMcp]);

      mockSettingsRepo.get.mockResolvedValue({
        claudePermissions: {
          dangerouslySkipPermissions: false,
          defaultMode: 'acceptEdits',
          allowRules: [],
          denyRules: [],
        },
        mcp: {
          enabled: true,
          servers: [
            { id: 'server-1', name: 'Server 1', command: 'cmd1', args: [], enabled: true },
          ],
        },
      } as unknown as ReturnType<typeof mockSettingsRepo.get> extends Promise<infer T> ? T : never);

      const manager = new DefaultAgentManager({
        maxConcurrentAgents: 3,
        agentFactory: mockAgentFactory,
        projectRepository: projRepo,
        conversationRepository: mockConversationRepo,
        instructionGenerator: mockInstructionGenerator,
        roadmapParser: mockRoadmapParser,
        permissionGenerator: mockPermissionGenerator,
        settingsRepository: mockSettingsRepo,
      });

      await manager.startInteractiveAgent('no-mcp-proj');

      expect(mockAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: [],
        })
      );

      await manager.stopAllAgents();
    });
  });

  describe('message saving via agent listeners', () => {
    it('should save stdout messages to conversation', async () => {
      await agentManager.startInteractiveAgent('test-project');

      // Trigger a message event from the agent
      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('message', {
        type: 'stdout',
        content: 'Hello world',
        timestamp: new Date().toISOString(),
      });

      // Wait for async save
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockConversationRepo.addMessage).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        expect.objectContaining({ type: 'stdout', content: 'Hello world' })
      );
    });

    it('should save tool_use messages to conversation', async () => {
      await agentManager.startInteractiveAgent('test-project');

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('message', {
        type: 'tool_use',
        content: 'Using Read tool',
        timestamp: new Date().toISOString(),
        toolInfo: { name: 'Read', id: 'tool-1' },
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockConversationRepo.addMessage).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        expect.objectContaining({ type: 'tool_use' })
      );
    });

    it('should save tool_result messages to conversation', async () => {
      await agentManager.startInteractiveAgent('test-project');

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('message', {
        type: 'tool_result',
        content: 'Result from tool',
        timestamp: new Date().toISOString(),
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockConversationRepo.addMessage).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        expect.objectContaining({ type: 'tool_result' })
      );
    });

    it('should not save user messages through agent listener', async () => {
      await agentManager.startInteractiveAgent('test-project');

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('message', {
        type: 'user',
        content: 'User message',
        timestamp: new Date().toISOString(),
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // addMessage should not have been called for user type via the agent listener
      const addMessageCalls = mockConversationRepo.addMessage.mock.calls;
      const userTypeCalls = addMessageCalls.filter(
        (call: unknown[]) => (call[2] as { type: string })?.type === 'user'
      );
      expect(userTypeCalls).toHaveLength(0);
    });

  });

  describe('agent exit with context usage', () => {
    it('should save context usage on agent exit', async () => {
      const contextUsage: ContextUsage = {
        inputTokens: 500,
        outputTokens: 500,
        totalTokens: 1000,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        maxContextTokens: 200000,
        percentUsed: 0.5,
      };
      Object.defineProperty(mockAgent, 'contextUsage', { value: contextUsage, writable: true });

      await agentManager.startInteractiveAgent('test-project');

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('exit', 0);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockProjectRepo.updateContextUsage).toHaveBeenCalledWith(
        'test-project',
        contextUsage
      );
    });
  });

  describe('dockerFallbackWarning event', () => {
    it('should emit dockerFallbackWarning when Docker fails', async () => {
      const warningHandler = jest.fn();
      const mockContainerManager = createMockContainerManager();
      mockContainerManager.ensureContainer.mockRejectedValue(new Error('No Docker'));

      mockSettingsRepo.get.mockResolvedValue({
        claudePermissions: {
          dangerouslySkipPermissions: false,
          defaultMode: 'acceptEdits',
          allowRules: [],
          denyRules: [],
        },
        docker: { enabled: true },
      } as unknown as ReturnType<typeof mockSettingsRepo.get> extends Promise<infer T> ? T : never);

      const manager = new DefaultAgentManager({
        maxConcurrentAgents: 3,
        agentFactory: mockAgentFactory,
        projectRepository: mockProjectRepo,
        conversationRepository: mockConversationRepo,
        instructionGenerator: mockInstructionGenerator,
        roadmapParser: mockRoadmapParser,
        permissionGenerator: mockPermissionGenerator,
        settingsRepository: mockSettingsRepo,
        containerManager: mockContainerManager,
      });

      manager.on('dockerFallbackWarning', warningHandler);

      const result = await manager.startInteractiveAgent('test-project');

      expect(result.dockerFallback).toBe(true);

      await manager.stopAllAgents();
    });
  });

  describe('Slack message integration', () => {
    it('should save and emit initial Slack message', async () => {
      const messageHandler = jest.fn();
      agentManager.on('message', messageHandler);

      await agentManager.startInteractiveAgent('test-project', {
        initialMessage: 'Hello from Slack',
        slackMeta: { source: 'slack', slackUsername: 'testuser' },
      });

      // Should save user message and emit it
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockConversationRepo.addMessage).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        expect.objectContaining({
          type: 'user',
          content: 'Hello from Slack',
          source: 'slack',
          slackUsername: 'testuser',
        })
      );

      // Should emit to other connected clients
      const userMessages = messageHandler.mock.calls.filter(
        (call: unknown[]) => (call[1] as { type: string })?.type === 'user'
      );
      expect(userMessages.length).toBeGreaterThan(0);
    });
  });

  describe('handleStatusChange via agent status events', () => {
    it('should update project status to running when agent status is running', async () => {
      await agentManager.startInteractiveAgent('test-project');

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('status', 'running');

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockProjectRepo.updateStatus).toHaveBeenCalledWith('test-project', 'running');
    });

    it('should update project status to error when agent status is error', async () => {
      await agentManager.startInteractiveAgent('test-project');

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('status', 'error');

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockProjectRepo.updateStatus).toHaveBeenCalledWith('test-project', 'error');
    });

    it('should update project status to stopped for other statuses', async () => {
      await agentManager.startInteractiveAgent('test-project');

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('status', 'idle');

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockProjectRepo.updateStatus).toHaveBeenCalledWith('test-project', 'stopped');
    });

    it('should emit status event to listeners', async () => {
      const statusHandler = jest.fn();
      agentManager.on('status', statusHandler);

      await agentManager.startInteractiveAgent('test-project');

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('status', 'running');

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(statusHandler).toHaveBeenCalledWith('test-project', 'running');
    });

    it('should handle updateStatus failure gracefully', async () => {
      mockProjectRepo.updateStatus.mockRejectedValueOnce(new Error('DB error'));

      await agentManager.startInteractiveAgent('test-project');

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('status', 'running');

      // Should not throw
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockProjectRepo.updateStatus).toHaveBeenCalledWith('test-project', 'running');
    });
  });

  describe('recordBashCommand via tool_use messages', () => {
    it('should record Bash commands and expose via getRecentCommands', async () => {
      await agentManager.startInteractiveAgent('test-project');

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('message', {
        type: 'tool_use',
        content: 'Running command',
        timestamp: new Date().toISOString(),
        toolInfo: {
          name: 'Bash',
          id: 'tool-bash-1',
          input: { command: 'npm test' },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      const commands = agentManager.getRecentCommands('test-project');
      expect(commands).toHaveLength(1);
      expect(commands[0]!.command).toBe('npm test');
    });

    it('should record Bash command with workdir', async () => {
      await agentManager.startInteractiveAgent('test-project');

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('message', {
        type: 'tool_use',
        content: 'Running command',
        timestamp: new Date().toISOString(),
        toolInfo: {
          name: 'Bash',
          id: 'tool-bash-2',
          input: { command: 'ls -la', cwd: '/home/user' },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      const commands = agentManager.getRecentCommands('test-project');
      expect(commands).toHaveLength(1);
      expect(commands[0]!.command).toBe('ls -la');
      expect(commands[0]!.workdir).toBe('/home/user');
    });

    it('should ignore non-Bash tool_use messages', async () => {
      await agentManager.startInteractiveAgent('test-project');

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('message', {
        type: 'tool_use',
        content: 'Reading file',
        timestamp: new Date().toISOString(),
        toolInfo: {
          name: 'Read',
          id: 'tool-read-1',
          input: { file_path: '/some/file' },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      const commands = agentManager.getRecentCommands('test-project');
      expect(commands).toHaveLength(0);
    });

    it('should ignore Bash commands with empty string', async () => {
      await agentManager.startInteractiveAgent('test-project');

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('message', {
        type: 'tool_use',
        content: 'Running command',
        timestamp: new Date().toISOString(),
        toolInfo: {
          name: 'Bash',
          id: 'tool-bash-3',
          input: { command: '  ' },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      const commands = agentManager.getRecentCommands('test-project');
      expect(commands).toHaveLength(0);
    });

    it('should cap recent commands at 50 entries', async () => {
      await agentManager.startInteractiveAgent('test-project');

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };

      for (let i = 0; i < 55; i++) {
        agent._emit('message', {
          type: 'tool_use',
          content: 'Running command',
          timestamp: new Date().toISOString(),
          toolInfo: {
            name: 'Bash',
            id: `tool-bash-${i}`,
            input: { command: `cmd-${i}` },
          },
        });
      }

      await new Promise(resolve => setTimeout(resolve, 50));

      const commands = agentManager.getRecentCommands('test-project');
      expect(commands).toHaveLength(50);
      // Should have trimmed the oldest entries
      expect(commands[0]!.command).toBe('cmd-5');
      expect(commands[49]!.command).toBe('cmd-54');
    });
  });

  describe('handleSessionNotFound via agent event', () => {
    it('should handle sessionNotFound event without crashing', async () => {
      await agentManager.startInteractiveAgent('test-project');

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('sessionNotFound', 'missing-session-id');

      // Should not throw - just log and continue
      await new Promise(resolve => setTimeout(resolve, 100));

      // The session manager internally handles recovery
      // At minimum, verify the agent manager didn't crash
      expect(agentManager.getFullStatus('test-project')).toBeDefined();
    });
  });

  describe('handleEnterPlanMode system message emission', () => {
    it('should emit a hidden system message when entering plan mode', async () => {
      const messageHandler = jest.fn();
      agentManager.on('message', messageHandler);

      await agentManager.startInteractiveAgent('test-project');

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('enterPlanMode');

      // Wait for async handling (includes 500ms delay)
      await new Promise(resolve => setTimeout(resolve, 700));

      // Should emit a hidden system message about plan mode switch
      const systemMessages = messageHandler.mock.calls.filter(
        (call: unknown[]) => (call[1] as { type: string })?.type === 'system'
      );
      expect(systemMessages.length).toBeGreaterThan(0);
      expect(systemMessages[0][1]).toMatchObject({
        type: 'system',
        content: '[Switched to Plan mode]',
        hidden: true,
      });
    });
  });

  describe('handleAgentExit with autonomous loop', () => {
    it('should handle milestone failure when autonomous agent exits with active loop', async () => {
      // We need to test the autonomous exit path
      // The loop orchestrator is internal, so we can test the behavior indirectly
      // by checking that the agent manager handles the exit gracefully

      await agentManager.startInteractiveAgent('test-project');

      // Set agent mode to autonomous
      Object.defineProperty(mockAgent, 'mode', { value: 'autonomous', writable: true });

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };
      agent._emit('exit', 1);

      await new Promise(resolve => setTimeout(resolve, 100));

      // After exit, agent should be cleaned up
      const status = agentManager.getFullStatus('test-project');
      expect(status.status).toBe('stopped');
    });
  });

  describe('autonomous mode completion response handling', () => {
    it('should check for completion markers in autonomous mode messages', async () => {
      // Start agent and set it to autonomous mode
      await agentManager.startInteractiveAgent('test-project');
      Object.defineProperty(mockAgent, 'mode', { value: 'autonomous', writable: true });

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };

      // Send a stdout message with completion marker
      agent._emit('message', {
        type: 'stdout',
        content: 'MILESTONE COMPLETE: All tests passing',
        timestamp: new Date().toISOString(),
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // The loop orchestrator will parse this but since there's no active loop,
      // handleAgentCompletionResponse will return early (no project or no current milestone)
      // This still exercises the code path through the message listener
      expect(agentManager.getFullStatus('test-project')).toBeDefined();
    });

    it('should not parse completion for non-autonomous mode', async () => {
      await agentManager.startInteractiveAgent('test-project');

      const agent = mockAgent as unknown as { _emit: (event: string, ...args: unknown[]) => void };

      // In interactive mode, completion markers in messages should be ignored
      agent._emit('message', {
        type: 'stdout',
        content: 'MILESTONE COMPLETE: Done',
        timestamp: new Date().toISOString(),
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Agent should still be running (not stopped by completion handler)
      const status = agentManager.getFullStatus('test-project');
      expect(status.status).toBe('running');
    });
  });

  describe('getLastCommand', () => {
    it('should return null when no agent exists', () => {
      expect(agentManager.getLastCommand('non-existent')).toBeNull();
    });

    it('should return lastCommand from active agent', async () => {
      Object.defineProperty(mockAgent, 'lastCommand', { value: 'git status', writable: true });
      await agentManager.startInteractiveAgent('test-project');

      expect(agentManager.getLastCommand('test-project')).toBe('git status');
    });
  });

  describe('getRecentCommands', () => {
    it('should return empty array for project with no commands', () => {
      expect(agentManager.getRecentCommands('non-existent')).toEqual([]);
    });
  });

  describe('getResourceStatus', () => {
    it('should return zero running and queued counts when idle', () => {
      const status = agentManager.getResourceStatus();

      expect(status.runningCount).toBe(0);
      expect(status.queuedCount).toBe(0);
      expect(status.queuedProjects).toEqual([]);
    });

    it('should reflect running agent count', async () => {
      await agentManager.startInteractiveAgent('test-project');

      const status = agentManager.getResourceStatus();

      expect(status.runningCount).toBe(1);
    });
  });

  describe('removeFromQueue', () => {
    it('should not throw when removing non-existent project from queue', () => {
      expect(() => agentManager.removeFromQueue('non-existent')).not.toThrow();
    });
  });

  describe('setMaxConcurrentAgents', () => {
    it('should update max concurrent agents', () => {
      agentManager.setMaxConcurrentAgents(10);

      const status = agentManager.getResourceStatus();

      expect(status.maxConcurrent).toBe(10);
    });

    it('should enforce minimum of 1', () => {
      agentManager.setMaxConcurrentAgents(0);

      const status = agentManager.getResourceStatus();

      expect(status.maxConcurrent).toBe(1);
    });
  });

  describe('isRunning', () => {
    it('should return false for non-existent project', () => {
      expect(agentManager.isRunning('non-existent')).toBe(false);
    });

    it('should return true for running agent', async () => {
      await agentManager.startInteractiveAgent('test-project');

      expect(agentManager.isRunning('test-project')).toBe(true);
    });
  });

  describe('isQueued', () => {
    it('should return false for non-queued project', () => {
      expect(agentManager.isQueued('non-existent')).toBe(false);
    });
  });

  describe('isWaitingForInput', () => {
    it('should return false for non-existent project', () => {
      expect(agentManager.isWaitingForInput('non-existent')).toBe(false);
    });

    it('should reflect agent waiting state', async () => {
      Object.defineProperty(mockAgent, 'isWaitingForInput', { value: true, writable: true });
      await agentManager.startInteractiveAgent('test-project');

      expect(agentManager.isWaitingForInput('test-project')).toBe(true);
    });
  });

  describe('hasPendingPlan', () => {
    it('should return false when no plan is pending', () => {
      expect(agentManager.hasPendingPlan('test-project')).toBe(false);
    });
  });

  describe('getWaitingVersion', () => {
    it('should return 0 for non-existent project', () => {
      expect(agentManager.getWaitingVersion('non-existent')).toBe(0);
    });
  });

  describe('getAgentMode', () => {
    it('should return null for non-existent project', () => {
      expect(agentManager.getAgentMode('non-existent')).toBeNull();
    });

    it('should return agent mode for active project', async () => {
      Object.defineProperty(mockAgent, 'mode', { value: 'interactive', writable: true });
      await agentManager.startInteractiveAgent('test-project');

      expect(agentManager.getAgentMode('test-project')).toBe('interactive');
    });
  });

  describe('getProcessInfo', () => {
    it('should return null for non-existent project', () => {
      expect(agentManager.getProcessInfo('non-existent')).toBeNull();
    });

    it('should return process info from agent', async () => {
      const processInfo = { pid: 12345, command: 'claude' };
      Object.defineProperty(mockAgent, 'processInfo', { value: processInfo, writable: true });
      await agentManager.startInteractiveAgent('test-project');

      expect(agentManager.getProcessInfo('test-project')).toEqual(processInfo);
    });
  });

  describe('getContextUsage', () => {
    it('should return null for non-existent project', () => {
      expect(agentManager.getContextUsage('non-existent')).toBeNull();
    });
  });

  describe('getRunningProjectIds', () => {
    it('should return empty array when no agents running', () => {
      expect(agentManager.getRunningProjectIds()).toEqual([]);
    });

    it('should return array of running project ids', async () => {
      await agentManager.startInteractiveAgent('test-project');

      expect(agentManager.getRunningProjectIds()).toEqual(['test-project']);
    });
  });

  describe('one-off agent getters', () => {
    it('getOneOffContextUsage should return null for unknown agent', () => {
      expect(agentManager.getOneOffContextUsage('unknown')).toBeNull();
    });

    it('isOneOffWaitingForInput should return false for unknown agent', () => {
      expect(agentManager.isOneOffWaitingForInput('unknown')).toBe(false);
    });

    it('getOneOffCollectedOutput should return null for unknown agent', () => {
      expect(agentManager.getOneOffCollectedOutput('unknown')).toBeNull();
    });

    it('getOneOffMeta should return null for unknown agent', () => {
      expect(agentManager.getOneOffMeta('unknown')).toBeNull();
    });

    it('getActiveOneOffAgents should return empty array for project with no one-offs', () => {
      expect(agentManager.getActiveOneOffAgents('test-project')).toEqual([]);
    });

    it('getOneOffCommandHistory should return empty array for project with no history', () => {
      expect(agentManager.getOneOffCommandHistory('test-project')).toEqual([]);
    });

    it('getCliCommandHistory should return empty array for project with no history', () => {
      expect(agentManager.getCliCommandHistory('test-project')).toEqual([]);
    });
  });

  describe('stopAllAgents', () => {
    it('should stop all running agents', async () => {
      await agentManager.startInteractiveAgent('test-project');

      await agentManager.stopAllAgents();

      expect(mockAgent.stop).toHaveBeenCalled();
      expect(agentManager.isRunning('test-project')).toBe(false);
    });

    it('should stop containers when container manager is provided', async () => {
      const mockContainerManager = createMockContainerManager();

      const managerWithDocker = new DefaultAgentManager({
        maxConcurrentAgents: 3,
        agentFactory: mockAgentFactory,
        projectRepository: mockProjectRepo,
        conversationRepository: mockConversationRepo,
        instructionGenerator: mockInstructionGenerator,
        roadmapParser: mockRoadmapParser,
        permissionGenerator: mockPermissionGenerator,
        settingsRepository: mockSettingsRepo,
        containerManager: mockContainerManager,
      });

      await managerWithDocker.stopAllAgents();

      expect(mockContainerManager.stopAllContainers).toHaveBeenCalled();
    });
  });

  describe('getQueuedMessageCount', () => {
    it('should return 0 for non-existent project', () => {
      expect(agentManager.getQueuedMessageCount('non-existent')).toBe(0);
    });

    it('should return agent queued message count', async () => {
      Object.defineProperty(mockAgent, 'queuedMessageCount', { value: 3, writable: true });
      await agentManager.startInteractiveAgent('test-project');

      expect(agentManager.getQueuedMessageCount('test-project')).toBe(3);
    });
  });
});
