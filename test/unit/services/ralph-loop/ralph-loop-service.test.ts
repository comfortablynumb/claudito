import { EventEmitter } from 'events';
import {
  DefaultRalphLoopService,
  ProjectPathResolver,
  WorkerAgentFactory,
  ReviewerAgentFactory,
} from '../../../../src/services/ralph-loop/ralph-loop-service';
import {
  createMockRalphLoopRepository,
  createMockContextInitializer,
  createTestRalphLoopConfig,
  createTestRalphLoopState,
  createMockProjectRepository,
  createMockSettingsRepository,
} from '../../helpers/mock-factories';
import {
  RalphLoopRepository,
  ContextInitializer,
  RalphLoopState,
  IterationSummary,
  ReviewerFeedback,
} from '../../../../src/services/ralph-loop/types';
import {
  WorkerAgent,
  WorkerAgentConfig,
  WorkerStatus,
  WorkerAgentEvents,
} from '../../../../src/services/ralph-loop/worker-agent';
import {
  ReviewerAgent,
  ReviewerAgentConfig,
  ReviewerStatus,
  ReviewerAgentEvents,
} from '../../../../src/services/ralph-loop/reviewer-agent';

function createMockProjectPathResolver(
  paths?: Record<string, string>
): jest.Mocked<ProjectPathResolver> {
  const projectPaths = new Map(Object.entries(paths || {}));

  return {
    getProjectPath: jest.fn().mockImplementation((projectId: string) => {
      return projectPaths.get(projectId) || '/test/project';
    }),
  };
}

/**
 * Mock WorkerAgent for testing
 */
class MockWorkerAgent implements Pick<WorkerAgent, 'run' | 'stop' | 'on' | 'off' | 'status'> {
  private emitter = new EventEmitter();
  private _status: WorkerStatus = 'idle';
  private runResolver?: (summary: IterationSummary) => void;

  get status(): WorkerStatus {
    return this._status;
  }

  async run(state: RalphLoopState): Promise<IterationSummary> {
    this._status = 'running';

    return new Promise<IterationSummary>((resolve) => {
      this.runResolver = resolve;

      // Immediately complete with mock summary
      setTimeout(() => {
        const summary: IterationSummary = {
          iterationNumber: state.currentIteration,
          timestamp: new Date().toISOString(),
          workerOutput: 'Mock worker output',
          filesModified: [],
          tokensUsed: 100,
          durationMs: 10,
        };
        this._status = 'completed';
        this.emitter.emit('complete', summary);
        resolve(summary);
      }, 5);
    });
  }

  stop(): Promise<void> {
    this._status = 'idle';
    return Promise.resolve();
  }

  on<K extends keyof WorkerAgentEvents>(event: K, listener: WorkerAgentEvents[K]): void {
    this.emitter.on(event, listener);
  }

  off<K extends keyof WorkerAgentEvents>(event: K, listener: WorkerAgentEvents[K]): void {
    this.emitter.off(event, listener);
  }
}

function createMockWorkerAgentFactory(): jest.Mocked<WorkerAgentFactory> {
  return {
    create: jest.fn().mockImplementation((_config: WorkerAgentConfig) => {
      return new MockWorkerAgent() as unknown as WorkerAgent;
    }),
  };
}

/**
 * Mock ReviewerAgent for testing
 */
class MockReviewerAgent implements Pick<ReviewerAgent, 'run' | 'stop' | 'on' | 'off' | 'status'> {
  private emitter = new EventEmitter();
  private _status: ReviewerStatus = 'idle';
  private iterationCount = 0;

  get status(): ReviewerStatus {
    return this._status;
  }

  async run(state: RalphLoopState, _workerOutput: string): Promise<ReviewerFeedback> {
    this._status = 'running';
    this.iterationCount++;

    return new Promise<ReviewerFeedback>((resolve) => {
      // Immediately complete with mock feedback
      setTimeout(() => {
        // Approve after 3 iterations to simulate completion
        const decision: ReviewerFeedback['decision'] =
          state.currentIteration >= 3 ? 'approve' : 'needs_changes';

        const feedback: ReviewerFeedback = {
          iterationNumber: state.currentIteration,
          timestamp: new Date().toISOString(),
          decision,
          feedback: `Mock reviewer feedback for iteration ${state.currentIteration}`,
          specificIssues: [],
          suggestedImprovements: [],
        };
        this._status = 'completed';
        this.emitter.emit('complete', feedback);
        resolve(feedback);
      }, 5);
    });
  }

