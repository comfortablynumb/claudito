/**
 * Docker Types
 * Interfaces for Docker container management and sandboxed agent execution
 */

import { ChildProcess } from 'child_process';

// ============================================================================
// Settings
// ============================================================================

export interface DockerSettings {
  enabled: boolean;
  baseImage: string;
  resourceLimits: DockerResourceLimits;
  networkMode: DockerNetworkMode;
}

export interface DockerResourceLimits {
  cpus: number;
  memoryMb: number;
}

export type DockerNetworkMode = 'bridge' | 'none';

// ============================================================================
// Availability
// ============================================================================

export interface DockerAvailability {
  installed: boolean;
  version: string | null;
  running: boolean;
  error: string | null;
}

// ============================================================================
// Container Info
// ============================================================================

export type ContainerStatus = 'created' | 'running' | 'stopped' | 'error';

export interface ContainerInfo {
  containerId: string;
  projectId: string;
  status: ContainerStatus;
  imageName: string;
  createdAt: string;
  resourceUsage: ContainerResourceUsage | null;
}

export interface ContainerResourceUsage {
  cpuPercent: number;
  memoryUsageMb: number;
  memoryLimitMb: number;
}

// ============================================================================
// Image Management
// ============================================================================

export interface DockerImage {
  id: string;
  name: string;
  tag: string;
  size: string;
  createdAt: string;
}

export interface ImageVariant {
  name: string;
  displayName: string;
  description: string;
  dockerfilePath: string;
}

// ============================================================================
// Operation Options
// ============================================================================

export interface ExecOptions {
  user?: string;
}

export interface BuildImageOptions {
  dockerfilePath: string;
  imageName: string;
  context?: string;
}

export interface DockerBuildProgressData {
  variantName: string;
  imageName: string;
  line: string;
  phase: 'building' | 'done' | 'error';
}

export interface CreateContainerOptions {
  projectId: string;
  imageName: string;
  projectPath: string;
  env: Record<string, string>;
  resourceLimits: DockerResourceLimits;
  networkMode: DockerNetworkMode;
  sshKeyPath?: string;
  gitConfigPath?: string;
}

// ============================================================================
// Docker Command Runner (for testability)
// ============================================================================

export interface DockerCommandRunner {
  exec(command: string, args: string[]): Promise<{ stdout: string; stderr: string }>;
  spawn(command: string, args: string[]): ChildProcess;
}

// ============================================================================
// Service Interfaces
// ============================================================================

export interface DockerService {
  checkAvailability(): Promise<DockerAvailability>;
  buildImage(options: BuildImageOptions): Promise<void>;
  createContainer(options: CreateContainerOptions): Promise<string>;
  startContainer(containerId: string): Promise<void>;
  stopContainer(containerId: string): Promise<void>;
  removeContainer(containerId: string): Promise<void>;
  getContainerStatus(containerId: string): Promise<ContainerInfo | null>;
  getResourceUsage(containerId: string): Promise<ContainerResourceUsage | null>;
  isContainerRunning(containerId: string): Promise<boolean>;
  listContainers(): Promise<ContainerInfo[]>;
  copyToContainer(containerId: string, hostPath: string, containerPath: string): Promise<void>;
  execInContainer(containerId: string, command: string[], options?: ExecOptions): Promise<{ stdout: string; stderr: string }>;
}

export interface EnsureContainerResult {
  containerId: string;
  imageName: string;
  wasCreated: boolean;
  wasRestarted: boolean;
}

export interface ContainerManager {
  ensureContainer(projectId: string, projectPath: string, imageName?: string): Promise<EnsureContainerResult>;
  stopProjectContainer(projectId: string): Promise<void>;
  stopAllContainers(): Promise<void>;
  getContainerForProject(projectId: string): string | null;
  getProjectContainers(): Promise<ContainerInfo[]>;
  isHealthy(projectId: string): Promise<boolean>;
}

export interface ImageManager {
  listImages(): Promise<DockerImage[]>;
  buildImage(options: BuildImageOptions): Promise<void>;
  buildImageStreaming(
    options: BuildImageOptions,
    onOutput: (line: string) => void,
  ): Promise<void>;
  removeImage(imageName: string): Promise<void>;
  getAvailableVariants(): ImageVariant[];
}
