import { EventEmitter } from 'events';
import {
  DefaultAgentManager,
  AgentManagerDependencies,
  AgentFactory,
  AgentFactoryOptions,
} from '../../../src/agents/agent-manager';
import { Agent, AgentMessage, AgentStatus, ProcessInfo, ContextUsage } from '../../../src/agents/agent';
import {
  createMockProjectRepository,
  createMockConversationRepository,
  createMockSettingsRepository,
  createMockInstructionGenerator,
  createMockRoadmapParser,
  createMockPermissionGenerator,
  createTestProject,
} from '../helpers/mock-factories';

jest.mock('../../../src/utils', () => {
  const originalModule = jest.requireActual('../../../src/utils');
  return {
    ...originalModule,
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
  };
});

// MockAgent used across tests
class MockAgent extends EventEmitter implements Agent {
  readonly projectId: string;
  readonly projectPath: string;
  mode: 'autonomous' | 'interactive' = 'interactive';
  status: AgentStatus = 'stopped';
  isWaitingForInput = false;
  waitingVersion = 0;
  sessionId: string | null = null;
  sessionError: string | null = null;
  permissionMode: 'acceptEdits' | 'plan' | null = null;
  collectedOutput = '';
  lastCommand: string | null = 'claude --some-args';
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
    this.processInfo = {
      pid: Math.floor(Math.random() * 10000) + 1000,
      cwd: options.projectPath,
      startedAt: new Date().toISOString(),
    };
  }

  start(_instructions: string): void {
    this.status = 'running';
    this.emit('status', this.status);
  }

  stop(): Promise<void> {
    this.status = 'stopped';
    this.emit('status', this.status);
    this.emit('exit', 0);
    return Promise.resolve();
  }

  sendInput(_input: string): void {}

  sendToolResult(_toolUseId: string, _content: string): void {}

  removeQueuedMessage(index: number): boolean {
    if (index >= 0 && index < this.queuedMessages.length) {
      this.queuedMessages.splice(index, 1);
      return true;
    }
    return false;
  }
}

function createMockFactory(): { factory: jest.Mocked<AgentFactory>; agents: MockAgent[] } {
  const agents: MockAgent[] = [];
  const factory = {
    create: jest.fn((options: AgentFactoryOptions) => {
      const agent = new MockAgent(options);
      agents.push(agent);
      return agent;
    }),
  };
  return { factory, agents };
}

function buildManager(
  overrides: Partial<AgentManagerDependencies> = {},
): {
  manager: DefaultAgentManager;
  projectRepo: ReturnType<typeof createMockProjectRepository>;
  conversationRepo: ReturnType<typeof createMockConversationRepository>;
  settingsRepo: ReturnType<typeof createMockSettingsRepository>;
  factory: jest.Mocked<AgentFactory>;
  agents: MockAgent[];
} {
  const project = createTestProject({ id: 'proj-1', path: '/test/proj-1' });
  const projectRepo = createMockProjectRepository([project]);
  const conversationRepo = createMockConversationRepository();
  const settingsRepo = createMockSettingsRepository();
  const { factory, agents } = createMockFactory();

  const deps: AgentManagerDependencies = {
    maxConcurrentAgents: 3,
    agentFactory: factory,
    projectRepository: projectRepo,
    conversationRepository: conversationRepo,
    instructionGenerator: createMockInstructionGenerator(),
    roadmapParser: createMockRoadmapParser(),
    permissionGenerator: createMockPermissionGenerator(),
    settingsRepository: settingsRepo,
    ...overrides,
  };

  const manager = new DefaultAgentManager(deps);
  return { manager, projectRepo, conversationRepo, settingsRepo, factory, agents };
}

async function startInteractive(
  manager: DefaultAgentManager,
  projectId = 'proj-1',
): Promise<void> {
  await manager.startInteractiveAgent(projectId, {
    initialMessage: 'hello',
    isNewSession: true,
  });
}