  stop(): Promise<void> {
    this._status = 'idle';
    return Promise.resolve();
  }

  on<K extends keyof ReviewerAgentEvents>(event: K, listener: ReviewerAgentEvents[K]): void {
    this.emitter.on(event, listener);
  }

  off<K extends keyof ReviewerAgentEvents>(event: K, listener: ReviewerAgentEvents[K]): void {
    this.emitter.off(event, listener);
  }
}

function createMockReviewerAgentFactory(): jest.Mocked<ReviewerAgentFactory> {
  return {
    create: jest.fn().mockImplementation((_config: ReviewerAgentConfig) => {
      return new MockReviewerAgent() as unknown as ReviewerAgent;
    }),
  };
}

describe('DefaultRalphLoopService', () => {
  let service: DefaultRalphLoopService;
  let mockRepository: jest.Mocked<RalphLoopRepository>;
  let mockProjectRepository: ReturnType<typeof createMockProjectRepository>;
  let mockContextInitializer: jest.Mocked<ContextInitializer>;
  let mockProjectPathResolver: jest.Mocked<ProjectPathResolver>;
  let mockWorkerAgentFactory: jest.Mocked<WorkerAgentFactory>;
  let mockReviewerAgentFactory: jest.Mocked<ReviewerAgentFactory>;

  beforeEach(() => {
    mockRepository = createMockRalphLoopRepository();
    mockProjectRepository = createMockProjectRepository();
    mockContextInitializer = createMockContextInitializer();
    mockProjectPathResolver = createMockProjectPathResolver({
      'test-project': '/test/project',
    });
    mockWorkerAgentFactory = createMockWorkerAgentFactory();
    mockReviewerAgentFactory = createMockReviewerAgentFactory();

    service = new DefaultRalphLoopService({
      repository: mockRepository,
      projectRepository: mockProjectRepository,
      projectPathResolver: mockProjectPathResolver,
      contextInitializer: mockContextInitializer,
      workerAgentFactory: mockWorkerAgentFactory,
      reviewerAgentFactory: mockReviewerAgentFactory,
    });
  });

  afterEach(async () => {
    // Stop all running loops to prevent async operations after test completion
    const allLoops = await service.listByProject('test-project');
    for (const loop of allLoops) {
      if (loop.status === 'worker_running' || loop.status === 'reviewer_running') {
        try {
          await service.stop('test-project', loop.taskId);
        } catch (err) {
          // Ignore errors during cleanup
        }
      }
    }
  });

  describe('start', () => {
    it('should create initial state', async () => {
      const config = createTestRalphLoopConfig({
        maxTurns: 5,
        taskDescription: 'Test task',
      });

      const state = await service.start('test-project', config);

      expect(state.projectId).toBe('test-project');
      expect(state.config).toEqual(config);
      expect(state.currentIteration).toBe(0);
      expect(state.status).toBe('idle');
      expect(mockRepository.create).toHaveBeenCalled();
    });

    it('should generate unique task ID', async () => {
      const config = createTestRalphLoopConfig();

      const state1 = await service.start('test-project', config);
      const state2 = await service.start('test-project', config);

      expect(state1.taskId).toBeTruthy();
      expect(state2.taskId).toBeTruthy();
      expect(state1.taskId).not.toBe(state2.taskId);
    });

    it('should emit iteration_start event', async () => {
      const config = createTestRalphLoopConfig();
      const listener = jest.fn();

      service.on('iteration_start', listener);
      await service.start('test-project', config);

      // Wait for async iteration to start
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(listener).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        1
      );
    });
  });

  describe('stop', () => {
    it('should stop running loop', async () => {
      const config = createTestRalphLoopConfig();
      const state = await service.start('test-project', config);

      await service.stop('test-project', state.taskId);

      expect(mockRepository.update).toHaveBeenCalledWith(
        'test-project',
        state.taskId,
        expect.objectContaining({
          status: 'completed',
          finalStatus: 'critical_failure',
        })
      );
    });

    it('should set error message on stop', async () => {
      const config = createTestRalphLoopConfig();
      const state = await service.start('test-project', config);

      await service.stop('test-project', state.taskId);

      expect(mockRepository.update).toHaveBeenCalledWith(
        'test-project',
        state.taskId,
        expect.objectContaining({
          error: 'Loop stopped by user',
        })
      );
    });
  });

  describe('pause', () => {
    it('should pause running loop', async () => {
      const config = createTestRalphLoopConfig();
      const state = await service.start('test-project', config);

      await service.pause('test-project', state.taskId);

      expect(mockRepository.update).toHaveBeenCalledWith(
        'test-project',
        state.taskId,
        { status: 'paused' }
      );
    });

    it('should emit status_change event', async () => {
      const config = createTestRalphLoopConfig();
      const listener = jest.fn();

      const state = await service.start('test-project', config);
      service.on('status_change', listener);

      await service.pause('test-project', state.taskId);

      expect(listener).toHaveBeenCalledWith(
        'test-project',
        state.taskId,
        'paused',
        expect.any(Number),  // iteration
        expect.any(Number)   // maxTurns
      );
    });
  });

  describe('resume', () => {
    it('should throw for non-existent loop', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(
        service.resume('test-project', 'non-existent')
      ).rejects.toThrow('Ralph Loop not found');
    });

    it('should throw for non-paused loop', async () => {
      const state = createTestRalphLoopState({
        status: 'worker_running',
      });
      mockRepository.findById.mockResolvedValue(state);

      await expect(
        service.resume('test-project', state.taskId)
      ).rejects.toThrow('Cannot resume loop in status: worker_running');
    });

    it('should resume paused loop', async () => {
      const state = createTestRalphLoopState({
        status: 'paused',
        currentIteration: 2,
      });
      mockRepository.findById.mockResolvedValue(state);

      await service.resume('test-project', state.taskId);

      expect(mockRepository.update).toHaveBeenCalledWith(
        'test-project',
        state.taskId,
        { status: 'idle' }
      );
    });
  });

  describe('getState', () => {
    it('should return null for non-existent loop', async () => {
      mockRepository.findById.mockResolvedValue(null);

      const state = await service.getState('test-project', 'non-existent');

      expect(state).toBeNull();
    });

    it('should return state from repository', async () => {
      const storedState = createTestRalphLoopState({
        taskId: 'task-123',
        status: 'worker_running',
      });
      mockRepository.findById.mockResolvedValue(storedState);

      const state = await service.getState('test-project', 'task-123');

      expect(state).toEqual(storedState);
    });
  });

  describe('listByProject', () => {
    it('should return empty array for project with no loops', async () => {
      mockRepository.findByProject.mockResolvedValue([]);

      const states = await service.listByProject('test-project');

      expect(states).toEqual([]);
    });

    it('should return all loops for project', async () => {
      const states = [
        createTestRalphLoopState({ taskId: 'task-1' }),
        createTestRalphLoopState({ taskId: 'task-2' }),
      ];
      mockRepository.findByProject.mockResolvedValue(states);

      const result = await service.listByProject('test-project');

      expect(result.length).toBe(2);
    });
  });

  describe('event handling', () => {
    it('should allow subscribing to events', () => {
      const listener = jest.fn();

      service.on('loop_complete', listener);

      // No error thrown
      expect(listener).not.toHaveBeenCalled();
    });

    it('should allow unsubscribing from events', () => {
      const listener = jest.fn();

      service.on('loop_complete', listener);
      service.off('loop_complete', listener);

      // No error thrown
      expect(listener).not.toHaveBeenCalled();
    });

    it('should emit worker_complete event after worker phase', async () => {
      const config = createTestRalphLoopConfig();
      const listener = jest.fn();

      service.on('worker_complete', listener);
      await service.start('test-project', config);

      // Wait for async worker phase
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(listener).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        expect.objectContaining({
          iterationNumber: expect.any(Number),
          workerOutput: expect.any(String),
        })
      );
    });

    it('should emit reviewer_complete event after reviewer phase', async () => {
      const config = createTestRalphLoopConfig();
      const listener = jest.fn();

      service.on('reviewer_complete', listener);
      await service.start('test-project', config);

      // Wait for async reviewer phase
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(listener).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        expect.objectContaining({
          iterationNumber: expect.any(Number),
          decision: expect.any(String),
        })
      );
    });
  });

  describe('iteration lifecycle', () => {
    it('should increment iteration counter', async () => {
      const config = createTestRalphLoopConfig();
      await service.start('test-project', config);

      // Wait for iteration to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockRepository.update).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        expect.objectContaining({
          currentIteration: 1,
        })
      );
    });

    it('should add summary after worker phase', async () => {
      const config = createTestRalphLoopConfig();
      await service.start('test-project', config);

      // Wait for worker phase
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockRepository.addSummary).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        expect.objectContaining({
          iterationNumber: 1,
        })
      );
    });

    it('should add feedback after reviewer phase', async () => {
      const config = createTestRalphLoopConfig();
      await service.start('test-project', config);

      // Wait for reviewer phase
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(mockRepository.addFeedback).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        expect.objectContaining({
          iterationNumber: 1,
        })
      );
    });
  });

  describe('completion conditions', () => {
    it('should complete when max turns reached', async () => {
      const config = createTestRalphLoopConfig({ maxTurns: 1 });
      const listener = jest.fn();

      // Mock state to be at max turns
      mockRepository.findById.mockImplementation(() => Promise.resolve({
        ...createTestRalphLoopState(),
        config,
        currentIteration: 1,
      }));

      service.on('loop_complete', listener);
      await service.start('test-project', config);

      // Wait for completion check
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(listener).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        'max_turns_reached'
      );
    });

    it('should complete when reviewer approves', async () => {
      const config = createTestRalphLoopConfig({ maxTurns: 5 });
      const listener = jest.fn();

      // Mock iteration 3 which triggers approval in placeholder
      mockRepository.findById.mockImplementation(() => Promise.resolve({
        ...createTestRalphLoopState(),
        config,
        currentIteration: 3,
      }));

      service.on('loop_complete', listener);
      await service.start('test-project', config);

      // Wait for approval
      await new Promise((resolve) => setTimeout(resolve, 300));

      // The placeholder approves on iteration 3+
      expect(listener).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        'approved'
      );
    });
  });

  describe('error handling', () => {
    it('should emit loop_error on failure', async () => {
      const config = createTestRalphLoopConfig();
      const listener = jest.fn();

      mockRepository.create.mockRejectedValue(new Error('Database error'));

      service.on('loop_error', listener);

      await expect(service.start('test-project', config)).rejects.toThrow();
    });

    it('should handle loop error with non-Error object', async () => {
      const config = createTestRalphLoopConfig();
      const listener = jest.fn();

      // Make worker phase fail with a string error after start succeeds
      mockWorkerAgentFactory.create.mockImplementation(() => {
        const agent = new MockWorkerAgent() as unknown as WorkerAgent;
        (agent as any).run = () => Promise.reject('string error');
        return agent;
      });

      service.on('loop_error', listener);
      await service.start('test-project', config);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(listener).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        'string error'
      );
    });

    it('should handle project path not found', async () => {
      const config = createTestRalphLoopConfig();
      const listener = jest.fn();

      // Return null for project path
      mockProjectPathResolver.getProjectPath.mockReturnValue(null);

      service.on('loop_error', listener);
      await service.start('test-project', config);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(listener).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        expect.stringContaining('Project path not found')
      );
    });
  });

  describe('delete', () => {
    it('should stop and delete a loop', async () => {
      const config = createTestRalphLoopConfig();
      mockRepository.delete.mockResolvedValue(true);

      const state = await service.start('test-project', config);
      const result = await service.delete('test-project', state.taskId);

      expect(result).toBe(true);
      expect(mockRepository.delete).toHaveBeenCalledWith('test-project', state.taskId);
    });

    it('should emit loop_deleted event on successful delete', async () => {
      const config = createTestRalphLoopConfig();
      const listener = jest.fn();
      mockRepository.delete.mockResolvedValue(true);

      const state = await service.start('test-project', config);
      service.on('loop_deleted', listener);
      await service.delete('test-project', state.taskId);

      expect(listener).toHaveBeenCalledWith('test-project', state.taskId);
    });

    it('should not emit loop_deleted when repository delete returns false', async () => {
      const config = createTestRalphLoopConfig();
      const listener = jest.fn();
      mockRepository.delete.mockResolvedValue(false);

      const state = await service.start('test-project', config);
      service.on('loop_deleted', listener);
      await service.delete('test-project', state.taskId);

      expect(listener).not.toHaveBeenCalled();
    });

    it('should return false on delete error', async () => {
      const config = createTestRalphLoopConfig();
      mockRepository.delete.mockRejectedValue(new Error('Delete failed'));

      const state = await service.start('test-project', config);
      const result = await service.delete('test-project', state.taskId);

      expect(result).toBe(false);
    });
  });

  describe('reviewer decisions', () => {
    it('should complete loop with critical_failure on reject', async () => {
      const config = createTestRalphLoopConfig({ maxTurns: 5 });
      const listener = jest.fn();

      // Make reviewer always reject
      mockReviewerAgentFactory.create.mockImplementation(() => {
        return new MockRejectReviewerAgent() as unknown as ReviewerAgent;
      });

      service.on('loop_complete', listener);
      await service.start('test-project', config);

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(listener).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        'critical_failure'
      );
    });

    it('should continue iteration on needs_changes', async () => {
      const config = createTestRalphLoopConfig({ maxTurns: 2 });

      await service.start('test-project', config);

      // Wait for first iteration (needs_changes) + second iteration
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Should have run worker at least twice (needs_changes triggers next iteration)
      expect(mockWorkerAgentFactory.create).toHaveBeenCalled();
    });
  });

  describe('MCP server configuration', () => {
    it('should pass MCP servers to worker when settings repository is available', async () => {
      const mockSettingsRepo = createMockSettingsRepository({
        mcp: {
          enabled: true,
          servers: [
            {
              id: 'test-mcp',
              name: 'Test MCP',
              enabled: true,
              type: 'stdio',
              command: 'test-cmd',
            },
            {
              id: 'disabled-mcp',
              name: 'Disabled MCP',
              enabled: false,
              type: 'stdio',
              command: 'disabled-cmd',
            },
          ],
        },
      });

      const serviceWithMcp = new DefaultRalphLoopService({
        repository: mockRepository,
        projectRepository: mockProjectRepository,
        projectPathResolver: mockProjectPathResolver,
        contextInitializer: mockContextInitializer,
        workerAgentFactory: mockWorkerAgentFactory,
        reviewerAgentFactory: mockReviewerAgentFactory,
        settingsRepository: mockSettingsRepo,
      });

      const config = createTestRalphLoopConfig();
      await serviceWithMcp.start('test-project', config);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Worker factory should have been called with MCP servers (only enabled ones)
      expect(mockWorkerAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: [
            expect.objectContaining({ id: 'test-mcp', enabled: true }),
          ],
        })
      );

      // Clean up
      const allLoops = await serviceWithMcp.listByProject('test-project');
      for (const loop of allLoops) {
        if (loop.status === 'worker_running' || loop.status === 'reviewer_running') {
          try { await serviceWithMcp.stop('test-project', loop.taskId); } catch { /* no-op */ }
        }
      }
    });

    it('should not pass MCP servers when MCP is disabled', async () => {
      const mockSettingsRepo = createMockSettingsRepository({
        mcp: {
          enabled: false,
          servers: [
            {
              id: 'test-mcp',
              name: 'Test MCP',
              enabled: true,
              type: 'stdio',
              command: 'test-cmd',
            },
          ],
        },
      });

      const serviceWithMcp = new DefaultRalphLoopService({
        repository: mockRepository,
        projectRepository: mockProjectRepository,
        projectPathResolver: mockProjectPathResolver,
        contextInitializer: mockContextInitializer,
        workerAgentFactory: mockWorkerAgentFactory,
        reviewerAgentFactory: mockReviewerAgentFactory,
        settingsRepository: mockSettingsRepo,
      });

      const config = createTestRalphLoopConfig();
      await serviceWithMcp.start('test-project', config);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockWorkerAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: undefined,
        })
      );

      const allLoops = await serviceWithMcp.listByProject('test-project');
      for (const loop of allLoops) {
        if (loop.status === 'worker_running' || loop.status === 'reviewer_running') {
          try { await serviceWithMcp.stop('test-project', loop.taskId); } catch { /* no-op */ }
        }
      }
    });
  });

  describe('cleanup old loops', () => {
    it('should delete old loops exceeding history limit', async () => {
      const mockSettingsRepo = createMockSettingsRepository({
        ralphLoop: {
          defaultMaxTurns: 5,
          defaultWorkerModel: 'claude-opus-4-6',
          defaultReviewerModel: 'claude-sonnet-4-5-20250929',
          defaultWorkerSystemPrompt: '',
          defaultReviewerSystemPrompt: '',
          historyLimit: 2,
        },
      });

      // Pre-populate repository with old loops
      const oldLoops = [
        createTestRalphLoopState({ taskId: 'old-1', status: 'completed', projectId: 'test-project' }),
        createTestRalphLoopState({ taskId: 'old-2', status: 'completed', projectId: 'test-project' }),
        createTestRalphLoopState({ taskId: 'old-3', status: 'completed', projectId: 'test-project' }),
      ];
      mockRepository.findByProject.mockResolvedValue(oldLoops);
      mockRepository.delete.mockResolvedValue(true);

      const serviceWithSettings = new DefaultRalphLoopService({
        repository: mockRepository,
        projectRepository: mockProjectRepository,
        projectPathResolver: mockProjectPathResolver,
        contextInitializer: mockContextInitializer,
        workerAgentFactory: mockWorkerAgentFactory,
        reviewerAgentFactory: mockReviewerAgentFactory,
        settingsRepository: mockSettingsRepo,
      });

      const config = createTestRalphLoopConfig();
      await serviceWithSettings.start('test-project', config);

      // Wait for cleanup to run
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should delete the loop that exceeds the limit (3rd one, since limit is 2)
      expect(mockRepository.delete).toHaveBeenCalledWith('test-project', 'old-3');

      const allLoops = await serviceWithSettings.listByProject('test-project');
      for (const loop of allLoops) {
        if (loop.status === 'worker_running' || loop.status === 'reviewer_running') {
          try { await serviceWithSettings.stop('test-project', loop.taskId); } catch { /* no-op */ }
        }
      }
    });

    it('should skip cleanup of active loops', async () => {
      const mockSettingsRepo = createMockSettingsRepository({
        ralphLoop: {
          defaultMaxTurns: 5,
          defaultWorkerModel: 'claude-opus-4-6',
          defaultReviewerModel: 'claude-sonnet-4-5-20250929',
          defaultWorkerSystemPrompt: '',
          defaultReviewerSystemPrompt: '',
          historyLimit: 1,
        },
      });

      const oldLoops = [
        createTestRalphLoopState({ taskId: 'active-1', status: 'worker_running', projectId: 'test-project' }),
        createTestRalphLoopState({ taskId: 'paused-1', status: 'paused', projectId: 'test-project' }),
      ];
      mockRepository.findByProject.mockResolvedValue(oldLoops);
      mockRepository.delete.mockResolvedValue(true);

      const serviceWithSettings = new DefaultRalphLoopService({
        repository: mockRepository,
        projectRepository: mockProjectRepository,
        projectPathResolver: mockProjectPathResolver,
        contextInitializer: mockContextInitializer,
        workerAgentFactory: mockWorkerAgentFactory,
        reviewerAgentFactory: mockReviewerAgentFactory,
        settingsRepository: mockSettingsRepo,
      });

      const config = createTestRalphLoopConfig();
      await serviceWithSettings.start('test-project', config);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should NOT delete active or paused loops
      expect(mockRepository.delete).not.toHaveBeenCalledWith('test-project', 'active-1');
      expect(mockRepository.delete).not.toHaveBeenCalledWith('test-project', 'paused-1');

      const allLoops = await serviceWithSettings.listByProject('test-project');
      for (const loop of allLoops) {
        if (loop.status === 'worker_running' || loop.status === 'reviewer_running') {
          try { await serviceWithSettings.stop('test-project', loop.taskId); } catch { /* no-op */ }
        }
      }
    });
  });

  describe('worker and reviewer output events', () => {
    it('should emit output events from worker agent', async () => {
      const config = createTestRalphLoopConfig();
      const listener = jest.fn();

      // Create a worker that emits output
      mockWorkerAgentFactory.create.mockImplementation(() => {
        return new MockOutputWorkerAgent() as unknown as WorkerAgent;
      });

      service.on('output', listener);
      await service.start('test-project', config);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(listener).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        'worker',
        'Worker output line'
      );
    });

    it('should emit tool_use events from worker agent', async () => {
      const config = createTestRalphLoopConfig();
      const listener = jest.fn();

      mockWorkerAgentFactory.create.mockImplementation(() => {
        return new MockToolUseWorkerAgent() as unknown as WorkerAgent;
      });

      service.on('tool_use', listener);
      await service.start('test-project', config);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(listener).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        'worker',
        expect.objectContaining({ tool_name: 'Edit' })
      );
    });
  });

  describe('stop with active agents', () => {
    it('should stop worker agent when stopping loop during worker phase', async () => {
      const config = createTestRalphLoopConfig();
      const mockStop = jest.fn().mockResolvedValue(undefined);

      // Create a worker that takes longer
      mockWorkerAgentFactory.create.mockImplementation(() => {
        const agent = new MockSlowWorkerAgent() as unknown as WorkerAgent;
        (agent as any).stop = mockStop;
        return agent;
      });

      const state = await service.start('test-project', config);

      // Wait for worker to start
      await new Promise((resolve) => setTimeout(resolve, 20));

      await service.stop('test-project', state.taskId);

      expect(mockStop).toHaveBeenCalled();
    });
  });

  describe('updateStatus emits status_change', () => {
    it('should include iteration info in status_change events', async () => {
      const config = createTestRalphLoopConfig();
      const listener = jest.fn();

      service.on('status_change', listener);
      await service.start('test-project', config);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have emitted status_change with worker_running
      expect(listener).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        'worker_running',
        expect.any(Number),
        expect.any(Number)
      );
    });
  });
});

