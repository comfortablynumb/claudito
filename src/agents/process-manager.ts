import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { execFile } from 'child_process';
import { Logger } from '../utils';
import { ProcessInfo as ProcessInfoType } from './types';

export interface ProcessSpawner {
  spawn(command: string, args: string[], options: SpawnOptions): ChildProcess;
}

export interface SpawnOptions {
  cwd: string;
  shell: boolean;
  windowsHide: boolean;
  env?: Record<string, string>;
}

type ProcessInfo = ProcessInfoType;

export interface ProcessManagerEvents {
  exit: (code: number | null) => void;
  error: (error: Error) => void;
  processStarted: (info: ProcessInfo) => void;
}

/**
 * Default process spawner using Node.js child_process.
 */
export const defaultSpawner: ProcessSpawner = {
  spawn(command: string, args: string[], options: SpawnOptions): ChildProcess {
    return spawn(command, args, {
      cwd: options.cwd,
      shell: options.shell,
      windowsHide: options.windowsHide,
      env: { ...process.env, ...options.env },
    });
  },
};

/**
 * Manages the lifecycle of a Claude CLI process.
 */
export class ProcessManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private processInfo: ProcessInfo | null = null;
  private isShuttingDown = false;
  private readonly isWindows: boolean;

  constructor(
    private readonly logger: Logger,
    private readonly spawner: ProcessSpawner = defaultSpawner,
    platform?: string
  ) {
    super();
    this.isWindows = (platform ?? process.platform) === 'win32';
  }

  /**
   * Spawn a new Claude CLI process.
   */
  spawn(
    command: string,
    args: string[],
    workingDirectory: string,
    env?: Record<string, string>
  ): ChildProcess {
    if (this.process) {
      throw new Error('Process is already running');
    }

    const spawnOptions: SpawnOptions = {
      cwd: workingDirectory,
      shell: false,
      windowsHide: true,
      env,
    };

    this.logger.info('Spawning Claude CLI process', {
      command,
      args: args.length,
      workingDirectory,
    });

    try {
      this.process = this.spawner.spawn(command, args, spawnOptions);
    } catch (error) {
      this.logger.error('Failed to spawn process', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }

    if (!this.process.pid) {
      throw new Error('Failed to spawn process - no PID assigned');
    }

    this.processInfo = {
      pid: this.process.pid,
      command,
      args,
      workingDirectory,
      startTime: new Date(),
    };

    this.setupProcessListeners();

    this.emit('processStarted', this.processInfo);

    return this.process;
  }

  /**
   * Get the current process.
   */
  getProcess(): ChildProcess | null {
    return this.process;
  }

  /**
   * Get process information.
   */
  getProcessInfo(): ProcessInfo | null {
    return this.processInfo;
  }

  /**
   * Check if a process is running.
   */
  isRunning(): boolean {
    return this.process !== null && !this.isShuttingDown;
  }

  /**
   * Stop the process gracefully.
   */
  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    this.isShuttingDown = true;

    const pid = this.process.pid;
    if (!pid) {
      this.cleanup();
      return;
    }

    this.logger.info('Stopping process', { pid });

    // Remove listeners to prevent duplicate handling
    this.removeProcessListeners();

    try {
      if (this.isWindows) {
        await this.stopWindows(pid);
      } else {
        await this.stopUnix(pid);
      }
    } catch (error) {
      this.logger.error('Error stopping process', {
        pid,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      this.cleanup();
    }
  }

  /**
   * Kill the process forcefully.
   */
  kill(): void {
    if (!this.process || !this.process.pid) {
      return;
    }

    const pid = this.process.pid;
    this.logger.warn('Force killing process', { pid });

    try {
      if (this.isWindows) {
        execFile('taskkill', ['/PID', String(pid), '/F', '/T'], (error) => {
          if (error) {
            this.logger.debug('Failed to force kill process tree', {
              pid,
              error: error.message,
            });
          }
        });
      } else {
        process.kill(pid, 'SIGKILL');
      }
    } catch (error) {
      this.logger.error('Error force killing process', {
        pid,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      this.cleanup();
    }
  }

  /**
   * Send input to the process stdin.
   */
  sendInput(input: string): boolean {
    if (!this.process || !this.process.stdin) {
      this.logger.warn('Cannot send input - process not running or stdin not available');
      return false;
    }

    try {
      return this.process.stdin.write(input);
    } catch (error) {
      this.logger.error('Error sending input to process', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Close stdin stream.
   */
  closeStdin(): void {
    if (!this.process || !this.process.stdin) {
      this.logger.warn('Cannot close stdin - process not running or stdin not available');
      return;
    }

    try {
      this.process.stdin.end();
      this.logger.info('Closed stdin');
    } catch (error) {
      this.logger.error('Error closing stdin', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Get stdout stream from the process.
   */
  getStdout(): NodeJS.ReadableStream | null {
    return this.process?.stdout || null;
  }

  /**
   * Get stderr stream from the process.
   */
  getStderr(): NodeJS.ReadableStream | null {
    return this.process?.stderr || null;
  }

  private setupProcessListeners(): void {
    if (!this.process) return;

    this.process.on('exit', this.handleExit.bind(this));
    this.process.on('error', this.handleError.bind(this));

    // Handle process termination signals
    process.once('SIGINT', () => { void this.stop(); });
    process.once('SIGTERM', () => { void this.stop(); });
  }

  private removeProcessListeners(): void {
    if (!this.process) return;

    this.process.removeAllListeners('exit');
    this.process.removeAllListeners('error');
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.isShuttingDown) {
      return; // Expected exit
    }

    this.logger.info('Process exited', {
      code,
      signal,
      pid: this.processInfo?.pid,
    });

    this.emit('exit', code);
    this.cleanup();
  }

  private handleError(error: Error): void {
    this.logger.error('Process error', {
      error: error.message,
      pid: this.processInfo?.pid,
    });

    this.emit('error', error);
  }

  private async stopWindows(pid: number): Promise<void> {
    // On Windows, use /F (force) directly as graceful shutdown often doesn't work
    // /T kills the entire process tree
    return new Promise((resolve) => {
      execFile('taskkill', ['/PID', String(pid), '/F', '/T'], (error) => {
        if (error && !error.message.includes('not found')) {
          this.logger.debug('Failed to kill process', {
            pid,
            error: error.message,
          });
        }
        resolve();
      });
    });
  }

  private async stopUnix(pid: number): Promise<void> {
    try {
      process.kill(pid, 'SIGTERM');
      await this.waitForExit(5000);
    } catch (error) {
      // Force kill if graceful shutdown failed
      if (error instanceof Error && !error.message.includes('ESRCH')) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch (killError) {
          if (killError instanceof Error && !killError.message.includes('ESRCH')) {
            this.logger.error('Failed to kill process', {
              pid,
              error: killError.message,
            });
          }
        }
      }
    }
  }

  private async waitForExit(timeout: number): Promise<void> {
    if (!this.process) return;

    return new Promise((resolve, reject) => {
      const exitHandler = (): void => {
        clearTimeout(timeoutId);
        resolve();
      };

      this.process!.once('exit', exitHandler);

      const timeoutId = setTimeout(() => {
        this.process!.removeListener('exit', exitHandler);
        reject(new Error('Process exit timeout'));
      }, timeout);
    });
  }

  private cleanup(): void {
    this.removeProcessListeners();
    this.process = null;
    this.processInfo = null;
    this.isShuttingDown = false;
  }

  /**
   * Check if a process is running by PID.
   */
  static isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Kill a process by PID.
   */
  static async killProcess(pid: number, signal: NodeJS.Signals = 'SIGTERM', platform?: string): Promise<void> {
    if ((platform ?? process.platform) === 'win32') {
      return new Promise((resolve) => {
        // Always use /F on Windows as graceful shutdown often doesn't work
        const args = ['/PID', String(pid), '/F', '/T'];
        execFile('taskkill', args, (error) => {
          if (error && !error.message.includes('not found')) {
            // Don't throw, just resolve - process may already be dead
          }
          resolve();
        });
      });
    } else {
      process.kill(pid, signal);
    }
  }
}