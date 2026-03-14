import { EventEmitter } from 'events';
import { ChildProcess, execFile } from 'child_process';
import {
  ProcessManager,
  ProcessSpawner,
} from '../../../src/agents/process-manager';
import { Logger } from '../../../src/utils';

jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return {
    ...actual,
    execFile: jest.fn((cmd: string, args: string[], cb: (err: Error | null) => void) => cb(null)),
  };
});

const mockExecFile = execFile as unknown as jest.Mock;

function createMockLogger(): jest.Mocked<Logger> {
  const mock: jest.Mocked<Logger> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
    withProject: jest.fn(),
  };
  mock.child.mockReturnValue(mock);
  mock.withProject.mockReturnValue(mock);
  return mock;
}

/**
 * Creates a mock ChildProcess with controllable streams and events.
 */
function createMockChildProcess(pid: number | undefined = 1234): ChildProcess {
  const cp = new EventEmitter() as ChildProcess;
  Object.defineProperty(cp, 'pid', { value: pid, writable: true });
  (cp as unknown as Record<string, unknown>).stdin = {
    write: jest.fn().mockReturnValue(true),
    end: jest.fn(),
  };
  (cp as unknown as Record<string, unknown>).stdout = new EventEmitter();
  (cp as unknown as Record<string, unknown>).stderr = new EventEmitter();
  (cp as unknown as Record<string, unknown>).removeAllListeners = jest.fn().mockReturnThis();
  // Keep the original EventEmitter on/once/removeListener
  return cp;
}

function createMockSpawner(
  mockProcess?: ChildProcess
): jest.Mocked<ProcessSpawner> {
  return {
    spawn: jest.fn().mockReturnValue(
      mockProcess || createMockChildProcess()
    ),
  };
}

