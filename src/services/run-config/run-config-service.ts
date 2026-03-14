/**
 * Run Configuration Service
 * CRUD operations and validation for project run configurations
 */

import { randomUUID } from 'crypto';
import { ProjectRepository } from '../../repositories/project';
import {
  RunConfiguration,
  RunConfigurationService,
  CreateRunConfigData,
  UpdateRunConfigData,
} from './types';

export interface RunConfigServiceDependencies {
  projectRepository: ProjectRepository;
}

export class DefaultRunConfigurationService implements RunConfigurationService {
  private readonly projectRepository: ProjectRepository;

  constructor(deps: RunConfigServiceDependencies) {
    this.projectRepository = deps.projectRepository;
  }

  async list(projectId: string): Promise<RunConfiguration[]> {
    const project = await this.projectRepository.findById(projectId);

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    return project.runConfigurations || [];
  }

  async getById(projectId: string, configId: string): Promise<RunConfiguration | null> {
    const configs = await this.list(projectId);
    return configs.find((c) => c.id === configId) || null;
  }

  async create(projectId: string, data: CreateRunConfigData): Promise<RunConfiguration> {
    const project = await this.projectRepository.findById(projectId);

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const configs = project.runConfigurations || [];

    this.validateUniqueName(configs, data.name);
    this.validateCommand(data.command);
    this.validateCwd(data.cwd);

    if (data.preLaunchConfigId) {
      this.validatePreLaunchExists(configs, data.preLaunchConfigId);
    }

    const now = new Date().toISOString();
    const config: RunConfiguration = {
      id: randomUUID(),
      name: data.name.trim(),
      command: data.command.trim(),
      args: data.args || [],
      cwd: data.cwd || '.',
      env: data.env || {},
      shell: data.shell ?? null,
      autoRestart: data.autoRestart ?? false,
      autoRestartDelay: data.autoRestartDelay ?? 1000,
      autoRestartMaxRetries: data.autoRestartMaxRetries ?? 5,
      preLaunchConfigId: data.preLaunchConfigId ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const updated = [...configs, config];
    await this.projectRepository.updateRunConfigurations(projectId, updated);

    return config;
  }

  async update(
    projectId: string,
    configId: string,
    data: UpdateRunConfigData,
  ): Promise<RunConfiguration | null> {
    const project = await this.projectRepository.findById(projectId);

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const configs = project.runConfigurations || [];
    const index = configs.findIndex((c) => c.id === configId);

    if (index === -1) {
      return null;
    }

    this.validateUpdateData(configs, configId, data);

    const existing = configs[index]!;
    const updated: RunConfiguration = mergeConfigFields(existing, data);

    const newConfigs = [...configs];
    newConfigs[index] = updated;
    await this.projectRepository.updateRunConfigurations(projectId, newConfigs);

    return updated;
  }

  async delete(projectId: string, configId: string): Promise<boolean> {
    const project = await this.projectRepository.findById(projectId);

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const configs = project.runConfigurations || [];
    const exists = configs.some((c) => c.id === configId);

    if (!exists) {
      return false;
    }

    // Prevent deletion if referenced as pre-launch by another config
    const referencedBy = configs.find(
      (c) => c.preLaunchConfigId === configId && c.id !== configId,
    );

    if (referencedBy) {
      throw new Error(
        `Cannot delete: config "${referencedBy.name}" references this as a pre-launch dependency`,
      );
    }

    const filtered = configs.filter((c) => c.id !== configId);
    await this.projectRepository.updateRunConfigurations(projectId, filtered);

    return true;
  }

  private validateUpdateData(
    configs: RunConfiguration[],
    configId: string,
    data: UpdateRunConfigData,
  ): void {
    if (data.name !== undefined) {
      this.validateUniqueName(configs, data.name, configId);
    }

    if (data.command !== undefined) {
      this.validateCommand(data.command);
    }

    if (data.cwd !== undefined) {
      this.validateCwd(data.cwd);
    }

    if (data.preLaunchConfigId !== undefined && data.preLaunchConfigId !== null) {
      this.validatePreLaunchExists(configs, data.preLaunchConfigId);
      this.detectCycle(configs, configId, data.preLaunchConfigId);
    }
  }

  private validateUniqueName(
    configs: RunConfiguration[],
    name: string,
    excludeId?: string,
  ): void {
    const trimmed = name.trim().toLowerCase();

    if (!trimmed) {
      throw new Error('Name is required');
    }

    const duplicate = configs.find(
      (c) => c.name.toLowerCase() === trimmed && c.id !== excludeId,
    );

    if (duplicate) {
      throw new Error(`A run configuration with name "${name.trim()}" already exists`);
    }
  }

  private validateCommand(command: string): void {
    if (!command.trim()) {
      throw new Error('Command is required');
    }
  }

  private validateCwd(cwd: string | undefined): void {
    if (cwd === undefined) return;

    // Disallow absolute paths and parent directory traversal
    if (cwd.startsWith('/') || cwd.startsWith('\\') || /^[A-Za-z]:/.test(cwd)) {
      throw new Error('Working directory must be relative to the project root');
    }

    if (cwd.includes('..')) {
      throw new Error('Working directory must not escape the project root');
    }
  }

  private validatePreLaunchExists(
    configs: RunConfiguration[],
    preLaunchId: string,
  ): void {
    const exists = configs.some((c) => c.id === preLaunchId);

    if (!exists) {
      throw new Error(`Pre-launch config not found: ${preLaunchId}`);
    }
  }

  /**
   * Detect circular pre-launch chains using linked-list walk.
   * Walks from preLaunchId through the chain and checks if it leads back to configId.
   */
  private detectCycle(
    configs: RunConfiguration[],
    configId: string,
    preLaunchId: string,
  ): void {
    const visited = new Set<string>();
    visited.add(configId);
    let currentId: string | null = preLaunchId;

    while (currentId) {
      if (visited.has(currentId)) {
        throw new Error('Circular pre-launch dependency detected');
      }

      visited.add(currentId);
      const config = configs.find((c) => c.id === currentId);
      currentId = config?.preLaunchConfigId || null;
    }
  }
}

function mergeConfigFields(existing: RunConfiguration, data: UpdateRunConfigData): RunConfiguration {
  return {
    ...existing,
    name: data.name !== undefined ? data.name.trim() : existing.name,
    command: data.command !== undefined ? data.command.trim() : existing.command,
    args: data.args !== undefined ? data.args : existing.args,
    cwd: data.cwd !== undefined ? data.cwd : existing.cwd,
    env: data.env !== undefined ? data.env : existing.env,
    shell: data.shell !== undefined ? data.shell : existing.shell,
    autoRestart: data.autoRestart !== undefined ? data.autoRestart : existing.autoRestart,
    autoRestartDelay: data.autoRestartDelay !== undefined ? data.autoRestartDelay : existing.autoRestartDelay,
    autoRestartMaxRetries: data.autoRestartMaxRetries !== undefined ? data.autoRestartMaxRetries : existing.autoRestartMaxRetries,
    preLaunchConfigId: data.preLaunchConfigId !== undefined ? data.preLaunchConfigId : existing.preLaunchConfigId,
    updatedAt: new Date().toISOString(),
  };
}
