import fs from 'fs';
import path from 'path';
import { generateUUID } from '../utils/uuid';
import {
  ClaudeAgent,
  DefaultClaudeAgent,
  AgentMessage,
  AgentStatus,
  AgentMode,
  ProcessInfo,
  ContextUsage,
  PermissionConfig,
  AgentLimits,
  AgentStreamingOptions,
  WaitingStatus,
  ProcessSpawner,
} from './claude-agent';
import { defaultSpawner } from './process-manager';
import { DefaultPermissionGenerator, PermissionGenerator } from '../services/permission-generator';
import {
  ProjectRepository,
  ConversationRepository,
  SettingsRepository,
  McpServerConfig,
  McpOverrides,
  ProjectStatus,
} from '../repositories';
import { InstructionGenerator, RoadmapParser } from '../services';
import { ContainerManager } from '../services/docker/types';
import { DockerProcessSpawner } from '../services/docker/docker-process-spawner';
import { getLogger, Logger } from '../utils';
import { DEFAULT_MODEL } from '../config/models';

// Import new modules
import { AgentQueue, QueuedProject } from './agent-queue';
import { SessionManager } from './session-manager';
import {
  AutonomousLoopOrchestrator,
  MilestoneRef,
  LoopState as AgentLoopState,
  AgentCompletionResponse
} from './autonomous-loop-orchestrator';
import { ProcessTracker, TrackedProcessInfo, OrphanCleanupResult } from './process-tracker';

// Re-export types for testing
export { QueuedProject } from './agent-queue';
export { LoopState as AgentLoopState } from './autonomous-loop-orchestrator';
export { TrackedProcessInfo, OrphanCleanupResult } from './process-tracker';

export interface OneOffAgentOptions {
  projectId: string;
  message: string;
  permissionMode?: 'acceptEdits' | 'plan';
  label?: string;
}

export interface OneOffMeta {
  projectId: string;
  label: string;
}

export interface AgentManagerEvents {
  message: (projectId: string, message: AgentMessage) => void;
  status: (projectId: string, status: AgentStatus) => void;
  waitingForInput: (projectId: string, waitingStatus: WaitingStatus) => void;
  queueChange: (queue: QueuedProject[]) => void;
  milestoneStarted: (projectId: string, milestone: MilestoneRef) => void;
  milestoneCompleted: (projectId: string, milestone: MilestoneRef, reason: string) => void;
  milestoneFailed: (projectId: string, milestone: MilestoneRef | null, reason: string) => void;
  loopCompleted: (projectId: string) => void;
  sessionRecovery: (projectId: string, oldConversationId: string, newConversationId: string, reason: string) => void;
  oneOffMessage: (oneOffId: string, message: AgentMessage) => void;
  oneOffStatus: (oneOffId: string, status: AgentStatus) => void;
  oneOffWaiting: (oneOffId: string, isWaiting: boolean, version: number) => void;
  dockerFallbackWarning: (projectId: string, reason: string) => void;
}

export interface AgentResourceStatus {
  runningCount: number;
  maxConcurrent: number;
  queuedCount: number;
  queuedProjects: QueuedProject[];
}

export interface ImageData {
  type: string; // MIME type, e.g., 'image/png'
  data: string; // Base64 encoded image data
}

export interface StartInteractiveAgentOptions {
  initialMessage?: string;
  images?: ImageData[];
  sessionId?: string;
  permissionMode?: 'acceptEdits' | 'plan';
  /** If true, use --session-id to create new session. If false/undefined, use --resume for existing sessions. */
  isNewSession?: boolean;
}

export interface StartAgentResult {
  containerRestarted: boolean;
  containerImageName?: string;
  dockerFallback: boolean;
  dockerFallbackReason?: string;
}

export interface FullAgentStatus {
  status: AgentStatus;
  mode: AgentMode | null;
  queued: boolean;
  queuedMessageCount: number;
  isWaitingForInput: boolean;
  waitingVersion: number;
  sessionId: string | null;
  permissionMode: 'acceptEdits' | 'plan' | null;
}

export interface AgentManager {
  startAgent(projectId: string, instructions: string): Promise<void>;
  startInteractiveAgent(projectId: string, options?: StartInteractiveAgentOptions): Promise<StartAgentResult>;
  sendInput(projectId: string, input: string, images?: ImageData[]): void;
  sendToolResult(projectId: string, toolUseId: string, content: string): void;
  stopAgent(projectId: string): Promise<void>;
  stopAllAgents(): Promise<void>;
  getAgentStatus(projectId: string): AgentStatus;
  getAgentMode(projectId: string): AgentMode | null;
  isRunning(projectId: string): boolean;
  isQueued(projectId: string): boolean;
  isWaitingForInput(projectId: string): boolean;
  getWaitingVersion(projectId: string): number;
  getResourceStatus(): AgentResourceStatus;
  removeFromQueue(projectId: string): void;
  setMaxConcurrentAgents(max: number): void;
  startAutonomousLoop(projectId: string): Promise<void>;
  stopAutonomousLoop(projectId: string): void;
  getLoopState(projectId: string): AgentLoopState | null;
  getLastCommand(projectId: string): string | null;
  getProcessInfo(projectId: string): ProcessInfo | null;
  getContextUsage(projectId: string): ContextUsage | null;
  getQueuedMessageCount(projectId: string): number;
  getQueuedMessages(projectId: string): string[];
  removeQueuedMessage(projectId: string, index: number): boolean;
  getSessionId(projectId: string): string | null;
  getFullStatus(projectId: string): FullAgentStatus;
  getTrackedProcesses(): TrackedProcessInfo[];
  cleanupOrphanProcesses(): Promise<OrphanCleanupResult>;
  restartAllRunningAgents(): Promise<void>;
  restartProjectAgent(projectId: string): Promise<void>;
  getRunningProjectIds(): string[];
  startOneOffAgent(options: OneOffAgentOptions): Promise<string>;
  stopOneOffAgent(oneOffId: string): Promise<void>;
  getOneOffMeta(oneOffId: string): OneOffMeta | null;
  sendOneOffInput(oneOffId: string, input: string, images?: ImageData[]): void;
  getOneOffStatus(oneOffId: string): FullAgentStatus | null;
  getOneOffContextUsage(oneOffId: string): ContextUsage | null;
  isOneOffWaitingForInput(oneOffId: string): boolean;
  getOneOffCollectedOutput(oneOffId: string): string | null;
  on<K extends keyof AgentManagerEvents>(event: K, listener: AgentManagerEvents[K]): void;
  off<K extends keyof AgentManagerEvents>(event: K, listener: AgentManagerEvents[K]): void;
}

