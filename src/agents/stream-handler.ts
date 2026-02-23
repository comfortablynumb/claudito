import { EventEmitter } from 'events';
import { Logger } from '../utils';
import {
  AgentMessage,
  ToolUseInfo,
  QuestionInfo,
  PermissionRequest,
  PlanModeInfo,
  ResultInfo,
  StatusChangeInfo,
  ContextUsage,
  WaitingStatus,
} from './types';

export interface ContentBlock {
  toolUse?: {
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  };
}

export interface StreamEventUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface StreamEvent {
  type: string;
  index?: number;
  message?: {
    id?: string;
    type?: string;
    role?: string;
    model?: string;
    usage?: StreamEventUsage;
  };
  content_block?: ContentBlock;
  delta?: {
    text?: string;
    partial_json?: string;
    type?: string;
  };
  error?: {
    type?: string;
    message?: string;
  };
  text?: string;
  message_id?: string;
  assistant_event_type?: string;
  user_event_type?: string;
  user_input?: Record<string, unknown>;
  conversation_id?: string;
  timestamp?: string;
  usage?: StreamEventUsage;
  message_limit_type?: string;
  tool_use_id?: string;
  content?: string;
}

export interface StreamHandlerEvents {
  message: (message: AgentMessage) => void;
  waitingForInput: (status: WaitingStatus) => void;
  contextUsage: (usage: ContextUsage) => void;
  error: (error: Error) => void;
  sessionNotFound: (sessionId: string) => void;
  permissionRequest: (request: PermissionRequest) => void;
  exitPlanMode: (planContent: string) => void;
}

/**
 * Handles streaming events from Claude CLI process.
 * Extracts and emits structured messages from raw stream data.
 */
export class StreamHandler extends EventEmitter {
  private currentToolUse: ToolUseInfo | null = null;
  private currentToolName: string | null = null;
  private currentContentBlock: ContentBlock | null = null;
  private partialJson = '';
  private contextUsage: ContextUsage | null = null;
  private waitingVersion = 0;
  // Track emitted content to avoid duplicates from cumulative CLI events
  private lastEmittedText = '';
  private emittedToolIds = new Set<string>();
  private hasEmittedExitPlanMode = false;
  private hasEmittedEnterPlanMode = false;
  private hasEmittedAskUserQuestion = false;
  private askUserQuestionToolIds = new Set<string>();
  private lastEmittedQuestion = '';

  constructor(
    private readonly logger: Logger,
    private readonly projectId: string,
    private readonly sessionId: string | null
  ) {
    super();
  }