/**
 * Mock ReviewerAgent that always rejects
 */
class MockRejectReviewerAgent implements Pick<ReviewerAgent, 'run' | 'stop' | 'on' | 'off' | 'status'> {
  private emitter = new EventEmitter();
  private _status: ReviewerStatus = 'idle';

  get status(): ReviewerStatus {
    return this._status;
  }

  async run(state: RalphLoopState, _workerOutput: string): Promise<ReviewerFeedback> {
    this._status = 'running';

    return new Promise<ReviewerFeedback>((resolve) => {
      setTimeout(() => {
        const feedback: ReviewerFeedback = {
          iterationNumber: state.currentIteration,
          timestamp: new Date().toISOString(),
          decision: 'reject',
          feedback: 'Rejected',
          specificIssues: ['Critical issue'],
          suggestedImprovements: [],
        };
        this._status = 'completed';
        resolve(feedback);
      }, 5);
    });
  }

  stop(): Promise<void> {
    this._status = 'idle';
    return Promise.resolve();
  }

  on<K extends keyof ReviewerAgentEvents>(event: K, listener: ReviewerAgentEvents[K]): void {
    this.emitter.on(event, listener);
  }

  off<K extends keyof ReviewerAgentEvents>(event: K, listener: ReviewerAgentEvents[K]): void {
    this.emitter.off(event, listener);
  }
}

