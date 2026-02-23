import fs from 'fs';
import path from 'path';

export interface MilestoneItemRef {
  phaseId: string;
  milestoneId: string;
  itemIndex: number;
  taskTitle: string;
}

export interface ContextUsageData {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  maxContextTokens: number;
  percentUsed: number;
}

export interface ProjectPermissionOverrides {
  enabled: boolean;
  allowRules?: string[];
  denyRules?: string[];
  defaultMode?: 'acceptEdits' | 'plan';
}

export interface McpOverrides {
  enabled: boolean;
  serverOverrides: {
    [serverId: string]: {
      enabled: boolean;
    };
  };
}

export type SlackNotificationEvent =
  | 'agent_completed'
  | 'agent_failed'
  | 'agent_waiting'
  | 'ralph_loop_complete'
  | 'ralph_loop_error'
  | 'milestone_completed'
  | 'milestone_failed';

export interface SlackNotificationConfig {
  channelId: string;
  events: SlackNotificationEvent[];
  mentionUsers: string[];
  threadReplies: boolean;
}

export interface ProjectStatus {
  id: string;
  name: string;
  path: string;
  status: 'stopped' | 'running' | 'error' | 'queued';
  currentConversationId: string | null;
  nextItem: MilestoneItemRef | null;
  currentItem: MilestoneItemRef | null;
  lastContextUsage: ContextUsageData | null;
  permissionOverrides: ProjectPermissionOverrides | null;
  /** Project-specific model override (null = use global default) */
  modelOverride: string | null;
  /** Project-specific MCP server overrides */
  mcpOverrides: McpOverrides | null;
  /** Run configurations for this project */
  runConfigurations?: RunConfiguration[];
  /** Per-project Docker override: true=force Docker, false=force host, undefined=use global */
  dockerOverride?: boolean;
  /** Per-project Docker image override (null/undefined = use global baseImage) */
  dockerImage?: string | null;
  /** Per-project Slack notification configuration */
  slackNotification?: SlackNotificationConfig | null;
  /** Slack channel linked to this project for feed updates */
  slackLinkedChannelId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunConfiguration {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  shell: string | null;
  autoRestart: boolean;
  autoRestartDelay: number;
  autoRestartMaxRetries: number;
  preLaunchConfigId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectIndexEntry {
  id: string;
  name: string;
}

export interface CreateProjectData {
  name: string;
  path: string;
}

export interface ProjectRepository {
  findAll(): Promise<ProjectStatus[]>;
  findById(id: string): Promise<ProjectStatus | null>;
  findByPath(projectPath: string): Promise<ProjectStatus | null>;
  create(data: CreateProjectData): Promise<ProjectStatus>;
  updateStatus(id: string, status: ProjectStatus['status']): Promise<ProjectStatus | null>;
  updateNextItem(id: string, nextItem: MilestoneItemRef | null): Promise<ProjectStatus | null>;
  updateCurrentItem(id: string, currentItem: MilestoneItemRef | null): Promise<ProjectStatus | null>;
  setCurrentConversation(id: string, conversationId: string | null): Promise<ProjectStatus | null>;
  updateContextUsage(id: string, contextUsage: ContextUsageData | null): Promise<ProjectStatus | null>;
  updatePermissionOverrides(id: string, overrides: ProjectPermissionOverrides | null): Promise<ProjectStatus | null>;
  updateModelOverride(id: string, model: string | null): Promise<ProjectStatus | null>;
  updateMcpOverrides(id: string, overrides: McpOverrides | null): Promise<ProjectStatus | null>;
  updateRunConfigurations(id: string, configs: RunConfiguration[]): Promise<ProjectStatus | null>;
  updateDockerOverride(id: string, dockerOverride: boolean | undefined): Promise<ProjectStatus | null>;
  updateDockerImage(id: string, dockerImage: string | null): Promise<ProjectStatus | null>;
  updateSlackNotification(id: string, config: SlackNotificationConfig | null): Promise<ProjectStatus | null>;
  updateSlackLinkedChannel(id: string, channelId: string | null): Promise<ProjectStatus | null>;
  updateProjectPath(id: string, newName: string, newPath: string): Promise<ProjectStatus | null>;
  delete(id: string): Promise<boolean>;
}

export interface FileSystem {
  readFileSync(filePath: string, encoding: BufferEncoding): string;
  writeFileSync(filePath: string, data: string): void;
  existsSync(filePath: string): boolean;
  mkdirSync(dirPath: string, options: { recursive: boolean }): void;
  rmdirSync(dirPath: string, options: { recursive: boolean }): void;
  renameSync(oldPath: string, newPath: string): void;
}

const defaultFileSystem: FileSystem = {
  readFileSync: (filePath, encoding) => fs.readFileSync(filePath, encoding),
  writeFileSync: (filePath, data) => fs.writeFileSync(filePath, data),
  existsSync: (filePath) => fs.existsSync(filePath),
  mkdirSync: (dirPath, options) => fs.mkdirSync(dirPath, options),
  rmdirSync: (dirPath, options) => fs.rmSync(dirPath, options),
  renameSync: (oldPath, newPath) => fs.renameSync(oldPath, newPath),
};

export function generateIdFromPath(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, '_');
}

// Extended index entry that includes project path for locating .claudito folder
export interface ProjectIndexEntryWithPath extends ProjectIndexEntry {
  path: string;
}

export class FileProjectRepository implements ProjectRepository {
  private readonly projectsDir: string;
  private readonly indexPath: string;
  private readonly fileSystem: FileSystem;
  private index: Map<string, ProjectIndexEntryWithPath> = new Map();
  private statusCache: Map<string, ProjectStatus> = new Map();

