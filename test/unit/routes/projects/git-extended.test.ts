import express, { Express } from 'express';
import request from 'supertest';
import { EventEmitter } from 'events';
import {
  createProjectsRouter,
  ProjectRouterDependencies,
} from '../../../../src/routes/projects';
import {
  createMockProjectRepository,
  createMockProjectService,
  createMockRoadmapParser,
  createMockRoadmapGenerator,
  createMockRoadmapEditor,
  createMockAgentManager,
  createMockConversationRepository,
  createMockSettingsRepository,
  createMockGitService,
  createMockInstructionGenerator,
  sampleProject,
} from '../../helpers/mock-factories';
import { GitService } from '../../../../src/services/git-service';
import { AgentManager } from '../../../../src/agents';
import { ConversationRepository } from '../../../../src/repositories';
import { createErrorHandler } from '../../../../src/utils';

jest.mock('../../../../src/middleware/rate-limit', () => ({
  roadmapGenerationRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
  agentOperationRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
  moderateRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
  strictRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../../../src/routes', () => ({
  ...jest.requireActual('../../../../src/routes'),
  getWebSocketServer: jest.fn(() => null),
  getAgentManager: jest.fn(() => null),
  getProcessTracker: jest.fn(() => null),
  getRalphLoopService: jest.fn(() => null),
}));

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      readFile: jest.fn(),
      writeFile: jest.fn(),
      access: jest.fn(),
      stat: jest.fn(),
      mkdir: jest.fn().mockResolvedValue(undefined),
    },
    existsSync: jest.fn().mockReturnValue(false),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    statSync: jest.fn(),
  };
});

