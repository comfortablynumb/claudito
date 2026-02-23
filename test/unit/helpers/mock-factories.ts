import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { FilesystemService, DriveInfo, DirectoryEntry } from '../../../src/routes/filesystem';
import { SettingsRepository, GlobalSettings, SettingsUpdate, ClaudePermissions } from '../../../src/repositories/settings';
import {
  ProjectRepository,
  ProjectStatus,
  MilestoneItemRef,
  ContextUsageData,
  ProjectPermissionOverrides,
  CreateProjectData,
  RunConfiguration,
} from '../../../src/repositories/project';
import {
  ConversationRepository,
  Conversation,
  ConversationMetadata,
  ConversationFileSystem,
  SearchResult,
} from '../../../src/repositories/conversation';
import {
  ProjectPathResolver,
} from '../../../src/repositories/interfaces';
import {
  ClaudeAgent,
  AgentStatus,
  AgentMode,
  AgentMessage,
  ContextUsage,
  AgentEvents,
  ProcessSpawner,
} from '../../../src/agents/claude-agent';
import { AgentFactory, AgentFactoryOptions } from '../../../src/agents/agent-manager';
import {
  InstructionGenerator,
  InstructionGeneratorConfig,
  MilestoneInstructionConfig,
} from '../../../src/services/instruction-generator';
import {
  RoadmapParser,
  ParsedRoadmap,
  RoadmapPhase,
  RoadmapMilestone,
  RoadmapTask,
} from '../../../src/services/roadmap';
import { PermissionGenerator, PermissionArgs } from '../../../src/services/permission-generator';

// ============================================================================
// Default Settings
// ============================================================================

export const DEFAULT_TEST_SETTINGS: GlobalSettings = {
  maxConcurrentAgents: 3,
  claudePermissions: {
    dangerouslySkipPermissions: false,
    allowedTools: [],
    defaultMode: 'acceptEdits',
    allowRules: [],
    denyRules: [],
    askRules: [],
  },
  agentPromptTemplate: 'Default template',
  sendWithCtrlEnter: true,
  historyLimit: 25,
  enableDesktopNotifications: true,
  appendSystemPrompt: '',
  claudeMdMaxSizeKB: 100,
  agentLimits: {
    maxTurns: 0,
  },
  agentStreaming: {
    includePartialMessages: false,
    noSessionPersistence: false,
  },
  promptTemplates: [],
  ralphLoop: {
    defaultMaxTurns: 5,
    defaultWorkerModel: 'claude-opus-4-6',
    defaultReviewerModel: 'claude-sonnet-4-5-20250929',
    defaultWorkerSystemPrompt: 'Worker prompt',
    defaultReviewerSystemPrompt: 'Reviewer prompt',
    historyLimit: 5,
  },
  mcp: {
    enabled: true,
    servers: [],
  },
  slack: {
    enabled: false,
    botToken: '',
    appToken: '',
    defaultChannelId: '',
  },
  chromeEnabled: false,
  inventifyFolder: '',
  docker: {
    enabled: false,
    baseImage: 'claudito-agent:latest',
    resourceLimits: { cpus: 2.0, memoryMb: 4096 },
    networkMode: 'bridge',
  },
};

export const DEFAULT_CLAUDE_PERMISSIONS: ClaudePermissions = {
  dangerouslySkipPermissions: false,
  allowedTools: [],
  defaultMode: 'acceptEdits',
  allowRules: [],
  denyRules: [],
  askRules: [],
};

// ============================================================================
// Sample Test Data
// ============================================================================

export const sampleDrives: DriveInfo[] = [
  { name: 'C:', path: 'C:\\' },
  { name: 'D:', path: 'D:\\' },
];

export const sampleDirectoryEntries: DirectoryEntry[] = [
  { name: 'src', path: '/project/src', isDirectory: true },
  { name: 'test', path: '/project/test', isDirectory: true },
  { name: 'package.json', path: '/project/package.json', isDirectory: false },
  { name: 'README.md', path: '/project/README.md', isDirectory: false },
];

export const sampleFileContent = 'export const hello = "world";';

export const sampleProject: ProjectStatus = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Test Project',
  path: '/path/to/project',
  status: 'stopped',
  currentConversationId: null,
  nextItem: null,
  currentItem: null,
  lastContextUsage: null,
  permissionOverrides: null,
  modelOverride: null,
  mcpOverrides: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

