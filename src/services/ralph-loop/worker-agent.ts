import { ChildProcess, spawn, execFile } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';

import { getLogger, Logger } from '../../utils/logger';
import { MessageBuilder } from '../../agents/message-builder';
import {
  RalphLoopState,
  IterationSummary,
  ContextInitializer,
} from './types';
import { McpServerConfig } from '../../repositories';

const isWindows = process.platform === 'win32';

/**
 * Worker agent status
 */
export type WorkerStatus = 'idle' | 'running' | 'completed' | 'failed';

/**
 * Worker agent events
 */
export interface WorkerAgentEvents {
  output: (content: string) => void;
  status: (status: WorkerStatus) => void;
  complete: (summary: IterationSummary) => void;
  error: (error: string) => void;
  tool_use: (toolInfo: {
    tool_name: string;
    tool_id: string;
    parameters: Record<string, unknown>;
    timestamp: string;
  }) => void;
}

/**
 * Configuration for the worker agent
 */
export interface WorkerAgentConfig {
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
 * WorkerAgent runs a single iteration of work in the Ralph Loop
 *
 * It spawns a Claude process with the worker context, collects output,
 * and produces an IterationSummary when complete.
 */
export class WorkerAgent {
  private readonly projectPath: string;
  private readonly model: string;
  private readonly contextInitializer: ContextInitializer;
  private readonly appendSystemPrompt?: string;
  private readonly mcpServers?: McpServerConfig[];
  private readonly processSpawner: ProcessSpawner;
  private readonly emitter: EventEmitter;
  private readonly logger: Logger;

  private process: ChildProcess | null = null;
  private _status: WorkerStatus = 'idle';
  private lineBuffer: string = '';
  private collectedOutput: string = '';
  private filesModified: string[] = [];
  private tokensUsed: number = 0;
  private mcpConfigPath: string | null = null;
  private startTime: number = 0;
  private isStopping: boolean = false;

  constructor(config: WorkerAgentConfig, processSpawner?: ProcessSpawner) {
    this.projectPath = config.projectPath;
    this.model = config.model;
    this.contextInitializer = config.contextInitializer;
    this.appendSystemPrompt = config.appendSystemPrompt;
    this.mcpServers = config.mcpServers;
    this.processSpawner = processSpawner || defaultSpawner;
    this.emitter = new EventEmitter();
    this.logger = getLogger('WorkerAgent');
  }

  get status(): WorkerStatus {
    return this._status;
  }

  /**
   * Run a worker iteration
   */
  async run(state: RalphLoopState): Promise<IterationSummary> {
    if (this._status === 'running') {
      throw new Error('Worker agent is already running');
    }

    this.reset();
    this.startTime = Date.now();
    this.setStatus('running');

    const context = this.contextInitializer.buildWorkerContext(state);
    const iterationNumber = state.currentIteration;

    this.logger.info('Starting worker iteration', {
      taskId: state.taskId,
      iteration: iterationNumber,
      contextLength: context.length,
    });

    return new Promise<IterationSummary>((resolve, reject) => {
      this.startProcess(context);
      this.setupCompletionHandlers(iterationNumber, resolve, reject);
    });
  }

  /**
   * Stop the worker agent
   */
  async stop(): Promise<void> {
    if (!this.process || this.isStopping) {
      return;
    }

    this.isStopping = true;
    this.logger.info('Stopping worker agent');

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

  on<K extends keyof WorkerAgentEvents>(
    event: K,
    listener: WorkerAgentEvents[K]
  ): void {
    this.emitter.on(event, listener);
  }

  off<K extends keyof WorkerAgentEvents>(
    event: K,
    listener: WorkerAgentEvents[K]
  ): void {
    this.emitter.off(event, listener);
  }

  private reset(): void {
    this.collectedOutput = '';
    this.lineBuffer = '';
    this.filesModified = [];
    this.tokensUsed = 0;
    this.startTime = 0;
    this.isStopping = false;
  }

  private setStatus(status: WorkerStatus): void {
    this._status = status;
    this.emitter.emit('status', status);
  }

  private startProcess(context: string): void {
    const args = this.buildArgs();

    this.logger.info('Spawning Claude process for worker', {
      model: this.model,
      cwd: this.projectPath,
    });

    this.process = this.processSpawner.spawn('claude', args, {
      cwd: this.projectPath,
      shell: true,
      detached: !isWindows,
    });

    if (this.process.pid) {
      this.logger.info('Worker process started', { pid: this.process.pid });
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
      this.mcpConfigPath = MessageBuilder.generateMcpConfig(this.mcpServers, 'ralph-worker');
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
      this.logger.warn('Worker stderr', { content: content.substring(0, 500) });
    });

    this.process.on('error', (err) => {
      this.logger.error('Worker process error', { error: err.message });
      this.setStatus('failed');
      this.emitter.emit('error', err.message);
    });
  }

