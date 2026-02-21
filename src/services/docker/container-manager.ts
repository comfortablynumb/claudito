/**
 * Container Manager
 * High-level orchestrator for per-project Docker container lifecycle.
 * Ensures one long-running container per project, reused across agent sessions.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { getLogger, Logger } from '../../utils';
import { SettingsRepository } from '../../repositories/settings';
import { generateContainerName } from './docker-service';
import {
  ContainerManager,
  DockerService,
  ContainerInfo,
  CreateContainerOptions,
  DockerSettings,
  EnsureContainerResult,
} from './types';

export interface FileSystemChecker {
  directoryExists(dirPath: string): boolean;
  fileExists(filePath: string): boolean;
  listEntries(dirPath: string): string[];
}

export class DefaultFileSystemChecker implements FileSystemChecker {
  directoryExists(dirPath: string): boolean {
    try {
      return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
    } catch {
      return false;
    }
  }

  fileExists(filePath: string): boolean {
    try {
      return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  }

  listEntries(dirPath: string): string[] {
    try {
      return fs.readdirSync(dirPath);
    } catch {
      return [];
    }
  }
}

interface ContainerManagerDependencies {
  dockerService: DockerService;
  settingsRepository: SettingsRepository;
  fileSystemChecker?: FileSystemChecker;
  logger?: Logger;
}

export class DefaultContainerManager implements ContainerManager {
  private readonly dockerService: DockerService;
  private readonly settingsRepository: SettingsRepository;
  private readonly fileSystemChecker: FileSystemChecker;
  private readonly logger: Logger;
  private readonly containers: Map<string, { containerId: string; imageName: string }> = new Map();

  constructor(deps: ContainerManagerDependencies) {
    this.dockerService = deps.dockerService;
    this.settingsRepository = deps.settingsRepository;
    this.fileSystemChecker = deps.fileSystemChecker || new DefaultFileSystemChecker();
    this.logger = deps.logger || getLogger('container-manager');
  }

  async ensureContainer(projectId: string, projectPath: string, imageName?: string): Promise<EnsureContainerResult> {
    // Check if we already track this container
    const existing = this.containers.get(projectId);

    if (existing && await this.dockerService.isContainerRunning(existing.containerId)) {
      return { containerId: existing.containerId, imageName: existing.imageName, wasCreated: false, wasRestarted: false };
    }

    // Check if container exists but is stopped (e.g., after Claudito restart)
    if (existing) {
      try {
        return await this.startExistingContainer(projectId, existing.containerId, existing.imageName);
      } catch (err) {
        // Container was likely removed externally — clean up stale tracking and fall through
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Stale tracked container ${existing.containerId} could not be started: ${message}`);
        this.containers.delete(projectId);
      }
    }

    // Check for pre-existing container by name convention
    const containerName = generateContainerName(projectId);
    const found = await this.findExistingContainer(containerName);

    if (found) {
      try {
        return await this.handleFoundContainer(projectId, found);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Found container ${found.containerId} could not be reattached: ${message}`);
      }
    }

    // Create a brand new container
    return this.createNewContainer(projectId, projectPath, imageName);
  }

  async stopProjectContainer(projectId: string): Promise<void> {
    const entry = this.containers.get(projectId);
    if (!entry) return;

    await this.dockerService.stopContainer(entry.containerId);
    this.containers.delete(projectId);
    this.logger.info(`Stopped container for project ${projectId}`);
  }

  async stopAllContainers(): Promise<void> {
    const entries = Array.from(this.containers.entries());

    for (const [projectId, entry] of entries) {
      await this.dockerService.stopContainer(entry.containerId);
      this.logger.info(`Stopped container for project ${projectId}`);
    }

    this.containers.clear();
  }

  getContainerForProject(projectId: string): string | null {
    return this.containers.get(projectId)?.containerId || null;
  }

  async getProjectContainers(): Promise<ContainerInfo[]> {
    return this.dockerService.listContainers();
  }

  async isHealthy(projectId: string): Promise<boolean> {
    const entry = this.containers.get(projectId);
    if (!entry) return false;

    return this.dockerService.isContainerRunning(entry.containerId);
  }

  private async startExistingContainer(projectId: string, containerId: string, imageName: string): Promise<EnsureContainerResult> {
    await this.dockerService.startContainer(containerId);
    this.logger.info(`Restarted existing container ${containerId} for project ${projectId}`);
    return { containerId, imageName, wasCreated: false, wasRestarted: true };
  }

  private async handleFoundContainer(projectId: string, container: ContainerInfo): Promise<EnsureContainerResult> {
    const containerId = container.containerId;
    const wasRestarted = container.status !== 'running';

    if (wasRestarted) {
      await this.dockerService.startContainer(containerId);
    }

    this.containers.set(projectId, { containerId, imageName: container.imageName });
    this.logger.info(`Reattached to container ${containerId} for project ${projectId}`);
    return { containerId, imageName: container.imageName, wasCreated: false, wasRestarted };
  }

  private async createNewContainer(projectId: string, projectPath: string, imageName?: string): Promise<EnsureContainerResult> {
    const settings = await this.settingsRepository.get();
    const effectiveImage = imageName || settings.docker.baseImage;
    const options = this.buildCreateOptions(projectId, projectPath, settings.docker, effectiveImage);

    const containerId = await this.dockerService.createContainer(options);
    await this.dockerService.startContainer(containerId);
    await this.copyClaudeConfig(containerId);
    this.containers.set(projectId, { containerId, imageName: effectiveImage });

    this.logger.info(`Created and started container ${containerId} for project ${projectId}`);
    return { containerId, imageName: effectiveImage, wasCreated: true, wasRestarted: false };
  }

  private buildCreateOptions(projectId: string, projectPath: string, docker: DockerSettings, effectiveImage?: string): CreateContainerOptions {
    const env: Record<string, string> = {};

    if (process.env.ANTHROPIC_API_KEY) {
      env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    }

    const homeDir = os.homedir();
    const sshKeyPath = path.join(homeDir, '.ssh');
    const gitConfigPath = path.join(homeDir, '.gitconfig');

    return {
      projectId,
      imageName: effectiveImage || docker.baseImage,
      projectPath,
      env,
      resourceLimits: docker.resourceLimits,
      networkMode: docker.networkMode,
      sshKeyPath,
      gitConfigPath,
    };
  }

  private async copyClaudeConfig(containerId: string): Promise<void> {
    const claudeConfigPath = path.join(os.homedir(), '.claude');

    if (!this.fileSystemChecker.directoryExists(claudeConfigPath)) {
      this.logger.debug('No .claude config directory found, skipping copy');
      return;
    }

    try {
      // Create target directory in container
      await this.dockerService.execInContainer(containerId, [
        'mkdir', '-p', '/home/claudito/.claude',
      ], { user: 'root' });

      // Copy each entry except 'projects' and 'debug' (which can be large and aren't needed)
      const entries = this.fileSystemChecker.listEntries(claudeConfigPath);

      for (const entry of entries) {
        if (entry === 'projects' || entry === 'debug') continue;

        const entryPath = path.join(claudeConfigPath, entry);
        await this.dockerService.copyToContainer(containerId, entryPath, '/home/claudito/.claude/');
      }

      // Copy .claude.json file if it exists
      await this.copyClaudeJsonFile(containerId);

      await this.dockerService.execInContainer(containerId, [
        'sh', '-c',
        'chown -R claudito:claudito /home/claudito/.claude; [ -f /home/claudito/.claude.json ] && chown claudito:claudito /home/claudito/.claude.json',
      ], { user: 'root' });
      this.logger.info(`Copied .claude config into container ${containerId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to copy .claude config into container ${containerId}: ${message}`);
    }
  }

  private async copyClaudeJsonFile(containerId: string): Promise<void> {
    const claudeJsonPath = path.join(os.homedir(), '.claude.json');

    if (!this.fileSystemChecker.fileExists(claudeJsonPath)) {
      return;
    }

    await this.dockerService.copyToContainer(containerId, claudeJsonPath, '/home/claudito/');
  }

  private async findExistingContainer(_containerName: string): Promise<ContainerInfo | null> {
    const containers = await this.dockerService.listContainers();

    for (const container of containers) {
      // listContainers returns short IDs; check by name pattern
      const info = await this.dockerService.getContainerStatus(container.containerId);

      if (info) return info;
    }

    return null;
  }
}