/**
 * Mock WorkerAgent that emits output events
 */
class MockOutputWorkerAgent implements Pick<WorkerAgent, 'run' | 'stop' | 'on' | 'off' | 'status'> {
  private emitter = new EventEmitter();
  private _status: WorkerStatus = 'idle';

  get status(): WorkerStatus {
    return this._status;
  }

  async run(state: RalphLoopState): Promise<IterationSummary> {
    this._status = 'running';

    return new Promise<IterationSummary>((resolve) => {
      setTimeout(() => {
        this.emitter.emit('output', 'Worker output line');

        const summary: IterationSummary = {
          iterationNumber: state.currentIteration,
          timestamp: new Date().toISOString(),
          workerOutput: 'Worker output line',
          filesModified: [],
          tokensUsed: 100,
          durationMs: 10,
        };
        this._status = 'completed';
        resolve(summary);
      }, 5);
    });
  }

  stop(): Promise<void> {
    this._status = 'idle';
    return Promise.resolve();
  }

  on<K extends keyof WorkerAgentEvents>(event: K, listener: WorkerAgentEvents[K]): void {
    this.emitter.on(event, listener);
  }

  off<K extends keyof WorkerAgentEvents>(event: K, listener: WorkerAgentEvents[K]): void {
    this.emitter.off(event, listener);
  }
}

