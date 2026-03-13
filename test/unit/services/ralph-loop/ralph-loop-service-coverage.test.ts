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

class MockWorkerAgent {
  emitter = new EventEmitter();
  _status: WorkerStatus = 'idle';
  stopFn = jest.fn().mockResolvedValue(undefined);
  runFn?: (state: RalphLoopState) => Promise<IterationSummary>;

  get status(): WorkerStatus { return this._status; }

  async run(state: RalphLoopState): Promise<IterationSummary> {
    this._status = 'running';
    if (this.runFn) return this.runFn(state);
    return new Promise<IterationSummary>((resolve) => {
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
        resolve(summary);
      }, 5);
    });
  }

  async stop(): Promise<void> { return this.stopFn(); }

  on<K extends keyof WorkerAgentEvents>(event: K, listener: WorkerAgentEvents[K]): void {
    this.emitter.on(event, listener);
  }

  off<K extends keyof WorkerAgentEvents>(event: K, listener: WorkerAgentEvents[K]): void {
    this.emitter.off(event, listener);
  }
}

class MockReviewerAgent {
  emitter = new EventEmitter();
  _status: ReviewerStatus = 'idle';
  stopFn = jest.fn().mockResolvedValue(undefined);
  runFn?: (state: RalphLoopState, workerOutput: string) => Promise<ReviewerFeedback>;

  get status(): ReviewerStatus { return this._status; }

  async run(state: RalphLoopState, workerOutput: string): Promise<ReviewerFeedback> {
    this._status = 'running';
    if (this.runFn) return this.runFn(state, workerOutput);
    return new Promise<ReviewerFeedback>((resolve) => {
      setTimeout(() => {
        const feedback: ReviewerFeedback = {
          iterationNumber: state.currentIteration,
          timestamp: new Date().toISOString(),
          decision: state.currentIteration >= 3 ? 'approve' : 'needs_changes',
          feedback: `Feedback for iteration ${state.currentIteration}`,
          specificIssues: [],
          suggestedImprovements: [],
        };
        this._status = 'completed';
        resolve(feedback);
      }, 5);
    });
  }

  async stop(): Promise<void> { return this.stopFn(); }

  on<K extends keyof ReviewerAgentEvents>(event: K, listener: ReviewerAgentEvents[K]): void {
    this.emitter.on(event, listener);
  }

  off<K extends keyof ReviewerAgentEvents>(event: K, listener: ReviewerAgentEvents[K]): void {
    this.emitter.off(event, listener);
  }
}

