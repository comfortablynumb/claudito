import {
  DefaultWebSocketServer,
  WebSocketServerDependencies,
  WebSocketMessage,
} from '../../../src/websocket/websocket-server';
import { AgentManager, AgentMessage } from '../../../src/agents';
import { RoadmapGenerator, AuthService, ShellService } from '../../../src/services';
import { RalphLoopService } from '../../../src/services/ralph-loop/types';
import { RunProcessManager } from '../../../src/services/run-config/run-process-types';
import { ConversationRepository } from '../../../src/repositories/conversation';
import { ProjectRepository } from '../../../src/repositories/project';
import { Server } from 'http';
import { EventEmitter } from 'events';
import { getLogStore } from '../../../src/utils/logger';

// Mock WebSocket and WebSocketServer
jest.mock('ws', () => {
  const mockWsInstance = {
    readyState: 1, // WebSocket.OPEN
    send: jest.fn(),
    close: jest.fn(),
    on: jest.fn(),
  };

  const mockWss = {
    on: jest.fn(),
    close: jest.fn(),
    clients: new Set([mockWsInstance]),
  };

  return {
    WebSocketServer: jest.fn(() => mockWss),
    WebSocket: {
      OPEN: 1,
      CLOSED: 3,
    },
  };
});

describe('DefaultWebSocketServer', () => {
  let wsServer: DefaultWebSocketServer;
  let mockAgentManager: jest.Mocked<AgentManager>;
  let mockRoadmapGenerator: RoadmapGenerator & EventEmitter;
  let mockAuthService: jest.Mocked<AuthService>;
  let mockShellService: ShellService & EventEmitter;
  let mockRalphLoopService: RalphLoopService & EventEmitter;
  let agentListeners: Map<string, Set<(...args: unknown[]) => void>>;

  const createMockAgentManager = (): jest.Mocked<AgentManager> => {
    agentListeners = new Map();

    return {
      on: jest.fn((event: string, listener: (...args: unknown[]) => void) => {
        if (!agentListeners.has(event)) {
          agentListeners.set(event, new Set());
        }
        agentListeners.get(event)!.add(listener);
      }),
      off: jest.fn((event: string, listener: (...args: unknown[]) => void) => {
        agentListeners.get(event)?.delete(listener);
      }),
      emit: (event: string, ...args: unknown[]) => {
        agentListeners.get(event)?.forEach((listener) => listener(...args));
      },
      getFullStatus: jest.fn().mockReturnValue({
        status: 'stopped',
        mode: null,
        queued: false,
        queuedMessageCount: 0,
        isWaitingForInput: false,
        waitingVersion: 0,
        sessionId: null,
        permissionMode: null,
      }),
      getResourceStatus: jest.fn().mockReturnValue({
        runningCount: 0,
        maxConcurrent: 3,
        queuedCount: 0,
        queuedProjects: [],
      }),
      getContextUsage: jest.fn().mockReturnValue(null),
      startAgent: jest.fn(),
      startInteractiveAgent: jest.fn(),
      sendInput: jest.fn(),
      stopAgent: jest.fn(),
      stopAllAgents: jest.fn(),
      getAgentStatus: jest.fn().mockReturnValue('stopped'),
      getAgentMode: jest.fn().mockReturnValue(null),
      isRunning: jest.fn().mockReturnValue(false),
      isQueued: jest.fn().mockReturnValue(false),
      isWaitingForInput: jest.fn().mockReturnValue(false),
      getWaitingVersion: jest.fn().mockReturnValue(0),
      removeFromQueue: jest.fn(),
      setMaxConcurrentAgents: jest.fn(),
      startAutonomousLoop: jest.fn(),
      stopAutonomousLoop: jest.fn(),
      getLoopState: jest.fn().mockReturnValue(null),
      getLastCommand: jest.fn().mockReturnValue(null),
      getProcessInfo: jest.fn().mockReturnValue(null),
      getQueuedMessageCount: jest.fn().mockReturnValue(0),
      getQueuedMessages: jest.fn().mockReturnValue([]),
      removeQueuedMessage: jest.fn().mockReturnValue(false),
      getSessionId: jest.fn().mockReturnValue(null),
      getTrackedProcesses: jest.fn().mockReturnValue([]),
      cleanupOrphanProcesses: jest.fn().mockResolvedValue({ killed: [], failed: [] }),
      restartAllRunningAgents: jest.fn(),
      getRunningProjectIds: jest.fn().mockReturnValue([]),
      getOneOffMeta: jest.fn().mockReturnValue(null),
    } as unknown as jest.Mocked<AgentManager>;
  };

  const createMockRoadmapGenerator = (): RoadmapGenerator & EventEmitter => {
    const emitter = new EventEmitter();
    return {
      on: emitter.on.bind(emitter),
      off: emitter.off.bind(emitter),
      emit: emitter.emit.bind(emitter),
      listenerCount: emitter.listenerCount.bind(emitter),
      generateRoadmap: jest.fn(),
      modifyRoadmap: jest.fn(),
      respondToQuestion: jest.fn(),
      isGenerating: jest.fn().mockReturnValue(false),
      stop: jest.fn(),
    } as unknown as RoadmapGenerator & EventEmitter;
  };

  const createMockAuthService = (): jest.Mocked<AuthService> => {
    return {
      validateSession: jest.fn().mockReturnValue(true),
      createSession: jest.fn(),
      destroySession: jest.fn(),
      getSessionUser: jest.fn(),
      getSessionExpiry: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;
  };

  const createMockShellService = (): ShellService & EventEmitter => {
    const emitter = new EventEmitter();
    return {
      on: emitter.on.bind(emitter),
      off: emitter.off.bind(emitter),
      emit: emitter.emit.bind(emitter),
      listenerCount: emitter.listenerCount.bind(emitter),
      create: jest.fn(),
      write: jest.fn(),
      resize: jest.fn(),
      kill: jest.fn(),
      list: jest.fn().mockReturnValue([]),
      getSessions: jest.fn().mockReturnValue([]),
    } as unknown as ShellService & EventEmitter;
  };

  const createMockRalphLoopService = (): RalphLoopService & EventEmitter => {
    const emitter = new EventEmitter();
    return {
      on: emitter.on.bind(emitter),
      off: emitter.off.bind(emitter),
      emit: emitter.emit.bind(emitter),
      listenerCount: emitter.listenerCount.bind(emitter),
      start: jest.fn(),
      stop: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      getState: jest.fn(),
      listByProject: jest.fn(),
    } as unknown as RalphLoopService & EventEmitter;
  };

  beforeEach(() => {
    mockAgentManager = createMockAgentManager();
    mockRoadmapGenerator = createMockRoadmapGenerator();
    mockAuthService = createMockAuthService();
    mockShellService = createMockShellService();
    mockRalphLoopService = createMockRalphLoopService();
  });

  afterEach(() => {
    if (wsServer) {
      wsServer.close();
    }
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create websocket server with agent manager', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
      };

      wsServer = new DefaultWebSocketServer(deps);
      expect(wsServer).toBeDefined();
    });

    it('should set up agent listeners', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
      };

      wsServer = new DefaultWebSocketServer(deps);

      expect(mockAgentManager.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockAgentManager.on).toHaveBeenCalledWith('status', expect.any(Function));
      expect(mockAgentManager.on).toHaveBeenCalledWith('waitingForInput', expect.any(Function));
      expect(mockAgentManager.on).toHaveBeenCalledWith('queueChange', expect.any(Function));
      expect(mockAgentManager.on).toHaveBeenCalledWith('sessionRecovery', expect.any(Function));
    });

    it('should set up roadmap listeners when roadmap generator is provided', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
        roadmapGenerator: mockRoadmapGenerator,
      };

      wsServer = new DefaultWebSocketServer(deps);

      // Verify roadmap generator 'message' listener was added
      expect(mockRoadmapGenerator.listenerCount('message')).toBe(1);
    });

    it('should set up shell listeners when shell service is provided', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
        shellService: mockShellService,
      };

      wsServer = new DefaultWebSocketServer(deps);

      // Verify shell service listeners were added
      expect(mockShellService.listenerCount('data')).toBe(1);
      expect(mockShellService.listenerCount('exit')).toBe(1);
      expect(mockShellService.listenerCount('error')).toBe(1);
    });
  });

  describe('broadcast', () => {
    it('should not throw when wss is null', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
      };

      wsServer = new DefaultWebSocketServer(deps);

      expect(() => {
        wsServer.broadcast({
          type: 'connected',
          data: 'test',
        });
      }).not.toThrow();
    });

    it('should broadcast message to all connected clients', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
      };

      wsServer = new DefaultWebSocketServer(deps);

      // Initialize with mock server
      const mockHttpServer = {} as Server;
      wsServer.initialize(mockHttpServer);

      const message: WebSocketMessage = {
        type: 'connected',
        data: 'test message',
      };

      wsServer.broadcast(message);

      // Get the mocked WebSocketServer
      const { WebSocketServer: MockWebSocketServer } = jest.requireMock('ws');
      const mockWssInstance = MockWebSocketServer.mock.results[0].value;

      // Check that send was called on clients
      const mockClient = Array.from(mockWssInstance.clients)[0] as { send: jest.Mock };
      expect(mockClient.send).toHaveBeenCalledWith(JSON.stringify(message));
    });
  });

  describe('broadcastToProject', () => {
    it('should not throw when no subscribers', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
      };

      wsServer = new DefaultWebSocketServer(deps);

      expect(() => {
        wsServer.broadcastToProject('test-project', {
          type: 'agent_message',
          projectId: 'test-project',
          data: { type: 'stdout', content: 'test', timestamp: new Date().toISOString() },
        });
      }).not.toThrow();
    });
  });

  describe('close', () => {
    it('should handle close when wss is null', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
      };

      wsServer = new DefaultWebSocketServer(deps);

      expect(() => {
        wsServer.close();
        wsServer.close(); // Call twice to ensure it handles null
      }).not.toThrow();
    });

    it('should close all client connections and clear subscriptions', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
      };

      wsServer = new DefaultWebSocketServer(deps);

      const mockHttpServer = {} as Server;
      wsServer.initialize(mockHttpServer);

      wsServer.close();

      const { WebSocketServer: MockWebSocketServer } = jest.requireMock('ws');
      const mockWssInstance = MockWebSocketServer.mock.results[0].value;

      expect(mockWssInstance.close).toHaveBeenCalled();
    });
  });

  describe('agent event forwarding', () => {
    beforeEach(() => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
      };

      wsServer = new DefaultWebSocketServer(deps);
    });

    it('should emit message events from agent manager with context usage', () => {
      const message: AgentMessage = {
        type: 'stdout',
        content: 'Hello',
        timestamp: new Date().toISOString(),
      };

      mockAgentManager.getContextUsage.mockReturnValue({
        totalTokens: 1000,
        inputTokens: 800,
        outputTokens: 200,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        maxContextTokens: 10000,
        percentUsed: 10,
      });

      const messageListener = agentListeners.get('message')?.values().next().value as ((...args: unknown[]) => void) | undefined;

      if (messageListener) {
        // Should not throw even without subscribers
        expect(() => {
          messageListener('test-project', message);
        }).not.toThrow();
      } else {
        fail('Message listener should be defined');
      }
    });

    it('should emit status events from agent manager', () => {
      const statusListener = agentListeners.get('status')?.values().next().value as ((...args: unknown[]) => void) | undefined;

      if (statusListener) {
        expect(() => {
          statusListener('test-project', 'running');
        }).not.toThrow();
      } else {
        fail('Status listener should be defined');
      }
    });

    it('should emit waitingForInput events from agent manager', () => {
      const waitingListener = agentListeners.get('waitingForInput')?.values().next().value as ((...args: unknown[]) => void) | undefined;

      if (waitingListener) {
        expect(() => {
          waitingListener('test-project', true, 1);
        }).not.toThrow();
      } else {
        fail('Waiting listener should be defined');
      }
    });

    it('should emit queueChange events from agent manager', () => {
      const queueListener = agentListeners.get('queueChange')?.values().next().value as ((...args: unknown[]) => void) | undefined;

      if (queueListener) {
        expect(() => {
          queueListener([]);
        }).not.toThrow();
      } else {
        fail('Queue listener should be defined');
      }
    });

    it('should emit sessionRecovery events from agent manager', () => {
      const recoveryListener = agentListeners.get('sessionRecovery')?.values().next().value as ((...args: unknown[]) => void) | undefined;

      if (recoveryListener) {
        expect(() => {
          recoveryListener('test-project', 'old-id', 'new-id', 'test reason');
        }).not.toThrow();
      } else {
        fail('Recovery listener should be defined');
      }
    });
  });

  describe('roadmap event forwarding', () => {
    it('should forward roadmap messages to project subscribers', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
        roadmapGenerator: mockRoadmapGenerator,
      };

      wsServer = new DefaultWebSocketServer(deps);

      const message = {
        type: 'stdout' as const,
        content: 'Test roadmap content',
        timestamp: new Date().toISOString(),
      };

      expect(() => {
        mockRoadmapGenerator.emit('message', 'test-project', message);
      }).not.toThrow();
    });
  });

  describe('shell event forwarding', () => {
    beforeEach(() => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
        shellService: mockShellService,
      };

      wsServer = new DefaultWebSocketServer(deps);
    });

    it('should forward shell data events to project subscribers', () => {
      // Shell session ID format: shell-{projectId}-{timestamp}-{counter}
      const sessionId = 'shell-test-project-123456-0';

      expect(() => {
        mockShellService.emit('data', sessionId, 'output data');
      }).not.toThrow();
    });

    it('should forward shell exit events to project subscribers', () => {
      const sessionId = 'shell-test-project-123456-0';

      expect(() => {
        mockShellService.emit('exit', sessionId, 0);
      }).not.toThrow();
    });

    it('should forward shell error events to project subscribers', () => {
      const sessionId = 'shell-test-project-123456-0';

      expect(() => {
        mockShellService.emit('error', sessionId, 'error message');
      }).not.toThrow();
    });

    it('should extract project ID from session ID with multiple dashes', () => {
      // Session ID with project ID containing dashes
      const sessionId = 'shell-project-with-dashes-123456-0';

      expect(() => {
        mockShellService.emit('data', sessionId, 'output data');
      }).not.toThrow();
    });

    it('should handle session ID with insufficient parts', () => {
      // Session ID with fewer than 3 parts
      const sessionId = 'shell-project';

      expect(() => {
        mockShellService.emit('data', sessionId, 'output data');
      }).not.toThrow();
    });
  });

  describe('with optional dependencies', () => {
    it('should handle missing roadmap generator', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
        // No roadmapGenerator
      };

      const server = new DefaultWebSocketServer(deps);
      expect(server).toBeDefined();
      server.close();
    });

    it('should handle missing auth service', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
        // No authService
      };

      const server = new DefaultWebSocketServer(deps);
      expect(server).toBeDefined();
      server.close();
    });

    it('should handle missing shell service', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
        // No shellService
      };

      const server = new DefaultWebSocketServer(deps);
      expect(server).toBeDefined();
      server.close();
    });

    it('should work with all dependencies provided', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
        roadmapGenerator: mockRoadmapGenerator,
        authService: mockAuthService,
        shellService: mockShellService,
      };

      const server = new DefaultWebSocketServer(deps);
      expect(server).toBeDefined();
      server.close();
    });
  });

  describe('initialize', () => {
    it('should create WebSocket server with http server', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
      };

      wsServer = new DefaultWebSocketServer(deps);

      const mockHttpServer = {} as Server;
      wsServer.initialize(mockHttpServer);

      const { WebSocketServer: MockWebSocketServer } = jest.requireMock('ws');
      expect(MockWebSocketServer).toHaveBeenCalledWith({
        server: mockHttpServer,
        verifyClient: expect.any(Function),
      });
    });
  });

  describe('context usage in messages', () => {
    it('should include context usage when available', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
      };

      wsServer = new DefaultWebSocketServer(deps);

      const mockContextUsage = {
        totalTokens: 5000,
        inputTokens: 4000,
        outputTokens: 1000,
        cacheCreationInputTokens: 100,
        cacheReadInputTokens: 50,
        maxContextTokens: 10000,
        percentUsed: 50,
      };

      mockAgentManager.getContextUsage.mockReturnValue(mockContextUsage);

      const messageListener = agentListeners.get('message')?.values().next().value as ((...args: unknown[]) => void) | undefined;

      const message: AgentMessage = {
        type: 'stdout',
        content: 'test output',
        timestamp: new Date().toISOString(),
      };

      if (messageListener) {
        // Should not throw
        expect(() => messageListener('test-project', message)).not.toThrow();

        // Verify getContextUsage was called
        expect(mockAgentManager.getContextUsage).toHaveBeenCalledWith('test-project');
      } else {
        fail('Message listener should be defined');
      }
    });

    it('should handle undefined context usage', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
      };

      wsServer = new DefaultWebSocketServer(deps);

      mockAgentManager.getContextUsage.mockReturnValue(null);

      const messageListener = agentListeners.get('message')?.values().next().value as ((...args: unknown[]) => void) | undefined;

      const message: AgentMessage = {
        type: 'stdout',
        content: 'test',
        timestamp: new Date().toISOString(),
      };

      if (messageListener) {
        expect(() => messageListener('test-project', message)).not.toThrow();
      } else {
        fail('Message listener should be defined');
      }
    });
  });

  describe('full status broadcast', () => {
    it('should broadcast full agent status on status change', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
      };

      wsServer = new DefaultWebSocketServer(deps);

      const mockFullStatus = {
        status: 'running' as const,
        mode: 'interactive' as const,
        queued: false,
        queuedMessageCount: 2,
        isWaitingForInput: false,
        waitingVersion: 1,
        sessionId: 'session-123',
        permissionMode: 'acceptEdits' as const,
        hasActiveOneOffAgents: false,
      };

      mockAgentManager.getFullStatus.mockReturnValue(mockFullStatus);

      const statusListener = agentListeners.get('status')?.values().next().value as ((...args: unknown[]) => void) | undefined;

      if (statusListener) {
        expect(() => statusListener('test-project', 'running')).not.toThrow();
        expect(mockAgentManager.getFullStatus).toHaveBeenCalledWith('test-project');
      } else {
        fail('Status listener should be defined');
      }
    });
  });

  describe('resource status broadcast', () => {
    it('should broadcast resource status on queue change', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
      };

      wsServer = new DefaultWebSocketServer(deps);

      const mockResourceStatus = {
        runningCount: 2,
        maxConcurrent: 3,
        queuedCount: 1,
        queuedProjects: [{
          projectId: 'queued-project',
          instructions: 'Test instructions',
          queuedAt: new Date().toISOString(),
        }],
      };

      mockAgentManager.getResourceStatus.mockReturnValue(mockResourceStatus);

      const queueListener = agentListeners.get('queueChange')?.values().next().value as ((...args: unknown[]) => void) | undefined;

      if (queueListener) {
        expect(() => queueListener([{ projectId: 'test' }])).not.toThrow();
        expect(mockAgentManager.getResourceStatus).toHaveBeenCalled();
      } else {
        fail('Queue listener should be defined');
      }
    });
  });

  const createMockRunProcessManager = (): RunProcessManager & EventEmitter => {
    const emitter = new EventEmitter();
    return {
      on: emitter.on.bind(emitter),
      off: emitter.off.bind(emitter),
      emit: emitter.emit.bind(emitter),
      listenerCount: emitter.listenerCount.bind(emitter),
      start: jest.fn(),
      stop: jest.fn(),
      stopAll: jest.fn(),
      getStatus: jest.fn(),
      getAllStatuses: jest.fn().mockReturnValue([]),
      shutdown: jest.fn().mockResolvedValue(undefined),
    } as unknown as RunProcessManager & EventEmitter;
  };

  const createMockConversationRepository = (): jest.Mocked<ConversationRepository> => {
    return {
      findById: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      addMessage: jest.fn().mockResolvedValue(undefined),
      rename: jest.fn(),
      delete: jest.fn(),
      getMetadata: jest.fn(),
    } as unknown as jest.Mocked<ConversationRepository>;
  };

  const createMockProjectRepository = (): jest.Mocked<ProjectRepository> => {
    return {
      findById: jest.fn().mockResolvedValue(null),
      findAll: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<ProjectRepository>;
  };

  describe('Ralph Loop listeners', () => {
    it('should set up Ralph Loop listeners when service is provided', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
        ralphLoopService: mockRalphLoopService,
      };

      wsServer = new DefaultWebSocketServer(deps);

      // Verify Ralph Loop service listeners were added
      expect(mockRalphLoopService.listenerCount('status_change')).toBe(1);
      expect(mockRalphLoopService.listenerCount('iteration_start')).toBe(1);
      expect(mockRalphLoopService.listenerCount('worker_complete')).toBe(1);
      expect(mockRalphLoopService.listenerCount('reviewer_complete')).toBe(1);
      expect(mockRalphLoopService.listenerCount('loop_complete')).toBe(1);
      expect(mockRalphLoopService.listenerCount('loop_error')).toBe(1);
    });

    it('should not throw when Ralph Loop service is not provided', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
      };

      expect(() => {
        wsServer = new DefaultWebSocketServer(deps);
      }).not.toThrow();
    });

    it('should handle status_change event', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
        ralphLoopService: mockRalphLoopService,
      };

      wsServer = new DefaultWebSocketServer(deps);

      expect(() => {
        mockRalphLoopService.emit('status_change', 'project-1', 'task-123', 'worker_running');
      }).not.toThrow();
    });

    it('should handle iteration_start event', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
        ralphLoopService: mockRalphLoopService,
      };

      wsServer = new DefaultWebSocketServer(deps);

      expect(() => {
        mockRalphLoopService.emit('iteration_start', 'project-1', 'task-123', 1);
      }).not.toThrow();
    });

    it('should handle worker_complete event', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
        ralphLoopService: mockRalphLoopService,
      };

      wsServer = new DefaultWebSocketServer(deps);

      const summary = {
        iterationNumber: 1,
        timestamp: new Date().toISOString(),
        workerOutput: 'Implemented feature',
        filesModified: ['src/feature.ts'],
        tokensUsed: 1000,
        durationMs: 5000,
      };

      expect(() => {
        mockRalphLoopService.emit('worker_complete', 'project-1', 'task-123', summary);
      }).not.toThrow();
    });

    it('should handle reviewer_complete event', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
        ralphLoopService: mockRalphLoopService,
      };

      wsServer = new DefaultWebSocketServer(deps);

      const feedback = {
        iterationNumber: 1,
        timestamp: new Date().toISOString(),
        decision: 'needs_changes' as const,
        feedback: 'Good progress',
        specificIssues: ['Missing tests'],
        suggestedImprovements: ['Add unit tests'],
      };

      expect(() => {
        mockRalphLoopService.emit('reviewer_complete', 'project-1', 'task-123', feedback);
      }).not.toThrow();
    });

    it('should handle loop_complete event', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
        ralphLoopService: mockRalphLoopService,
      };

      wsServer = new DefaultWebSocketServer(deps);

      expect(() => {
        mockRalphLoopService.emit('loop_complete', 'project-1', 'task-123', 'approved');
      }).not.toThrow();
    });

    it('should handle loop_error event', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
        ralphLoopService: mockRalphLoopService,
      };

      wsServer = new DefaultWebSocketServer(deps);

      expect(() => {
        mockRalphLoopService.emit('loop_error', 'project-1', 'task-123', 'Worker process failed');
      }).not.toThrow();
    });

    it('should work with all dependencies including Ralph Loop', () => {
      const deps: WebSocketServerDependencies = {
        agentManager: mockAgentManager,
        roadmapGenerator: mockRoadmapGenerator,
        authService: mockAuthService,
        shellService: mockShellService,
        ralphLoopService: mockRalphLoopService,
      };

      const server = new DefaultWebSocketServer(deps);
      expect(server).toBeDefined();
      server.close();
    });
  });

  describe('client registry', () => {
    let mockWs: any;
    let mockHttpServer: Server;

    beforeEach(() => {
      mockWs = {
        readyState: 1,
        send: jest.fn(),
        on: jest.fn(),
        close: jest.fn(),
      };
      mockHttpServer = new EventEmitter() as Server;
      wsServer.initialize(mockHttpServer);
    });

    afterEach(() => {
      // Close the WebSocket server to clear all state
      wsServer.close();
    });

    describe('client registration', () => {
      it('should register client on register message', () => {
        const clientId = 'test-client-123';
        const userAgent = 'Mozilla/5.0 Test';
        const handleMessage = jest.fn();

        // Simulate WebSocket connection
        const ws = require('ws');
        const mockWss = ws.WebSocketServer.mock.results[0].value;
        const connectionHandler = mockWss.on.mock.calls.find(([event]: [string]) => event === 'connection')[1];

        // Mock the message handler
        mockWs.on.mockImplementation((event: string, handler: (...args: any[]) => any) => {
          if (event === 'message') {
            handleMessage.mockImplementation(handler);
          }
        });

        connectionHandler(mockWs);

        // Send register message
        const registerMessage = JSON.stringify({
          type: 'register',
          clientId,
          userAgent,
        });

        handleMessage(registerMessage);

        // Verify client is registered
        const clients = wsServer.getConnectedClients();
        expect(clients).toHaveLength(1);
        expect(clients[0]).toMatchObject({
          clientId,
          userAgent,
          connectedAt: expect.any(String),
        });
      });

      it('should store client metadata', () => {
        const clientId = 'test-client-456';
        const userAgent = 'Chrome/120.0';

        const ws = require('ws');
        const mockWss = ws.WebSocketServer.mock.results[0].value;
        const connectionHandler = mockWss.on.mock.calls.find(([event]: [string]) => event === 'connection')[1];

        const handleMessage = jest.fn();
        mockWs.on.mockImplementation((event: string, handler: (...args: any[]) => any) => {
          if (event === 'message') {
            handleMessage.mockImplementation(handler);
          }
        });

        connectionHandler(mockWs);

        const registerMessage = JSON.stringify({
          type: 'register',
          clientId,
          userAgent,
        });

        handleMessage(registerMessage);

        const clients = wsServer.getAllConnectedClients();
        expect(clients.size).toBe(1);
        expect(clients.get(clientId)).toMatchObject({
          clientId,
          userAgent,
          connectedAt: expect.any(String),
        });
      });

      it('should maintain bidirectional mapping', () => {
        const clientId = 'test-client-789';

        const ws = require('ws');
        const mockWss = ws.WebSocketServer.mock.results[0].value;
        const connectionHandler = mockWss.on.mock.calls.find(([event]: [string]) => event === 'connection')[1];

        const handleMessage = jest.fn();
        const handleClose = jest.fn();

        mockWs.on.mockImplementation((event: string, handler: (...args: any[]) => any) => {
          if (event === 'message') {
            handleMessage.mockImplementation(handler);
          } else if (event === 'close') {
            handleClose.mockImplementation(handler);
          }
        });

        connectionHandler(mockWs);

        const registerMessage = JSON.stringify({
          type: 'register',
          clientId,
        });

        handleMessage(registerMessage);

        // Verify client exists
        expect(wsServer.getConnectedClients()).toHaveLength(1);

        // Simulate disconnect
        handleClose();

        // Verify client is removed
        expect(wsServer.getConnectedClients()).toHaveLength(0);
      });
    });

    describe('getConnectedClients', () => {
      beforeEach(() => {
        // Register multiple clients
        const ws = require('ws');
        const mockWss = ws.WebSocketServer.mock.results[0].value;
        const connectionHandler = mockWss.on.mock.calls.find(([event]: [string]) => event === 'connection')[1];

        // Client 1
        const mockWs1 = { ...mockWs, on: jest.fn() };
        const handleMessage1 = jest.fn();
        mockWs1.on.mockImplementation((event: string, handler: (...args: any[]) => any) => {
          if (event === 'message') {
            handleMessage1.mockImplementation(handler);
          }
        });
        connectionHandler(mockWs1);
        handleMessage1(JSON.stringify({ type: 'register', clientId: 'client-1' }));
        handleMessage1(JSON.stringify({ type: 'subscribe', projectId: 'project-a' }));

        // Client 2
        const mockWs2 = { ...mockWs, on: jest.fn() };
        const handleMessage2 = jest.fn();
        mockWs2.on.mockImplementation((event: string, handler: (...args: any[]) => any) => {
          if (event === 'message') {
            handleMessage2.mockImplementation(handler);
          }
        });
        connectionHandler(mockWs2);
        handleMessage2(JSON.stringify({ type: 'register', clientId: 'client-2' }));
        handleMessage2(JSON.stringify({ type: 'subscribe', projectId: 'project-b' }));

        // Client 3
        const mockWs3 = { ...mockWs, on: jest.fn() };
        const handleMessage3 = jest.fn();
        mockWs3.on.mockImplementation((event: string, handler: (...args: any[]) => any) => {
          if (event === 'message') {
            handleMessage3.mockImplementation(handler);
          }
        });
        connectionHandler(mockWs3);
        handleMessage3(JSON.stringify({ type: 'register', clientId: 'client-3' }));
        handleMessage3(JSON.stringify({ type: 'subscribe', projectId: 'project-a' }));
      });

      it('should return all clients when no projectId provided', () => {
        const clients = wsServer.getConnectedClients();
        expect(clients).toHaveLength(3);
        expect(clients.map(c => c.clientId)).toEqual(
          expect.arrayContaining(['client-1', 'client-2', 'client-3'])
        );
      });

      it('should filter by projectId when provided', () => {
        const clientsA = wsServer.getConnectedClients('project-a');
        expect(clientsA).toHaveLength(2);
        expect(clientsA.map(c => c.clientId)).toEqual(
          expect.arrayContaining(['client-1', 'client-3'])
        );

        const clientsB = wsServer.getConnectedClients('project-b');
        expect(clientsB).toHaveLength(1);
        expect(clientsB[0]?.clientId).toBe('client-2');
      });

      it('should return empty array when no clients', () => {
        // Create new server instance with no clients
        const newServer = new DefaultWebSocketServer({ agentManager: mockAgentManager });
        expect(newServer.getConnectedClients()).toEqual([]);
        expect(newServer.getConnectedClients('project-x')).toEqual([]);
      });

      it('should update projectId when client subscribes', () => {
        // Verify initial state
        let clients = wsServer.getConnectedClients('project-c');
        expect(clients).toHaveLength(0);

        // Subscribe client-1 to project-c
        const ws = require('ws');
        const mockWss = ws.WebSocketServer.mock.results[0].value;
        const connectionHandler = mockWss.on.mock.calls.find(([event]: [string]) => event === 'connection')[1];

        const mockWs4 = { ...mockWs, on: jest.fn() };
        const handleMessage4 = jest.fn();
        mockWs4.on.mockImplementation((event: string, handler: (...args: any[]) => any) => {
          if (event === 'message') {
            handleMessage4.mockImplementation(handler);
          }
        });
        connectionHandler(mockWs4);
        handleMessage4(JSON.stringify({ type: 'register', clientId: 'client-4' }));
        handleMessage4(JSON.stringify({ type: 'subscribe', projectId: 'project-c' }));

        // Verify client is now associated with project-c
        clients = wsServer.getConnectedClients('project-c');
        expect(clients).toHaveLength(1);
        expect(clients[0]?.clientId).toBe('client-4');
      });
    });

    describe('getAllConnectedClients', () => {
      it('should return Map copy of all clients', () => {
        const ws = require('ws');
        const mockWss = ws.WebSocketServer.mock.results[0].value;
        const connectionHandler = mockWss.on.mock.calls.find(([event]: [string]) => event === 'connection')[1];

        const handleMessage = jest.fn();
        mockWs.on.mockImplementation((event: string, handler: (...args: any[]) => any) => {
          if (event === 'message') {
            handleMessage.mockImplementation(handler);
          }
        });

        connectionHandler(mockWs);

        handleMessage(JSON.stringify({
          type: 'register',
          clientId: 'map-test-client',
        }));

        const clientsMap = wsServer.getAllConnectedClients();
        expect(clientsMap).toBeInstanceOf(Map);
        expect(clientsMap.size).toBeGreaterThan(0);
        expect(clientsMap.has('map-test-client')).toBe(true);
      });

      it('should not allow external modifications', () => {
        const clientsMap = wsServer.getAllConnectedClients();
        const originalSize = clientsMap.size;

        // Try to modify the returned map
        clientsMap.set('fake-client', {
          clientId: 'fake-client',
          connectedAt: new Date().toISOString(),
        });

        // Verify original map is unchanged
        const newMap = wsServer.getAllConnectedClients();
        expect(newMap.size).toBe(originalSize);
        expect(newMap.has('fake-client')).toBe(false);
      });
    });

    describe('client cleanup', () => {
      it('should remove client on disconnect', () => {
        const ws = require('ws');
        const mockWss = ws.WebSocketServer.mock.results[0].value;
        const connectionHandler = mockWss.on.mock.calls.find(([event]: [string]) => event === 'connection')[1];

        const handleMessage = jest.fn();
        const handleClose = jest.fn();

        mockWs.on.mockImplementation((event: string, handler: (...args: any[]) => any) => {
          if (event === 'message') {
            handleMessage.mockImplementation(handler);
          } else if (event === 'close') {
            handleClose.mockImplementation(handler);
          }
        });

        connectionHandler(mockWs);

        handleMessage(JSON.stringify({
          type: 'register',
          clientId: 'disconnect-test',
        }));

        // Verify client exists
        expect(wsServer.getConnectedClients()).toHaveLength(1);

        // Simulate disconnect
        handleClose();

        // Verify client is removed
        expect(wsServer.getConnectedClients()).toHaveLength(0);
        expect(wsServer.getAllConnectedClients().has('disconnect-test')).toBe(false);
      });

      it('should not affect other clients', () => {
        const ws = require('ws');
        const mockWss = ws.WebSocketServer.mock.results[0].value;
        const connectionHandler = mockWss.on.mock.calls.find(([event]: [string]) => event === 'connection')[1];

        // Register two clients
        const mockWs1 = { ...mockWs, on: jest.fn() };
        const handleMessage1 = jest.fn();
        const handleClose1 = jest.fn();
        mockWs1.on.mockImplementation((event: string, handler: (...args: any[]) => any) => {
          if (event === 'message') {
            handleMessage1.mockImplementation(handler);
          } else if (event === 'close') {
            handleClose1.mockImplementation(handler);
          }
        });
        connectionHandler(mockWs1);
        handleMessage1(JSON.stringify({ type: 'register', clientId: 'client-stay' }));

        const mockWs2 = { ...mockWs, on: jest.fn() };
        const handleMessage2 = jest.fn();
        const handleClose2 = jest.fn();
        mockWs2.on.mockImplementation((event: string, handler: (...args: any[]) => any) => {
          if (event === 'message') {
            handleMessage2.mockImplementation(handler);
          } else if (event === 'close') {
            handleClose2.mockImplementation(handler);
          }
        });
        connectionHandler(mockWs2);
        handleMessage2(JSON.stringify({ type: 'register', clientId: 'client-leave' }));

        expect(wsServer.getConnectedClients()).toHaveLength(2);

        // Disconnect only one client
        handleClose2();

        // Verify only one client remains
        const remaining = wsServer.getConnectedClients();
        expect(remaining).toHaveLength(1);
        expect(remaining[0]?.clientId).toBe('client-stay');
      });
    });

    describe('resource event handling', () => {
      let handleMessage: jest.Mock;
      let wsModule: any;
      let mockWss: any;

      beforeEach(() => {
        wsModule = require('ws');
        mockWss = wsModule.WebSocketServer.mock.results[0].value;
        const connectionHandler = mockWss.on.mock.calls.find(([event]: [string]) => event === 'connection')[1];

        handleMessage = jest.fn();
        mockWs.on.mockImplementation((event: string, handler: (...args: any[]) => any) => {
          if (event === 'message') {
            handleMessage.mockImplementation(handler);
          }
        });

        // Add mockWs to the wss clients set
        mockWss.clients.clear(); // Clear default mock instance
        mockWss.clients.add(mockWs);

        connectionHandler(mockWs);

        // Register a client
        handleMessage(JSON.stringify({
          type: 'register',
          clientId: 'resource-test-client',
          userAgent: 'Test Browser',
        }));

        // Subscribe to a project
        handleMessage(JSON.stringify({
          type: 'subscribe',
          projectId: 'test-project',
        }));
      });

      it('should store stats for registered client', () => {
        const resourceStats = {
          total: 10,
          loaded: 8,
          failed: 2,
          pending: 0,
          runtime: 5000,
          resources: [],
          clientInfo: {
            clientId: 'resource-test-client',
            userAgent: 'Test Browser',
            platform: 'Test',
            language: 'en',
            screenResolution: '1920x1080',
            viewport: '1920x1080',
            cookiesEnabled: true,
            online: true,
          },
        };

        handleMessage(JSON.stringify({
          type: 'resource_event',
          data: {
            clientId: 'resource-test-client',
            stats: resourceStats,
            timestamp: new Date().toISOString(),
          },
        }));

        const clients = wsServer.getConnectedClients('test-project');
        expect(clients[0]?.resourceStats).toEqual(resourceStats);
        expect(clients[0]?.lastResourceUpdate).toBeDefined();
      });

      it('should update lastResourceUpdate timestamp', () => {
        const beforeUpdate = new Date().toISOString();

        handleMessage(JSON.stringify({
          type: 'resource_event',
          data: {
            clientId: 'resource-test-client',
            stats: { total: 5, loaded: 5, failed: 0, pending: 0 },
            timestamp: new Date().toISOString(),
          },
        }));

        const clients = wsServer.getConnectedClients('test-project');
        const lastUpdate = clients[0]?.lastResourceUpdate;
        expect(lastUpdate).toBeDefined();
        expect(new Date(lastUpdate!).getTime())
          .toBeGreaterThanOrEqual(new Date(beforeUpdate).getTime());
      });

      it('should ignore stats for unknown client', () => {
        handleMessage(JSON.stringify({
          type: 'resource_event',
          data: {
            clientId: 'unknown-client',
            stats: { total: 5, loaded: 5, failed: 0, pending: 0 },
            timestamp: new Date().toISOString(),
          },
        }));

        const clients = wsServer.getAllConnectedClients();
        expect(clients.has('unknown-client')).toBe(false);
      });

      it('should broadcast event to all clients', () => {
        // Clear previous calls
        mockWs.send.mockClear();

        const eventData = {
          clientId: 'resource-test-client',
          stats: { total: 5, loaded: 5, failed: 0, pending: 0 },
          timestamp: new Date().toISOString(),
        };

        handleMessage(JSON.stringify({
          type: 'resource_event',
          data: eventData,
        }));

        // Verify broadcast was sent
        expect(mockWs.send).toHaveBeenCalledWith(
          expect.stringContaining('"type":"resource_event"')
        );
      });

      it('should handle both stats and individual events', () => {
        // Clear previous calls
        mockWs.send.mockClear();

        // Stats event
        handleMessage(JSON.stringify({
          type: 'resource_event',
          data: {
            clientId: 'resource-test-client',
            stats: { total: 5, loaded: 5, failed: 0, pending: 0 },
            timestamp: new Date().toISOString(),
          },
        }));

        // Individual resource event
        handleMessage(JSON.stringify({
          type: 'resource_event',
          data: {
            type: 'script',
            url: 'test.js',
            status: 'loaded',
            duration: 100,
            timestamp: new Date().toISOString(),
            clientId: 'resource-test-client',
            userAgent: 'Test Browser',
            hostname: 'localhost',
          },
        }));

        expect(mockWs.send).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('verifyClient', () => {
    it('should allow connection when no auth service is configured', () => {
      wsServer = new DefaultWebSocketServer({ agentManager: mockAgentManager });
      wsServer.initialize({} as Server);

      const { WebSocketServer: MockWebSocketServer } = jest.requireMock('ws');
      const verifyClientFn = MockWebSocketServer.mock.calls[0][0].verifyClient;

      const callback = jest.fn();
      verifyClientFn({ req: { headers: {} } }, callback);

      expect(callback).toHaveBeenCalledWith(true);
    });

    it('should reject connection when session cookie is missing', () => {
      wsServer = new DefaultWebSocketServer({
        agentManager: mockAgentManager,
        authService: mockAuthService,
      });
      wsServer.initialize({} as Server);

      const { WebSocketServer: MockWebSocketServer } = jest.requireMock('ws');
      const verifyClientFn = MockWebSocketServer.mock.calls[0][0].verifyClient;

      const callback = jest.fn();
      verifyClientFn({ req: { headers: {} } }, callback);

      expect(callback).toHaveBeenCalledWith(false, 401, 'Unauthorized');
    });

    it('should reject connection when session is invalid', () => {
      mockAuthService.validateSession.mockReturnValue(false);
      wsServer = new DefaultWebSocketServer({
        agentManager: mockAgentManager,
        authService: mockAuthService,
      });
      wsServer.initialize({} as Server);

      const { WebSocketServer: MockWebSocketServer } = jest.requireMock('ws');
      const verifyClientFn = MockWebSocketServer.mock.calls[0][0].verifyClient;

      const callback = jest.fn();
      verifyClientFn(
        { req: { headers: { cookie: 'claudito_session=bad-session-id' } } },
        callback
      );

      expect(callback).toHaveBeenCalledWith(false, 401, 'Unauthorized');
    });

    it('should allow connection when session is valid', () => {
      mockAuthService.validateSession.mockReturnValue(true);
      wsServer = new DefaultWebSocketServer({
        agentManager: mockAgentManager,
        authService: mockAuthService,
      });
      wsServer.initialize({} as Server);

      const { WebSocketServer: MockWebSocketServer } = jest.requireMock('ws');
      const verifyClientFn = MockWebSocketServer.mock.calls[0][0].verifyClient;

      const callback = jest.fn();
      verifyClientFn(
        { req: { headers: { cookie: 'claudito_session=valid-session-id' } } },
        callback
      );

      expect(callback).toHaveBeenCalledWith(true);
    });
  });

  describe('broadcastToProject with OPEN subscribers', () => {
    it('should send message to OPEN subscribers', () => {
      wsServer = new DefaultWebSocketServer({ agentManager: mockAgentManager });
      const mockHttpServer = new EventEmitter() as Server;
      wsServer.initialize(mockHttpServer);

      const { WebSocketServer: MockWebSocketServer } = jest.requireMock('ws');
      const mockWssInstance = MockWebSocketServer.mock.results[0].value;
      const connectionHandler = mockWssInstance.on.mock.calls.find(
        ([event]: [string]) => event === 'connection'
      )[1];

      const openWs = {
        readyState: 1,
        send: jest.fn(),
        on: jest.fn(),
        close: jest.fn(),
      };

      const handleMessage = jest.fn();
      openWs.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'message') {
          handleMessage.mockImplementation(handler);
        }
      });

      connectionHandler(openWs);
      handleMessage(JSON.stringify({ type: 'subscribe', projectId: 'test-project' }));

      wsServer.broadcastToProject('test-project', {
        type: 'agent_message',
        projectId: 'test-project',
        data: { type: 'stdout', content: 'test', timestamp: new Date().toISOString() },
      });

      expect(openWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"agent_message"')
      );
    });
  });

  describe('unsubscribeFromProject', () => {
    it('should remove ws from existing subscribers', () => {
      wsServer = new DefaultWebSocketServer({ agentManager: mockAgentManager });
      const mockHttpServer = new EventEmitter() as Server;
      wsServer.initialize(mockHttpServer);

      const { WebSocketServer: MockWebSocketServer } = jest.requireMock('ws');
      const mockWssInstance = MockWebSocketServer.mock.results[0].value;
      const connectionHandler = mockWssInstance.on.mock.calls.find(
        ([event]: [string]) => event === 'connection'
      )[1];

      const openWs = {
        readyState: 1,
        send: jest.fn(),
        on: jest.fn(),
        close: jest.fn(),
      };

      const handleMessage = jest.fn();
      openWs.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'message') {
          handleMessage.mockImplementation(handler);
        }
      });

      connectionHandler(openWs);
      handleMessage(JSON.stringify({ type: 'subscribe', projectId: 'test-project' }));
      handleMessage(JSON.stringify({ type: 'unsubscribe', projectId: 'test-project' }));

      openWs.send.mockClear();
      wsServer.broadcastToProject('test-project', { type: 'connected', data: 'x' });

      // After unsubscribe, the message to test-project should not call send again
      // (the ws may have been removed from subscribers)
      expect(openWs.send).not.toHaveBeenCalledWith(
        expect.stringContaining('"type":"connected"')
      );
    });
  });

  describe('handleDisconnect with subscriptions', () => {
    it('should remove ws from project subscriptions on disconnect', () => {
      wsServer = new DefaultWebSocketServer({ agentManager: mockAgentManager });
      const mockHttpServer = new EventEmitter() as Server;
      wsServer.initialize(mockHttpServer);

      const { WebSocketServer: MockWebSocketServer } = jest.requireMock('ws');
      const mockWssInstance = MockWebSocketServer.mock.results[0].value;
      const connectionHandler = mockWssInstance.on.mock.calls.find(
        ([event]: [string]) => event === 'connection'
      )[1];

      const openWs = {
        readyState: 1,
        send: jest.fn(),
        on: jest.fn(),
        close: jest.fn(),
      };

      const handleMessage = jest.fn();
      const handleClose = jest.fn();
      openWs.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'message') {
          handleMessage.mockImplementation(handler);
        } else if (event === 'close') {
          handleClose.mockImplementation(handler);
        }
      });

      connectionHandler(openWs);
      handleMessage(JSON.stringify({ type: 'register', clientId: 'sub-client' }));
      handleMessage(JSON.stringify({ type: 'subscribe', projectId: 'sub-project' }));

      // Verify subscription exists
      openWs.send.mockClear();
      wsServer.broadcastToProject('sub-project', { type: 'connected', data: 'x' });
      expect(openWs.send).toHaveBeenCalled();

      // Disconnect
      openWs.send.mockClear();
      handleClose();

      // Now broadcast should not reach the disconnected client
      wsServer.broadcastToProject('sub-project', { type: 'connected', data: 'x' });
      expect(openWs.send).not.toHaveBeenCalled();
    });
  });

  describe('broadcastToProject with non-OPEN clients', () => {
    it('should skip clients that are not in OPEN state', () => {
      wsServer = new DefaultWebSocketServer({ agentManager: mockAgentManager });

      const mockHttpServer = new EventEmitter() as Server;
      wsServer.initialize(mockHttpServer);

      const { WebSocketServer: MockWebSocketServer } = jest.requireMock('ws');
      const mockWssInstance = MockWebSocketServer.mock.results[0].value;
      const connectionHandler = mockWssInstance.on.mock.calls.find(
        ([event]: [string]) => event === 'connection'
      )[1];

      const closedWs = {
        readyState: 3, // CLOSED
        send: jest.fn(),
        on: jest.fn(),
        close: jest.fn(),
      };

      const handleMessage = jest.fn();
      closedWs.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'message') {
          handleMessage.mockImplementation(handler);
        }
      });

      connectionHandler(closedWs);
      handleMessage(JSON.stringify({ type: 'subscribe', projectId: 'test-project' }));

      wsServer.broadcastToProject('test-project', {
        type: 'agent_message',
        projectId: 'test-project',
        data: { type: 'stdout', content: 'test', timestamp: new Date().toISOString() },
      });

      expect(closedWs.send).not.toHaveBeenCalledWith(
        expect.stringContaining('"type":"agent_message"')
      );
    });
  });

  describe('processClientMessage edge cases', () => {
    let mockWsInstance: any;
    let handleMessage: jest.Mock;

    beforeEach(() => {
      wsServer = new DefaultWebSocketServer({ agentManager: mockAgentManager });
      const mockHttpServer = new EventEmitter() as Server;
      wsServer.initialize(mockHttpServer);

      const { WebSocketServer: MockWebSocketServer } = jest.requireMock('ws');
      const mockWssInstance = MockWebSocketServer.mock.results[0].value;
      const connectionHandler = mockWssInstance.on.mock.calls.find(
        ([event]: [string]) => event === 'connection'
      )[1];

      mockWsInstance = {
        readyState: 1,
        send: jest.fn(),
        on: jest.fn(),
        close: jest.fn(),
      };

      handleMessage = jest.fn();
      mockWsInstance.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'message') {
          handleMessage.mockImplementation(handler);
        }
      });

      connectionHandler(mockWsInstance);
    });

    it('should ignore register message with no clientId', () => {
      handleMessage(JSON.stringify({ type: 'register' }));
      expect(wsServer.getConnectedClients()).toHaveLength(0);
    });

    it('should ignore subscribe message with no projectId', () => {
      handleMessage(JSON.stringify({ type: 'subscribe' }));
      expect(() => wsServer.broadcastToProject('any-project', { type: 'connected', data: 'x' })).not.toThrow();
    });

    it('should ignore unsubscribe message with no projectId', () => {
      expect(() => handleMessage(JSON.stringify({ type: 'unsubscribe' }))).not.toThrow();
    });

    it('should handle resource_event with undefined data', () => {
      expect(() => handleMessage(JSON.stringify({ type: 'resource_event' }))).not.toThrow();
    });

    it('should ignore invalid JSON messages', () => {
      expect(() => handleMessage('not valid json {')).not.toThrow();
    });

    it('should handle unsubscribe from project with no subscribers', () => {
      handleMessage(JSON.stringify({ type: 'unsubscribe', projectId: 'nonexistent-project' }));
      expect(wsServer.getConnectedClients()).toHaveLength(0);
    });

    it('should handle disconnect of unregistered ws connection', () => {
      const handleClose = jest.fn();
      const anotherWs = {
        readyState: 1,
        send: jest.fn(),
        on: jest.fn(),
        close: jest.fn(),
      };

      const { WebSocketServer: MockWebSocketServer } = jest.requireMock('ws');
      const mockWssInstance = MockWebSocketServer.mock.results[0].value;
      const connectionHandler = mockWssInstance.on.mock.calls.find(
        ([event]: [string]) => event === 'connection'
      )[1];

      anotherWs.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'close') {
          handleClose.mockImplementation(handler);
        }
      });

      connectionHandler(anotherWs);

      // Close without registering - should not throw
      expect(() => handleClose()).not.toThrow();
    });
  });

  describe('dockerFallbackWarning event', () => {
    it('should broadcast docker_fallback_warning on event', () => {
      wsServer = new DefaultWebSocketServer({ agentManager: mockAgentManager });

      const dockerWarningListener = agentListeners.get('dockerFallbackWarning')?.values().next().value as
        | ((...args: unknown[]) => void)
        | undefined;

      expect(dockerWarningListener).toBeDefined();

      expect(() => {
        dockerWarningListener!('test-project', 'Container not available');
      }).not.toThrow();
    });
  });

  describe('Ralph Loop output and tool_use events', () => {
    let mockRalphLoop: RalphLoopService & EventEmitter;

    beforeEach(() => {
      mockRalphLoop = createMockRalphLoopService();
      wsServer = new DefaultWebSocketServer({
        agentManager: mockAgentManager,
        ralphLoopService: mockRalphLoop,
      });
    });

    it('should handle output event', () => {
      expect(() => {
        mockRalphLoop.emit('output', 'project-1', 'task-123', 'worker', 'Some output content');
      }).not.toThrow();
    });

    it('should handle tool_use event', () => {
      const toolInfo = {
        tool_name: 'Bash',
        tool_id: 'tool-abc',
        parameters: { command: 'ls' },
        timestamp: new Date().toISOString(),
      };

      expect(() => {
        mockRalphLoop.emit('tool_use', 'project-1', 'task-123', 'worker', toolInfo);
      }).not.toThrow();
    });
  });

  describe('oneOff agent listeners', () => {
    it('should ignore oneOffMessage when meta is null', () => {
      mockAgentManager.getOneOffMeta.mockReturnValue(null);
      wsServer = new DefaultWebSocketServer({ agentManager: mockAgentManager });

      const listener = agentListeners.get('oneOffMessage')?.values().next().value as
        | ((...args: unknown[]) => void)
        | undefined;

      expect(listener).toBeDefined();
      expect(() => {
        listener!('unknown-oneoff', {
          type: 'stdout',
          content: 'test',
          timestamp: new Date().toISOString(),
        });
      }).not.toThrow();
    });

    it('should broadcast oneoff_message when meta is present', () => {
      mockAgentManager.getOneOffMeta.mockReturnValue({
        projectId: 'proj-1',
        label: 'Test Label',
      });
      wsServer = new DefaultWebSocketServer({ agentManager: mockAgentManager });

      const listener = agentListeners.get('oneOffMessage')?.values().next().value as
        | ((...args: unknown[]) => void)
        | undefined;

      expect(() => {
        listener!('oneoff-123', {
          type: 'stdout',
          content: 'hello',
          timestamp: new Date().toISOString(),
        });
      }).not.toThrow();
    });

    it('should ignore oneOffStatus when meta is null', () => {
      mockAgentManager.getOneOffMeta.mockReturnValue(null);
      wsServer = new DefaultWebSocketServer({ agentManager: mockAgentManager });

      const listener = agentListeners.get('oneOffStatus')?.values().next().value as
        | ((...args: unknown[]) => void)
        | undefined;

      expect(listener).toBeDefined();
      expect(() => {
        listener!('unknown-oneoff', 'running');
      }).not.toThrow();
    });

    it('should broadcast oneoff_status and agent_status when meta is present', () => {
      mockAgentManager.getOneOffMeta.mockReturnValue({
        projectId: 'proj-1',
        label: 'Test Label',
      });
      wsServer = new DefaultWebSocketServer({ agentManager: mockAgentManager });

      const listener = agentListeners.get('oneOffStatus')?.values().next().value as
        | ((...args: unknown[]) => void)
        | undefined;

      expect(() => {
        listener!('oneoff-123', 'stopped');
      }).not.toThrow();

      expect(mockAgentManager.getFullStatus).toHaveBeenCalledWith('proj-1');
    });

    it('should ignore oneOffWaiting when meta is null', () => {
      mockAgentManager.getOneOffMeta.mockReturnValue(null);
      wsServer = new DefaultWebSocketServer({ agentManager: mockAgentManager });

      const listener = agentListeners.get('oneOffWaiting')?.values().next().value as
        | ((...args: unknown[]) => void)
        | undefined;

      expect(listener).toBeDefined();
      expect(() => {
        listener!('unknown-oneoff', true, 1);
      }).not.toThrow();
    });

    it('should broadcast oneoff_waiting when meta is present', () => {
      mockAgentManager.getOneOffMeta.mockReturnValue({
        projectId: 'proj-1',
        label: 'Test Label',
      });
      wsServer = new DefaultWebSocketServer({ agentManager: mockAgentManager });

      const listener = agentListeners.get('oneOffWaiting')?.values().next().value as
        | ((...args: unknown[]) => void)
        | undefined;

      expect(() => {
        listener!('oneoff-123', true, 2);
      }).not.toThrow();
    });
  });

  describe('run config process listeners', () => {
    let mockRunProcessManager: RunProcessManager & EventEmitter;

    beforeEach(() => {
      mockRunProcessManager = createMockRunProcessManager();
    });

    it('should set up run config listeners when manager is provided', () => {
      wsServer = new DefaultWebSocketServer({
        agentManager: mockAgentManager,
        runProcessManager: mockRunProcessManager,
      });

      expect((mockRunProcessManager as EventEmitter).listenerCount('output')).toBe(1);
      expect((mockRunProcessManager as EventEmitter).listenerCount('status')).toBe(1);
    });

    it('should not set up listeners when manager is not provided', () => {
      wsServer = new DefaultWebSocketServer({ agentManager: mockAgentManager });
      expect(wsServer).toBeDefined();
    });

    it('should broadcast run_config_output on output event', () => {
      wsServer = new DefaultWebSocketServer({
        agentManager: mockAgentManager,
        runProcessManager: mockRunProcessManager,
      });

      expect(() => {
        (mockRunProcessManager as EventEmitter).emit('output', 'project-1', 'config-abc', 'output data');
      }).not.toThrow();
    });

    it('should broadcast run_config_status on status event', () => {
      wsServer = new DefaultWebSocketServer({
        agentManager: mockAgentManager,
        runProcessManager: mockRunProcessManager,
      });

      const status = {
        configId: 'config-abc',
        state: 'running' as const,
        pid: 1234,
        startedAt: new Date().toISOString(),
        uptimeMs: 5000,
        exitCode: null,
        restartCount: 0,
        error: null,
      };

      expect(() => {
        (mockRunProcessManager as EventEmitter).emit('status', 'project-1', 'config-abc', status);
      }).not.toThrow();
    });
  });

  describe('frontend error logger listener', () => {
    it('should broadcast frontend_error when log store emits frontend_error', () => {
      wsServer = new DefaultWebSocketServer({ agentManager: mockAgentManager });
      wsServer.initialize({} as Server);

      const { WebSocketServer: MockWebSocketServer } = jest.requireMock('ws');
      const mockWssInstance = MockWebSocketServer.mock.results[0].value;
      const mockClient = Array.from(mockWssInstance.clients)[0] as { send: jest.Mock };
      mockClient.send.mockClear();

      const logStore = getLogStore();
      logStore.emit('frontend_error', {
        level: 'error',
        message: 'Test frontend error',
        timestamp: new Date().toISOString(),
        projectId: 'proj-1',
        context: {
          type: 'frontend',
          clientId: 'client-123',
          errorType: 'TypeError',
          source: 'http://localhost/app.js',
          userAgent: 'Chrome/120',
          stack: 'Error: test\n  at test.js:1',
          line: 42,
          column: 5,
        },
      });

      expect(mockClient.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"frontend_error"')
      );
    });

    it('should handle frontend_error with minimal context', () => {
      wsServer = new DefaultWebSocketServer({ agentManager: mockAgentManager });

      const logStore = getLogStore();
      expect(() => {
        logStore.emit('frontend_error', {
          level: 'error',
          message: 'Minimal error',
          timestamp: new Date().toISOString(),
        });
      }).not.toThrow();
    });
  });

  describe('saveRalphLoopMessage', () => {
    let mockConversationRepo: jest.Mocked<ConversationRepository>;
    let mockProjectRepo: jest.Mocked<ProjectRepository>;
    let mockRalphLoop: RalphLoopService & EventEmitter;

    beforeEach(() => {
      mockConversationRepo = createMockConversationRepository();
      mockProjectRepo = createMockProjectRepository();
      mockRalphLoop = createMockRalphLoopService();
    });

    it('should skip saving when conversationRepository is not provided', async () => {
      wsServer = new DefaultWebSocketServer({
        agentManager: mockAgentManager,
        ralphLoopService: mockRalphLoop,
        projectRepository: mockProjectRepo,
      });

      mockRalphLoop.emit('output', 'proj-1', 'task-1', 'worker', 'some content');

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mockProjectRepo.findById).not.toHaveBeenCalled();
    });

    it('should skip saving when projectRepository is not provided', async () => {
      wsServer = new DefaultWebSocketServer({
        agentManager: mockAgentManager,
        ralphLoopService: mockRalphLoop,
        conversationRepository: mockConversationRepo,
      });

      mockRalphLoop.emit('output', 'proj-1', 'task-1', 'worker', 'some content');

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mockConversationRepo.addMessage).not.toHaveBeenCalled();
    });

    it('should skip saving when project has no currentConversationId', async () => {
      mockProjectRepo.findById.mockResolvedValue({
        id: 'proj-1',
        name: 'Test',
        path: '/path',
        status: 'stopped',
        currentConversationId: null,
        nextItem: null,
        currentItem: null,
        lastContextUsage: null,
        permissionOverrides: null,
        modelOverride: null,
        mcpOverrides: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      wsServer = new DefaultWebSocketServer({
        agentManager: mockAgentManager,
        ralphLoopService: mockRalphLoop,
        conversationRepository: mockConversationRepo,
        projectRepository: mockProjectRepo,
      });

      mockRalphLoop.emit('output', 'proj-1', 'task-1', 'worker', 'content');

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mockConversationRepo.addMessage).not.toHaveBeenCalled();
    });

    it('should save ralph_loop_output message with phase', async () => {
      mockProjectRepo.findById.mockResolvedValue({
        id: 'proj-1',
        name: 'Test',
        path: '/path',
        status: 'stopped',
        currentConversationId: 'conv-123',
        nextItem: null,
        currentItem: null,
        lastContextUsage: null,
        permissionOverrides: null,
        modelOverride: null,
        mcpOverrides: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      wsServer = new DefaultWebSocketServer({
        agentManager: mockAgentManager,
        ralphLoopService: mockRalphLoop,
        conversationRepository: mockConversationRepo,
        projectRepository: mockProjectRepo,
      });

      mockRalphLoop.emit('output', 'proj-1', 'task-1', 'worker', 'output content');

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(mockConversationRepo.addMessage).toHaveBeenCalledWith(
        'proj-1',
        'conv-123',
        expect.objectContaining({
          type: 'stdout',
          content: 'output content',
          ralphLoopPhase: 'worker',
        })
      );
    });

    it('should save ralph_loop_iteration message', async () => {
      mockProjectRepo.findById.mockResolvedValue({
        id: 'proj-1',
        name: 'Test',
        path: '/path',
        status: 'stopped',
        currentConversationId: 'conv-123',
        nextItem: null,
        currentItem: null,
        lastContextUsage: null,
        permissionOverrides: null,
        modelOverride: null,
        mcpOverrides: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      wsServer = new DefaultWebSocketServer({
        agentManager: mockAgentManager,
        ralphLoopService: mockRalphLoop,
        conversationRepository: mockConversationRepo,
        projectRepository: mockProjectRepo,
      });

      mockRalphLoop.emit('iteration_start', 'proj-1', 'task-1', 2);

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(mockConversationRepo.addMessage).toHaveBeenCalledWith(
        'proj-1',
        'conv-123',
        expect.objectContaining({ content: expect.stringContaining('Iteration 2') })
      );
    });

    it('should save ralph_loop_worker_complete with files modified', async () => {
      mockProjectRepo.findById.mockResolvedValue({
        id: 'proj-1',
        name: 'Test',
        path: '/path',
        status: 'stopped',
        currentConversationId: 'conv-123',
        nextItem: null,
        currentItem: null,
        lastContextUsage: null,
        permissionOverrides: null,
        modelOverride: null,
        mcpOverrides: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      wsServer = new DefaultWebSocketServer({
        agentManager: mockAgentManager,
        ralphLoopService: mockRalphLoop,
        conversationRepository: mockConversationRepo,
        projectRepository: mockProjectRepo,
      });

      const summary = {
        iterationNumber: 1,
        timestamp: new Date().toISOString(),
        workerOutput: 'done',
        filesModified: ['src/index.ts', 'src/app.ts'],
        tokensUsed: 100,
        durationMs: 1000,
      };

      mockRalphLoop.emit('worker_complete', 'proj-1', 'task-1', summary);

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(mockConversationRepo.addMessage).toHaveBeenCalledWith(
        'proj-1',
        'conv-123',
        expect.objectContaining({
          content: expect.stringContaining('src/index.ts'),
        })
      );
    });

    it('should save ralph_loop_worker_complete without files', async () => {
      mockProjectRepo.findById.mockResolvedValue({
        id: 'proj-1',
        name: 'Test',
        path: '/path',
        status: 'stopped',
        currentConversationId: 'conv-123',
        nextItem: null,
        currentItem: null,
        lastContextUsage: null,
        permissionOverrides: null,
        modelOverride: null,
        mcpOverrides: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      wsServer = new DefaultWebSocketServer({
        agentManager: mockAgentManager,
        ralphLoopService: mockRalphLoop,
        conversationRepository: mockConversationRepo,
        projectRepository: mockProjectRepo,
      });

      const summary = {
        iterationNumber: 1,
        timestamp: new Date().toISOString(),
        workerOutput: 'done',
        filesModified: [],
        tokensUsed: 100,
        durationMs: 1000,
      };

      mockRalphLoop.emit('worker_complete', 'proj-1', 'task-1', summary);

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(mockConversationRepo.addMessage).toHaveBeenCalledWith(
        'proj-1',
        'conv-123',
        expect.objectContaining({ content: 'Worker completed iteration 1' })
      );
    });

    it('should save ralph_loop_reviewer_complete with feedback', async () => {
      mockProjectRepo.findById.mockResolvedValue({
        id: 'proj-1',
        name: 'Test',
        path: '/path',
        status: 'stopped',
        currentConversationId: 'conv-123',
        nextItem: null,
        currentItem: null,
        lastContextUsage: null,
        permissionOverrides: null,
        modelOverride: null,
        mcpOverrides: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      wsServer = new DefaultWebSocketServer({
        agentManager: mockAgentManager,
        ralphLoopService: mockRalphLoop,
        conversationRepository: mockConversationRepo,
        projectRepository: mockProjectRepo,
      });

      const feedback = {
        iterationNumber: 1,
        timestamp: new Date().toISOString(),
        decision: 'needs_changes' as const,
        feedback: 'Please add tests',
        specificIssues: [],
        suggestedImprovements: [],
      };

      mockRalphLoop.emit('reviewer_complete', 'proj-1', 'task-1', feedback);

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(mockConversationRepo.addMessage).toHaveBeenCalledWith(
        'proj-1',
        'conv-123',
        expect.objectContaining({
          content: expect.stringContaining('Please add tests'),
        })
      );
    });

    it('should save ralph_loop_reviewer_complete without feedback text', async () => {
      mockProjectRepo.findById.mockResolvedValue({
        id: 'proj-1',
        name: 'Test',
        path: '/path',
        status: 'stopped',
        currentConversationId: 'conv-123',
        nextItem: null,
        currentItem: null,
        lastContextUsage: null,
        permissionOverrides: null,
        modelOverride: null,
        mcpOverrides: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      wsServer = new DefaultWebSocketServer({
        agentManager: mockAgentManager,
        ralphLoopService: mockRalphLoop,
        conversationRepository: mockConversationRepo,
        projectRepository: mockProjectRepo,
      });

      const feedback = {
        iterationNumber: 1,
        timestamp: new Date().toISOString(),
        decision: 'approved' as const,
        feedback: null,
        specificIssues: [],
        suggestedImprovements: [],
      };

      mockRalphLoop.emit('reviewer_complete', 'proj-1', 'task-1', feedback);

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(mockConversationRepo.addMessage).toHaveBeenCalledWith(
        'proj-1',
        'conv-123',
        expect.objectContaining({ content: 'Reviewer decision: approved' })
      );
    });

    it('should save ralph_loop_complete message', async () => {
      mockProjectRepo.findById.mockResolvedValue({
        id: 'proj-1',
        name: 'Test',
        path: '/path',
        status: 'stopped',
        currentConversationId: 'conv-123',
        nextItem: null,
        currentItem: null,
        lastContextUsage: null,
        permissionOverrides: null,
        modelOverride: null,
        mcpOverrides: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      wsServer = new DefaultWebSocketServer({
        agentManager: mockAgentManager,
        ralphLoopService: mockRalphLoop,
        conversationRepository: mockConversationRepo,
        projectRepository: mockProjectRepo,
      });

      mockRalphLoop.emit('loop_complete', 'proj-1', 'task-1', 'approved');

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(mockConversationRepo.addMessage).toHaveBeenCalledWith(
        'proj-1',
        'conv-123',
        expect.objectContaining({ content: 'Ralph Loop completed: approved' })
      );
    });

    it('should save ralph_loop_error message', async () => {
      mockProjectRepo.findById.mockResolvedValue({
        id: 'proj-1',
        name: 'Test',
        path: '/path',
        status: 'stopped',
        currentConversationId: 'conv-123',
        nextItem: null,
        currentItem: null,
        lastContextUsage: null,
        permissionOverrides: null,
        modelOverride: null,
        mcpOverrides: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      wsServer = new DefaultWebSocketServer({
        agentManager: mockAgentManager,
        ralphLoopService: mockRalphLoop,
        conversationRepository: mockConversationRepo,
        projectRepository: mockProjectRepo,
      });

      mockRalphLoop.emit('loop_error', 'proj-1', 'task-1', 'Worker crashed');

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(mockConversationRepo.addMessage).toHaveBeenCalledWith(
        'proj-1',
        'conv-123',
        expect.objectContaining({ content: 'Ralph Loop error: Worker crashed' })
      );
    });

    it('should save ralph_loop_tool_use message', async () => {
      mockProjectRepo.findById.mockResolvedValue({
        id: 'proj-1',
        name: 'Test',
        path: '/path',
        status: 'stopped',
        currentConversationId: 'conv-123',
        nextItem: null,
        currentItem: null,
        lastContextUsage: null,
        permissionOverrides: null,
        modelOverride: null,
        mcpOverrides: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      wsServer = new DefaultWebSocketServer({
        agentManager: mockAgentManager,
        ralphLoopService: mockRalphLoop,
        conversationRepository: mockConversationRepo,
        projectRepository: mockProjectRepo,
      });

      const toolInfo = {
        tool_name: 'Bash',
        tool_id: 'tool-xyz',
        parameters: { command: 'npm test' },
        timestamp: new Date().toISOString(),
      };

      mockRalphLoop.emit('tool_use', 'proj-1', 'task-1', 'worker', toolInfo);

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(mockConversationRepo.addMessage).toHaveBeenCalledWith(
        'proj-1',
        'conv-123',
        expect.objectContaining({
          type: 'tool_use',
          content: 'Bash',
        })
      );
    });

    it('should handle error in saveRalphLoopMessage gracefully', async () => {
      mockProjectRepo.findById.mockRejectedValue(new Error('DB Error'));

      wsServer = new DefaultWebSocketServer({
        agentManager: mockAgentManager,
        ralphLoopService: mockRalphLoop,
        conversationRepository: mockConversationRepo,
        projectRepository: mockProjectRepo,
      });

      expect(() => {
        mockRalphLoop.emit('output', 'proj-1', 'task-1', 'worker', 'content');
      }).not.toThrow();

      await new Promise(resolve => setTimeout(resolve, 10));
    });
  });

  describe('heartbeat', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    const makeHeartbeatClient = (isAlive: boolean) => ({
      isAlive,
      terminate: jest.fn(),
      ping: jest.fn(),
      readyState: 1,
      close: jest.fn(),
      send: jest.fn(),
    });

    it('should terminate unresponsive clients', () => {
      wsServer = new DefaultWebSocketServer({ agentManager: mockAgentManager });
      wsServer.initialize({} as Server);

      const { WebSocketServer: MockWebSocketServer } = jest.requireMock('ws');
      const mockWssInstance = MockWebSocketServer.mock.results[0].value;

      const unresponsiveClient = makeHeartbeatClient(false);
      mockWssInstance.clients.clear();
      mockWssInstance.clients.add(unresponsiveClient);

      jest.advanceTimersByTime(30000);

      expect(unresponsiveClient.terminate).toHaveBeenCalled();
    });

    it('should ping live clients and mark them as pending', () => {
      wsServer = new DefaultWebSocketServer({ agentManager: mockAgentManager });
      wsServer.initialize({} as Server);

      const { WebSocketServer: MockWebSocketServer } = jest.requireMock('ws');
      const mockWssInstance = MockWebSocketServer.mock.results[0].value;

      const liveClient = makeHeartbeatClient(true);
      mockWssInstance.clients.clear();
      mockWssInstance.clients.add(liveClient);

      jest.advanceTimersByTime(30000);

      expect(liveClient.ping).toHaveBeenCalled();
      expect(liveClient.isAlive).toBe(false);
    });

    it('should not ping when wss is null (after close)', () => {
      wsServer = new DefaultWebSocketServer({ agentManager: mockAgentManager });
      wsServer.initialize({} as Server);

      const { WebSocketServer: MockWebSocketServer } = jest.requireMock('ws');
      const mockWssInstance = MockWebSocketServer.mock.results[0].value;

      // Use a client with close so wsServer.close() doesn't fail
      const client = makeHeartbeatClient(true);
      mockWssInstance.clients.clear();
      mockWssInstance.clients.add(client);

      // close() clears the wss and cancels pingInterval
      wsServer.close();

      jest.advanceTimersByTime(30000);

      // After close, pingInterval is cleared, so ping should not be called
      expect(client.ping).not.toHaveBeenCalled();
    });

    it('should handle pong to mark client as alive', () => {
      wsServer = new DefaultWebSocketServer({ agentManager: mockAgentManager });
      const mockHttpServer = new EventEmitter() as Server;
      wsServer.initialize(mockHttpServer);

      const { WebSocketServer: MockWebSocketServer } = jest.requireMock('ws');
      const mockWssInstance = MockWebSocketServer.mock.results[0].value;
      const connectionHandler = mockWssInstance.on.mock.calls.find(
        ([event]: [string]) => event === 'connection'
      )[1];

      let pongHandler: (() => void) | null = null;
      const testWs = {
        isAlive: false,
        readyState: 1,
        send: jest.fn(),
        ping: jest.fn(),
        terminate: jest.fn(),
        on: jest.fn((event: string, handler: () => void) => {
          if (event === 'pong') {
            pongHandler = handler;
          }
        }),
        close: jest.fn(),
      };

      // Replace clients with testWs so close() works
      mockWssInstance.clients.clear();
      mockWssInstance.clients.add(testWs);

      connectionHandler(testWs);

      expect(testWs.isAlive).toBe(true);

      testWs.isAlive = false;
      pongHandler!();

      expect(testWs.isAlive).toBe(true);
    });
  });
});
