import {
  FileRalphLoopRepository,
  FileRalphLoopRepositoryConfig,
  generateTaskId,
} from '../../../src/repositories/ralph-loop';
import {
  createMockRalphLoopFileSystem,
  createMockProjectPathResolver,
  createTestRalphLoopConfig,
  createTestIterationSummary,
  createTestReviewerFeedback,
} from '../helpers/mock-factories';
import { RalphLoopState } from '../../../src/services/ralph-loop/types';

describe('FileRalphLoopRepository', () => {
  let repository: FileRalphLoopRepository;
  let mockFileSystem: ReturnType<typeof createMockRalphLoopFileSystem>;
  let mockPathResolver: ReturnType<typeof createMockProjectPathResolver>;

  beforeEach(() => {
    mockFileSystem = createMockRalphLoopFileSystem();
    mockPathResolver = createMockProjectPathResolver({
      'test-project': '/test/path',
      'project-2': '/test/path2',
    });

    const config: FileRalphLoopRepositoryConfig = {
      projectPathResolver: mockPathResolver,
      fileSystem: mockFileSystem,
    };

    repository = new FileRalphLoopRepository(config);
  });

  describe('generateTaskId', () => {
    it('should generate valid UUID v4', () => {
      const id = generateTaskId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();

      for (let i = 0; i < 100; i++) {
        ids.add(generateTaskId());
      }

      expect(ids.size).toBe(100);
    });
  });

  describe('create', () => {
    it('should create state with timestamps', async () => {
      const config = createTestRalphLoopConfig();
      const initialState: Omit<RalphLoopState, 'createdAt' | 'updatedAt'> = {
        taskId: 'task-123',
        projectId: 'test-project',
        config,
        currentIteration: 0,
        status: 'idle',
        summaries: [],
        feedback: [],
      };

      const state = await repository.create(initialState);

      expect(state.taskId).toBe('task-123');
      expect(state.projectId).toBe('test-project');
      expect(state.createdAt).toBeTruthy();
      expect(state.updatedAt).toBeTruthy();
    });

    it('should create directories for state storage', async () => {
      const config = createTestRalphLoopConfig();
      const initialState: Omit<RalphLoopState, 'createdAt' | 'updatedAt'> = {
        taskId: 'task-123',
        projectId: 'test-project',
        config,
        currentIteration: 0,
        status: 'idle',
        summaries: [],
        feedback: [],
      };

      await repository.create(initialState);

      expect(mockFileSystem.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('.claudito')
      );
      expect(mockFileSystem.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('summaries')
      );
      expect(mockFileSystem.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('feedback')
      );
    });

    it('should write state to disk', async () => {
      const config = createTestRalphLoopConfig();
      const initialState: Omit<RalphLoopState, 'createdAt' | 'updatedAt'> = {
        taskId: 'task-123',
        projectId: 'test-project',
        config,
        currentIteration: 0,
        status: 'idle',
        summaries: [],
        feedback: [],
      };

      await repository.create(initialState);

      expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('state.json'),
        expect.any(String)
      );
    });

    it('should throw if project path not found', async () => {
      const config = createTestRalphLoopConfig();
      const initialState: Omit<RalphLoopState, 'createdAt' | 'updatedAt'> = {
        taskId: 'task-123',
        projectId: 'unknown-project',
        config,
        currentIteration: 0,
        status: 'idle',
        summaries: [],
        feedback: [],
      };

      await expect(repository.create(initialState)).rejects.toThrow(
        'Project not found: unknown-project'
      );
    });
  });

  describe('findById', () => {
    it('should return null for non-existent state', async () => {
      const state = await repository.findById('test-project', 'non-existent');
      expect(state).toBeNull();
    });

    it('should return state from cache if available', async () => {
      const config = createTestRalphLoopConfig();
      const initialState: Omit<RalphLoopState, 'createdAt' | 'updatedAt'> = {
        taskId: 'task-123',
        projectId: 'test-project',
        config,
        currentIteration: 0,
        status: 'idle',
        summaries: [],
        feedback: [],
      };

      await repository.create(initialState);
      mockFileSystem.readFile.mockClear();

      const state = await repository.findById('test-project', 'task-123');

      expect(state).toBeTruthy();
      expect(state!.taskId).toBe('task-123');
      expect(mockFileSystem.readFile).not.toHaveBeenCalled();
    });

    it('should load from disk if not in cache', async () => {
      const storedState: RalphLoopState = {
        taskId: 'task-456',
        projectId: 'test-project',
        config: createTestRalphLoopConfig(),
        currentIteration: 2,
        status: 'worker_running',
        summaries: [],
        feedback: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockFileSystem.exists.mockResolvedValue(true);
      mockFileSystem.readFile.mockResolvedValue(JSON.stringify(storedState));

      // Create new repository to have empty cache
      const newRepository = new FileRalphLoopRepository({
        projectPathResolver: mockPathResolver,
        fileSystem: mockFileSystem,
      });

      const state = await newRepository.findById('test-project', 'task-456');

      expect(state).toBeTruthy();
      expect(state!.taskId).toBe('task-456');
      expect(state!.currentIteration).toBe(2);
    });
  });

  describe('findByProject', () => {
    it('should return empty array for project with no loops', async () => {
      mockFileSystem.exists.mockResolvedValue(false);

      const states = await repository.findByProject('test-project');

      expect(states).toEqual([]);
    });

    it('should return all loops for a project', async () => {
      const config = createTestRalphLoopConfig();

      await repository.create({
        taskId: 'task-1',
        projectId: 'test-project',
        config,
        currentIteration: 0,
        status: 'idle',
        summaries: [],
        feedback: [],
      });

      await repository.create({
        taskId: 'task-2',
        projectId: 'test-project',
        config,
        currentIteration: 0,
        status: 'idle',
        summaries: [],
        feedback: [],
      });

      // Mock directory existence and listing
      mockFileSystem.exists.mockResolvedValue(true);
      mockFileSystem.readdir.mockResolvedValue(['task-1', 'task-2']);

      const states = await repository.findByProject('test-project');

      expect(states.length).toBe(2);
    });

    it('should skip .tmp files in directory listing', async () => {
      const config = createTestRalphLoopConfig();

      await repository.create({
        taskId: 'task-1',
        projectId: 'test-project',
        config,
        currentIteration: 0,
        status: 'idle',
        summaries: [],
        feedback: [],
      });

      // Mock directory existence and listing
      mockFileSystem.exists.mockResolvedValue(true);
      mockFileSystem.readdir.mockResolvedValue(['task-1', 'task-1.tmp']);

      const states = await repository.findByProject('test-project');

      expect(states.length).toBe(1);
      expect(states[0]!.taskId).toBe('task-1');
    });
  });

  describe('update', () => {
    it('should update state and save to disk', async () => {
      const config = createTestRalphLoopConfig();

      await repository.create({
        taskId: 'task-123',
        projectId: 'test-project',
        config,
        currentIteration: 0,
        status: 'idle',
        summaries: [],
        feedback: [],
      });

      mockFileSystem.writeFile.mockClear();

      const updated = await repository.update('test-project', 'task-123', {
        status: 'worker_running',
        currentIteration: 1,
      });

      expect(updated).toBeTruthy();
      expect(updated!.status).toBe('worker_running');
      expect(updated!.currentIteration).toBe(1);
      expect(mockFileSystem.writeFile).toHaveBeenCalled();
    });

    it('should return null for non-existent state', async () => {
      const updated = await repository.update('test-project', 'non-existent', {
        status: 'worker_running',
      });

      expect(updated).toBeNull();
    });

    it('should preserve immutable fields', async () => {
      const config = createTestRalphLoopConfig();

      const original = await repository.create({
        taskId: 'task-123',
        projectId: 'test-project',
        config,
        currentIteration: 0,
        status: 'idle',
        summaries: [],
        feedback: [],
      });

      const updated = await repository.update('test-project', 'task-123', {
        taskId: 'different-id' as string,
        projectId: 'different-project' as string,
        createdAt: '2000-01-01T00:00:00.000Z',
      } as Partial<RalphLoopState>);

      expect(updated!.taskId).toBe('task-123');
      expect(updated!.projectId).toBe('test-project');
      expect(updated!.createdAt).toBe(original.createdAt);
    });

    it('should update updatedAt timestamp', async () => {
      const config = createTestRalphLoopConfig();

      const original = await repository.create({
        taskId: 'task-123',
        projectId: 'test-project',
        config,
        currentIteration: 0,
        status: 'idle',
        summaries: [],
        feedback: [],
      });

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = await repository.update('test-project', 'task-123', {
        status: 'worker_running',
      });

      expect(updated!.updatedAt).not.toBe(original.updatedAt);
    });
  });

  describe('addSummary', () => {
    it('should add summary to state', async () => {
      const config = createTestRalphLoopConfig();

      await repository.create({
        taskId: 'task-123',
        projectId: 'test-project',
        config,
        currentIteration: 1,
        status: 'idle',
        summaries: [],
        feedback: [],
      });

      const summary = createTestIterationSummary({ iterationNumber: 1 });
      await repository.addSummary('test-project', 'task-123', summary);

      const state = await repository.findById('test-project', 'task-123');
      expect(state!.summaries.length).toBe(1);
      expect(state!.summaries[0]!.iterationNumber).toBe(1);
    });

    it('should write summary to separate file', async () => {
      const config = createTestRalphLoopConfig();

      await repository.create({
        taskId: 'task-123',
        projectId: 'test-project',
        config,
        currentIteration: 1,
        status: 'idle',
        summaries: [],
        feedback: [],
      });

      mockFileSystem.writeFile.mockClear();

      const summary = createTestIterationSummary({ iterationNumber: 1 });
      await repository.addSummary('test-project', 'task-123', summary);

      expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('iteration-1.json'),
        expect.any(String)
      );
    });
  });

  describe('addFeedback', () => {
    it('should add feedback to state', async () => {
      const config = createTestRalphLoopConfig();

      await repository.create({
        taskId: 'task-123',
        projectId: 'test-project',
        config,
        currentIteration: 1,
        status: 'idle',
        summaries: [],
        feedback: [],
      });

      const feedback = createTestReviewerFeedback({ iterationNumber: 1 });
      await repository.addFeedback('test-project', 'task-123', feedback);

      const state = await repository.findById('test-project', 'task-123');
      expect(state!.feedback.length).toBe(1);
      expect(state!.feedback[0]!.iterationNumber).toBe(1);
    });

    it('should write feedback to separate file', async () => {
      const config = createTestRalphLoopConfig();

      await repository.create({
        taskId: 'task-123',
        projectId: 'test-project',
        config,
        currentIteration: 1,
        status: 'idle',
        summaries: [],
        feedback: [],
      });

      mockFileSystem.writeFile.mockClear();

      const feedback = createTestReviewerFeedback({ iterationNumber: 1 });
      await repository.addFeedback('test-project', 'task-123', feedback);

      expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('iteration-1.json'),
        expect.any(String)
      );
    });
  });

  describe('delete', () => {
    it('should delete loop and remove from cache', async () => {
      const config = createTestRalphLoopConfig();

      await repository.create({
        taskId: 'task-123',
        projectId: 'test-project',
        config,
        currentIteration: 0,
        status: 'idle',
        summaries: [],
        feedback: [],
      });

      mockFileSystem.exists.mockResolvedValue(true);

      const result = await repository.delete('test-project', 'task-123');

      expect(result).toBe(true);
      expect(mockFileSystem.rmdir).toHaveBeenCalled();
    });

    it('should return false for non-existent loop', async () => {
      mockFileSystem.exists.mockResolvedValue(false);

      const result = await repository.delete('test-project', 'non-existent');

      expect(result).toBe(false);
    });
  });

  describe('delete', () => {
    it('should return false for unknown project', async () => {
      const result = await repository.delete('unknown-project', 'task-1');
      expect(result).toBe(false);
    });

    it('should return false when rmdir throws', async () => {
      const config = createTestRalphLoopConfig();

      await repository.create({
        taskId: 'task-err',
        projectId: 'test-project',
        config,
        currentIteration: 0,
        status: 'idle',
        summaries: [],
        feedback: [],
      });

      mockFileSystem.exists.mockResolvedValue(true);
      mockFileSystem.rmdir.mockRejectedValueOnce(new Error('EACCES'));

      const result = await repository.delete('test-project', 'task-err');
      expect(result).toBe(false);
    });
  });

  describe('findById - edge cases', () => {
    it('should return null for unknown project', async () => {
      const state = await repository.findById('unknown-project', 'task-1');
      expect(state).toBeNull();
    });

    it('should return null when readFile throws', async () => {
      mockFileSystem.exists.mockResolvedValue(true);
      mockFileSystem.readFile.mockRejectedValueOnce(new Error('ENOENT'));

      const newRepo = new FileRalphLoopRepository({
        projectPathResolver: mockPathResolver,
        fileSystem: mockFileSystem,
      });

      const state = await newRepo.findById('test-project', 'task-bad');
      expect(state).toBeNull();
    });
  });

  describe('findByProject - edge cases', () => {
    it('should return empty for unknown project', async () => {
      const states = await repository.findByProject('unknown-project');
      expect(states).toEqual([]);
    });
  });

  describe('addSummary - edge cases', () => {
    it('should throw for unknown project task dir', async () => {
      await expect(
        repository.addSummary('unknown-project', 'task-1', createTestIterationSummary({ iterationNumber: 1 }))
      ).rejects.toThrow('Task not found');
    });
  });

  describe('addFeedback - edge cases', () => {
    it('should throw for unknown project task dir', async () => {
      await expect(
        repository.addFeedback('unknown-project', 'task-1', createTestReviewerFeedback({ iterationNumber: 1 }))
      ).rejects.toThrow('Task not found');
    });
  });

  describe('flush', () => {
    it('should wait for pending operations', async () => {
      const config = createTestRalphLoopConfig();

      await repository.create({
        taskId: 'task-123',
        projectId: 'test-project',
        config,
        currentIteration: 0,
        status: 'idle',
        summaries: [],
        feedback: [],
      });

      // Should complete without error
      await repository.flush();
    });
  });
});