  private setupCompletionHandlers(
    iterationNumber: number,
    resolve: (summary: IterationSummary) => void,
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
        reject(new Error('Worker was stopped'));
        return;
      }

      const durationMs = Date.now() - this.startTime;

      if (code === 0) {
        this.setStatus('completed');

        const summary: IterationSummary = {
          iterationNumber,
          timestamp: new Date().toISOString(),
          workerOutput: this.collectedOutput,
          filesModified: this.filesModified,
          tokensUsed: this.tokensUsed,
          durationMs,
        };

        this.emitter.emit('complete', summary);
        resolve(summary);
      } else {
        this.setStatus('failed');
        const error = `Worker process exited with code ${code}`;
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
    this.updateUsageFromEvent(event);

    switch (event.type) {
      case 'assistant':
        this.handleAssistantEvent(event);
        break;

      case 'content_block_delta':
        this.handleDeltaEvent(event);
        break;

      case 'result':
        this.logger.debug('Worker received result event', { subtype: event.subtype });
        break;

      case 'content_block_start':
        this.handleContentBlockStartEvent(event);
        break;
    }
  }

  private handleAssistantEvent(event: StreamEvent): void {
    const content = event.message?.content || [];

    for (const block of content) {
      if (block.type === 'tool_use') {
        this.logger.debug('Worker detected tool_use in assistant event', {
          toolName: block.name, toolId: block.id, hasInput: !!block.input,
        });
      }

      if (block.type === 'text' && block.text) {
        this.collectedOutput += block.text;
        this.emitter.emit('output', block.text);
      }

      if (block.type === 'tool_use' && block.name) {
        this.handleToolUse(block.name, block.input, block.id);
      }
    }
  }

  private handleDeltaEvent(event: StreamEvent): void {
    if (event.delta?.text) {
      this.collectedOutput += event.delta.text;
      this.emitter.emit('output', event.delta.text);
    }
  }

  private handleContentBlockStartEvent(event: StreamEvent): void {
    this.logger.debug('Worker received content_block_start', {
      blockType: event.content_block?.type,
      toolName: event.content_block?.name,
    });

    if (event.content_block?.type === 'tool_use' && event.content_block.name) {
      this.handleToolUse(event.content_block.name, event.content_block.input, event.content_block.id);
    }
  }

  private handleToolUse(
    toolName: string,
    input?: Record<string, unknown>,
    id?: string,
  ): void {
    this.logger.info('Worker handleToolUse called', {
      toolName,
      toolId: id,
      hasInput: !!input,
    });

    // Track file modifications
    if (toolName === 'Write' || toolName === 'Edit') {
      this.logger.debug('Worker modified files via tool', { tool: toolName });
    }

    // Emit tool use event
    const toolInfo = {
      tool_name: toolName,
      tool_id: id || '',
      parameters: input || {},
      timestamp: new Date().toISOString(),
    };
    this.logger.info('Worker emitting tool_use event', toolInfo);
    this.emitter.emit('tool_use', toolInfo);
  }

  private updateUsageFromEvent(event: StreamEvent): void {
    const usage = event.usage || event.message?.usage;

    if (usage) {
      const inputTokens = usage.input_tokens || 0;
      const outputTokens = usage.output_tokens || 0;
      this.tokensUsed = inputTokens + outputTokens;
    }
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
