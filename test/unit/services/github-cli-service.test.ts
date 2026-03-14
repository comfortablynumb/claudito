import { EventEmitter } from 'events';
import { DefaultGitHubCLIService } from '../../../src/services/github-cli-service';
import { createMockCommandRunner } from '../helpers/mock-factories';

describe('DefaultGitHubCLIService', () => {
  function createService(runner = createMockCommandRunner()) {
    return { service: new DefaultGitHubCLIService(runner), runner };
  }

  describe('getStatus', () => {
    it('should return not installed when gh command fails', async () => {
      const { service, runner } = createService();
      runner.exec.mockRejectedValue(new Error('command not found'));

      const status = await service.getStatus();

      expect(status.installed).toBe(false);
      expect(status.version).toBeNull();
      expect(status.authenticated).toBe(false);
      expect(status.username).toBeNull();
    });

    it('should return installed but not authenticated', async () => {
      const { service, runner } = createService();
      runner.exec.mockImplementation((_cmd, args) => {
        if (args[0] === '--version') {
          return Promise.resolve({ stdout: 'gh version 2.45.0 (2024-01-15)\n', stderr: '' });
        }

        const error = new Error('not logged in') as Error & { stderr: string };
        error.stderr = 'You are not logged into any GitHub hosts.';
        return Promise.reject(error);
      });

      const status = await service.getStatus();

      expect(status.installed).toBe(true);
      expect(status.version).toBe('2.45.0');
      expect(status.authenticated).toBe(false);
      expect(status.username).toBeNull();
      expect(status.error).toBeNull();
    });

    it('should return installed and authenticated with username', async () => {
      const { service, runner } = createService();
      runner.exec.mockImplementation((_cmd, args) => {
        if (args[0] === '--version') {
          return Promise.resolve({ stdout: 'gh version 2.45.0 (2024-01-15)\n', stderr: '' });
        }

        return Promise.resolve({
          stdout: 'Logged in to github.com account myuser (keyring)',
          stderr: '',
        });
      });

      const status = await service.getStatus();

      expect(status.installed).toBe(true);
      expect(status.version).toBe('2.45.0');
      expect(status.authenticated).toBe(true);
      expect(status.username).toBe('myuser');
      expect(status.error).toBeNull();
    });

    it('should return error when auth check fails unexpectedly', async () => {
      const { service, runner } = createService();
      runner.exec.mockImplementation((_cmd, args) => {
        if (args[0] === '--version') {
          return Promise.resolve({ stdout: 'gh version 2.45.0 (2024-01-15)\n', stderr: '' });
        }

        const error = new Error('connection timeout') as Error & { stderr: string };
        error.stderr = 'connection timeout';
        return Promise.reject(error);
      });

      const status = await service.getStatus();

      expect(status.installed).toBe(true);
      expect(status.version).toBe('2.45.0');
      expect(status.authenticated).toBe(false);
      expect(status.error).toContain('Auth check failed');
    });
  });

  describe('isAvailable', () => {
    it('should return true when gh is installed', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({ stdout: 'gh version 2.45.0\n', stderr: '' });

      expect(await service.isAvailable()).toBe(true);
    });

    it('should return false when gh is not installed', async () => {
      const { service, runner } = createService();
      runner.exec.mockRejectedValue(new Error('not found'));

      expect(await service.isAvailable()).toBe(false);
    });
  });

  describe('listRepos', () => {
    const sampleRepoJson = JSON.stringify([
      {
        name: 'my-repo',
        nameWithOwner: 'user/my-repo',
        description: 'A sample repo',
        url: 'https://github.com/user/my-repo',
        isPrivate: false,
        primaryLanguage: { name: 'TypeScript' },
        updatedAt: '2024-06-01T00:00:00Z',
        stargazerCount: 10,
      },
    ]);

    it('should parse repo list output', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({ stdout: sampleRepoJson, stderr: '' });

      const repos = await service.listRepos();

      expect(repos).toHaveLength(1);
      expect(repos[0]!.name).toBe('my-repo');
      expect(repos[0]!.fullName).toBe('user/my-repo');
      expect(repos[0]!.language).toBe('TypeScript');
      expect(repos[0]!.isPrivate).toBe(false);
    });

    it('should pass owner and language as args', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({ stdout: '[]', stderr: '' });

      await service.listRepos({ owner: 'myorg', language: 'Go', limit: 10 });

      const args = runner.exec.mock.calls[0]![1] as string[];
      expect(args).toContain('myorg');
      expect(args).toContain('--language');
      expect(args).toContain('Go');
      expect(args).toContain('10');
    });

    it('should throw GitHubCLIError on failure', async () => {
      const { service, runner } = createService();
      runner.exec.mockRejectedValue(new Error('no auth'));

      await expect(service.listRepos()).rejects.toThrow('Failed to list repos');
    });

    it('should handle null primaryLanguage', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({
        stdout: JSON.stringify([{
          name: 'no-lang',
          nameWithOwner: 'user/no-lang',
          description: null,
          url: 'https://github.com/user/no-lang',
          isPrivate: true,
          primaryLanguage: null,
          updatedAt: '2024-01-01T00:00:00Z',
          stargazerCount: 0,
        }]),
        stderr: '',
      });

      const repos = await service.listRepos();

      expect(repos[0]!.language).toBeNull();
      expect(repos[0]!.description).toBeNull();
    });
  });

  describe('searchRepos', () => {
    it('should parse search output', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({
        stdout: JSON.stringify([{
          name: 'found-repo',
          nameWithOwner: 'org/found-repo',
          description: 'Found it',
          url: 'https://github.com/org/found-repo',
          isPrivate: false,
          primaryLanguage: { name: 'Rust' },
          updatedAt: '2024-05-01T00:00:00Z',
          stargazerCount: 100,
        }]),
        stderr: '',
      });

      const repos = await service.searchRepos({ query: 'test' });

      expect(repos).toHaveLength(1);
      expect(repos[0]!.fullName).toBe('org/found-repo');
      expect(repos[0]!.language).toBe('Rust');
    });

    it('should pass query, language and sort args', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({ stdout: '[]', stderr: '' });

      await service.searchRepos({ query: 'cli tool', language: 'Go', sort: 'stars', limit: 5 });

      const args = runner.exec.mock.calls[0]![1] as string[];
      expect(args).toContain('cli tool');
      expect(args).toContain('--language');
      expect(args).toContain('Go');
      expect(args).toContain('--sort');
      expect(args).toContain('stars');
      expect(args).toContain('5');
    });

    it('should throw GitHubCLIError on failure', async () => {
      const { service, runner } = createService();
      runner.exec.mockRejectedValue(new Error('network error'));

      await expect(service.searchRepos({ query: 'test' })).rejects.toThrow('Failed to search repos');
    });
  });

  describe('listIssues', () => {
    const sampleIssueJson = JSON.stringify([
      {
        number: 1,
        title: 'Bug report',
        body: 'Something is broken',
        state: 'OPEN',
        url: 'https://github.com/user/repo/issues/1',
        author: { login: 'reporter' },
        labels: [{ name: 'bug' }],
        assignees: [{ login: 'dev' }],
        milestone: { title: 'v1.0' },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        comments: [{ author: { login: 'dev' }, body: 'On it', createdAt: '2024-01-02T00:00:00Z' }],
      },
    ]);

    it('should parse issue list output', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({ stdout: sampleIssueJson, stderr: '' });

      const issues = await service.listIssues({ repo: 'user/repo' });

      expect(issues).toHaveLength(1);
      expect(issues[0]!.number).toBe(1);
      expect(issues[0]!.title).toBe('Bug report');
      expect(issues[0]!.author).toBe('reporter');
      expect(issues[0]!.labels).toEqual(['bug']);
      expect(issues[0]!.assignees).toEqual(['dev']);
      expect(issues[0]!.milestone).toBe('v1.0');
      expect(issues[0]!.commentsCount).toBe(1);
    });

    it('should pass repo, state, label, assignee, milestone args', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({ stdout: '[]', stderr: '' });

      await service.listIssues({
        repo: 'org/repo',
        state: 'closed',
        label: 'bug',
        assignee: 'me',
        milestone: 'v2',
        limit: 10,
      });

      const args = runner.exec.mock.calls[0]![1] as string[];
      expect(args).toContain('--repo');
      expect(args).toContain('org/repo');
      expect(args).toContain('--state');
      expect(args).toContain('closed');
      expect(args).toContain('--label');
      expect(args).toContain('bug');
      expect(args).toContain('--assignee');
      expect(args).toContain('me');
      expect(args).toContain('--milestone');
      expect(args).toContain('v2');
    });

    it('should throw GitHubCLIError on failure', async () => {
      const { service, runner } = createService();
      runner.exec.mockRejectedValue(new Error('no auth'));

      await expect(service.listIssues({ repo: 'user/repo' })).rejects.toThrow('Failed to list issues');
    });

    it('should handle null milestone and empty arrays', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({
        stdout: JSON.stringify([{
          number: 2,
          title: 'Minimal issue',
          body: '',
          state: 'OPEN',
          url: 'https://github.com/user/repo/issues/2',
          author: { login: 'user' },
          labels: [],
          assignees: [],
          milestone: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          comments: [],
        }]),
        stderr: '',
      });

      const issues = await service.listIssues({ repo: 'user/repo' });

      expect(issues[0]!.milestone).toBeNull();
      expect(issues[0]!.labels).toEqual([]);
      expect(issues[0]!.commentsCount).toBe(0);
    });
  });

  describe('viewIssue', () => {
    it('should return issue detail with comments', async () => {
      const { service, runner } = createService();

      // First call: issue view; Second call: comments API
      runner.exec.mockImplementation((_cmd, args) => {
        if (args[0] === 'issue' && args[1] === 'view') {
          return Promise.resolve({
            stdout: JSON.stringify({
              number: 5,
              title: 'Feature request',
              body: 'Please add this',
              state: 'OPEN',
              url: 'https://github.com/user/repo/issues/5',
              author: { login: 'requester' },
              labels: [{ name: 'enhancement' }],
              assignees: [],
              milestone: null,
              createdAt: '2024-03-01T00:00:00Z',
              updatedAt: '2024-03-02T00:00:00Z',
              comments: [],
            }),
            stderr: '',
          });
        }

        if (args[0] === 'api') {
          return Promise.resolve({
            stdout: JSON.stringify([
              { author: 'commenter', body: 'Good idea!', createdAt: '2024-03-02T00:00:00Z' },
            ]),
            stderr: '',
          });
        }

        return Promise.resolve({ stdout: '', stderr: '' });
      });

      const detail = await service.viewIssue({ repo: 'user/repo', issueNumber: 5 });

      expect(detail.issue.number).toBe(5);
      expect(detail.issue.title).toBe('Feature request');
      expect(detail.comments).toHaveLength(1);
    });

    it('should throw GitHubCLIError on failure', async () => {
      const { service, runner } = createService();
      runner.exec.mockRejectedValue(new Error('not found'));

      await expect(service.viewIssue({ repo: 'user/repo', issueNumber: 999 }))
        .rejects.toThrow('Failed to view issue');
    });
  });

  describe('closeIssue', () => {
    it('should call gh issue close', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      await service.closeIssue('user/repo', 42);

      const args = runner.exec.mock.calls[0]![1] as string[];
      expect(args).toContain('issue');
      expect(args).toContain('close');
      expect(args).toContain('42');
      expect(args).toContain('--repo');
      expect(args).toContain('user/repo');
    });

    it('should throw GitHubCLIError on failure', async () => {
      const { service, runner } = createService();
      runner.exec.mockRejectedValue(new Error('forbidden'));

      await expect(service.closeIssue('user/repo', 42)).rejects.toThrow('Failed to close issue');
    });
  });

  describe('commentOnIssue', () => {
    it('should call gh issue comment', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      await service.commentOnIssue('user/repo', 42, 'Fixed in PR #10');

      const args = runner.exec.mock.calls[0]![1] as string[];
      expect(args).toContain('issue');
      expect(args).toContain('comment');
      expect(args).toContain('42');
      expect(args).toContain('--body');
      expect(args).toContain('Fixed in PR #10');
    });

    it('should throw GitHubCLIError on failure', async () => {
      const { service, runner } = createService();
      runner.exec.mockRejectedValue(new Error('rate limited'));

      await expect(service.commentOnIssue('user/repo', 42, 'test'))
        .rejects.toThrow('Failed to comment on issue');
    });
  });

  describe('createIssue', () => {
    it('should create an issue and fetch details via issue view', async () => {
      const { service, runner } = createService();
      const issueData = {
        number: 15,
        title: 'Bug report',
        body: 'Something broke',
        state: 'OPEN',
        url: 'https://github.com/owner/repo/issues/15',
        author: { login: 'user' },
        labels: [{ name: 'bug' }],
        assignees: [{ login: 'dev1' }],
        milestone: { title: 'v1.0' },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        comments: { totalCount: 0 },
      };
      runner.exec
        .mockResolvedValueOnce({ stdout: 'https://github.com/owner/repo/issues/15\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: JSON.stringify(issueData), stderr: '' });

      const result = await service.createIssue({
        repo: 'owner/repo',
        title: 'Bug report',
        body: 'Something broke',
        labels: ['bug'],
        assignees: ['dev1'],
        milestone: 'v1.0',
      });

      expect(result.number).toBe(15);
      expect(result.title).toBe('Bug report');

      const createArgs = runner.exec.mock.calls[0]![1] as string[];
      expect(createArgs).toContain('issue');
      expect(createArgs).toContain('create');
      expect(createArgs).toContain('--label');
      expect(createArgs).toContain('bug');
      expect(createArgs).toContain('--assignee');
      expect(createArgs).toContain('dev1');
      expect(createArgs).toContain('--milestone');
      expect(createArgs).toContain('v1.0');

      const viewArgs = runner.exec.mock.calls[1]![1] as string[];
      expect(viewArgs).toContain('issue');
      expect(viewArgs).toContain('view');
      expect(viewArgs).toContain('15');
    });

    it('should create an issue with only required fields', async () => {
      const { service, runner } = createService();
      const issueData = {
        number: 16,
        title: 'Simple issue',
        body: '',
        state: 'OPEN',
        url: 'https://github.com/owner/repo/issues/16',
        author: { login: 'user' },
        labels: [],
        assignees: [],
        milestone: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        comments: { totalCount: 0 },
      };
      runner.exec
        .mockResolvedValueOnce({ stdout: 'https://github.com/owner/repo/issues/16\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: JSON.stringify(issueData), stderr: '' });

      await service.createIssue({ repo: 'owner/repo', title: 'Simple issue' });

      const createArgs = runner.exec.mock.calls[0]![1] as string[];
      expect(createArgs).not.toContain('--label');
      expect(createArgs).not.toContain('--assignee');
      expect(createArgs).not.toContain('--milestone');
    });

    it('should throw on failure', async () => {
      const { service, runner } = createService();
      runner.exec.mockRejectedValue(new Error('permission denied'));

      await expect(service.createIssue({
        repo: 'owner/repo', title: 'test',
      })).rejects.toThrow('Failed to create issue');
    });
  });

  describe('listLabels', () => {
    it('should return labels for a repo', async () => {
      const { service, runner } = createService();
      const labels = [
        { name: 'bug', color: 'fc2929', description: 'Something broken' },
        { name: 'enhancement', color: '84b6eb', description: 'New feature' },
      ];
      runner.exec.mockResolvedValue({ stdout: JSON.stringify(labels), stderr: '' });

      const result = await service.listLabels('owner/repo');

      expect(result).toHaveLength(2);
      expect(result[0]!.name).toBe('bug');

      const args = runner.exec.mock.calls[0]![1] as string[];
      expect(args).toContain('label');
      expect(args).toContain('list');
      expect(args).toContain('--repo');
      expect(args).toContain('owner/repo');
    });

    it('should throw on failure', async () => {
      const { service, runner } = createService();
      runner.exec.mockRejectedValue(new Error('not found'));

      await expect(service.listLabels('owner/repo')).rejects.toThrow('Failed to list labels');
    });
  });

  describe('listMilestones', () => {
    it('should return milestones for a repo', async () => {
      const { service, runner } = createService();
      const milestones = [{ title: 'v1.0', number: 1, state: 'open' }];
      runner.exec.mockResolvedValue({ stdout: JSON.stringify(milestones), stderr: '' });

      const result = await service.listMilestones('owner/repo');

      expect(result).toHaveLength(1);
      expect(result[0]!.title).toBe('v1.0');

      const args = runner.exec.mock.calls[0]![1] as string[];
      expect(args).toContain('api');
      expect(args).toContain('repos/owner/repo/milestones');
    });

    it('should throw on failure', async () => {
      const { service, runner } = createService();
      runner.exec.mockRejectedValue(new Error('forbidden'));

      await expect(service.listMilestones('owner/repo')).rejects.toThrow('Failed to list milestones');
    });
  });

  describe('listCollaborators', () => {
    it('should return collaborators for a repo', async () => {
      const { service, runner } = createService();
      const collaborators = [{ login: 'user1' }, { login: 'user2' }];
      runner.exec.mockResolvedValue({ stdout: JSON.stringify(collaborators), stderr: '' });

      const result = await service.listCollaborators('owner/repo');

      expect(result).toHaveLength(2);
      expect(result[0]!.login).toBe('user1');

      const args = runner.exec.mock.calls[0]![1] as string[];
      expect(args).toContain('api');
      expect(args).toContain('repos/owner/repo/collaborators');
    });

    it('should throw on failure', async () => {
      const { service, runner } = createService();
      runner.exec.mockRejectedValue(new Error('not found'));

      await expect(service.listCollaborators('owner/repo')).rejects.toThrow('Failed to list collaborators');
    });
  });

  describe('commentOnPR', () => {
    it('should call gh pr comment with correct args', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      await service.commentOnPR('user/repo', 10, 'Ready for review');

      const args = runner.exec.mock.calls[0]![1] as string[];
      expect(args).toContain('pr');
      expect(args).toContain('comment');
      expect(args).toContain('10');
      expect(args).toContain('--repo');
      expect(args).toContain('user/repo');
      expect(args).toContain('--body');
      expect(args).toContain('Ready for review');
    });

    it('should throw GitHubCLIError on failure', async () => {
      const { service, runner } = createService();
      runner.exec.mockRejectedValue(new Error('forbidden'));

      await expect(service.commentOnPR('user/repo', 10, 'test'))
        .rejects.toThrow('Failed to comment on PR');
    });
  });

  describe('markPRReady', () => {
    it('should call gh pr ready with correct args', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      await service.markPRReady('user/repo', 10);

      const args = runner.exec.mock.calls[0]![1] as string[];
      expect(args).toContain('pr');
      expect(args).toContain('ready');
      expect(args).toContain('10');
      expect(args).toContain('--repo');
      expect(args).toContain('user/repo');
    });

    it('should throw GitHubCLIError on failure', async () => {
      const { service, runner } = createService();
      runner.exec.mockRejectedValue(new Error('not a draft'));

      await expect(service.markPRReady('user/repo', 10))
        .rejects.toThrow('Failed to mark PR as ready');
    });
  });

  describe('mergePR', () => {
    it('should call gh pr merge with default merge strategy', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      await service.mergePR('user/repo', 10);

      const args = runner.exec.mock.calls[0]![1] as string[];
      expect(args).toContain('pr');
      expect(args).toContain('merge');
      expect(args).toContain('10');
      expect(args).toContain('--repo');
      expect(args).toContain('user/repo');
      expect(args).toContain('--merge');
      expect(args).toContain('--delete-branch');
    });

    it('should use squash strategy when specified', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      await service.mergePR('user/repo', 10, 'squash');

      const args = runner.exec.mock.calls[0]![1] as string[];
      expect(args).toContain('--squash');
      expect(args).not.toContain('--merge');
    });

    it('should use rebase strategy when specified', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      await service.mergePR('user/repo', 10, 'rebase');

      const args = runner.exec.mock.calls[0]![1] as string[];
      expect(args).toContain('--rebase');
    });

    it('should throw GitHubCLIError on failure', async () => {
      const { service, runner } = createService();
      runner.exec.mockRejectedValue(new Error('merge conflict'));

      await expect(service.mergePR('user/repo', 10))
        .rejects.toThrow('Failed to merge PR');
    });
  });

  describe('cloneRepo', () => {
    function createMockChildProcess() {
      const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter; stdout: EventEmitter };
      child.stderr = new EventEmitter();
      child.stdout = new EventEmitter();
      return child;
    }

    it('should call spawn with correct args', async () => {
      const { service, runner } = createService();
      const child = createMockChildProcess();
      runner.spawn.mockReturnValue(child as any);

      const promise = service.cloneRepo({ repo: 'user/repo', targetDir: '/tmp/repo' });

      // Simulate successful clone
      child.emit('close', 0);
      await promise;

      expect(runner.spawn).toHaveBeenCalledWith('gh', ['repo', 'clone', 'user/repo', '/tmp/repo']);
    });

    it('should add branch args when specified', async () => {
      const { service, runner } = createService();
      const child = createMockChildProcess();
      runner.spawn.mockReturnValue(child as any);

      const promise = service.cloneRepo({ repo: 'user/repo', targetDir: '/tmp/repo', branch: 'develop' });
      child.emit('close', 0);
      await promise;

      expect(runner.spawn).toHaveBeenCalledWith(
        'gh',
        ['repo', 'clone', 'user/repo', '/tmp/repo', '--', '--branch', 'develop']
      );
    });

    it('should call progress callback', async () => {
      const { service, runner } = createService();
      const child = createMockChildProcess();
      runner.spawn.mockReturnValue(child as any);

      const progress: string[] = [];
      const promise = service.cloneRepo(
        { repo: 'user/repo', targetDir: '/tmp/repo' },
        (p) => progress.push(p.phase)
      );

      child.stderr.emit('data', Buffer.from('Cloning...'));
      child.emit('close', 0);
      await promise;

      expect(progress).toContain('cloning');
      expect(progress).toContain('done');
    });

    it('should reject on non-zero exit code', async () => {
      const { service, runner } = createService();
      const child = createMockChildProcess();
      runner.spawn.mockReturnValue(child as any);

      const promise = service.cloneRepo({ repo: 'user/repo', targetDir: '/tmp/repo' });

      child.stderr.emit('data', Buffer.from('fatal: repository not found'));
      child.emit('close', 128);

      await expect(promise).rejects.toThrow('Clone failed');
    });

    it('should reject on spawn error', async () => {
      const { service, runner } = createService();
      const child = createMockChildProcess();
      runner.spawn.mockReturnValue(child as any);

      const promise = service.cloneRepo({ repo: 'user/repo', targetDir: '/tmp/repo' });
      child.emit('error', new Error('spawn ENOENT'));

      await expect(promise).rejects.toThrow('Clone failed');
    });
  });

  describe('createPR', () => {
    it('should create a PR and fetch details via pr view', async () => {
      const { service, runner } = createService();
      const prData = {
        number: 5,
        title: 'feat: new feature',
        body: 'Description',
        state: 'OPEN',
        url: 'https://github.com/owner/repo/pull/5',
        author: { login: 'user' },
        headRefName: 'feature',
        baseRefName: 'main',
        labels: [{ name: 'enhancement' }],
        reviewDecision: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      runner.exec
        .mockResolvedValueOnce({ stdout: 'https://github.com/owner/repo/pull/5\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: JSON.stringify(prData), stderr: '' });

      const result = await service.createPR({
        repo: 'owner/repo', title: 'feat: new feature', body: 'Description',
      });

      expect(result.number).toBe(5);
      expect(result.title).toBe('feat: new feature');
      expect(result.headBranch).toBe('feature');

      const createCall = runner.exec.mock.calls[0]!;
      expect(createCall[1]).toContain('pr');
      expect(createCall[1]).toContain('create');
      expect(createCall[1]).not.toContain('--json');

      const viewCall = runner.exec.mock.calls[1]!;
      expect(viewCall[1]).toContain('pr');
      expect(viewCall[1]).toContain('view');
      expect(viewCall[1]).toContain('5');
    });

    it('should pass --head flag when head is provided', async () => {
      const { service, runner } = createService();
      const prData = {
        number: 6, title: 'feat: head test', body: '', state: 'OPEN',
        url: 'https://github.com/owner/repo/pull/6',
        author: { login: 'user' }, headRefName: 'feat/jd/1-test',
        baseRefName: 'main', labels: [], reviewDecision: null,
        createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
      };
      runner.exec
        .mockResolvedValueOnce({ stdout: 'https://github.com/owner/repo/pull/6\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: JSON.stringify(prData), stderr: '' });

      await service.createPR({
        repo: 'owner/repo', title: 'feat: head test', body: '',
        head: 'feat/jd/1-test', base: 'main',
      });

      const createArgs = runner.exec.mock.calls[0]![1] as string[];
      const headIndex = createArgs.indexOf('--head');
      expect(headIndex).toBeGreaterThan(-1);
      expect(createArgs[headIndex + 1]).toBe('feat/jd/1-test');
    });

    it('should throw on failure', async () => {
      const { service, runner } = createService();
      runner.exec.mockRejectedValue(new Error('not on a branch'));

      await expect(service.createPR({
        repo: 'owner/repo', title: 'test', body: '',
      })).rejects.toThrow('Failed to create PR');
    });
  });

  describe('listPRs', () => {
    it('should list PRs for a repo', async () => {
      const { service, runner } = createService();
      const prs = [{
        number: 1, title: 'PR 1', body: '', state: 'OPEN',
        url: 'https://github.com/owner/repo/pull/1',
        author: { login: 'user' }, headRefName: 'feat', baseRefName: 'main',
        labels: [], reviewDecision: null,
        createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
      }];
      runner.exec.mockResolvedValue({ stdout: JSON.stringify(prs), stderr: '' });

      const result = await service.listPRs({ repo: 'owner/repo' });

      expect(result).toHaveLength(1);
      expect(result[0]!.number).toBe(1);
    });

    it('should throw on failure', async () => {
      const { service, runner } = createService();
      runner.exec.mockRejectedValue(new Error('API error'));

      await expect(service.listPRs({ repo: 'owner/repo' }))
        .rejects.toThrow('Failed to list PRs');
    });
  });

  describe('createPR (additional branches)', () => {
    it('should pass --draft when draft is true', async () => {
      const { service, runner } = createService();
      const prData = {
        number: 7, title: 'draft pr', body: '', state: 'OPEN', isDraft: true,
        url: 'https://github.com/owner/repo/pull/7',
        author: { login: 'user' }, headRefName: 'draft-branch', baseRefName: 'main',
        labels: [], reviewDecision: null,
        createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
      };
      runner.exec
        .mockResolvedValueOnce({ stdout: 'https://github.com/owner/repo/pull/7\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: JSON.stringify(prData), stderr: '' });

      await service.createPR({
        repo: 'owner/repo', title: 'draft pr', body: '', draft: true,
      });

      const createArgs = runner.exec.mock.calls[0]![1] as string[];
      expect(createArgs).toContain('--draft');
    });

    it('should pass cwd option when provided', async () => {
      const { service, runner } = createService();
      const prData = {
        number: 8, title: 'cwd pr', body: '', state: 'OPEN',
        url: 'https://github.com/owner/repo/pull/8',
        author: { login: 'user' }, headRefName: 'feat', baseRefName: 'main',
        labels: [], reviewDecision: null,
        createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
      };
      runner.exec
        .mockResolvedValueOnce({ stdout: 'https://github.com/owner/repo/pull/8\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: JSON.stringify(prData), stderr: '' });

      await service.createPR({
        repo: 'owner/repo', title: 'cwd pr', body: '', cwd: '/some/dir',
      });

      const execOpts = runner.exec.mock.calls[0]![2];
      expect(execOpts).toEqual({ cwd: '/some/dir' });
    });
  });

  describe('viewPR', () => {
    it('should return PR detail with reviews and comments', async () => {
      const { service, runner } = createService();
      const prData = {
        number: 3, title: 'PR 3', body: 'Body', state: 'OPEN',
        url: 'https://github.com/owner/repo/pull/3',
        author: { login: 'user' }, headRefName: 'feat', baseRefName: 'main',
        labels: [], reviewDecision: 'APPROVED',
        createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
      };
      const reviews = [{ author: 'rev', state: 'APPROVED', body: 'LGTM', submittedAt: '2024-01-01T00:00:00Z' }];
      const comments = [{ author: 'rev', body: 'Fix this', path: 'file.ts', line: 10, createdAt: '2024-01-01T00:00:00Z' }];

      runner.exec
        .mockResolvedValueOnce({ stdout: JSON.stringify(prData), stderr: '' })
        .mockResolvedValueOnce({ stdout: JSON.stringify(reviews), stderr: '' })
        .mockResolvedValueOnce({ stdout: JSON.stringify(comments), stderr: '' });

      const result = await service.viewPR({ repo: 'owner/repo', prNumber: 3 });

      expect(result.pr.number).toBe(3);
      expect(result.reviews).toHaveLength(1);
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0]!.path).toBe('file.ts');
    });

    it('should throw on failure', async () => {
      const { service, runner } = createService();
      runner.exec.mockRejectedValue(new Error('not found'));

      await expect(service.viewPR({ repo: 'owner/repo', prNumber: 999 }))
        .rejects.toThrow('Failed to view PR');
    });

    it('should return empty reviews when reviews API fails', async () => {
      const { service, runner } = createService();
      const prData = {
        number: 3, title: 'PR 3', body: '', state: 'OPEN',
        url: 'https://github.com/owner/repo/pull/3',
        author: { login: 'user' }, headRefName: 'feat', baseRefName: 'main',
        labels: [], reviewDecision: null,
        createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
      };
      runner.exec
        .mockResolvedValueOnce({ stdout: JSON.stringify(prData), stderr: '' })
        .mockRejectedValueOnce(new Error('reviews API error'))
        .mockResolvedValueOnce({ stdout: '[]', stderr: '' });

      const result = await service.viewPR({ repo: 'owner/repo', prNumber: 3 });

      expect(result.reviews).toEqual([]);
      expect(result.comments).toEqual([]);
    });

    it('should return empty comments when comments API fails', async () => {
      const { service, runner } = createService();
      const prData = {
        number: 3, title: 'PR 3', body: '', state: 'OPEN',
        url: 'https://github.com/owner/repo/pull/3',
        author: { login: 'user' }, headRefName: 'feat', baseRefName: 'main',
        labels: [], reviewDecision: null,
        createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
      };
      runner.exec
        .mockResolvedValueOnce({ stdout: JSON.stringify(prData), stderr: '' })
        .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
        .mockRejectedValueOnce(new Error('comments API error'));

      const result = await service.viewPR({ repo: 'owner/repo', prNumber: 3 });

      expect(result.reviews).toEqual([]);
      expect(result.comments).toEqual([]);
    });
  });

  describe('viewIssue (comment fetch failure)', () => {
    it('should return empty comments when comments API fails', async () => {
      const { service, runner } = createService();
      runner.exec.mockImplementation((_cmd, args) => {
        if (args[0] === 'issue' && args[1] === 'view') {
          return Promise.resolve({
            stdout: JSON.stringify({
              number: 1, title: 'Issue', body: '', state: 'OPEN',
              url: 'https://github.com/user/repo/issues/1',
              author: { login: 'user' }, labels: [], assignees: [],
              milestone: null,
              createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
              comments: [],
            }),
            stderr: '',
          });
        }

        return Promise.reject(new Error('API rate limited'));
      });

      const detail = await service.viewIssue({ repo: 'user/repo', issueNumber: 1 });

      expect(detail.issue.number).toBe(1);
      expect(detail.comments).toEqual([]);
    });
  });

  describe('searchRepos (fallback fields)', () => {
    it('should use fullName and htmlUrl and visibility fallbacks', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({
        stdout: JSON.stringify([{
          name: 'fallback-repo',
          fullName: 'org/fallback-repo',
          description: null,
          htmlUrl: 'https://github.com/org/fallback-repo',
          visibility: 'private',
          primaryLanguage: null,
          updatedAt: '2024-01-01T00:00:00Z',
          stargazerCount: 0,
        }]),
        stderr: '',
      });

      const repos = await service.searchRepos({ query: 'fallback' });

      expect(repos[0]!.fullName).toBe('org/fallback-repo');
      expect(repos[0]!.url).toBe('https://github.com/org/fallback-repo');
      expect(repos[0]!.isPrivate).toBe(true);
    });

    it('should fallback to name when no nameWithOwner or fullName', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({
        stdout: JSON.stringify([{
          name: 'only-name',
          description: null,
          primaryLanguage: null,
          updatedAt: '2024-01-01T00:00:00Z',
          stargazerCount: 0,
        }]),
        stderr: '',
      });

      const repos = await service.searchRepos({ query: 'only' });

      expect(repos[0]!.fullName).toBe('only-name');
      expect(repos[0]!.url).toBe('');
      expect(repos[0]!.isPrivate).toBe(false);
    });
  });

  describe('issue and PR parsers (edge cases)', () => {
    it('should handle missing author in issue data', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({
        stdout: JSON.stringify([{
          number: 1, title: 'No author', body: null,
          state: 'OPEN', url: 'https://github.com/u/r/issues/1',
          author: null, labels: null, assignees: null,
          milestone: null, createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z', comments: null,
        }]),
        stderr: '',
      });

      const issues = await service.listIssues({ repo: 'u/r' });

      expect(issues[0]!.author).toBe('unknown');
      expect(issues[0]!.body).toBe('');
      expect(issues[0]!.labels).toEqual([]);
      expect(issues[0]!.assignees).toEqual([]);
      expect(issues[0]!.commentsCount).toBe(0);
    });

    it('should handle missing author and isDraft in PR data', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({
        stdout: JSON.stringify([{
          number: 1, title: 'Minimal PR', body: null,
          state: 'OPEN', url: 'https://github.com/u/r/pull/1',
          author: null, headRefName: 'feat', baseRefName: 'main',
          labels: null, reviewDecision: null,
          createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
        }]),
        stderr: '',
      });

      const prs = await service.listPRs({ repo: 'u/r' });

      expect(prs[0]!.author).toBe('unknown');
      expect(prs[0]!.body).toBe('');
      expect(prs[0]!.isDraft).toBe(false);
      expect(prs[0]!.labels).toEqual([]);
    });
  });

  describe('auth error edge cases', () => {
    it('should handle non-Error rejection in detectAuth', async () => {
      const { service, runner } = createService();
      runner.exec.mockImplementation((_cmd, args) => {
        if (args[0] === '--version') {
          return Promise.resolve({ stdout: 'gh version 2.45.0\n', stderr: '' });
        }

        return Promise.reject('string error');
      });

      const status = await service.getStatus();

      expect(status.installed).toBe(true);
      expect(status.authenticated).toBe(false);
      expect(status.error).toContain('Auth check failed');
    });

    it('should handle error with stderr containing "not logged"', async () => {
      const { service, runner } = createService();
      runner.exec.mockImplementation((_cmd, args) => {
        if (args[0] === '--version') {
          return Promise.resolve({ stdout: 'gh version 2.45.0\n', stderr: '' });
        }

        const error = new Error('auth failed') as Error & { stderr: string };
        error.stderr = 'You are not logged into any GitHub hosts';
        return Promise.reject(error);
      });

      const status = await service.getStatus();

      expect(status.authenticated).toBe(false);
      expect(status.error).toBeNull();
    });
  });

  describe('empty output handling', () => {
    it('should return empty array for empty stdout in listLabels', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await service.listLabels('u/r');

      expect(result).toEqual([]);
    });

    it('should return empty array for empty stdout in listMilestones', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await service.listMilestones('u/r');

      expect(result).toEqual([]);
    });

    it('should return empty array for empty stdout in listCollaborators', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await service.listCollaborators('u/r');

      expect(result).toEqual([]);
    });

    it('should return empty array for empty stdout in listRepos', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await service.listRepos();

      expect(result).toEqual([]);
    });

    it('should return empty array for empty stdout in listIssues', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await service.listIssues({ repo: 'u/r' });

      expect(result).toEqual([]);
    });

    it('should return empty array for empty stdout in listPRs', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await service.listPRs({ repo: 'u/r' });

      expect(result).toEqual([]);
    });
  });

  describe('cloneRepo (additional branches)', () => {
    function createMockChildProcess() {
      const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter; stdout: EventEmitter };
      child.stderr = new EventEmitter();
      child.stdout = new EventEmitter();
      return child;
    }

    it('should report error phase on non-zero exit with empty stderr', async () => {
      const { service, runner } = createService();
      const child = createMockChildProcess();
      runner.spawn.mockReturnValue(child as any);

      const progress: Array<{ phase: string; message: string }> = [];
      const promise = service.cloneRepo(
        { repo: 'u/r', targetDir: '/tmp/r' },
        (p) => progress.push(p),
      );

      child.emit('close', 1);

      await expect(promise).rejects.toThrow('Clone failed');
      expect(progress.some(p => p.phase === 'error')).toBe(true);
    });

    it('should report error phase on spawn error with progress callback', async () => {
      const { service, runner } = createService();
      const child = createMockChildProcess();
      runner.spawn.mockReturnValue(child as any);

      const progress: Array<{ phase: string; message: string }> = [];
      const promise = service.cloneRepo(
        { repo: 'u/r', targetDir: '/tmp/r' },
        (p) => progress.push(p),
      );

      child.emit('error', new Error('ENOENT'));

      await expect(promise).rejects.toThrow('Clone failed');
      expect(progress.some(p => p.phase === 'error')).toBe(true);
    });
  });

  describe('listPRs (args)', () => {
    it('should pass state and limit args', async () => {
      const { service, runner } = createService();
      runner.exec.mockResolvedValue({ stdout: '[]', stderr: '' });

      await service.listPRs({ repo: 'u/r', state: 'closed', limit: 5 });

      const args = runner.exec.mock.calls[0]![1] as string[];
      expect(args).toContain('--state');
      expect(args).toContain('closed');
      expect(args).toContain('5');
    });
  });

  describe('extractErrorMessage', () => {
    it('should extract stderr from Error objects', async () => {
      const { service, runner } = createService();
      const err = new Error('exec failed') as Error & { stderr: string };
      err.stderr = 'permission denied';
      runner.exec.mockRejectedValue(err);

      await expect(service.listRepos()).rejects.toThrow('permission denied');
    });

    it('should use message when no stderr', async () => {
      const { service, runner } = createService();
      runner.exec.mockRejectedValue(new Error('timeout'));

      await expect(service.listRepos()).rejects.toThrow('timeout');
    });

    it('should handle non-Error thrown values', async () => {
      const { service, runner } = createService();
      runner.exec.mockRejectedValue('string error');

      await expect(service.listRepos()).rejects.toThrow('string error');
    });
  });
});
