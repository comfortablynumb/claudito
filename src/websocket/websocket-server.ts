import { WebSocketServer, WebSocket } from 'ws';
import { Server, IncomingMessage } from 'http';
import { AgentManager, AgentMessage, QueuedProject, AgentResourceStatus, ContextUsage, WaitingStatus, FullAgentStatus } from '../agents';
import { RoadmapGenerator, RoadmapMessage, AuthService, ShellService } from '../services';
import { RunProcessManager, RunProcessStatus } from '../services/run-config/run-process-types';
import { RalphLoopService, RalphLoopStatus, IterationSummary, ReviewerFeedback, RalphLoopFinalStatus } from '../services/ralph-loop/types';
import { ConversationRepository, ProjectRepository } from '../repositories';
import { getLogger, Logger, getLogStore, LogEntry } from '../utils/logger';
import { parseCookie, COOKIE_NAME } from '../middleware/auth-middleware';
import { ResourceStats, ResourceEventData } from './types';
import { DockerBuildProgressData } from '../services/docker/types';

export interface ConnectedClient {
  clientId: string;
  projectId?: string;
  userAgent?: string;
  connectedAt: string;
  lastResourceUpdate?: string;
  resourceStats?: ResourceStats;
}

export interface ClientRegistry {
  clients: Map<string, ConnectedClient>;
  projectClients: Map<string, Set<string>>;
}

export interface ShellOutputData {
  sessionId: string;
  data: string;
}

export interface ShellExitData {
  sessionId: string;
  code: number | null;
}

export interface ShellErrorData {
  sessionId: string;
  error: string;
}

export interface RalphLoopStatusData {
  taskId: string;
  status: RalphLoopStatus;
  currentIteration?: number;
  maxTurns?: number;
}

export interface RalphLoopIterationData {
  taskId: string;
  iteration: number;
}

export interface RalphLoopOutputData {
  taskId: string;
  phase: 'worker' | 'reviewer';
  content: string;
  timestamp: string;
}

export interface RalphLoopToolUseData {
  taskId: string;
  phase: 'worker' | 'reviewer';
  tool_name: string;
  tool_id: string;
  parameters: Record<string, unknown>;
  timestamp: string;
}

export interface RalphLoopCompleteData {
  taskId: string;
  finalStatus: RalphLoopFinalStatus;
}

export interface RalphLoopWorkerCompleteData {
  taskId: string;
  summary: IterationSummary;
}

export interface RalphLoopReviewerCompleteData {
  taskId: string;
  feedback: ReviewerFeedback;
}

export interface RalphLoopErrorData {
  taskId: string;
  error: string;
}

export interface FrontendErrorData {
  timestamp: string;
  message: string;
  clientId?: string;
  errorType: string;
  url?: string;
  projectId?: string;
  userAgent?: string;
  stack?: string;
  line?: number;
  column?: number;
}

export interface OneOffMessageData extends AgentMessage {
  oneOffId: string;
  label?: string;
}

export interface OneOffStatusData {
  oneOffId: string;
  status: string;
  label?: string;
}

export interface OneOffWaitingData {
  oneOffId: string;
  isWaiting: boolean;
  version: number;
  label?: string;
}

export interface GitHubCloneProgressData {
  repo: string;
  phase: 'cloning' | 'done' | 'error';
  message: string;
}

export interface RunConfigOutputData {
  configId: string;
  data: string;
}

export interface RunConfigStatusData {
  configId: string;
  status: RunProcessStatus;
}

export interface AgentMessageWithContext extends AgentMessage {
  contextUsage?: ContextUsage;
}

