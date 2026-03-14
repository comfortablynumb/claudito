import { SimpleGitService } from '../../../src/services/git-service';
import { GitError } from '../../../src/utils/errors';

// Mock simple-git
jest.mock('simple-git', () => {
  const mockGit = {
    checkIsRepo: jest.fn(),
    status: jest.fn(),
    branchLocal: jest.fn(),
    branch: jest.fn(),
    add: jest.fn(),
    reset: jest.fn(),
    commit: jest.fn(),
    checkoutLocalBranch: jest.fn(),
    checkout: jest.fn(),
    raw: jest.fn(),
    diff: jest.fn(),
    tags: jest.fn(),
    tag: jest.fn(),
    addTag: jest.fn(),
    getRemotes: jest.fn(),
    getConfig: jest.fn(),
  };
  return jest.fn(() => mockGit);
});

// Mock fs for getFileDiff
jest.mock('fs', () => ({
  readFileSync: jest.fn(),
}));

import simpleGit from 'simple-git';
import fs from 'fs';

describe('SimpleGitService', () => {
  let service: SimpleGitService;
  let mockGit: ReturnType<typeof simpleGit>;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SimpleGitService();
    mockGit = simpleGit('/test/path');

    // Reset all mock functions to resolved undefined by default
    (mockGit.checkIsRepo as jest.Mock).mockResolvedValue(true);
    (mockGit.add as jest.Mock).mockResolvedValue(undefined);
    (mockGit.reset as jest.Mock).mockResolvedValue(undefined);
    (mockGit.commit as jest.Mock).mockResolvedValue({ commit: 'abc1234' });
    (mockGit.branch as jest.Mock).mockResolvedValue({ all: [] });
    (mockGit.checkoutLocalBranch as jest.Mock).mockResolvedValue(undefined);
    (mockGit.checkout as jest.Mock).mockResolvedValue(undefined);
    (mockGit.raw as jest.Mock).mockResolvedValue('');
    (mockGit.diff as jest.Mock).mockResolvedValue('');
    (mockGit.tags as jest.Mock).mockResolvedValue({ all: [] });
    (mockGit.tag as jest.Mock).mockResolvedValue(undefined);
    (mockGit.addTag as jest.Mock).mockResolvedValue(undefined);
  });

  describe('isGitRepo', () => {
    it('should return true when path is a git repo', async () => {
      (mockGit.checkIsRepo as jest.Mock).mockResolvedValue(true);

      const result = await service.isGitRepo('/test/path');

      expect(result).toBe(true);
    });

    it('should return false when path is not a git repo', async () => {
      (mockGit.checkIsRepo as jest.Mock).mockResolvedValue(false);

      const result = await service.isGitRepo('/test/path');

      expect(result).toBe(false);
    });

    it('should return false when check fails', async () => {
      (mockGit.checkIsRepo as jest.Mock).mockRejectedValue(new Error('Not found'));

      const result = await service.isGitRepo('/test/path');

      expect(result).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return empty status when not a repo', async () => {
      (mockGit.checkIsRepo as jest.Mock).mockResolvedValue(false);

      const result = await service.getStatus('/test/path');

      expect(result.isRepo).toBe(false);
      expect(result.staged).toEqual([]);
      expect(result.unstaged).toEqual([]);
      expect(result.untracked).toEqual([]);
    });

    it('should transform status result correctly', async () => {
      (mockGit.checkIsRepo as jest.Mock).mockResolvedValue(true);
      (mockGit.status as jest.Mock).mockResolvedValue({
        files: [
          { path: 'src/file.ts', index: 'M', working_dir: ' ' },
          { path: 'src/other.ts', index: ' ', working_dir: 'M' },
          { path: 'new.ts', index: '?', working_dir: '?' },
        ],
      });

      const result = await service.getStatus('/test/path');

      expect(result.isRepo).toBe(true);
      expect(result.staged).toHaveLength(1);
      expect(result.staged[0]?.path).toBe('src/file.ts');
      expect(result.staged[0]?.status).toBe('modified');
      expect(result.unstaged).toHaveLength(1);
      expect(result.unstaged[0]?.path).toBe('src/other.ts');
      expect(result.untracked).toHaveLength(1);
      expect(result.untracked[0]?.path).toBe('new.ts');
    });

    it('should handle added files', async () => {
      (mockGit.checkIsRepo as jest.Mock).mockResolvedValue(true);
      (mockGit.status as jest.Mock).mockResolvedValue({
        files: [{ path: 'added.ts', index: 'A', working_dir: ' ' }],
      });

      const result = await service.getStatus('/test/path');

      expect(result.staged[0]?.status).toBe('added');
    });

    it('should handle deleted files', async () => {
      (mockGit.checkIsRepo as jest.Mock).mockResolvedValue(true);
      (mockGit.status as jest.Mock).mockResolvedValue({
        files: [{ path: 'deleted.ts', index: 'D', working_dir: ' ' }],
      });

      const result = await service.getStatus('/test/path');

      expect(result.staged[0]?.status).toBe('deleted');
    });

    it('should handle renamed files', async () => {
      (mockGit.checkIsRepo as jest.Mock).mockResolvedValue(true);
      (mockGit.status as jest.Mock).mockResolvedValue({
        files: [{ path: 'renamed.ts', index: 'R', working_dir: ' ' }],
      });

      const result = await service.getStatus('/test/path');

      expect(result.staged[0]?.status).toBe('renamed');
    });

    it('should handle status error gracefully', async () => {
      (mockGit.checkIsRepo as jest.Mock).mockResolvedValue(true);
      (mockGit.status as jest.Mock).mockRejectedValue(new Error('Git error'));

      const result = await service.getStatus('/test/path');

      expect(result.isRepo).toBe(true);
      expect(result.staged).toEqual([]);
    });

    it('should extract file name from path', async () => {
      (mockGit.checkIsRepo as jest.Mock).mockResolvedValue(true);
      (mockGit.status as jest.Mock).mockResolvedValue({
        files: [{ path: 'src/deep/nested/file.ts', index: 'M', working_dir: ' ' }],
      });

      const result = await service.getStatus('/test/path');

      expect(result.staged[0]?.name).toBe('file.ts');
    });
  });

  describe('getBranches', () => {
    it('should return empty when not a repo', async () => {
      (mockGit.checkIsRepo as jest.Mock).mockResolvedValue(false);

      const result = await service.getBranches('/test/path');

      expect(result.current).toBe('');
      expect(result.local).toEqual([]);
      expect(result.remote).toEqual([]);
    });

    it('should return branch info', async () => {
      (mockGit.checkIsRepo as jest.Mock).mockResolvedValue(true);
      (mockGit.branchLocal as jest.Mock).mockResolvedValue({
        current: 'main',
        all: ['main', 'develop'],
      });
      (mockGit.branch as jest.Mock).mockResolvedValue({
        all: ['origin/main', 'origin/develop'],
      });

      const result = await service.getBranches('/test/path');

      expect(result.current).toBe('main');
      expect(result.local).toEqual(['main', 'develop']);
      expect(result.remote).toEqual(['origin/main', 'origin/develop']);
    });

    it('should handle no remotes', async () => {
      (mockGit.checkIsRepo as jest.Mock).mockResolvedValue(true);
      (mockGit.branchLocal as jest.Mock).mockResolvedValue({
        current: 'main',
        all: ['main'],
      });
      (mockGit.branch as jest.Mock).mockRejectedValue(new Error('No remotes'));

      const result = await service.getBranches('/test/path');

      expect(result.remote).toEqual([]);
    });

    it('should handle error gracefully', async () => {
      (mockGit.checkIsRepo as jest.Mock).mockResolvedValue(true);
      (mockGit.branchLocal as jest.Mock).mockRejectedValue(new Error('Error'));

      const result = await service.getBranches('/test/path');

      expect(result.current).toBe('');
      expect(result.local).toEqual([]);
    });
  });

  describe('stageFiles', () => {
    it('should stage specified files', async () => {
      await service.stageFiles('/test/path', ['file1.ts', 'file2.ts']);

      expect(mockGit.add).toHaveBeenCalledWith(['file1.ts', 'file2.ts']);
    });

    it('should do nothing for empty paths', async () => {
      await service.stageFiles('/test/path', []);

      expect(mockGit.add).not.toHaveBeenCalled();
    });

    it('should throw GitError on failure', async () => {
      (mockGit.add as jest.Mock).mockRejectedValue(new Error('Stage failed'));

      await expect(service.stageFiles('/test/path', ['file.ts']))
        .rejects
        .toThrow(GitError);
    });
  });

  describe('unstageFiles', () => {
    it('should unstage specified files', async () => {
      await service.unstageFiles('/test/path', ['file1.ts']);

      expect(mockGit.reset).toHaveBeenCalledWith(['HEAD', '--', 'file1.ts']);
    });

    it('should do nothing for empty paths', async () => {
      await service.unstageFiles('/test/path', []);

      expect(mockGit.reset).not.toHaveBeenCalled();
    });

    it('should throw GitError on failure', async () => {
      (mockGit.reset as jest.Mock).mockRejectedValue(new Error('Reset failed'));

      await expect(service.unstageFiles('/test/path', ['file.ts']))
        .rejects
        .toThrow(GitError);
    });
  });

  describe('stageAll', () => {
    it('should stage all files', async () => {
      await service.stageAll('/test/path');

      expect(mockGit.add).toHaveBeenCalledWith(['-A']);
    });

    it('should throw GitError on failure', async () => {
      (mockGit.add as jest.Mock).mockRejectedValue(new Error('Add failed'));

      await expect(service.stageAll('/test/path'))
        .rejects
        .toThrow(GitError);
    });
  });

  describe('unstageAll', () => {
    it('should unstage all files', async () => {
      await service.unstageAll('/test/path');

      expect(mockGit.reset).toHaveBeenCalledWith(['HEAD']);
    });

    it('should throw GitError on failure', async () => {
      (mockGit.reset as jest.Mock).mockRejectedValue(new Error('Reset failed'));

      await expect(service.unstageAll('/test/path'))
        .rejects
        .toThrow(GitError);
    });
  });

  describe('commit', () => {
    it('should commit with message and return result', async () => {
      (mockGit.commit as jest.Mock).mockResolvedValue({
        commit: 'abc123456789',
      });

      const result = await service.commit('/test/path', 'Test commit');

      expect(mockGit.commit).toHaveBeenCalledWith('Test commit');
      expect(result.hash).toBe('abc1234');
      expect(result.message).toBe('Test commit');
    });
  });

  describe('createBranch', () => {
    it('should create branch without checkout', async () => {
      await service.createBranch('/test/path', 'feature/test', false);

      expect(mockGit.branch).toHaveBeenCalledWith(['feature/test']);
      expect(mockGit.checkoutLocalBranch).not.toHaveBeenCalled();
    });

    it('should create branch with checkout', async () => {
      await service.createBranch('/test/path', 'feature/test', true);

      expect(mockGit.checkoutLocalBranch).toHaveBeenCalledWith('feature/test');
    });
  });

  describe('checkout', () => {
    it('should checkout branch', async () => {
      await service.checkout('/test/path', 'develop');

      expect(mockGit.checkout).toHaveBeenCalledWith('develop');
    });
  });

  describe('push', () => {
    it('should push with defaults', async () => {
      (mockGit.raw as jest.Mock).mockResolvedValue('Pushed');

      const result = await service.push('/test/path');

      expect(mockGit.raw).toHaveBeenCalledWith(['push', 'origin']);
      expect(result).toBe('Pushed');
    });

    it('should push with specific remote and branch', async () => {
      await service.push('/test/path', 'upstream', 'main');

      expect(mockGit.raw).toHaveBeenCalledWith(['push', 'upstream', 'main']);
    });

    it('should push with setUpstream flag', async () => {
      await service.push('/test/path', 'origin', 'feature', true);

      expect(mockGit.raw).toHaveBeenCalledWith(['push', '-u', 'origin', 'feature']);
    });
  });

  describe('pull', () => {
    it('should pull with defaults', async () => {
      (mockGit.raw as jest.Mock).mockResolvedValue('Pulled');

      const result = await service.pull('/test/path');

      expect(mockGit.raw).toHaveBeenCalledWith(['pull', 'origin']);
      expect(result).toBe('Pulled');
    });

    it('should pull with specific remote and branch', async () => {
      await service.pull('/test/path', 'upstream', 'main');

      expect(mockGit.raw).toHaveBeenCalledWith(['pull', 'upstream', 'main']);
    });
  });

  describe('getDiff', () => {
    it('should get unstaged diff by default', async () => {
      (mockGit.diff as jest.Mock).mockResolvedValue('diff content');

      const result = await service.getDiff('/test/path');

      expect(mockGit.diff).toHaveBeenCalledWith([]);
      expect(result).toBe('diff content');
    });

    it('should get staged diff when requested', async () => {
      (mockGit.diff as jest.Mock).mockResolvedValue('staged diff');

      const result = await service.getDiff('/test/path', true);

      expect(mockGit.diff).toHaveBeenCalledWith(['--staged']);
      expect(result).toBe('staged diff');
    });
  });

  describe('getFileDiff', () => {
    it('should get diff for tracked file', async () => {
      (mockGit.status as jest.Mock).mockResolvedValue({ not_added: [] });
      (mockGit.diff as jest.Mock).mockResolvedValue('file diff');

      const result = await service.getFileDiff('/test/path', 'file.ts');

      expect(mockGit.diff).toHaveBeenCalledWith(['--', 'file.ts']);
      expect(result.diff).toBe('file diff');
      expect(result.filePath).toBe('file.ts');
    });

    it('should get staged diff for tracked file', async () => {
      (mockGit.status as jest.Mock).mockResolvedValue({ not_added: [] });

      await service.getFileDiff('/test/path', 'file.ts', true);

      expect(mockGit.diff).toHaveBeenCalledWith(['--staged', '--', 'file.ts']);
    });

    it('should handle untracked files', async () => {
      (mockGit.status as jest.Mock).mockResolvedValue({
        not_added: ['new-file.ts'],
      });
      (fs.readFileSync as jest.Mock).mockReturnValue('line1\nline2');

      const result = await service.getFileDiff('/test/path', 'new-file.ts');

      expect(result.diff).toContain('+line1');
      expect(result.diff).toContain('+line2');
    });

    it('should throw GitError on failure', async () => {
      (mockGit.status as jest.Mock).mockRejectedValue(new Error('Status failed'));

      await expect(service.getFileDiff('/test/path', 'file.ts'))
        .rejects
        .toThrow(GitError);
    });
  });

  describe('discardChanges', () => {
    it('should discard changes to specified files', async () => {
      await service.discardChanges('/test/path', ['file1.ts', 'file2.ts']);

      expect(mockGit.checkout).toHaveBeenCalledWith(['--', 'file1.ts', 'file2.ts']);
    });

    it('should do nothing for empty paths', async () => {
      await service.discardChanges('/test/path', []);

      expect(mockGit.checkout).not.toHaveBeenCalled();
    });
  });

  describe('listTags', () => {
    it('should list all tags', async () => {
      (mockGit.tags as jest.Mock).mockResolvedValue({
        all: ['v1.0.0', 'v1.1.0', 'v2.0.0'],
      });

      const result = await service.listTags('/test/path');

      expect(result).toEqual(['v1.0.0', 'v1.1.0', 'v2.0.0']);
    });

    it('should throw GitError on failure', async () => {
      (mockGit.tags as jest.Mock).mockRejectedValue(new Error('Tags failed'));

      await expect(service.listTags('/test/path'))
        .rejects
        .toThrow(GitError);
    });
  });

  describe('createTag', () => {
    it('should create lightweight tag', async () => {
      await service.createTag('/test/path', 'v1.0.0');

      expect(mockGit.addTag).toHaveBeenCalledWith('v1.0.0');
    });

    it('should create annotated tag with message', async () => {
      await service.createTag('/test/path', 'v1.0.0', 'Release 1.0');

      expect(mockGit.tag).toHaveBeenCalledWith(['-a', 'v1.0.0', '-m', 'Release 1.0']);
    });

    it('should throw GitError on failure', async () => {
      (mockGit.addTag as jest.Mock).mockRejectedValue(new Error('Tag failed'));

      await expect(service.createTag('/test/path', 'v1.0.0'))
        .rejects
        .toThrow(GitError);
    });
  });

  describe('pushTag', () => {
    it('should push tag to default remote', async () => {
      (mockGit.raw as jest.Mock).mockResolvedValue('Tag pushed');

      const result = await service.pushTag('/test/path', 'v1.0.0');

      expect(mockGit.raw).toHaveBeenCalledWith(['push', 'origin', 'v1.0.0']);
      expect(result).toBe('Tag pushed');
    });

    it('should push tag to specific remote', async () => {
      await service.pushTag('/test/path', 'v1.0.0', 'upstream');

      expect(mockGit.raw).toHaveBeenCalledWith(['push', 'upstream', 'v1.0.0']);
    });

    it('should throw GitError on failure', async () => {
      (mockGit.raw as jest.Mock).mockRejectedValue(new Error('Push failed'));

      await expect(service.pushTag('/test/path', 'v1.0.0'))
        .rejects
        .toThrow(GitError);
    });
  });

  describe('deleteTag', () => {
    it('should delete a tag', async () => {
      await service.deleteTag('/test/path', 'v1.0.0');

      expect(mockGit.tag).toHaveBeenCalledWith(['-d', 'v1.0.0']);
    });

    it('should throw GitError on failure', async () => {
      (mockGit.tag as jest.Mock).mockRejectedValue(new Error('Delete failed'));

      await expect(service.deleteTag('/test/path', 'v1.0.0'))
        .rejects
        .toThrow(GitError);
    });
  });

  describe('getRemoteUrl', () => {
    it('should return fetch URL for matching remote', async () => {
      (mockGit.getRemotes as jest.Mock).mockResolvedValue([
        { name: 'origin', refs: { fetch: 'https://github.com/user/repo.git', push: 'https://github.com/user/repo.git' } },
      ]);

      const result = await service.getRemoteUrl('/test/path');

      expect(result).toBe('https://github.com/user/repo.git');
    });

    it('should return URL for specific remote', async () => {
      (mockGit.getRemotes as jest.Mock).mockResolvedValue([
        { name: 'origin', refs: { fetch: 'https://origin.git' } },
        { name: 'upstream', refs: { fetch: 'https://upstream.git' } },
      ]);

      const result = await service.getRemoteUrl('/test/path', 'upstream');

      expect(result).toBe('https://upstream.git');
    });

    it('should return null when remote not found', async () => {
      (mockGit.getRemotes as jest.Mock).mockResolvedValue([
        { name: 'origin', refs: { fetch: 'https://origin.git' } },
      ]);

      const result = await service.getRemoteUrl('/test/path', 'upstream');

      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      (mockGit.getRemotes as jest.Mock).mockRejectedValue(new Error('No remotes'));

      const result = await service.getRemoteUrl('/test/path');

      expect(result).toBeNull();
    });
  });

  describe('getUserName', () => {
    it('should return user name from git config', async () => {
      (mockGit.getConfig as jest.Mock).mockResolvedValue({ value: 'John Doe' });

      const result = await service.getUserName('/test/path');

      expect(result).toBe('John Doe');
      expect(mockGit.getConfig).toHaveBeenCalledWith('user.name');
    });

    it('should return null when no user name configured', async () => {
      (mockGit.getConfig as jest.Mock).mockResolvedValue({ value: null });

      const result = await service.getUserName('/test/path');

      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      (mockGit.getConfig as jest.Mock).mockRejectedValue(new Error('Config error'));

      const result = await service.getUserName('/test/path');

      expect(result).toBeNull();
    });
  });

  describe('pull with rebase', () => {
    it('should pull with rebase flag', async () => {
      (mockGit.raw as jest.Mock).mockResolvedValue('Rebased');

      const result = await service.pull('/test/path', 'origin', 'main', true);

      expect(mockGit.raw).toHaveBeenCalledWith(['pull', '--rebase', 'origin', 'main']);
      expect(result).toBe('Rebased');
    });
  });

  describe('mapStatusChar edge cases', () => {
    it('should map copied status', async () => {
      (mockGit.checkIsRepo as jest.Mock).mockResolvedValue(true);
      (mockGit.status as jest.Mock).mockResolvedValue({
        files: [{ path: 'copied.ts', index: 'C', working_dir: ' ' }],
      });

      const result = await service.getStatus('/test/path');

      expect(result.staged[0]?.status).toBe('copied');
    });

    it('should map unknown status to modified', async () => {
      (mockGit.checkIsRepo as jest.Mock).mockResolvedValue(true);
      (mockGit.status as jest.Mock).mockResolvedValue({
        files: [{ path: 'weird.ts', index: 'U', working_dir: ' ' }],
      });

      const result = await service.getStatus('/test/path');

      expect(result.staged[0]?.status).toBe('modified');
    });
  });

  describe('createGitService', () => {
    it('should create a SimpleGitService instance', () => {
      const { createGitService } = require('../../../src/services/git-service');
      const svc = createGitService();

      expect(svc).toBeInstanceOf(SimpleGitService);
    });
  });
});