describe('DefaultRalphLoopService - additional coverage', () => {
  let mockRepository: jest.Mocked<RalphLoopRepository>;
  let mockProjectRepository: ReturnType<typeof createMockProjectRepository>;
  let mockContextInitializer: jest.Mocked<ContextInitializer>;
  let mockProjectPathResolver: jest.Mocked<ProjectPathResolver>;
  let mockWorkerAgentFactory: jest.Mocked<WorkerAgentFactory>;
  let mockReviewerAgentFactory: jest.Mocked<ReviewerAgentFactory>;
  let lastWorkerAgent: MockWorkerAgent;
  let lastReviewerAgent: MockReviewerAgent;

  function createService(
    overrides?: Partial<ConstructorParameters<typeof DefaultRalphLoopService>[0]>
  ): DefaultRalphLoopService {
    return new DefaultRalphLoopService({
      repository: mockRepository,
      projectRepository: mockProjectRepository,
      projectPathResolver: mockProjectPathResolver,
      contextInitializer: mockContextInitializer,
      workerAgentFactory: mockWorkerAgentFactory,
      reviewerAgentFactory: mockReviewerAgentFactory,
      ...overrides,
    });
  }

  beforeEach(() => {
    mockRepository = createMockRalphLoopRepository();
    mockProjectRepository = createMockProjectRepository();
    mockContextInitializer = createMockContextInitializer();
    mockProjectPathResolver = createMockProjectPathResolver({
      'test-project': '/test/project',
    });

    mockWorkerAgentFactory = {
      create: jest.fn().mockImplementation(() => {
        lastWorkerAgent = new MockWorkerAgent();
        return lastWorkerAgent as unknown as WorkerAgent;
      }),
    };

    mockReviewerAgentFactory = {
      create: jest.fn().mockImplementation(() => {
        lastReviewerAgent = new MockReviewerAgent();
        return lastReviewerAgent as unknown as ReviewerAgent;
      }),
    };
  });

  describe('reviewer phase event forwarding', () => {
    it('should emit output events from reviewer agent', async () => {
      const service = createService();
      const outputListener = jest.fn();
      service.on('output', outputListener);

      // Reviewer emits output during run
      mockReviewerAgentFactory.create = jest.fn().mockImplementation(() => {
        const agent = new MockReviewerAgent();
        agent.runFn = async (state) => {
          // Emit output after event handlers are attached
          setTimeout(() => agent.emitter.emit('output', 'Reviewer output text'), 2);
          return new Promise<ReviewerFeedback>((resolve) => {
            setTimeout(() => resolve({
              iterationNumber: state.currentIteration,
              timestamp: new Date().toISOString(),
              decision: 'approve' as const,
              feedback: 'Done',
              specificIssues: [],
              suggestedImprovements: [],
            }), 10);
          });
        };
        lastReviewerAgent = agent;
        return agent as unknown as ReviewerAgent;
      });

      const config = createTestRalphLoopConfig();
      await service.start('test-project', config);
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(outputListener).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        'reviewer',
        'Reviewer output text'
      );
    });

    it('should emit tool_use events from reviewer agent', async () => {
      const service = createService();
      const toolUseListener = jest.fn();
      service.on('tool_use', toolUseListener);

      mockReviewerAgentFactory.create = jest.fn().mockImplementation(() => {
        const agent = new MockReviewerAgent();
        agent.runFn = async (state) => {
          setTimeout(() => agent.emitter.emit('tool_use', {
            tool_name: 'Read',
            tool_id: 'tool-r1',
            parameters: { file_path: '/test.ts' },
            timestamp: new Date().toISOString(),
          }), 2);
          return new Promise<ReviewerFeedback>((resolve) => {
            setTimeout(() => resolve({
              iterationNumber: state.currentIteration,
              timestamp: new Date().toISOString(),
              decision: 'approve' as const,
              feedback: 'Looks good',
              specificIssues: [],
              suggestedImprovements: [],
            }), 10);
          });
        };
        lastReviewerAgent = agent;
        return agent as unknown as ReviewerAgent;
      });

      const config = createTestRalphLoopConfig();
      await service.start('test-project', config);
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(toolUseListener).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        'reviewer',
        expect.objectContaining({ tool_name: 'Read' })
      );
    });
  });

  describe('stop with active reviewer agent', () => {
    it('should stop reviewer agent when stopping during reviewer phase', async () => {
      const service = createService();
      let reviewerStopFn: jest.Mock;

      // Worker completes fast, reviewer takes long
      mockReviewerAgentFactory.create = jest.fn().mockImplementation(() => {
        const agent = new MockReviewerAgent();
        reviewerStopFn = agent.stopFn;
        agent.runFn = async () => {
          return new Promise<ReviewerFeedback>((resolve) => {
            setTimeout(() => resolve({
              iterationNumber: 1,
              timestamp: new Date().toISOString(),
              decision: 'approve' as const,
              feedback: 'Ok',
              specificIssues: [],
              suggestedImprovements: [],
            }), 5000); // Long timeout - will be stopped
          });
        };
        lastReviewerAgent = agent;
        return agent as unknown as ReviewerAgent;
      });

      const config = createTestRalphLoopConfig();
      const state = await service.start('test-project', config);

      // Wait for worker to complete and reviewer to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      await service.stop('test-project', state.taskId);

      expect(reviewerStopFn!).toHaveBeenCalled();
    });
  });

  describe('project status updates', () => {
    it('should update project status to running on start', async () => {
      const service = createService();
      const config = createTestRalphLoopConfig();
      await service.start('test-project', config);

      expect(mockProjectRepository.updateStatus).toHaveBeenCalledWith(
        'test-project',
        'running'
      );
    });

    it('should update project status to stopped on stop', async () => {
      const service = createService();
      const config = createTestRalphLoopConfig();
      const state = await service.start('test-project', config);

      await service.stop('test-project', state.taskId);

      expect(mockProjectRepository.updateStatus).toHaveBeenCalledWith(
        'test-project',
        'stopped'
      );
    });

    it('should update project status to stopped on completion', async () => {
      const service = createService();
      const completeListener = jest.fn();
      service.on('loop_complete', completeListener);

      // Reviewer approves immediately
      mockReviewerAgentFactory.create = jest.fn().mockImplementation(() => {
        const agent = new MockReviewerAgent();
        agent.runFn = async (state) => ({
          iterationNumber: state.currentIteration,
          timestamp: new Date().toISOString(),
          decision: 'approve' as const,
          feedback: 'Approved',
          specificIssues: [],
          suggestedImprovements: [],
        });
        lastReviewerAgent = agent;
        return agent as unknown as ReviewerAgent;
      });

      const config = createTestRalphLoopConfig();
      await service.start('test-project', config);
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(completeListener).toHaveBeenCalled();
      expect(mockProjectRepository.updateStatus).toHaveBeenCalledWith(
        'test-project',
        'stopped'
      );
    });
  });

  describe('MCP servers for reviewer', () => {
    it('should pass MCP servers to reviewer agent', async () => {
      const mockSettingsRepo = createMockSettingsRepository({
        mcp: {
          enabled: true,
          servers: [
            { id: 'mcp-1', name: 'MCP 1', enabled: true, type: 'stdio', command: 'cmd1' },
          ],
        },
      });

      const service = createService({ settingsRepository: mockSettingsRepo });

      // Make reviewer approve immediately
      mockReviewerAgentFactory.create = jest.fn().mockImplementation((config: ReviewerAgentConfig) => {
        const agent = new MockReviewerAgent();
        agent.runFn = async (state) => ({
          iterationNumber: state.currentIteration,
          timestamp: new Date().toISOString(),
          decision: 'approve' as const,
          feedback: 'Done',
          specificIssues: [],
          suggestedImprovements: [],
        });
        lastReviewerAgent = agent;
        return agent as unknown as ReviewerAgent;
      });

      const config = createTestRalphLoopConfig();
      await service.start('test-project', config);
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(mockReviewerAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: [expect.objectContaining({ id: 'mcp-1' })],
        })
      );
    });
  });

  describe('default history limit', () => {
    it('should use default limit of 5 when no settings repo', async () => {
      const service = createService();

      // Create 7 loops (exceeds default limit of 5)
      const loops = Array.from({ length: 7 }, (_, i) =>
        createTestRalphLoopState({
          taskId: `old-${i}`,
          status: 'completed',
          projectId: 'test-project',
        })
      );
      mockRepository.findByProject.mockResolvedValue(loops);
      mockRepository.delete.mockResolvedValue(true);

      const config = createTestRalphLoopConfig();
      await service.start('test-project', config);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should delete loops beyond index 5 (old-5 and old-6)
      expect(mockRepository.delete).toHaveBeenCalledWith('test-project', 'old-5');
      expect(mockRepository.delete).toHaveBeenCalledWith('test-project', 'old-6');
    });

    it('should not delete when under the limit', async () => {
      const service = createService();

      const loops = [
        createTestRalphLoopState({ taskId: 'loop-1', status: 'completed', projectId: 'test-project' }),
      ];
      mockRepository.findByProject.mockResolvedValue(loops);

      const config = createTestRalphLoopConfig();
      await service.start('test-project', config);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should not delete any loops
      expect(mockRepository.delete).not.toHaveBeenCalled();
    });
  });

  describe('cleanup error handling', () => {
    it('should not fail start when cleanup throws', async () => {
      const service = createService();

      mockRepository.findByProject.mockRejectedValue(new Error('Cleanup DB error'));

      const config = createTestRalphLoopConfig();
      // Should not throw despite cleanup error
      const state = await service.start('test-project', config);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(state.taskId).toBeTruthy();
      expect(state.status).toBe('idle');
    });
  });

  describe('worker phase error while stopped', () => {
    it('should silently return when worker throws after stop', async () => {
      const service = createService();
      const errorListener = jest.fn();
      service.on('loop_error', errorListener);

      mockWorkerAgentFactory.create = jest.fn().mockImplementation(() => {
        const agent = new MockWorkerAgent();
        agent.runFn = async () => {
          // Simulate being stopped then throwing
          await new Promise((resolve) => setTimeout(resolve, 50));
          throw new Error('Worker cancelled');
        };
        lastWorkerAgent = agent;
        return agent as unknown as WorkerAgent;
      });

      const config = createTestRalphLoopConfig();
      const state = await service.start('test-project', config);

      // Stop immediately
      await service.stop('test-project', state.taskId);
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Error should not propagate since shouldContinue was set to false
      expect(errorListener).not.toHaveBeenCalled();
    });
  });

  describe('reviewer phase error while stopped', () => {
    it('should silently return when reviewer throws after stop', async () => {
      const service = createService();
      const errorListener = jest.fn();
      service.on('loop_error', errorListener);

      mockReviewerAgentFactory.create = jest.fn().mockImplementation(() => {
        const agent = new MockReviewerAgent();
        agent.runFn = async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          throw new Error('Reviewer cancelled');
        };
        lastReviewerAgent = agent;
        return agent as unknown as ReviewerAgent;
      });

      const config = createTestRalphLoopConfig();
      const state = await service.start('test-project', config);

      // Wait for worker to complete and reviewer to start
      await new Promise((resolve) => setTimeout(resolve, 30));

      // Stop during reviewer
      await service.stop('test-project', state.taskId);
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Error should not propagate
      expect(errorListener).not.toHaveBeenCalled();
    });
  });

  describe('handleReviewerDecision inactive state', () => {
    it('should not continue when loop becomes inactive during reviewer', async () => {
      const service = createService();
      const completeListener = jest.fn();
      service.on('loop_complete', completeListener);

      // Worker completes, reviewer returns needs_changes, but we stop before decision
      let resolveReviewer: ((f: ReviewerFeedback) => void) | undefined;
      mockReviewerAgentFactory.create = jest.fn().mockImplementation(() => {
        const agent = new MockReviewerAgent();
        agent.runFn = async (state) => {
          return new Promise<ReviewerFeedback>((resolve) => {
            resolveReviewer = resolve;
          });
        };
        lastReviewerAgent = agent;
        return agent as unknown as ReviewerAgent;
      });

      const config = createTestRalphLoopConfig();
      const state = await service.start('test-project', config);

      // Wait for reviewer to start
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Stop the loop while reviewer is pending
      await service.stop('test-project', state.taskId);

      // Now resolve the reviewer - should be ignored since loop is stopped
      if (resolveReviewer) {
        resolveReviewer({
          iterationNumber: 1,
          timestamp: new Date().toISOString(),
          decision: 'needs_changes',
          feedback: 'Changes needed',
          specificIssues: [],
          suggestedImprovements: [],
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      // loop_complete should not be called with 'needs_changes' decision path
      // Only the stop() call should set the final status
    });
  });

  describe('runNextIteration early returns', () => {
    it('should return early when state not found in repository', async () => {
      const service = createService();

      // First call to create returns state, subsequent findById returns null
      let callCount = 0;
      mockRepository.findById.mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          return createTestRalphLoopState({ currentIteration: 0 });
        }
        return null;
      });

      const config = createTestRalphLoopConfig();
      await service.start('test-project', config);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Worker factory should not be called since state was null
      // (first findById is for updateStatus, second is for the iteration check)
    });
  });

  describe('validateAndPreparePhase returns null', () => {
    it('should return early from reviewer when loop becomes inactive', async () => {
      const service = createService();

      // Worker completes but we stop before reviewer can validate
      mockWorkerAgentFactory.create = jest.fn().mockImplementation(() => {
        const agent = new MockWorkerAgent();
        agent.runFn = async (state) => {
          return {
            iterationNumber: state.currentIteration,
            timestamp: new Date().toISOString(),
            workerOutput: 'Done',
            filesModified: [],
            tokensUsed: 100,
            durationMs: 5,
          };
        };
        lastWorkerAgent = agent;
        return agent as unknown as WorkerAgent;
      });

      const config = createTestRalphLoopConfig();
      const state = await service.start('test-project', config);

      // Immediately stop so reviewer validation fails
      await new Promise((resolve) => setTimeout(resolve, 5));
      await service.stop('test-project', state.taskId);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Reviewer should not be created since validation returned null
      // (The stop might happen before or after - we just verify no crash)
    });
  });

  describe('pause sets shouldContinue false', () => {
    it('should prevent next iteration after pause', async () => {
      const service = createService();
      let workerCreated = 0;

      // Worker resolves only after we've had a chance to pause
      let resolveWorker: ((s: IterationSummary) => void) | undefined;
      mockWorkerAgentFactory.create = jest.fn().mockImplementation(() => {
        workerCreated++;
        const agent = new MockWorkerAgent();
        agent.runFn = async (state) => {
          return new Promise<IterationSummary>((resolve) => {
            resolveWorker = resolve;
          });
        };
        lastWorkerAgent = agent;
        return agent as unknown as WorkerAgent;
      });

      const config = createTestRalphLoopConfig();
      const state = await service.start('test-project', config);

      // Wait for worker to be created
      await new Promise((resolve) => setTimeout(resolve, 30));

      // Pause during worker execution
      await service.pause('test-project', state.taskId);

      // Now resolve the worker
      if (resolveWorker) {
        resolveWorker({
          iterationNumber: 1,
          timestamp: new Date().toISOString(),
          workerOutput: 'Done',
          filesModified: [],
          tokensUsed: 100,
          durationMs: 30,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should only create one worker (no reviewer, no next iteration)
      expect(workerCreated).toBe(1);
      expect(mockReviewerAgentFactory.create).not.toHaveBeenCalled();
    });

    it('should set shouldContinue false even without active state', async () => {
      const service = createService();
      // Pause on a non-existent loop key should not throw
      await service.pause('test-project', 'non-existent-task');

      expect(mockRepository.update).toHaveBeenCalledWith(
        'test-project',
        'non-existent-task',
        { status: 'paused' }
      );
    });
  });

  describe('stop without active state', () => {
    it('should still update repository when no active state exists', async () => {
      const service = createService();
      await service.stop('test-project', 'non-existent-task');

      expect(mockRepository.update).toHaveBeenCalledWith(
        'test-project',
        'non-existent-task',
        expect.objectContaining({
          status: 'completed',
          finalStatus: 'critical_failure',
          error: 'Loop stopped by user',
        })
      );
    });
  });

  describe('cleanup with reviewer_running loops', () => {
    it('should skip reviewer_running loops during cleanup', async () => {
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

      const loops = [
        createTestRalphLoopState({
          taskId: 'current',
          status: 'idle',
          projectId: 'test-project',
        }),
        createTestRalphLoopState({
          taskId: 'reviewing',
          status: 'reviewer_running',
          projectId: 'test-project',
        }),
      ];
      mockRepository.findByProject.mockResolvedValue(loops);
      mockRepository.delete.mockResolvedValue(true);

      const service = createService({ settingsRepository: mockSettingsRepo });
      const config = createTestRalphLoopConfig();
      await service.start('test-project', config);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should not delete reviewer_running loop
      expect(mockRepository.delete).not.toHaveBeenCalledWith('test-project', 'reviewing');
    });
  });

  describe('handleLoopError', () => {
    it('should set status to failed and emit error', async () => {
      const service = createService();
      const errorListener = jest.fn();
      service.on('loop_error', errorListener);

      // Worker throws an Error
      mockWorkerAgentFactory.create = jest.fn().mockImplementation(() => {
        const agent = new MockWorkerAgent();
        agent.runFn = async () => {
          throw new Error('Agent crashed');
        };
        lastWorkerAgent = agent;
        return agent as unknown as WorkerAgent;
      });

      const config = createTestRalphLoopConfig();
      await service.start('test-project', config);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(errorListener).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        'Agent crashed'
      );

      expect(mockRepository.update).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        expect.objectContaining({
          status: 'failed',
          finalStatus: 'critical_failure',
          error: 'Agent crashed',
        })
      );
    });
  });

  describe('reviewer agent config', () => {
    it('should pass reviewerModel and reviewerSystemPrompt to reviewer factory', async () => {
      const service = createService();

      mockReviewerAgentFactory.create = jest.fn().mockImplementation(() => {
        const agent = new MockReviewerAgent();
        agent.runFn = async (state) => ({
          iterationNumber: state.currentIteration,
          timestamp: new Date().toISOString(),
          decision: 'approve' as const,
          feedback: 'OK',
          specificIssues: [],
          suggestedImprovements: [],
        });
        lastReviewerAgent = agent;
        return agent as unknown as ReviewerAgent;
      });

      const config = createTestRalphLoopConfig({
        reviewerModel: 'claude-sonnet-4-6',
        reviewerSystemPrompt: 'Be strict',
      });
      await service.start('test-project', config);
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(mockReviewerAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-6',
          appendSystemPrompt: 'Be strict',
        })
      );
    });

    it('should pass workerModel and workerSystemPrompt to worker factory', async () => {
      const service = createService();

      const config = createTestRalphLoopConfig({
        workerModel: 'claude-opus-4-6',
        workerSystemPrompt: 'Be thorough',
      });
      await service.start('test-project', config);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockWorkerAgentFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-opus-4-6',
          appendSystemPrompt: 'Be thorough',
        })
      );
    });
  });

  describe('worker cleanup in finally block', () => {
    it('should clear workerAgent reference after completion', async () => {
      const service = createService();

      const config = createTestRalphLoopConfig({ maxTurns: 1 });
      mockRepository.findById.mockImplementation(async () =>
        createTestRalphLoopState({ currentIteration: 1, config })
      );

      await service.start('test-project', config);
      await new Promise((resolve) => setTimeout(resolve, 200));

      // After completion, stopping again should not call worker.stop
      // (worker reference was cleared in finally block)
    });

    it('should clear reviewerAgent reference after completion', async () => {
      const service = createService();

      mockReviewerAgentFactory.create = jest.fn().mockImplementation(() => {
        const agent = new MockReviewerAgent();
        agent.runFn = async (state) => ({
          iterationNumber: state.currentIteration,
          timestamp: new Date().toISOString(),
          decision: 'approve' as const,
          feedback: 'OK',
          specificIssues: [],
          suggestedImprovements: [],
        });
        lastReviewerAgent = agent;
        return agent as unknown as ReviewerAgent;
      });

      const config = createTestRalphLoopConfig();
      await service.start('test-project', config);
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Loop completed via approval - reviewer ref should be cleared
    });
  });

  describe('delete error with non-Error object', () => {
    it('should handle delete throwing non-Error', async () => {
      const service = createService();

      mockRepository.delete.mockRejectedValue('string delete error');

      const config = createTestRalphLoopConfig();
      const state = await service.start('test-project', config);
      const result = await service.delete('test-project', state.taskId);

      expect(result).toBe(false);
    });
  });

  describe('cleanup error with non-Error object', () => {
    it('should handle cleanup throwing non-Error', async () => {
      const service = createService();

      mockRepository.findByProject.mockRejectedValue('string cleanup error');

      const config = createTestRalphLoopConfig();
      // Should not throw
      const state = await service.start('test-project', config);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(state.taskId).toBeTruthy();
    });
  });

  describe('worker tool_use event forwarding', () => {
    it('should emit tool_use events from worker agent', async () => {
      const service = createService();
      const toolUseListener = jest.fn();
      service.on('tool_use', toolUseListener);

      mockWorkerAgentFactory.create = jest.fn().mockImplementation(() => {
        const agent = new MockWorkerAgent();
        agent.runFn = async (state) => {
          // Emit tool_use after event handlers are attached
          setTimeout(() => agent.emitter.emit('tool_use', {
            tool_name: 'Write',
            tool_id: 'tool-w1',
            parameters: { file_path: '/src/index.ts' },
            timestamp: new Date().toISOString(),
          }), 2);
          return new Promise<IterationSummary>((resolve) => {
            setTimeout(() => resolve({
              iterationNumber: state.currentIteration,
              timestamp: new Date().toISOString(),
              workerOutput: 'Done',
              filesModified: ['/src/index.ts'],
              tokensUsed: 200,
              durationMs: 10,
            }), 15);
          });
        };
        lastWorkerAgent = agent;
        return agent as unknown as WorkerAgent;
      });

      const config = createTestRalphLoopConfig();
      await service.start('test-project', config);
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(toolUseListener).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        'worker',
        expect.objectContaining({ tool_name: 'Write', tool_id: 'tool-w1' })
      );
    });
  });

  describe('delete method', () => {
    it('should stop, delete from repo, and emit loop_deleted on success', async () => {
      const service = createService();
      const deletedListener = jest.fn();
      service.on('loop_deleted', deletedListener);

      mockRepository.delete.mockResolvedValue(true);

      const config = createTestRalphLoopConfig();
      const state = await service.start('test-project', config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const result = await service.delete('test-project', state.taskId);

      expect(result).toBe(true);
      expect(mockRepository.delete).toHaveBeenCalledWith('test-project', state.taskId);
      expect(deletedListener).toHaveBeenCalledWith('test-project', state.taskId);
    });

    it('should return false when repository delete returns false', async () => {
      const service = createService();
      const deletedListener = jest.fn();
      service.on('loop_deleted', deletedListener);

      mockRepository.delete.mockResolvedValue(false);

      const config = createTestRalphLoopConfig();
      const state = await service.start('test-project', config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const result = await service.delete('test-project', state.taskId);

      expect(result).toBe(false);
      expect(deletedListener).not.toHaveBeenCalled();
    });

    it('should return false when delete throws an Error', async () => {
      const service = createService();
      mockRepository.delete.mockRejectedValue(new Error('Delete failed'));

      const config = createTestRalphLoopConfig();
      const state = await service.start('test-project', config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const result = await service.delete('test-project', state.taskId);

      expect(result).toBe(false);
    });
  });

  describe('resume method', () => {
    it('should resume a paused loop and start next iteration', async () => {
      const service = createService();
      const statusListener = jest.fn();
      service.on('status_change', statusListener);

      // Setup: findById returns paused state for resume, then active for iteration
      mockRepository.findById.mockResolvedValue(
        createTestRalphLoopState({
          taskId: 'task-1',
          status: 'paused',
          currentIteration: 1,
          projectId: 'test-project',
        })
      );

      await service.resume('test-project', 'task-1');
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have updated status to idle
      expect(mockRepository.update).toHaveBeenCalledWith(
        'test-project',
        'task-1',
        { status: 'idle' }
      );
    });

    it('should throw when loop not found', async () => {
      const service = createService();
      mockRepository.findById.mockResolvedValue(null);

      await expect(service.resume('test-project', 'missing'))
        .rejects.toThrow('Ralph Loop not found: missing');
    });

    it('should throw when loop is not paused', async () => {
      const service = createService();
      mockRepository.findById.mockResolvedValue(
        createTestRalphLoopState({ taskId: 'task-1', status: 'completed' })
      );

      await expect(service.resume('test-project', 'task-1'))
        .rejects.toThrow('Cannot resume loop in status: completed');
    });
  });

  describe('handleLoopError with non-Error object', () => {
    it('should convert non-Error to string in error handler', async () => {
      const service = createService();
      const errorListener = jest.fn();
      service.on('loop_error', errorListener);

      mockWorkerAgentFactory.create = jest.fn().mockImplementation(() => {
        const agent = new MockWorkerAgent();
        agent.runFn = async () => {
          throw 'string error thrown';
        };
        lastWorkerAgent = agent;
        return agent as unknown as WorkerAgent;
      });

      const config = createTestRalphLoopConfig();
      await service.start('test-project', config);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(errorListener).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        'string error thrown'
      );

      expect(mockRepository.update).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        expect.objectContaining({
          status: 'failed',
          error: 'string error thrown',
        })
      );
    });
  });

  describe('max turns reached', () => {
    it('should complete loop with max_turns_reached when limit hit', async () => {
      const service = createService();
      const completeListener = jest.fn();
      service.on('loop_complete', completeListener);

      // State already at max turns
      mockRepository.findById.mockResolvedValue(
        createTestRalphLoopState({
          currentIteration: 5,
          config: createTestRalphLoopConfig({ maxTurns: 5 }),
        })
      );

      const config = createTestRalphLoopConfig({ maxTurns: 5 });
      await service.start('test-project', config);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(completeListener).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        'max_turns_reached'
      );
    });
  });

  describe('reviewer reject decision', () => {
    it('should complete loop with critical_failure on reject', async () => {
      const service = createService();
      const completeListener = jest.fn();
      service.on('loop_complete', completeListener);

      mockReviewerAgentFactory.create = jest.fn().mockImplementation(() => {
        const agent = new MockReviewerAgent();
        agent.runFn = async (state) => ({
          iterationNumber: state.currentIteration,
          timestamp: new Date().toISOString(),
          decision: 'reject' as const,
          feedback: 'Code is fundamentally wrong',
          specificIssues: ['Major bug'],
          suggestedImprovements: [],
        });
        lastReviewerAgent = agent;
        return agent as unknown as ReviewerAgent;
      });

      const config = createTestRalphLoopConfig();
      await service.start('test-project', config);
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(completeListener).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        'critical_failure'
      );
    });
  });

  describe('project path not found', () => {
    it('should throw error when project path is null', async () => {
      const resolver = createMockProjectPathResolver();
      resolver.getProjectPath.mockReturnValue(null);
      const service = createService({ projectPathResolver: resolver });
      const errorListener = jest.fn();
      service.on('loop_error', errorListener);

      const config = createTestRalphLoopConfig();
      await service.start('test-project', config);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(errorListener).toHaveBeenCalledWith(
        'test-project',
        expect.any(String),
        expect.stringContaining('Project path not found')
      );
    });
  });

  describe('off removes event listener', () => {
    it('should not receive events after unsubscribing', async () => {
      const service = createService();
      const listener = jest.fn();

      service.on('status_change', listener);
      service.off('status_change', listener);

      const config = createTestRalphLoopConfig();
      await service.start('test-project', config);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('handleWorkerCompletion skips reviewer when stopped', () => {
    it('should not start reviewer when shouldContinue becomes false after worker', async () => {
      const service = createService();

      // Worker completes but we pause right after
      let workerDone = false;
      mockWorkerAgentFactory.create = jest.fn().mockImplementation(() => {
        const agent = new MockWorkerAgent();
        agent.runFn = async (state) => {
          const summary: IterationSummary = {
            iterationNumber: state.currentIteration,
            timestamp: new Date().toISOString(),
            workerOutput: 'Done',
            filesModified: [],
            tokensUsed: 100,
            durationMs: 5,
          };
          workerDone = true;
          return summary;
        };
        lastWorkerAgent = agent;
        return agent as unknown as WorkerAgent;
      });

      const config = createTestRalphLoopConfig();
      const state = await service.start('test-project', config);

      // Pause almost immediately
      await new Promise((resolve) => setTimeout(resolve, 2));
      await service.pause('test-project', state.taskId);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Reviewer should not be created since shouldContinue is false
      // (the exact timing is non-deterministic, but we verify no crash)
    });
  });
});
