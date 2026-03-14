import { DefaultRunProcessManager } from '../../../../src/services/run-config/run-process-manager';
import { RunConfigurationService } from '../../../../src/services/run-config/types';
import {
  createMockRunConfigurationService,
  sampleRunConfiguration,
} from '../../helpers/mock-factories';

// Mock node-pty
let mockPtyOnData: jest.Mock;
let mockPtyOnExit: jest.Mock;
let mockPtyKill: jest.Mock;
let mockPtyWrite: jest.Mock;

jest.mock('node-pty', () => ({
  spawn: jest.fn().mockImplementation(() => ({
    pid: 12345,
    onData: mockPtyOnData,
    onExit: mockPtyOnExit,
    kill: mockPtyKill,
    write: mockPtyWrite,
    resize: jest.fn(),
  })),
}));

describe('DefaultRunProcessManager - Extended Coverage', () => {
  let manager: DefaultRunProcessManager;
  let mockConfigService: jest.Mocked<RunConfigurationService>;
  const projectId = 'test-project';
  const projectPath = '/path/to/project';
  const configId = sampleRunConfiguration.id;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockPtyOnData = jest.fn();
    mockPtyOnExit = jest.fn();
    mockPtyKill = jest.fn();
    mockPtyWrite = jest.fn();

    mockConfigService = createMockRunConfigurationService();
    mockConfigService.getById.mockResolvedValue(sampleRunConfiguration);

    manager = new DefaultRunProcessManager({
      runConfigurationService: mockConfigService,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('auto-restart', () => {
    it('should schedule restart on non-zero exit when autoRestart enabled', async () => {
      const config = {
        ...sampleRunConfiguration,
        autoRestart: true,
        autoRestartDelay: 2000,
        autoRestartMaxRetries: 3,
      };
      mockConfigService.getById.mockResolvedValue(config);

      await manager.start(projectId, projectPath, configId);

      // Simulate non-zero exit
      const onExitCallback = mockPtyOnExit.mock.calls[0]![0] as (data: { exitCode: number }) => void;
      onExitCallback({ exitCode: 1 });

      const status = manager.getStatus(projectId, configId);
      expect(status.state).toBe('errored');

      // Advance timer to trigger restart
      jest.advanceTimersByTime(2000);

      // Wait for async spawn
      await jest.advanceTimersByTimeAsync(0);

      const statusAfterRestart = manager.getStatus(projectId, configId);
      expect(statusAfterRestart.state).toBe('running');
      expect(statusAfterRestart.restartCount).toBe(1);
    });

    it('should not restart on zero exit code', async () => {
      const pty = require('node-pty');
      const config = {
        ...sampleRunConfiguration,
        autoRestart: true,
        autoRestartDelay: 1000,
      };
      mockConfigService.getById.mockResolvedValue(config);

      await manager.start(projectId, projectPath, configId);
      const initialSpawnCount = pty.spawn.mock.calls.length;

      // Simulate clean exit
      const onExitCallback = mockPtyOnExit.mock.calls[0]![0] as (data: { exitCode: number }) => void;
      onExitCallback({ exitCode: 0 });

      jest.advanceTimersByTime(2000);

      // Should not have spawned again
      expect(pty.spawn.mock.calls.length).toBe(initialSpawnCount);
    });

    it('should stop restarting when max retries reached', async () => {
      const pty = require('node-pty');
      const config = {
        ...sampleRunConfiguration,
        autoRestart: true,
        autoRestartDelay: 100,
        autoRestartMaxRetries: 2,
      };
      mockConfigService.getById.mockResolvedValue(config);

      await manager.start(projectId, projectPath, configId);

      // First failure + restart
      let onExitCallback = mockPtyOnExit.mock.calls[0]![0] as (data: { exitCode: number }) => void;
      onExitCallback({ exitCode: 1 });
      jest.advanceTimersByTime(100);
      await jest.advanceTimersByTimeAsync(0);

      // Second failure + restart
      onExitCallback = mockPtyOnExit.mock.calls[1]![0] as (data: { exitCode: number }) => void;
      onExitCallback({ exitCode: 1 });
      jest.advanceTimersByTime(100);
      await jest.advanceTimersByTimeAsync(0);

      const spawnCountBefore = pty.spawn.mock.calls.length;

      // Third failure - should NOT restart (maxRetries = 2, restartCount = 2)
      onExitCallback = mockPtyOnExit.mock.calls[2]![0] as (data: { exitCode: number }) => void;
      onExitCallback({ exitCode: 1 });
      jest.advanceTimersByTime(100);
      await jest.advanceTimersByTimeAsync(0);

      expect(pty.spawn.mock.calls.length).toBe(spawnCountBefore);
    });

    it('should not limit restarts when maxRetries is 0 (unlimited)', async () => {
      const config = {
        ...sampleRunConfiguration,
        autoRestart: true,
        autoRestartDelay: 100,
        autoRestartMaxRetries: 0, // unlimited
      };
      mockConfigService.getById.mockResolvedValue(config);

      await manager.start(projectId, projectPath, configId);

      // Do 3 failure+restart cycles
      for (let i = 0; i < 3; i++) {
        const onExitCallback = mockPtyOnExit.mock.calls[i]![0] as (data: { exitCode: number }) => void;
        onExitCallback({ exitCode: 1 });
        jest.advanceTimersByTime(100);
        await jest.advanceTimersByTimeAsync(0);
      }

      // Should still be running after 3 restarts
      const status = manager.getStatus(projectId, configId);
      expect(status.state).toBe('running');
      expect(status.restartCount).toBe(3);
    });
  });

  describe('stop cancels pending restart', () => {
    it('should cancel pending restart timer on stop', async () => {
      const config = {
        ...sampleRunConfiguration,
        autoRestart: true,
        autoRestartDelay: 5000,
      };
      mockConfigService.getById.mockResolvedValue(config);

      await manager.start(projectId, projectPath, configId);

      // Simulate non-zero exit
      const onExitCallback = mockPtyOnExit.mock.calls[0]![0] as (data: { exitCode: number }) => void;
      onExitCallback({ exitCode: 1 });

      // Stop before restart timer fires
      await manager.stop(projectId, configId);

      const pty = require('node-pty');
      const spawnCountBefore = pty.spawn.mock.calls.length;

      // Advance past restart delay
      jest.advanceTimersByTime(6000);
      await jest.advanceTimersByTimeAsync(0);

      // Should not have restarted
      expect(pty.spawn.mock.calls.length).toBe(spawnCountBefore);
    });
  });

  describe('start with existing running process', () => {
    it('should stop existing process before starting new one', async () => {
      await manager.start(projectId, projectPath, configId);

      expect(manager.getStatus(projectId, configId).state).toBe('running');

      // Start again - should stop existing first
      await manager.start(projectId, projectPath, configId);

      expect(mockPtyKill).toHaveBeenCalled();
      expect(manager.getStatus(projectId, configId).state).toBe('running');
    });
  });

  describe('pre-launch chain', () => {
    it('should start pre-launch config before main config', async () => {
      const pty = require('node-pty');
      const preLaunchConfig = {
        ...sampleRunConfiguration,
        id: 'pre-launch-1',
        name: 'DB',
        command: 'docker',
        args: ['compose', 'up'],
        preLaunchConfigId: null,
      };

      const mainConfig = {
        ...sampleRunConfiguration,
        preLaunchConfigId: 'pre-launch-1',
      };

      // eslint-disable-next-line @typescript-eslint/require-await
      mockConfigService.getById.mockImplementation(async (_pid, cid) => {
        if (cid === 'pre-launch-1') return preLaunchConfig;
        return mainConfig;
      });

      const startPromise = manager.start(projectId, projectPath, configId);

      // The pre-launch process needs to be "running" for waitForRunning to succeed
      // It should already be in running state after spawn, so just advance timers
      jest.advanceTimersByTime(200);

      await startPromise;

      // Both processes should have been spawned (pre-launch + main)
      expect(pty.spawn).toHaveBeenCalledTimes(2);
    });

    it('should handle pre-launch config not found', async () => {
      const mainConfig = {
        ...sampleRunConfiguration,
        preLaunchConfigId: 'missing-config',
      };

      // eslint-disable-next-line @typescript-eslint/require-await
      mockConfigService.getById.mockImplementation(async (_pid, cid) => {
        if (cid === 'missing-config') return null;
        return mainConfig;
      });

      // Should not throw - missing pre-launch config just returns
      const status = await manager.start(projectId, projectPath, configId);
      expect(status.state).toBe('running');
    });
  });

  describe('environment variables', () => {
    it('should inject CLAUDITO env vars into spawned process', async () => {
      const pty = require('node-pty');
      const config = {
        ...sampleRunConfiguration,
        env: { MY_VAR: 'test-value' },
      };
      mockConfigService.getById.mockResolvedValue(config);

      await manager.start(projectId, projectPath, configId);

      const spawnCall = pty.spawn.mock.calls[0]!;
      const spawnOpts = spawnCall[2];

      expect(spawnOpts.env.CLAUDITO_RUN_CONFIG).toBe('Dev Server');
      expect(spawnOpts.env.CLAUDITO_PROJECT_ROOT).toBe(projectPath);
      expect(spawnOpts.env.MY_VAR).toBe('test-value');
    });
  });

  describe('buildSpawnArgs', () => {
    it('should build command with args', async () => {
      const pty = require('node-pty');
      const config = {
        ...sampleRunConfiguration,
        command: 'npm',
        args: ['run', 'dev'],
      };
      mockConfigService.getById.mockResolvedValue(config);

      await manager.start(projectId, projectPath, configId);

      const spawnCall = pty.spawn.mock.calls[0]!;
      const args = spawnCall[1] as string[];

      // On this platform (win32), it should use /c, on Unix -c
      const flag = args[0]!;
      expect(['/c', '-c']).toContain(flag);

      const fullCommand = args[1]!;
      expect(fullCommand).toContain('npm run dev');
    });

    it('should build command without args', async () => {
      const pty = require('node-pty');
      const config = {
        ...sampleRunConfiguration,
        command: 'make',
        args: [],
      };
      mockConfigService.getById.mockResolvedValue(config);

      await manager.start(projectId, projectPath, configId);

      const spawnCall = pty.spawn.mock.calls[0]!;
      const args = spawnCall[1] as string[];
      const fullCommand = args[1]!;
      expect(fullCommand).toBe('make');
    });
  });

  describe('custom shell', () => {
    it('should use config shell when provided', async () => {
      const pty = require('node-pty');
      const config = {
        ...sampleRunConfiguration,
        shell: '/usr/bin/zsh',
      };
      mockConfigService.getById.mockResolvedValue(config);

      await manager.start(projectId, projectPath, configId);

      const spawnCall = pty.spawn.mock.calls[0]!;
      expect(spawnCall[0]).toBe('/usr/bin/zsh');
    });

    it('should use default shell when config shell is null', async () => {
      const pty = require('node-pty');
      const config = {
        ...sampleRunConfiguration,
        shell: null,
      };
      mockConfigService.getById.mockResolvedValue(config);

      await manager.start(projectId, projectPath, configId);

      const spawnCall = pty.spawn.mock.calls[0]!;
      const shell = spawnCall[0] as string;
      // Should be platform default (cmd.exe on Windows, or SHELL env / /bin/sh)
      expect(shell).toBeTruthy();
    });
  });

  describe('custom cwd', () => {
    it('should resolve relative cwd against project path', async () => {
      const pty = require('node-pty');
      const config = {
        ...sampleRunConfiguration,
        cwd: 'frontend',
      };
      mockConfigService.getById.mockResolvedValue(config);

      await manager.start(projectId, projectPath, configId);

      const spawnCall = pty.spawn.mock.calls[0]!;
      const spawnOpts = spawnCall[2];
      // path.resolve should combine projectPath and cwd
      expect(spawnOpts.cwd).toContain('frontend');
    });
  });

  describe('uptime calculation', () => {
    it('should return null uptime for non-running process', async () => {
      await manager.start(projectId, projectPath, configId);

      const onExitCallback = mockPtyOnExit.mock.calls[0]![0] as (data: { exitCode: number }) => void;
      onExitCallback({ exitCode: 0 });

      const status = manager.getStatus(projectId, configId);
      expect(status.uptimeMs).toBeNull();
    });

    it('should calculate uptime for running process', async () => {
      await manager.start(projectId, projectPath, configId);

      jest.advanceTimersByTime(5000);

      const status = manager.getStatus(projectId, configId);
      expect(status.uptimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('stop edge cases', () => {
    it('should handle kill throwing (process already dead)', async () => {
      mockPtyKill.mockImplementation(() => {
        throw new Error('Process already exited');
      });

      await manager.start(projectId, projectPath, configId);
      // Should not throw
      await manager.stop(projectId, configId);

      const status = manager.getStatus(projectId, configId);
      expect(status.state).toBe('stopped');
    });

    it('should do nothing when stopping a non-running process', async () => {
      await manager.start(projectId, projectPath, configId);

      // Simulate exit first
      const onExitCallback = mockPtyOnExit.mock.calls[0]![0] as (data: { exitCode: number }) => void;
      onExitCallback({ exitCode: 0 });

      // Now stop - process is already stopped
      await manager.stop(projectId, configId);
      const status = manager.getStatus(projectId, configId);
      expect(status.state).toBe('stopped');
    });
  });

  describe('status events', () => {
    it('should emit status on start', async () => {
      const statusHandler = jest.fn();
      manager.on('status', statusHandler);

      await manager.start(projectId, projectPath, configId);

      expect(statusHandler).toHaveBeenCalledWith(
        projectId,
        configId,
        expect.objectContaining({ state: 'running' })
      );
    });

    it('should emit status on stop', async () => {
      const statusHandler = jest.fn();
      manager.on('status', statusHandler);

      await manager.start(projectId, projectPath, configId);
      await manager.stop(projectId, configId);

      const lastCall = statusHandler.mock.calls[statusHandler.mock.calls.length - 1]!;
      expect(lastCall[2].state).toBe('stopped');
    });
  });

  describe('shutdown', () => {
    it('should clear all process maps', async () => {
      await manager.start(projectId, projectPath, configId);
      await manager.shutdown();

      const statuses = manager.getAllStatuses(projectId);
      expect(statuses).toEqual([]);
    });
  });
});
