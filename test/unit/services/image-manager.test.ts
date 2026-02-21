import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';
import { DefaultImageManager } from '../../../src/services/docker/image-manager';
import { createMockDockerCommandRunner } from '../helpers/mock-factories';
import { DockerCommandRunner } from '../../../src/services/docker/types';

describe('DefaultImageManager', () => {
  let commandRunner: jest.Mocked<DockerCommandRunner>;
  let manager: DefaultImageManager;

  const variantsDir = '/app/docker';

  beforeEach(() => {
    commandRunner = createMockDockerCommandRunner();
    manager = new DefaultImageManager({
      commandRunner,
      variantsDir,
    });
  });

  describe('listImages', () => {
    it('should parse Docker images output', async () => {
      const imageJson = [
        '{"ID":"sha256:abc123","Repository":"claudito-agent","Tag":"latest","Size":"500MB","CreatedAt":"2024-01-01 00:00:00"}',
        '{"ID":"sha256:def456","Repository":"claudito-python","Tag":"latest","Size":"800MB","CreatedAt":"2024-01-02 00:00:00"}',
      ].join('\n');

      commandRunner.exec.mockResolvedValue({ stdout: imageJson, stderr: '' });

      const images = await manager.listImages();

      expect(images).toHaveLength(2);
      expect(images[0]!.name).toBe('claudito-agent');
      expect(images[0]!.tag).toBe('latest');
      expect(images[0]!.size).toBe('500MB');
      expect(images[1]!.name).toBe('claudito-python');
    });

    it('should return empty array on non-daemon errors', async () => {
      commandRunner.exec.mockRejectedValue(new Error('Docker not running'));

      const images = await manager.listImages();

      expect(images).toHaveLength(0);
    });

    it('should rethrow when daemon is not running (Cannot connect message)', async () => {
      commandRunner.exec.mockRejectedValue(new Error('Cannot connect to the Docker daemon at unix:///var/run/docker.sock'));

      await expect(manager.listImages()).rejects.toThrow('Cannot connect to the Docker daemon');
    });

    it('should rethrow when daemon is not running (error during connect message)', async () => {
      commandRunner.exec.mockRejectedValue(new Error('error during connect: Get http://...'));

      await expect(manager.listImages()).rejects.toThrow('error during connect');
    });

    it('should rethrow when daemon is not running (Is the docker daemon running message)', async () => {
      commandRunner.exec.mockRejectedValue(new Error('Is the docker daemon running?'));

      await expect(manager.listImages()).rejects.toThrow('Is the docker daemon running');
    });

    it('should return empty array for empty output', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      const images = await manager.listImages();

      expect(images).toHaveLength(0);
    });

    it('should filter by claudito prefix', async () => {
      await manager.listImages();

      const args = commandRunner.exec.mock.calls[0]!;
      expect(args[1]).toContain('--filter');
      expect(args[1]).toContain('reference=claudito-*');
    });
  });

  describe('buildImage', () => {
    it('should call docker build with correct args', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      await manager.buildImage({
        dockerfilePath: 'Dockerfile.claudito-agent',
        imageName: 'claudito-agent:latest',
      });

      const args = commandRunner.exec.mock.calls[0]!;
      expect(args[0]).toBe('docker');
      expect(args[1]).toContain('build');
      expect(args[1]).toContain('-t');
      expect(args[1]).toContain('claudito-agent:latest');
    });

    it('should resolve dockerfile path relative to variants dir', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      await manager.buildImage({
        dockerfilePath: 'variants/Dockerfile.python',
        imageName: 'claudito-python:latest',
      });

      const args = commandRunner.exec.mock.calls[0]![1];
      const fIndex = args.indexOf('-f');
      const dockerfilePath = args[fIndex + 1];

      // Should be resolved to absolute path
      expect(dockerfilePath).toContain('Dockerfile.python');
    });
  });

  describe('buildImageStreaming', () => {
    function createMockChildProcess(): ChildProcess & EventEmitter {
      const child = new EventEmitter() as ChildProcess & EventEmitter;
      child.stdout = new EventEmitter() as any;
      child.stderr = new EventEmitter() as any;
      return child;
    }

    it('should stream output lines through callback', async () => {
      const child = createMockChildProcess();
      commandRunner.spawn.mockReturnValue(child);

      const lines: string[] = [];
      const promise = manager.buildImageStreaming(
        { dockerfilePath: 'Dockerfile.claudito-agent', imageName: 'claudito-agent:latest' },
        (line) => lines.push(line),
      );

      child.stdout!.emit('data', Buffer.from('Step 1/5 : FROM node:22\n'));
      child.stdout!.emit('data', Buffer.from('Step 2/5 : RUN apt-get update\n'));
      child.emit('close', 0);

      await promise;

      expect(lines).toContain('Step 1/5 : FROM node:22');
      expect(lines).toContain('Step 2/5 : RUN apt-get update');
    });

    it('should reject on non-zero exit code', async () => {
      const child = createMockChildProcess();
      commandRunner.spawn.mockReturnValue(child);

      const promise = manager.buildImageStreaming(
        { dockerfilePath: 'Dockerfile.claudito-agent', imageName: 'claudito-agent:latest' },
        () => {},
      );

      child.emit('close', 1);

      await expect(promise).rejects.toThrow('Docker build failed with exit code 1');
    });

    it('should reject on spawn error', async () => {
      const child = createMockChildProcess();
      commandRunner.spawn.mockReturnValue(child);

      const promise = manager.buildImageStreaming(
        { dockerfilePath: 'Dockerfile.claudito-agent', imageName: 'claudito-agent:latest' },
        () => {},
      );

      child.emit('error', new Error('spawn ENOENT'));

      await expect(promise).rejects.toThrow('spawn ENOENT');
    });

    it('should stream stderr output too', async () => {
      const child = createMockChildProcess();
      commandRunner.spawn.mockReturnValue(child);

      const lines: string[] = [];
      const promise = manager.buildImageStreaming(
        { dockerfilePath: 'Dockerfile.claudito-agent', imageName: 'claudito-agent:latest' },
        (line) => lines.push(line),
      );

      child.stderr!.emit('data', Buffer.from('WARNING: something\n'));
      child.emit('close', 0);

      await promise;

      expect(lines).toContain('WARNING: something');
    });
  });

  describe('removeImage', () => {
    it('should call docker rmi', async () => {
      commandRunner.exec.mockResolvedValue({ stdout: '', stderr: '' });

      await manager.removeImage('claudito-agent:latest');

      expect(commandRunner.exec).toHaveBeenCalledWith('docker', [
        'rmi',
        'claudito-agent:latest',
      ]);
    });
  });

  describe('getAvailableVariants', () => {
    it('should return built-in variants', () => {
      const variants = manager.getAvailableVariants();

      expect(variants.length).toBeGreaterThanOrEqual(4);

      const names = variants.map((v) => v.name);
      expect(names).toContain('agent');
      expect(names).toContain('python');
      expect(names).toContain('rust');
      expect(names).toContain('go');
    });

    it('should include display names and descriptions', () => {
      const variants = manager.getAvailableVariants();
      const python = variants.find((v) => v.name === 'python');

      expect(python).toBeDefined();
      expect(python!.displayName).toBe('Python');
      expect(python!.description).toContain('Python');
    });

    it('should resolve dockerfile paths to include variant dir', () => {
      const variants = manager.getAvailableVariants();

      for (const variant of variants) {
        // Path should contain the Dockerfile name and be resolved
        expect(variant.dockerfilePath).toContain('Dockerfile');
        // Path should be longer than just the filename (i.e., resolved)
        expect(variant.dockerfilePath.length).toBeGreaterThan(20);
      }
    });
  });
});
