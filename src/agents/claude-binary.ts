import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';
import * as fs from 'fs';

import { getLogger, Logger } from '../utils/logger';
import { McpServerConfig } from '../repositories/settings';
import { ProcessManager, ProcessSpawner } from './process-manager';
import { StreamHandler } from './stream-handler';
import { MessageBuilder } from './message-builder';
import {
  Agent,
  AgentEvents,
  PermissionConfig,
  AgentLimits,
  AgentStreamingOptions,
} from './agent';
import {
  AgentStatus,
  AgentMode,
  AgentMessage,
  WaitingStatus,
  ContextUsage,
  ProcessInfo,
  PermissionRequest,
} from './types';

export interface ClaudeBinaryConfig {
  projectId: string;
  projectPath: string;
  mode?: AgentMode;
  /** @deprecated Use permissions instead */
  skipPermissions?: boolean;
  permissions?: PermissionConfig;
  /** Agent limits (max turns, max budget) */
  limits?: AgentLimits;
  /** Streaming options (partial messages, session persistence) */
  streaming?: AgentStreamingOptions;
  processSpawner?: ProcessSpawner;
  /** Session ID to resume or create with a specific ID */
  sessionId?: string;
  /** If true, use --session-id to create new session. If false, use --resume to resume existing session. */
  isNewSession?: boolean;
  /** Claude model to use (e.g., 'claude-opus-4-6') */
  model?: string;
  /** MCP (Model Context Protocol) servers to connect */
  mcpServers?: McpServerConfig[];
  /** Enable Chrome browser usage */
  chromeEnabled?: boolean;
}

export interface ClaudeBinaryStartOptions {
  initialMessage?: string;
  images?: Array<{ data: string; mediaType: string }>;
  sessionId?: string;
  resumeSessionId?: string;
  isNewSession?: boolean;
  ralphLoopPhase?: 'worker' | 'reviewer';
  permissionMode?: 'acceptEdits' | 'plan';
  waitForReady?: boolean;
  appendSystemPrompt?: string;
  model?: string;
}

// Claude Code uses 200k token context by default
const DEFAULT_MAX_CONTEXT_TOKENS = 200000;

export class ClaudeBinary implements Agent {
  readonly projectId: string;
  private readonly projectPath: string;
  private readonly _mode: AgentMode;
  private readonly _permissions: PermissionConfig;
  private readonly _limits: AgentLimits;
  private readonly _streaming: AgentStreamingOptions;
  private readonly emitter: EventEmitter;
  private readonly logger: Logger;
  private readonly processManager: ProcessManager;
  private readonly streamHandler: StreamHandler;

  private _status: AgentStatus = 'stopped';
  private _lastCommand: string | null = null;
  private _collectedOutput: string = '';
  private lineBuffer: string = '';
  private lastActivityTimestamp = 0;
  private inputQueue: string[] = [];
  private _waitingVersion = 0;
  private _sessionId: string | null = null;
  private readonly _configuredSessionId: string | null = null;
  private readonly _isNewSession: boolean = true;
  private readonly _model: string | undefined;
  private readonly _mcpServers: McpServerConfig[];
  private readonly _chromeEnabled: boolean;
  private _sessionError: string | null = null;
  private _ralphLoopPhase: 'worker' | 'reviewer' | undefined;
  private _mcpConfigPath: string | null = null;
  private answeredToolIds = new Set<string>();

  constructor(config: ClaudeBinaryConfig) {
    this.projectId = config.projectId;
    this.projectPath = config.projectPath;
    this._mode = config.mode || 'interactive';
    this._permissions = config.permissions ?? {
      skipPermissions: config.skipPermissions ?? false,
    };
    this._limits = config.limits ?? {};
    this._streaming = config.streaming ?? {};
    this.emitter = new EventEmitter();
    this.logger = getLogger('ClaudeBinary').withProject(config.projectId);
    this._configuredSessionId = config.sessionId || null;
    this._isNewSession = config.isNewSession ?? true;
    this._model = config.model;
    this._mcpServers = config.mcpServers || [];
    this._chromeEnabled = config.chromeEnabled ?? false;

    // Initialize process manager
    this.processManager = new ProcessManager(this.logger, config.processSpawner);

    // Initialize stream handler
    this.streamHandler = new StreamHandler(
      this.logger,
      this.projectId,
      this._configuredSessionId
    );

    this.setupHandlers();
  }

  get status(): AgentStatus {
    return this._status;
  }

  get mode(): AgentMode {
    return this._mode;
  }

  get lastCommand(): string | null {
    return this._lastCommand;
  }

  get processInfo(): ProcessInfo | null {
    return this.processManager.getProcessInfo();
  }

  get collectedOutput(): string {
    return this._collectedOutput;
  }

  get contextUsage(): ContextUsage | null {
    return this.streamHandler.getContextUsage();
  }

