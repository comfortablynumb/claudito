/**
 * Docker Service
 * Low-level Docker CLI wrapper for container and image management
 */

import { createHash } from 'crypto';
import { getLogger, Logger } from '../../utils';
import { translateToDockerPath } from './docker-path-translator';
import {
  DockerService,
  DockerCommandRunner,
  DockerAvailability,
  BuildImageOptions,
  CreateContainerOptions,
  ContainerInfo,
  ContainerResourceUsage,
  ExecOptions,
} from './types';

const CONTAINER_LABEL = 'claudito=true';
const CONTAINER_NAME_PREFIX = 'claudito-';

export function generateContainerName(projectId: string): string {
  const hash = createHash('sha256').update(projectId).digest('hex').substring(0, 12);
  return `${CONTAINER_NAME_PREFIX}${hash}`;
}

interface DockerServiceDependencies {
  commandRunner: DockerCommandRunner;
  logger?: Logger;
}

export class DefaultDockerService implements DockerService {
  private readonly commandRunner: DockerCommandRunner;
  private readonly logger: Logger;

  constructor(deps: DockerServiceDependencies) {
    this.commandRunner = deps.commandRunner;
    this.logger = deps.logger || getLogger('docker-service');
  }

  async checkAvailability(): Promise<DockerAvailability> {
    try {
      const { stdout } = await this.commandRunner.exec('docker', ['version', '--format', '{{.Server.Version}}']);
      return { installed: true, version: stdout.trim(), running: true, error: null };
    } catch (err) {
      return this.parseAvailabilityError(err);
    }
  }

  async buildImage(options: BuildImageOptions): Promise<void> {
    const args = ['build', '-t', options.imageName, '-f', options.dockerfilePath, options.context || '.'];
    await this.commandRunner.exec('docker', args);
  }

  async createContainer(options: CreateContainerOptions): Promise<string> {
    const args = this.buildCreateArgs(options);
    const { stdout } = await this.commandRunner.exec('docker', args);
    return stdout.trim();
  }

  async startContainer(containerId: string): Promise<void> {
    await this.commandRunner.exec('docker', ['start', containerId]);
  }

  async stopContainer(containerId: string): Promise<void> {
    try {
      await this.commandRunner.exec('docker', ['stop', '-t', '10', containerId]);
    } catch (err) {
      this.logger.warn(`Failed to stop container ${containerId}`, { error: extractErrorMessage(err) });
    }
  }

  async removeContainer(containerId: string): Promise<void> {
    try {
      await this.commandRunner.exec('docker', ['rm', '-f', containerId]);
    } catch (err) {
      this.logger.warn(`Failed to remove container ${containerId}`, { error: extractErrorMessage(err) });
    }
  }

  async getContainerStatus(containerId: string): Promise<ContainerInfo | null> {
    try {
      const { stdout } = await this.commandRunner.exec('docker', [
        'inspect', '--format', '{{json .}}', containerId,
      ]);
      return parseContainerInspect(stdout.trim());
    } catch {
      return null;
    }
  }

  async getResourceUsage(containerId: string): Promise<ContainerResourceUsage | null> {
    try {
      const { stdout } = await this.commandRunner.exec('docker', [
        'stats', '--no-stream', '--format',
        '{{.CPUPerc}}\t{{.MemUsage}}',
        containerId,
      ]);
      return parseResourceUsage(stdout.trim());
    } catch {
      return null;
    }
  }

  async isContainerRunning(containerId: string): Promise<boolean> {
    try {
      const { stdout } = await this.commandRunner.exec('docker', [
        'inspect', '--format', '{{.State.Running}}', containerId,
      ]);
      return stdout.trim() === 'true';
    } catch {
      return false;
    }
  }

  async listContainers(): Promise<ContainerInfo[]> {
    try {
      const { stdout } = await this.commandRunner.exec('docker', [
        'ps', '-a', '--filter', `label=${CONTAINER_LABEL}`,
        '--format', '{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Image}}\t{{.CreatedAt}}',
      ]);
      return parseContainerList(stdout.trim());
    } catch {
      return [];
    }
  }

  async copyToContainer(containerId: string, hostPath: string, containerPath: string): Promise<void> {
    // docker cp uses native host paths (NOT Docker mount format like /c/Users/...)
    await this.commandRunner.exec('docker', ['cp', hostPath, `${containerId}:${containerPath}`]);
  }

