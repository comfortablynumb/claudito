import { DefaultContainerManager } from '../../../src/services/docker/container-manager';
import {
  createMockDockerService,
  createMockSettingsRepository,
  createMockFileSystemChecker,
  sampleContainerInfo,
  DEFAULT_TEST_SETTINGS,
} from '../helpers/mock-factories';
import { DockerService, ContainerInfo } from '../../../src/services/docker/types';
import { SettingsRepository } from '../../../src/repositories/settings';
import { FileSystemChecker } from '../../../src/services/docker/container-manager';

describe('DefaultContainerManager', () => {
  let dockerService: jest.Mocked<DockerService>;
  let settingsRepository: jest.Mocked<SettingsRepository>;
  let manager: DefaultContainerManager;

  const projectId = '123e4567-e89b-12d3-a456-426614174000';
  const projectPath = '/home/user/my-project';
  const containerId = 'abc123def456';

  beforeEach(() => {
    dockerService = createMockDockerService();
    settingsRepository = createMockSettingsRepository();
    manager = new DefaultContainerManager({
      dockerService,
      settingsRepository,
    });
  });

  describe('ensureContainer', () => {
    it('should create a new container when none exists', async () => {
      dockerService.isContainerRunning.mockResolvedValue(false);
      dockerService.listContainers.mockResolvedValue([]);
      dockerService.createContainer.mockResolvedValue(containerId);

      const result = await manager.ensureContainer(projectId, projectPath);

      expect(result.containerId).toBe(containerId);
      expect(result.imageName).toBe(DEFAULT_TEST_SETTINGS.docker.baseImage);
      expect(result.wasCreated).toBe(true);
      expect(result.wasRestarted).toBe(false);
      expect(dockerService.createContainer).toHaveBeenCalled();
      expect(dockerService.startContainer).toHaveBeenCalledWith(containerId);
    });

    it('should return existing running container', async () => {
      // First call creates
      dockerService.listContainers.mockResolvedValue([]);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.isContainerRunning.mockResolvedValue(false);
      await manager.ensureContainer(projectId, projectPath);

      // Second call should return cached container
      dockerService.isContainerRunning.mockResolvedValue(true);
      const result = await manager.ensureContainer(projectId, projectPath);

      expect(result.containerId).toBe(containerId);
      expect(result.imageName).toBe(DEFAULT_TEST_SETTINGS.docker.baseImage);
      expect(result.wasCreated).toBe(false);
      expect(result.wasRestarted).toBe(false);
      // createContainer should only be called once
      expect(dockerService.createContainer).toHaveBeenCalledTimes(1);
    });

    it('should restart a stopped tracked container', async () => {
      // First: create container
      dockerService.listContainers.mockResolvedValue([]);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.isContainerRunning.mockResolvedValue(false);
      await manager.ensureContainer(projectId, projectPath);

      // Second: container is stopped but still tracked
      dockerService.isContainerRunning.mockResolvedValue(false);
      const result = await manager.ensureContainer(projectId, projectPath);

      expect(result.containerId).toBe(containerId);
      expect(result.imageName).toBe(DEFAULT_TEST_SETTINGS.docker.baseImage);
      expect(result.wasCreated).toBe(false);
      expect(result.wasRestarted).toBe(true);
      // startContainer called: once on create, once on restart
      expect(dockerService.startContainer).toHaveBeenCalledTimes(2);
    });

    it('should find and reattach to existing container by name', async () => {
      const existingContainer: ContainerInfo = {
        ...sampleContainerInfo,
        containerId: 'existing-container-id',
        status: 'running',
      };

      dockerService.isContainerRunning.mockResolvedValue(false);
      dockerService.listContainers.mockResolvedValue([existingContainer]);
      dockerService.getContainerStatus.mockResolvedValue(existingContainer);

      const result = await manager.ensureContainer(projectId, projectPath);

      expect(result.containerId).toBe('existing-container-id');
      expect(result.imageName).toBe(sampleContainerInfo.imageName);
      expect(result.wasCreated).toBe(false);
      expect(result.wasRestarted).toBe(false);
      expect(dockerService.createContainer).not.toHaveBeenCalled();
    });

    it('should start a found stopped container', async () => {
      const stoppedContainer: ContainerInfo = {
        ...sampleContainerInfo,
        containerId: 'stopped-container-id',
        status: 'stopped',
      };

      dockerService.isContainerRunning.mockResolvedValue(false);
      dockerService.listContainers.mockResolvedValue([stoppedContainer]);
      dockerService.getContainerStatus.mockResolvedValue(stoppedContainer);

      const result = await manager.ensureContainer(projectId, projectPath);

      expect(result.containerId).toBe('stopped-container-id');
      expect(result.imageName).toBe(sampleContainerInfo.imageName);
      expect(result.wasCreated).toBe(false);
      expect(result.wasRestarted).toBe(true);
      expect(dockerService.startContainer).toHaveBeenCalledWith('stopped-container-id');
    });

    it('should pass correct options when creating container', async () => {
      dockerService.isContainerRunning.mockResolvedValue(false);
      dockerService.listContainers.mockResolvedValue([]);
      dockerService.createContainer.mockResolvedValue(containerId);

      await manager.ensureContainer(projectId, projectPath);

      const createCall = dockerService.createContainer.mock.calls[0]![0];
      expect(createCall.projectId).toBe(projectId);
      expect(createCall.projectPath).toBe(projectPath);
      expect(createCall.imageName).toBe(DEFAULT_TEST_SETTINGS.docker.baseImage);
      expect(createCall.networkMode).toBe(DEFAULT_TEST_SETTINGS.docker.networkMode);
      expect(createCall.resourceLimits).toEqual(DEFAULT_TEST_SETTINGS.docker.resourceLimits);
    });

    it('should recover when tracked container was removed externally', async () => {
      // First: create container
      dockerService.listContainers.mockResolvedValue([]);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.isContainerRunning.mockResolvedValue(false);
      await manager.ensureContainer(projectId, projectPath);

      // Second: container was removed, start fails
      dockerService.isContainerRunning.mockResolvedValue(false);
      dockerService.startContainer.mockRejectedValueOnce(new Error('No such container'));

      // Should fall through and create a new container
      const newContainerId = 'new-container-id';
      dockerService.listContainers.mockResolvedValue([]);
      dockerService.createContainer.mockResolvedValue(newContainerId);

      const result = await manager.ensureContainer(projectId, projectPath);

      expect(result.containerId).toBe(newContainerId);
      expect(result.wasCreated).toBe(true);
      expect(dockerService.createContainer).toHaveBeenCalledTimes(2);
    });

    it('should throw when stale container recovery and new creation both fail', async () => {
      // First: create container
      dockerService.listContainers.mockResolvedValue([]);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.isContainerRunning.mockResolvedValue(false);
      await manager.ensureContainer(projectId, projectPath);

      // Second: tracked container removed, start fails
      dockerService.isContainerRunning.mockResolvedValue(false);
      dockerService.startContainer.mockRejectedValueOnce(new Error('No such container'));

      // New creation also fails
      dockerService.listContainers.mockResolvedValue([]);
      dockerService.createContainer.mockRejectedValue(new Error('Docker daemon not running'));

      await expect(manager.ensureContainer(projectId, projectPath))
        .rejects.toThrow('Docker daemon not running');
    });

    it('should pass ANTHROPIC_API_KEY as env var', async () => {
      const originalKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-key-123';

      try {
        dockerService.isContainerRunning.mockResolvedValue(false);
        dockerService.listContainers.mockResolvedValue([]);
        dockerService.createContainer.mockResolvedValue(containerId);

        await manager.ensureContainer(projectId, projectPath);

        const createCall = dockerService.createContainer.mock.calls[0]![0];
        expect(createCall.env.ANTHROPIC_API_KEY).toBe('test-key-123');
      } finally {
        if (originalKey !== undefined) {
          process.env.ANTHROPIC_API_KEY = originalKey;
        } else {
          delete process.env.ANTHROPIC_API_KEY;
        }
      }
    });
  });

  describe('stopProjectContainer', () => {
    it('should stop a tracked container', async () => {
      // First create a container
      dockerService.listContainers.mockResolvedValue([]);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.isContainerRunning.mockResolvedValue(false);
      await manager.ensureContainer(projectId, projectPath);

      await manager.stopProjectContainer(projectId);

      expect(dockerService.stopContainer).toHaveBeenCalledWith(containerId);
    });

    it('should do nothing when no container is tracked', async () => {
      await manager.stopProjectContainer('unknown-project');

      expect(dockerService.stopContainer).not.toHaveBeenCalled();
    });

    it('should remove from tracking after stop', async () => {
      dockerService.listContainers.mockResolvedValue([]);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.isContainerRunning.mockResolvedValue(false);
      await manager.ensureContainer(projectId, projectPath);

      await manager.stopProjectContainer(projectId);

      expect(manager.getContainerForProject(projectId)).toBeNull();
    });
  });

  describe('stopAllContainers', () => {
    it('should stop all tracked containers', async () => {
      dockerService.listContainers.mockResolvedValue([]);
      dockerService.isContainerRunning.mockResolvedValue(false);

      dockerService.createContainer.mockResolvedValueOnce('container-1');
      await manager.ensureContainer('project-1', '/path/1');

      dockerService.createContainer.mockResolvedValueOnce('container-2');
      await manager.ensureContainer('project-2', '/path/2');

      await manager.stopAllContainers();

      expect(dockerService.stopContainer).toHaveBeenCalledWith('container-1');
      expect(dockerService.stopContainer).toHaveBeenCalledWith('container-2');
    });

    it('should clear tracking after stop all', async () => {
      dockerService.listContainers.mockResolvedValue([]);
      dockerService.isContainerRunning.mockResolvedValue(false);
      dockerService.createContainer.mockResolvedValue(containerId);

      await manager.ensureContainer(projectId, projectPath);
      await manager.stopAllContainers();

      expect(manager.getContainerForProject(projectId)).toBeNull();
    });
  });

  describe('getContainerForProject', () => {
    it('should return null when no container tracked', () => {
      expect(manager.getContainerForProject('unknown')).toBeNull();
    });

    it('should return container ID when tracked', async () => {
      dockerService.listContainers.mockResolvedValue([]);
      dockerService.isContainerRunning.mockResolvedValue(false);
      dockerService.createContainer.mockResolvedValue(containerId);

      await manager.ensureContainer(projectId, projectPath);

      expect(manager.getContainerForProject(projectId)).toBe(containerId);
    });
  });

  describe('getProjectContainers', () => {
    it('should delegate to docker service', async () => {
      const containers = [sampleContainerInfo];
      dockerService.listContainers.mockResolvedValue(containers);

      const result = await manager.getProjectContainers();

      expect(result).toEqual(containers);
      expect(dockerService.listContainers).toHaveBeenCalled();
    });
  });

  describe('isHealthy', () => {
    it('should return false when no container tracked', async () => {
      expect(await manager.isHealthy('unknown')).toBe(false);
    });

    it('should return true when container is running', async () => {
      dockerService.listContainers.mockResolvedValue([]);
      dockerService.isContainerRunning.mockResolvedValue(false);
      dockerService.createContainer.mockResolvedValue(containerId);

      await manager.ensureContainer(projectId, projectPath);
      dockerService.isContainerRunning.mockResolvedValue(true);

      expect(await manager.isHealthy(projectId)).toBe(true);
    });

    it('should return false when container is not running', async () => {
      dockerService.listContainers.mockResolvedValue([]);
      dockerService.isContainerRunning.mockResolvedValue(false);
      dockerService.createContainer.mockResolvedValue(containerId);

      await manager.ensureContainer(projectId, projectPath);
      dockerService.isContainerRunning.mockResolvedValue(false);

      expect(await manager.isHealthy(projectId)).toBe(false);
    });
  });

  describe('.claude config copy', () => {
    let fsChecker: jest.Mocked<FileSystemChecker>;

    beforeEach(() => {
      fsChecker = createMockFileSystemChecker(true);
      manager = new DefaultContainerManager({
        dockerService,
        settingsRepository,
        fileSystemChecker: fsChecker,
      });
    });

    it('should selectively copy .claude entries, skipping projects', async () => {
      dockerService.isContainerRunning.mockResolvedValue(false);
      dockerService.listContainers.mockResolvedValue([]);
      dockerService.createContainer.mockResolvedValue(containerId);

      await manager.ensureContainer(projectId, projectPath);

      // mkdir -p for .claude dir (as root)
      expect(dockerService.execInContainer).toHaveBeenCalledWith(
        containerId,
        ['mkdir', '-p', '/home/claudito/.claude'],
        { user: 'root' }
      );

      // copyToContainer for each non-projects entry + .claude.json
      // Default mock returns ['.credentials.json', 'projects', 'settings.json']
      // 'projects' is skipped → 2 entry copies + 1 .claude.json = 3
      expect(dockerService.copyToContainer).toHaveBeenCalledTimes(3);
      expect(dockerService.copyToContainer).toHaveBeenCalledWith(
        containerId,
        expect.stringContaining('.credentials.json'),
        '/home/claudito/.claude/'
      );
      expect(dockerService.copyToContainer).toHaveBeenCalledWith(
        containerId,
        expect.stringContaining('settings.json'),
        '/home/claudito/.claude/'
      );
      expect(dockerService.copyToContainer).toHaveBeenCalledWith(
        containerId,
        expect.stringMatching(/\.claude\.json$/),
        '/home/claudito/'
      );

      // No rm -rf call
      expect(dockerService.execInContainer).not.toHaveBeenCalledWith(
        containerId,
        ['rm', '-rf', '/home/claudito/.claude/projects'],
        expect.anything()
      );

      // chown covers both .claude dir and .claude.json (as root)
      expect(dockerService.execInContainer).toHaveBeenCalledWith(
        containerId,
        ['sh', '-c', 'chown -R claudito:claudito /home/claudito/.claude; [ -f /home/claudito/.claude.json ] && chown claudito:claudito /home/claudito/.claude.json'],
        { user: 'root' }
      );
    });

    it('should copy .claude.json when it exists on host', async () => {
      fsChecker.fileExists.mockReturnValue(true);
      dockerService.isContainerRunning.mockResolvedValue(false);
      dockerService.listContainers.mockResolvedValue([]);
      dockerService.createContainer.mockResolvedValue(containerId);

      await manager.ensureContainer(projectId, projectPath);

      expect(dockerService.copyToContainer).toHaveBeenCalledWith(
        containerId,
        expect.stringMatching(/\.claude\.json$/),
        '/home/claudito/'
      );
    });

    it('should skip .claude.json copy when it does not exist on host', async () => {
      fsChecker.fileExists.mockReturnValue(false);
      dockerService.isContainerRunning.mockResolvedValue(false);
      dockerService.listContainers.mockResolvedValue([]);
      dockerService.createContainer.mockResolvedValue(containerId);

      await manager.ensureContainer(projectId, projectPath);

      // 2 entry copies (.credentials.json + settings.json), no .claude.json
      expect(dockerService.copyToContainer).toHaveBeenCalledTimes(2);
      expect(dockerService.copyToContainer).not.toHaveBeenCalledWith(
        containerId,
        expect.stringMatching(/\.claude\.json$/),
        '/home/claudito/'
      );
    });

    it('should skip copy when .claude does not exist on host', async () => {
      fsChecker.directoryExists.mockReturnValue(false);
      dockerService.isContainerRunning.mockResolvedValue(false);
      dockerService.listContainers.mockResolvedValue([]);
      dockerService.createContainer.mockResolvedValue(containerId);

      await manager.ensureContainer(projectId, projectPath);

      expect(dockerService.copyToContainer).not.toHaveBeenCalled();
      expect(dockerService.execInContainer).not.toHaveBeenCalled();
    });

    it('should succeed even if config copy fails', async () => {
      dockerService.isContainerRunning.mockResolvedValue(false);
      dockerService.listContainers.mockResolvedValue([]);
      dockerService.createContainer.mockResolvedValue(containerId);
      dockerService.copyToContainer.mockRejectedValue(new Error('copy failed'));

      const result = await manager.ensureContainer(projectId, projectPath);

      expect(result.containerId).toBe(containerId);
    });

    it('should use per-project image when provided', async () => {
      dockerService.isContainerRunning.mockResolvedValue(false);
      dockerService.listContainers.mockResolvedValue([]);
      dockerService.createContainer.mockResolvedValue(containerId);

      const result = await manager.ensureContainer(projectId, projectPath, 'custom-image:v2');

      const createCall = dockerService.createContainer.mock.calls[0]![0];
      expect(createCall.imageName).toBe('custom-image:v2');
      expect(result.imageName).toBe('custom-image:v2');
    });

    it('should fall back to global baseImage when no project image provided', async () => {
      dockerService.isContainerRunning.mockResolvedValue(false);
      dockerService.listContainers.mockResolvedValue([]);
      dockerService.createContainer.mockResolvedValue(containerId);

      const result = await manager.ensureContainer(projectId, projectPath);

      const createCall = dockerService.createContainer.mock.calls[0]![0];
      expect(createCall.imageName).toBe(DEFAULT_TEST_SETTINGS.docker.baseImage);
      expect(result.imageName).toBe(DEFAULT_TEST_SETTINGS.docker.baseImage);
    });

    it('should not copy when reattaching to existing container', async () => {
      const existingContainer: ContainerInfo = {
        ...sampleContainerInfo,
        containerId: 'existing-id',
        status: 'running',
      };

      dockerService.isContainerRunning.mockResolvedValue(false);
      dockerService.listContainers.mockResolvedValue([existingContainer]);
      dockerService.getContainerStatus.mockResolvedValue(existingContainer);

      await manager.ensureContainer(projectId, projectPath);

      expect(dockerService.copyToContainer).not.toHaveBeenCalled();
    });
  });
});
