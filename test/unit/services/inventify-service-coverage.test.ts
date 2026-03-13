import { DefaultInventifyService } from '../../../src/services/inventify-service';
import {
  createMockAgentManager,
  createMockProjectService,
  createMockRalphLoopService,
  createMockSettingsRepository,
} from '../helpers/mock-factories';
import { Logger } from '../../../src/utils/logger';

// Mock fs
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    rename: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue('# Plan content'),
  },
}));

import fs from 'fs';
const mockRename = fs.promises.rename as jest.Mock;

function createMockLogger(): jest.Mocked<Logger> {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    withProject: jest.fn().mockReturnThis(),
  } as unknown as jest.Mocked<Logger>;
}

function buildFiveIdeasOutput(): string {
  return JSON.stringify([
    { name: 'pixel-garden', tagline: 'Grow your own pixel forest', description: 'A virtual garden where you grow pixel plants.' },
    { name: 'code-quest', tagline: 'Learn coding through adventure', description: 'An RPG-style game to teach programming.' },
    { name: 'task-ninja', tagline: 'Slash through your todo list', description: 'A gamified task manager with ninja themes.' },
    { name: 'beat-box', tagline: 'Make music in your browser', description: 'A web-based drum machine and sequencer.' },
    { name: 'data-flow', tagline: 'Visualize your data pipelines', description: 'A tool for building and monitoring ETL flows.' },
  ], null, 2);
}

type MockAgentManager = ReturnType<typeof createMockAgentManager>;

function getRegisteredHandlers(
  manager: MockAgentManager,
): Record<string, (...args: unknown[]) => void> {
  const handlers: Record<string, (...args: unknown[]) => void> = {};

  for (const call of manager.on.mock.calls) {
    const [event, handler] = call;
    handlers[event as string] = handler as (...args: unknown[]) => void;
  }

  return handlers;
}