// WebSocketMessageData is a union of possible data types
export type WebSocketMessageData =
  | AgentMessage
  | AgentMessageWithContext
  | QueuedProject[]
  | AgentResourceStatus
  | RoadmapMessage
  | WaitingStatus
  | FullAgentStatus
  | ShellOutputData
  | ShellExitData
  | ShellErrorData
  | RalphLoopStatusData
  | RalphLoopIterationData
  | RalphLoopOutputData
  | RalphLoopToolUseData
  | RalphLoopCompleteData
  | RalphLoopWorkerCompleteData
  | RalphLoopReviewerCompleteData
  | RalphLoopErrorData
  | FrontendErrorData
  | ResourceEventData
  | OneOffMessageData
  | OneOffStatusData
  | OneOffWaitingData
  | GitHubCloneProgressData
  | RunConfigOutputData
  | RunConfigStatusData
  | DockerBuildProgressData
  | string; // Covers 'connected' messages and simple loop events

export interface SessionRecoveryData {
  oldConversationId: string;
  newConversationId: string;
  reason: string;
}

export interface WebSocketMessage {
  type:
    | 'agent_message'
    | 'agent_status'
    | 'agent_waiting'
    | 'queue_change'
    | 'connected'
    | 'roadmap_message'
    | 'session_recovery'
    | 'shell_output'
    | 'shell_exit'
    | 'shell_error'
    | 'ralph_loop_status'
    | 'ralph_loop_iteration'
    | 'ralph_loop_output'
    | 'ralph_loop_worker_complete'
    | 'ralph_loop_reviewer_complete'
    | 'ralph_loop_complete'
    | 'ralph_loop_error'
    | 'ralph_loop_tool_use'
    | 'frontend_error'
    | 'resource_event'
    | 'oneoff_message'
    | 'oneoff_status'
    | 'oneoff_waiting'
    | 'github_clone_progress'
    | 'run_config_output'
    | 'run_config_status'
    | 'docker_build_progress'
    | 'docker_fallback_warning'
;
  projectId?: string;
  data?: WebSocketMessageData | SessionRecoveryData | DockerFallbackWarningData;
}

export interface DockerFallbackWarningData {
  reason: string;
}

export interface ProjectWebSocketServer {
  initialize(httpServer: Server): void;
  broadcast(message: WebSocketMessage): void;
  broadcastToProject(projectId: string, message: WebSocketMessage): void;
  close(): void;
  getConnectedClients(projectId?: string): ConnectedClient[];
  getAllConnectedClients(): Map<string, ConnectedClient>;
}

export interface WebSocketServerDependencies {
  agentManager: AgentManager;
  roadmapGenerator?: RoadmapGenerator;
  authService?: AuthService;
  shellService?: ShellService;
  ralphLoopService?: RalphLoopService;
  runProcessManager?: RunProcessManager;
  conversationRepository?: ConversationRepository;
  projectRepository?: ProjectRepository;
}

export class DefaultWebSocketServer implements ProjectWebSocketServer {
  private wss: WebSocketServer | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private readonly agentManager: AgentManager;
  private readonly roadmapGenerator?: RoadmapGenerator;
  private readonly authService?: AuthService;
  private readonly shellService?: ShellService;
  private readonly ralphLoopService?: RalphLoopService;
  private readonly runProcessManager?: RunProcessManager;
  private readonly conversationRepository?: ConversationRepository;
  private readonly projectRepository?: ProjectRepository;
  private readonly projectSubscriptions: Map<string, Set<WebSocket>> = new Map();
  private readonly logger: Logger;
  // Client registry for tracking connected clients
  private readonly connectedClients: Map<string, ConnectedClient> = new Map();
  private readonly clientWebSockets: Map<WebSocket, string> = new Map();

  constructor(deps: WebSocketServerDependencies) {
    this.agentManager = deps.agentManager;
    this.roadmapGenerator = deps.roadmapGenerator;
    this.authService = deps.authService;
    this.shellService = deps.shellService;
    this.ralphLoopService = deps.ralphLoopService;
    this.runProcessManager = deps.runProcessManager;
    this.conversationRepository = deps.conversationRepository;
    this.projectRepository = deps.projectRepository;
    this.logger = getLogger('websocket');
    this.setupAgentListeners();
    this.setupRoadmapListeners();
    this.setupShellListeners();
    this.setupRalphLoopListeners();
    this.setupOneOffListeners();
    this.setupRunConfigListeners();
    this.setupLoggerListeners();
  }