/**
 * Mock WorkerAgent that emits tool_use events
 */
class MockToolUseWorkerAgent implements Pick<WorkerAgent, 'run' | 'stop' | 'on' | 'off' | 'status'> {
  private emitter = new EventEmitter();
  private _status: WorkerStatus = 'idle';

  get status(): WorkerStatus {
    return this._status;
  }

  async run(state: RalphLoopState): Promise<IterationSummary> {
    this._status = 'running';

    return new Promise<IterationSummary>((resolve) => {
      setTimeout(() => {
        this.emitter.emit('tool_use', {
          tool_name: 'Edit',
          tool_id: 'tool-1',
          parameters: { file: 'test.ts' },
          timestamp: new Date().toISOString(),
        });

        const summary: IterationSummary = {
          iterationNumber: state.currentIteration,
          timestamp: new Date().toISOString(),
          workerOutput: 'Used Edit tool',
          filesModified: ['test.ts'],
          tokensUsed: 150,
          durationMs: 20,
        };
        this._status = 'completed';
        resolve(summary);
      }, 5);
    });
  }

  stop(): Promise<void> {
    this._status = 'idle';
    return Promise.resolve();
  }

  on<K extends keyof WorkerAgentEvents>(event: K, listener: WorkerAgentEvents[K]): void {
    this.emitter.on(event, listener);
  }