  constructor(dataDir: string, fileSystem: FileSystem = defaultFileSystem) {
    this.fileSystem = fileSystem;
    this.projectsDir = path.join(dataDir, 'projects');
    this.indexPath = path.join(this.projectsDir, 'index.json');
    this.ensureProjectsDir();
    this.loadIndex();
  }

  // Get the project path for a given project ID (used by other repositories)
  getProjectPath(id: string): string | null {
    const entry = this.index.get(id);
    return entry?.path || null;
  }

  private ensureProjectsDir(): void {
    if (!this.fileSystem.existsSync(this.projectsDir)) {
      this.fileSystem.mkdirSync(this.projectsDir, { recursive: true });
    }
  }

  private loadIndex(): void {
    if (!this.fileSystem.existsSync(this.indexPath)) {
      return;
    }

    try {
      const data = this.fileSystem.readFileSync(this.indexPath, 'utf-8');
      const entries = JSON.parse(data) as ProjectIndexEntryWithPath[];
      entries.forEach((entry) => this.index.set(entry.id, entry));
    } catch {
      // File corrupted or invalid, start fresh
    }
  }

  private saveIndex(): void {
    const entries = Array.from(this.index.values());
    const data = JSON.stringify(entries, null, 2);
    this.fileSystem.writeFileSync(this.indexPath, data);
  }

  // Project data is now stored in {project-root}/.claudito/
  private getProjectDataDir(projectPath: string): string {
    return path.join(projectPath, '.claudito');
  }

  private getStatusPath(projectPath: string): string {
    return path.join(this.getProjectDataDir(projectPath), 'status.json');
  }

  private loadStatus(id: string): ProjectStatus | null {
    if (this.statusCache.has(id)) {
      return { ...this.statusCache.get(id)! };
    }

    const entry = this.index.get(id);

    if (!entry) {
      return null;
    }

    // Handle backward compatibility: old entries may not have path
    if (!entry.path) {
      // Try to load from old location and migrate
      const oldStatusPath = path.join(this.projectsDir, id, 'status.json');

      if (this.fileSystem.existsSync(oldStatusPath)) {
        try {
          const data = this.fileSystem.readFileSync(oldStatusPath, 'utf-8');
          const status = JSON.parse(data) as ProjectStatus;

          // Update index with path from status
          entry.path = status.path;
          this.saveIndex();

          // Migrate data to new location
          this.migrateProjectData(id, status.path);

          this.statusCache.set(id, status);
          return { ...status };
        } catch {
          return null;
        }
      }

      return null;
    }

    const statusPath = this.getStatusPath(entry.path);

    if (!this.fileSystem.existsSync(statusPath)) {
      return null;
    }

    try {
      const data = this.fileSystem.readFileSync(statusPath, 'utf-8');
      const status = JSON.parse(data) as ProjectStatus;
      this.statusCache.set(id, status);
      return { ...status };
    } catch {
      return null;
    }
  }

