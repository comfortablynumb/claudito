import {
  DefaultAgentManager,
  AgentManagerDependencies,
  OneOffMeta,
} from '../../../src/agents/agent-manager';
import { Agent, AgentMessage, WaitingStatus, ToolUseInfo } from '../../../src/agents/agent';
import {
  createMockAgentFactory,
  createMockAgent,
  createMockProjectRepository,
  createMockConversationRepository,
  createMockInstructionGenerator,
  createMockRoadmapParser,
  createMockPermissionGenerator,
  createMockSettingsRepository,
  createTestProject,
} from '../helpers/mock-factories';

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

describe('DefaultAgentManager - methods coverage', () => {
  let agentManager: DefaultAgentManager;
  let mockAgent: jest.Mocked<Agent>;
  let mockAgentFactory: ReturnType<typeof createMockAgentFactory>;
  let mockProjectRepo: ReturnType<typeof createMockProjectRepository>;
  let mockConversationRepo: ReturnType<typeof createMockConversationRepository>;
  let mockSettingsRepo: ReturnType<typeof createMockSettingsRepository>;

  const testProject = createTestProject({ id: 'test-project', path: '/test/path' });

  beforeEach(() => {
    mockAgent = createMockAgent('test-project');
    mockAgentFactory = createMockAgentFactory(mockAgent);
    mockProjectRepo = createMockProjectRepository([testProject]);
    mockConversationRepo = createMockConversationRepository();
    mockSettingsRepo = createMockSettingsRepository();

    const deps: AgentManagerDependencies = {
      maxConcurrentAgents: 3,
      agentFactory: mockAgentFactory,
      projectRepository: mockProjectRepo,
      conversationRepository: mockConversationRepo,
      instructionGenerator: createMockInstructionGenerator(),
      roadmapParser: createMockRoadmapParser(),
      permissionGenerator: createMockPermissionGenerator(),
      settingsRepository: mockSettingsRepo,
    };

    agentManager = new DefaultAgentManager(deps);
  });

  afterEach(async () => {
    await agentManager.stopAllAgents();
  });

  async function startAgent(): Promise<void> {
    await agentManager.startInteractiveAgent('test-project', {
      initialMessage: 'hello',
      isNewSession: true,
    });
  }

  describe('sendToolResult', () => {
    it('should throw when no agent is running', () => {
      expect(() => agentManager.sendToolResult('test-project', 'tool-1', 'result'))
        .toThrow('No agent running for this project');
    });

    it('should throw when agent is not interactive mode', async () => {
      await startAgent();
      Object.defineProperty(mockAgent, 'mode', { get: () => 'oneOff' });

      expect(() => agentManager.sendToolResult('test-project', 'tool-1', 'result'))
        .toThrow('Agent is not in interactive mode');
    });

    it('should delegate to agent.sendToolResult', async () => {
      await startAgent();
      Object.defineProperty(mockAgent, 'mode', { get: () => 'interactive' });

      agentManager.sendToolResult('test-project', 'tool-1', 'my result');

      expect(mockAgent.sendToolResult).toHaveBeenCalledWith('tool-1', 'my result');
    });
  });

  describe('hasPendingPlan', () => {
    it('should return false when no pending plan', () => {
      expect(agentManager.hasPendingPlan('test-project')).toBe(false);
    });

    it('should return true when plan is pending', async () => {
      await startAgent();
      // Access internal pendingPlans map
      (agentManager as any).pendingPlans.set('test-project', {
        planContent: 'plan',
        sessionId: null,
      });

      expect(agentManager.hasPendingPlan('test-project')).toBe(true);
    });
  });

  describe('approvePlan', () => {
    it('should return early when no pending plan exists', async () => {
      await agentManager.approvePlan('test-project', 'yes');
      // No error thrown
    });

    it('should handle "yes" response by restarting agent', async () => {
      await startAgent();
      (agentManager as any).pendingPlans.set('test-project', {
        planContent: 'Build feature X',
        sessionId: 'session-1',
      });

      const messages: AgentMessage[] = [];
      agentManager.on('message', (_pid, msg) => messages.push(msg));

      // Mock delay to avoid waiting
      (agentManager as any).delay = jest.fn().mockResolvedValue(undefined);

      await agentManager.approvePlan('test-project', 'yes');

      expect(agentManager.hasPendingPlan('test-project')).toBe(false);
      const hiddenMsg = messages.find(m => m.hidden && m.content.includes('Plan approved'));
      expect(hiddenMsg).toBeDefined();
    });

    it('should handle "no" response by sending rejection', async () => {
      await startAgent();
      (agentManager as any).pendingPlans.set('test-project', {
        planContent: 'plan',
        sessionId: null,
      });

      await agentManager.approvePlan('test-project', 'no');

      expect(agentManager.hasPendingPlan('test-project')).toBe(false);
      expect(mockAgent.sendInput).toHaveBeenCalledWith('no');
    });

    it('should handle change request by sending feedback', async () => {
      await startAgent();
      (agentManager as any).pendingPlans.set('test-project', {
        planContent: 'plan',
        sessionId: null,
      });

      await agentManager.approvePlan('test-project', 'Please add error handling');

      expect(agentManager.hasPendingPlan('test-project')).toBe(false);
      expect(mockAgent.sendInput).toHaveBeenCalledWith('Please add error handling');
    });
  });

  describe('getRecentCommands', () => {
    it('should return empty array when no commands recorded', () => {
      expect(agentManager.getRecentCommands('test-project')).toEqual([]);
    });

    it('should return recorded commands', () => {
      const commands = [
        { command: 'ls', workdir: '/tmp', timestamp: '2026-01-01T00:00:00Z' },
      ];
      (agentManager as any).recentCommands.set('test-project', commands);

      expect(agentManager.getRecentCommands('test-project')).toEqual(commands);
    });
  });

  describe('getOneOffCommandHistory', () => {
    it('should return empty array when no history', () => {
      expect(agentManager.getOneOffCommandHistory('test-project')).toEqual([]);
    });

    it('should return stored history', () => {
      const entries = [{ label: 'test', command: 'npm test', timestamp: '2026-01-01' }];
      (agentManager as any).oneOffCommandHistory.set('test-project', entries);

      expect(agentManager.getOneOffCommandHistory('test-project')).toEqual(entries);
    });
  });

  describe('getCliCommandHistory', () => {
    it('should return empty array when no history', () => {
      expect(agentManager.getCliCommandHistory('test-project')).toEqual([]);
    });

    it('should return stored cli history', () => {
      const entries = [{ label: 'build', command: 'npm run build', timestamp: '2026-01-01' }];
      (agentManager as any).cliCommandHistory.set('test-project', entries);

      expect(agentManager.getCliCommandHistory('test-project')).toEqual(entries);
    });
  });

  describe('getOneOffMeta', () => {
    it('should return null when oneOff does not exist', () => {
      expect(agentManager.getOneOffMeta('nonexistent')).toBeNull();
    });

    it('should return meta when present', () => {
      const meta: OneOffMeta = { projectId: 'test-project', label: 'search' };
      (agentManager as any).oneOffMeta.set('oneoff-1', meta);

      expect(agentManager.getOneOffMeta('oneoff-1')).toEqual(meta);
    });
  });

  describe('getOneOffCollectedOutput', () => {
    it('should return null when no agent found', () => {
      expect(agentManager.getOneOffCollectedOutput('nonexistent')).toBeNull();
    });

    it('should return collected output from agent', () => {
      const oneOffAgent = createMockAgent('test-project');
      Object.defineProperty(oneOffAgent, 'collectedOutput', { get: () => 'output text' });
      (agentManager as any).oneOffAgents.set('oneoff-1', oneOffAgent);

      expect(agentManager.getOneOffCollectedOutput('oneoff-1')).toBe('output text');
    });
  });

  describe('recordBashCommand (via agent message events)', () => {
    it('should record bash commands from tool_use messages', async () => {
      await startAgent();

      // Simulate a Bash tool_use message
      const messageHandler = mockAgent.on.mock.calls.find(
        ([event]) => event === 'message'
      )?.[1] as (msg: AgentMessage) => void;

      expect(messageHandler).toBeDefined();

      messageHandler({
        type: 'tool_use',
        content: '',
        timestamp: new Date().toISOString(),
        toolInfo: {
          name: 'Bash',
          input: { command: 'npm test', cwd: '/workspace' },
        } as ToolUseInfo,
      });

      const commands = agentManager.getRecentCommands('test-project');
      expect(commands).toHaveLength(1);
      expect(commands[0]!.command).toBe('npm test');
      expect(commands[0]!.workdir).toBe('/workspace');
    });

    it('should not record non-Bash tool_use messages', async () => {
      await startAgent();

      const messageHandler = mockAgent.on.mock.calls.find(
        ([event]) => event === 'message'
      )?.[1] as (msg: AgentMessage) => void;

      messageHandler({
        type: 'tool_use',
        content: '',
        timestamp: new Date().toISOString(),
        toolInfo: {
          name: 'Read',
          input: { file: '/test.ts' },
        } as ToolUseInfo,
      });

      expect(agentManager.getRecentCommands('test-project')).toHaveLength(0);
    });

    it('should skip empty commands', async () => {
      await startAgent();

      const messageHandler = mockAgent.on.mock.calls.find(
        ([event]) => event === 'message'
      )?.[1] as (msg: AgentMessage) => void;

      messageHandler({
        type: 'tool_use',
        content: '',
        timestamp: new Date().toISOString(),
        toolInfo: {
          name: 'Bash',
          input: { command: '  ' },
        } as ToolUseInfo,
      });

      expect(agentManager.getRecentCommands('test-project')).toHaveLength(0);
    });

    it('should truncate to 50 items', async () => {
      await startAgent();

      const messageHandler = mockAgent.on.mock.calls.find(
        ([event]) => event === 'message'
      )?.[1] as (msg: AgentMessage) => void;

      // Add 55 commands
      for (let i = 0; i < 55; i++) {
        messageHandler({
          type: 'tool_use',
          content: '',
          timestamp: new Date().toISOString(),
          toolInfo: {
            name: 'Bash',
            input: { command: `cmd-${i}` },
          } as ToolUseInfo,
        });
      }

      const commands = agentManager.getRecentCommands('test-project');
      expect(commands).toHaveLength(50);
      expect(commands[0]!.command).toBe('cmd-5');
      expect(commands[49]!.command).toBe('cmd-54');
    });

    it('should handle missing cwd', async () => {
      await startAgent();

      const messageHandler = mockAgent.on.mock.calls.find(
        ([event]) => event === 'message'
      )?.[1] as (msg: AgentMessage) => void;

      messageHandler({
        type: 'tool_use',
        content: '',
        timestamp: new Date().toISOString(),
        toolInfo: {
          name: 'Bash',
          input: { command: 'ls' },
        } as ToolUseInfo,
      });

      const commands = agentManager.getRecentCommands('test-project');
      expect(commands[0]!.workdir).toBeUndefined();
    });
  });

  describe('handleAgentCompletionResponse (via internal call)', () => {
    it('should do nothing when project not found', async () => {
      const emptyRepo = createMockProjectRepository([]);
      const deps: AgentManagerDependencies = {
        maxConcurrentAgents: 3,
        agentFactory: mockAgentFactory,
        projectRepository: emptyRepo,
        conversationRepository: mockConversationRepo,
        instructionGenerator: createMockInstructionGenerator(),
        roadmapParser: createMockRoadmapParser(),
        permissionGenerator: createMockPermissionGenerator(),
        settingsRepository: mockSettingsRepo,
      };
      const manager = new DefaultAgentManager(deps);

      // Should not throw
      await (manager as any).handleAgentCompletionResponse('nonexistent', {
        status: 'COMPLETE',
        reason: 'done',
      });

      await manager.stopAllAgents();
    });

    it('should do nothing when no loop state', async () => {
      // No loop started, so getLoopState returns null
      await (agentManager as any).handleAgentCompletionResponse('test-project', {
        status: 'COMPLETE',
        reason: 'done',
      });
      // No error
    });
  });

  describe('handleSessionNotFound (via internal call)', () => {
    it('should call sessionManager.handleSessionNotFound', async () => {
      await startAgent();

      const mockSessionManager = (agentManager as any).sessionManager;
      mockSessionManager.handleSessionNotFound = jest.fn().mockResolvedValue({
        conversationId: 'new-conv-id',
      });

      await (agentManager as any).handleSessionNotFound(mockAgent, 'missing-session');

      expect(mockSessionManager.handleSessionNotFound).toHaveBeenCalledWith(
        'test-project',
        'missing-session'
      );
    });
  });

  describe('setupOneOffAgentListeners', () => {
    it('should emit oneOffMessage on message events', () => {
      const oneOffAgent = createMockAgent('test-project');
      const meta: OneOffMeta = { projectId: 'test-project', label: 'task' };
      (agentManager as any).oneOffMeta.set('oneoff-1', meta);
      (agentManager as any).oneOffAgents.set('oneoff-1', oneOffAgent);

      (agentManager as any).setupOneOffAgentListeners('oneoff-1', oneOffAgent);

      const messages: [string, AgentMessage][] = [];
      agentManager.on('oneOffMessage', (id, msg) => messages.push([id, msg]));

      // Fire message event
      const messageHandler = oneOffAgent.on.mock.calls.find(
        ([event]) => event === 'message'
      )?.[1] as (msg: AgentMessage) => void;

      const testMsg: AgentMessage = {
        type: 'stdout',
        content: 'test output',
        timestamp: new Date().toISOString(),
      };
      messageHandler(testMsg);

      expect(messages).toHaveLength(1);
      expect(messages[0]![0]).toBe('oneoff-1');
    });

    it('should record bash commands from oneOff agents', () => {
      const oneOffAgent = createMockAgent('test-project');
      const meta: OneOffMeta = { projectId: 'test-project', label: 'task' };
      (agentManager as any).oneOffMeta.set('oneoff-1', meta);
      (agentManager as any).oneOffAgents.set('oneoff-1', oneOffAgent);

      (agentManager as any).setupOneOffAgentListeners('oneoff-1', oneOffAgent);

      const messageHandler = oneOffAgent.on.mock.calls.find(
        ([event]) => event === 'message'
      )?.[1] as (msg: AgentMessage) => void;

      messageHandler({
        type: 'tool_use',
        content: '',
        timestamp: new Date().toISOString(),
        toolInfo: {
          name: 'Bash',
          input: { command: 'git status' },
        } as ToolUseInfo,
      });

      expect(agentManager.getRecentCommands('test-project')).toHaveLength(1);
    });

    it('should emit oneOffStatus on status events', () => {
      const oneOffAgent = createMockAgent('test-project');
      (agentManager as any).oneOffAgents.set('oneoff-1', oneOffAgent);

      (agentManager as any).setupOneOffAgentListeners('oneoff-1', oneOffAgent);

      const statuses: string[] = [];
      agentManager.on('oneOffStatus', (id, status) => statuses.push(status));

      const statusHandler = oneOffAgent.on.mock.calls.find(
        ([event]) => event === 'status'
      )?.[1] as (status: string) => void;

      statusHandler('running');
      expect(statuses).toEqual(['running']);
    });

    it('should handle waitingForInput events with version tracking', () => {
      const oneOffAgent = createMockAgent('test-project');
      (agentManager as any).oneOffAgents.set('oneoff-1', oneOffAgent);

      (agentManager as any).setupOneOffAgentListeners('oneoff-1', oneOffAgent);

      const waitingHandler = oneOffAgent.on.mock.calls.find(
        ([event]) => event === 'waitingForInput'
      )?.[1] as (status: WaitingStatus) => void;

      waitingHandler({ isWaiting: true, version: 5 });

      expect((agentManager as any).oneOffWaitingVersions.get('oneoff-1')).toBe(5);
    });

    it('should not update version on waitingForInput=false', () => {
      const oneOffAgent = createMockAgent('test-project');
      (agentManager as any).oneOffAgents.set('oneoff-1', oneOffAgent);
      (agentManager as any).oneOffWaitingVersions.set('oneoff-1', 3);

      (agentManager as any).setupOneOffAgentListeners('oneoff-1', oneOffAgent);

      const waitingHandler = oneOffAgent.on.mock.calls.find(
        ([event]) => event === 'waitingForInput'
      )?.[1] as (status: WaitingStatus) => void;

      waitingHandler({ isWaiting: false, version: 6 });

      // Should stay at 3 since isWaiting=false doesn't update
      expect((agentManager as any).oneOffWaitingVersions.get('oneoff-1')).toBe(3);
    });

    it('should clean up on exit', () => {
      const oneOffAgent = createMockAgent('test-project');
      (agentManager as any).oneOffAgents.set('oneoff-1', oneOffAgent);
      (agentManager as any).oneOffMeta.set('oneoff-1', { projectId: 'test-project', label: 'x' });
      (agentManager as any).oneOffWaitingVersions.set('oneoff-1', 1);

      (agentManager as any).setupOneOffAgentListeners('oneoff-1', oneOffAgent);

      const exitHandler = oneOffAgent.on.mock.calls.find(
        ([event]) => event === 'exit'
      )?.[1] as () => void;

      exitHandler();

      expect((agentManager as any).oneOffAgents.has('oneoff-1')).toBe(false);
      expect((agentManager as any).oneOffMeta.has('oneoff-1')).toBe(false);
      expect((agentManager as any).oneOffWaitingVersions.has('oneoff-1')).toBe(false);
    });
  });

  describe('recordCliCommand (via internal call)', () => {
    it('should record cli commands', () => {
      (agentManager as any).recordCliCommand('test-project', 'build', 'npm run build');

      const history = agentManager.getCliCommandHistory('test-project');
      expect(history).toHaveLength(1);
      expect(history[0]!.label).toBe('build');
      expect(history[0]!.command).toBe('npm run build');
    });

    it('should truncate to 50 items', () => {
      for (let i = 0; i < 55; i++) {
        (agentManager as any).recordCliCommand('test-project', `label-${i}`, `cmd-${i}`);
      }

      const history = agentManager.getCliCommandHistory('test-project');
      expect(history).toHaveLength(50);
      expect(history[0]!.label).toBe('label-5');
      expect(history[49]!.label).toBe('label-54');
    });
  });

  describe('shouldUseDocker (via internal call)', () => {
    it('should return false when no containerManager', async () => {
      const result = await (agentManager as any).shouldUseDocker('test-project');
      expect(result).toBe(false);
    });

    it('should return false when docker not enabled in settings', async () => {
      (agentManager as any).containerManager = { stopAllContainers: jest.fn().mockResolvedValue(undefined) };
      mockSettingsRepo.get.mockResolvedValue({ docker: { enabled: false } } as any);

      const result = await (agentManager as any).shouldUseDocker('test-project');
      expect(result).toBe(false);
    });

    it('should return false when project has dockerOverride=false', async () => {
      (agentManager as any).containerManager = { stopAllContainers: jest.fn().mockResolvedValue(undefined) };
      mockSettingsRepo.get.mockResolvedValue({ docker: { enabled: true } } as any);
      const projectWithDockerOff = createTestProject({
        id: 'test-project',
        path: '/test/path',
      });
      (projectWithDockerOff as any).dockerOverride = false;
      mockProjectRepo.findById.mockResolvedValue(projectWithDockerOff);

      const result = await (agentManager as any).shouldUseDocker('test-project');
      expect(result).toBe(false);
    });

    it('should return true when project has dockerOverride=true', async () => {
      (agentManager as any).containerManager = { stopAllContainers: jest.fn().mockResolvedValue(undefined) };
      mockSettingsRepo.get.mockResolvedValue({ docker: { enabled: true } } as any);
      const projectWithDockerOn = createTestProject({
        id: 'test-project',
        path: '/test/path',
      });
      (projectWithDockerOn as any).dockerOverride = true;
      mockProjectRepo.findById.mockResolvedValue(projectWithDockerOn);

      const result = await (agentManager as any).shouldUseDocker('test-project');
      expect(result).toBe(true);
    });

    it('should return true when docker enabled and no project override', async () => {
      (agentManager as any).containerManager = { stopAllContainers: jest.fn().mockResolvedValue(undefined) };
      mockSettingsRepo.get.mockResolvedValue({ docker: { enabled: true } } as any);

      const result = await (agentManager as any).shouldUseDocker('test-project');
      expect(result).toBe(true);
    });
  });
});
