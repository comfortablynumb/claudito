/**
 * Docker Process Spawner
 * Implements ProcessSpawner to run commands inside a Docker container.
 * Translates spawn('claude', args) into spawn('docker', ['exec', '-i', ...env, containerId, 'claude', ...args]).
 */

import { ProcessSpawner, SpawnOptions } from '../../agents/process-manager';
import { ChildProcess } from 'child_process';

/**
 * Env vars safe to forward from the host into Docker containers.
 * Everything else (HOME, TEMP, PATH, etc.) is left to the container's own environment.
 */
const DOCKER_ENV_WHITELIST = new Set([
  'ANTHROPIC_API_KEY',
  'FORCE_COLOR',
  'ANTHROPIC_TELEMETRY',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'CLOUD_ML_REGION',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
]);

export interface DockerProcessSpawnerConfig {
  containerId: string;
  workDir: string;
}

export class DockerProcessSpawner implements ProcessSpawner {
  private readonly containerId: string;
  private readonly workDir: string;
  private readonly hostSpawner: ProcessSpawner;

  constructor(config: DockerProcessSpawnerConfig, hostSpawner: ProcessSpawner) {
    this.containerId = config.containerId;
    this.workDir = config.workDir;
    this.hostSpawner = hostSpawner;
  }

  spawn(command: string, args: string[], options: SpawnOptions): ChildProcess {
    const dockerArgs = this.buildDockerArgs(command, args, options);

    return this.hostSpawner.spawn('docker', dockerArgs, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
    });
  }

  private buildDockerArgs(
    command: string,
    args: string[],
    options: SpawnOptions,
  ): string[] {
    const dockerArgs: string[] = ['exec', '-i', '-w', this.workDir];

    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        if (DOCKER_ENV_WHITELIST.has(key)) {
          dockerArgs.push('-e', `${key}=${value}`);
        }
      }
    }

    dockerArgs.push(this.containerId, command, ...args);
    return dockerArgs;
  }
}
