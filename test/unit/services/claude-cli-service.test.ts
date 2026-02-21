import { DefaultClaudeCliService } from '../../../src/services/claude-cli-service';
import { CommandRunner } from '../../../src/services/github-cli-service';

function createMockCommandRunner(): jest.Mocked<Pick<CommandRunner, 'exec'>> & CommandRunner {
  return {
    exec: jest.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    spawn: jest.fn(),
  } as any;
}

describe('DefaultClaudeCliService', () => {
  let mockCommandRunner: ReturnType<typeof createMockCommandRunner>;
  let service: DefaultClaudeCliService;

  beforeEach(() => {
    mockCommandRunner = createMockCommandRunner();
    service = new DefaultClaudeCliService(mockCommandRunner);
  });

  describe('getInfo', () => {
    it('should return installed=false when claude --version fails', async () => {
      mockCommandRunner.exec.mockRejectedValue(new Error('command not found'));

      const result = await service.getInfo();

      expect(result.installed).toBe(false);
      expect(result.version).toBeNull();
      expect(result.auth).toBeNull();
      expect(result.error).toBe('Claude CLI not found');
    });

    it('should return correct version string', async () => {
      mockCommandRunner.exec
        .mockResolvedValueOnce({ stdout: '1.0.18 (Claude Code)\n', stderr: '' })
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ loggedIn: true, email: 'a@b.com', subscriptionType: 'max', authMethod: null, apiProvider: null, orgId: null, orgName: null }),
          stderr: '',
        });

      const result = await service.getInfo();

      expect(result.installed).toBe(true);
      expect(result.version).toBe('1.0.18 (Claude Code)');
    });

    it('should return auth=null when claude auth status fails', async () => {
      mockCommandRunner.exec
        .mockResolvedValueOnce({ stdout: '1.0.18\n', stderr: '' })
        .mockRejectedValueOnce(new Error('auth check failed'));

      const result = await service.getInfo();

      expect(result.installed).toBe(true);
      expect(result.version).toBe('1.0.18');
      expect(result.auth).toBeNull();
    });

    it('should parse full auth JSON correctly', async () => {
      const authData = {
        loggedIn: true,
        authMethod: 'claude.ai',
        apiProvider: 'firstParty',
        email: 'gadrianfalco@gmail.com',
        orgId: '11b4d26c-7414-4ee5-a31c-edff6b4dbbe9',
        orgName: null,
        subscriptionType: 'max',
      };

      mockCommandRunner.exec
        .mockResolvedValueOnce({ stdout: '1.0.18\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: JSON.stringify(authData), stderr: '' });

      const result = await service.getInfo();

      expect(result.installed).toBe(true);
      expect(result.auth).toEqual(authData);
      expect(result.error).toBeNull();
    });

    it('should handle loggedIn=false', async () => {
      const authData = {
        loggedIn: false,
        authMethod: null,
        apiProvider: null,
        email: null,
        orgId: null,
        orgName: null,
        subscriptionType: null,
      };

      mockCommandRunner.exec
        .mockResolvedValueOnce({ stdout: '1.0.18\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: JSON.stringify(authData), stderr: '' });

      const result = await service.getInfo();

      expect(result.installed).toBe(true);
      expect(result.auth).toEqual(authData);
      expect(result.auth!.loggedIn).toBe(false);
    });

    it('should handle malformed JSON from auth status', async () => {
      mockCommandRunner.exec
        .mockResolvedValueOnce({ stdout: '1.0.18\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'not valid json {', stderr: '' });

      const result = await service.getInfo();

      expect(result.installed).toBe(true);
      expect(result.version).toBe('1.0.18');
      expect(result.auth).toBeNull();
    });

    it('should call claude --version and claude auth status --json', async () => {
      mockCommandRunner.exec
        .mockResolvedValueOnce({ stdout: '1.0.18\n', stderr: '' })
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ loggedIn: true, authMethod: null, apiProvider: null, email: null, orgId: null, orgName: null, subscriptionType: null }),
          stderr: '',
        });

      await service.getInfo();

      expect(mockCommandRunner.exec).toHaveBeenCalledWith('claude', ['--version']);
      expect(mockCommandRunner.exec).toHaveBeenCalledWith('claude', ['auth', 'status', '--json']);
    });

    it('should return installed=false for empty version output', async () => {
      mockCommandRunner.exec.mockResolvedValueOnce({ stdout: '  \n', stderr: '' });

      const result = await service.getInfo();

      expect(result.installed).toBe(false);
    });
  });
});
