import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';

import { getLogger, Logger } from '../utils/logger';
import { ProcessManager, ProcessSpawner } from './process-manager';
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
} from './types';
import { AgentProfile } from '../repositories/settings';

export interface OpencodeAgentConfig {
  projectId: string;
  projectPath: string;
  mode?: AgentMode;
  permissions?: PermissionConfig;
  limits?: AgentLimits;
  streaming?: AgentStreamingOptions;
  processSpawner?: ProcessSpawner;
  sessionId?: string;
  isNewSession?: boolean;
  model?: string;
  agentProfile?: AgentProfile;
}

/**
 * Agent implementation that uses the opencode CLI (opencode run).
 * Each message spawns a new `opencode run` process with --continue for session persistence.
 */
export class OpencodeAgent implements Agent {
  readonly projectId: string;
  private readonly projectPath: string;
  private readonly _mode: AgentMode;
  private readonly _permissions: PermissionConfig;
  private readonly _limits: AgentLimits;
  private readonly emitter: EventEmitter;
  private readonly logger: Logger;
  private readonly spawnerOverride?: ProcessSpawner;
  private readonly _agentProfile?: AgentProfile;

  private processManager: ProcessManager | null = null;
  private _status: AgentStatus = 'stopped';
  private _lastCommand: string | null = null;
  private _collectedOutput: string = '';
  private currentOutput: string = '';
  private inputQueue: string[] = [];
  private _waitingVersion = 0;
  private _sessionId: string | null = null;
  private readonly _configuredSessionId: string | null = null;
  private readonly _isNewSession: boolean = true;
  private readonly _model: string | undefined;
  private _sessionError: string | null = null;
  private isProcessing = false;

  constructor(config: OpencodeAgentConfig) {
    this.projectId = config.projectId;
    this.projectPath = config.projectPath;
    this._mode = config.mode || 'interactive';
    this._permissions = config.permissions ?? { skipPermissions: false };
    this._limits = config.limits ?? {};
    this.emitter = new EventEmitter();
    this.logger = getLogger('OpencodeAgent').withProject(config.projectId);
    this.spawnerOverride = config.processSpawner;
    this._configuredSessionId = config.sessionId || null;
    this._isNewSession = config.isNewSession ?? true;
    this._model = config.model;
    this._agentProfile = config.agentProfile;
  }

  get status(): AgentStatus { return this._status; }
  get mode(): AgentMode { return this._mode; }
  get lastCommand(): string | null { return this._lastCommand; }

  get processInfo(): ProcessInfo | null {
    return this.processManager?.getProcessInfo() ?? null;
  }

  get collectedOutput(): string { return this._collectedOutput; }
  get contextUsage(): ContextUsage | null { return null; }
  get queuedMessageCount(): number { return this.inputQueue.length; }
  get queuedMessages(): string[] { return [...this.inputQueue]; }

  get isWaitingForInput(): boolean {
    return this._status === 'running' && !this.isProcessing;
  }

  get waitingVersion(): number { return this._waitingVersion; }
  get sessionId(): string | null { return this._sessionId; }
  get sessionError(): string | null { return this._sessionError; }
  get permissionMode(): 'acceptEdits' | 'plan' | null { return null; }

  start(instructions: string): void {
    if (this.isProcessing) {
      throw new Error('Agent is already running');
    }

    this.logger.info('Starting opencode agent', {
      mode: this._mode,
      model: this._model,
    });

    this.resetState();
    this._sessionId = this._configuredSessionId;
    this.setStatus('running');

    this.emitMessage({
      type: 'system',
      content: 'Starting opencode agent',
      timestamp: new Date().toISOString(),
    });

    this.runMessage(instructions, true);
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping opencode agent');

    if (this.processManager?.isRunning()) {
      await this.processManager.stop();
    }

    this.resetState();
    this.setStatus('stopped');
  }

  sendInput(input: string): void {
    if (this._status !== 'running') {
      throw new Error('Agent is not running');
    }

    this.inputQueue.push(input);
    this.emitQueueChange();
    this.processNextInput();
  }

