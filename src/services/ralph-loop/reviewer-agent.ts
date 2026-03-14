import { ChildProcess, spawn, execFile } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';

import { getLogger, Logger } from '../../utils/logger';
import { MessageBuilder } from '../../agents/message-builder';
import {
  RalphLoopState,
  ReviewerFeedback,
  ContextInitializer,
} from './types';
import { McpServerConfig } from '../../repositories';

const isWindows = process.platform === 'win32';

/**
 * Reviewer agent status
 */
export type ReviewerStatus = 'idle' | 'running' | 'completed' | 'failed';

/**
 * Reviewer agent events
 */
export interface ReviewerAgentEvents {
  output: (content: string) => void;
  status: (status: ReviewerStatus) => void;
  complete: (feedback: ReviewerFeedback) => void;
  error: (error: string) => void;
  tool_use: (toolInfo: {
    tool_name: string;
    tool_id: string;
    parameters: Record<string, unknown>;
    timestamp: string;
  }) => void;
}

/**
 * Configuration for the reviewer agent
 */
export interface ReviewerAgentConfig {
  projectPath: string;
  model: string;
  contextInitializer: ContextInitializer;
  appendSystemPrompt?: string;
  mcpServers?: McpServerConfig[];
}

/**
 * Process spawner interface for dependency injection
 */
export interface ProcessSpawner {
  spawn(command: string, args: string[], options: SpawnOptions): ChildProcess;
}

export interface SpawnOptions {
  cwd: string;
  shell: boolean;
  detached?: boolean;
}

const defaultSpawner: ProcessSpawner = {
  spawn: (command, args, options) => {
    if (options.shell) {
      const fullCommand = buildShellCommand(command, args);
      return spawn(fullCommand, [], options);
    }

    return spawn(command, args, options);
  },
};