  off<K extends keyof WorkerAgentEvents>(event: K, listener: WorkerAgentEvents[K]): void {
    this.emitter.off(event, listener);
  }
}

/**
 * Mock WorkerAgent that takes longer to run (for testing stop during execution)
 */
class MockSlowWorkerAgent implements Pick<WorkerAgent, 'run' | 'stop' | 'on' | 'off' | 'status'> {
  private emitter = new EventEmitter();
  private _status: WorkerStatus = 'idle';

  get status(): WorkerStatus {
    return this._status;
  }

  async run(state: RalphLoopState): Promise<IterationSummary> {
    this._status = 'running';

    return new Promise<IterationSummary>((resolve) => {
      setTimeout(() => {
        const summary: IterationSummary = {
          iterationNumber: state.currentIteration,
          timestamp: new Date().toISOString(),
          workerOutput: 'Slow worker output',
          filesModified: [],
          tokensUsed: 100,
          durationMs: 500,
        };
        this._status = 'completed';
        resolve(summary);
      }, 500);
    });
  }

  stop(): Promise<void> {
    this._status = 'idle';
    return Promise.resolve();
  }

  on<K extends keyof WorkerAgentEvents>(event: K, listener: WorkerAgentEvents[K]): void {
    this.emitter.on(event, listener);
  }

  off<K extends keyof WorkerAgentEvents>(event: K, listener: WorkerAgentEvents[K]): void {
    this.emitter.off(event, listener);
  }
}