  /**
   * Process a line from the Claude CLI stream.
   * With --output-format stream-json, output is plain JSON lines (no SSE prefix).
   */
  processLine(line: string): void {
    const trimmed = line.trim();

    if (!trimmed) {
      return;
    }

    this.logger.debug('STDOUT <<< Processing line', {
      direction: 'output',
      eventType: 'stream_line',
      length: trimmed.length,
      preview: trimmed.substring(0, 200),
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      // Not valid JSON, emit as plain text output
      this.logger.debug('Non-JSON output', { lineLength: trimmed.length });
      this.emitTextMessage(trimmed);
      return;
    }

    if (typeof parsed !== 'object' || parsed === null) {
      // Not a JSON object, emit as plain text
      this.emitTextMessage(trimmed);
      return;
    }

    try {
      const event = parsed as StreamEvent;
      this.handleStreamEvent(event);
    } catch (error) {
      // Error handling the event - log it but don't lose the message
      this.logger.error('Error handling stream event', {
        error: error instanceof Error ? error.message : 'Unknown error',
        eventType: (parsed as Record<string, unknown>).type,
      });
    }
  }

  /**
   * Handle raw event types (not JSON).
   */
  private handleRawEvent(line: string): void {
    const eventType = line.substring(7).trim();

    switch (eventType) {
      case 'ping':
        // Heartbeat event, no action needed
        break;
      default:
        this.logger.debug('Unhandled raw event type', { eventType });
    }
  }

  // Event handler map for efficient routing
  private readonly eventHandlers: Record<string, (event: StreamEvent) => void> = {
    // Claude CLI event types
    'system': (event) => this.handleSystemEvent(event),
    'assistant': (event) => this.handleAssistantMessage(event),
    'user': (event) => this.handleUserMessage(event),

    // API streaming event types (kept for compatibility)
    'message_start': (event) => this.handleMessageStart(event),
    'content_block_start': (event) => this.handleContentBlockStart(event),
    'content_block_delta': (event) => this.handleContentBlockDelta(event),
    'content_block_stop': () => this.handleContentBlockStop(),
    'message_delta': (event) => this.handleMessageDelta(event),
    'message_stop': () => this.handleMessageStop(),
    'error': (event) => this.handleError(event),
    'assistant_event': (event) => this.handleAssistantEvent(event),
    'user_event': (event) => this.handleUserEvent(event),
    'permission_request': (event) => this.handlePermissionRequest(event),
    'stdout': (event) => this.emitOutputMessage('stdout', event.content || ''),
    'stderr': (event) => this.emitOutputMessage('stderr', event.content || ''),
    'result': (event) => this.handleResult(event),
    'session_not_found': (event) => this.handleSessionNotFound(event),
    'status_change': (event) => this.handleStatusChange(event),
    'rate_limit_event': (event) => this.logger.info('Rate limit event received', {
      retryAfterMs: (event as unknown as { retry_after_ms?: number }).retry_after_ms,
    }),
  };

  /**
   * Main event router for stream events.
   * Handles both Claude CLI events (system, assistant, user) and API streaming events.
   */
  private handleStreamEvent(event: StreamEvent): void {
    const { type } = event;
    const handler = this.eventHandlers[type];

    if (handler) {
      handler(event);
    } else {
      this.logger.debug('Unhandled stream event type', { type });
    }
  }

  /**
   * Handle Claude CLI system events (init, status, etc.)
   */
  private handleSystemEvent(event: StreamEvent): void {
    // Cast to access CLI-specific fields
    const cliEvent = event as unknown as {
      subtype?: string;
      session_id?: string;
      status?: string;
    };

    switch (cliEvent.subtype) {
      case 'init':
        this.logger.info('Claude CLI initialized', {
          sessionId: cliEvent.session_id,
        });
        // Reset tracking for new session
        this.resetEmittedTracking();

        // Emit a system message with the session ID so the agent can capture it
        if (cliEvent.session_id) {
          this.emitMessage({
            type: 'system',
            content: `Session ID: ${cliEvent.session_id}`,
            timestamp: new Date().toISOString(),
          });
        }
        break;
      case 'status':
        this.logger.info('Claude CLI status', { status: cliEvent.status });
        if (cliEvent.status === 'compacting') {
          // Emit status change message when compaction starts
          this.emitStatusChangeMessage('compacting');
        }
        break;
      case 'compact':
        this.logger.info('Claude CLI compact reached');
        // Emit compaction message
        this.emitCompactionMessage(event.content || 'Context was compacted');
        break;
      case 'compact_boundary':
        this.logger.info('Claude CLI compact boundary reached');
        // Emit compaction message when compaction completes
        this.emitCompactionMessage('Context has been compacted to reduce token usage');
        break;
      default:
        this.logger.debug('Unhandled system subtype', { subtype: cliEvent.subtype });
    }
  }

  /**
   * Reset tracking for emitted content (called when new turn starts).
   */
  private resetEmittedTracking(): void {
    this.lastEmittedText = '';
    this.emittedToolIds.clear();
    this.hasEmittedExitPlanMode = false;
    this.hasEmittedEnterPlanMode = false;
    this.hasEmittedAskUserQuestion = false;
    this.askUserQuestionToolIds.clear();
    this.lastEmittedQuestion = '';
  }

  /**
   * Handle Claude CLI assistant message events.
   * These contain the full assistant message with content blocks.
   * Note: Claude CLI sends cumulative content, so we track what we've emitted
   * to avoid duplicating output.
   */
  private handleAssistantMessage(event: StreamEvent): void {
    const message = this.extractAssistantMessage(event);
    if (!message?.content) {
      return;
    }

    // Update context usage if available
    if (message.usage) {
      this.updateContextUsage(message.usage);
    }

    // Process each content block
    for (const block of message.content) {
      this.processAssistantContentBlock(block);
    }
  }

  /**
   * Extract and type the assistant message from the event.
   */
  private extractAssistantMessage(event: StreamEvent): {
    id?: string;
    content?: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
    usage?: StreamEventUsage;
  } {
    return event.message as {
      id?: string;
      content?: Array<{
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
      usage?: StreamEventUsage;
    };
  }

  /**
   * Process a single content block from an assistant message.
   */
  private processAssistantContentBlock(block: {
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }): void {
    if (block.type === 'text' && block.text) {
      this.processTextBlock(block.text);
    } else if (block.type === 'tool_use' && block.id) {
      this.processToolUseBlock(block);
    }
  }

  /**
   * Process a text content block, only emitting new content.
   */
  private processTextBlock(text: string): void {
    const newText = this.getNewTextContent(text);
    if (newText) {
      this.emitTextMessage(newText);
    }
  }

  /**
   * Process a tool use content block.
   */
  private processToolUseBlock(block: {
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }): void {
    if (!block.id) {
      return;
    }

    // Only emit tool use if we haven't seen this tool ID
    if (this.emittedToolIds.has(block.id)) {
      return;
    }

    this.emittedToolIds.add(block.id);

    // Check for special tools
    if (block.name === 'ExitPlanMode') {
      this.handleExitPlanModeTool(block.input);
    } else if (block.name === 'AskUserQuestion') {
      this.handleAskUserQuestionTool(block.input, block.id);
    } else if (block.name === 'EnterPlanMode') {
      this.handleEnterPlanModeTool();
    } else {
      this.emitToolMessage(block.name || 'unknown', block.input || {}, block.id);
    }
  }

  /**
   * Handle the special EnterPlanMode tool.
   */
  private handleEnterPlanModeTool(): void {
    // Prevent multiple EnterPlanMode events in the same turn
    if (this.hasEmittedEnterPlanMode) {
      this.logger.warn('Ignoring duplicate EnterPlanMode in same turn');
      return;
    }

    this.hasEmittedEnterPlanMode = true;
    this.emit('enterPlanMode');
    this.emitPlanModeMessage('enter');
  }

  /**
   * Handle the special ExitPlanMode tool.
   */
  private handleExitPlanModeTool(input?: Record<string, unknown>): void {
    // Prevent multiple ExitPlanMode events in the same turn
    if (this.hasEmittedExitPlanMode) {
      this.logger.warn('Ignoring duplicate ExitPlanMode in same turn');
      return;
    }

    const planContent = this.extractPlanContent(input) || '';
    this.logger.info('ExitPlanMode detected', { hasPlanContent: !!planContent });
    this.hasEmittedExitPlanMode = true;
    this.emit('exitPlanMode', planContent);
    // Don't emit plan mode message here - agent-manager will handle it with better content
  }

  /**
   * Handle the special AskUserQuestion tool.
   */
  private handleAskUserQuestionTool(
    input?: Record<string, unknown>,
    toolId?: string
  ): void {
    if (!input || !toolId) {
      return;
    }

    // Mark that AskUserQuestion tool was emitted to suppress duplicate question messages
    this.hasEmittedAskUserQuestion = true;
    this.askUserQuestionToolIds.add(toolId);

    // Emit as a tool_use message so the frontend can render it properly
    this.emitToolMessage('AskUserQuestion', input, toolId);

    // Build question data from tool input
    const questions = Array.isArray(input.questions)
      ? (input.questions as Array<{
          question?: string;
          header?: string;
          options?: Array<{ label?: string; description?: string }>;
          multiSelect?: boolean;
        }>).map(q => ({
          question: q.question || '',
          header: q.header,
          options: Array.isArray(q.options) ? q.options.map(o => ({
            label: o.label || '',
            description: o.description,
          })) : [],
          multiSelect: q.multiSelect,
        }))
      : [];

    // Also emit the waiting for input state with question data
    this.waitingVersion++;
    this.emit('waitingForInput', {
      isWaiting: true,
      version: this.waitingVersion,
      askUserQuestion: { toolId, questions },
    });
  }

  /**
   * Extract plan content from ExitPlanMode tool input.
   */
  private extractPlanContent(input?: Record<string, unknown>): string | null {
    if (!input) return null;

    // The plan content might be in various fields
    if (typeof input.plan === 'string') {
      return input.plan;
    }

    if (typeof input.planContent === 'string') {
      return input.planContent;
    }

    // If allowedPrompts is provided, format the plan from available data
    if (input.allowedPrompts && Array.isArray(input.allowedPrompts)) {
      const prompts = input.allowedPrompts as Array<{ tool: string; prompt: string }>;
      return prompts.map(p => `${p.tool}: ${p.prompt}`).join('\n');
    }

    return null;
  }

  /**
   * Get only the new portion of text content that hasn't been emitted yet.
   */
  private getNewTextContent(fullText: string): string | null {
    if (fullText.startsWith(this.lastEmittedText)) {
      const newText = fullText.substring(this.lastEmittedText.length);
      if (newText) {
        this.lastEmittedText = fullText;
        return newText;
      }
      return null;
    }
    // Text doesn't match what we've emitted - this is a new message
    this.lastEmittedText = fullText;
    return fullText;
  }

  /**
   * Handle Claude CLI user message events.
   * These typically contain tool results.
   */
  private handleUserMessage(event: StreamEvent): void {
    const message = event.message as {
      content?: Array<{
        type: string;
        tool_use_id?: string;
        content?: string;
        is_error?: boolean;
      }>;
    };

    if (!message?.content) {
      return;
    }

    // Process tool results
    for (const block of message.content) {
      if (block.type === 'tool_result') {
        const toolUseId = block.tool_use_id || 'unknown';

        // Skip AskUserQuestion tool results — the frontend manages its own lifecycle
        // (CLI sends is_error:true as normal "waiting for input" signal)
        if (this.askUserQuestionToolIds.has(toolUseId)) {
          continue;
        }

        const status = block.is_error ? 'failed' : 'completed';
        this.emitToolResultWithId(
          toolUseId,
          status,
          typeof block.content === 'string' ? block.content : JSON.stringify(block.content || '')
        );
      }
    }
  }

  private handleMessageStart(event: StreamEvent): void {
    if (event.message?.usage) {
      this.updateContextUsage(event.message.usage);
    }
  }

  private handleContentBlockStart(event: StreamEvent): void {
    this.currentContentBlock = event.content_block || null;
    if (this.currentContentBlock?.toolUse) {
      this.currentToolUse = {
        name: this.currentContentBlock.toolUse.name || 'unknown',
        id: this.currentContentBlock.toolUse.id,
      };
      this.currentToolName = this.currentContentBlock.toolUse.name || null;
    }
  }

  private handleContentBlockDelta(event: StreamEvent): void {
    if (!event.delta) return;

    if (event.delta.text) {
      this.emitTextMessage(event.delta.text);
    }

    if (event.delta.partial_json) {
      this.partialJson += event.delta.partial_json;
    }
  }

  private handleContentBlockStop(): void {
    if (this.currentToolUse && this.partialJson) {
      try {
        const toolInput = JSON.parse(this.partialJson) as Record<string, unknown>;

        // Route through processToolUseBlock for dedup + special tool handling
        this.processToolUseBlock({
          id: this.currentToolUse.id,
          name: this.currentToolUse.name,
          input: toolInput,
        });
      } catch (error) {
        this.logger.error('Failed to parse tool input JSON', {
          error: error instanceof Error ? error.message : 'Unknown error',
          partialJson: this.partialJson,
        });
      }
    }

    this.currentToolUse = null;
    this.currentToolName = null;
    this.currentContentBlock = null;
    this.partialJson = '';
  }

  private handleMessageDelta(event: StreamEvent): void {
    if (event.usage) {
      this.updateContextUsage(event.usage);
    }
  }

  private handleMessageStop(): void {
    // Message completed
  }

  private handleError(event: StreamEvent): void {
    const errorMessage = event.error?.message || 'Unknown error';
    this.emit('error', new Error(errorMessage));

    this.emitMessage({
      type: 'stderr',
      content: `Error: ${errorMessage}`,
      timestamp: new Date().toISOString(),
    });
  }

  private handleAssistantEvent(event: StreamEvent): void {
    switch (event.assistant_event_type) {
      case 'thinking':
        this.handleThinkingEvent();
        break;
      case 'tool_result':
        this.handleToolResultEvent(event);
        break;
      case 'compaction':
        this.handleCompactionEvent(event);
        break;
      case 'ask_question':
        this.handleAskQuestionAssistantEvent(event);
        break;
      default:
        this.logger.debug('Unhandled assistant event', {
          type: event.assistant_event_type,
        });
    }
  }

  /**
   * Handle thinking event from Claude.
   */
  private handleThinkingEvent(): void {
    // Claude is thinking - we could show this in UI
    // Currently no action needed
  }

  /**
   * Handle ask_question assistant event.
   */
  private handleAskQuestionAssistantEvent(event: StreamEvent): void {
    // Skip question message if AskUserQuestion tool already rendered the interactive UI
    if (this.hasEmittedAskUserQuestion) {
      return;
    }

    // Deduplicate repeated assistant_event ask_question emissions
    const questionContent = event.text || event.content || '';

    if (questionContent && questionContent === this.lastEmittedQuestion) {
      return;
    }

    if (questionContent) {
      this.lastEmittedQuestion = questionContent;
      this.emitMessage({
        type: 'question',
        content: questionContent,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Handle tool result event.
   */
  private handleToolResultEvent(event: StreamEvent): void {
    if (event.tool_use_id) {
      // Skip AskUserQuestion tool results — frontend manages its own lifecycle
      if (this.askUserQuestionToolIds.has(event.tool_use_id)) {
        return;
      }

      this.emitToolResultWithId(
        event.tool_use_id,
        'completed',
        this.extractEventContent(event)
      );
    }
  }

  /**
   * Handle compaction event.
   */
  private handleCompactionEvent(event: StreamEvent): void {
    this.emitCompactionMessage(this.extractEventContent(event));
  }

  private handleUserEvent(event: StreamEvent): void {
    switch (event.user_event_type) {
      case 'question':
        this.handleQuestionEvent(event);
        break;
      case 'tool_use':
        this.handleToolUseEvent(event);
        break;
      case 'plan_mode':
        this.handlePlanModeEvent(event);
        break;
      default:
        this.logger.debug('Unhandled user event', {
          type: event.user_event_type,
        });
    }
  }

  /**
   * Handle question event from user.
   */
  private handleQuestionEvent(event: StreamEvent): void {
    if (event.user_input) {
      this.emitQuestionMessage(event.user_input);
    }
  }

  /**
   * Handle tool use event from user.
   */
  private handleToolUseEvent(event: StreamEvent): void {
    if (!event.user_input) {
      return;
    }

    const { tool_name, ...params } = event.user_input;
    if (typeof tool_name === 'string') {
      this.emitToolMessage(tool_name, params);
    }
  }

  /**
   * Handle plan mode event from user.
   */
  private handlePlanModeEvent(event: StreamEvent): void {
    if (event.user_input?.action) {
      this.emitPlanModeMessage(event.user_input.action as 'enter' | 'exit');
    }
  }

  private handlePermissionRequest(event: StreamEvent): void {
    if (!event.user_input) return;

    const request: PermissionRequest = {
      tool: event.user_input.tool as string,
      operation: event.user_input.operation as string,
      reason: event.user_input.reason as string,
      allowOnce: event.user_input.allow_once as boolean,
      allowAlways: event.user_input.allow_always as boolean,
      deny: event.user_input.deny as boolean,
    };

    this.emit('permissionRequest', request);

    this.emitMessage({
      type: 'permission',
      content: `Permission requested: ${request.tool} - ${request.operation}`,
      timestamp: new Date().toISOString(),
      permissionInfo: request,
    });
  }

  private handleResult(event: StreamEvent): void {
    // CLI result events contain the full response in 'result' field
    // Since handleAssistantMessage already emits the text content,
    // we only need to handle errors here, not re-emit the result
    const cliEvent = event as unknown as {
      result?: string;
      is_error?: boolean;
      subtype?: string;
      errors?: string[];
    };

    if (cliEvent.is_error) {
      // Check for session not found error
      if (cliEvent.errors) {
        for (const error of cliEvent.errors) {
          const match = error.match(/No conversation found with session ID: ([\w-]+)/);
          if (match) {
            this.emit('sessionNotFound', match[1]);
            return;
          }
        }
        // Handle other errors
        this.handleResultErrors(cliEvent.errors);
      } else if (cliEvent.result) {
        this.emitResultMessage(cliEvent.result, true);
      }
    }

    if (!cliEvent.is_error) {
      this.waitingVersion++;
      this.emit('waitingForInput', {
        isWaiting: true,
        version: this.waitingVersion,
      });
    }
  }

  private handleResultErrors(errors: string[]): void {
    for (const error of errors) {
      const match = error.match(/ERROR: (Tool use failed|Failed to use tool) '([^']+)'(?: \(ID: ([^)]+)\))?: (.+)/);
      if (match) {
        const [, , toolName, toolId, reason] = match;
        this.emitToolResult('failed', toolName, reason, toolId);
      } else {
        this.emitResultMessage(error, true);
      }
    }
  }

  private handleSessionNotFound(event: StreamEvent): void {
    if (event.conversation_id && this.sessionId) {
      this.emit('sessionNotFound', this.sessionId);
    }
  }

  private handleStatusChange(event: StreamEvent): void {
    if (event.content) {
      this.emitStatusChangeMessage(event.content);
    }
  }

  private updateContextUsage(usage: StreamEventUsage): void {
    if (!usage.input_tokens && !usage.output_tokens) {
      return;
    }

    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;
    const cacheCreation = usage.cache_creation_input_tokens || 0;
    const cacheRead = usage.cache_read_input_tokens || 0;

    this.contextUsage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cacheCreationInputTokens: cacheCreation,
      cacheReadInputTokens: cacheRead,
      maxContextTokens: 0, // Will be set later
      percentUsed: 0, // Will be calculated later
    };

    this.emit('contextUsage', this.contextUsage);
  }

  private emitMessage(message: AgentMessage): void {
    this.emit('message', message);
  }

  private emitTextMessage(text: string): void {
    this.emitMessage({
      type: 'stdout',
      content: text,
      timestamp: new Date().toISOString(),
    });
  }

  private emitOutputMessage(type: 'stdout' | 'stderr', content: string): void {
    this.emitMessage({
      type,
      content,
      timestamp: new Date().toISOString(),
    });
  }

  private emitToolMessage(name: string, input?: Record<string, unknown>, claudeToolUseId?: string): void {
    const toolInfo: ToolUseInfo = {
      name,
      input: input ? this.sanitizeToolInput(input) : undefined,
      id: claudeToolUseId,
    };

    this.emitMessage({
      type: 'tool_use',
      content: this.formatToolUseMessage(toolInfo),
      timestamp: new Date().toISOString(),
      toolInfo,
    });
  }

  private emitToolResult(
    status: 'completed' | 'failed',
    toolName?: string,
    error?: string,
    toolId?: string
  ): void {
    const resultInfo: ToolUseInfo = {
      name: toolName || this.currentToolName || 'unknown',
      status,
      error,
      id: toolId,
    };

    this.emitMessage({
      type: 'tool_result',
      content: this.formatToolResultMessage(resultInfo),
      timestamp: new Date().toISOString(),
      toolInfo: resultInfo,
    });
  }

  private emitToolResultWithId(
    toolId: string,
    status: 'completed' | 'failed',
    content: string
  ): void {
    const resultInfo: ToolUseInfo = {
      name: this.currentToolName || 'unknown',
      status,
      id: toolId,
      output: content,
    };

    this.emitMessage({
      type: 'tool_result',
      content: this.formatToolResultWithContent(resultInfo, content),
      timestamp: new Date().toISOString(),
      toolInfo: resultInfo,
    });
  }

  private emitQuestionMessage(input: Record<string, unknown>): void {
    // Skip if AskUserQuestion tool already rendered the interactive UI
    if (this.hasEmittedAskUserQuestion) {
      return;
    }

    const questionInfo: QuestionInfo = {
      question: input.question as string || 'Unknown question',
      options: this.extractQuestionOptions(input),
    };

    // Deduplicate repeated question emissions
    const questionKey = questionInfo.question;

    if (questionKey === this.lastEmittedQuestion) {
      return;
    }

    this.lastEmittedQuestion = questionKey;

    this.emitMessage({
      type: 'question',
      content: this.formatQuestionMessage(questionInfo),
      timestamp: new Date().toISOString(),
      questionInfo,
    });
  }

  private emitPlanModeMessage(action: 'enter' | 'exit'): void {
    const planModeInfo: PlanModeInfo = { action };

    this.emitMessage({
      type: 'plan_mode',
      content: action === 'enter'
        ? '📋 Entering plan mode...'
        : '✅ Exiting plan mode',
      timestamp: new Date().toISOString(),
      planModeInfo,
    });
  }

  private emitCompactionMessage(summary: string): void {
    this.emitMessage({
      type: 'compaction',
      content: summary,
      timestamp: new Date().toISOString(),
    });
  }

  private emitResultMessage(result: string, isError: boolean): void {
    const resultInfo: ResultInfo = {
      result,
      isError,
    };

    this.emitMessage({
      type: 'result',
      content: result,
      timestamp: new Date().toISOString(),
      resultInfo,
    });
  }

  private emitStatusChangeMessage(status: string): void {
    const statusChangeInfo: StatusChangeInfo = { status };

    this.emitMessage({
      type: 'status_change',
      content: `Status: ${status}`,
      timestamp: new Date().toISOString(),
      statusChangeInfo,
    });
  }

  private extractEventContent(event: StreamEvent): string {
    if (event.text) return event.text;

    if (event.content) {
      return typeof event.content === 'string' ? event.content : JSON.stringify(event.content);
    }

    if (event.message?.type) return event.message.type;
    return 'Unknown content';
  }

  private extractQuestionOptions(input: Record<string, unknown>): Array<{
    label: string;
    value: string;
  }> {
    const options: Array<{ label: string; value: string }> = [];

    if (input.allow_text === true) {
      options.push({ label: 'Enter custom text', value: 'text' });
    }

    // Extract other options from the input
    for (const [key, value] of Object.entries(input)) {
      if (key.startsWith('option_') && typeof value === 'string') {
        options.push({ label: value, value: key });
      }
    }

    return options;
  }

  private sanitizeToolInput(input: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(input)) {
      if (key === 'content' && typeof value === 'string' && value.length > 1000) {
        sanitized[key] = value.substring(0, 1000) + '... (truncated)';
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  private formatToolUseMessage(toolInfo: ToolUseInfo): string {
    let message = `🔧 Using tool: ${toolInfo.name}`;
    if (toolInfo.id) {
      message += ` (ID: ${toolInfo.id})`;
    }
    if (toolInfo.input) {
      message += `\n   Input: ${JSON.stringify(toolInfo.input, null, 2)}`;
    }
    return message;
  }

  private formatToolResultMessage(toolInfo: ToolUseInfo): string {
    const icon = toolInfo.status === 'completed' ? '✅' : '❌';
    let message = `${icon} Tool ${toolInfo.status}: ${toolInfo.name}`;
    if (toolInfo.id) {
      message += ` (ID: ${toolInfo.id})`;
    }
    if (toolInfo.error) {
      message += `\n   Error: ${toolInfo.error}`;
    }
    return message;
  }

  private formatToolResultWithContent(toolInfo: ToolUseInfo, content: string): string {
    const icon = toolInfo.status === 'completed' ? '✅' : '❌';
    let message = `${icon} Tool result for ${toolInfo.name}`;
    if (toolInfo.id) {
      message += ` (ID: ${toolInfo.id})`;
    }
    if (content) {
      message += `:\n${content}`;
    }
    return message;
  }

  private formatQuestionMessage(questionInfo: QuestionInfo): string {
    let message = `❓ ${questionInfo.question}`;

    if (questionInfo.options.length > 0) {
      message += '\n\nOptions:';
      questionInfo.options.forEach((opt, idx) => {
        message += `\n  ${idx + 1}. ${opt.label}`;
      });
    }

    return message;
  }

  /**
   * Reset the stream handler state.
   */
  reset(): void {
    this.currentToolUse = null;
    this.currentToolName = null;
    this.currentContentBlock = null;
    this.partialJson = '';
    this.contextUsage = null;
    this.waitingVersion = 0;
  }

  /**
   * Get the current context usage.
   */
  getContextUsage(): ContextUsage | null {
    return this.contextUsage;
  }

  /**
   * Set max context tokens for percentage calculation.
   */
  setMaxContextTokens(maxTokens: number): void {
    if (this.contextUsage) {
      this.contextUsage.maxContextTokens = maxTokens;
      this.contextUsage.percentUsed = maxTokens > 0
        ? Math.round((this.contextUsage.totalTokens / maxTokens) * 100)
        : 0;
      // Note: Don't emit contextUsage here to avoid infinite loop
      // (this method is called in response to contextUsage events)
    }
  }
}