  async execInContainer(containerId: string, command: string[], options?: ExecOptions): Promise<{ stdout: string; stderr: string }> {
    const args = ['exec'];

    if (options?.user) {
      args.push('-u', options.user);
    }

    args.push(containerId, ...command);
    return this.commandRunner.exec('docker', args);
  }

  private buildCreateArgs(options: CreateContainerOptions): string[] {
    const containerName = generateContainerName(options.projectId);
    const dockerProjectPath = translateToDockerPath(options.projectPath);

    const args = ['create', '--name', containerName, '--label', CONTAINER_LABEL];

    // Project label for identification
    args.push('--label', `claudito-project=${options.projectId}`);

    // Resource limits
    args.push('--cpus', String(options.resourceLimits.cpus));
    args.push('--memory', `${options.resourceLimits.memoryMb}m`);

    // Network
    if (options.networkMode !== 'bridge') {
      args.push('--network', options.networkMode);
    }

    // Bind mount project directory
    args.push('-v', `${dockerProjectPath}:/workspace`);

    // Read-only mounts for git/ssh config
    if (options.gitConfigPath) {
      args.push('-v', `${translateToDockerPath(options.gitConfigPath)}:/home/claudito/.gitconfig:ro`);
    }

    if (options.sshKeyPath) {
      args.push('-v', `${translateToDockerPath(options.sshKeyPath)}:/home/claudito/.ssh:ro`);
    }

    // Environment variables
    for (const [key, value] of Object.entries(options.env)) {
      args.push('-e', `${key}=${value}`);
    }

    // Keep container running with a sleep process
    args.push(options.imageName, 'sleep', 'infinity');

    return args;
  }

  private parseAvailabilityError(err: unknown): DockerAvailability {
    const message = extractErrorMessage(err);
    const isNotInstalled = message.includes('not found') || message.includes('not recognized');

    if (isNotInstalled) {
      return { installed: false, version: null, running: false, error: 'Docker is not installed' };
    }

    return { installed: true, version: null, running: false, error: message };
  }
}

// ============================================================================
// Parsing Helpers
// ============================================================================

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

interface DockerInspectData {
  Id: string;
  Created: string;
  Config: {
    Labels: Record<string, string>;
    Image: string;
  };
  State: {
    Status: string;
  };
}

function parseContainerInspect(json: string): ContainerInfo | null {
  try {
    const data = JSON.parse(json) as DockerInspectData;
    const labels = data.Config?.Labels ?? {};
    const state = data.State ?? {};

    return {
      containerId: data.Id?.substring(0, 12) ?? '',
      projectId: labels['claudito-project'] ?? '',
      status: mapDockerState(state.Status),
      imageName: data.Config?.Image ?? '',
      createdAt: data.Created ?? '',
      resourceUsage: null,
    };
  } catch {
    return null;
  }
}

function mapDockerState(state: string): ContainerInfo['status'] {
  switch (state) {
    case 'running': return 'running';
    case 'created': return 'created';
    case 'exited':
    case 'dead':
      return 'stopped';
    default: return 'error';
  }
}

function parseResourceUsage(line: string): ContainerResourceUsage | null {
  if (!line) return null;

  const parts = line.split('\t');
  if (parts.length < 2) return null;

  const cpuPercent = parseFloat(parts[0]!.replace('%', '')) || 0;
  const memParts = (parts[1] || '').split('/');
  const memoryUsageMb = parseMbValue(memParts[0]?.trim() || '');
  const memoryLimitMb = parseMbValue(memParts[1]?.trim() || '');

  return { cpuPercent, memoryUsageMb, memoryLimitMb };
}

function parseMbValue(value: string): number {
  const num = parseFloat(value);
  if (isNaN(num)) return 0;

  if (value.includes('GiB')) return num * 1024;
  if (value.includes('MiB')) return num;
  if (value.includes('KiB')) return num / 1024;
  return num;
}

function parseContainerList(output: string): ContainerInfo[] {
  if (!output) return [];

  return output.split('\n').filter(Boolean).map(parseContainerLine).filter(Boolean) as ContainerInfo[];
}

function parseContainerLine(line: string): ContainerInfo | null {
  const parts = line.split('\t');
  if (parts.length < 5) return null;

  const statusText = parts[2] || '';
  const status = statusText.startsWith('Up') ? 'running' as const
    : statusText.startsWith('Created') ? 'created' as const
    : 'stopped' as const;

  return {
    containerId: parts[0] || '',
    projectId: '',
    status,
    imageName: parts[3] || '',
    createdAt: parts[4] || '',
    resourceUsage: null,
  };
}