export const sampleConversation: Conversation = {
  id: 'conv-uuid-1234',
  projectId: '123e4567-e89b-12d3-a456-426614174000',
  itemRef: null,
  messages: [],
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

export const sampleAgentMessage: AgentMessage = {
  type: 'stdout',
  content: 'Hello from agent',
  timestamp: '2024-01-01T00:00:00.000Z',
};

export const sampleMilestoneRef: MilestoneItemRef = {
  phaseId: 'phase-1',
  milestoneId: 'milestone-1',
  itemIndex: 0,
  taskTitle: 'Sample Task',
};

export const sampleContextUsage: ContextUsage = {
  inputTokens: 1000,
  outputTokens: 500,
  totalTokens: 1500,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  maxContextTokens: 200000,
  percentUsed: 0.75,
};

export const sampleParsedRoadmap: ParsedRoadmap = {
  phases: [
    {
      id: 'phase-1',
      title: 'Phase 1: Setup',
      milestones: [
        {
          id: 'milestone-1',
          title: 'Initial Setup',
          tasks: [
            { title: 'Task 1', completed: true },
            { title: 'Task 2', completed: false },
          ],
          completedCount: 1,
          totalCount: 2,
        },
      ],
    },
  ],
  currentPhase: 'phase-1',
  currentMilestone: 'milestone-1',
  overallProgress: 50,
};

// ============================================================================
// Filesystem Service Mock
// ============================================================================

export function createMockFilesystemService(): jest.Mocked<FilesystemService> {
  return {
    listDrives: jest.fn(),
    listDirectory: jest.fn(),
    listDirectoryWithFiles: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    createDirectory: jest.fn(),
    deleteFile: jest.fn(),
    deleteDirectory: jest.fn(),
    isTextFile: jest.fn(),
  };
}

// ============================================================================
// Settings Repository Mock
// ============================================================================

export function createMockSettingsRepository(
  initialSettings?: Partial<GlobalSettings>
): jest.Mocked<SettingsRepository> {
  let settings: GlobalSettings = { ...DEFAULT_TEST_SETTINGS, ...initialSettings };

  return {
    get: jest.fn().mockImplementation(() => Promise.resolve({ ...settings })),
    update: jest.fn().mockImplementation((updates: SettingsUpdate) => {
      const { claudePermissions: updatedPermissions, ...otherUpdates } = updates;

      settings = {
        ...settings,
        ...otherUpdates,
      } as GlobalSettings;

      if (updatedPermissions) {
        settings.claudePermissions = {
          ...settings.claudePermissions,
          ...updatedPermissions,
        };
      }

      return Promise.resolve({ ...settings });
    }),
  };
}

// ============================================================================
// Project Repository Mock
// ============================================================================

export function createMockProjectRepository(
  initialProjects?: ProjectStatus[]
): jest.Mocked<ProjectRepository> & { getProjectPath: jest.Mock } {
  const projects = new Map<string, ProjectStatus>();

  if (initialProjects) {
    for (const project of initialProjects) {
      projects.set(project.id, { ...project });
    }
  }

  return {
    findAll: jest.fn().mockImplementation(() => {
      return Promise.resolve(Array.from(projects.values()));
    }),
    findById: jest.fn().mockImplementation((id: string) => {
      const project = projects.get(id);
      return Promise.resolve(project ? { ...project } : null);
    }),
    findByPath: jest.fn().mockImplementation((path: string) => {
      for (const project of projects.values()) {
        if (project.path === path) {
          return Promise.resolve({ ...project });
        }
      }
      return Promise.resolve(null);
    }),
    create: jest.fn().mockImplementation((data: CreateProjectData) => {
      const id = data.path.replace(/[^a-zA-Z0-9]/g, '_');
      const now = new Date().toISOString();
      const project: ProjectStatus = {
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
      projects.set(id, project);
      return Promise.resolve({ ...project });
    }),
    updateStatus: jest.fn().mockImplementation((id: string, status: ProjectStatus['status']) => {
      const project = projects.get(id);

      if (!project) return Promise.resolve(null);
      project.status = status;
      project.updatedAt = new Date().toISOString();
      return Promise.resolve({ ...project });
    }),
    updateNextItem: jest.fn().mockImplementation((id: string, nextItem: MilestoneItemRef | null) => {
      const project = projects.get(id);

      if (!project) return Promise.resolve(null);
      project.nextItem = nextItem;
      project.updatedAt = new Date().toISOString();
      return Promise.resolve({ ...project });
    }),
    updateCurrentItem: jest.fn().mockImplementation((id: string, currentItem: MilestoneItemRef | null) => {
      const project = projects.get(id);

      if (!project) return Promise.resolve(null);
      project.currentItem = currentItem;
      project.updatedAt = new Date().toISOString();
      return Promise.resolve({ ...project });
    }),
    setCurrentConversation: jest.fn().mockImplementation((id: string, conversationId: string | null) => {
      const project = projects.get(id);

      if (!project) return Promise.resolve(null);
      project.currentConversationId = conversationId;
      project.updatedAt = new Date().toISOString();
      return Promise.resolve({ ...project });
    }),
    updateContextUsage: jest.fn().mockImplementation((id: string, contextUsage: ContextUsageData | null) => {
      const project = projects.get(id);

      if (!project) return Promise.resolve(null);
      project.lastContextUsage = contextUsage;
      project.updatedAt = new Date().toISOString();
      return Promise.resolve({ ...project });
    }),
    updatePermissionOverrides: jest.fn().mockImplementation((id: string, overrides: ProjectPermissionOverrides | null) => {
      const project = projects.get(id);

      if (!project) return Promise.resolve(null);
      project.permissionOverrides = overrides;
      project.updatedAt = new Date().toISOString();
      return Promise.resolve({ ...project });
    }),
    updateModelOverride: jest.fn().mockImplementation((id: string, model: string | null) => {
      const project = projects.get(id);

      if (!project) return Promise.resolve(null);
      project.modelOverride = model;
      project.updatedAt = new Date().toISOString();
      return Promise.resolve({ ...project });
    }),
    updateMcpOverrides: jest.fn().mockImplementation((id: string, overrides: any) => {
      const project = projects.get(id);

      if (!project) return Promise.resolve(null);
      project.mcpOverrides = overrides;
      project.updatedAt = new Date().toISOString();
      return Promise.resolve({ ...project });
    }),
    updateRunConfigurations: jest.fn().mockImplementation((id: string, configs: RunConfiguration[]) => {
      const project = projects.get(id);

      if (!project) return Promise.resolve(null);
      project.runConfigurations = configs;
      project.updatedAt = new Date().toISOString();
      return Promise.resolve({ ...project });
    }),
    updateDockerOverride: jest.fn().mockImplementation((id: string, dockerOverride: boolean | undefined) => {
      const project = projects.get(id);

      if (!project) return Promise.resolve(null);
      project.dockerOverride = dockerOverride;
      project.updatedAt = new Date().toISOString();
      return Promise.resolve({ ...project });
    }),
    updateDockerImage: jest.fn().mockImplementation((id: string, dockerImage: string | null) => {
      const project = projects.get(id);

      if (!project) return Promise.resolve(null);
      project.dockerImage = dockerImage;
      project.updatedAt = new Date().toISOString();
      return Promise.resolve({ ...project });
    }),
    updateProjectPath: jest.fn().mockImplementation((id: string, newName: string, newPath: string) => {
      const project = projects.get(id);

      if (!project) return Promise.resolve(null);

      const newId = newPath.replace(/[^a-zA-Z0-9]/g, '_');
      projects.delete(id);

      const updated = {
        ...project,
        id: newId,
        name: newName,
        path: newPath,
        updatedAt: new Date().toISOString(),
      };

      projects.set(newId, updated);
      return Promise.resolve({ ...updated });
    }),
    delete: jest.fn().mockImplementation((id: string) => {
      const existed = projects.has(id);
      projects.delete(id);
      return Promise.resolve(existed);
    }),
    updateSlackNotification: jest.fn().mockImplementation((id: string, config: unknown) => {
      const project = projects.get(id);
      if (!project) return Promise.resolve(null);
      (project as ProjectStatus).slackNotification = config as ProjectStatus['slackNotification'];
      project.updatedAt = new Date().toISOString();
      return Promise.resolve({ ...project });
    }),
    updateSlackLinkedChannel: jest.fn().mockImplementation((id: string, channelId: string | null) => {
      const project = projects.get(id);
      if (!project) return Promise.resolve(null);
      project.slackLinkedChannelId = channelId ?? undefined;
      project.updatedAt = new Date().toISOString();
      return Promise.resolve({ ...project });
    }),
    // Extra method for path resolution
    getProjectPath: jest.fn().mockImplementation((id: string) => {
      const project = projects.get(id);
      return project?.path || null;
    }),
  };
}

// ============================================================================
// Conversation Repository Mock
// ============================================================================

export function createMockConversationRepository(): jest.Mocked<ConversationRepository> {
  const conversations = new Map<string, Conversation>();

  return {
    create: jest.fn().mockImplementation((projectId: string, itemRef: MilestoneItemRef | null) => {
      // Use proper UUID v4 format to pass isValidUUID validation
      const id = randomUUID();
      const now = new Date().toISOString();
      const conversation: Conversation = {
        id,
        projectId,
        itemRef,
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
      conversations.set(`${projectId}:${id}`, conversation);
      return Promise.resolve({ ...conversation });
    }),
    findById: jest.fn().mockImplementation((projectId: string, conversationId: string) => {
      const conversation = conversations.get(`${projectId}:${conversationId}`);
      return Promise.resolve(conversation ? { ...conversation } : null);
    }),
    getByProject: jest.fn().mockImplementation((projectId: string, limit?: number) => {
      const projectConversations: Conversation[] = [];

      for (const [key, conv] of conversations.entries()) {
        if (key.startsWith(`${projectId}:`)) {
          projectConversations.push({ ...conv });
        }
      }
      projectConversations.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      if (limit && limit > 0) {
        return Promise.resolve(projectConversations.slice(0, limit));
      }

      return Promise.resolve(projectConversations);
    }),
    addMessage: jest.fn().mockImplementation((projectId: string, conversationId: string, message: AgentMessage) => {
      const key = `${projectId}:${conversationId}`;
      const conversation = conversations.get(key);

      if (conversation) {
        conversation.messages.push(message);
        conversation.updatedAt = new Date().toISOString();
      }

      return Promise.resolve();
    }),
    getMessages: jest.fn().mockImplementation((projectId: string, conversationId: string, limit?: number) => {
      const conversation = conversations.get(`${projectId}:${conversationId}`);

      if (!conversation) return Promise.resolve([]);
      const messages = conversation.messages;

      if (limit && limit < messages.length) {
        return Promise.resolve(messages.slice(-limit));
      }

      return Promise.resolve([...messages]);
    }),
    clearMessages: jest.fn().mockImplementation((projectId: string, conversationId: string) => {
      const conversation = conversations.get(`${projectId}:${conversationId}`);

      if (conversation) {
        conversation.messages = [];
        conversation.updatedAt = new Date().toISOString();
      }

      return Promise.resolve();
    }),
    deleteConversation: jest.fn().mockImplementation((projectId: string, conversationId: string) => {
      conversations.delete(`${projectId}:${conversationId}`);
      return Promise.resolve();
    }),
    renameConversation: jest.fn().mockImplementation((projectId: string, conversationId: string, label: string) => {
      const conversation = conversations.get(`${projectId}:${conversationId}`);

      if (!conversation) {
        throw new Error(`Conversation ${conversationId} not found`);
      }

      conversation.label = label;
      conversation.updatedAt = new Date().toISOString();
      return Promise.resolve();
    }),
    updateMetadata: jest.fn().mockImplementation((
      projectId: string,
      conversationId: string,
      metadata: Partial<ConversationMetadata>
    ) => {
      const conversation = conversations.get(`${projectId}:${conversationId}`);

      if (conversation) {
        conversation.metadata = { ...conversation.metadata, ...metadata };
        conversation.updatedAt = new Date().toISOString();
      }

      return Promise.resolve();
    }),
    searchMessages: jest.fn().mockImplementation((_projectId: string, _query: string) => {
      return Promise.resolve([] as SearchResult[]);
    }),
    flush: jest.fn().mockResolvedValue(undefined),
    addMessageLegacy: jest.fn().mockResolvedValue(undefined),
    getMessagesLegacy: jest.fn().mockResolvedValue([]),
  };
}

// ============================================================================
// Conversation FileSystem Mock
// ============================================================================

export function createMockConversationFileSystem(): jest.Mocked<ConversationFileSystem> {
  const files = new Map<string, string>();

  return {
    readFile: jest.fn().mockImplementation((filePath: string) => {
      const content = files.get(filePath);

      if (content === undefined) {
        return Promise.reject(new Error(`File not found: ${filePath}`));
      }

      return Promise.resolve(content);
    }),
    writeFile: jest.fn().mockImplementation((filePath: string, data: string) => {
      files.set(filePath, data);
      return Promise.resolve();
    }),
    exists: jest.fn().mockImplementation((filePath: string) => {
      return Promise.resolve(files.has(filePath));
    }),
    mkdir: jest.fn().mockResolvedValue(undefined),
    readdir: jest.fn().mockResolvedValue([]),
    unlink: jest.fn().mockImplementation((filePath: string) => {
      files.delete(filePath);
      return Promise.resolve();
    }),
  };
}

// ============================================================================
// Project Path Resolver Mock
// ============================================================================

export function createMockProjectPathResolver(
  paths?: Record<string, string>
): jest.Mocked<ProjectPathResolver> {
  const projectPaths = new Map(Object.entries(paths || {}));

  return {
    getProjectPath: jest.fn().mockImplementation((projectId: string) => {
      return projectPaths.get(projectId) || null;
    }),
  };
}

// ============================================================================
// Process Spawner Mock
// ============================================================================

export interface MockChildProcess {
  pid: number;
  stdin: {
    write: jest.Mock;
    end: jest.Mock;
    on: jest.Mock;
    destroyed: boolean;
  };
  stdout: EventEmitter;
  stderr: EventEmitter;
  on: jest.Mock;
  once: jest.Mock;
  kill: jest.Mock;
  removeAllListeners: jest.Mock;
}

export function createMockChildProcess(pid = 12345): MockChildProcess {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const onMock = jest.fn();
  const onceMock = jest.fn();

  return {
    pid,
    stdin: {
      write: jest.fn().mockReturnValue(true),
      end: jest.fn(),
      on: jest.fn(),
      destroyed: false,
    },
    stdout,
    stderr,
    on: onMock,
    once: onceMock,
    kill: jest.fn(),
    removeAllListeners: jest.fn(),
  };
}

export function createMockProcessSpawner(
  mockProcess?: MockChildProcess
): jest.Mocked<ProcessSpawner> {
  const process = mockProcess || createMockChildProcess();

  return {
    spawn: jest.fn().mockReturnValue(process as unknown as ChildProcess),
  };
}

// ============================================================================
// Claude Agent Mock
// ============================================================================

export function createMockClaudeAgent(projectId = 'test-project'): jest.Mocked<ClaudeAgent> {
  const emitter = new EventEmitter();
  let status: AgentStatus = 'stopped';
  let mode: AgentMode = 'interactive';
  let isProcessing = false;
  let waitingVersion = 0;
  let contextUsage: ContextUsage | null = null;
  const queuedMessages: string[] = [];
  let sessionId = 'mock-session-' + Math.random().toString(36).substring(7);

  const agent: jest.Mocked<ClaudeAgent> = {
    projectId,
    get status() { return status; },
    get mode() { return mode; },
    get lastCommand() { return null; },
    get processInfo() { return null; },
    get collectedOutput() { return ''; },
    get contextUsage() { return contextUsage; },
    get queuedMessageCount() { return queuedMessages.length; },
    get queuedMessages() { return [...queuedMessages]; },
    get isWaitingForInput() { return mode === 'interactive' && status === 'running' && !isProcessing; },
    get waitingVersion() { return waitingVersion; },
    get sessionId() { return sessionId; },
    get sessionError() { return null; },
    get permissionMode() { return null; },
    start: jest.fn().mockImplementation(() => {
      status = 'running';
      emitter.emit('status', status);
    }),
    stop: jest.fn().mockImplementation(() => {
      status = 'stopped';
      emitter.emit('status', status);
      emitter.emit('exit', 0);
    }),
    sendInput: jest.fn().mockImplementation((input: string) => {
      if (isProcessing) {
        queuedMessages.push(input);
      }
    }),
    sendToolResult: jest.fn(),
    removeQueuedMessage: jest.fn().mockImplementation((index: number) => {
      if (index < 0 || index >= queuedMessages.length) return false;
      queuedMessages.splice(index, 1);
      return true;
    }),
    on: jest.fn().mockImplementation(<K extends keyof AgentEvents>(
      event: K,
      listener: AgentEvents[K]
    ) => {
      emitter.on(event, listener);
    }),
    off: jest.fn().mockImplementation(<K extends keyof AgentEvents>(
      event: K,
      listener: AgentEvents[K]
    ) => {
      emitter.off(event, listener);
    }),
  };

  // Expose internal state setters for testing
  (agent as unknown as { _setStatus: (s: AgentStatus) => void })._setStatus = (s) => {
    status = s;
    emitter.emit('status', s);
  };
  (agent as unknown as { _setMode: (m: AgentMode) => void })._setMode = (m) => { mode = m; };
  (agent as unknown as { _setProcessing: (p: boolean) => void })._setProcessing = (p) => {
    isProcessing = p;
    waitingVersion++;
    emitter.emit('waitingForInput', { isWaiting: !p && mode === 'interactive' && status === 'running', version: waitingVersion });
  };
  (agent as unknown as { _setContextUsage: (c: ContextUsage | null) => void })._setContextUsage = (c) => { contextUsage = c; };
  (agent as unknown as { _setSessionId: (id: string) => void })._setSessionId = (id) => { sessionId = id; };
  (agent as unknown as { _emit: <K extends keyof AgentEvents>(event: K, ...args: Parameters<AgentEvents[K]>) => void })._emit = (event, ...args) => {
    emitter.emit(event, ...args);
  };

  return agent;
}

// ============================================================================
// Agent Factory Mock
// ============================================================================

export function createMockAgentFactory(
  mockAgent?: jest.Mocked<ClaudeAgent>
): jest.Mocked<AgentFactory> {
  return {
    create: jest.fn().mockImplementation((options: AgentFactoryOptions) => {
      if (mockAgent) {
        // Update mock agent's mode
        (mockAgent as unknown as { _setMode: (m: AgentMode) => void })._setMode(options.mode);
        return mockAgent;
      }

      return createMockClaudeAgent(options.projectId);
    }),
  };
}

// ============================================================================
// Instruction Generator Mock
// ============================================================================

export function createMockInstructionGenerator(): jest.Mocked<InstructionGenerator> {
  return {
    generate: jest.fn().mockReturnValue('Generated instructions'),
    generateForItem: jest.fn().mockImplementation((template: string, config: InstructionGeneratorConfig) => {
      return template
        .replace(/\$\{var:project-name\}/g, config.projectName)
        .replace(/\$\{var:phase-title\}/g, config.phaseTitle)
        .replace(/\$\{var:milestone-title\}/g, config.milestoneTitle)
        .replace(/\$\{var:milestone-item\}/g, config.milestoneItem);
    }),
    generateForMilestone: jest.fn().mockImplementation((template: string, config: MilestoneInstructionConfig) => {
      const taskList = config.pendingTasks.map((t) => `- ${t}`).join('\n');
      return template
        .replace(/\$\{var:project-name\}/g, config.projectName)
        .replace(/\$\{var:phase-title\}/g, config.phaseTitle)
        .replace(/\$\{var:milestone-title\}/g, config.milestoneTitle)
        .replace(/\$\{var:milestone-item\}/g, taskList);
    }),
    findItemByRef: jest.fn().mockReturnValue(null),
    findFirstIncompleteItem: jest.fn().mockReturnValue(null),
    findFirstIncompleteMilestone: jest.fn().mockReturnValue(null),
  };
}

// ============================================================================
// Roadmap Parser Mock
// ============================================================================

export function createMockRoadmapParser(
  roadmap?: ParsedRoadmap
): jest.Mocked<RoadmapParser> {
  return {
    parse: jest.fn().mockReturnValue(roadmap || sampleParsedRoadmap),
  };
}

// ============================================================================
// Permission Generator Mock
// ============================================================================

export function createMockPermissionGenerator(): jest.Mocked<PermissionGenerator> {
  return {
    generateArgs: jest.fn().mockReturnValue({
      allowedTools: [],
      disallowedTools: [],
      permissionMode: 'acceptEdits',
      skipPermissions: false,
    } as PermissionArgs),
    buildCliArgs: jest.fn().mockReturnValue([]),
    generateMcpAllowRules: jest.fn().mockReturnValue([]),
  };
}

// ============================================================================
// Git Service Mock
// ============================================================================

import { GitService, GitStatus, BranchInfo, CommitResult } from '../../../src/services/git-service';

export const sampleGitStatus: GitStatus = {
  isRepo: true,
  staged: [],
  unstaged: [],
  untracked: [],
};

export const sampleBranchInfo: BranchInfo = {
  current: 'main',
  local: ['main', 'develop', 'feature/test'],
  remote: ['origin/main', 'origin/develop'],
};

export function createMockGitService(): jest.Mocked<GitService> {
  return {
    getStatus: jest.fn().mockResolvedValue(sampleGitStatus),
    getBranches: jest.fn().mockResolvedValue(sampleBranchInfo),
    stageFiles: jest.fn().mockResolvedValue(undefined),
    unstageFiles: jest.fn().mockResolvedValue(undefined),
    stageAll: jest.fn().mockResolvedValue(undefined),
    unstageAll: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue({ hash: 'abc123', message: 'Test commit' } as CommitResult),
    createBranch: jest.fn().mockResolvedValue(undefined),
    checkout: jest.fn().mockResolvedValue(undefined),
    push: jest.fn().mockResolvedValue('Pushed successfully'),
    pull: jest.fn().mockResolvedValue('Pulled successfully'),
    getDiff: jest.fn().mockResolvedValue('diff --git a/file.ts b/file.ts'),
    getFileDiff: jest.fn().mockResolvedValue({ diff: 'file diff', filePath: 'file.ts' }),
    discardChanges: jest.fn().mockResolvedValue(undefined),
    isGitRepo: jest.fn().mockResolvedValue(true),
    listTags: jest.fn().mockResolvedValue(['v1.0.0', 'v1.1.0']),
    createTag: jest.fn().mockResolvedValue(undefined),
    pushTag: jest.fn().mockResolvedValue('Tag pushed'),
    deleteTag: jest.fn().mockResolvedValue(undefined),
    getRemoteUrl: jest.fn().mockResolvedValue('https://github.com/testuser/test-repo.git'),
    getUserName: jest.fn().mockResolvedValue('Test User'),
  };
}

// ============================================================================
// Roadmap Generator Mock
// ============================================================================

import { RoadmapGenerator, GenerateRoadmapResult, RoadmapGeneratorEvents } from '../../../src/services/roadmap-generator';

export function createMockRoadmapGenerator(): jest.Mocked<RoadmapGenerator> {
  const emitter = new EventEmitter();
  const generatingProjects = new Set<string>();

  return {
    generate: jest.fn().mockImplementation((options: { projectId: string }) => {
      generatingProjects.add(options.projectId);
      const result: GenerateRoadmapResult = { success: true };
      generatingProjects.delete(options.projectId);
      return Promise.resolve(result);
    }),
    sendResponse: jest.fn(),
    isGenerating: jest.fn().mockImplementation((projectId: string) => generatingProjects.has(projectId)),
    on: jest.fn().mockImplementation(<K extends keyof RoadmapGeneratorEvents>(
      event: K,
      listener: RoadmapGeneratorEvents[K]
    ) => {
      emitter.on(event, listener);
    }),
    off: jest.fn().mockImplementation(<K extends keyof RoadmapGeneratorEvents>(
      event: K,
      listener: RoadmapGeneratorEvents[K]
    ) => {
      emitter.off(event, listener);
    }),
  };
}

// ============================================================================
// Roadmap Editor Mock
// ============================================================================

import { RoadmapEditor } from '../../../src/services/roadmap';

export function createMockRoadmapEditor(): jest.Mocked<RoadmapEditor> {
  return {
    deleteTask: jest.fn().mockImplementation((content: string) => content),
    deleteMilestone: jest.fn().mockImplementation((content: string) => content),
    deletePhase: jest.fn().mockImplementation((content: string) => content),
    addTask: jest.fn().mockImplementation((content: string) => content),
  };
}

// ============================================================================
// Project Service Mock
// ============================================================================

import { ProjectService, CreateProjectOptions, CreateProjectResult } from '../../../src/services/project';
import { Project } from '../../../src/repositories/project';

export function createMockProjectService(): jest.Mocked<ProjectService> {
  return {
    createProject: jest.fn().mockImplementation((options: CreateProjectOptions) => {
      const now = new Date().toISOString();
      const project: Project = {
        id: 'new-project-id',
        name: options.name || 'New Project',
        path: options.path,
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
      const result: CreateProjectResult = {
        success: true,
        project,
      };
      return Promise.resolve(result);
    }),
    updateProjectPath: jest.fn().mockImplementation((_id: string, newName: string, newPath: string) => {
      const newId = newPath.replace(/[^a-zA-Z0-9]/g, '_');
      const now = new Date().toISOString();
      const project: Project = {
        id: newId,
        name: newName,
        path: newPath,
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
      return Promise.resolve(project);
    }),
    hasRoadmap: jest.fn().mockResolvedValue(true),
    getRoadmapContent: jest.fn().mockResolvedValue('# Roadmap\n## Phase 1'),
  };
}

// ============================================================================
// Agent Manager Mock
// ============================================================================

import {
  AgentManager,
  AgentManagerEvents,
  AgentLoopState,
  QueuedProject,
  FullAgentStatus,
  StartAgentResult,
} from '../../../src/agents/agent-manager';

export function createMockAgentManager(): jest.Mocked<AgentManager> {
  const emitter = new EventEmitter();
  const runningAgents = new Map<string, { mode: AgentMode; status: AgentStatus }>();
  const queuedProjects: QueuedProject[] = [];
  const loopStates = new Map<string, AgentLoopState>();

  const mock: jest.Mocked<AgentManager> = {
    startAgent: jest.fn().mockImplementation((projectId: string) => {
      runningAgents.set(projectId, { mode: 'autonomous', status: 'running' });
      return Promise.resolve();
    }),
    startInteractiveAgent: jest.fn().mockImplementation((projectId: string) => {
      runningAgents.set(projectId, { mode: 'interactive', status: 'running' });
      return Promise.resolve({ containerRestarted: false, containerImageName: undefined, dockerFallback: false } as StartAgentResult);
    }),
    sendInput: jest.fn(),
    sendToolResult: jest.fn(),
    stopAgent: jest.fn().mockImplementation((projectId: string) => {
      runningAgents.delete(projectId);
      return Promise.resolve();
    }),
    stopAllAgents: jest.fn().mockImplementation(() => {
      runningAgents.clear();
      return Promise.resolve();
    }),
    getAgentStatus: jest.fn().mockImplementation((projectId: string) => {
      return runningAgents.get(projectId)?.status || 'stopped';
    }),
    getAgentMode: jest.fn().mockImplementation((projectId: string) => {
      return runningAgents.get(projectId)?.mode || null;
    }),
    isRunning: jest.fn().mockImplementation((projectId: string) => {
      return runningAgents.has(projectId);
    }),
    isQueued: jest.fn().mockImplementation((projectId: string) => {
      return queuedProjects.some((q) => q.projectId === projectId);
    }),
    isWaitingForInput: jest.fn().mockReturnValue(false),
    hasPendingPlan: jest.fn().mockReturnValue(false),
    approvePlan: jest.fn().mockResolvedValue(undefined),
    getWaitingVersion: jest.fn().mockReturnValue(0),
    getResourceStatus: jest.fn().mockImplementation(() => ({
      runningCount: runningAgents.size,
      maxConcurrent: 3,
      queuedCount: queuedProjects.length,
      queuedProjects: [...queuedProjects],
    })),
    removeFromQueue: jest.fn().mockImplementation((projectId: string) => {
      const index = queuedProjects.findIndex((q) => q.projectId === projectId);
      if (index >= 0) queuedProjects.splice(index, 1);
    }),
    setMaxConcurrentAgents: jest.fn(),
    startAutonomousLoop: jest.fn().mockImplementation((projectId: string) => {
      runningAgents.set(projectId, { mode: 'autonomous', status: 'running' });
      loopStates.set(projectId, {
        isLooping: true,
        currentMilestone: null,
        currentConversationId: null,
      });
      return Promise.resolve();
    }),
    stopAutonomousLoop: jest.fn().mockImplementation((projectId: string) => {
      loopStates.delete(projectId);
    }),
    getLoopState: jest.fn().mockImplementation((projectId: string) => {
      return loopStates.get(projectId) || null;
    }),
    getLastCommand: jest.fn().mockReturnValue(null),
    getProcessInfo: jest.fn().mockReturnValue(null),
    getContextUsage: jest.fn().mockReturnValue(null),
    getQueuedMessageCount: jest.fn().mockReturnValue(0),
    getQueuedMessages: jest.fn().mockReturnValue([]),
    removeQueuedMessage: jest.fn().mockReturnValue(true),
    getSessionId: jest.fn().mockReturnValue(null),
    getFullStatus: jest.fn().mockImplementation((projectId: string) => {
      const isRunning = runningAgents.has(projectId);
      const fullStatus: FullAgentStatus = {
        status: isRunning ? 'running' : 'stopped',
        mode: runningAgents.get(projectId)?.mode || null,
        queued: false,
        queuedMessageCount: 0,
        isWaitingForInput: false,
        waitingVersion: 0,
        sessionId: null,
        permissionMode: null,
      };
      return fullStatus;
    }),
    getTrackedProcesses: jest.fn().mockReturnValue([]),
    cleanupOrphanProcesses: jest.fn().mockResolvedValue({ killed: [], failed: [] }),
    restartAllRunningAgents: jest.fn().mockResolvedValue(undefined),
    restartProjectAgent: jest.fn().mockResolvedValue(undefined),
    getRunningProjectIds: jest.fn().mockImplementation(() => Array.from(runningAgents.keys())),
    startOneOffAgent: jest.fn().mockResolvedValue('oneoff-test-id'),
    stopOneOffAgent: jest.fn().mockResolvedValue(undefined),
    getOneOffMeta: jest.fn().mockReturnValue(null),
    sendOneOffInput: jest.fn(),
    getOneOffStatus: jest.fn().mockReturnValue(null),
    getOneOffContextUsage: jest.fn().mockReturnValue(null),
    isOneOffWaitingForInput: jest.fn().mockReturnValue(false),
    getOneOffCollectedOutput: jest.fn().mockReturnValue(null),
    on: jest.fn().mockImplementation(<K extends keyof AgentManagerEvents>(
      event: K,
      listener: AgentManagerEvents[K]
    ) => {
      emitter.on(event, listener);
    }),
    off: jest.fn().mockImplementation(<K extends keyof AgentManagerEvents>(
      event: K,
      listener: AgentManagerEvents[K]
    ) => {
      emitter.off(event, listener);
    }),
  };

  // Expose internal controls for testing
  (mock as unknown as { _addToQueue: (project: QueuedProject) => void })._addToQueue = (project) => {
    queuedProjects.push(project);
  };
  (mock as unknown as { _setLoopState: (projectId: string, state: AgentLoopState | null) => void })._setLoopState = (projectId, state) => {
    if (state) {
      loopStates.set(projectId, state);
    } else {
      loopStates.delete(projectId);
    }
  };

  return mock;
}

// ============================================================================
// GitHub CLI Service Mock
// ============================================================================

import { GitHubCLIService, GitHubCLIStatus, GitHubRepo, GitHubIssue, GitHubPullRequest, CommandRunner } from '../../../src/services/github-cli-service';

export const sampleGitHubCLIStatus: GitHubCLIStatus = {
  installed: true,
  version: '2.45.0',
  authenticated: true,
  username: 'testuser',
  error: null,
};

export const sampleGitHubRepo: GitHubRepo = {
  name: 'test-repo',
  fullName: 'testuser/test-repo',
  description: 'A test repository',
  url: 'https://github.com/testuser/test-repo',
  isPrivate: false,
  language: 'TypeScript',
  updatedAt: '2024-06-01T00:00:00Z',
  stargazerCount: 42,
};

export const sampleGitHubIssue: GitHubIssue = {
  number: 42,
  title: 'Test issue',
  body: 'This is a test issue body',
  state: 'OPEN',
  url: 'https://github.com/testuser/test-repo/issues/42',
  author: 'testuser',
  labels: ['bug', 'help wanted'],
  assignees: ['testuser'],
  milestone: null,
  createdAt: '2024-06-01T00:00:00Z',
  updatedAt: '2024-06-02T00:00:00Z',
  commentsCount: 2,
};

export const sampleGitHubPR: GitHubPullRequest = {
  number: 10,
  title: 'feat: add new feature',
  body: 'This PR adds a new feature',
  state: 'OPEN',
  isDraft: false,
  url: 'https://github.com/testuser/test-repo/pull/10',
  author: 'testuser',
  headBranch: 'feature-branch',
  baseBranch: 'main',
  labels: ['enhancement'],
  reviewDecision: null,
  createdAt: '2024-06-01T00:00:00Z',
  updatedAt: '2024-06-02T00:00:00Z',
};

export function createMockGitHubCLIService(): jest.Mocked<GitHubCLIService> {
  return {
    getStatus: jest.fn().mockResolvedValue({ ...sampleGitHubCLIStatus }),
    isAvailable: jest.fn().mockResolvedValue(true),
    listRepos: jest.fn().mockResolvedValue([{ ...sampleGitHubRepo }]),
    searchRepos: jest.fn().mockResolvedValue([{ ...sampleGitHubRepo }]),
    cloneRepo: jest.fn().mockResolvedValue(undefined),
    listIssues: jest.fn().mockResolvedValue([{ ...sampleGitHubIssue }]),
    viewIssue: jest.fn().mockResolvedValue({
      issue: { ...sampleGitHubIssue },
      comments: [{ author: 'testuser', body: 'A comment', createdAt: '2024-06-02T00:00:00Z' }],
    }),
    closeIssue: jest.fn().mockResolvedValue(undefined),
    commentOnIssue: jest.fn().mockResolvedValue(undefined),
    createIssue: jest.fn().mockResolvedValue({ ...sampleGitHubIssue }),
    listLabels: jest.fn().mockResolvedValue([
      { name: 'bug', color: 'fc2929', description: 'Something is broken' },
      { name: 'enhancement', color: '84b6eb', description: 'New feature' },
    ]),
    listMilestones: jest.fn().mockResolvedValue([
      { title: 'v1.0', number: 1, state: 'open' },
    ]),
    listCollaborators: jest.fn().mockResolvedValue([
      { login: 'testuser' },
      { login: 'collaborator1' },
    ]),
    commentOnPR: jest.fn().mockResolvedValue(undefined),
    markPRReady: jest.fn().mockResolvedValue(undefined),
    mergePR: jest.fn().mockResolvedValue(undefined),
    createPR: jest.fn().mockResolvedValue({ ...sampleGitHubPR }),
    listPRs: jest.fn().mockResolvedValue([{ ...sampleGitHubPR }]),
    viewPR: jest.fn().mockResolvedValue({
      pr: { ...sampleGitHubPR },
      reviews: [{ author: 'reviewer', state: 'APPROVED', body: 'LGTM', submittedAt: '2024-06-02T00:00:00Z' }],
      comments: [],
    }),
  };
}

export function createMockCommandRunner(): jest.Mocked<CommandRunner> {
  return {
    exec: jest.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    spawn: jest.fn().mockReturnValue(new EventEmitter() as any),
  };
}

import { SlackService, SlackStatus } from '../../../src/services/slack-service';

export function createMockSlackService(): jest.Mocked<SlackService> {
  const defaultStatus: SlackStatus = {
    connected: false,
    workspaceName: null,
    botUserId: null,
    botUserName: null,
    error: 'No bot token configured',
  };

  return {
    getStatus: jest.fn().mockResolvedValue(defaultStatus),
    validateBotToken: jest.fn().mockResolvedValue({ valid: true, error: null, workspaceName: 'Test', botUserId: 'U1' }),
    sendMessage: jest.fn().mockResolvedValue('ts-123'),
    replyInThread: jest.fn().mockResolvedValue('1234567890.000100'),
    updateMessage: jest.fn().mockResolvedValue(undefined),
    listChannels: jest.fn().mockResolvedValue([]),
    getUserName: jest.fn().mockResolvedValue(null),
  };
}

// ============================================================================
// Helper Functions for Creating Test Data
// ============================================================================

export function createTestProject(overrides?: Partial<ProjectStatus>): ProjectStatus {
  return {
    ...sampleProject,
    ...overrides,
    id: overrides?.id || `project-${Date.now()}`,
  };
}

export function createTestConversation(overrides?: Partial<Conversation>): Conversation {
  return {
    ...sampleConversation,
    ...overrides,
    id: overrides?.id || `conv-${Date.now()}`,
  };
}

export function createTestAgentMessage(
  type: AgentMessage['type'],
  content: string,
  overrides?: Partial<AgentMessage>
): AgentMessage {
  return {
    type,
    content,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

export function createTestRoadmap(overrides?: Partial<ParsedRoadmap>): ParsedRoadmap {
  return {
    ...sampleParsedRoadmap,
    ...overrides,
  };
}

export function createTestPhase(
  id: string,
  title: string,
  milestones: RoadmapMilestone[] = []
): RoadmapPhase {
  return { id, title, milestones };
}

export function createTestMilestone(
  id: string,
  title: string,
  tasks: RoadmapTask[] = []
): RoadmapMilestone {
  const completedCount = tasks.filter((t) => t.completed).length;
  return {
    id,
    title,
    tasks,
    completedCount,
    totalCount: tasks.length,
  };
}

export function createTestTask(title: string, completed = false): RoadmapTask {
  return { title, completed };
}

// ============================================================================
// Ralph Loop Mocks
// ============================================================================

import {
  RalphLoopState,
  RalphLoopConfig,
  RalphLoopRepository,
  RalphLoopService,
  RalphLoopEvents,
  IterationSummary,
  ReviewerFeedback,
  ContextInitializer,
} from '../../../src/services/ralph-loop/types';
import { RalphLoopFileSystem } from '../../../src/repositories/ralph-loop';

export const sampleRalphLoopConfig: RalphLoopConfig = {
  maxTurns: 5,
  workerModel: 'claude-opus-4-6',
  reviewerModel: 'claude-sonnet-4-5-20250929',
  taskDescription: 'Implement a test feature',
};

export const sampleRalphLoopState: RalphLoopState = {
  taskId: 'task-123',
  projectId: '123e4567-e89b-12d3-a456-426614174000',
  config: sampleRalphLoopConfig,
  currentIteration: 0,
  status: 'idle',
  summaries: [],
  feedback: [],
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

export const sampleIterationSummary: IterationSummary = {
  iterationNumber: 1,
  timestamp: '2024-01-01T00:00:00.000Z',
  workerOutput: 'Implemented feature X',
  filesModified: ['src/feature.ts'],
  tokensUsed: 1000,
  durationMs: 5000,
};

export const sampleReviewerFeedback: ReviewerFeedback = {
  iterationNumber: 1,
  timestamp: '2024-01-01T00:00:00.000Z',
  decision: 'needs_changes',
  feedback: 'Good progress, but needs more tests',
  specificIssues: ['Missing test for edge case'],
  suggestedImprovements: ['Add unit tests'],
};

export function createMockRalphLoopFileSystem(): jest.Mocked<RalphLoopFileSystem> {
  const files = new Map<string, string>();
  const directories = new Set<string>();

  return {
    readFile: jest.fn().mockImplementation((filePath: string) => {
      const content = files.get(filePath);

      if (content === undefined) {
        return Promise.reject(new Error(`File not found: ${filePath}`));
      }

      return Promise.resolve(content);
    }),
    writeFile: jest.fn().mockImplementation((filePath: string, data: string) => {
      files.set(filePath, data);
      return Promise.resolve();
    }),
    exists: jest.fn().mockImplementation((filePath: string) => {
      return Promise.resolve(files.has(filePath) || directories.has(filePath));
    }),
    mkdir: jest.fn().mockImplementation((dirPath: string) => {
      directories.add(dirPath);
      return Promise.resolve();
    }),
    readdir: jest.fn().mockImplementation((dirPath: string) => {
      const entries: string[] = [];

      for (const filePath of files.keys()) {
        if (filePath.startsWith(dirPath + '/') || filePath.startsWith(dirPath + '\\')) {
          const relativePath = filePath.slice(dirPath.length + 1);
          const firstPart = relativePath.split(/[/\\]/)[0];

          if (firstPart && !entries.includes(firstPart)) {
            entries.push(firstPart);
          }
        }
      }

      for (const dir of directories) {
        if (dir.startsWith(dirPath + '/') || dir.startsWith(dirPath + '\\')) {
          const relativePath = dir.slice(dirPath.length + 1);
          const firstPart = relativePath.split(/[/\\]/)[0];

          if (firstPart && !entries.includes(firstPart)) {
            entries.push(firstPart);
          }
        }
      }

      return Promise.resolve(entries);
    }),
    unlink: jest.fn().mockImplementation((filePath: string) => {
      files.delete(filePath);
      return Promise.resolve();
    }),
    rmdir: jest.fn().mockImplementation((dirPath: string) => {
      directories.delete(dirPath);

      for (const filePath of files.keys()) {
        if (filePath.startsWith(dirPath)) {
          files.delete(filePath);
        }
      }

      return Promise.resolve();
    }),
  };
}

export function createMockRalphLoopRepository(): jest.Mocked<RalphLoopRepository> {
  const states = new Map<string, RalphLoopState>();

  const getCacheKey = (projectId: string, taskId: string): string => `${projectId}:${taskId}`;

  return {
    create: jest.fn().mockImplementation((state: Omit<RalphLoopState, 'createdAt' | 'updatedAt'>) => {
      const now = new Date().toISOString();
      const fullState: RalphLoopState = {
        ...state,
        createdAt: now,
        updatedAt: now,
      };
      states.set(getCacheKey(state.projectId, state.taskId), fullState);
      return Promise.resolve({ ...fullState });
    }),
    findById: jest.fn().mockImplementation((projectId: string, taskId: string) => {
      const state = states.get(getCacheKey(projectId, taskId));
      return Promise.resolve(state ? { ...state } : null);
    }),
    findByProject: jest.fn().mockImplementation((projectId: string) => {
      const projectStates: RalphLoopState[] = [];

      for (const [key, state] of states) {
        if (key.startsWith(`${projectId}:`)) {
          projectStates.push({ ...state });
        }
      }

      return Promise.resolve(
        projectStates.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      );
    }),
    update: jest.fn().mockImplementation((projectId: string, taskId: string, updates: Partial<RalphLoopState>) => {
      const key = getCacheKey(projectId, taskId);
      const existing = states.get(key);

      if (!existing) {
        return Promise.resolve(null);
      }

      const updated: RalphLoopState = {
        ...existing,
        ...updates,
        taskId: existing.taskId,
        projectId: existing.projectId,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };
      states.set(key, updated);
      return Promise.resolve({ ...updated });
    }),
    addSummary: jest.fn().mockImplementation((projectId: string, taskId: string, summary: IterationSummary) => {
      const key = getCacheKey(projectId, taskId);
      const existing = states.get(key);

      if (existing) {
        existing.summaries = [...existing.summaries, summary];
        existing.updatedAt = new Date().toISOString();
      }

      return Promise.resolve();
    }),
    addFeedback: jest.fn().mockImplementation((projectId: string, taskId: string, feedback: ReviewerFeedback) => {
      const key = getCacheKey(projectId, taskId);
      const existing = states.get(key);

      if (existing) {
        existing.feedback = [...existing.feedback, feedback];
        existing.updatedAt = new Date().toISOString();
      }

      return Promise.resolve();
    }),
    delete: jest.fn().mockImplementation((projectId: string, taskId: string) => {
      const key = getCacheKey(projectId, taskId);
      const existed = states.has(key);
      states.delete(key);
      return Promise.resolve(existed);
    }),
    flush: jest.fn().mockResolvedValue(undefined),
  };
}

export function createMockRalphLoopService(): jest.Mocked<RalphLoopService> {
  const emitter = new EventEmitter();
  const activeLoops = new Map<string, RalphLoopState>();

  const getCacheKey = (projectId: string, taskId: string): string => `${projectId}:${taskId}`;

  return {
    start: jest.fn().mockImplementation((projectId: string, config: RalphLoopConfig) => {
      const taskId = `task-${Date.now()}`;
      const now = new Date().toISOString();
      const state: RalphLoopState = {
        taskId,
        projectId,
        config,
        currentIteration: 0,
        status: 'idle',
        summaries: [],
        feedback: [],
        createdAt: now,
        updatedAt: now,
      };
      activeLoops.set(getCacheKey(projectId, taskId), state);
      return Promise.resolve(state);
    }),
    stop: jest.fn().mockImplementation((projectId: string, taskId: string) => {
      activeLoops.delete(getCacheKey(projectId, taskId));
      return Promise.resolve();
    }),
    pause: jest.fn().mockImplementation((projectId: string, taskId: string) => {
      const key = getCacheKey(projectId, taskId);
      const state = activeLoops.get(key);

      if (state) {
        state.status = 'paused';
      }

      return Promise.resolve();
    }),
    resume: jest.fn().mockImplementation((projectId: string, taskId: string) => {
      const key = getCacheKey(projectId, taskId);
      const state = activeLoops.get(key);

      if (state) {
        state.status = 'idle';
      }

      return Promise.resolve();
    }),
    getState: jest.fn().mockImplementation((projectId: string, taskId: string) => {
      const state = activeLoops.get(getCacheKey(projectId, taskId));
      return Promise.resolve(state ? { ...state } : null);
    }),
    listByProject: jest.fn().mockImplementation((projectId: string) => {
      const projectStates: RalphLoopState[] = [];

      for (const [key, state] of activeLoops) {
        if (key.startsWith(`${projectId}:`)) {
          projectStates.push({ ...state });
        }
      }

      return Promise.resolve(projectStates);
    }),
    delete: jest.fn().mockImplementation((projectId: string, taskId: string) => {
      const key = getCacheKey(projectId, taskId);
      const existed = activeLoops.has(key);
      activeLoops.delete(key);
      return Promise.resolve(existed);
    }),
    on: jest.fn().mockImplementation(<K extends keyof RalphLoopEvents>(
      event: K,
      listener: RalphLoopEvents[K]
    ) => {
      emitter.on(event, listener);
    }),
    off: jest.fn().mockImplementation(<K extends keyof RalphLoopEvents>(
      event: K,
      listener: RalphLoopEvents[K]
    ) => {
      emitter.off(event, listener);
    }),
  };
}

export function createMockContextInitializer(): jest.Mocked<ContextInitializer> {
  return {
    buildWorkerContext: jest.fn().mockReturnValue('Worker context'),
    buildReviewerContext: jest.fn().mockReturnValue('Reviewer context'),
  };
}

export function createTestRalphLoopConfig(overrides?: Partial<RalphLoopConfig>): RalphLoopConfig {
  return {
    ...sampleRalphLoopConfig,
    ...overrides,
  };
}

export function createTestRalphLoopState(overrides?: Partial<RalphLoopState>): RalphLoopState {
  const now = new Date().toISOString();
  return {
    ...sampleRalphLoopState,
    ...overrides,
    taskId: overrides?.taskId || `task-${Date.now()}`,
    createdAt: overrides?.createdAt || now,
    updatedAt: overrides?.updatedAt || now,
  };
}

export function createTestIterationSummary(overrides?: Partial<IterationSummary>): IterationSummary {
  return {
    ...sampleIterationSummary,
    ...overrides,
  };
}

export function createTestReviewerFeedback(overrides?: Partial<ReviewerFeedback>): ReviewerFeedback {
  return {
    ...sampleReviewerFeedback,
    ...overrides,
  };
}

// ============================================================================
// Run Configuration Service Mock
// ============================================================================

import {
  RunConfigurationService,
  CreateRunConfigData,
  UpdateRunConfigData,
} from '../../../src/services/run-config/types';
import { RunConfiguration as RunConfig } from '../../../src/repositories/project';

export const sampleRunConfiguration: RunConfig = {
  id: 'rc-uuid-1234',
  name: 'Dev Server',
  command: 'npm',
  args: ['run', 'dev'],
  cwd: '.',
  env: {},
  shell: null,
  autoRestart: false,
  autoRestartDelay: 1000,
  autoRestartMaxRetries: 5,
  preLaunchConfigId: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

export function createMockRunConfigurationService(): jest.Mocked<RunConfigurationService> {
  const configs = new Map<string, RunConfig[]>();

  return {
    list: jest.fn().mockImplementation((projectId: string) => {
      return Promise.resolve(configs.get(projectId) || []);
    }),
    getById: jest.fn().mockImplementation((projectId: string, configId: string) => {
      const projectConfigs = configs.get(projectId) || [];
      const config = projectConfigs.find((c) => c.id === configId);
      return Promise.resolve(config || null);
    }),
    create: jest.fn().mockImplementation((projectId: string, data: CreateRunConfigData) => {
      const now = new Date().toISOString();
      const config: RunConfig = {
        id: `rc-${Date.now()}`,
        name: data.name,
        command: data.command,
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

      const existing = configs.get(projectId) || [];
      configs.set(projectId, [...existing, config]);

      return Promise.resolve({ ...config });
    }),
    update: jest.fn().mockImplementation((projectId: string, configId: string, data: UpdateRunConfigData) => {
      const projectConfigs = configs.get(projectId) || [];
      const index = projectConfigs.findIndex((c) => c.id === configId);

      if (index === -1) return Promise.resolve(null);

      const existing = projectConfigs[index]!;
      const updated: RunConfig = {
        ...existing,
        ...data,
        updatedAt: new Date().toISOString(),
      };
      projectConfigs[index] = updated;

      return Promise.resolve({ ...updated });
    }),
    delete: jest.fn().mockImplementation((projectId: string, configId: string) => {
      const projectConfigs = configs.get(projectId) || [];
      const filtered = projectConfigs.filter((c) => c.id !== configId);

      if (filtered.length === projectConfigs.length) return Promise.resolve(false);
      configs.set(projectId, filtered);

      return Promise.resolve(true);
    }),
  };
}

// ============================================================================
// Run Config Import Service Mock
// ============================================================================

import { RunConfigImportService } from '../../../src/services/run-config/import-types';

export function createMockRunConfigImportService(): jest.Mocked<RunConfigImportService> {
  return {
    scan: jest.fn().mockResolvedValue({ projectPath: '/test', importable: [] }),
  };
}

// ============================================================================
// Run Process Manager Mock
// ============================================================================

import {
  RunProcessManager,
  RunProcessStatus,
} from '../../../src/services/run-config/run-process-types';

export function createMockRunProcessManager(): jest.Mocked<RunProcessManager> {
  const emitter = new EventEmitter();
  const statuses = new Map<string, Map<string, RunProcessStatus>>();

  return {
    start: jest.fn().mockImplementation((projectId: string, _projectPath: string, configId: string) => {
      const status: RunProcessStatus = {
        configId,
        state: 'running',
        pid: Math.floor(Math.random() * 10000) + 1000,
        startedAt: new Date().toISOString(),
        uptimeMs: 0,
        exitCode: null,
        restartCount: 0,
        error: null,
      };

      if (!statuses.has(projectId)) statuses.set(projectId, new Map());
      statuses.get(projectId)!.set(configId, status);

      return Promise.resolve(status);
    }),
    stop: jest.fn().mockImplementation((projectId: string, configId: string) => {
      const projectStatuses = statuses.get(projectId);

      if (projectStatuses) {
        const status = projectStatuses.get(configId);

        if (status) {
          status.state = 'stopped';
          status.pid = null;
        }
      }

      return Promise.resolve();
    }),
    stopAll: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn().mockImplementation((projectId: string, configId: string) => {
      const status = statuses.get(projectId)?.get(configId);

      return status || {
        configId,
        state: 'stopped',
        pid: null,
        startedAt: null,
        uptimeMs: null,
        exitCode: null,
        restartCount: 0,
        error: null,
      };
    }),
    getAllStatuses: jest.fn().mockImplementation((projectId: string) => {
      const projectStatuses = statuses.get(projectId);

      if (!projectStatuses) return [];
      return Array.from(projectStatuses.values());
    }),
    shutdown: jest.fn().mockResolvedValue(undefined),
    on: jest.fn().mockImplementation((event: string, listener: (...args: unknown[]) => void) => {
      emitter.on(event, listener);
    }),
    off: jest.fn().mockImplementation((event: string, listener: (...args: unknown[]) => void) => {
      emitter.off(event, listener);
    }),
  };
}

export function createTestRunConfiguration(overrides?: Partial<RunConfig>): RunConfig {
  return {
    ...sampleRunConfiguration,
    ...overrides,
    id: overrides?.id || `rc-${Date.now()}`,
  };
}

// ============================================================================
// Inventify Service Mock
// ============================================================================

import { InventifyService, InventifyResult } from '../../../src/services/inventify-types';

// ============================================================================
// Docker Service Mocks
// ============================================================================

import {
  DockerService,
  DockerCommandRunner,
  DockerAvailability,
  ContainerInfo,
  ContainerManager,
  EnsureContainerResult,
  ImageManager,
} from '../../../src/services/docker/types';

export const sampleDockerAvailability: DockerAvailability = {
  installed: true,
  version: '24.0.7',
  running: true,
  error: null,
};

export const sampleContainerInfo: ContainerInfo = {
  containerId: 'abc123def456',
  projectId: '123e4567-e89b-12d3-a456-426614174000',
  status: 'running',
  imageName: 'claudito-agent:latest',
  createdAt: '2024-01-01T00:00:00.000Z',
  resourceUsage: null,
};

export function createMockDockerCommandRunner(): jest.Mocked<DockerCommandRunner> {
  return {
    exec: jest.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    spawn: jest.fn().mockReturnValue(new EventEmitter() as any),
  };
}

export function createMockDockerService(): jest.Mocked<DockerService> {
  return {
    checkAvailability: jest.fn().mockResolvedValue({ ...sampleDockerAvailability }),
    buildImage: jest.fn().mockResolvedValue(undefined),
    createContainer: jest.fn().mockResolvedValue('abc123def456'),
    startContainer: jest.fn().mockResolvedValue(undefined),
    stopContainer: jest.fn().mockResolvedValue(undefined),
    removeContainer: jest.fn().mockResolvedValue(undefined),
    getContainerStatus: jest.fn().mockResolvedValue({ ...sampleContainerInfo }),
    getResourceUsage: jest.fn().mockResolvedValue(null),
    isContainerRunning: jest.fn().mockResolvedValue(true),
    listContainers: jest.fn().mockResolvedValue([{ ...sampleContainerInfo }]),
    copyToContainer: jest.fn().mockResolvedValue(undefined),
    execInContainer: jest.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  };
}

import { FileSystemChecker } from '../../../src/services/docker/container-manager';

export function createMockFileSystemChecker(exists = true): jest.Mocked<FileSystemChecker> {
  return {
    directoryExists: jest.fn().mockReturnValue(exists),
    fileExists: jest.fn().mockReturnValue(exists),
    listEntries: jest.fn().mockReturnValue(['.credentials.json', 'projects', 'settings.json']),
  };
}

export function createMockContainerManager(): jest.Mocked<ContainerManager> {
  const defaultResult: EnsureContainerResult = {
    containerId: 'abc123def456',
    imageName: 'claudito-agent:latest',
    wasCreated: false,
    wasRestarted: false,
  };

  return {
    ensureContainer: jest.fn().mockResolvedValue(defaultResult),
    stopProjectContainer: jest.fn().mockResolvedValue(undefined),
    stopAllContainers: jest.fn().mockResolvedValue(undefined),
    getContainerForProject: jest.fn().mockReturnValue(null),
    getProjectContainers: jest.fn().mockResolvedValue([]),
    isHealthy: jest.fn().mockResolvedValue(true),
  };
}

export function createMockImageManager(): jest.Mocked<ImageManager> {
  return {
    listImages: jest.fn().mockResolvedValue([]),
    buildImage: jest.fn().mockResolvedValue(undefined),
    buildImageStreaming: jest.fn().mockResolvedValue(undefined),
    removeImage: jest.fn().mockResolvedValue(undefined),
    getAvailableVariants: jest.fn().mockReturnValue([]),
  };
}

// ============================================================================
// Inventify Service Mock
// ============================================================================

export function createMockInventifyService(): jest.Mocked<InventifyService> {
  return {
    start: jest.fn().mockResolvedValue({
      oneOffId: 'inventify-oneoff-id',
      placeholderProjectId: 'inventify-project-id',
    } as InventifyResult),
    isRunning: jest.fn().mockReturnValue(false),
    getIdeas: jest.fn().mockReturnValue(null),
    suggestNames: jest.fn().mockResolvedValue({
      oneOffId: 'inventify-names-oneoff-id',
      placeholderProjectId: 'inventify-project-id',
    } as InventifyResult),
    getNameSuggestions: jest.fn().mockReturnValue(null),
    selectIdea: jest.fn().mockResolvedValue({
      placeholderProjectId: 'inventify-project-id',
      newProjectId: 'inventify-new-project-id',
      prompt: 'Build plan prompt...',
    } as InventifyResult),
    completeBuild: jest.fn().mockResolvedValue(undefined),
    getBuildResult: jest.fn().mockReturnValue(null),
    cancel: jest.fn().mockResolvedValue(undefined),
  };
}

// ============================================================================
// Claude CLI Service Mock
// ============================================================================

import { ClaudeCliService, ClaudeCliInfo } from '../../../src/services/claude-cli-service';

export const sampleClaudeCliInfo: ClaudeCliInfo = {
  installed: true,
  version: '1.0.18',
  auth: {
    loggedIn: true,
    authMethod: 'claude.ai',
    apiProvider: 'firstParty',
    email: 'test@example.com',
    orgId: 'org-123',
    orgName: null,
    subscriptionType: 'max',
  },
  error: null,
};

export function createMockClaudeCliService(): jest.Mocked<ClaudeCliService> {
  return {
    getInfo: jest.fn().mockResolvedValue({ ...sampleClaudeCliInfo }),
  };
}
