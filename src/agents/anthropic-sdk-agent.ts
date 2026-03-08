import { EventEmitter } from 'events';
import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText, LanguageModel } from 'ai';

import { getLogger, Logger } from '../utils/logger';
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

export interface AnthropicSdkAgentConfig {
  projectId: string;
  projectPath: string;
  mode?: AgentMode;
  permissions?: PermissionConfig;
  limits?: AgentLimits;
  streaming?: AgentStreamingOptions;
  model?: string;
  agentProfile?: AgentProfile;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

const DEFAULT_MAX_CONTEXT_TOKENS = 200000;

export class AnthropicSdkAgent implements Agent {
  readonly projectId: string;
  private readonly projectPath: string;
  private readonly _mode: AgentMode;
  private readonly emitter: EventEmitter;
  private readonly logger: Logger;
  private readonly _model: string;
  private readonly _agentProfile: AgentProfile | undefined;
  private readonly conversationHistory: ConversationMessage[] = [];

  private _status: AgentStatus = 'stopped';
  private _lastCommand: string | null = null;
  private _collectedOutput: string = '';
  private _waitingVersion = 0;
  private _contextUsage: ContextUsage | null = null;
  private inputQueue: string[] = [];
  private abortController: AbortController | null = null;

  constructor(config: AnthropicSdkAgentConfig) {
    this.projectId = config.projectId;
    this.projectPath = config.projectPath;
    this._mode = config.mode || 'interactive';
    this._model = config.model || 'claude-sonnet-4-6';
    this._agentProfile = config.agentProfile;
    this.emitter = new EventEmitter();
    this.logger = getLogger('anthropic-sdk-agent');
  }

  get status(): AgentStatus { return this._status; }

  get mode(): AgentMode { return this._mode; }

  get lastCommand(): string | null { return this._lastCommand; }

  get processInfo(): ProcessInfo | null { return null; }

  get collectedOutput(): string { return this._collectedOutput; }

  get contextUsage(): ContextUsage | null { return this._contextUsage; }

  get queuedMessageCount(): number { return this.inputQueue.length; }

  get queuedMessages(): string[] { return [...this.inputQueue]; }

  get isWaitingForInput(): boolean {
    return this._mode === 'interactive' && this._status === 'running' && this.abortController === null;
  }

  get waitingVersion(): number { return this._waitingVersion; }

  get sessionId(): string | null { return null; }

  get sessionError(): string | null { return null; }

  get permissionMode(): 'acceptEdits' | 'plan' | null { return null; }

  start(instructions: string): void {
    this._status = 'running';
    this._lastCommand = `sdk:${this._model}`;
    this.emitter.emit('status', this._status);

    this.emitMessage({
      type: 'system',
      content: `SDK Agent started (model: ${this._model})`,
      timestamp: new Date().toISOString(),
    });

    // Process the initial message
    void this.processMessage(instructions);
  }

  async stop(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this._status = 'stopped';
    this.emitter.emit('status', this._status);
    this.emitter.emit('exit', 0);
  }

  sendInput(input: string): void {
    if (this.abortController) {
      // Currently processing, queue the message
      this.inputQueue.push(input);
      return;
    }

    void this.processMessage(input);
  }

  sendToolResult(_toolUseId: string, _content: string): void {
    // Tool use not supported in initial SDK agent
  }

  removeQueuedMessage(index: number): boolean {
    if (index < 0 || index >= this.inputQueue.length) return false;
    this.inputQueue.splice(index, 1);
    return true;
  }

  on<K extends keyof AgentEvents>(event: K, listener: AgentEvents[K]): void {
    this.emitter.on(event, listener);
  }

  off<K extends keyof AgentEvents>(event: K, listener: AgentEvents[K]): void {
    this.emitter.off(event, listener);
  }

  private async processMessage(userMessage: string): Promise<void> {
    this.conversationHistory.push({ role: 'user', content: userMessage });

    this.emitMessage({
      type: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    });

    this.abortController = new AbortController();
    this.emitWaiting(false);

    try {
      const model = this.createModel();
      const response = await this.streamResponse(model);

      this.conversationHistory.push({ role: 'assistant', content: response });
      this.updateContextEstimate();
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        this.logger.info('SDK agent aborted', { projectId: this.projectId });
        return;
      }

      this.logger.error('SDK agent error', {
        projectId: this.projectId,
        error: error instanceof Error ? error.message : String(error),
      });

      this.emitMessage({
        type: 'system',
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date().toISOString(),
      });
    } finally {
      this.abortController = null;
      this.emitWaiting(true);
    }

    // Process queued messages
    this.processQueuedMessages();
  }

  private createModel(): LanguageModel {
    const apiKey = this._agentProfile?.anthropicConfig?.apiKey;

    const anthropic = createAnthropic({
      ...(apiKey ? { apiKey } : {}),
    });

    return anthropic(this._model);
  }

  private async streamResponse(model: LanguageModel): Promise<string> {
    const result = streamText({
      model,
      messages: this.conversationHistory.map(m => ({
        role: m.role,
        content: m.content,
      })),
      abortSignal: this.abortController?.signal,
    });

    let fullText = '';

    for await (const chunk of result.textStream) {
      fullText += chunk;
      this._collectedOutput += chunk;

      this.emitMessage({
        type: 'stdout',
        content: chunk,
        timestamp: new Date().toISOString(),
      });
    }

    return fullText;
  }

  private processQueuedMessages(): void {
    if (this.inputQueue.length > 0 && this._status === 'running') {
      const nextMessage = this.inputQueue.shift()!;
      void this.processMessage(nextMessage);
    }
  }

  private updateContextEstimate(): void {
    // Rough estimate: ~4 chars per token
    const totalChars = this.conversationHistory.reduce(
      (sum, m) => sum + m.content.length, 0,
    );
    const estimatedTokens = Math.ceil(totalChars / 4);

    this._contextUsage = {
      inputTokens: estimatedTokens,
      outputTokens: 0,
      totalTokens: estimatedTokens,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,
      percentUsed: Math.round((estimatedTokens / DEFAULT_MAX_CONTEXT_TOKENS) * 10000) / 100,
    };
  }

  private emitMessage(message: AgentMessage): void {
    this.emitter.emit('message', message);
  }

  private emitWaiting(isWaiting: boolean): void {
    this._waitingVersion++;

    const waitingStatus: WaitingStatus = {
      isWaiting,
      version: this._waitingVersion,
    };

    this.emitter.emit('waitingForInput', waitingStatus);
  }
}