function escapeArgForShell(arg: string): string {
  if (isWindows) {
    const needsQuoting = /[\s"&|<>^()\n\r]/.test(arg);

    if (needsQuoting) {
      const sanitized = arg.replace(/\r?\n/g, ' ').replace(/"/g, '""');
      return `"${sanitized}"`;
    }

    return arg;
  } else {
    if (/[\s"'&|<>()$`\\!*?[\]{}\n]/.test(arg)) {
      return `'${arg.replace(/'/g, "'\\''")}'`;
    }

    return arg;
  }
}

function buildShellCommand(command: string, args: string[]): string {
  const escapedArgs = args.map(escapeArgForShell);
  return `${command} ${escapedArgs.join(' ')}`;
}

/**
 * Stream event from Claude CLI
 */
interface StreamEvent {
  type: string;
  subtype?: string;
  message?: {
    content: Array<{
      type: string;
      text?: string;
      name?: string;
      id?: string;
      input?: Record<string, unknown>;
    }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  delta?: {
    text?: string;
  };
  content_block?: {
    type: string;
    name?: string;
    id?: string;
    input?: Record<string, unknown>;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

/**
 * ReviewerAgent runs the review phase in the Ralph Loop
 *
 * It spawns a Claude process with the reviewer context, collects output,
 * parses the JSON feedback, and produces a ReviewerFeedback when complete.
 */
export class ReviewerAgent {
  private readonly projectPath: string;
  private readonly model: string;
  private readonly contextInitializer: ContextInitializer;
  private readonly appendSystemPrompt?: string;
  private readonly mcpServers?: McpServerConfig[];
  private readonly processSpawner: ProcessSpawner;
  private readonly emitter: EventEmitter;
  private readonly logger: Logger;

  private process: ChildProcess | null = null;
  private _status: ReviewerStatus = 'idle';
  private lineBuffer: string = '';
  private collectedOutput: string = '';
  private startTime: number = 0;
  private isStopping: boolean = false;
  private mcpConfigPath: string | null = null;

  constructor(config: ReviewerAgentConfig, processSpawner?: ProcessSpawner) {
    this.projectPath = config.projectPath;
    this.model = config.model;
    this.contextInitializer = config.contextInitializer;
    this.appendSystemPrompt = config.appendSystemPrompt;
    this.mcpServers = config.mcpServers;
    this.processSpawner = processSpawner || defaultSpawner;
    this.emitter = new EventEmitter();
    this.logger = getLogger('ReviewerAgent');
  }

  get status(): ReviewerStatus {
    return this._status;
  }

  /**
   * Run a reviewer iteration
   */
  async run(state: RalphLoopState, workerOutput: string): Promise<ReviewerFeedback> {
    if (this._status === 'running') {
      throw new Error('Reviewer agent is already running');
    }

    this.reset();
    this.startTime = Date.now();
    this.setStatus('running');

    const context = this.contextInitializer.buildReviewerContext(state, workerOutput);
    const iterationNumber = state.currentIteration;

    this.logger.info('Starting reviewer iteration', {
      taskId: state.taskId,
      iteration: iterationNumber,
      contextLength: context.length,
    });

    return new Promise<ReviewerFeedback>((resolve, reject) => {
      this.startProcess(context);
      this.setupCompletionHandlers(iterationNumber, resolve, reject);
    });
  }

  /**
   * Stop the reviewer agent
   */
  async stop(): Promise<void> {
    if (!this.process || this.isStopping) {
      return;
    }

    this.isStopping = true;
    this.logger.info('Stopping reviewer agent');

    // Clean up MCP config file if it exists
    if (this.mcpConfigPath) {
      try {
        fs.unlinkSync(this.mcpConfigPath);
        this.logger.debug('Deleted MCP config file', { path: this.mcpConfigPath });
      } catch (error) {
        this.logger.warn('Failed to delete MCP config file', {
          path: this.mcpConfigPath,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      this.mcpConfigPath = null;
    }

    this.process.stdout?.removeAllListeners('data');
    this.process.stderr?.removeAllListeners('data');

    const pid = this.process.pid;

    if (!pid) {
      this.process = null;
      return;
    }

    return new Promise((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }

      const forceKillTimeout = setTimeout(() => {
        this.forceKillProcess(pid);
      }, 5000);

      this.process.once('exit', () => {
        clearTimeout(forceKillTimeout);
        resolve();
      });

      this.killProcessTree(pid);
    });
  }

  on<K extends keyof ReviewerAgentEvents>(
    event: K,
    listener: ReviewerAgentEvents[K]
  ): void {
    this.emitter.on(event, listener);
  }

  off<K extends keyof ReviewerAgentEvents>(
    event: K,
    listener: ReviewerAgentEvents[K]
  ): void {
    this.emitter.off(event, listener);
  }

  private reset(): void {
    this.collectedOutput = '';
    this.lineBuffer = '';
    this.startTime = 0;
    this.isStopping = false;
  }

  private setStatus(status: ReviewerStatus): void {
    this._status = status;
    this.emitter.emit('status', status);
  }

  private startProcess(context: string): void {
    const args = this.buildArgs();

    this.logger.info('Spawning Claude process for reviewer', {
      model: this.model,
      cwd: this.projectPath,
    });

    this.process = this.processSpawner.spawn('claude', args, {
      cwd: this.projectPath,
      shell: true,
      detached: !isWindows,
    });

    if (this.process.pid) {
      this.logger.info('Reviewer process started', { pid: this.process.pid });
    }

    this.setupProcessHandlers();
    this.sendContext(context);
  }

  private buildArgs(): string[] {
    const args: string[] = ['--print'];

    // Use the configured model
    args.push('--model', this.model);

    // Skip permissions for autonomous operation
    args.push('--dangerously-skip-permissions');

    // Add append system prompt if configured
    if (this.appendSystemPrompt) {
      args.push('--append-system-prompt', this.appendSystemPrompt);
    }

    // Generate MCP config file if we have servers
    if (this.mcpServers && this.mcpServers.length > 0) {
      this.mcpConfigPath = MessageBuilder.generateMcpConfig(this.mcpServers, 'ralph-reviewer');
      if (this.mcpConfigPath) {
        args.push('--mcp-config', this.mcpConfigPath);
      }
    }

    // Add plugin directory
    const pluginPath = path.join(this.projectPath, 'claudito-plugin');
    args.push('--plugin-dir', pluginPath);

    // Use stream-json for structured output
    args.push('--input-format', 'stream-json');
    args.push('--output-format', 'stream-json');
    args.push('--verbose');

    return args;
  }


  private sendContext(context: string): void {
    if (!this.process?.stdin) {
      this.logger.error('Cannot send context - stdin not available');
      return;
    }

    const message = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: context,
      },
    });

    this.process.stdin.write(message + '\n');
    this.process.stdin.end();
  }

  private setupProcessHandlers(): void {
    if (!this.process) {
      return;
    }

    this.lineBuffer = '';

    this.process.stdout?.on('data', (data: Buffer) => {
      const content = data.toString();

      this.lineBuffer += content;
      const lines = this.lineBuffer.split('\n');
      this.lineBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        this.processStreamLine(line);
      }
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const content = data.toString();
      this.logger.warn('Reviewer stderr', { content: content.substring(0, 500) });
    });

    this.process.on('error', (err) => {
      this.logger.error('Reviewer process error', { error: err.message });
      this.setStatus('failed');
      this.emitter.emit('error', err.message);
    });
  }

  private setupCompletionHandlers(
    iterationNumber: number,
    resolve: (feedback: ReviewerFeedback) => void,
    reject: (error: Error) => void
  ): void {
    if (!this.process) {
      reject(new Error('Process not started'));
      return;
    }

    this.process.on('exit', (code) => {
      // Process any remaining buffer
      if (this.lineBuffer.trim()) {
        this.processStreamLine(this.lineBuffer);
      }

      if (this.isStopping) {
        reject(new Error('Reviewer was stopped'));
        return;
      }

      if (code === 0) {
        const feedback = this.parseReviewerOutput(iterationNumber);

        if (feedback) {
          this.setStatus('completed');
          this.emitter.emit('complete', feedback);
          resolve(feedback);
        } else {
          this.setStatus('failed');
          const error = 'Failed to parse reviewer feedback';
          this.emitter.emit('error', error);
          reject(new Error(error));
        }
      } else {
        this.setStatus('failed');
        const error = `Reviewer process exited with code ${code}`;
        this.emitter.emit('error', error);
        reject(new Error(error));
      }

      // Clean up MCP config file on exit
      if (this.mcpConfigPath) {
        try {
          fs.unlinkSync(this.mcpConfigPath);
          this.logger.debug('Deleted MCP config file on exit', { path: this.mcpConfigPath });
        } catch (error) {
          this.logger.warn('Failed to delete MCP config file on exit', {
            path: this.mcpConfigPath,
            error: error instanceof Error ? error.message : String(error)
          });
        }
        this.mcpConfigPath = null;
      }

      this.process = null;
    });
  }

  private processStreamLine(line: string): void {
    try {
      const parsed: unknown = JSON.parse(line);

      if (typeof parsed !== 'object' || parsed === null) {
        if (line.trim()) {
          this.collectedOutput += line + '\n';
          this.emitter.emit('output', line);
        }

        return;
      }

      const event = parsed as StreamEvent;
      this.handleStreamEvent(event);
    } catch {
      if (line.trim()) {
        this.collectedOutput += line + '\n';
        this.emitter.emit('output', line);
      }
    }
  }

  private handleStreamEvent(event: StreamEvent): void {
    switch (event.type) {
      case 'assistant':
        this.handleAssistantEvent(event);
        break;

      case 'content_block_delta':
        this.handleDeltaEvent(event);
        break;

      case 'result':
        this.logger.debug('Reviewer received result event', { subtype: event.subtype });
        break;

      case 'content_block_start':
        this.handleContentBlockStart(event);
        break;
    }
  }

  private handleAssistantEvent(event: StreamEvent): void {
    const content = event.message?.content || [];

    for (const block of content) {
      if (block.type === 'text' && block.text) {
        this.collectedOutput += block.text;
        this.emitter.emit('output', block.text);
      } else if (block.type === 'tool_use' && block.name) {
        this.emitToolUse(block.name, block.id, block.input);
      }
    }
  }

  private handleDeltaEvent(event: StreamEvent): void {
    if (event.delta?.text) {
      this.collectedOutput += event.delta.text;
      this.emitter.emit('output', event.delta.text);
    }
  }

  private handleContentBlockStart(event: StreamEvent): void {
    if (event.content_block?.type === 'tool_use' && event.content_block.name) {
      this.emitToolUse(event.content_block.name, event.content_block.id, event.content_block.input);
    }
  }

  private emitToolUse(name: string, id?: string, input?: Record<string, unknown>): void {
    this.emitter.emit('tool_use', {
      tool_name: name,
      tool_id: id || '',
      parameters: input || {},
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Parse the reviewer output to extract structured feedback
   */
  private parseReviewerOutput(iterationNumber: number): ReviewerFeedback | null {
    const output = this.collectedOutput.trim();

    // Try to find JSON in the output
    const jsonMatch = this.extractJsonFromOutput(output);

    if (jsonMatch) {
      return this.parseJsonFeedback(jsonMatch, iterationNumber);
    }

    // Fall back to creating feedback from raw output
    return this.createFallbackFeedback(output, iterationNumber);
  }

  /**
   * Extract JSON object from output (handles markdown code blocks)
   */
  private extractJsonFromOutput(output: string): string | null {
    // Try to find JSON in markdown code block
    const codeBlockMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/);

    if (codeBlockMatch && codeBlockMatch[1]) {
      return codeBlockMatch[1].trim();
    }

    // Try to find raw JSON object
    const jsonMatch = output.match(/\{[\s\S]*"decision"[\s\S]*\}/);

    if (jsonMatch && jsonMatch[0]) {
      return jsonMatch[0];
    }

    return null;
  }

  /**
   * Parse JSON feedback
   */
  private parseJsonFeedback(json: string, iterationNumber: number): ReviewerFeedback | null {
    try {
      const parsed = JSON.parse(json) as Record<string, unknown>;

      // Validate required fields
      if (!parsed.decision || typeof parsed.decision !== 'string') {
        this.logger.warn('Invalid feedback JSON: missing decision');
        return null;
      }

      const decision = this.normalizeDecision(parsed.decision);

      if (!decision) {
        this.logger.warn('Invalid decision value', { decision: parsed.decision });
        return null;
      }

      return {
        iterationNumber,
        timestamp: new Date().toISOString(),
        decision,
        feedback: typeof parsed.feedback === 'string' ? parsed.feedback : '',
        specificIssues: Array.isArray(parsed.specificIssues)
          ? parsed.specificIssues.filter((i): i is string => typeof i === 'string')
          : [],
        suggestedImprovements: Array.isArray(parsed.suggestedImprovements)
          ? parsed.suggestedImprovements.filter((i): i is string => typeof i === 'string')
          : [],
      };
    } catch (e) {
      this.logger.warn('Failed to parse feedback JSON', { error: (e as Error).message });
      return null;
    }
  }

  /**
   * Normalize decision string
   */
  private normalizeDecision(decision: string): 'approve' | 'reject' | 'needs_changes' | null {
    const normalized = decision.toLowerCase().trim();

    switch (normalized) {
      case 'approve':
      case 'approved':
        return 'approve';
      case 'reject':
      case 'rejected':
        return 'reject';
      case 'needs_changes':
      case 'needs-changes':
      case 'needschanges':
      case 'changes_needed':
      case 'revise':
        return 'needs_changes';
      default:
        return null;
    }
  }

  /**
   * Create fallback feedback when JSON parsing fails
   */
  private createFallbackFeedback(output: string, iterationNumber: number): ReviewerFeedback {
    // Try to detect decision from text
    let decision: 'approve' | 'reject' | 'needs_changes' = 'needs_changes';

    const lowerOutput = output.toLowerCase();

    if (lowerOutput.includes('approved') || lowerOutput.includes('looks good')) {
      decision = 'approve';
    } else if (lowerOutput.includes('rejected') || lowerOutput.includes('critical')) {
      decision = 'reject';
    }

    return {
      iterationNumber,
      timestamp: new Date().toISOString(),
      decision,
      feedback: output.substring(0, 1000), // Limit feedback length
      specificIssues: [],
      suggestedImprovements: [],
    };
  }

  private killProcessTree(pid: number): void {
    if (isWindows) {
      // Use execFile to prevent command injection
      execFile('taskkill', ['/PID', String(pid), '/T'], () => {});
    } else {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // Process may already be dead
        }
      }
    }
  }

  private forceKillProcess(pid: number): void {
    if (isWindows) {
      // Use execFile to prevent command injection
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => {});
    } else {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Process may already be dead
        }
      }
    }
  }
}