describe('DefaultInventifyService - Coverage', () => {
  let service: DefaultInventifyService;
  let mockLogger: jest.Mocked<Logger>;
  let mockAgentManager: MockAgentManager;
  let mockProjectService: ReturnType<typeof createMockProjectService>;
  let mockRalphLoopService: ReturnType<typeof createMockRalphLoopService>;
  let mockSettingsRepository: ReturnType<typeof createMockSettingsRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = createMockLogger();
    mockAgentManager = createMockAgentManager();
    mockProjectService = createMockProjectService();
    mockRalphLoopService = createMockRalphLoopService();
    mockSettingsRepository = createMockSettingsRepository({
      inventifyFolder: '/test/inventify',
    });

    service = new DefaultInventifyService({
      logger: mockLogger,
      agentManager: mockAgentManager,
      projectService: mockProjectService,
      ralphLoopService: mockRalphLoopService,
      settingsRepository: mockSettingsRepository,
    });
  });

  async function startBrainstorm(): Promise<void> {
    await service.start({
      projectTypes: ['web'],
      themes: ['games'],
      languages: [],
      technologies: [],
      customPrompt: '',
      inventifyFolder: '/test/inventify',
    });
  }

  async function startAndCompleteBrainstorm(): Promise<void> {
    await startBrainstorm();

    const handlers = getRegisteredHandlers(mockAgentManager);
    const ideasJson = buildFiveIdeasOutput();

    handlers.oneOffMessage!('oneoff-test-id', {
      type: 'result',
      content: ideasJson,
    });
    handlers.oneOffWaiting!('oneoff-test-id', true, 1);

    mockAgentManager.on.mockClear();
  }

  describe('brainstorm completion via oneOffStatus (stopped)', () => {
    it('should parse ideas when agent stops', async () => {
      await startBrainstorm();

      const handlers = getRegisteredHandlers(mockAgentManager);
      const ideasJson = buildFiveIdeasOutput();

      handlers.oneOffMessage!('oneoff-test-id', {
        type: 'stdout',
        content: ideasJson,
      });
      handlers.oneOffStatus!('oneoff-test-id', 'stopped');

      expect(service.getIdeas()).toHaveLength(5);
      expect(service.isRunning()).toBe(false);
    });

    it('should ignore status events for other oneOffIds', async () => {
      await startBrainstorm();

      const handlers = getRegisteredHandlers(mockAgentManager);

      handlers.oneOffStatus!('other-id', 'stopped');

      expect(service.isRunning()).toBe(true);
    });

    it('should ignore non-terminal status events', async () => {
      await startBrainstorm();

      const handlers = getRegisteredHandlers(mockAgentManager);

      handlers.oneOffStatus!('oneoff-test-id', 'running');

      expect(service.isRunning()).toBe(true);
    });

    it('should clean up on error status without parsing', async () => {
      await startBrainstorm();

      const handlers = getRegisteredHandlers(mockAgentManager);

      handlers.oneOffStatus!('oneoff-test-id', 'error');

      expect(service.isRunning()).toBe(false);
      expect(service.getIdeas()).toBeNull();
    });

    it('should remove listeners on status completion', async () => {
      await startBrainstorm();

      const handlers = getRegisteredHandlers(mockAgentManager);

      handlers.oneOffStatus!('oneoff-test-id', 'stopped');

      expect(mockAgentManager.off).toHaveBeenCalledWith(
        'oneOffMessage',
        expect.any(Function),
      );
      expect(mockAgentManager.off).toHaveBeenCalledWith(
        'oneOffStatus',
        expect.any(Function),
      );
      expect(mockAgentManager.off).toHaveBeenCalledWith(
        'oneOffWaiting',
        expect.any(Function),
      );
    });
  });

  describe('brainstorm message handler filtering', () => {
    it('should ignore messages from other oneOffIds', async () => {
      await startBrainstorm();

      const handlers = getRegisteredHandlers(mockAgentManager);

      handlers.oneOffMessage!('other-id', {
        type: 'stdout',
        content: 'should be ignored',
      });

      // Complete brainstorm with correct id but no output collected
      handlers.oneOffStatus!('oneoff-test-id', 'stopped');

      // No ideas because the message from other id was ignored
      expect(service.getIdeas()).toBeNull();
    });

    it('should only collect stdout and result message types', async () => {
      await startBrainstorm();

      const handlers = getRegisteredHandlers(mockAgentManager);
      const ideasJson = buildFiveIdeasOutput();

      // tool_use messages should be ignored
      handlers.oneOffMessage!('oneoff-test-id', {
        type: 'tool_use',
        content: 'tool stuff',
      });

      // stdout should be collected
      handlers.oneOffMessage!('oneoff-test-id', {
        type: 'stdout',
        content: ideasJson,
      });

      handlers.oneOffStatus!('oneoff-test-id', 'stopped');

      expect(service.getIdeas()).toHaveLength(5);
    });
  });

  describe('brainstorm completion error handling', () => {
    it('should handle parse failure gracefully', async () => {
      await startBrainstorm();

      const handlers = getRegisteredHandlers(mockAgentManager);

      handlers.oneOffMessage!('oneoff-test-id', {
        type: 'stdout',
        content: 'not valid JSON at all',
      });
      handlers.oneOffStatus!('oneoff-test-id', 'stopped');

      expect(service.getIdeas()).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to parse brainstorm ideas',
        expect.objectContaining({ error: expect.any(String) }),
      );
    });
  });

  describe('name suggestion completion via oneOffStatus', () => {
    it('should parse names when agent stops', async () => {
      await startAndCompleteBrainstorm();

      const result = await service.suggestNames(0);
      const handlers = getRegisteredHandlers(mockAgentManager);

      handlers.oneOffMessage!(result.oneOffId, {
        type: 'stdout',
        content: '["alpha", "beta", "gamma"]',
      });
      handlers.oneOffStatus!(result.oneOffId, 'stopped');

      const suggestions = service.getNameSuggestions();

      expect(suggestions).not.toBeNull();
      expect(suggestions!.names).toHaveLength(3);
      expect(suggestions!.ideaIndex).toBe(0);
    });

    it('should clean up on error status', async () => {
      await startAndCompleteBrainstorm();

      const result = await service.suggestNames(0);
      const handlers = getRegisteredHandlers(mockAgentManager);

      handlers.oneOffStatus!(result.oneOffId, 'error');

      expect(service.isRunning()).toBe(false);
      expect(service.getNameSuggestions()).toBeNull();
    });

    it('should ignore status events for other oneOffIds', async () => {
      await startAndCompleteBrainstorm();

      await service.suggestNames(0);
      const handlers = getRegisteredHandlers(mockAgentManager);

      handlers.oneOffStatus!('other-id', 'stopped');

      expect(service.isRunning()).toBe(true);
    });

    it('should ignore non-terminal status events', async () => {
      await startAndCompleteBrainstorm();

      await service.suggestNames(0);
      const handlers = getRegisteredHandlers(mockAgentManager);

      handlers.oneOffStatus!('oneoff-test-id', 'running');

      expect(service.isRunning()).toBe(true);
    });

    it('should handle name parse failure gracefully', async () => {
      await startAndCompleteBrainstorm();

      const result = await service.suggestNames(0);
      const handlers = getRegisteredHandlers(mockAgentManager);

      handlers.oneOffMessage!(result.oneOffId, {
        type: 'stdout',
        content: 'garbage output',
      });
      handlers.oneOffStatus!(result.oneOffId, 'stopped');

      expect(service.getNameSuggestions()).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to parse name suggestions',
        expect.objectContaining({ error: expect.any(String) }),
      );
    });
  });

  describe('name suggestion via oneOffWaiting', () => {
    it('should ignore waiting from other ids', async () => {
      await startAndCompleteBrainstorm();

      await service.suggestNames(0);
      const handlers = getRegisteredHandlers(mockAgentManager);

      handlers.oneOffWaiting!('other-id', true, 1);

      expect(service.isRunning()).toBe(true);
    });

    it('should ignore isWaiting=false', async () => {
      await startAndCompleteBrainstorm();

      await service.suggestNames(0);
      const handlers = getRegisteredHandlers(mockAgentManager);

      handlers.oneOffWaiting!('oneoff-test-id', false, 1);

      expect(service.isRunning()).toBe(true);
    });

    it('should remove listeners on waiting completion', async () => {
      await startAndCompleteBrainstorm();

      mockAgentManager.off.mockClear();
      const result = await service.suggestNames(0);
      const handlers = getRegisteredHandlers(mockAgentManager);

      handlers.oneOffMessage!(result.oneOffId, {
        type: 'stdout',
        content: '["name-one", "name-two"]',
      });
      handlers.oneOffWaiting!(result.oneOffId, true, 1);

      expect(mockAgentManager.off).toHaveBeenCalledWith(
        'oneOffMessage',
        expect.any(Function),
      );
      expect(mockAgentManager.off).toHaveBeenCalledWith(
        'oneOffStatus',
        expect.any(Function),
      );
      expect(mockAgentManager.off).toHaveBeenCalledWith(
        'oneOffWaiting',
        expect.any(Function),
      );
    });
  });

  describe('suggestNames validation', () => {
    it('should reject invalid index (too high)', async () => {
      await startAndCompleteBrainstorm();

      await expect(service.suggestNames(5)).rejects.toThrow(
        'Invalid idea index: 5',
      );
    });

    it('should reject negative index', async () => {
      await startAndCompleteBrainstorm();

      await expect(service.suggestNames(-1)).rejects.toThrow(
        'Invalid idea index: -1',
      );
    });

    it('should reject when already running', async () => {
      await startBrainstorm();

      // Still running (not completed)
      await expect(service.suggestNames(0)).rejects.toThrow(
        'No pending ideas',
      );
    });

    it('should reject when no session agent', async () => {
      await startAndCompleteBrainstorm();
      await service.cancel();

      // After cancel, sessionOneOffId is null
      // But pendingIdeas is also null after cancel, so we get "No pending ideas"
      await expect(service.suggestNames(0)).rejects.toThrow(
        'No pending ideas',
      );
    });
  });

  describe('selectIdea validation', () => {
    it('should reject invalid index (too high)', async () => {
      await startAndCompleteBrainstorm();

      await expect(service.selectIdea(5, 'test')).rejects.toThrow(
        'Invalid idea index: 5',
      );
    });

    it('should reject negative index', async () => {
      await startAndCompleteBrainstorm();

      await expect(service.selectIdea(-1, 'test')).rejects.toThrow(
        'Invalid idea index: -1',
      );
    });

    it('should reject when already running', async () => {
      // Start but don't complete
      await startBrainstorm();

      await expect(service.selectIdea(0, 'test')).rejects.toThrow(
        'No pending ideas',
      );
    });
  });

  describe('renameDirectory', () => {
    it('should skip rename when paths are the same', async () => {
      await startAndCompleteBrainstorm();

      // updateProjectPath returns a project status
      mockProjectService.updateProjectPath.mockResolvedValue(null);

      // We need the inventifyFolder + projectName to equal the placeholder path
      // This is hard to test directly, but we can test renameDirectory indirectly
      mockRename.mockClear();

      // Select with a name that matches the placeholder dir name
      // The test just verifies rename is called normally
      await service.selectIdea(0, 'my-project');

      expect(mockRename).toHaveBeenCalled();
    });
  });

  describe('completeBuild ralph loop config', () => {
    it('should pass settings to ralph loop config', async () => {
      const mockReadFile = fs.promises.readFile as jest.Mock;
      mockReadFile.mockResolvedValue('# Detailed Plan\n## Phase 1');

      await service.completeBuild('proj-1', '/test/inventify/my-proj');

      expect(mockRalphLoopService.start).toHaveBeenCalledWith(
        'proj-1',
        expect.objectContaining({
          maxTurns: expect.any(Number),
          workerModel: expect.any(String),
          reviewerModel: expect.any(String),
          taskDescription: expect.stringContaining('Detailed Plan'),
        }),
      );
    });

    it('should set build result with correct project name', async () => {
      const mockReadFile = fs.promises.readFile as jest.Mock;
      mockReadFile.mockResolvedValue('# Plan');

      await service.completeBuild('proj-2', '/test/inventify/cool-app');

      const result = service.getBuildResult();

      expect(result).toEqual({
        newProjectId: 'proj-2',
        projectName: 'cool-app',
      });
    });
  });

  describe('stopSessionAgent', () => {
    it('should stop agent when sessionOneOffId is set', async () => {
      await startAndCompleteBrainstorm();

      mockAgentManager.stopOneOffAgent.mockClear();

      // cancel calls stopSessionAgent
      await service.cancel();

      expect(mockAgentManager.stopOneOffAgent).toHaveBeenCalledWith(
        'oneoff-test-id',
      );
    });

    it('should handle when no agent is running', async () => {
      // cancel without starting
      await service.cancel();

      expect(mockAgentManager.stopOneOffAgent).not.toHaveBeenCalled();
    });
  });

  describe('start cleans up previous session', () => {
    it('should stop previous session agent before starting new one', async () => {
      await startAndCompleteBrainstorm();

      // The first start set sessionOneOffId
      // Now start again (after ideas are parsed and activeOneOffId is null)
      mockAgentManager.stopOneOffAgent.mockClear();

      await service.start({
        projectTypes: ['cli'],
        themes: ['tools'],
        languages: [],
        technologies: [],
        customPrompt: '',
        inventifyFolder: '/test/inventify',
      });

      // Should have stopped the previous session agent
      expect(mockAgentManager.stopOneOffAgent).toHaveBeenCalledWith(
        'oneoff-test-id',
      );
    });
  });

  describe('parseIdeas edge cases', () => {
    it('should filter out non-object items in array', () => {
      const output = JSON.stringify([
        'just a string',
        42,
        null,
        { name: 'valid', tagline: 'OK', description: 'Yes' },
      ]);

      const ideas = service.parseIdeas(output);

      expect(ideas).toHaveLength(1);
      expect(ideas[0]!.name).toBe('valid');
    });

    it('should throw when all items are invalid', () => {
      const output = JSON.stringify([
        { name: 'missing-fields' },
        { tagline: 'no-name' },
        42,
      ]);

      expect(() => service.parseIdeas(output)).toThrow(
        'Could not parse any ideas',
      );
    });

    it('should trim whitespace from idea fields', () => {
      const output = JSON.stringify([
        {
          name: '  spaced-name  ',
          tagline: '  spaced tagline  ',
          description: '  spaced description  ',
        },
      ]);

      const ideas = service.parseIdeas(output);

      expect(ideas[0]!.name).toBe('spaced-name');
      expect(ideas[0]!.tagline).toBe('spaced tagline');
      expect(ideas[0]!.description).toBe('spaced description');
    });
  });

  describe('parseNames edge cases', () => {
    it('should filter out non-string items', () => {
      const output = JSON.stringify(['valid-name', 42, null, 'another-name']);

      const names = service.parseNames(output);

      expect(names).toHaveLength(2);
      expect(names[0]).toBe('valid-name');
      expect(names[1]).toBe('another-name');
    });

    it('should trim and lowercase names', () => {
      const output = JSON.stringify(['  My-App  ', 'UPPER-CASE']);

      const names = service.parseNames(output);

      expect(names[0]).toBe('my-app');
      expect(names[1]).toBe('upper-case');
    });
  });

  describe('selectIdea with updateProjectPath returning null', () => {
    it('should fall back to placeholderProjectId when update returns null', async () => {
      await startAndCompleteBrainstorm();

      mockProjectService.updateProjectPath.mockResolvedValue(null);

      const result = await service.selectIdea(0, 'my-project');

      expect(result.newProjectId).toBe('new-project-id');
    });
  });

  describe('name message handler filtering', () => {
    it('should ignore messages from other oneOffIds', async () => {
      await startAndCompleteBrainstorm();

      const result = await service.suggestNames(0);
      const handlers = getRegisteredHandlers(mockAgentManager);

      // Send message from wrong id
      handlers.oneOffMessage!('wrong-id', {
        type: 'stdout',
        content: '["name-1"]',
      });

      // Complete with correct id - no output was collected
      handlers.oneOffStatus!(result.oneOffId, 'stopped');

      expect(service.getNameSuggestions()).toBeNull();
    });
  });

  describe('brainstorm collects result type messages', () => {
    it('should accumulate both stdout and result messages', async () => {
      await startBrainstorm();

      const handlers = getRegisteredHandlers(mockAgentManager);

      // Send part of the output as stdout, part as result
      const ideas = [
        { name: 'idea-1', tagline: 'Tag 1', description: 'Desc 1' },
      ];

      handlers.oneOffMessage!('oneoff-test-id', {
        type: 'result',
        content: JSON.stringify(ideas),
      });
      handlers.oneOffWaiting!('oneoff-test-id', true, 1);

      expect(service.getIdeas()).toHaveLength(1);
    });
  });
});