export interface AgentFactoryOptions {
  projectId: string;
  projectPath: string;
  mode: AgentMode;
  permissions?: PermissionConfig;
  limits?: AgentLimits;
  streaming?: AgentStreamingOptions;
  sessionId?: string;
  isNewSession?: boolean;
  /** Claude model to use (e.g., 'claude-opus-4-6') */
  model?: string;
  mcpServers?: McpServerConfig[];
  /** Enable Chrome browser usage */
  chromeEnabled?: boolean;
  /** Custom process spawner (e.g., DockerProcessSpawner for sandboxed execution) */
  processSpawner?: ProcessSpawner;
}

export interface AgentFactory {
  create(options: AgentFactoryOptions): ClaudeAgent;
}

const defaultAgentFactory: AgentFactory = {
  create: (options) => new DefaultClaudeAgent(options),
};

export interface AgentManagerDependencies {
  projectRepository: ProjectRepository;
  conversationRepository: ConversationRepository;
  settingsRepository: SettingsRepository;
  instructionGenerator: InstructionGenerator;
  roadmapParser: RoadmapParser;
  agentFactory?: AgentFactory;
  permissionGenerator?: PermissionGenerator;
  containerManager?: ContainerManager;
  maxConcurrentAgents?: number;
}

type EventListeners = {
  [K in keyof AgentManagerEvents]: Set<AgentManagerEvents[K]>;
};

/**
 * Manages Claude agents across multiple projects.
 * Refactored to use focused modules for queue, session, loop, and process management.
 */
export class DefaultAgentManager implements AgentManager {
  private readonly agents: Map<string, ClaudeAgent> = new Map();
  private readonly oneOffAgents: Map<string, ClaudeAgent> = new Map();
  private readonly oneOffMeta: Map<string, OneOffMeta> = new Map();
  private readonly agentQueue: AgentQueue;
  private readonly sessionManager: SessionManager;
  private readonly loopOrchestrator: AutonomousLoopOrchestrator;
  private readonly processTracker: ProcessTracker;

  private readonly projectRepository: ProjectRepository;
  private readonly conversationRepository: ConversationRepository;
  private readonly settingsRepository: SettingsRepository;
  private readonly instructionGenerator: InstructionGenerator;
  private readonly roadmapParser: RoadmapParser;
  private readonly agentFactory: AgentFactory;
  private readonly permissionGenerator: PermissionGenerator;
  private readonly containerManager: ContainerManager | null;
  private readonly logger: Logger;
  private readonly pendingMessageSaves: Set<Promise<unknown>> = new Set();
  private readonly listeners: EventListeners = {
    message: new Set(),
    status: new Set(),
    waitingForInput: new Set(),
    queueChange: new Set(),
    milestoneStarted: new Set(),
    milestoneCompleted: new Set(),
    milestoneFailed: new Set(),
    loopCompleted: new Set(),
    sessionRecovery: new Set(),
    oneOffMessage: new Set(),
    oneOffStatus: new Set(),
    oneOffWaiting: new Set(),
    dockerFallbackWarning: new Set(),
  };
  private waitingVersions: Map<string, number> = new Map();
  private oneOffWaitingVersions: Map<string, number> = new Map();
  private queuedMessages: Map<string, string[]> = new Map();
  private pendingPlans: Map<string, { planContent: string; sessionId: string | null }> = new Map();
  private _maxConcurrentAgents: number;

  constructor({
    projectRepository,
    conversationRepository,
    settingsRepository,
    instructionGenerator,
    roadmapParser,
    agentFactory = defaultAgentFactory,
    permissionGenerator,
    containerManager,
    maxConcurrentAgents = 3,
  }: AgentManagerDependencies) {
    this.projectRepository = projectRepository;
    this.conversationRepository = conversationRepository;
    this.settingsRepository = settingsRepository;
    this.instructionGenerator = instructionGenerator;
    this.roadmapParser = roadmapParser;
    this.agentFactory = agentFactory;
    this.permissionGenerator = permissionGenerator || new DefaultPermissionGenerator();
    this.containerManager = containerManager || null;
    this._maxConcurrentAgents = maxConcurrentAgents;
    this.logger = getLogger('agent-manager');

    // Initialize modules
    this.agentQueue = new AgentQueue();
    this.sessionManager = new SessionManager(projectRepository, conversationRepository);
    this.loopOrchestrator = new AutonomousLoopOrchestrator(
      projectRepository,
      conversationRepository,
      instructionGenerator,
      roadmapParser
    );
    this.processTracker = new ProcessTracker();

    // Forward events from modules
    this.setupModuleEventForwarding();
  }

  private setupModuleEventForwarding(): void {
    // Forward queue events
    this.agentQueue.on('queueChange', (queue) => {
      this.emit('queueChange', queue);
    });

    // Forward session events
    this.sessionManager.on('sessionRecovery', (projectId, oldId, newId, reason) => {
      this.emit('sessionRecovery', projectId, oldId, newId, reason);
    });

    // Forward loop events
    this.loopOrchestrator.on('milestoneStarted', (projectId, milestone) => {
      this.emit('milestoneStarted', projectId, milestone);
    });
    this.loopOrchestrator.on('milestoneCompleted', (projectId, milestone, reason) => {
      this.emit('milestoneCompleted', projectId, milestone, reason);
    });
    this.loopOrchestrator.on('milestoneFailed', (projectId, milestone, reason) => {
      this.emit('milestoneFailed', projectId, milestone, reason);
    });
    this.loopOrchestrator.on('loopCompleted', (projectId) => {
      this.emit('loopCompleted', projectId);
    });
  }

  private get maxConcurrentAgents(): number {
    return this._maxConcurrentAgents;
  }

  async startAgent(projectId: string, instructions: string): Promise<void> {
    if (this.agents.has(projectId)) {
      throw new Error('Agent is already running for this project');
    }

    if (this.agentQueue.isQueued(projectId)) {
      throw new Error('Agent is already queued for this project');
    }

    if (this.agents.size >= this.maxConcurrentAgents) {
      this.addToQueue(projectId, instructions);
      return;
    }

    await this.startAgentImmediately(projectId, instructions, 'autonomous');
  }