describe('ProcessManager', () => {
  let pm: ProcessManager;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockSpawner: jest.Mocked<ProcessSpawner>;
  let mockChild: ChildProcess;

  beforeEach(() => {
    process.setMaxListeners(50);
    mockLogger = createMockLogger();
    mockChild = createMockChildProcess();
    mockSpawner = createMockSpawner(mockChild);
    pm = new ProcessManager(mockLogger, mockSpawner);
  });

  afterEach(() => {
    pm.removeAllListeners();
  });

  // =========================================================================
  // spawn
  // =========================================================================
  describe('spawn', () => {
    it('should spawn a process and return it', () => {
      const result = pm.spawn('claude', ['--json'], '/tmp/project');

      expect(result).toBe(mockChild);
      expect(mockSpawner.spawn).toHaveBeenCalledWith(
        'claude',
        ['--json'],
        expect.objectContaining({
          cwd: '/tmp/project',
          shell: false,
          windowsHide: true,
        })
      );
    });

    it('should pass env to spawner', () => {
      pm.spawn('claude', [], '/tmp', { MY_VAR: 'test' });

      expect(mockSpawner.spawn).toHaveBeenCalledWith(
        'claude',
        [],
        expect.objectContaining({ env: { MY_VAR: 'test' } })
      );
    });

    it('should throw if a process is already running', () => {
      pm.spawn('claude', [], '/tmp');

      expect(() => pm.spawn('claude', [], '/tmp')).toThrow(
        'Process is already running'
      );
    });

    it('should throw if spawned process has no PID', () => {
      const noPidChild = createMockChildProcess(0);
      mockSpawner.spawn.mockReturnValue(noPidChild);

      expect(() => pm.spawn('claude', [], '/tmp')).toThrow(
        'Failed to spawn process - no PID assigned'
      );
    });

    it('should throw if spawner throws', () => {
      mockSpawner.spawn.mockImplementation(() => {
        throw new Error('spawn ENOENT');
      });

      expect(() => pm.spawn('claude', [], '/tmp')).toThrow('spawn ENOENT');
    });

    it('should emit processStarted event', () => {
      const listener = jest.fn();
      pm.on('processStarted', listener);

      pm.spawn('claude', ['--json'], '/tmp/project');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          pid: 1234,
          command: 'claude',
          args: ['--json'],
          workingDirectory: '/tmp/project',
        })
      );
    });
  });

  // =========================================================================
  // getProcess / getProcessInfo / isRunning
  // =========================================================================
  describe('getProcess / getProcessInfo / isRunning', () => {
    it('should return null before spawn', () => {
      expect(pm.getProcess()).toBeNull();
      expect(pm.getProcessInfo()).toBeNull();
      expect(pm.isRunning()).toBe(false);
    });

    it('should return values after spawn', () => {
      pm.spawn('claude', ['--flag'], '/tmp');

      expect(pm.getProcess()).toBe(mockChild);
      expect(pm.getProcessInfo()).toEqual(
        expect.objectContaining({
          pid: 1234,
          command: 'claude',
          args: ['--flag'],
          workingDirectory: '/tmp',
        })
      );
      expect(pm.isRunning()).toBe(true);
    });
  });

  // =========================================================================
  // sendInput
  // =========================================================================
  describe('sendInput', () => {
    it('should write to stdin', () => {
      pm.spawn('claude', [], '/tmp');
      const result = pm.sendInput('hello\n');

      expect(result).toBe(true);
      expect(mockChild.stdin!.write).toHaveBeenCalledWith('hello\n');
    });

    it('should return false when no process', () => {
      expect(pm.sendInput('hello')).toBe(false);
    });

    it('should return false when stdin.write throws', () => {
      pm.spawn('claude', [], '/tmp');
      (mockChild.stdin!.write as jest.Mock).mockImplementation(() => {
        throw new Error('stdin broken');
      });

      expect(pm.sendInput('hello')).toBe(false);
    });
  });

  // =========================================================================
  // closeStdin
  // =========================================================================
  describe('closeStdin', () => {
    it('should end stdin', () => {
      pm.spawn('claude', [], '/tmp');
      pm.closeStdin();

      expect(mockChild.stdin!.end).toHaveBeenCalled();
    });

    it('should be safe when no process', () => {
      expect(() => pm.closeStdin()).not.toThrow();
    });

    it('should handle stdin.end throwing', () => {
      pm.spawn('claude', [], '/tmp');
      (mockChild.stdin!.end as jest.Mock).mockImplementation(() => {
        throw new Error('already closed');
      });

      expect(() => pm.closeStdin()).not.toThrow();
    });
  });

  // =========================================================================
  // getStdout / getStderr
  // =========================================================================
  describe('getStdout / getStderr', () => {
    it('should return null before spawn', () => {
      expect(pm.getStdout()).toBeNull();
      expect(pm.getStderr()).toBeNull();
    });

    it('should return streams after spawn', () => {
      pm.spawn('claude', [], '/tmp');

      expect(pm.getStdout()).toBe(mockChild.stdout);
      expect(pm.getStderr()).toBe(mockChild.stderr);
    });
  });

  // =========================================================================
  // stop
  // =========================================================================
  describe('stop', () => {
    it('should resolve immediately when no process', async () => {
      await expect(pm.stop()).resolves.toBeUndefined();
    });

    it('should clean up after stopping', async () => {
      pm.spawn('claude', [], '/tmp');
      await pm.stop();

      expect(pm.getProcess()).toBeNull();
      expect(pm.getProcessInfo()).toBeNull();
      expect(pm.isRunning()).toBe(false);
    });

    it('should handle process with no PID', async () => {
      // Spawn normally, then manipulate
      pm.spawn('claude', [], '/tmp');
      // Override pid to undefined
      Object.defineProperty(mockChild, 'pid', {
        value: undefined,
        writable: true,
      });

      await pm.stop();

      expect(pm.getProcess()).toBeNull();
    });
  });

  // =========================================================================
  // kill
  // =========================================================================
  describe('kill', () => {
    it('should be safe when no process', () => {
      expect(() => pm.kill()).not.toThrow();
    });

    it('should clean up after kill', () => {
      pm.spawn('claude', [], '/tmp');
      pm.kill();

      expect(pm.getProcess()).toBeNull();
      expect(pm.isRunning()).toBe(false);
    });
  });

  // =========================================================================
  // Process event handling
  // =========================================================================
  describe('process events', () => {
    it('should emit exit when process exits unexpectedly', () => {
      pm.spawn('claude', [], '/tmp');
      const exitListener = jest.fn();
      pm.on('exit', exitListener);

      mockChild.emit('exit', 1, null);

      expect(exitListener).toHaveBeenCalledWith(1);
      expect(pm.getProcess()).toBeNull();
    });

    it('should emit error when process errors', () => {
      pm.spawn('claude', [], '/tmp');
      const errorListener = jest.fn();
      pm.on('error', errorListener);

      const testError = new Error('process error');
      mockChild.emit('error', testError);

      expect(errorListener).toHaveBeenCalledWith(testError);
    });

    it('should not emit exit when shutting down', async () => {
      pm.spawn('claude', [], '/tmp');
      const exitListener = jest.fn();
      pm.on('exit', exitListener);

      // stop() sets isShuttingDown=true and removes listeners
      await pm.stop();

      expect(exitListener).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Static methods
  // =========================================================================
  describe('static isProcessRunning', () => {
    it('should return true for the current process', () => {
      expect(ProcessManager.isProcessRunning(process.pid)).toBe(true);
    });

    it('should return false for a non-existent PID', () => {
      expect(ProcessManager.isProcessRunning(999999)).toBe(false);
    });
  });

  // =========================================================================
  // stop - Windows path (execFile taskkill)
  // =========================================================================
  describe('stop - Windows taskkill', () => {
    beforeEach(() => {
      mockExecFile.mockClear();
    });

    it('should call taskkill with /F /T flags on stop', async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: Error | null) => void) => cb(null)
      );
      pm.spawn('claude', [], '/tmp');

      await pm.stop();

      expect(mockExecFile).toHaveBeenCalledWith(
        'taskkill',
        ['/PID', '1234', '/F', '/T'],
        expect.any(Function)
      );
      expect(pm.getProcess()).toBeNull();
    });

    it('should handle taskkill error on stop and still clean up', async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: Error | null) => void) =>
          cb(new Error('process not found'))
      );
      pm.spawn('claude', [], '/tmp');

      await pm.stop();

      expect(pm.getProcess()).toBeNull();
    });

    it('should handle taskkill non-not-found error on stop', async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: Error | null) => void) =>
          cb(new Error('access denied'))
      );
      pm.spawn('claude', [], '/tmp');

      await pm.stop();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Failed to kill process',
        expect.objectContaining({ pid: 1234 })
      );
      expect(pm.getProcess()).toBeNull();
    });

    it('should log error when stop throws unexpectedly', async () => {
      mockExecFile.mockImplementation(() => {
        throw new Error('unexpected failure');
      });
      pm.spawn('claude', [], '/tmp');

      await pm.stop();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error stopping process',
        expect.objectContaining({ pid: 1234 })
      );
      expect(pm.getProcess()).toBeNull();
    });
  });

  // =========================================================================
  // kill - Windows path (execFile taskkill)
  // =========================================================================
  describe('kill - Windows taskkill', () => {
    beforeEach(() => {
      mockExecFile.mockClear();
    });

    it('should call taskkill on kill', () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: Error | null) => void) => cb(null)
      );
      pm.spawn('claude', [], '/tmp');

      pm.kill();

      expect(mockExecFile).toHaveBeenCalledWith(
        'taskkill',
        ['/PID', '1234', '/F', '/T'],
        expect.any(Function)
      );
      expect(pm.getProcess()).toBeNull();
    });

    it('should handle taskkill error callback on kill', () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: Error | null) => void) =>
          cb(new Error('kill failed'))
      );
      pm.spawn('claude', [], '/tmp');

      pm.kill();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Failed to force kill process tree',
        expect.objectContaining({ pid: 1234 })
      );
      expect(pm.getProcess()).toBeNull();
    });

    it('should handle execFile throwing on kill', () => {
      mockExecFile.mockImplementation(() => {
        throw new Error('execFile crash');
      });
      pm.spawn('claude', [], '/tmp');

      pm.kill();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error force killing process',
        expect.objectContaining({ pid: 1234 })
      );
      expect(pm.getProcess()).toBeNull();
    });

    it('should not kill process with no PID', () => {
      pm.spawn('claude', [], '/tmp');
      Object.defineProperty(mockChild, 'pid', {
        value: undefined,
        writable: true,
      });

      pm.kill();

      expect(mockExecFile).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // static killProcess
  // =========================================================================
  describe('static killProcess', () => {
    beforeEach(() => {
      mockExecFile.mockClear();
    });

    it('should call taskkill on Windows', async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: Error | null) => void) => cb(null)
      );

      await ProcessManager.killProcess(5678);

      expect(mockExecFile).toHaveBeenCalledWith(
        'taskkill',
        ['/PID', '5678', '/F', '/T'],
        expect.any(Function)
      );
    });

    it('should resolve even when taskkill reports error', async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: Error | null) => void) =>
          cb(new Error('process not found'))
      );

      await expect(ProcessManager.killProcess(5678)).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe('edge cases', () => {
    it('should handle exit with signal', () => {
      pm.spawn('claude', [], '/tmp');
      const exitListener = jest.fn();
      pm.on('exit', exitListener);

      mockChild.emit('exit', null, 'SIGTERM');

      expect(exitListener).toHaveBeenCalledWith(null);
    });

    it('should handle exit with code 0', () => {
      pm.spawn('claude', [], '/tmp');
      const exitListener = jest.fn();
      pm.on('exit', exitListener);

      mockChild.emit('exit', 0, null);

      expect(exitListener).toHaveBeenCalledWith(0);
    });

    it('should set isRunning false during shutdown', async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
          // During the callback, isRunning should be false (isShuttingDown = true)
          expect(pm.isRunning()).toBe(false);
          cb(null);
        }
      );
      pm.spawn('claude', [], '/tmp');

      await pm.stop();
    });
  });
});