  private migrateProjectData(id: string, projectPath: string): void {
    const oldDir = path.join(this.projectsDir, id);
    const newDir = this.getProjectDataDir(projectPath);

    if (!this.fileSystem.existsSync(oldDir)) {
      return;
    }

    // Create new directory
    if (!this.fileSystem.existsSync(newDir)) {
      this.fileSystem.mkdirSync(newDir, { recursive: true });
    }

    // Copy status.json
    const oldStatusPath = path.join(oldDir, 'status.json');

    if (this.fileSystem.existsSync(oldStatusPath)) {
      const statusData = this.fileSystem.readFileSync(oldStatusPath, 'utf-8');
      this.fileSystem.writeFileSync(path.join(newDir, 'status.json'), statusData);
    }

    // Copy conversations directory if it exists
    const oldConvDir = path.join(oldDir, 'conversations');
    const newConvDir = path.join(newDir, 'conversations');

    if (this.fileSystem.existsSync(oldConvDir)) {
      this.copyDirectory(oldConvDir, newConvDir);
    }

    // Remove old directory after successful migration
    try {
      this.fileSystem.rmdirSync(oldDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  private copyDirectory(src: string, dest: string): void {
    if (!this.fileSystem.existsSync(dest)) {
      this.fileSystem.mkdirSync(dest, { recursive: true });
    }

    // Read directory contents using fs directly (sync)
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this.copyDirectory(srcPath, destPath);
      } else {
        const content = this.fileSystem.readFileSync(srcPath, 'utf-8');
        this.fileSystem.writeFileSync(destPath, content);
      }
    }
  }

  private saveStatus(status: ProjectStatus): void {
    const dataDir = this.getProjectDataDir(status.path);

    if (!this.fileSystem.existsSync(dataDir)) {
      this.fileSystem.mkdirSync(dataDir, { recursive: true });
    }

    status.updatedAt = new Date().toISOString();
    this.statusCache.set(status.id, status);
    const statusPath = this.getStatusPath(status.path);
    const data = JSON.stringify(status, null, 2);
    // Atomic write: write to temp file, then rename
    const tempPath = `${statusPath}.tmp`;
    this.fileSystem.writeFileSync(tempPath, data);
    this.fileSystem.renameSync(tempPath, statusPath);
  }

  findAll(): Promise<ProjectStatus[]> {
    const projects: ProjectStatus[] = [];

    for (const entry of this.index.values()) {
      const status = this.loadStatus(entry.id);

      if (status) {
        projects.push(status);
      }
    }

    return Promise.resolve(projects);
  }

  findById(id: string): Promise<ProjectStatus | null> {
    if (!this.index.has(id)) {
      return Promise.resolve(null);
    }

    return Promise.resolve(this.loadStatus(id));
  }

  async findByPath(projectPath: string): Promise<ProjectStatus | null> {
    const id = generateIdFromPath(projectPath);
    return this.findById(id);
  }

  async create(data: CreateProjectData): Promise<ProjectStatus> {
    const id = generateIdFromPath(data.path);

    const existingProject = await this.findById(id);

    if (existingProject) {
      throw new Error('Project with this path already exists');
    }

    const now = new Date().toISOString();
    const status: ProjectStatus = {
      id,
      name: data.name,
      path: data.path,
      status: 'stopped',
      currentConversationId: null,
      nextItem: null,
      currentItem: null,
      lastContextUsage: null,
      permissionOverrides: null,
      modelOverride: null,
      mcpOverrides: null,
      createdAt: now,
      updatedAt: now,
    };

    // Store path in index so we can locate the .claudito folder
    const indexEntry: ProjectIndexEntryWithPath = { id, name: data.name, path: data.path };
    this.index.set(id, indexEntry);
    this.saveIndex();
    this.saveStatus(status);

    return status;
  }

  updateStatus(id: string, newStatus: ProjectStatus['status']): Promise<ProjectStatus | null> {
    const status = this.loadStatus(id);

    if (!status) {
      return Promise.resolve(null);
    }

    status.status = newStatus;
    this.saveStatus(status);
    return Promise.resolve({ ...status });
  }

  updateNextItem(id: string, nextItem: MilestoneItemRef | null): Promise<ProjectStatus | null> {
    const status = this.loadStatus(id);

    if (!status) {
      return Promise.resolve(null);
    }

    status.nextItem = nextItem;
    this.saveStatus(status);
    return Promise.resolve({ ...status });
  }

  updateCurrentItem(id: string, currentItem: MilestoneItemRef | null): Promise<ProjectStatus | null> {
    const status = this.loadStatus(id);

    if (!status) {
      return Promise.resolve(null);
    }

    status.currentItem = currentItem;
    this.saveStatus(status);
    return Promise.resolve({ ...status });
  }

  setCurrentConversation(id: string, conversationId: string | null): Promise<ProjectStatus | null> {
    const status = this.loadStatus(id);

    if (!status) {
      return Promise.resolve(null);
    }

    status.currentConversationId = conversationId;
    this.saveStatus(status);
    return Promise.resolve({ ...status });
  }

  updateContextUsage(id: string, contextUsage: ContextUsageData | null): Promise<ProjectStatus | null> {
    const status = this.loadStatus(id);

    if (!status) {
      return Promise.resolve(null);
    }

    status.lastContextUsage = contextUsage;
    this.saveStatus(status);
    return Promise.resolve({ ...status });
  }

  updatePermissionOverrides(id: string, overrides: ProjectPermissionOverrides | null): Promise<ProjectStatus | null> {
    const status = this.loadStatus(id);

    if (!status) {
      return Promise.resolve(null);
    }

    status.permissionOverrides = overrides;
    this.saveStatus(status);
    return Promise.resolve({ ...status });
  }

  updateModelOverride(id: string, model: string | null): Promise<ProjectStatus | null> {
    const status = this.loadStatus(id);

    if (!status) {
      return Promise.resolve(null);
    }

    status.modelOverride = model;
    this.saveStatus(status);
    return Promise.resolve({ ...status });
  }

  updateMcpOverrides(id: string, overrides: McpOverrides | null): Promise<ProjectStatus | null> {
    const status = this.loadStatus(id);

    if (!status) {
      return Promise.resolve(null);
    }

    status.mcpOverrides = overrides;
    this.saveStatus(status);
    return Promise.resolve({ ...status });
  }

  updateRunConfigurations(id: string, configs: RunConfiguration[]): Promise<ProjectStatus | null> {
    const status = this.loadStatus(id);

    if (!status) {
      return Promise.resolve(null);
    }

    status.runConfigurations = configs;
    this.saveStatus(status);
    return Promise.resolve({ ...status });
  }

  updateDockerOverride(id: string, dockerOverride: boolean | undefined): Promise<ProjectStatus | null> {
    const status = this.loadStatus(id);

    if (!status) {
      return Promise.resolve(null);
    }

    status.dockerOverride = dockerOverride;
    this.saveStatus(status);
    return Promise.resolve({ ...status });
  }

  updateDockerImage(id: string, dockerImage: string | null): Promise<ProjectStatus | null> {
    const status = this.loadStatus(id);

    if (!status) {
      return Promise.resolve(null);
    }

    status.dockerImage = dockerImage;
    this.saveStatus(status);
    return Promise.resolve({ ...status });
  }

  updateSlackNotification(id: string, config: SlackNotificationConfig | null): Promise<ProjectStatus | null> {
    const status = this.loadStatus(id);

    if (!status) {
      return Promise.resolve(null);
    }

    status.slackNotification = config;
    this.saveStatus(status);
    return Promise.resolve({ ...status });
  }

  updateSlackLinkedChannel(id: string, channelId: string | null): Promise<ProjectStatus | null> {
    const status = this.loadStatus(id);

    if (!status) {
      return Promise.resolve(null);
    }

    status.slackLinkedChannelId = channelId;
    this.saveStatus(status);
    return Promise.resolve({ ...status });
  }

  updateProjectPath(
    id: string,
    newName: string,
    newPath: string,
  ): Promise<ProjectStatus | null> {
    const status = this.loadStatus(id);

    if (!status) return Promise.resolve(null);

    const newId = generateIdFromPath(newPath);

    this.index.delete(id);
    this.statusCache.delete(id);

    status.id = newId;
    status.name = newName;
    status.path = newPath;

    const indexEntry: ProjectIndexEntryWithPath = {
      id: newId,
      name: newName,
      path: newPath,
    };

    this.index.set(newId, indexEntry);
    this.saveIndex();
    this.saveStatus(status);

    return Promise.resolve({ ...status });
  }

  delete(id: string): Promise<boolean> {
    const entry = this.index.get(id);

    if (!entry) {
      return Promise.resolve(false);
    }

    this.index.delete(id);
    this.saveIndex();
    this.statusCache.delete(id);

    // Delete the .claudito folder in the project root
    const dataDir = this.getProjectDataDir(entry.path);

    if (this.fileSystem.existsSync(dataDir)) {
      this.fileSystem.rmdirSync(dataDir, { recursive: true });
    }

    return Promise.resolve(true);
  }
}

// Legacy alias for backward compatibility in type references
export type Project = ProjectStatus;