  async startInteractiveAgent(projectId: string, options?: StartInteractiveAgentOptions): Promise<StartAgentResult> {
    if (this.agents.has(projectId)) {
      throw new Error('Agent is already running for this project');
    }

    if (this.agentQueue.isQueued(projectId)) {
      throw new Error('Agent is already queued for this project');
    }

    const project = await this.projectRepository.findById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // Handle session management
    const sessionResult = await this.sessionManager.getOrCreateSession(
      projectId,
      options?.sessionId,
      options?.isNewSession
    );

    // Prepare initial instructions if provided
    let initialInstructions: string | undefined;
    if (options?.initialMessage) {
      if (options.images && options.images.length > 0) {
        initialInstructions = this.buildMultimodalContent(options.initialMessage, options.images);
      } else {
        initialInstructions = options.initialMessage;
      }
    }

    // Get settings
    const settings = await this.settingsRepository.get();
    const projectOverrides = project.permissionOverrides ?? null;

    // Get model
    const model = await this.getModelForProject(projectId);

    // Get enabled MCP servers
    const globalMcpServers = settings.mcp?.enabled
      ? (settings.mcp.servers || []).filter((server) => server.enabled)
      : [];

    // Apply per-project MCP overrides
    const mcpServers = this.applyMcpOverrides(globalMcpServers, project.mcpOverrides);

    // Generate permission config with MCP servers
    const permArgs = this.permissionGenerator.generateArgs(settings.claudePermissions, projectOverrides, mcpServers);

    const effectiveMode = options?.permissionMode || permArgs.permissionMode;
    const shouldSkip = effectiveMode !== 'plan' &&
      (permArgs.skipPermissions || settings.claudePermissions.dangerouslySkipPermissions);

    const permissionConfig: PermissionConfig = {
      skipPermissions: shouldSkip,
      allowedTools: shouldSkip ? [] : permArgs.allowedTools,
      disallowedTools: shouldSkip ? [] : permArgs.disallowedTools,
      permissionMode: effectiveMode,
    };

    // Docker sandboxed execution (pass per-project image if set)
    const dockerResult = await this.getDockerProcessSpawner(
      projectId,
      project.path,
      project.dockerImage ?? undefined,
    );

    // If container was recreated and this is a resume, force new session
    let effectiveSessionResult = sessionResult;
    if (dockerResult.containerWasRecreated && !sessionResult.isNewSession) {
      this.logger.warn('Container was recreated, forcing new session', { projectId });
      effectiveSessionResult = await this.sessionManager.getOrCreateSession(projectId, undefined, true);
    }

    // Create agent
    const agent = this.agentFactory.create({
      projectId,
      projectPath: project.path,
      mode: 'interactive',
      permissions: permissionConfig,
      sessionId: effectiveSessionResult.sessionId,
      isNewSession: effectiveSessionResult.isNewSession,
      model,
      mcpServers,
      chromeEnabled: settings.chromeEnabled ?? false,
      processSpawner: dockerResult.processSpawner,
    });

    // Store agent
    this.agents.set(projectId, agent);
    this.setupAgentListeners(agent);

    // Track process when it starts
    const statusHandler = (status: AgentStatus): void => {
      if (status === 'running' && agent.processInfo) {
        const processInfo = agent.processInfo;
        this.processTracker.trackProcess(projectId, processInfo.pid);
        // Remove listener after first call
        agent.off('status', statusHandler);
      }
    };
    agent.on('status', statusHandler);

    // Start agent
    agent.start(initialInstructions || '');

    return {
      containerRestarted: dockerResult.containerWasRecreated,
      containerImageName: dockerResult.containerImageName,
      dockerFallback: dockerResult.dockerFallback,
      dockerFallbackReason: dockerResult.dockerFallbackReason,
    };
  }