  initialize(httpServer: Server): void {
    this.wss = new WebSocketServer({
      server: httpServer,
      verifyClient: (info, callback): void => this.verifyClient(info, callback),
    });
    this.wss.on('connection', (ws) => this.handleConnection(ws));
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    this.pingInterval = setInterval(() => {
      if (!this.wss) return;

      this.wss.clients.forEach((ws) => {
        const client = ws as WebSocket & { isAlive?: boolean };

        if (client.isAlive === false) {
          this.logger.debug('Terminating unresponsive WebSocket client');
          client.terminate();
          return;
        }

        client.isAlive = false;
        client.ping();
      });
    }, 30000);
  }

  private verifyClient(
    info: { origin: string; secure: boolean; req: IncomingMessage },
    callback: (result: boolean, code?: number, message?: string) => void
  ): void {
    // Skip auth validation if no auth service is configured
    if (!this.authService) {
      callback(true);
      return;
    }

    const sessionId = parseCookie(info.req.headers.cookie, COOKIE_NAME);

    if (!sessionId || !this.authService.validateSession(sessionId)) {
      this.logger.debug('WebSocket connection rejected: invalid session');
      callback(false, 401, 'Unauthorized');
      return;
    }

    callback(true);
  }

  broadcast(message: WebSocketMessage): void {
    if (!this.wss) {
      return;
    }

    const data = JSON.stringify(message);

    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  broadcastToProject(projectId: string, message: WebSocketMessage): void {
    const subscribers = this.projectSubscriptions.get(projectId);

    if (!subscribers) {
      return;
    }

    const data = JSON.stringify(message);

    subscribers.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  close(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (!this.wss) {
      return;
    }

    this.logger.debug('Closing WebSocket server');

    // Close all client connections
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.close(1001, 'Server shutting down');
      }
    });

