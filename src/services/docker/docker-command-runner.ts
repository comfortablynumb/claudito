/**
 * Docker Command Runner
 * Wraps child_process for Docker CLI execution, injectable for testing
 */

import { ChildProcess, execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { DockerCommandRunner } from './types';

const execFileAsync = promisify(execFile);

export class DefaultDockerCommandRunner implements DockerCommandRunner {
  async exec(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    const result = await execFileAsync(command, args, { encoding: 'utf-8' });
    return { stdout: result.stdout, stderr: result.stderr };
  }

  spawn(command: string, args: string[]): ChildProcess {
    return spawn(command, args);
  }
}
