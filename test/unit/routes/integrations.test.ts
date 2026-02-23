import express from 'express';
import request from 'supertest';
import { createIntegrationsRouter } from '../../../src/routes/integrations';
import { createErrorHandler } from '../../../src/utils/errors';
import {
  createMockGitHubCLIService,
  createMockProjectService,
  createMockProjectRepository,
  createMockSettingsRepository,
  createMockSlackService,
  sampleGitHubRepo,
  sampleGitHubIssue,
  sampleGitHubPR,
} from '../helpers/mock-factories';

describe('Integrations Router', () => {
  function createApp() {
    const githubCLIService = createMockGitHubCLIService();
    const slackService = createMockSlackService();
    const settingsRepository = createMockSettingsRepository();
    const projectService = createMockProjectService();
    const projectRepository = createMockProjectRepository();
    const broadcastMessages: unknown[] = [];
    const app = express();
    app.use(express.json());
    app.use('/integrations', createIntegrationsRouter({
      githubCLIService,
      slackService,
      settingsRepository,
      projectService,
      projectRepository,
      broadcast: (msg) => broadcastMessages.push(msg),
    }));
    app.use(createErrorHandler());
    return { app, githubCLIService, slackService, settingsRepository, projectService, projectRepository, broadcastMessages };
  }

  describe('GET /integrations/github/status', () => {
    it('should return GitHub CLI status', async () => {
      const { app, githubCLIService } = createApp();
      githubCLIService.getStatus.mockResolvedValue({
        installed: true,
        version: '2.45.0',
        authenticated: true,
        username: 'testuser',
        error: null,
      });

      const res = await request(app).get('/integrations/github/status');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        installed: true,
        version: '2.45.0',
        authenticated: true,
        username: 'testuser',
        error: null,
      });
    });

    it('should return not installed status', async () => {
      const { app, githubCLIService } = createApp();
      githubCLIService.getStatus.mockResolvedValue({
        installed: false,
        version: null,
        authenticated: false,
        username: null,
        error: null,
      });

      const res = await request(app).get('/integrations/github/status');

      expect(res.status).toBe(200);
      expect(res.body.installed).toBe(false);
      expect(res.body.version).toBeNull();
    });

    it('should return 500 when service throws', async () => {
      const { app, githubCLIService } = createApp();
      githubCLIService.getStatus.mockRejectedValue(new Error('unexpected'));

      const res = await request(app).get('/integrations/github/status');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /integrations/github/repos', () => {
    it('should return repo list', async () => {
      const { app, githubCLIService } = createApp();
      githubCLIService.listRepos.mockResolvedValue([sampleGitHubRepo]);

      const res = await request(app).get('/integrations/github/repos');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].fullName).toBe('testuser/test-repo');
    });

    it('should pass owner and language filters', async () => {
      const { app, githubCLIService } = createApp();
      githubCLIService.listRepos.mockResolvedValue([]);

      await request(app).get('/integrations/github/repos?owner=myorg&language=Go&limit=10');

      expect(githubCLIService.listRepos).toHaveBeenCalledWith({
        owner: 'myorg',
        language: 'Go',
        limit: 10,
      });
    });

    it('should return 500 when service throws', async () => {
      const { app, githubCLIService } = createApp();
      githubCLIService.listRepos.mockRejectedValue(new Error('gh error'));

      const res = await request(app).get('/integrations/github/repos');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /integrations/github/repos/search', () => {
    it('should return search results', async () => {
      const { app, githubCLIService } = createApp();
      githubCLIService.searchRepos.mockResolvedValue([sampleGitHubRepo]);

      const res = await request(app).get('/integrations/github/repos/search?query=test');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('should return 400 when query is missing', async () => {
      const { app } = createApp();

      const res = await request(app).get('/integrations/github/repos/search');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('query');
    });

    it('should pass language and sort options', async () => {
      const { app, githubCLIService } = createApp();
      githubCLIService.searchRepos.mockResolvedValue([]);

      await request(app).get('/integrations/github/repos/search?query=cli&language=Rust&sort=stars');

      expect(githubCLIService.searchRepos).toHaveBeenCalledWith({
        query: 'cli',
        language: 'Rust',
        sort: 'stars',
        limit: undefined,
      });
    });
  });

  describe('POST /integrations/github/clone', () => {
    it('should clone and register project', async () => {
      const { app, githubCLIService, projectService } = createApp();
      githubCLIService.cloneRepo.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/integrations/github/clone')
        .send({ repo: 'user/my-repo', targetDir: '/home/user/projects' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(githubCLIService.cloneRepo).toHaveBeenCalled();
      expect(projectService.createProject).toHaveBeenCalledWith({
        name: 'my-repo',
        path: expect.stringContaining('my-repo'),
        createNew: false,
      });
    });

    it('should use custom project name', async () => {
      const { app, githubCLIService, projectService } = createApp();
      githubCLIService.cloneRepo.mockResolvedValue(undefined);

      await request(app)
        .post('/integrations/github/clone')
        .send({ repo: 'user/my-repo', targetDir: '/home/user/projects', projectName: 'Custom Name' });

      expect(projectService.createProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Custom Name' })
      );
    });

    it('should pass branch to cloneRepo', async () => {
      const { app, githubCLIService } = createApp();
      githubCLIService.cloneRepo.mockResolvedValue(undefined);

      await request(app)
        .post('/integrations/github/clone')
        .send({ repo: 'user/my-repo', targetDir: '/home/user/projects', branch: 'develop' });

      const cloneOptions = githubCLIService.cloneRepo.mock.calls[0]![0];
      expect(cloneOptions.branch).toBe('develop');
    });

    it('should return 400 when repo is missing', async () => {
      const { app } = createApp();

      const res = await request(app)
        .post('/integrations/github/clone')
        .send({ targetDir: '/home/user/projects' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('repo');
    });

    it('should return 400 when targetDir is missing', async () => {
      const { app } = createApp();

      const res = await request(app)
        .post('/integrations/github/clone')
        .send({ repo: 'user/repo' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('targetDir');
    });

    it('should return 400 when targetDir is not absolute', async () => {
      const { app } = createApp();

      const res = await request(app)
        .post('/integrations/github/clone')
        .send({ repo: 'user/repo', targetDir: 'relative/path' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('absolute');
    });

    it('should return error when clone fails', async () => {
      const { app, githubCLIService } = createApp();
      githubCLIService.cloneRepo.mockRejectedValue(new Error('clone failed'));

      const res = await request(app)
        .post('/integrations/github/clone')
        .send({ repo: 'user/repo', targetDir: '/home/user/projects' });

      expect(res.status).toBe(500);
    });

    it('should return error when project registration fails', async () => {
      const { app, githubCLIService, projectService } = createApp();
      githubCLIService.cloneRepo.mockResolvedValue(undefined);
      projectService.createProject.mockResolvedValue({ success: false, error: 'Already exists' });

      const res = await request(app)
        .post('/integrations/github/clone')
        .send({ repo: 'user/repo', targetDir: '/home/user/projects' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Already exists');
    });
  });

  describe('GET /integrations/github/issues', () => {
    it('should return issue list', async () => {
      const { app, githubCLIService } = createApp();
      githubCLIService.listIssues.mockResolvedValue([sampleGitHubIssue]);

      const res = await request(app).get('/integrations/github/issues?repo=user/repo');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].number).toBe(42);
      expect(res.body[0].title).toBe('Test issue');
    });

    it('should return 400 when repo is missing', async () => {
      const { app } = createApp();

      const res = await request(app).get('/integrations/github/issues');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('repo');
    });

    it('should pass filter options', async () => {
      const { app, githubCLIService } = createApp();
      githubCLIService.listIssues.mockResolvedValue([]);

      await request(app).get(
        '/integrations/github/issues?repo=user/repo&state=closed&label=bug&assignee=me&limit=10'
      );

      expect(githubCLIService.listIssues).toHaveBeenCalledWith({
        repo: 'user/repo',
        state: 'closed',
        label: 'bug',
        assignee: 'me',
        milestone: undefined,
        limit: 10,
      });
    });

    it('should return 500 when service throws', async () => {
      const { app, githubCLIService } = createApp();
      githubCLIService.listIssues.mockRejectedValue(new Error('gh error'));

      const res = await request(app).get('/integrations/github/issues?repo=user/repo');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /integrations/github/issues/:issueNumber', () => {
    it('should return issue detail with comments', async () => {
      const { app, githubCLIService } = createApp();
      githubCLIService.viewIssue.mockResolvedValue({
        issue: sampleGitHubIssue,
        comments: [{ author: 'user', body: 'A comment', createdAt: '2024-06-02T00:00:00Z' }],
      });

      const res = await request(app).get('/integrations/github/issues/42?repo=user/repo');

      expect(res.status).toBe(200);
      expect(res.body.issue.number).toBe(42);
      expect(res.body.comments).toHaveLength(1);
    });

    it('should return 400 when repo is missing', async () => {
      const { app } = createApp();

      const res = await request(app).get('/integrations/github/issues/42');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('repo');
    });

    it('should return 400 for non-numeric issue number', async () => {
      const { app } = createApp();

      const res = await request(app).get('/integrations/github/issues/abc?repo=user/repo');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('number');
    });
  });

  describe('POST /integrations/github/issues/:issueNumber/close', () => {
    it('should close the issue', async () => {
      const { app, githubCLIService } = createApp();

      const res = await request(app).post('/integrations/github/issues/42/close?repo=user/repo');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(githubCLIService.closeIssue).toHaveBeenCalledWith('user/repo', 42);
    });

    it('should return 400 when repo is missing', async () => {
      const { app } = createApp();

      const res = await request(app).post('/integrations/github/issues/42/close');

      expect(res.status).toBe(400);
    });
  });

  describe('POST /integrations/github/issues/:issueNumber/comment', () => {
    it('should add a comment', async () => {
      const { app, githubCLIService } = createApp();

      const res = await request(app)
        .post('/integrations/github/issues/42/comment?repo=user/repo')
        .send({ body: 'Progress update' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(githubCLIService.commentOnIssue).toHaveBeenCalledWith('user/repo', 42, 'Progress update');
    });

    it('should return 400 when body is missing', async () => {
      const { app } = createApp();

      const res = await request(app)
        .post('/integrations/github/issues/42/comment?repo=user/repo')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('body');
    });

    it('should return 400 when repo is missing', async () => {
      const { app } = createApp();

      const res = await request(app)
        .post('/integrations/github/issues/42/comment')
        .send({ body: 'Test' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /integrations/github/issues', () => {
    it('should create an issue', async () => {
      const { app, githubCLIService } = createApp();

      const res = await request(app)
        .post('/integrations/github/issues')
        .send({ repo: 'owner/repo', title: 'Bug report', body: 'Broken', labels: ['bug'], assignees: ['dev1'] });

      expect(res.status).toBe(200);
      expect(res.body.number).toBeDefined();
      expect(githubCLIService.createIssue).toHaveBeenCalledWith({
        repo: 'owner/repo',
        title: 'Bug report',
        body: 'Broken',
        labels: ['bug'],
        assignees: ['dev1'],
        milestone: undefined,
      });
    });

    it('should return 400 when repo is missing', async () => {
      const { app } = createApp();

      const res = await request(app)
        .post('/integrations/github/issues')
        .send({ title: 'Test' });

      expect(res.status).toBe(400);
    });

    it('should return 400 when title is missing', async () => {
      const { app } = createApp();

      const res = await request(app)
        .post('/integrations/github/issues')
        .send({ repo: 'owner/repo' });

      expect(res.status).toBe(400);
    });

    it('should default optional fields', async () => {
      const { app, githubCLIService } = createApp();

      const res = await request(app)
        .post('/integrations/github/issues')
        .send({ repo: 'owner/repo', title: 'Minimal issue' });

      expect(res.status).toBe(200);
      expect(githubCLIService.createIssue).toHaveBeenCalledWith({
        repo: 'owner/repo',
        title: 'Minimal issue',
        body: '',
        labels: [],
        assignees: [],
        milestone: undefined,
      });
    });
  });

  describe('GET /integrations/github/labels', () => {
    it('should return labels', async () => {
      const { app, githubCLIService } = createApp();

      const res = await request(app).get('/integrations/github/labels?repo=owner/repo');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(githubCLIService.listLabels).toHaveBeenCalledWith('owner/repo');
    });

    it('should return 400 when repo is missing', async () => {
      const { app } = createApp();

      const res = await request(app).get('/integrations/github/labels');

      expect(res.status).toBe(400);
    });
  });

  describe('GET /integrations/github/milestones', () => {
    it('should return milestones', async () => {
      const { app, githubCLIService } = createApp();

      const res = await request(app).get('/integrations/github/milestones?repo=owner/repo');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(githubCLIService.listMilestones).toHaveBeenCalledWith('owner/repo');
    });

    it('should return 400 when repo is missing', async () => {
      const { app } = createApp();

      const res = await request(app).get('/integrations/github/milestones');

      expect(res.status).toBe(400);
    });
  });

  describe('GET /integrations/github/collaborators', () => {
    it('should return collaborators', async () => {
      const { app, githubCLIService } = createApp();

      const res = await request(app).get('/integrations/github/collaborators?repo=owner/repo');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(githubCLIService.listCollaborators).toHaveBeenCalledWith('owner/repo');
    });

    it('should return 400 when repo is missing', async () => {
      const { app } = createApp();

      const res = await request(app).get('/integrations/github/collaborators');

      expect(res.status).toBe(400);
    });
  });

  describe('POST /integrations/github/pr', () => {
    it('should create a PR', async () => {
      const { app, githubCLIService } = createApp();
      githubCLIService.createPR.mockResolvedValue({ ...sampleGitHubPR });

      const res = await request(app)
        .post('/integrations/github/pr')
        .send({ repo: 'owner/repo', title: 'Test PR', body: 'Description' });

      expect(res.status).toBe(200);
      expect(res.body.number).toBe(10);
      expect(githubCLIService.createPR).toHaveBeenCalledWith({
        repo: 'owner/repo',
        title: 'Test PR',
        body: 'Description',
        base: undefined,
        head: undefined,
        draft: undefined,
        cwd: undefined,
      });
    });

    it('should require repo', async () => {
      const { app } = createApp();

      const res = await request(app)
        .post('/integrations/github/pr')
        .send({ title: 'Test' });

      expect(res.status).toBe(400);
    });

    it('should require title', async () => {
      const { app } = createApp();

      const res = await request(app)
        .post('/integrations/github/pr')
        .send({ repo: 'owner/repo' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /integrations/github/pulls', () => {
    it('should list PRs for a repo', async () => {
      const { app, githubCLIService } = createApp();
      githubCLIService.listPRs.mockResolvedValue([{ ...sampleGitHubPR }]);

      const res = await request(app)
        .get('/integrations/github/pulls?repo=owner/repo');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].number).toBe(10);
    });

    it('should require repo parameter', async () => {
      const { app } = createApp();

      const res = await request(app)
        .get('/integrations/github/pulls');

      expect(res.status).toBe(400);
    });

    it('should pass state and limit options', async () => {
      const { app, githubCLIService } = createApp();
      githubCLIService.listPRs.mockResolvedValue([]);

      await request(app)
        .get('/integrations/github/pulls?repo=owner/repo&state=closed&limit=10');

      expect(githubCLIService.listPRs).toHaveBeenCalledWith({
        repo: 'owner/repo',
        state: 'closed',
        limit: 10,
      });
    });
  });

  describe('GET /integrations/github/pulls/:prNumber', () => {
    it('should return PR detail', async () => {
      const { app, githubCLIService } = createApp();

      const res = await request(app)
        .get('/integrations/github/pulls/10?repo=owner/repo');

      expect(res.status).toBe(200);
      expect(res.body.pr.number).toBe(10);
      expect(githubCLIService.viewPR).toHaveBeenCalledWith({
        repo: 'owner/repo',
        prNumber: 10,
      });
    });

    it('should require repo parameter', async () => {
      const { app } = createApp();

      const res = await request(app)
        .get('/integrations/github/pulls/10');

      expect(res.status).toBe(400);
    });

    it('should validate prNumber is numeric', async () => {
      const { app } = createApp();

      const res = await request(app)
        .get('/integrations/github/pulls/abc?repo=owner/repo');

      expect(res.status).toBe(400);
    });
  });

  describe('POST /integrations/github/pulls/:prNumber/comment', () => {
    it('should add a comment to the PR', async () => {
      const { app, githubCLIService } = createApp();

      const res = await request(app)
        .post('/integrations/github/pulls/10/comment?repo=owner/repo')
        .send({ body: 'Ready for review' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(githubCLIService.commentOnPR).toHaveBeenCalledWith('owner/repo', 10, 'Ready for review');
    });

    it('should return 400 when repo is missing', async () => {
      const { app } = createApp();

      const res = await request(app)
        .post('/integrations/github/pulls/10/comment')
        .send({ body: 'Test' });

      expect(res.status).toBe(400);
    });

    it('should return 400 when body is missing', async () => {
      const { app } = createApp();

      const res = await request(app)
        .post('/integrations/github/pulls/10/comment?repo=owner/repo')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('body');
    });
  });

  describe('POST /integrations/github/pulls/:prNumber/merge', () => {
    it('should merge with default strategy', async () => {
      const { app, githubCLIService } = createApp();

      const res = await request(app)
        .post('/integrations/github/pulls/10/merge?repo=owner/repo')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(githubCLIService.mergePR).toHaveBeenCalledWith('owner/repo', 10, undefined);
    });

    it('should pass squash method', async () => {
      const { app, githubCLIService } = createApp();

      const res = await request(app)
        .post('/integrations/github/pulls/10/merge?repo=owner/repo')
        .send({ method: 'squash' });

      expect(res.status).toBe(200);
      expect(githubCLIService.mergePR).toHaveBeenCalledWith('owner/repo', 10, 'squash');
    });

    it('should mark draft PR as ready before merging', async () => {
      const { app, githubCLIService } = createApp();

      const res = await request(app)
        .post('/integrations/github/pulls/10/merge?repo=owner/repo')
        .send({ isDraft: true });

      expect(res.status).toBe(200);
      expect(githubCLIService.markPRReady).toHaveBeenCalledWith('owner/repo', 10);
      expect(githubCLIService.mergePR).toHaveBeenCalledWith('owner/repo', 10, undefined);
    });

    it('should not mark non-draft PR as ready', async () => {
      const { app, githubCLIService } = createApp();

      const res = await request(app)
        .post('/integrations/github/pulls/10/merge?repo=owner/repo')
        .send({ isDraft: false });

      expect(res.status).toBe(200);
      expect(githubCLIService.markPRReady).not.toHaveBeenCalled();
      expect(githubCLIService.mergePR).toHaveBeenCalledWith('owner/repo', 10, undefined);
    });

    it('should return 400 when repo is missing', async () => {
      const { app } = createApp();

      const res = await request(app)
        .post('/integrations/github/pulls/10/merge')
        .send({});

      expect(res.status).toBe(400);
    });
  });
});
