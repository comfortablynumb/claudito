import { DefaultDockerService, generateContainerName } from '../../../src/services/docker/docker-service';
import { createMockDockerCommandRunner } from '../helpers/mock-factories';
import { DockerCommandRunner, CreateContainerOptions } from '../../../src/services/docker/types';

describe('DefaultDockerService', () => {
  let commandRunner: jest.Mocked<DockerCommandRunner>;
  let service: DefaultDockerService;

  beforeEach(() => {
    commandRunner = createMockDockerCommandRunner();
    service = new DefaultDockerService({ commandRunner });
  });

  describe('checkAvailability', () => {
    it('should return available when Docker is running', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: '24.0.7\n', stderr: '' });

      const result = await service.checkAvailability();

      expect(result).toEqual({
        installed: true,
        version: '24.0.7',
        running: true,
        error: null,
      });
      expect(commandRunner.exec).toHaveBeenCalledWith(
        'docker',
        ['version', '--format', '{{.Server.Version}}']
      );
    });

    it('should detect Docker not installed', async () => {
      commandRunner.exec.mockRejectedValue(new Error('docker: command not found'));

      const result = await service.checkAvailability();

      expect(result.installed).toBe(false);
      expect(result.running).toBe(false);
      expect(result.version).toBeNull();
      expect(result.error).toBe('Docker is not installed');
    });

    it('should detect Docker not running', async () => {
      commandRunner.exec.mockRejectedValue(new Error('Cannot connect to the Docker daemon'));

      const result = await service.checkAvailability();

      expect(result.installed).toBe(true);
      expect(result.running).toBe(false);
      expect(result.error).toContain('Cannot connect');
    });

    it('should handle "not recognized" error on Windows', async () => {
      commandRunner.exec.mockRejectedValue(new Error("'docker' is not recognized"));

      const result = await service.checkAvailability();

      expect(result.installed).toBe(false);
    });
  });

  describe('buildImage', () => {
    it('should call docker build with correct args', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      await service.buildImage({
        dockerfilePath: '/path/to/Dockerfile',
        imageName: 'claudito-agent:latest',
        context: '/path/to/context',
      });

      expect(commandRunner.exec).toHaveBeenCalledWith('docker', [
        'build', '-t', 'claudito-agent:latest', '-f', '/path/to/Dockerfile', '/path/to/context',
      ]);
    });
  });

  describe('createContainer', () => {
    const defaultOptions: CreateContainerOptions = {
      projectId: 'test-project-123',
      imageName: 'claudito-agent:latest',
      projectPath: '/home/user/project',
      env: { ANTHROPIC_API_KEY: 'test-key' },
      resourceLimits: { cpus: 2.0, memoryMb: 4096 },
      networkMode: 'bridge',
    };

    it('should create container with basic options', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: 'abc123def456\n', stderr: '' });

      const containerId = await service.createContainer(defaultOptions);

      expect(containerId).toBe('abc123def456');

      const args = commandRunner.exec.mock.calls[0]![1];
      expect(args).toContain('create');
      expect(args).toContain('--cpus');
      expect(args).toContain('2');
      expect(args).toContain('--memory');
      expect(args).toContain('4096m');
      expect(args).toContain('-e');
      expect(args).toContain('ANTHROPIC_API_KEY=test-key');
    });

    it('should use deterministic container name', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: 'abc123\n', stderr: '' });

      await service.createContainer(defaultOptions);

      const args = commandRunner.exec.mock.calls[0]![1];
      const nameIndex = args.indexOf('--name');
      expect(nameIndex).toBeGreaterThan(-1);

      const containerName = args[nameIndex + 1];
      expect(containerName).toMatch(/^claudito-[a-f0-9]{12}$/);
    });

    it('should bind mount project directory', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: 'abc123\n', stderr: '' });

      await service.createContainer(defaultOptions);

      const args = commandRunner.exec.mock.calls[0]![1];
      const volumeArgs = extractVolumeArgs(args);
      expect(volumeArgs).toContainEqual(expect.stringContaining(':/workspace'));
    });

    it('should mount SSH keys read-only when provided', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: 'abc123\n', stderr: '' });

      await service.createContainer({
        ...defaultOptions,
        sshKeyPath: '/home/user/.ssh',
      });

      const args = commandRunner.exec.mock.calls[0]![1];
      const volumeArgs = extractVolumeArgs(args);
      expect(volumeArgs).toContainEqual(expect.stringContaining('.ssh:ro'));
    });

    it('should mount git config read-only when provided', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: 'abc123\n', stderr: '' });

      await service.createContainer({
        ...defaultOptions,
        gitConfigPath: '/home/user/.gitconfig',
      });

      const args = commandRunner.exec.mock.calls[0]![1];
      const volumeArgs = extractVolumeArgs(args);
      expect(volumeArgs).toContainEqual(expect.stringContaining('.gitconfig:ro'));
    });

    it('should set network none when specified', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: 'abc123\n', stderr: '' });

      await service.createContainer({
        ...defaultOptions,
        networkMode: 'none',
      });

      const args = commandRunner.exec.mock.calls[0]![1];
      expect(args).toContain('--network');
      expect(args).toContain('none');
    });

    it('should not set --network for bridge mode (Docker default)', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: 'abc123\n', stderr: '' });

      await service.createContainer(defaultOptions);

      const args = commandRunner.exec.mock.calls[0]![1];
      expect(args).not.toContain('--network');
    });

    it('should add claudito label for identification', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: 'abc123\n', stderr: '' });

      await service.createContainer(defaultOptions);

      const args = commandRunner.exec.mock.calls[0]![1];
      expect(args).toContain('--label');
      expect(args).toContain('claudito=true');
    });

    it('should use sleep infinity to keep container running', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: 'abc123\n', stderr: '' });

      await service.createContainer(defaultOptions);

      const args = commandRunner.exec.mock.calls[0]![1];
      expect(args[args.length - 2]).toBe('sleep');
      expect(args[args.length - 1]).toBe('infinity');
    });
  });

  describe('startContainer', () => {
    it('should call docker start', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      await service.startContainer('abc123');

      expect(commandRunner.exec).toHaveBeenCalledWith('docker', ['start', 'abc123']);
    });
  });

  describe('stopContainer', () => {
    it('should call docker stop with timeout', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      await service.stopContainer('abc123');

      expect(commandRunner.exec).toHaveBeenCalledWith('docker', ['stop', '-t', '10', 'abc123']);
    });

    it('should not throw on stop failure', async () => {
      commandRunner.exec.mockRejectedValue(new Error('No such container'));

      await expect(service.stopContainer('abc123')).resolves.toBeUndefined();
    });
  });

  describe('removeContainer', () => {
    it('should force-remove container', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      await service.removeContainer('abc123');

      expect(commandRunner.exec).toHaveBeenCalledWith('docker', ['rm', '-f', 'abc123']);
    });

    it('should not throw on remove failure', async () => {
      commandRunner.exec.mockRejectedValue(new Error('No such container'));

      await expect(service.removeContainer('abc123')).resolves.toBeUndefined();
    });
  });

  describe('isContainerRunning', () => {
    it('should return true when container is running', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: 'true\n', stderr: '' });

      const result = await service.isContainerRunning('abc123');

      expect(result).toBe(true);
    });

    it('should return false when container is stopped', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: 'false\n', stderr: '' });

      const result = await service.isContainerRunning('abc123');

      expect(result).toBe(false);
    });

    it('should return false when container does not exist', async () => {
      commandRunner.exec.mockRejectedValue(new Error('No such container'));

      const result = await service.isContainerRunning('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('getContainerStatus', () => {
    it('should parse container inspect output', async () => {
      commandRunner.exec.mockResolvedValue({
        stdout: JSON.stringify({
          Id: 'abc123def456789',
          State: { Status: 'running' },
          Config: {
            Image: 'claudito-agent:latest',
            Labels: {
              'claudito': 'true',
              'claudito-project': 'project-1',
            },
          },
          Created: '2024-01-01T00:00:00.000Z',
        }),
        stderr: '',
      });

      const result = await service.getContainerStatus('abc123');

      expect(result).toEqual({
        containerId: 'abc123def456',
        projectId: 'project-1',
        status: 'running',
        imageName: 'claudito-agent:latest',
        createdAt: '2024-01-01T00:00:00.000Z',
        resourceUsage: null,
      });
    });

    it('should return null for nonexistent container', async () => {
      commandRunner.exec.mockRejectedValue(new Error('No such container'));

      const result = await service.getContainerStatus('nonexistent');

      expect(result).toBeNull();
    });

    it('should map exited state to stopped', async () => {
      commandRunner.exec.mockResolvedValue({
        stdout: JSON.stringify({
          Id: 'abc123def456789',
          State: { Status: 'exited' },
          Config: { Image: 'test', Labels: {} },
          Created: '2024-01-01T00:00:00.000Z',
        }),
        stderr: '',
      });

      const result = await service.getContainerStatus('abc123');

      expect(result?.status).toBe('stopped');
    });
  });

  describe('getResourceUsage', () => {
    it('should parse docker stats output', async () => {
      commandRunner.exec.mockResolvedValue({
        stdout: '15.25%\t512MiB / 4GiB',
        stderr: '',
      });

      const result = await service.getResourceUsage('abc123');

      expect(result).toEqual({
        cpuPercent: 15.25,
        memoryUsageMb: 512,
        memoryLimitMb: 4096,
      });
    });

    it('should handle GiB memory format', async () => {
      commandRunner.exec.mockResolvedValue({
        stdout: '5.00%\t2GiB / 8GiB',
        stderr: '',
      });

      const result = await service.getResourceUsage('abc123');

      expect(result?.memoryUsageMb).toBe(2048);
      expect(result?.memoryLimitMb).toBe(8192);
    });

    it('should return null on error', async () => {
      commandRunner.exec.mockRejectedValue(new Error('No such container'));

      const result = await service.getResourceUsage('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('copyToContainer', () => {
    it('should pass raw host path to docker cp without translation', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      await service.copyToContainer('abc123', '/host/path/.claude', '/home/claudito/');

      expect(commandRunner.exec).toHaveBeenCalledWith('docker', [
        'cp', '/host/path/.claude', 'abc123:/home/claudito/',
      ]);
    });

    it('should NOT translate Windows paths for docker cp', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      await service.copyToContainer('abc123', 'C:\\Users\\comfo\\.claude', '/home/claudito/');

      const args = commandRunner.exec.mock.calls[0]![1];
      const srcPath = args[1];

      // docker cp expects native host paths — no translation should occur
      expect(srcPath).toBe('C:\\Users\\comfo\\.claude');
    });

    it('should propagate errors', async () => {
      commandRunner.exec.mockRejectedValue(new Error('No such container'));

      await expect(service.copyToContainer('bad', '/path', '/dest')).rejects.toThrow('No such container');
    });
  });

  describe('execInContainer', () => {
    it('should call docker exec with correct args', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: 'ok', stderr: '' });

      const result = await service.execInContainer('abc123', ['chown', '-R', 'user:user', '/dir']);

      expect(commandRunner.exec).toHaveBeenCalledWith('docker', [
        'exec', 'abc123', 'chown', '-R', 'user:user', '/dir',
      ]);
      expect(result.stdout).toBe('ok');
    });

    it('should insert -u flag when user option is provided', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: 'ok', stderr: '' });

      await service.execInContainer('abc123', ['chown', '-R', 'user:user', '/dir'], { user: 'root' });

      expect(commandRunner.exec).toHaveBeenCalledWith('docker', [
        'exec', '-u', 'root', 'abc123', 'chown', '-R', 'user:user', '/dir',
      ]);
    });

    it('should not insert -u flag when no user option is provided', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: 'ok', stderr: '' });

      await service.execInContainer('abc123', ['ls']);

      expect(commandRunner.exec).toHaveBeenCalledWith('docker', [
        'exec', 'abc123', 'ls',
      ]);
    });

    it('should propagate errors', async () => {
      commandRunner.exec.mockRejectedValue(new Error('exec failed'));

      await expect(service.execInContainer('bad', ['ls'])).rejects.toThrow('exec failed');
    });
  });

  describe('listContainers', () => {
    it('should parse container list output', async () => {
      commandRunner.exec.mockResolvedValue({
        stdout: 'abc123\tclaudito-1234\tUp 5 minutes\tclaudito-agent:latest\t2024-01-01 00:00:00\n' +
                'def456\tclaudito-5678\tExited (0) 1 hour ago\tclaudito-agent:latest\t2024-01-02 00:00:00',
        stderr: '',
      });

      const result = await service.listContainers();

      expect(result).toHaveLength(2);
      expect(result[0]?.status).toBe('running');
      expect(result[1]?.status).toBe('stopped');
    });

    it('should return empty array when no containers', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await service.listContainers();

      expect(result).toEqual([]);
    });

    it('should return empty array on error', async () => {
      commandRunner.exec.mockRejectedValue(new Error('Docker not running'));

      const result = await service.listContainers();

      expect(result).toEqual([]);
    });

    it('should filter by claudito label', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      await service.listContainers();

      const args = commandRunner.exec.mock.calls[0]![1];
      expect(args).toContain('--filter');
      expect(args).toContain('label=claudito=true');
    });
  });
});

describe('generateContainerName', () => {
  it('should generate deterministic names', () => {
    const name1 = generateContainerName('project-123');
    const name2 = generateContainerName('project-123');

    expect(name1).toBe(name2);
  });

  it('should generate different names for different projects', () => {
    const name1 = generateContainerName('project-1');
    const name2 = generateContainerName('project-2');

    expect(name1).not.toBe(name2);
  });

  it('should use claudito prefix', () => {
    const name = generateContainerName('any-project');

    expect(name).toMatch(/^claudito-[a-f0-9]{12}$/);
  });
});

// Helper to extract -v arguments from Docker CLI args
function extractVolumeArgs(args: string[]): string[] {
  const volumes: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-v' && i + 1 < args.length) {
      volumes.push(args[i + 1]!);
    }
  }

  return volumes;
}