  sendToolResult(_toolUseId: string, _content: string): void {
    this.logger.warn('sendToolResult not supported by opencode agent');
  }

  removeQueuedMessage(index: number): boolean {
    if (index < 0 || index >= this.inputQueue.length) {
      return false;
    }

    this.inputQueue.splice(index, 1);
    this.emitQueueChange();
    return true;
  }

  on<K extends keyof AgentEvents>(event: K, listener: AgentEvents[K]): void {
    this.emitter.on(event, listener);
  }

  off<K extends keyof AgentEvents>(event: K, listener: AgentEvents[K]): void {
    this.emitter.off(event, listener);
  }

  private processNextInput(): void {
    if (this.isProcessing || this.inputQueue.length === 0) {
      return;
    }

    const input = this.inputQueue.shift()!;
    this.emitQueueChange();
    this.runMessage(input, false);
  }

  private runMessage(message: string, isFirst: boolean): void {
    this.isProcessing = true;
    this.currentOutput = '';
    this.emitWaiting(false);

    const args = this.buildArgs(message, isFirst);
    const env = MessageBuilder.buildEnvironment();

    this._lastCommand = `opencode ${args.join(' ')}`;
    this.logger.info('Running opencode', { args });

    const pm = new ProcessManager(this.logger, this.spawnerOverride);
    this.processManager = pm;

    try {
      const proc = pm.spawn('opencode', args, this.projectPath, env);
      this.setupProcessStreams(proc, pm);
    } catch (error) {
      this.isProcessing = false;
      this.setStatus('error');
      this.emitMessage({
        type: 'stderr',
        content: `Failed to start opencode: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private setupProcessStreams(proc: ChildProcess, pm: ProcessManager): void {
    const stdout = pm.getStdout();
    const stderr = pm.getStderr();

    if (stdout) {
      stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        this.currentOutput += text;
        this._collectedOutput += text;

        this.emitMessage({
          type: 'stdout',
          content: text,
          timestamp: new Date().toISOString(),
        });
      });
    }

    if (stderr) {
      stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        this.logger.warn('opencode stderr', { content: text });

        this.emitMessage({
          type: 'stderr',
          content: text,
          timestamp: new Date().toISOString(),
        });
      });
    }

    proc.on('exit', (code) => {
      this.logger.info('opencode process exited', { code });
      this.isProcessing = false;
      this.processManager = null;

      if (this._status !== 'running') {
        return;
      }

      if (code !== null && code !== 0) {
        this.emitMessage({
          type: 'system',
          content: `opencode exited with code ${code}`,
          timestamp: new Date().toISOString(),
        });
      }

      // Process next queued message or signal waiting
      if (this.inputQueue.length > 0) {
        this.processNextInput();
      } else {
        this.emitWaiting(true);
      }
    });

    proc.on('error', (err) => {
      this.logger.error('opencode process error', { error: err.message });
      this.isProcessing = false;
      this.processManager = null;
      this.setStatus('error');
    });
  }

  private buildArgs(message: string, isFirst: boolean): string[] {
    const args: string[] = ['run'];

    // Session management
    if (this._sessionId) {
      if (isFirst && this._isNewSession) {
        args.push('--session', this._sessionId);
      } else {
        args.push('--session', this._sessionId, '--continue');
      }
    } else if (!isFirst) {
      args.push('--continue');
    }

    // Model selection
    if (this._model) {
      args.push('--model', this._model);
    }

    // Add the message
    args.push(message);

    return args;
  }

  private emitWaiting(isWaiting: boolean): void {
    this._waitingVersion++;
    this.emitter.emit('waitingForInput', {
      isWaiting,
      version: this._waitingVersion,
    } as WaitingStatus);
  }

  private emitQueueChange(): void {
    // Queue changes are handled by the agent manager via events
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

  private resetState(): void {
    this._collectedOutput = '';
    this.currentOutput = '';
    this.inputQueue = [];
    this._sessionError = null;
    this.isProcessing = false;
  }
}