  get queuedMessageCount(): number {
    return this.inputQueue.length;
  }

  get queuedMessages(): string[] {
    return [...this.inputQueue];
  }

  get isWaitingForInput(): boolean {
    const waitingStatus = this.getWaitingStatus();
    return waitingStatus.isWaiting;
  }

  get waitingVersion(): number {
    return this._waitingVersion;
  }

  get sessionId(): string | null {
    return this._sessionId;
  }

  get sessionError(): string | null {
    return this._sessionError;
  }

  get permissionMode(): 'acceptEdits' | 'plan' | null {
    return this._permissions.permissionMode || null;
  }

  start(instructions: string): void {
    this.startWithOptions({
      initialMessage: instructions,
      sessionId: this._configuredSessionId || undefined,
      isNewSession: this._isNewSession,
      permissionMode: this._permissions.permissionMode,
      model: this._model,
      appendSystemPrompt: this._permissions.appendSystemPrompt,
    });
  }

  startWithOptions(options: ClaudeBinaryStartOptions): void {
    this.validateStart();
    this.initializeForStart(options);

    const { args, env } = this.prepareCommand(options);

    try {
      const process = this.spawnClaudeProcess(args, env);
      this.handlePostStart(options, process);
    } catch (error) {
      this.setStatus('error');
      throw error;
    }
  }

  private validateStart(): void {
    if (this.processManager.isRunning()) {
      throw new Error('Agent is already running');
    }
  }

  private initializeForStart(options: ClaudeBinaryStartOptions): void {
    this.logger.info('Starting Claude agent', {
      mode: this._mode,
      sessionId: options.sessionId,
      isNewSession: options.isNewSession,
      model: options.model || this._model,
    });

    // Reset state
    this.reset();
    this._ralphLoopPhase = options.ralphLoopPhase;

    // Emit system message about starting
    this.emitMessage({
      type: 'system',
      content: `Starting Claude agent in ${this._mode} mode`,
      timestamp: new Date().toISOString(),
    });

    // Set session ID
    if (options.sessionId || options.resumeSessionId) {
      this._sessionId = options.sessionId || options.resumeSessionId || null;
    }
  }

  private prepareCommand(options: ClaudeBinaryStartOptions): { args: string[], env: Record<string, string> } {
    const args = this.buildCommandArgs(options);
    const env = this.buildEnvironment();
    this._lastCommand = `claude ${args.join(' ')}`;

    this.logger.info('Full command args', { args });

    return { args, env };
  }

  private spawnClaudeProcess(args: string[], env: Record<string, string>): ChildProcess {
    const process = this.processManager.spawn('claude', args, this.projectPath, env);
    this.setupStreamProcessing(process);
    this.setStatus('running');
    return process;
  }

  private handlePostStart(options: ClaudeBinaryStartOptions, _process: ChildProcess): void {
    // Send initial message via stdin (both modes use stream-json format)
    if (options.initialMessage && options.initialMessage.trim()) {
      this.logger.info('Sending initial message', {
        contentLength: options.initialMessage.length,
      });
      this.sendInputInternal(options.initialMessage);

      // In autonomous mode, close stdin after sending the initial message
      if (this._mode === 'autonomous') {
        this.processManager.closeStdin();
      }
    } else {
      this.logger.info('No initial message to send');
    }

    // If waiting for ready, emit ready message
    if (options.waitForReady) {
      this.emitMessage({
        type: 'system',
        content: 'Waiting for Claude to be ready...',
        timestamp: new Date().toISOString(),
      });
    }
  }

  async stop(): Promise<void> {
    if (!this.processManager.isRunning()) {
      return;
    }

    this.logger.info('Stopping Claude agent');

    await this.processManager.stop();
    this.reset();
    this.setStatus('stopped');
  }

  sendInput(input: string): void {
    this.logger.info('sendInput called', {
      inputLength: input.length,
      isRunning: this.processManager.isRunning(),
      queueLength: this.inputQueue.length,
    });

    if (!this.processManager.isRunning()) {
      throw new Error('Agent is not running');
    }

    // Queue the input
    this.inputQueue.push(input);
    this.processNextQueuedInput();
  }