    // Close the WebSocket server
    this.wss.close();
    this.wss = null;
    this.projectSubscriptions.clear();
    this.connectedClients.clear();
    this.clientWebSockets.clear();
  }

  private handleConnection(ws: WebSocket): void {
    const client = ws as WebSocket & { isAlive?: boolean };
    client.isAlive = true;
    client.on('pong', () => { client.isAlive = true; });

    this.sendMessage(ws, { type: 'connected', data: 'Connected to Claudito WebSocket' });

    ws.on('message', (data) => this.handleMessage(ws, String(data)));
    ws.on('close', () => this.handleDisconnect(ws));
  }

  private handleMessage(ws: WebSocket, rawData: string): void {
    try {
      const message = JSON.parse(rawData) as ClientMessage;
      this.processClientMessage(ws, message);
    } catch {
      // Invalid JSON, ignore
    }
  }

  private processClientMessage(ws: WebSocket, message: ClientMessage): void {
    switch (message.type) {
      case 'register':
        if (message.clientId) {
          this.registerClient(ws, message.clientId, message.userAgent);
        }
        break;
      case 'subscribe':
        if (message.projectId) {
          this.subscribeToProject(ws, message.projectId);
        }
        break;
      case 'unsubscribe':
        if (message.projectId) {
          this.unsubscribeFromProject(ws, message.projectId);
        }
        break;
      case 'resource_event':
        this.handleResourceEvent(message.data);
        break;
    }
  }

  private registerClient(ws: WebSocket, clientId: string, userAgent?: string): void {
    const client: ConnectedClient = {
      clientId,
      userAgent,
      connectedAt: new Date().toISOString(),
    };
    this.connectedClients.set(clientId, client);
    this.clientWebSockets.set(ws, clientId);

    this.logger.debug('Client registered', {
      clientId,
      userAgent,
      totalClients: this.connectedClients.size,
    });
  }

  private subscribeToProject(ws: WebSocket, projectId: string): void {
    if (!this.projectSubscriptions.has(projectId)) {
      this.projectSubscriptions.set(projectId, new Set());
    }
    this.projectSubscriptions.get(projectId)!.add(ws);

    // Update client's project association
    const clientId = this.clientWebSockets.get(ws);
    if (clientId) {
      const client = this.connectedClients.get(clientId);
      if (client) {
        client.projectId = projectId;
      }
    }

    this.logger.withProject(projectId).debug('Client subscribed', {
      clientId,
      subscribers: this.projectSubscriptions.get(projectId)!.size,
    });

    // Send current agent status immediately on subscribe
    const fullStatus = this.agentManager.getFullStatus(projectId);
    this.sendMessage(ws, {
      type: 'agent_status',
      projectId,
      data: fullStatus,
    });
  }

  private unsubscribeFromProject(ws: WebSocket, projectId: string): void {
    const subscribers = this.projectSubscriptions.get(projectId);

    if (subscribers) {
      subscribers.delete(ws);
    }
  }

  private handleResourceEvent(data: ResourceEventData | undefined): void {
    if (!data) return;

    // Type guard to check if it's a stats broadcast
    if ('stats' in data && 'clientId' in data) {
      const broadcastData = data;
      const client = this.connectedClients.get(broadcastData.clientId);
      if (client) {
        client.resourceStats = broadcastData.stats;
        client.lastResourceUpdate = new Date().toISOString();
      }
    }

    // Broadcast resource event to all connected clients
    this.broadcast({
      type: 'resource_event',
      data: data,
    });
  }

  private handleDisconnect(ws: WebSocket): void {
    // Remove from project subscriptions
    this.projectSubscriptions.forEach((subscribers) => {
      subscribers.delete(ws);
    });

    // Remove from client registry
    const clientId = this.clientWebSockets.get(ws);
    if (clientId) {
      this.connectedClients.delete(clientId);
      this.clientWebSockets.delete(ws);

      this.logger.debug('Client disconnected', {
        clientId,
        remainingClients: this.connectedClients.size,
      });
    }
  }

  private sendMessage(ws: WebSocket, message: WebSocketMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private setupAgentListeners(): void {
    this.agentManager.on('message', (projectId, message) => {
      // Include context usage in the message for real-time tracking
      const contextUsage = this.agentManager.getContextUsage(projectId);
      const messageWithContext: AgentMessageWithContext = {
        ...message,
        contextUsage: contextUsage || undefined,
      };

      this.broadcastToProject(projectId, {
        type: 'agent_message',
        projectId,
        data: messageWithContext,
      });
    });

    this.agentManager.on('status', (projectId, _status) => {
      // Send full status instead of just the status string
      const fullStatus = this.agentManager.getFullStatus(projectId);
      this.broadcast({
        type: 'agent_status',
        projectId,
        data: fullStatus,
      });
    });

    this.agentManager.on('waitingForInput', (projectId, waitingStatus) => {
      this.broadcast({
        type: 'agent_waiting',
        projectId,
        data: waitingStatus,
      });
    });

    this.agentManager.on('queueChange', (_queue) => {
      this.broadcast({
        type: 'queue_change',
        data: this.agentManager.getResourceStatus(),
      });
    });

    this.agentManager.on('sessionRecovery', (projectId, oldConversationId, newConversationId, reason) => {
      this.broadcastToProject(projectId, {
        type: 'session_recovery',
        projectId,
        data: {
          oldConversationId,
          newConversationId,
          reason,
        },
      });
    });

    this.agentManager.on('dockerFallbackWarning', (projectId, reason) => {
      this.broadcastToProject(projectId, {
        type: 'docker_fallback_warning',
        projectId,
        data: { reason },
      });
    });

  }

  private setupRoadmapListeners(): void {
    if (!this.roadmapGenerator) {
      this.logger.debug('No roadmap generator provided, skipping listener setup');
      return;
    }

    this.logger.info('Setting up roadmap generator listeners');

    this.roadmapGenerator.on('message', (projectId, message) => {
      this.logger.withProject(projectId).debug('Broadcasting roadmap_message', { type: message.type });
      this.broadcastToProject(projectId, {
        type: 'roadmap_message',
        projectId,
        data: message,
      });
    });
  }

  private setupShellListeners(): void {
    if (!this.shellService) {
      this.logger.debug('No shell service provided, skipping listener setup');
      return;
    }

    this.logger.info('Setting up shell service listeners');

    this.shellService.on('data', (sessionId, data) => {
      // Extract projectId from sessionId (format: shell-{projectId}-{timestamp}-{counter})
      const parts = sessionId.split('-');

      if (parts.length >= 3) {
        const projectId = parts.slice(1, -2).join('-');
        this.broadcastToProject(projectId, {
          type: 'shell_output',
          projectId,
          data: { sessionId, data },
        });
      }
    });

    this.shellService.on('exit', (sessionId, code) => {
      const parts = sessionId.split('-');

      if (parts.length >= 3) {
        const projectId = parts.slice(1, -2).join('-');
        this.broadcastToProject(projectId, {
          type: 'shell_exit',
          projectId,
          data: { sessionId, code },
        });
      }
    });

    this.shellService.on('error', (sessionId, error) => {
      const parts = sessionId.split('-');

      if (parts.length >= 3) {
        const projectId = parts.slice(1, -2).join('-');
        this.broadcastToProject(projectId, {
          type: 'shell_error',
          projectId,
          data: { sessionId, error },
        });
      }
    });
  }

  private setupRalphLoopListeners(): void {
    if (!this.ralphLoopService) {
      this.logger.debug('No Ralph Loop service provided, skipping listener setup');
      return;
    }

    this.logger.info('Setting up Ralph Loop service listeners');

    this.ralphLoopService.on('status_change', (projectId, taskId, status, currentIteration, maxTurns) => {
      this.broadcastToProject(projectId, {
        type: 'ralph_loop_status',
        projectId,
        data: { taskId, status, currentIteration, maxTurns },
      });
    });

    this.ralphLoopService.on('iteration_start', (projectId, taskId, iteration) => {
      this.broadcastToProject(projectId, {
        type: 'ralph_loop_iteration',
        projectId,
        data: { taskId, iteration },
      });

      // Save iteration start message
      void this.saveRalphLoopMessage(projectId, 'ralph_loop_iteration', {
        taskId,
        iteration,
      });
    });

    this.ralphLoopService.on('worker_complete', (projectId, taskId, summary) => {
      this.broadcastToProject(projectId, {
        type: 'ralph_loop_worker_complete',
        projectId,
        data: { taskId, summary },
      });

      // Save worker complete message
      void this.saveRalphLoopMessage(projectId, 'ralph_loop_worker_complete', {
        taskId,
        summary,
      });
    });

    this.ralphLoopService.on('reviewer_complete', (projectId, taskId, feedback) => {
      this.broadcastToProject(projectId, {
        type: 'ralph_loop_reviewer_complete',
        projectId,
        data: { taskId, feedback },
      });

      // Save reviewer complete message
      void this.saveRalphLoopMessage(projectId, 'ralph_loop_reviewer_complete', {
        taskId,
        feedback,
      });
    });

    this.ralphLoopService.on('loop_complete', (projectId, taskId, finalStatus) => {
      this.broadcastToProject(projectId, {
        type: 'ralph_loop_complete',
        projectId,
        data: { taskId, finalStatus },
      });

      // Save completion message
      void this.saveRalphLoopMessage(projectId, 'ralph_loop_complete', {
        taskId,
        finalStatus,
      });
    });

    this.ralphLoopService.on('loop_error', (projectId, taskId, error) => {
      this.broadcastToProject(projectId, {
        type: 'ralph_loop_error',
        projectId,
        data: { taskId, error },
      });

      // Save error message
      void this.saveRalphLoopMessage(projectId, 'ralph_loop_error', {
        taskId,
        error,
      });
    });

    this.ralphLoopService.on('output', (projectId, taskId, source, content) => {
      const timestamp = new Date().toISOString();
      this.broadcastToProject(projectId, {
        type: 'ralph_loop_output',
        projectId,
        data: { taskId, phase: source, content, timestamp },
      });

      // Save Ralph Loop output to conversation
      void this.saveRalphLoopMessage(projectId, 'ralph_loop_output', {
        taskId,
        phase: source,
        content,
        timestamp,
      });
    });

    this.ralphLoopService.on('tool_use', (projectId, taskId, source, toolInfo) => {
      this.logger.info('WebSocket broadcasting ralph_loop_tool_use', {
        projectId,
        taskId,
        phase: source,
        toolName: toolInfo.tool_name,
      });

      const data = {
        taskId,
        phase: source,
        tool_name: toolInfo.tool_name,
        tool_id: toolInfo.tool_id,
        parameters: toolInfo.parameters,
        timestamp: toolInfo.timestamp,
      };

      this.broadcastToProject(projectId, {
        type: 'ralph_loop_tool_use',
        projectId,
        data,
      });

      // Save tool use message to conversation
      void this.saveRalphLoopMessage(projectId, 'ralph_loop_tool_use', data);
    });
  }

  private setupOneOffListeners(): void {
    this.agentManager.on('oneOffMessage', (oneOffId, message) => {
      const meta = this.agentManager.getOneOffMeta(oneOffId);

      if (!meta) return;

      this.broadcastToProject(meta.projectId, {
        type: 'oneoff_message',
        projectId: meta.projectId,
        data: { ...message, oneOffId, label: meta.label },
      });
    });

    this.agentManager.on('oneOffStatus', (oneOffId, status) => {
      const meta = this.agentManager.getOneOffMeta(oneOffId);

      if (!meta) return;

      this.broadcastToProject(meta.projectId, {
        type: 'oneoff_status',
        projectId: meta.projectId,
        data: { oneOffId, status, label: meta.label },
      });

      // Re-broadcast agent_status so the UI project badge reflects one-off activity
      const fullStatus = this.agentManager.getFullStatus(meta.projectId);
      this.broadcast({
        type: 'agent_status',
        projectId: meta.projectId,
        data: fullStatus,
      });
    });

    this.agentManager.on('oneOffWaiting', (oneOffId, isWaiting, version) => {
      const meta = this.agentManager.getOneOffMeta(oneOffId);

      if (!meta) return;

      this.broadcastToProject(meta.projectId, {
        type: 'oneoff_waiting',
        projectId: meta.projectId,
        data: { oneOffId, isWaiting, version, label: meta.label },
      });
    });
  }

  private setupRunConfigListeners(): void {
    if (!this.runProcessManager) {
      this.logger.debug('No run process manager provided, skipping listener setup');
      return;
    }

    this.logger.info('Setting up run config process listeners');

    this.runProcessManager.on('output', (projectId, configId, data) => {
      this.broadcastToProject(projectId, {
        type: 'run_config_output',
        projectId,
        data: { configId, data },
      });
    });

    this.runProcessManager.on('status', (projectId, configId, status) => {
      this.broadcastToProject(projectId, {
        type: 'run_config_status',
        projectId,
        data: { configId, status },
      });
    });
  }

  private setupLoggerListeners(): void {
    const logStore = getLogStore();

    // Listen for frontend errors and broadcast them to all clients
    logStore.on('frontend_error', (logEntry: LogEntry) => {
      const ctx = logEntry.context || {};
      const frontendError: FrontendErrorData = {
        timestamp: logEntry.timestamp,
        message: logEntry.message,
        clientId: ctx.clientId as string | undefined,
        errorType: (ctx.errorType as string) || 'runtime',
        url: ctx.source as string | undefined,
        projectId: logEntry.projectId,
        userAgent: ctx.userAgent as string | undefined,
        stack: ctx.stack as string | undefined,
        line: ctx.line as number | undefined,
        column: ctx.column as number | undefined,
      };

      this.broadcast({
        type: 'frontend_error',
        data: frontendError,
      });
    });
  }

  private async saveRalphLoopMessage(
    projectId: string,
    type: string,
    data: Record<string, unknown>
  ): Promise<void> {
    if (!this.conversationRepository || !this.projectRepository) {
      return;
    }

    try {
      // Get the current conversation for the project
      const project = await this.projectRepository.findById(projectId);
      if (!project?.currentConversationId) {
        this.logger.debug('No current conversation for Ralph Loop message', { projectId, type });
        return;
      }

      const message = this.buildRalphLoopMessage(type, data);

      if (!message) {
        return;
      }

      await this.conversationRepository.addMessage(
        projectId,
        project.currentConversationId,
        message
      );
    } catch (error) {
      this.logger.error('Failed to save Ralph Loop message', {
        projectId,
        type,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private buildRalphLoopMessage(
    type: string,
    data: Record<string, unknown>
  ): AgentMessage | null {
    switch (type) {
      case 'ralph_loop_output':
        return this.buildOutputMessage(data as unknown as RalphLoopOutputData);

      case 'ralph_loop_iteration':
        return this.buildSystemMessage(
          `--- Ralph Loop Iteration ${(data as { iteration: number }).iteration} started ---`,
          data
        );

      case 'ralph_loop_worker_complete':
        return this.buildWorkerCompleteMessage(data as unknown as RalphLoopWorkerCompleteData);

      case 'ralph_loop_reviewer_complete':
        return this.buildReviewerCompleteMessage(data as unknown as RalphLoopReviewerCompleteData);

      case 'ralph_loop_complete':
        return this.buildSystemMessage(
          `Ralph Loop completed: ${(data as unknown as RalphLoopCompleteData).finalStatus}`,
          data
        );

      case 'ralph_loop_error':
        return this.buildSystemMessage(`Ralph Loop error: ${(data as { error: string }).error}`, data);

      case 'ralph_loop_tool_use':
        return this.buildToolUseMessage(data as unknown as RalphLoopToolUseData);

      default:
        return null;
    }
  }

  private buildOutputMessage(data: RalphLoopOutputData): AgentMessage {
    return {
      type: 'stdout',
      content: data.content,
      timestamp: (data as unknown as Record<string, unknown>).timestamp as string || new Date().toISOString(),
      ralphLoopPhase: data.phase,
    };
  }

  private buildSystemMessage(content: string, data: Record<string, unknown>): AgentMessage {
    return {
      type: 'system',
      content,
      timestamp: (data.timestamp as string) || new Date().toISOString(),
    };
  }

  private buildWorkerCompleteMessage(data: RalphLoopWorkerCompleteData): AgentMessage {
    let content = `Worker completed iteration ${data.summary.iterationNumber}`;

    if (data.summary.filesModified?.length) {
      content += `\nFiles modified: ${data.summary.filesModified.join(', ')}`;
    }

    return this.buildSystemMessage(content, data as unknown as Record<string, unknown>);
  }

  private buildReviewerCompleteMessage(data: RalphLoopReviewerCompleteData): AgentMessage {
    let content = `Reviewer decision: ${data.feedback.decision}`;

    if (data.feedback.feedback) {
      content += `\nFeedback: ${data.feedback.feedback}`;
    }

    return this.buildSystemMessage(content, data as unknown as Record<string, unknown>);
  }

  private buildToolUseMessage(data: RalphLoopToolUseData): AgentMessage {
    return {
      type: 'tool_use',
      content: `${data.tool_name}`,
      timestamp: data.timestamp || new Date().toISOString(),
      toolInfo: {
        name: data.tool_name,
        id: data.tool_id,
        input: data.parameters,
      },
      ralphLoopPhase: data.phase,
    };
  }

  getConnectedClients(projectId?: string): ConnectedClient[] {
    if (!projectId) {
      return Array.from(this.connectedClients.values());
    }

    // Filter clients by project
    return Array.from(this.connectedClients.values()).filter(
      client => client.projectId === projectId
    );
  }

  getAllConnectedClients(): Map<string, ConnectedClient> {
    return new Map(this.connectedClients);
  }
}

interface ClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'resource_event' | 'register';
  projectId?: string;
  data?: ResourceEventData;
  clientId?: string;
  userAgent?: string;
}