  private buildMultimodalContent(text: string, images?: ImageData[]): string {
    if (!images || images.length === 0) {
      return text;
    }

    // Build Claude API-compatible JSON content blocks
    const contentBlocks: Array<
      | { type: 'image'; source: { type: string; media_type: string; data: string } }
      | { type: 'text'; text: string }
    > = [];

    // Add images first
    for (const image of images) {
      contentBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: image.type,
          data: image.data
        }
      });
    }

    // Add text last
    if (text) {
      contentBlocks.push({
        type: 'text',
        text: text
      });
    }

    return JSON.stringify(contentBlocks);
  }

  sendInput(projectId: string, input: string, images?: ImageData[]): void {
    const agent = this.agents.get(projectId);
    if (!agent) {
      throw new Error('No agent running for this project');
    }

    if (agent.mode !== 'interactive') {
      throw new Error('Agent is not in interactive mode');
    }

    // Check if this is a response to a pending plan approval
    const pendingPlan = this.pendingPlans.get(projectId);
    if (pendingPlan && agent.isWaitingForInput) {
      // Handle plan approval response
      void this.handlePlanApprovalResponse(projectId, input, pendingPlan);
      return;
    }

    const contentToSend = images ? this.buildMultimodalContent(input, images) : input;

    // Save user message to conversation
    const conversationId = agent.sessionId;
    if (conversationId) {
      const userMessage: AgentMessage = {
        type: 'user',
        content: input, // Save original input without image data
        timestamp: new Date().toISOString(),
      };

      this.trackMessageSave(
        this.conversationRepository.addMessage(projectId, conversationId, userMessage)
      ).catch((err) => {
        this.logger.error('Failed to save user message to conversation', {
          projectId,
          conversationId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    agent.sendInput(contentToSend);
  }

  sendToolResult(projectId: string, toolUseId: string, content: string): void {
    const agent = this.agents.get(projectId);

    if (!agent) {
      throw new Error('No agent running for this project');
    }

    if (agent.mode !== 'interactive') {
      throw new Error('Agent is not in interactive mode');
    }

    agent.sendToolResult(toolUseId, content);
  }

  async stopAgent(projectId: string): Promise<void> {
    const agent = this.agents.get(projectId);
    if (!agent) {
      return;
    }

    await agent.stop();
    this.agents.delete(projectId);
    this.processTracker.untrackProcess(projectId);
    this.waitingVersions.delete(projectId);
    this.queuedMessages.delete(projectId);
  }

  async stopAllAgents(): Promise<void> {
    await this.flushPendingMessageSaves();

    const stopPromises = Array.from(this.agents.keys()).map((projectId) =>
      this.stopAgent(projectId)
    );

    await Promise.all(stopPromises);

    this.agentQueue.clear();
    this.loopOrchestrator.getRunningProjectIds().forEach((projectId) => {
      this.loopOrchestrator.stopLoop(projectId);
    });

    if (this.containerManager) {
      await this.containerManager.stopAllContainers();
    }
  }

  getAgentStatus(projectId: string): AgentStatus {
    const agent = this.agents.get(projectId);
    return agent ? agent.status : 'stopped';
  }

  getAgentMode(projectId: string): AgentMode | null {
    const agent = this.agents.get(projectId);
    return agent ? agent.mode : null;
  }

  isRunning(projectId: string): boolean {
    return this.agents.has(projectId);
  }

  isQueued(projectId: string): boolean {
    return this.agentQueue.isQueued(projectId);
  }

  isWaitingForInput(projectId: string): boolean {
    const agent = this.agents.get(projectId);
    return agent ? agent.isWaitingForInput : false;
  }

  getWaitingVersion(projectId: string): number {
    return this.waitingVersions.get(projectId) || 0;
  }

  getResourceStatus(): AgentResourceStatus {
    return {
      runningCount: this.agents.size,
      maxConcurrent: this.maxConcurrentAgents,
      queuedCount: this.agentQueue.getQueueLength(),
      queuedProjects: this.agentQueue.getQueue(),
    };
  }

  removeFromQueue(projectId: string): void {
    this.agentQueue.removeFromQueue(projectId);
  }

  setMaxConcurrentAgents(max: number): void {
    this._maxConcurrentAgents = Math.max(1, max);
    void this.processQueue();
  }

  async startAutonomousLoop(projectId: string): Promise<void> {
    const project = await this.projectRepository.findById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const milestone = await this.loopOrchestrator.startLoop({
      projectId,
      projectPath: project.path,
    });

    if (milestone) {
      await this.runMilestone(projectId, project.path, milestone);
    }
  }

  stopAutonomousLoop(projectId: string): void {
    this.loopOrchestrator.stopLoop(projectId);
  }

  getLoopState(projectId: string): AgentLoopState | null {
    return this.loopOrchestrator.getLoopState(projectId);
  }

  getLastCommand(projectId: string): string | null {
    const agent = this.agents.get(projectId);
    return agent ? agent.lastCommand : null;
  }

  getProcessInfo(projectId: string): ProcessInfo | null {
    const agent = this.agents.get(projectId);
    return agent ? agent.processInfo : null;
  }

  getContextUsage(projectId: string): ContextUsage | null {
    const agent = this.agents.get(projectId);
    return agent ? agent.contextUsage : null;
  }

  getQueuedMessageCount(projectId: string): number {
    const agent = this.agents.get(projectId);
    if (agent) {
      // If agent is running, get its queue count
      return agent.queuedMessageCount;
    }

    // If agent is not running, count messages in our queue
    const queuedMsg = this.queuedMessages.get(projectId);
    return (queuedMsg?.length || 0) + this.agentQueue.getQueuedMessageCount(projectId);
  }

  getQueuedMessages(projectId: string): string[] {
    const inMemory = this.queuedMessages.get(projectId) || [];
    const inQueue = this.agentQueue.getQueuedMessages(projectId);
    return [...inMemory, ...inQueue];
  }

  removeQueuedMessage(projectId: string, index: number): boolean {
    const agent = this.agents.get(projectId);
    if (agent) {
      // If agent is running, delegate to it
      return agent.removeQueuedMessage(index);
    }

    // If agent is not running, manage the queue ourselves
    const queuedMsg = this.queuedMessages.get(projectId);
    if (queuedMsg && index < queuedMsg.length) {
      queuedMsg.splice(index, 1);
      if (queuedMsg.length === 0) {
        this.queuedMessages.delete(projectId);
      }
      return true;
    }

    const adjustedIndex = index - (queuedMsg?.length || 0);
    return this.agentQueue.removeQueuedMessage(projectId, adjustedIndex);
  }

  getSessionId(projectId: string): string | null {
    const agent = this.agents.get(projectId);
    return agent ? agent.sessionId : null;
  }

  getFullStatus(projectId: string): FullAgentStatus {
    const agent = this.agents.get(projectId);

    return {
      status: this.getAgentStatus(projectId),
      mode: this.getAgentMode(projectId),
      queued: this.isQueued(projectId),
      queuedMessageCount: this.getQueuedMessageCount(projectId),
      isWaitingForInput: this.isWaitingForInput(projectId),
      waitingVersion: this.getWaitingVersion(projectId),
      sessionId: this.getSessionId(projectId),
      permissionMode: agent?.permissionMode || null,
    };
  }

  getTrackedProcesses(): TrackedProcessInfo[] {
    return this.processTracker.getTrackedProcesses();
  }

  async cleanupOrphanProcesses(): Promise<OrphanCleanupResult> {
    return await this.processTracker.cleanupOrphanProcesses();
  }

  async restartAllRunningAgents(): Promise<void> {
    const runningAgents = Array.from(this.agents.entries()).map(([projectId, agent]) => ({
      projectId,
      mode: agent.mode,
      sessionId: agent.sessionId,
      isNewSession: false,
      permissionMode: agent.permissionMode,
    }));

    this.logger.info('Restarting all running agents', {
      count: runningAgents.length,
      agents: runningAgents.map((a) => a.projectId),
    });

    // Stop all agents without clearing the loop states
    const stopPromises = runningAgents.map(({ projectId }) => this.stopAgent(projectId));
    await Promise.all(stopPromises);

    // Small delay to ensure clean shutdown
    await this.delay(1000);

    // Restart each agent
    for (const agent of runningAgents) {
      try {
        if (agent.mode === 'interactive') {
          await this.startInteractiveAgent(agent.projectId, {
            sessionId: agent.sessionId || undefined,
            isNewSession: agent.isNewSession,
            permissionMode: agent.permissionMode || undefined,
          });
        } else {
          // For autonomous agents, regenerate instructions from roadmap
          const project = await this.projectRepository.findById(agent.projectId);
          if (!project) {
            throw new Error(`Project not found: ${agent.projectId}`);
          }

          const roadmapPath = path.join(project.path, 'doc', 'ROADMAP.md');
          const roadmapExists = await fs.promises
            .access(roadmapPath)
            .then(() => true)
            .catch(() => false);

          if (!roadmapExists) {
            this.logger.warn('Cannot restart autonomous agent without roadmap', { projectId: agent.projectId });
            continue;
          }

          const roadmapContent = await fs.promises.readFile(roadmapPath, 'utf-8');
          const parsedRoadmap = this.roadmapParser.parse(roadmapContent);
          const instructions = this.instructionGenerator.generate(parsedRoadmap, project.name);

          await this.startAgent(agent.projectId, instructions);
        }

        this.logger.info('Successfully restarted agent', { projectId: agent.projectId });
      } catch (error) {
        this.logger.error('Failed to restart agent', {
          projectId: agent.projectId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  async restartProjectAgent(projectId: string): Promise<void> {
    const agent = this.agents.get(projectId);
    if (!agent || agent.status !== 'running') {
      this.logger.warn('Cannot restart agent that is not running', { projectId });
      return;
    }

    const agentInfo = {
      projectId,
      mode: agent.mode,
      sessionId: agent.sessionId,
      isNewSession: false,
      permissionMode: agent.permissionMode,
    };

    this.logger.info('Restarting project agent', { projectId });

    // Stop the agent
    await this.stopAgent(projectId);

    // Small delay to ensure clean shutdown
    await this.delay(1000);

    // Restart the agent
    try {
      if (agentInfo.mode === 'interactive') {
        await this.startInteractiveAgent(projectId, {
          sessionId: agentInfo.sessionId || undefined,
          isNewSession: agentInfo.isNewSession,
          permissionMode: agentInfo.permissionMode || undefined,
        });
      } else {
        // For autonomous agents, regenerate instructions from roadmap
        const project = await this.projectRepository.findById(projectId);
        if (!project) {
          throw new Error(`Project not found: ${projectId}`);
        }

        const roadmapPath = path.join(project.path, 'doc', 'ROADMAP.md');
        const roadmapExists = await fs.promises
          .access(roadmapPath)
          .then(() => true)
          .catch(() => false);

        if (!roadmapExists) {
          this.logger.warn('Cannot restart autonomous agent without roadmap', { projectId });
          return;
        }

        const roadmapContent = await fs.promises.readFile(roadmapPath, 'utf-8');
        const parsedRoadmap = this.roadmapParser.parse(roadmapContent);
        const instructions = this.instructionGenerator.generate(parsedRoadmap, project.name);

        await this.startAgent(projectId, instructions);
      }

      this.logger.info('Successfully restarted project agent', { projectId });
    } catch (error) {
      this.logger.error('Failed to restart project agent', {
        projectId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async startOneOffAgent(options: OneOffAgentOptions): Promise<string> {
    const project = await this.projectRepository.findById(options.projectId);

    if (!project) {
      throw new Error(`Project not found: ${options.projectId}`);
    }

    const oneOffId = `oneoff-${generateUUID()}`;

    this.logger.info('Starting one-off agent', {
      oneOffId,
      projectId: options.projectId,
    });

    const settings = await this.settingsRepository.get();
    const projectOverrides = project.permissionOverrides ?? null;
    const permArgs = this.permissionGenerator.generateArgs(settings.claudePermissions, projectOverrides);

    const effectiveOneOffMode = options.permissionMode || permArgs.permissionMode;
    const shouldSkipOneOff = effectiveOneOffMode !== 'plan' &&
      (permArgs.skipPermissions || settings.claudePermissions.dangerouslySkipPermissions);

    const permissionConfig: PermissionConfig = {
      skipPermissions: shouldSkipOneOff,
      allowedTools: shouldSkipOneOff ? [] : permArgs.allowedTools,
      disallowedTools: shouldSkipOneOff ? [] : permArgs.disallowedTools,
      permissionMode: effectiveOneOffMode,
    };

    const model = await this.getModelForProject(options.projectId);

    // Docker sandboxed execution
    const dockerResult = await this.getDockerProcessSpawner(
      options.projectId,
      project.path,
      project.dockerImage ?? undefined,
    );

    if (dockerResult.dockerFallback) {
      this.emit('dockerFallbackWarning', options.projectId, dockerResult.dockerFallbackReason || 'Unknown error');
    }

    const agent = this.agentFactory.create({
      projectId: options.projectId,
      projectPath: project.path,
      mode: 'interactive',
      permissions: permissionConfig,
      model,
      chromeEnabled: settings.chromeEnabled ?? false,
      processSpawner: dockerResult.processSpawner,
    });

    this.oneOffAgents.set(oneOffId, agent);
    this.oneOffMeta.set(oneOffId, {
      projectId: options.projectId,
      label: options.label || 'One-off Agent',
    });
    this.setupOneOffAgentListeners(oneOffId, agent);
    agent.start(options.message);

    return oneOffId;
  }

  async stopOneOffAgent(oneOffId: string): Promise<void> {
    const agent = this.oneOffAgents.get(oneOffId);

    if (!agent) {
      return;
    }

    await agent.stop();
    this.oneOffAgents.delete(oneOffId);
    this.oneOffMeta.delete(oneOffId);
    this.oneOffWaitingVersions.delete(oneOffId);
  }

  getOneOffMeta(oneOffId: string): OneOffMeta | null {
    return this.oneOffMeta.get(oneOffId) || null;
  }

  sendOneOffInput(oneOffId: string, input: string, images?: ImageData[]): void {
    const agent = this.oneOffAgents.get(oneOffId);

    if (!agent) {
      throw new Error(`No one-off agent found: ${oneOffId}`);
    }

    const contentToSend = images ? this.buildMultimodalContent(input, images) : input;
    agent.sendInput(contentToSend);
  }

  getOneOffStatus(oneOffId: string): FullAgentStatus | null {
    const agent = this.oneOffAgents.get(oneOffId);

    if (!agent) {
      return null;
    }

    return {
      status: agent.status,
      mode: agent.mode,
      queued: false,
      queuedMessageCount: agent.queuedMessageCount,
      isWaitingForInput: agent.isWaitingForInput,
      waitingVersion: this.oneOffWaitingVersions.get(oneOffId) || 0,
      sessionId: agent.sessionId,
      permissionMode: agent.permissionMode || null,
    };
  }

  getOneOffContextUsage(oneOffId: string): ContextUsage | null {
    const agent = this.oneOffAgents.get(oneOffId);
    return agent ? agent.contextUsage : null;
  }

  isOneOffWaitingForInput(oneOffId: string): boolean {
    const agent = this.oneOffAgents.get(oneOffId);
    return agent ? agent.isWaitingForInput : false;
  }

  getOneOffCollectedOutput(oneOffId: string): string | null {
    const agent = this.oneOffAgents.get(oneOffId);
    return agent ? agent.collectedOutput : null;
  }

  private setupOneOffAgentListeners(oneOffId: string, agent: ClaudeAgent): void {
    agent.on('message', (message: AgentMessage) => {
      this.emit('oneOffMessage', oneOffId, message);
    });

    agent.on('status', (status: AgentStatus) => {
      this.emit('oneOffStatus', oneOffId, status);
    });

    agent.on('waitingForInput', (waitingStatus: WaitingStatus) => {
      if (waitingStatus.isWaiting) {
        this.oneOffWaitingVersions.set(oneOffId, waitingStatus.version);
      }

      this.emit('oneOffWaiting', oneOffId, waitingStatus.isWaiting, waitingStatus.version);
    });

    agent.on('exit', () => {
      this.oneOffAgents.delete(oneOffId);
      this.oneOffMeta.delete(oneOffId);
      this.oneOffWaitingVersions.delete(oneOffId);
    });
  }

  getRunningProjectIds(): string[] {
    return Array.from(this.agents.keys());
  }

  on<K extends keyof AgentManagerEvents>(event: K, listener: AgentManagerEvents[K]): void {
    this.listeners[event].add(listener);
  }

  off<K extends keyof AgentManagerEvents>(event: K, listener: AgentManagerEvents[K]): void {
    this.listeners[event].delete(listener);
  }

  // Private helper methods

  private async runMilestone(
    projectId: string,
    projectPath: string,
    milestone: MilestoneRef
  ): Promise<void> {
    const project = await this.projectRepository.findById(projectId);
    if (!project) {
      this.logger.error('Project not found during milestone run', { projectId });
      return;
    }

    const instructions = this.loopOrchestrator.generateMilestoneInstructions(
      projectId,
      project.name,
      milestone
    );

    // Create new conversation for this milestone
    const conversation = await this.conversationRepository.create(projectId, null);

    await this.projectRepository.setCurrentConversation(projectId, conversation.id);
    this.loopOrchestrator.setCurrentMilestone(projectId, milestone, conversation.id);

    await this.startMilestoneAgent(projectId, projectPath, instructions, milestone);
  }

  private async startMilestoneAgent(
    projectId: string,
    projectPath: string,
    instructions: string,
    milestoneRef: MilestoneRef
  ): Promise<void> {
    this.logger.info('Starting milestone agent', {
      projectId,
      milestone: milestoneRef.milestoneId,
    });

    await this.startAgentImmediately(projectId, instructions, 'autonomous', milestoneRef);
  }

  private async startAgentImmediately(
    projectId: string,
    instructions: string,
    mode: AgentMode,
    milestoneRef?: MilestoneRef
  ): Promise<void> {
    const project = await this.projectRepository.findById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    this.logger.info('Starting agent immediately', {
      projectId,
      mode,
      milestone: milestoneRef?.milestoneId,
    });

    const conversationId = project.currentConversationId;
    if (!conversationId) {
      throw new Error('No current conversation for project');
    }

    const settings = await this.settingsRepository.get();
    const projectOverrides = project.permissionOverrides ?? null;
    const permArgs = this.permissionGenerator.generateArgs(settings.claudePermissions, projectOverrides);

    const shouldSkipAuto = permArgs.permissionMode !== 'plan' &&
      (permArgs.skipPermissions || settings.claudePermissions.dangerouslySkipPermissions);

    const permissionConfig: PermissionConfig = {
      skipPermissions: shouldSkipAuto,
      allowedTools: shouldSkipAuto ? [] : permArgs.allowedTools,
      disallowedTools: shouldSkipAuto ? [] : permArgs.disallowedTools,
      permissionMode: permArgs.permissionMode,
    };

    const model = await this.getModelForProject(projectId);

    // Get enabled MCP servers
    const globalMcpServers = settings.mcp?.enabled
      ? (settings.mcp.servers || []).filter((server) => server.enabled)
      : [];

    // Apply per-project MCP overrides
    const mcpServers = this.applyMcpOverrides(globalMcpServers, project.mcpOverrides);

    // Docker sandboxed execution
    const dockerResult = await this.getDockerProcessSpawner(
      projectId,
      project.path,
      project.dockerImage ?? undefined,
    );

    if (dockerResult.dockerFallback) {
      this.emit('dockerFallbackWarning', projectId, dockerResult.dockerFallbackReason || 'Unknown error');
    }

    const agent = this.agentFactory.create({
      projectId,
      projectPath: project.path,
      mode,
      permissions: permissionConfig,
      sessionId: conversationId,
      isNewSession: false,
      model,
      mcpServers,
      chromeEnabled: settings.chromeEnabled ?? false,
      processSpawner: dockerResult.processSpawner,
    });

    this.agents.set(projectId, agent);
    this.setupAgentListeners(agent);

    // Track process when it starts
    const statusHandler = (status: AgentStatus): void => {
      if (status === 'running' && agent.processInfo) {
        const processInfo = agent.processInfo;
        this.processTracker.trackProcess(projectId, processInfo.pid);
        // Remove listener after first call
        agent.off('status', statusHandler);
      }
    };
    agent.on('status', statusHandler);

    agent.start(instructions);
  }

  private addToQueue(projectId: string, instructions: string): void {
    this.logger.info('Adding project to queue', {
      projectId,
      queuePosition: this.agentQueue.getQueueLength() + 1,
    });

    this.agentQueue.enqueue(projectId, instructions);
  }

  private async processQueue(): Promise<void> {
    if (this.agents.size >= this.maxConcurrentAgents) {
      return;
    }

    const queued = this.agentQueue.dequeue();
    if (!queued) {
      return;
    }

    try {
      await this.startAgentImmediately(queued.projectId, queued.instructions, 'autonomous');
    } catch (error) {
      this.logger.error('Failed to start queued agent', {
        projectId: queued.projectId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // Process next in queue
    void this.processQueue();
  }

  private async getModelForProject(projectId: string): Promise<string> {
    const project = await this.projectRepository.findById(projectId);
    if (!project || !project.modelOverride) {
      return DEFAULT_MODEL;
    }
    return project.modelOverride;
  }

  private trackMessageSave<T>(promise: Promise<T>): Promise<T> {
    this.pendingMessageSaves.add(promise);
    void promise.finally(() => this.pendingMessageSaves.delete(promise));
    return promise;
  }

  private async flushPendingMessageSaves(): Promise<void> {
    if (this.pendingMessageSaves.size > 0) {
      this.logger.info('Waiting for pending message saves', { count: this.pendingMessageSaves.size });
      await Promise.allSettled(this.pendingMessageSaves);
    }
    // Flush the conversation repository
    await this.conversationRepository.flush();
  }

  private setupAgentListeners(agent: ClaudeAgent): void {
    const projectId = agent.projectId;

    const messageListener = (message: AgentMessage): void => {
      this.emit('message', projectId, message);

      // Get conversation ID - it should equal session ID
      const conversationId = agent.sessionId;
      if (conversationId) {
        // Save assistant messages to conversation
        // Only save specific message types that represent assistant output
        if (message.type === 'stdout' || message.type === 'tool_use' || message.type === 'tool_result') {
          // These are assistant messages
          this.trackMessageSave(
            this.conversationRepository.addMessage(projectId, conversationId, message)
          ).catch((err) => {
            this.logger.error('Failed to save assistant message to conversation', {
              projectId,
              conversationId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      }

      // For autonomous mode, check for completion
      if (agent.mode === 'autonomous' && (message.type === 'stdout' || message.type === 'result')) {
        const response = this.loopOrchestrator.parseAgentResponse(message.content);
        if (response) {
          void this.handleAgentCompletionResponse(projectId, response);
        }
      }
    };

    const statusListener = (status: AgentStatus): void => {
      void this.handleStatusChange(projectId, status);
    };

    const waitingListener = (status: WaitingStatus): void => {
      // Store the waiting version
      if (status.isWaiting) {
        this.waitingVersions.set(projectId, status.version);
      }

      this.emit('waitingForInput', projectId, status);
    };

    const exitListener = (code: number | null): void => {
      void this.handleAgentExit(agent, code);
    };

    const sessionNotFoundListener = (sessionId: string): void => {
      void this.handleSessionNotFound(agent, sessionId);
    };

    const exitPlanModeListener = (planContent: string): void => {
      void this.handleExitPlanMode(agent, planContent);
    };

    const enterPlanModeListener = (): void => {
      void this.handleEnterPlanMode(agent);
    };

    agent.on('message', messageListener);
    agent.on('status', statusListener);
    agent.on('waitingForInput', waitingListener);
    agent.on('exit', exitListener);
    agent.on('sessionNotFound', sessionNotFoundListener);
    agent.on('exitPlanMode', exitPlanModeListener);
    agent.on('enterPlanMode', enterPlanModeListener);
  }

  private async handleAgentExit(agent: ClaudeAgent, _code: number | null): Promise<void> {
    const projectId = agent.projectId;

    // Clean up agent
    this.agents.delete(projectId);
    this.processTracker.untrackProcess(projectId);
    this.waitingVersions.delete(projectId);

    // Save context usage if available
    const conversationId = agent.sessionId;
    if (conversationId && agent.contextUsage) {
      await this.sessionManager.saveContextUsage(projectId, conversationId, agent.contextUsage);
      await this.projectRepository.updateContextUsage(projectId, agent.contextUsage);
    }

    // For autonomous mode with loop, continue to next milestone
    if (agent.mode === 'autonomous' && this.loopOrchestrator.isLooping(projectId)) {
      const loopState = this.loopOrchestrator.getLoopState(projectId);
      if (loopState?.currentMilestone) {
        // Agent exited without clear completion status
        this.logger.warn('Autonomous agent exited without completion status', {
          projectId,
          milestone: loopState.currentMilestone.milestoneId,
        });
        this.loopOrchestrator.handleMilestoneFailed(
          projectId,
          loopState.currentMilestone,
          'Agent exited unexpectedly'
        );
      }
    }

    // Process queue
    void this.processQueue();
  }

  private async handleStatusChange(projectId: string, status: AgentStatus): Promise<void> {
    this.emit('status', projectId, status);

    // Update project status
    try {
      // Map agent status to project status
      let projectStatus: ProjectStatus['status'];
      if (status === 'running') {
        projectStatus = 'running';
      } else if (status === 'error') {
        projectStatus = 'error';
      } else {
        projectStatus = 'stopped';
      }
      await this.projectRepository.updateStatus(projectId, projectStatus);
    } catch (error) {
      this.logger.error('Failed to update project agent status', {
        projectId,
        status,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private handleExitPlanMode(agent: ClaudeAgent, planContent: string): void {
    const projectId = agent.projectId;
    const sessionId = agent.sessionId;

    // Check if we already have a pending plan for this project
    if (this.pendingPlans.has(projectId)) {
      this.logger.warn('Ignoring duplicate ExitPlanMode - already have pending plan', {
        projectId,
        sessionId,
      });
      return;
    }

    this.logger.info('ExitPlanMode detected, sending plan approval request to user', {
      projectId,
      sessionId,
      planContentLength: planContent.length,
    });

    // Store the plan content for later use when user approves
    this.pendingPlans.set(projectId, { planContent, sessionId });

    // Send a plan_mode message to the frontend for user approval
    const planModeMessage: AgentMessage = {
      type: 'plan_mode',
      content: 'Claude has finished creating a plan and is ready to implement it. Would you like to proceed?',
      timestamp: new Date().toISOString(),
      planModeInfo: {
        action: 'exit',
        planContent: planContent,
      },
    };
    this.emit('message', projectId, planModeMessage);

    // Mark agent as waiting for input
    const waitingVersion = Date.now();
    this.waitingVersions.set(projectId, waitingVersion);

    this.emit('waitingForInput', projectId, { isWaiting: true, version: waitingVersion });
  }

  private async handleEnterPlanMode(agent: ClaudeAgent): Promise<void> {
    const projectId = agent.projectId;
    const sessionId = agent.sessionId;

    this.logger.info('EnterPlanMode detected, restarting with plan mode', {
      projectId,
      sessionId,
    });

    await this.stopAgent(projectId);
    await this.delay(500);

    await this.startInteractiveAgent(projectId, {
      sessionId: sessionId || undefined,
      permissionMode: 'plan',
      initialMessage: 'Continue',
    });

    const systemMessage: AgentMessage = {
      type: 'system',
      content: '[Switched to Plan mode]',
      timestamp: new Date().toISOString(),
      hidden: true,
    };
    this.emit('message', projectId, systemMessage);
  }

  private async handlePlanApprovalResponse(
    projectId: string,
    response: string,
    pendingPlan: { planContent: string; sessionId: string | null }
  ): Promise<void> {
    // Clear the pending plan
    this.pendingPlans.delete(projectId);

    if (response.toLowerCase() === 'yes') {
      // User approved the plan
      this.logger.info('User approved plan, restarting agent with acceptEdits mode', { projectId });

      // Stop the current agent
      await this.stopAgent(projectId);

      // Small delay to ensure clean shutdown
      await this.delay(500);

      // Start a new session with acceptEdits mode and the plan as the first message
      await this.startInteractiveAgent(projectId, {
        initialMessage: pendingPlan.planContent || undefined,
        isNewSession: true,
        permissionMode: 'acceptEdits',
      });

      // Emit a hidden message to indicate the restart happened
      const hiddenMessage: AgentMessage = {
        type: 'system',
        content: '[Plan approved. Agent restarted with Accept Edits mode]',
        timestamp: new Date().toISOString(),
        hidden: true,
      };
      this.emit('message', projectId, hiddenMessage);
    } else if (response.toLowerCase() === 'no') {
      // User rejected the plan
      this.logger.info('User rejected plan', { projectId });

      // Send the rejection to Claude
      const agent = this.agents.get(projectId);
      if (agent) {
        agent.sendInput('no');
      }
    } else {
      // User wants changes - send their feedback to Claude
      this.logger.info('User requested plan changes', { projectId });

      // Send the feedback to Claude
      const agent = this.agents.get(projectId);
      if (agent) {
        agent.sendInput(response);
      }
    }
  }

  private async handleSessionNotFound(agent: ClaudeAgent, missingSessionId: string): Promise<void> {
    const projectId = agent.projectId;

    this.logger.warn('Session not found by Claude, recovering', {
      projectId,
      missingSessionId,
    });

    // Use session manager to handle recovery
    const recovery = await this.sessionManager.handleSessionNotFound(projectId, missingSessionId);

    // Agent will exit, and user will need to restart with new session
    this.logger.info('Session recovery complete, agent will need restart', {
      projectId,
      newConversationId: recovery.conversationId,
    });
  }

  private async handleAgentCompletionResponse(
    projectId: string,
    response: AgentCompletionResponse
  ): Promise<void> {
    const project = await this.projectRepository.findById(projectId);
    if (!project) {
      return;
    }

    const loopState = this.loopOrchestrator.getLoopState(projectId);
    if (!loopState?.currentMilestone) {
      return;
    }

    if (response.status === 'COMPLETE') {
      const nextMilestone = await this.loopOrchestrator.handleMilestoneComplete(
        projectId,
        project.path,
        loopState.currentMilestone,
        response.reason
      );

      if (nextMilestone) {
        // Stop current agent and start next milestone
        await this.stopAgent(projectId);
        await this.runMilestone(projectId, project.path, nextMilestone);
      }
    } else {
      this.loopOrchestrator.handleMilestoneFailed(
        projectId,
        loopState.currentMilestone,
        response.reason
      );
      await this.stopAgent(projectId);
    }
  }

  private emit<K extends keyof AgentManagerEvents>(
    event: K,
    ...args: Parameters<AgentManagerEvents[K]>
  ): void {
    this.listeners[event].forEach((listener) => {
      try {
        (listener as (...args: Parameters<AgentManagerEvents[K]>) => void)(...args);
      } catch (error) {
        this.logger.error(`Error in ${event} listener`, { error });
      }
    });
  }

  private applyMcpOverrides(
    globalServers: McpServerConfig[],
    overrides: McpOverrides | null | undefined
  ): McpServerConfig[] {
    // If no overrides, no servers are enabled (explicit opt-in required)
    if (!overrides) {
      return [];
    }

    // If MCP is explicitly disabled for the project, return empty array
    if (!overrides.enabled) {
      return [];
    }

    // Filter global servers based on project overrides (explicit opt-in)
    return globalServers.filter((server) => {
      const override = overrides.serverOverrides[server.id];
      return override?.enabled === true;
    });
  }

  private async shouldUseDocker(projectId: string): Promise<boolean> {
    if (!this.containerManager) return false;

    const settings = await this.settingsRepository.get();
    if (!settings.docker?.enabled) return false;

    // Check per-project override
    const project = await this.projectRepository.findById(projectId);
    if (project?.dockerOverride === false) return false;
    if (project?.dockerOverride === true) return true;

    return true;
  }

  private async getDockerProcessSpawner(
    projectId: string,
    projectPath: string,
    imageName?: string,
  ): Promise<{ processSpawner?: ProcessSpawner; containerWasRecreated: boolean; containerImageName?: string; dockerFallback: boolean; dockerFallbackReason?: string }> {
    if (!await this.shouldUseDocker(projectId)) {
      return { processSpawner: undefined, containerWasRecreated: false, dockerFallback: false };
    }

    try {
      const result = await this.containerManager!.ensureContainer(projectId, projectPath, imageName);

      const processSpawner = new DockerProcessSpawner(
        { containerId: result.containerId, workDir: '/workspace' },
        defaultSpawner,
      );

      return {
        processSpawner,
        containerWasRecreated: result.wasCreated || result.wasRestarted,
        containerImageName: result.imageName,
        dockerFallback: false,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn('Docker container creation failed, falling back to host execution', {
        projectId,
        error: reason,
      });
      return { processSpawner: undefined, containerWasRecreated: false, dockerFallback: true, dockerFallbackReason: reason };
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}