describe('Git Routes - Extended', () => {
  let app: Express;
  let mockGitService: jest.Mocked<GitService>;
  let mockAgentManager: jest.Mocked<AgentManager>;
  let mockConversationRepo: jest.Mocked<ConversationRepository>;
  let emitter: EventEmitter;
  const projectId = sampleProject.id;
  const basePath = `/api/projects/${projectId}/git`;

  function setupApp(): void {
    mockGitService = createMockGitService();
    mockAgentManager = createMockAgentManager();
    mockConversationRepo = createMockConversationRepository();
    emitter = (mockAgentManager as unknown as { _emitter: EventEmitter })._emitter;

    const deps: ProjectRouterDependencies = {
      projectRepository: createMockProjectRepository([{ ...sampleProject }]),
      projectService: createMockProjectService(),
      roadmapParser: createMockRoadmapParser(),
      roadmapGenerator: createMockRoadmapGenerator(),
      roadmapEditor: createMockRoadmapEditor(),
      agentManager: mockAgentManager,
      instructionGenerator: createMockInstructionGenerator(),
      conversationRepository: mockConversationRepo,
      settingsRepository: createMockSettingsRepository(),
      gitService: mockGitService,
    };

    app = express();
    app.use(express.json());
    app.use('/api/projects', createProjectsRouter(deps));
    app.use(createErrorHandler());
  }

  beforeEach(() => {
    setupApp();
  });

  // ===========================================================================
  // GET /file-diff
  // ===========================================================================

  describe('GET /:id/git/file-diff', () => {
    it('returns diff for a specific file (unstaged)', async () => {
      mockGitService.getFileDiff.mockResolvedValue({
        diff: 'file diff content',
        filePath: 'src/index.ts',
      });

      const res = await request(app)
        .get(`${basePath}/file-diff?path=src/index.ts`);

      expect(res.status).toBe(200);
      expect(res.body.filePath).toBe('src/index.ts');
      expect(res.body.diff).toBe('file diff content');
      expect(mockGitService.getFileDiff).toHaveBeenCalledWith(
        sampleProject.path, 'src/index.ts', false,
      );
    });

    it('returns diff for a staged file', async () => {
      mockGitService.getFileDiff.mockResolvedValue({
        diff: 'staged file diff',
        filePath: 'package.json',
      });

      const res = await request(app)
        .get(`${basePath}/file-diff?path=package.json&staged=true`);

      expect(res.status).toBe(200);
      expect(res.body.diff).toBe('staged file diff');
      expect(mockGitService.getFileDiff).toHaveBeenCalledWith(
        sampleProject.path, 'package.json', true,
      );
    });

    it('returns 400 when path is missing', async () => {
      const res = await request(app).get(`${basePath}/file-diff`);

      expect(res.status).toBe(400);
    });
  });

  // ===========================================================================
  // POST /tags/:name/push
  // ===========================================================================

  describe('POST /:id/git/tags/:name/push', () => {
    it('pushes a tag to default remote', async () => {
      mockGitService.pushTag.mockResolvedValue('Tag pushed');

      const res = await request(app)
        .post(`${basePath}/tags/v1.0.0/push`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockGitService.pushTag).toHaveBeenCalledWith(
        sampleProject.path, 'v1.0.0', 'origin',
      );
    });

    it('pushes a tag to a custom remote', async () => {
      mockGitService.pushTag.mockResolvedValue('Tag pushed');

      const res = await request(app)
        .post(`${basePath}/tags/v2.0.0/push`)
        .send({ remote: 'upstream' });

      expect(res.status).toBe(200);
      expect(mockGitService.pushTag).toHaveBeenCalledWith(
        sampleProject.path, 'v2.0.0', 'upstream',
      );
    });

    it('returns 404 for non-existent project', async () => {
      const res = await request(app)
        .post('/api/projects/nonexistent/git/tags/v1.0.0/push')
        .send({});

      expect(res.status).toBe(404);
    });
  });

  // ===========================================================================
  // DELETE /tags/:name
  // ===========================================================================

  describe('DELETE /:id/git/tags/:name', () => {
    it('deletes a local tag', async () => {
      mockGitService.deleteTag.mockResolvedValue(undefined);

      const res = await request(app)
        .delete(`${basePath}/tags/v1.0.0`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockGitService.deleteTag).toHaveBeenCalledWith(
        sampleProject.path, 'v1.0.0',
      );
    });

    it('returns 404 for non-existent project', async () => {
      const res = await request(app)
        .delete('/api/projects/nonexistent/git/tags/v1.0.0');

      expect(res.status).toBe(404);
    });
  });

  // ===========================================================================
  // POST /generate-commit-message (success path)
  // ===========================================================================

  describe('POST /:id/git/generate-commit-message', () => {
    it('generates a commit message from staged files', async () => {
      mockGitService.getStatus.mockResolvedValue({
        isRepo: true,
        staged: [{ status: 'modified' as const, path: 'src/app.ts', name: 'app.ts' }],
        unstaged: [],
        untracked: [],
      });
      mockGitService.getDiff.mockResolvedValue('diff content here');
      // eslint-disable-next-line @typescript-eslint/require-await
      mockAgentManager.startOneOffAgent.mockImplementation(async () => {
        const oneOffId = 'oneoff-commit-123';

        // Schedule event emission after listeners are registered
        setTimeout(() => {
          emitter.emit('oneOffMessage', oneOffId, {
            type: 'stdout',
            content: 'feat(app): update app logic',
          });
          emitter.emit('oneOffStatus', oneOffId, 'stopped');
        }, 10);

        return oneOffId;
      });

      const res = await request(app)
        .post(`${basePath}/generate-commit-message`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('feat(app): update app logic');
    });

    it('strips backticks from generated commit message', async () => {
      mockGitService.getStatus.mockResolvedValue({
        isRepo: true,
        staged: [{ status: 'added' as const, path: 'new.ts', name: 'new.ts' }],
        unstaged: [],
        untracked: [],
      });
      mockGitService.getDiff.mockResolvedValue('diff');
      // eslint-disable-next-line @typescript-eslint/require-await
      mockAgentManager.startOneOffAgent.mockImplementation(async () => {
        const oneOffId = 'oneoff-commit-456';

        setTimeout(() => {
          emitter.emit('oneOffMessage', oneOffId, {
            type: 'stdout',
            content: '```feat(new): add new file```',
          });
          emitter.emit('oneOffStatus', oneOffId, 'stopped');
        }, 10);

        return oneOffId;
      });

      const res = await request(app)
        .post(`${basePath}/generate-commit-message`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('feat(new): add new file');
    });

    it('strips quotes from generated commit message', async () => {
      mockGitService.getStatus.mockResolvedValue({
        isRepo: true,
        staged: [{ status: 'added' as const, path: 'x.ts', name: 'x.ts' }],
        unstaged: [],
        untracked: [],
      });
      mockGitService.getDiff.mockResolvedValue('diff');
      // eslint-disable-next-line @typescript-eslint/require-await
      mockAgentManager.startOneOffAgent.mockImplementation(async () => {
        const oneOffId = 'oneoff-commit-789';

        setTimeout(() => {
          emitter.emit('oneOffMessage', oneOffId, {
            type: 'stdout',
            content: '"fix: resolve bug"',
          });
          emitter.emit('oneOffStatus', oneOffId, 'stopped');
        }, 10);

        return oneOffId;
      });

      const res = await request(app)
        .post(`${basePath}/generate-commit-message`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('fix: resolve bug');
    });

    it('resolves when agent enters waiting state', async () => {
      mockGitService.getStatus.mockResolvedValue({
        isRepo: true,
        staged: [{ status: 'modified' as const, path: 'a.ts', name: 'a.ts' }],
        unstaged: [],
        untracked: [],
      });
      mockGitService.getDiff.mockResolvedValue('diff');
      // eslint-disable-next-line @typescript-eslint/require-await
      mockAgentManager.startOneOffAgent.mockImplementation(async () => {
        const oneOffId = 'oneoff-waiting';

        setTimeout(() => {
          emitter.emit('oneOffMessage', oneOffId, {
            type: 'stdout',
            content: 'chore: cleanup',
          });
          emitter.emit('oneOffWaiting', oneOffId, true, 1);
        }, 10);

        return oneOffId;
      });

      const res = await request(app)
        .post(`${basePath}/generate-commit-message`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('chore: cleanup');
      expect(mockAgentManager.stopOneOffAgent).toHaveBeenCalledWith('oneoff-waiting');
    });

    it('returns 500 when agent errors', async () => {
      mockGitService.getStatus.mockResolvedValue({
        isRepo: true,
        staged: [{ status: 'modified' as const, path: 'b.ts', name: 'b.ts' }],
        unstaged: [],
        untracked: [],
      });
      mockGitService.getDiff.mockResolvedValue('diff');
      // eslint-disable-next-line @typescript-eslint/require-await
      mockAgentManager.startOneOffAgent.mockImplementation(async () => {
        const oneOffId = 'oneoff-error';

        setTimeout(() => {
          emitter.emit('oneOffStatus', oneOffId, 'error');
        }, 10);

        return oneOffId;
      });

      const res = await request(app)
        .post(`${basePath}/generate-commit-message`);

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('error');
    });

    it('concatenates multiple stdout messages', async () => {
      mockGitService.getStatus.mockResolvedValue({
        isRepo: true,
        staged: [{ status: 'modified' as const, path: 'c.ts', name: 'c.ts' }],
        unstaged: [],
        untracked: [],
      });
      mockGitService.getDiff.mockResolvedValue('diff');
      // eslint-disable-next-line @typescript-eslint/require-await
      mockAgentManager.startOneOffAgent.mockImplementation(async () => {
        const oneOffId = 'oneoff-multi';

        setTimeout(() => {
          emitter.emit('oneOffMessage', oneOffId, {
            type: 'stdout',
            content: 'feat: part one',
          });
          emitter.emit('oneOffMessage', oneOffId, {
            type: 'result',
            content: '\npart two',
          });
          emitter.emit('oneOffStatus', oneOffId, 'stopped');
        }, 10);

        return oneOffId;
      });

      const res = await request(app)
        .post(`${basePath}/generate-commit-message`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('feat: part one\npart two');
    });

    it('ignores messages from other one-off agents', async () => {
      mockGitService.getStatus.mockResolvedValue({
        isRepo: true,
        staged: [{ status: 'modified' as const, path: 'd.ts', name: 'd.ts' }],
        unstaged: [],
        untracked: [],
      });
      mockGitService.getDiff.mockResolvedValue('diff');
      // eslint-disable-next-line @typescript-eslint/require-await
      mockAgentManager.startOneOffAgent.mockImplementation(async () => {
        const oneOffId = 'oneoff-mine';

        setTimeout(() => {
          // Message from a different one-off agent - should be ignored
          emitter.emit('oneOffMessage', 'oneoff-other', {
            type: 'stdout',
            content: 'wrong message',
          });
          emitter.emit('oneOffMessage', oneOffId, {
            type: 'stdout',
            content: 'fix: correct message',
          });
          emitter.emit('oneOffStatus', oneOffId, 'stopped');
        }, 10);

        return oneOffId;
      });

      const res = await request(app)
        .post(`${basePath}/generate-commit-message`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('fix: correct message');
    });
  });

  // ===========================================================================
  // POST /generate-pr-description
  // ===========================================================================

  describe('POST /:id/git/generate-pr-description', () => {
    it('returns 400 when no changes found', async () => {
      mockGitService.getBranches.mockResolvedValue({
        current: 'main',
        local: ['main'],
        remote: [],
      });
      mockGitService.getDiff.mockResolvedValue('');

      const res = await request(app)
        .post(`${basePath}/generate-pr-description`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('No changes');
    });

    it('generates a PR description from branch diff', async () => {
      mockGitService.getBranches.mockResolvedValue({
        current: 'feature/new',
        local: ['main', 'feature/new'],
        remote: [],
      });
      mockGitService.getDiff.mockResolvedValue('diff content');
      mockConversationRepo.getMessagesLegacy.mockResolvedValue([]);

      // eslint-disable-next-line @typescript-eslint/require-await
      mockAgentManager.startOneOffAgent.mockImplementation(async () => {
        const oneOffId = 'oneoff-pr-123';

        setTimeout(() => {
          emitter.emit('oneOffMessage', oneOffId, {
            type: 'stdout',
            content: JSON.stringify({
              title: 'feat: add new feature',
              body: '## Summary\n- Added feature\n\n## Changes\n- New files',
            }),
          });
          emitter.emit('oneOffStatus', oneOffId, 'stopped');
        }, 10);

        return oneOffId;
      });

      const res = await request(app)
        .post(`${basePath}/generate-pr-description`);

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('feat: add new feature');
      expect(res.body.body).toContain('Summary');
    });

    it('parses PR description wrapped in code fence', async () => {
      mockGitService.getBranches.mockResolvedValue({
        current: 'fix/bug',
        local: ['main', 'fix/bug'],
        remote: [],
      });
      mockGitService.getDiff.mockResolvedValue('some diff');
      mockConversationRepo.getMessagesLegacy.mockResolvedValue([]);

      // eslint-disable-next-line @typescript-eslint/require-await
      mockAgentManager.startOneOffAgent.mockImplementation(async () => {
        const oneOffId = 'oneoff-pr-fence';

        setTimeout(() => {
          const jsonStr = JSON.stringify({ title: 'fix: bug', body: 'Fixed it' });
          emitter.emit('oneOffMessage', oneOffId, {
            type: 'stdout',
            content: '```json\n' + jsonStr + '\n```',
          });
          emitter.emit('oneOffStatus', oneOffId, 'stopped');
        }, 10);

        return oneOffId;
      });

      const res = await request(app)
        .post(`${basePath}/generate-pr-description`);

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('fix: bug');
      expect(res.body.body).toBe('Fixed it');
    });

    it('falls back to text parsing when JSON is invalid', async () => {
      mockGitService.getBranches.mockResolvedValue({
        current: 'feat/x',
        local: ['main', 'feat/x'],
        remote: [],
      });
      mockGitService.getDiff.mockResolvedValue('diff');
      mockConversationRepo.getMessagesLegacy.mockResolvedValue([]);

      // eslint-disable-next-line @typescript-eslint/require-await
      mockAgentManager.startOneOffAgent.mockImplementation(async () => {
        const oneOffId = 'oneoff-pr-text';

        setTimeout(() => {
          emitter.emit('oneOffMessage', oneOffId, {
            type: 'stdout',
            content: 'feat: add feature X\n\nThis is the body of the PR.',
          });
          emitter.emit('oneOffStatus', oneOffId, 'stopped');
        }, 10);

        return oneOffId;
      });

      const res = await request(app)
        .post(`${basePath}/generate-pr-description`);

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('feat: add feature X');
      expect(res.body.body).toContain('body of the PR');
    });

    it('includes conversation context in prompt', async () => {
      mockGitService.getBranches.mockResolvedValue({
        current: 'feat/y',
        local: ['main', 'feat/y'],
        remote: [],
      });
      mockGitService.getDiff.mockResolvedValue('diff');
      mockConversationRepo.getMessagesLegacy.mockResolvedValue([
        { type: 'user', content: 'Add user auth', timestamp: new Date().toISOString() },
        { type: 'stdout', content: 'Done', timestamp: new Date().toISOString() },
      ]);

      // eslint-disable-next-line @typescript-eslint/require-await
      mockAgentManager.startOneOffAgent.mockImplementation(async (opts) => {
        const oneOffId = 'oneoff-pr-ctx';

        // Verify conversation context is in the prompt
        expect(opts.message).toContain('Conversation context');

        setTimeout(() => {
          emitter.emit('oneOffMessage', oneOffId, {
            type: 'stdout',
            content: JSON.stringify({ title: 'feat: auth', body: 'Added auth' }),
          });
          emitter.emit('oneOffStatus', oneOffId, 'stopped');
        }, 10);

        return oneOffId;
      });

      const res = await request(app)
        .post(`${basePath}/generate-pr-description`);

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('feat: auth');
    });

    it('returns 500 when agent errors', async () => {
      mockGitService.getBranches.mockResolvedValue({
        current: 'feat/z',
        local: ['main', 'feat/z'],
        remote: [],
      });
      mockGitService.getDiff.mockResolvedValue('diff');
      mockConversationRepo.getMessagesLegacy.mockResolvedValue([]);

      // eslint-disable-next-line @typescript-eslint/require-await
      mockAgentManager.startOneOffAgent.mockImplementation(async () => {
        const oneOffId = 'oneoff-pr-err';

        setTimeout(() => {
          emitter.emit('oneOffStatus', oneOffId, 'error');
        }, 10);

        return oneOffId;
      });

      const res = await request(app)
        .post(`${basePath}/generate-pr-description`);

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('error');
    });

    it('handles same-branch diff (on main)', async () => {
      mockGitService.getBranches.mockResolvedValue({
        current: 'main',
        local: ['main'],
        remote: [],
      });
      // When on main, only staged diff is used
      mockGitService.getDiff.mockResolvedValueOnce('staged changes');
      mockConversationRepo.getMessagesLegacy.mockResolvedValue([]);

      // eslint-disable-next-line @typescript-eslint/require-await
      mockAgentManager.startOneOffAgent.mockImplementation(async () => {
        const oneOffId = 'oneoff-pr-main';

        setTimeout(() => {
          emitter.emit('oneOffMessage', oneOffId, {
            type: 'stdout',
            content: JSON.stringify({ title: 'chore: update', body: 'Updates' }),
          });
          emitter.emit('oneOffStatus', oneOffId, 'stopped');
        }, 10);

        return oneOffId;
      });

      const res = await request(app)
        .post(`${basePath}/generate-pr-description`);

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('chore: update');
    });

    it('truncates long conversation summary', async () => {
      mockGitService.getBranches.mockResolvedValue({
        current: 'feat/long',
        local: ['main', 'feat/long'],
        remote: [],
      });
      mockGitService.getDiff.mockResolvedValue('diff');

      // Create messages that exceed MAX_CONVERSATION_CHARS (5000)
      const longContent = 'A'.repeat(3000);
      mockConversationRepo.getMessagesLegacy.mockResolvedValue([
        { type: 'user', content: longContent, timestamp: new Date().toISOString() },
        { type: 'stdout', content: longContent, timestamp: new Date().toISOString() },
      ]);

      // eslint-disable-next-line @typescript-eslint/require-await
      mockAgentManager.startOneOffAgent.mockImplementation(async (opts) => {
        const oneOffId = 'oneoff-pr-long';

        // The prompt should contain truncation marker
        expect(opts.message).toContain('truncated');

        setTimeout(() => {
          emitter.emit('oneOffMessage', oneOffId, {
            type: 'stdout',
            content: JSON.stringify({ title: 'feat: long', body: 'Body' }),
          });
          emitter.emit('oneOffStatus', oneOffId, 'stopped');
        }, 10);

        return oneOffId;
      });

      const res = await request(app)
        .post(`${basePath}/generate-pr-description`);

      expect(res.status).toBe(200);
    });

    it('handles buildDiffForPR error gracefully', async () => {
      mockGitService.getBranches.mockRejectedValue(new Error('git error'));

      const res = await request(app)
        .post(`${basePath}/generate-pr-description`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('No changes');
    });

    it('uses master as base when main is not available', async () => {
      mockGitService.getBranches.mockResolvedValue({
        current: 'feat/master-based',
        local: ['master', 'feat/master-based'],
        remote: [],
      });
      mockGitService.getDiff.mockResolvedValue('diff content');
      mockConversationRepo.getMessagesLegacy.mockResolvedValue([]);

      // eslint-disable-next-line @typescript-eslint/require-await
      mockAgentManager.startOneOffAgent.mockImplementation(async () => {
        const oneOffId = 'oneoff-pr-master';

        setTimeout(() => {
          emitter.emit('oneOffMessage', oneOffId, {
            type: 'stdout',
            content: JSON.stringify({ title: 'feat: master', body: 'Body' }),
          });
          emitter.emit('oneOffStatus', oneOffId, 'stopped');
        }, 10);

        return oneOffId;
      });

      const res = await request(app)
        .post(`${basePath}/generate-pr-description`);

      expect(res.status).toBe(200);
    });

    it('handles PR description with missing title field', async () => {
      mockGitService.getBranches.mockResolvedValue({
        current: 'feat/no-title',
        local: ['main', 'feat/no-title'],
        remote: [],
      });
      mockGitService.getDiff.mockResolvedValue('diff');
      mockConversationRepo.getMessagesLegacy.mockResolvedValue([]);

      // eslint-disable-next-line @typescript-eslint/require-await
      mockAgentManager.startOneOffAgent.mockImplementation(async () => {
        const oneOffId = 'oneoff-pr-notitle';

        setTimeout(() => {
          emitter.emit('oneOffMessage', oneOffId, {
            type: 'stdout',
            content: JSON.stringify({ body: 'Just the body' }),
          });
          emitter.emit('oneOffStatus', oneOffId, 'stopped');
        }, 10);

        return oneOffId;
      });

      const res = await request(app)
        .post(`${basePath}/generate-pr-description`);

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Update');
      expect(res.body.body).toBe('Just the body');
    });
  });
});
