import express, { Express } from 'express';
import request from 'supertest';
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

describe('Git Routes', () => {
  let app: Express;
  let mockGitService: jest.Mocked<GitService>;
  const projectId = sampleProject.id;
  const basePath = `/api/projects/${projectId}/git`;

  function setupApp(): void {
    mockGitService = createMockGitService();

    const deps: ProjectRouterDependencies = {
      projectRepository: createMockProjectRepository([{ ...sampleProject }]),
      projectService: createMockProjectService(),
      roadmapParser: createMockRoadmapParser(),
      roadmapGenerator: createMockRoadmapGenerator(),
      roadmapEditor: createMockRoadmapEditor(),
      agentManager: createMockAgentManager(),
      instructionGenerator: createMockInstructionGenerator(),
      conversationRepository: createMockConversationRepository(),
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
  // GET /status
  // ===========================================================================

  describe('GET /:id/git/status', () => {
    it('returns git status for the project', async () => {
      const status = {
        isRepo: true,
        staged: [],
        unstaged: [{ status: 'modified' as const, path: 'file.ts', name: 'file.ts' }],
        untracked: [],
      };
      mockGitService.getStatus.mockResolvedValue(status);

      const res = await request(app).get(`${basePath}/status`);

      expect(res.status).toBe(200);
      expect(res.body.isRepo).toBe(true);
      expect(res.body.unstaged).toEqual([{ status: 'modified', path: 'file.ts', name: 'file.ts' }]);
      expect(mockGitService.getStatus).toHaveBeenCalledWith(sampleProject.path);
    });

    it('returns 404 for non-existent project', async () => {
      const res = await request(app).get('/api/projects/nonexistent/git/status');

      expect(res.status).toBe(404);
    });
  });

  // ===========================================================================
  // GET /branches
  // ===========================================================================

  describe('GET /:id/git/branches', () => {
    it('returns branch list', async () => {
      const branches = {
        current: 'main',
        local: ['main', 'develop'],
        remote: ['origin/main'],
      };
      mockGitService.getBranches.mockResolvedValue(branches);

      const res = await request(app).get(`${basePath}/branches`);

      expect(res.status).toBe(200);
      expect(res.body.current).toBe('main');
      expect(res.body.local).toEqual(['main', 'develop']);
    });
  });

  // ===========================================================================
  // GET /diff
  // ===========================================================================

  describe('GET /:id/git/diff', () => {
    it('returns unstaged diff by default', async () => {
      mockGitService.getDiff.mockResolvedValue('diff content');

      const res = await request(app).get(`${basePath}/diff`);

      expect(res.status).toBe(200);
      expect(res.body.diff).toBe('diff content');
      expect(mockGitService.getDiff).toHaveBeenCalledWith(
        sampleProject.path, false,
      );
    });

    it('returns staged diff when staged=true', async () => {
      mockGitService.getDiff.mockResolvedValue('staged diff');

      const res = await request(app).get(`${basePath}/diff?staged=true`);

      expect(res.status).toBe(200);
      expect(res.body.diff).toBe('staged diff');
      expect(mockGitService.getDiff).toHaveBeenCalledWith(
        sampleProject.path, true,
      );
    });
  });

  // ===========================================================================
  // POST /stage
  // ===========================================================================

  describe('POST /:id/git/stage', () => {
    it('stages specified files', async () => {
      mockGitService.stageFiles.mockResolvedValue(undefined);

      const res = await request(app)
        .post(`${basePath}/stage`)
        .send({ paths: ['src/index.ts', 'package.json'] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockGitService.stageFiles).toHaveBeenCalledWith(
        sampleProject.path,
        ['src/index.ts', 'package.json'],
      );
    });

    it('rejects when paths is missing', async () => {
      const res = await request(app)
        .post(`${basePath}/stage`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ===========================================================================
  // POST /stage-all
  // ===========================================================================

  describe('POST /:id/git/stage-all', () => {
    it('stages all files', async () => {
      mockGitService.stageAll.mockResolvedValue(undefined);

      const res = await request(app).post(`${basePath}/stage-all`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockGitService.stageAll).toHaveBeenCalledWith(sampleProject.path);
    });
  });

  // ===========================================================================
  // POST /unstage
  // ===========================================================================

  describe('POST /:id/git/unstage', () => {
    it('unstages specified files', async () => {
      mockGitService.unstageFiles.mockResolvedValue(undefined);

      const res = await request(app)
        .post(`${basePath}/unstage`)
        .send({ paths: ['src/index.ts'] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ===========================================================================
  // POST /unstage-all
  // ===========================================================================

  describe('POST /:id/git/unstage-all', () => {
    it('unstages all files', async () => {
      mockGitService.unstageAll.mockResolvedValue(undefined);

      const res = await request(app).post(`${basePath}/unstage-all`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ===========================================================================
  // POST /commit
  // ===========================================================================

  describe('POST /:id/git/commit', () => {
    it('creates a commit with the given message', async () => {
      const commitResult = { hash: 'abc123', message: 'fix: stuff' };
      mockGitService.commit.mockResolvedValue(commitResult);

      const res = await request(app)
        .post(`${basePath}/commit`)
        .send({ message: 'fix: stuff' });

      expect(res.status).toBe(200);
      expect(res.body.hash).toBe('abc123');
      expect(mockGitService.commit).toHaveBeenCalledWith(
        sampleProject.path, 'fix: stuff',
      );
    });

    it('rejects when message is missing', async () => {
      const res = await request(app)
        .post(`${basePath}/commit`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ===========================================================================
  // POST /branch
  // ===========================================================================

  describe('POST /:id/git/branch', () => {
    it('creates a new branch', async () => {
      mockGitService.createBranch.mockResolvedValue(undefined);

      const res = await request(app)
        .post(`${basePath}/branch`)
        .send({ name: 'feature/new-thing' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('creates and checks out a new branch', async () => {
      mockGitService.createBranch.mockResolvedValue(undefined);

      const res = await request(app)
        .post(`${basePath}/branch`)
        .send({ name: 'feature/new-thing', checkout: true });

      expect(res.status).toBe(200);
      expect(mockGitService.createBranch).toHaveBeenCalledWith(
        sampleProject.path, 'feature/new-thing', true,
      );
    });
  });

  // ===========================================================================
  // POST /checkout
  // ===========================================================================

  describe('POST /:id/git/checkout', () => {
    it('checks out a branch', async () => {
      mockGitService.checkout.mockResolvedValue(undefined);

      const res = await request(app)
        .post(`${basePath}/checkout`)
        .send({ branch: 'develop' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockGitService.checkout).toHaveBeenCalledWith(
        sampleProject.path, 'develop',
      );
    });
  });

  // ===========================================================================
  // POST /push
  // ===========================================================================

  describe('POST /:id/git/push', () => {
    it('pushes to remote', async () => {
      mockGitService.push.mockResolvedValue('Pushed successfully');

      const res = await request(app)
        .post(`${basePath}/push`)
        .send({});

      expect(res.status).toBe(200);
      expect(mockGitService.push).toHaveBeenCalledWith(
        sampleProject.path, 'origin', undefined, undefined,
      );
    });

    it('pushes with custom remote and branch', async () => {
      mockGitService.push.mockResolvedValue('Pushed successfully');

      const res = await request(app)
        .post(`${basePath}/push`)
        .send({ remote: 'upstream', branch: 'main', setUpstream: true });

      expect(res.status).toBe(200);
      expect(mockGitService.push).toHaveBeenCalledWith(
        sampleProject.path, 'upstream', 'main', true,
      );
    });
  });

  // ===========================================================================
  // POST /pull
  // ===========================================================================

  describe('POST /:id/git/pull', () => {
    it('pulls from remote', async () => {
      mockGitService.pull.mockResolvedValue('Pulled successfully');

      const res = await request(app)
        .post(`${basePath}/pull`)
        .send({});

      expect(res.status).toBe(200);
      expect(mockGitService.pull).toHaveBeenCalledWith(
        sampleProject.path, 'origin', undefined, undefined,
      );
    });

    it('pulls with rebase option', async () => {
      mockGitService.pull.mockResolvedValue('Pulled successfully');

      const res = await request(app)
        .post(`${basePath}/pull`)
        .send({ rebase: true });

      expect(res.status).toBe(200);
      expect(mockGitService.pull).toHaveBeenCalledWith(
        sampleProject.path, 'origin', undefined, true,
      );
    });
  });

  // ===========================================================================
  // POST /discard
  // ===========================================================================

  describe('POST /:id/git/discard', () => {
    it('discards changes to specified files', async () => {
      mockGitService.discardChanges.mockResolvedValue(undefined);

      const res = await request(app)
        .post(`${basePath}/discard`)
        .send({ paths: ['src/index.ts'] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ===========================================================================
  // GET /tags
  // ===========================================================================

  describe('GET /:id/git/tags', () => {
    it('lists tags', async () => {
      mockGitService.listTags.mockResolvedValue(['v1.0.0', 'v1.1.0']);

      const res = await request(app).get(`${basePath}/tags`);

      expect(res.status).toBe(200);
      expect(res.body.tags).toEqual(['v1.0.0', 'v1.1.0']);
    });
  });

  // ===========================================================================
  // POST /tags
  // ===========================================================================

  describe('POST /:id/git/tags', () => {
    it('creates a tag', async () => {
      mockGitService.createTag.mockResolvedValue(undefined);

      const res = await request(app)
        .post(`${basePath}/tags`)
        .send({ name: 'v2.0.0', message: 'Release 2.0' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockGitService.createTag).toHaveBeenCalledWith(
        sampleProject.path, 'v2.0.0', 'Release 2.0',
      );
    });

    it('creates a lightweight tag without message', async () => {
      mockGitService.createTag.mockResolvedValue(undefined);

      const res = await request(app)
        .post(`${basePath}/tags`)
        .send({ name: 'v2.0.0' });

      expect(res.status).toBe(200);
    });
  });

  // ===========================================================================
  // GET /github-repo
  // ===========================================================================

  describe('GET /:id/git/github-repo', () => {
    it('extracts repo from SSH remote URL', async () => {
      mockGitService.getRemoteUrl.mockResolvedValue('git@github.com:owner/repo.git');

      const res = await request(app).get(`${basePath}/github-repo`);

      expect(res.status).toBe(200);
      expect(res.body.repo).toBe('owner/repo');
    });

    it('extracts repo from HTTPS remote URL', async () => {
      mockGitService.getRemoteUrl.mockResolvedValue('https://github.com/owner/repo.git');

      const res = await request(app).get(`${basePath}/github-repo`);

      expect(res.status).toBe(200);
      expect(res.body.repo).toBe('owner/repo');
    });

    it('returns null repo when no remote URL', async () => {
      mockGitService.getRemoteUrl.mockResolvedValue(null);

      const res = await request(app).get(`${basePath}/github-repo`);

      expect(res.status).toBe(200);
      expect(res.body.repo).toBeNull();
    });

    it('returns null repo for non-GitHub remote', async () => {
      mockGitService.getRemoteUrl.mockResolvedValue('git@gitlab.com:owner/repo.git');

      const res = await request(app).get(`${basePath}/github-repo`);

      expect(res.status).toBe(200);
      expect(res.body.repo).toBeNull();
    });
  });

  // ===========================================================================
  // GET /user-name
  // ===========================================================================

  describe('GET /:id/git/user-name', () => {
    it('returns the git user name', async () => {
      mockGitService.getUserName.mockResolvedValue('John Doe');

      const res = await request(app).get(`${basePath}/user-name`);

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('John Doe');
    });

    it('returns null when no user name configured', async () => {
      mockGitService.getUserName.mockResolvedValue(null);

      const res = await request(app).get(`${basePath}/user-name`);

      expect(res.status).toBe(200);
      expect(res.body.name).toBeNull();
    });
  });

  // ===========================================================================
  // POST /generate-commit-message
  // ===========================================================================

  describe('POST /:id/git/generate-commit-message', () => {
    it('returns 400 when no staged files', async () => {
      mockGitService.getStatus.mockResolvedValue({
        isRepo: true,
        staged: [],
        unstaged: [],
        untracked: [],
      });

      const res = await request(app).post(`${basePath}/generate-commit-message`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('No staged files');
    });
  });
});