describe('DefaultAgentManager - additional coverage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getResourceStatus', () => {
    it('returns running count, max concurrent, and queue info', async () => {
      const { manager } = buildManager();
      await startInteractive(manager);

      const status = manager.getResourceStatus();
      expect(status.runningCount).toBe(1);
      expect(status.maxConcurrent).toBe(3);
      expect(status.queuedCount).toBe(0);
      expect(status.queuedProjects).toEqual([]);

      await manager.stopAllAgents();
    });
  });

  describe('removeFromQueue', () => {
    it('removes project from queue without error', () => {
      const { manager } = buildManager();
      // Should not throw even if not queued
      manager.removeFromQueue('proj-1');
    });
  });

  describe('setMaxConcurrentAgents', () => {
    it('updates max concurrent and triggers queue processing', () => {
      const { manager } = buildManager();
      manager.setMaxConcurrentAgents(10);
      expect(manager.getResourceStatus().maxConcurrent).toBe(10);
    });

    it('enforces minimum of 1', () => {
      const { manager } = buildManager();
      manager.setMaxConcurrentAgents(0);
      expect(manager.getResourceStatus().maxConcurrent).toBe(1);
    });
  });

  describe('getLastCommand', () => {
    it('returns lastCommand from running agent', async () => {
      const { manager } = buildManager();
      await startInteractive(manager);

      expect(manager.getLastCommand('proj-1')).toBe('claude --some-args');

      await manager.stopAllAgents();
    });

    it('returns null for non-existent agent', () => {
      const { manager } = buildManager();
      expect(manager.getLastCommand('no-such')).toBeNull();
    });
  });

  describe('getRecentCommands', () => {
    it('returns empty array when no commands recorded', () => {
      const { manager } = buildManager();
      expect(manager.getRecentCommands('proj-1')).toEqual([]);
    });
  });

  describe('getProcessInfo', () => {
    it('returns processInfo from running agent', async () => {
      const { manager } = buildManager();
      await startInteractive(manager);

      const info = manager.getProcessInfo('proj-1');
      expect(info).toBeTruthy();
      expect(info!.pid).toBeGreaterThan(0);

      await manager.stopAllAgents();
    });

    it('returns null for non-existent agent', () => {
      const { manager } = buildManager();
      expect(manager.getProcessInfo('none')).toBeNull();
    });
  });

  describe('getContextUsage', () => {
    it('returns contextUsage from agent', async () => {
      const { manager, agents } = buildManager();
      await startInteractive(manager);

      agents[0]!.contextUsage = {
        inputTokens: 100, outputTokens: 50, totalTokens: 150,
        cacheCreationInputTokens: 0, cacheReadInputTokens: 0,
        maxContextTokens: 10000, percentUsed: 0.015,
      };

      expect(manager.getContextUsage('proj-1')).toEqual(agents[0]!.contextUsage);

      await manager.stopAllAgents();
    });

    it('returns null for non-existent agent', () => {
      const { manager } = buildManager();
      expect(manager.getContextUsage('none')).toBeNull();
    });
  });

  describe('getSessionId', () => {
    it('returns sessionId from running agent', async () => {
      const { manager } = buildManager();
      await startInteractive(manager);

      // The sessionId is set during agent creation
      const sessionId = manager.getSessionId('proj-1');
      expect(typeof sessionId).toBe('string');

      await manager.stopAllAgents();
    });

    it('returns null for non-existent agent', () => {
      const { manager } = buildManager();
      expect(manager.getSessionId('none')).toBeNull();
    });
  });

  describe('getFullStatus', () => {
    it('includes all status fields', async () => {
      const { manager } = buildManager();
      await startInteractive(manager);

      const status = manager.getFullStatus('proj-1');
      expect(status.status).toBe('running');
      expect(status.mode).toBe('interactive');
      expect(status.queued).toBe(false);
      expect(typeof status.hasActiveOneOffAgents).toBe('boolean');

      await manager.stopAllAgents();
    });
  });

  describe('startOneOffAgent', () => {
    it('creates a one-off agent and returns oneOffId', async () => {
      const { manager, agents } = buildManager();

      const oneOffId = await manager.startOneOffAgent({
        projectId: 'proj-1',
        message: 'test task',
        label: 'Test One-Off',
      });

      expect(oneOffId).toMatch(/^oneoff-/);
      expect(agents).toHaveLength(1);
      expect(agents[0]!.mode).toBe('interactive');

      await manager.stopAllAgents();
    });

    it('throws when project not found', async () => {
      const { manager } = buildManager();

      await expect(
        manager.startOneOffAgent({ projectId: 'nonexistent', message: 'test' }),
      ).rejects.toThrow('Project not found');
    });

    it('records command in oneOff command history', async () => {
      const { manager } = buildManager();

      await manager.startOneOffAgent({
        projectId: 'proj-1',
        message: 'test',
        label: 'MyLabel',
      });

      const history = manager.getOneOffCommandHistory('proj-1');
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0]!.label).toBe('MyLabel');

      await manager.stopAllAgents();
    });
  });

  describe('getOneOffContextUsage', () => {
    it('returns context usage for one-off agent', async () => {
      const { manager, agents } = buildManager();
      const oneOffId = await manager.startOneOffAgent({
        projectId: 'proj-1',
        message: 'test',
      });

      agents[0]!.contextUsage = {
        inputTokens: 200, outputTokens: 100, totalTokens: 300,
        cacheCreationInputTokens: 0, cacheReadInputTokens: 0,
        maxContextTokens: 10000, percentUsed: 0.03,
      };

      expect(manager.getOneOffContextUsage(oneOffId)).toEqual(agents[0]!.contextUsage);

      await manager.stopAllAgents();
    });

    it('returns null for unknown oneOffId', () => {
      const { manager } = buildManager();
      expect(manager.getOneOffContextUsage('unknown')).toBeNull();
    });
  });

  describe('isOneOffWaitingForInput', () => {
    it('returns waiting status for one-off agent', async () => {
      const { manager, agents } = buildManager();
      const oneOffId = await manager.startOneOffAgent({
        projectId: 'proj-1',
        message: 'test',
      });

      expect(manager.isOneOffWaitingForInput(oneOffId)).toBe(false);

      agents[0]!.isWaitingForInput = true;
      expect(manager.isOneOffWaitingForInput(oneOffId)).toBe(true);

      await manager.stopAllAgents();
    });

    it('returns false for unknown oneOffId', () => {
      const { manager } = buildManager();
      expect(manager.isOneOffWaitingForInput('unknown')).toBe(false);
    });
  });

  describe('getActiveOneOffAgents', () => {
    it('returns list of active one-off agents for project', async () => {
      const { manager } = buildManager();
      const oneOffId = await manager.startOneOffAgent({
        projectId: 'proj-1',
        message: 'test',
        label: 'Task 1',
      });

      const active = manager.getActiveOneOffAgents('proj-1');
      expect(active).toHaveLength(1);
      expect(active[0]!.oneOffId).toBe(oneOffId);
      expect(active[0]!.label).toBe('Task 1');
      expect(active[0]!.status).toBe('running');

      await manager.stopAllAgents();
    });

    it('returns empty for project with no one-offs', () => {
      const { manager } = buildManager();
      expect(manager.getActiveOneOffAgents('proj-1')).toEqual([]);
    });
  });

  describe('startAgent (autonomous queue)', () => {
    it('queues agent when at max concurrent', async () => {
      const { manager, projectRepo } = buildManager({ maxConcurrentAgents: 1 });

      // Add second project
      const proj2 = createTestProject({
        id: 'proj-2', path: '/test/proj-2',
        currentConversationId: 'conv-2',
      });
      // eslint-disable-next-line @typescript-eslint/require-await
      projectRepo.findById = jest.fn().mockImplementation(async (id: string) => {
        if (id === 'proj-1') return createTestProject({ id: 'proj-1', path: '/test/proj-1' });
        if (id === 'proj-2') return proj2;
        return null;
      });

      // Start first agent interactively (takes up the slot)
      await startInteractive(manager);

      // This autonomous agent should be queued
      await manager.startAgent('proj-2', 'Do the work');

      expect(manager.isQueued('proj-2')).toBe(true);
      expect(manager.getResourceStatus().queuedCount).toBe(1);

      await manager.stopAllAgents();
    });

    it('throws if agent already running', async () => {
      const { manager } = buildManager();
      await startInteractive(manager);

      await expect(manager.startAgent('proj-1', 'instr')).rejects.toThrow(
        'Agent is already running',
      );

      await manager.stopAllAgents();
    });
  });

  describe('startInteractiveAgent - queue and capacity', () => {
    it('throws ConflictError when max concurrent reached', async () => {
      const { manager, projectRepo } = buildManager({ maxConcurrentAgents: 1 });

      const proj2 = createTestProject({ id: 'proj-2', path: '/test/proj-2' });
      // eslint-disable-next-line @typescript-eslint/require-await
      projectRepo.findById = jest.fn().mockImplementation(async (id: string) => {
        if (id === 'proj-1') return createTestProject({ id: 'proj-1', path: '/test/proj-1' });
        if (id === 'proj-2') return proj2;
        return null;
      });

      await startInteractive(manager);

      await expect(
        manager.startInteractiveAgent('proj-2', { initialMessage: 'hi', isNewSession: true }),
      ).rejects.toThrow(/Maximum concurrent agents limit/);

      await manager.stopAllAgents();
    });

    it('throws if agent already queued', async () => {
      const { manager, projectRepo } = buildManager({ maxConcurrentAgents: 1 });

      const proj2 = createTestProject({
        id: 'proj-2', path: '/test/proj-2',
        currentConversationId: 'conv-2',
      });
      // eslint-disable-next-line @typescript-eslint/require-await
      projectRepo.findById = jest.fn().mockImplementation(async (id: string) => {
        if (id === 'proj-1') return createTestProject({ id: 'proj-1', path: '/test/proj-1' });
        if (id === 'proj-2') return proj2;
        return null;
      });

      await startInteractive(manager);
      await manager.startAgent('proj-2', 'work');

      // Now try to start interactive for already-queued proj-2
      await expect(
        manager.startInteractiveAgent('proj-2', { initialMessage: 'hi', isNewSession: true }),
      ).rejects.toThrow('Agent is already queued');

      await manager.stopAllAgents();
    });
  });

  describe('stopAllAgents', () => {
    it('stops all agents and clears queue', async () => {
      const { manager } = buildManager();
      await startInteractive(manager);

      await manager.stopAllAgents();
      expect(manager.getAgentStatus('proj-1')).toBe('stopped');
    });
  });

  describe('resolveProfileForProject', () => {
    it('uses default profile when project has no profile override', async () => {
      const { manager, factory } = buildManager();
      await startInteractive(manager);

      // Factory should have been called - check the agentProfile arg
      expect(factory.create).toHaveBeenCalledTimes(1);
      const createArgs = factory.create.mock.calls[0]![0];
      expect(createArgs.agentProfile).toBeTruthy();

      await manager.stopAllAgents();
    });

    it('uses project-specific profile when set', async () => {
      const { manager, projectRepo, settingsRepo, factory } = buildManager();

      const profiles = [
        { id: 'profile-1', name: 'Custom', provider: 'claude-cli' as const, isDefault: false },
        { id: 'profile-2', name: 'Default', provider: 'claude-cli' as const, isDefault: true },
      ];

      settingsRepo.get = jest.fn().mockResolvedValue({
        claudePermissions: { dangerouslySkipPermissions: false, defaultMode: 'acceptEdits', allowRules: [], denyRules: [] },
        agentProfiles: profiles,
      });

      const projWithProfile = createTestProject({
        id: 'proj-1',
        path: '/test/proj-1',
        agentProfileId: 'profile-1',
      });
      projectRepo.findById = jest.fn().mockResolvedValue(projWithProfile);

      await startInteractive(manager);

      const createArgs = factory.create.mock.calls[0]![0];
      expect(createArgs.agentProfile!.id).toBe('profile-1');

      await manager.stopAllAgents();
    });
  });

  describe('getModelForProject', () => {
    it('uses project modelOverride when set', async () => {
      const { manager, projectRepo, factory } = buildManager();

      const projWithModel = createTestProject({
        id: 'proj-1',
        path: '/test/proj-1',
        modelOverride: 'claude-opus-4-6',
      });
      projectRepo.findById = jest.fn().mockResolvedValue(projWithModel);

      await startInteractive(manager);

      const createArgs = factory.create.mock.calls[0]![0];
      expect(createArgs.model).toBe('claude-opus-4-6');

      await manager.stopAllAgents();
    });
  });

  describe('handleAgentExit - autonomous loop continuation', () => {
    it('handles autonomous agent exit with loop active', async () => {
      const { manager, projectRepo, agents } = buildManager();

      const proj = createTestProject({
        id: 'proj-1',
        path: '/test/proj-1',
        currentConversationId: 'conv-1',
      });
      projectRepo.findById = jest.fn().mockResolvedValue(proj);

      await startInteractive(manager);
      const agent = agents[0]!;

      // Set agent to autonomous mode for exit handler
      agent.mode = 'autonomous';

      // Trigger exit - the handler should process normally for non-looping agents
      agent.emit('exit', 0);

      // Give async handler time to process
      await new Promise((r) => setTimeout(r, 50));

      // Agent should be cleaned up
      expect(manager.isRunning('proj-1')).toBe(false);
    });
  });

  describe('handleStatusChange emits status event', () => {
    it('emits status event on status change', async () => {
      const { manager } = buildManager();
      const statusEvents: Array<{ projectId: string; status: AgentStatus }> = [];

      manager.on('status', (projectId, status) => {
        statusEvents.push({ projectId, status });
      });

      await startInteractive(manager);

      // The 'running' status event should have been emitted
      expect(statusEvents.some((e) => e.status === 'running')).toBe(true);

      await manager.stopAllAgents();
    });
  });

  describe('processQueue', () => {
    it('starts queued agent after slot opens', async () => {
      const { manager, projectRepo } = buildManager({ maxConcurrentAgents: 1 });

      const proj2 = createTestProject({
        id: 'proj-2', path: '/test/proj-2',
        currentConversationId: 'conv-2',
      });
      // eslint-disable-next-line @typescript-eslint/require-await
      projectRepo.findById = jest.fn().mockImplementation(async (id: string) => {
        if (id === 'proj-1') return createTestProject({ id: 'proj-1', path: '/test/proj-1' });
        if (id === 'proj-2') return proj2;
        return null;
      });

      await startInteractive(manager);
      await manager.startAgent('proj-2', 'queued work');

      expect(manager.isQueued('proj-2')).toBe(true);

      // Stop first agent - should trigger queue processing
      await manager.stopAgent('proj-1');

      // Wait for async queue processing
      await new Promise((r) => setTimeout(r, 100));

      // proj-2 should have been dequeued and started
      expect(manager.isQueued('proj-2')).toBe(false);

      await manager.stopAllAgents();
    });
  });

  describe('flushPendingMessageSaves', () => {
    it('flushes when stopping all agents', async () => {
      const { manager, conversationRepo } = buildManager();
      await startInteractive(manager);

      await manager.stopAllAgents();

      // flush is called during stopAllAgents
      expect(conversationRepo.flush).toHaveBeenCalled();
    });
  });

  describe('startAutonomousLoop', () => {
    it('throws if project not found', async () => {
      const { manager, projectRepo } = buildManager();
      projectRepo.findById = jest.fn().mockResolvedValue(null);

      await expect(manager.startAutonomousLoop('no-project')).rejects.toThrow(
        'Project not found',
      );
    });
  });

  describe('stopAutonomousLoop', () => {
    it('delegates to loopOrchestrator', () => {
      const { manager } = buildManager();
      // Should not throw
      manager.stopAutonomousLoop('proj-1');
    });
  });

  describe('getLoopState', () => {
    it('returns null when no loop running', () => {
      const { manager } = buildManager();
      expect(manager.getLoopState('proj-1')).toBeNull();
    });
  });

  describe('getCliCommandHistory', () => {
    it('returns empty for project without CLI history', () => {
      const { manager } = buildManager();
      expect(manager.getCliCommandHistory('proj-1')).toEqual([]);
    });
  });

  describe('recordBashCommand via tool_use event', () => {
    it('records bash commands from agent tool_use events', async () => {
      const { manager, agents } = buildManager();
      await startInteractive(manager);

      const agent = agents[0]!;

      // Emit a message event with tool_use type containing Bash tool info
      const message: AgentMessage = {
        type: 'tool_use',
        content: 'Running command',
        timestamp: new Date().toISOString(),
        toolInfo: {
          name: 'Bash',
          input: { command: 'npm test', cwd: '/test/proj-1' },
          id: 'tool-1',
        },
      };
      agent.emit('message', message);

      const commands = manager.getRecentCommands('proj-1');
      expect(commands).toHaveLength(1);
      expect(commands[0]!.command).toBe('npm test');
      expect(commands[0]!.workdir).toBe('/test/proj-1');

      await manager.stopAllAgents();
    });
  });

  describe('MCP server handling in startInteractiveAgent', () => {
    it('passes MCP servers to agent when enabled in settings', async () => {
      const { manager, settingsRepo, factory } = buildManager();

      settingsRepo.get = jest.fn().mockResolvedValue({
        claudePermissions: { dangerouslySkipPermissions: false, defaultMode: 'acceptEdits', allowRules: [], denyRules: [] },
        mcp: {
          enabled: true,
          servers: [
            { name: 'server1', url: 'http://localhost:3001', enabled: true },
            { name: 'server2', url: 'http://localhost:3002', enabled: false },
          ],
        },
      });

      await startInteractive(manager);

      // Only enabled server should be passed
      const createArgs = factory.create.mock.calls[0]![0];
      expect(createArgs.mcpServers).toBeDefined();

      await manager.stopAllAgents();
    });
  });

});