  sendToolResult(toolUseId: string, content: string): void {
    if (!this.processManager.isRunning()) {
      throw new Error('Agent is not running');
    }

    // Prevent duplicate tool_result for the same tool_use_id
    if (this.answeredToolIds.has(toolUseId)) {
      this.logger.warn('Duplicate tool result ignored', { toolUseId });
      return;
    }

    this.answeredToolIds.add(toolUseId);

    const jsonMessage = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseId, content }],
      },
    });
    const messageToSend = jsonMessage + '\n';

    this.logger.info('STDIN >>> Sending tool result', {
      direction: 'input',
      eventType: 'tool_result',
      toolUseId,
      contentLength: content.length,
    });

    const success = this.processManager.sendInput(messageToSend);

    if (success) {
      this._waitingVersion++;
      this.emitter.emit('waitingForInput', {
        isWaiting: false,
        version: this._waitingVersion,
      });
    }
  }

  removeQueuedMessage(index: number): boolean {
    if (index < 0 || index >= this.inputQueue.length) {
      return false;
    }

    this.inputQueue.splice(index, 1);
    return true;
  }

  on<K extends keyof AgentEvents>(
    event: K,
    listener: AgentEvents[K]
  ): void {
    this.emitter.on(event, listener);
  }

  off<K extends keyof AgentEvents>(
    event: K,
    listener: AgentEvents[K]
  ): void {
    this.emitter.off(event, listener);
  }

  private setupHandlers(): void {
    // Forward stream handler events
    this.streamHandler.on('message', (message: AgentMessage) => {
      this.lastActivityTimestamp = Date.now();

      // Apply ralph loop phase if set
      if (this._ralphLoopPhase && message.type === 'stdout') {
        message.ralphLoopPhase = this._ralphLoopPhase;
      }

      // Collect output
      if (message.type === 'stdout' || message.type === 'stderr') {
        this._collectedOutput += message.content;
      }

      // Extract session ID from messages
      const sessionId = MessageBuilder.extractSessionId(message.content);

      if (sessionId && !this._sessionId) {
        this._sessionId = sessionId;
        this.logger.info('Session ID detected', { sessionId });
      }

      // Check if agent is ready
      if (MessageBuilder.isReadyMessage(message.content)) {
        this.processNextQueuedInput();
      }

      this.emitMessage(message);
    });

    this.streamHandler.on('waitingForInput', (status: WaitingStatus) => {
      this._waitingVersion = status.version;
      this.emitter.emit('waitingForInput', status);
    });

    this.streamHandler.on('contextUsage', (_usage: ContextUsage) => {
      // Set max context tokens
      const maxTokens = this._limits.contextTokens || DEFAULT_MAX_CONTEXT_TOKENS;
      this.streamHandler.setMaxContextTokens(maxTokens);
    });

    this.streamHandler.on('error', (error: Error) => {
      this.logger.error('Stream handler error', { error: error.message });
      this.setStatus('error');
    });

    this.streamHandler.on('sessionNotFound', (sessionId: string) => {
      this._sessionError = `Session not found: ${sessionId}`;
      this.emitter.emit('sessionNotFound', sessionId);
    });

    this.streamHandler.on('permissionRequest', (request: PermissionRequest) => {
      // Handle permission request if needed
      this.logger.debug('Permission request', { tool: request.tool, reason: request.reason });
    });

    this.streamHandler.on('exitPlanMode', (planContent: string) => {
      this.logger.info('ExitPlanMode received', { planContentLength: planContent.length });
      this.emitter.emit('exitPlanMode', planContent);
    });

    this.streamHandler.on('enterPlanMode', () => {
      this.logger.info('EnterPlanMode received');
      this.emitter.emit('enterPlanMode');
    });

    // Forward process manager events
    this.processManager.on('exit', (code) => {
      this.logger.info('Process exited', { code });

      // Process any remaining buffer content before cleanup
      if (this.lineBuffer.trim()) {
        this.streamHandler.processLine(this.lineBuffer.trim());
        this.lineBuffer = '';
      }

      // Emit system message about exit
      this.emitMessage({
        type: 'system',
        content: `Claude agent exited with code ${code}`,
        timestamp: new Date().toISOString(),
      });

      // Set status based on exit code BEFORE emitting exit,
      // so oneOffMeta still exists when WebSocket relays the status event
      if (code !== null && code !== 0) {
        this.setStatus('error');
      } else {
        this.setStatus('stopped');
      }

      this.emitter.emit('exit', code);

      this.reset();
    });

    this.processManager.on('error', (error: Error) => {
      this.logger.error('Process error', { error: error.message });
      this.setStatus('error');
    });
  }

  private setupStreamProcessing(process: ChildProcess): void {
    const stdout = this.processManager.getStdout();
    const stderr = this.processManager.getStderr();

    this.logger.info('Setting up stream processing', {
      hasStdout: !!stdout,
      hasStderr: !!stderr,
    });

    if (stdout) {
      stdout.on('data', (data: Buffer) => {
        this.logger.debug('STDOUT <<< Raw data', {
          direction: 'output',
          eventType: 'raw_data',
          bytes: data.length,
          preview: data.toString(),
        });
        this.processStreamData(data.toString());
      });
    }

    if (stderr) {
      stderr.on('data', (data: Buffer) => {
        const content = data.toString();
        this.logger.warn('STDERR <<< Error output', {
          direction: 'output',
          eventType: 'stderr',
          bytes: data.length,
          content,
        });

        // Check for session ID conflict
        if (content.includes('already in use')) {
          this._sessionError = content.trim();
        }

        this.emitMessage({
          type: 'stderr',
          content,
          timestamp: new Date().toISOString(),
        });
      });
    }

    // Log process events
    process.on('error', (err) => {
      this.logger.error('Process error event', { error: err.message });
    });

    process.on('exit', (code, signal) => {
      this.logger.info('Process exit event', { code, signal });

      // Process any remaining buffer content
      if (this.lineBuffer.trim()) {
        this.streamHandler.processLine(this.lineBuffer.trim());
        this.lineBuffer = '';
      }
    });
  }

  private processStreamData(data: string): void {
    // Add to line buffer
    this.lineBuffer += data;

    // Process complete lines
    const lines = this.lineBuffer.split('\n');
    this.lineBuffer = lines.pop() || '';

    for (const line of lines) {
      this.streamHandler.processLine(line);
    }
  }

  private processNextQueuedInput(): void {
    if (this.inputQueue.length === 0) {
      return;
    }

    const input = this.inputQueue.shift();
    if (!input) {
      return;
    }

    this.sendInputInternal(input);
  }

  private sendInputInternal(input: string): void {
    // Both modes use stream-json format for stdin
    const jsonMessage = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: input,
      },
    });
    const messageToSend = jsonMessage + '\n';

    this.logger.info('STDIN >>> Sending message', {
      direction: 'input',
      eventType: 'message',
      contentLength: input.length,
      contentPreview: input.substring(0, 100),
    });

    const success = this.processManager.sendInput(messageToSend);
    this.logger.info('STDIN >>> Message sent', {
      direction: 'input',
      eventType: 'message_sent',
      success,
    });

    if (success) {
      // Note: Don't emit user message here - the UI already shows it when user sends
      // Emitting it again would cause duplicate display

      // Update waiting status
      this._waitingVersion++;
      this.emitter.emit('waitingForInput', {
        isWaiting: false,
        version: this._waitingVersion,
      });
    }
  }

  private buildCommandArgs(options: ClaudeBinaryStartOptions): string[] {
    const message = options.initialMessage
      ? MessageBuilder.buildUserMessage(options.initialMessage, options.images)
      : undefined;

    // Generate MCP config file if we have servers
    if (this._mcpServers && this._mcpServers.length > 0) {
      this._mcpConfigPath = MessageBuilder.generateMcpConfig(this._mcpServers, this.projectId);
    }

    return MessageBuilder.buildArgs({
      mode: this._mode,
      sessionId: options.isNewSession !== false ? options.sessionId : undefined,
      resumeSessionId: options.isNewSession === false ? options.resumeSessionId || options.sessionId : undefined,
      appendSystemPrompt: options.appendSystemPrompt || this._permissions.appendSystemPrompt,
      model: options.model || this._model,
      waitForReady: options.waitForReady,
      contextTokens: this._limits.contextTokens,
      agentTurns: this._limits.maxTurns,
      totalBudget: this._limits.totalBudget,
      cacheAnything: this._streaming.cacheAnything,
      allowedTools: this._permissions.allowedTools,
      disallowedTools: this._permissions.disallowedTools,
      permissionMode: options.permissionMode || this._permissions.permissionMode,
      skipPermissions: this._permissions.skipPermissions,
      message,
      mcpConfigPath: this._mcpConfigPath || undefined,
      chromeEnabled: this._chromeEnabled,
    });
  }

  private buildEnvironment(): Record<string, string> {
    const env: Record<string, string> = MessageBuilder.buildEnvironment();

    // MCP servers are now passed via CLI flags, not environment variables

    return env;
  }

  private getWaitingStatus(): WaitingStatus {
    const recentActivity = (Date.now() - this.lastActivityTimestamp) < 3000;
    return {
      isWaiting: this.mode === 'interactive' && this._status === 'running' && !recentActivity,
      version: this._waitingVersion,
    };
  }

  private setStatus(status: AgentStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.emitter.emit('status', status);
    }
  }

  private emitMessage(message: AgentMessage): void {
    this.emitter.emit('message', message);
  }

  private reset(): void {
    this._collectedOutput = '';
    this.lineBuffer = '';
    this.lastActivityTimestamp = 0;
    this.inputQueue = [];
    this._sessionError = null;
    this.answeredToolIds.clear();
    this._ralphLoopPhase = undefined;
    this.streamHandler.reset();

    // Clean up MCP config file if it exists
    if (this._mcpConfigPath) {
      try {
        fs.unlinkSync(this._mcpConfigPath);
        this.logger.debug('Deleted MCP config file', { path: this._mcpConfigPath });
      } catch (error) {
        this.logger.warn('Failed to delete MCP config file', {
          path: this._mcpConfigPath,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      this._mcpConfigPath = null;
    }
  }
}
