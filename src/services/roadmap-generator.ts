import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { getLogger, Logger } from '../utils/logger';

export interface ProcessSpawner {
  spawn(command: string, args: string[], options: SpawnOptions): ChildProcess;
}

export interface SpawnOptions {
  cwd: string;
  shell: boolean;
  stdio?: ('pipe' | 'inherit' | 'ignore')[];
}

export interface FileOperations {
  mkdir(dirPath: string): Promise<void>;
  exists(filePath: string): Promise<boolean>;
}

const defaultFileOps: FileOperations = {
  mkdir: async (dirPath) => {
    await fs.promises.mkdir(dirPath, { recursive: true });
  },
  exists: async (filePath) => {
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  },
};

const isWindows = process.platform === 'win32';

function escapeArgForShell(arg: string): string {
  if (isWindows) {
    // Windows cmd.exe: wrap in double quotes if contains special chars
    // Internal double quotes are escaped by doubling them
    // Newlines must be removed/replaced as cmd.exe treats them as command separators
    const needsQuoting = /[\s"&|<>^()\n\r]/.test(arg);

    if (needsQuoting) {
      // Replace newlines with space - cmd.exe cannot handle literal newlines in args
      const sanitized = arg.replace(/\r?\n/g, ' ').replace(/"/g, '""');
      return `"${sanitized}"`;
    }
    return arg;
  } else {
    // Unix: wrap in single quotes (safest), escape internal single quotes
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

const defaultSpawner: ProcessSpawner = {
  spawn: (command, args, options) => {
    if (options.shell) {
      // Build properly escaped command string for shell execution
      const fullCommand = buildShellCommand(command, args);
      return spawn(fullCommand, [], options);
    }
    return spawn(command, args, options);
  },
};

export interface GenerateRoadmapOptions {
  projectId: string;
  projectPath: string;
  projectName: string;
  prompt: string;
}

export interface GenerateRoadmapResult {
  success: boolean;
  error?: string;
}

export interface RoadmapMessage {
  type: 'stdout' | 'stderr' | 'system' | 'question';
  content: string;
  timestamp: string;
}

export interface RoadmapGeneratorEvents {
  message: (projectId: string, message: RoadmapMessage) => void;
  complete: (projectId: string, result: GenerateRoadmapResult) => void;
}

export interface RoadmapGenerator {
  generate(options: GenerateRoadmapOptions): Promise<GenerateRoadmapResult>;
  sendResponse(projectId: string, response: string): void;
  isGenerating(projectId: string): boolean;
  on<K extends keyof RoadmapGeneratorEvents>(event: K, listener: RoadmapGeneratorEvents[K]): void;
  off<K extends keyof RoadmapGeneratorEvents>(event: K, listener: RoadmapGeneratorEvents[K]): void;
}

export interface RoadmapGeneratorDependencies {
  processSpawner?: ProcessSpawner;
  fileOps?: FileOperations;
}

interface ActiveProcess {
  process: ChildProcess;
  projectPath: string;
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  name?: string;
}

interface StreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: {
    content?: ContentBlock[];
  };
  delta?: {
    text?: string;
  };
  content_block?: ContentBlock;
}

export class ClaudeRoadmapGenerator implements RoadmapGenerator {
  private readonly processSpawner: ProcessSpawner;
  private readonly fileOps: FileOperations;
  private readonly emitter: EventEmitter;
  private readonly logger: Logger;
  private readonly activeProcesses: Map<string, ActiveProcess> = new Map();

  constructor(deps: RoadmapGeneratorDependencies = {}) {
    this.processSpawner = deps.processSpawner || defaultSpawner;
    this.fileOps = deps.fileOps || defaultFileOps;
    this.emitter = new EventEmitter();
    this.logger = getLogger('roadmap-generator');
  }

  sendResponse(projectId: string, response: string): void {
    const active = this.activeProcesses.get(projectId);

    if (!active || !active.process.stdin) {
      this.logger.withProject(projectId).warn('Cannot send response - no active process');
      return;
    }

    this.logger.withProject(projectId).info('Sending response to Claude', { response });
    active.process.stdin.write(response + '\n');
    this.emitMessage(projectId, 'system', `You: ${response}`);
  }

  isGenerating(projectId: string): boolean {
    return this.activeProcesses.has(projectId);
  }

  on<K extends keyof RoadmapGeneratorEvents>(event: K, listener: RoadmapGeneratorEvents[K]): void {
    this.emitter.on(event, listener);
  }

  off<K extends keyof RoadmapGeneratorEvents>(event: K, listener: RoadmapGeneratorEvents[K]): void {
    this.emitter.off(event, listener);
  }

  async generate(options: GenerateRoadmapOptions): Promise<GenerateRoadmapResult> {
    const { projectId, projectPath, projectName, prompt } = options;

    try {
      await this.ensureDocFolder(projectPath);
      const fullPrompt = this.buildPrompt(projectName, prompt);

      this.emitMessage(projectId, 'system', 'Starting roadmap generation...');
      const result = await this.runClaude(projectId, projectPath, fullPrompt);
      this.emitter.emit('complete', projectId, result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.emitMessage(projectId, 'system', `Error: ${message}`);
      const result = { success: false, error: message };
      this.emitter.emit('complete', projectId, result);
      return result;
    }
  }

  private emitMessage(projectId: string, type: RoadmapMessage['type'], content: string): void {
    const message: RoadmapMessage = {
      type,
      content,
      timestamp: new Date().toISOString(),
    };
    this.emitter.emit('message', projectId, message);
  }

  private async ensureDocFolder(projectPath: string): Promise<void> {
    const docPath = path.join(projectPath, 'doc');
    const exists = await this.fileOps.exists(docPath);

    if (!exists) {
      await this.fileOps.mkdir(docPath);
    }
  }

  private buildPrompt(projectName: string, userPrompt: string): string {
    return `Create a detailed ROADMAP.md file for the project "${projectName}" in the doc/ folder.

Project Description: ${userPrompt}

The ROADMAP.md should follow this exact format:
- Use ## for phases (e.g., "## Phase 1: Foundation")
- Use ### for milestones (e.g., "### Milestone 1.1: Project Setup")
- Use "- [ ]" for incomplete tasks and "- [x]" for completed tasks
- Include 3-6 phases with 2-4 milestones each
- Each milestone should have 3-6 specific, actionable tasks

Write the ROADMAP.md file to doc/ROADMAP.md now.`;
  }

  private runClaude(projectId: string, projectPath: string, prompt: string): Promise<GenerateRoadmapResult> {
    const projectLogger = this.logger.withProject(projectId);

    return new Promise((resolve) => {
      // Use stdin for prompt to avoid Windows command line length limits
      // --output-format stream-json gives us streaming JSON output
      // --verbose is required when using stream-json with stdin
      const args = [
        '--dangerously-skip-permissions',
        '--output-format', 'stream-json',
        '--verbose',
      ];

      projectLogger.info('Starting roadmap generation', { projectPath });
      this.emitMessage(projectId, 'system', 'Running Claude with streaming output...');

      const proc = this.processSpawner.spawn('claude', args, {
        cwd: projectPath,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Write prompt to stdin and close it
      if (proc.stdin) {
        proc.stdin.write(prompt);
        proc.stdin.end();
      }

      let resolved = false;
      const resolveOnce = (result: GenerateRoadmapResult): void => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          this.activeProcesses.delete(projectId);
          resolve(result);
        }
      };

      // Timeout after 5 minutes
      const timeout = setTimeout(() => {
        projectLogger.warn('Generation timed out after 5 minutes');
        this.emitMessage(projectId, 'system', 'Generation timed out after 5 minutes');
        proc.kill();
        resolveOnce({ success: false, error: 'Generation timed out' });
      }, 5 * 60 * 1000);

      if (!proc.pid) {
        projectLogger.error('Failed to start Claude process');
        this.emitMessage(projectId, 'system', 'Failed to start Claude process');
        resolveOnce({ success: false, error: 'Failed to start Claude process' });
        return;
      }

      // Store active process for sending responses
      this.activeProcesses.set(projectId, { process: proc, projectPath });

      projectLogger.info('Process started', { pid: proc.pid });
      this.emitMessage(projectId, 'system', `Process started with PID: ${proc.pid}`);

      let stderr = '';
      let lineBuffer = '';

      proc.stdout?.on('data', (data: Buffer) => {
        const content = data.toString();
        projectLogger.debug('stdout received', { length: content.length });

        // Handle streaming JSON - each line is a JSON object
        lineBuffer += content;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          this.processStreamLine(projectId, line, projectLogger);
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const content = data.toString();
        projectLogger.debug('stderr received', { content: content.substring(0, 100) });
        stderr += content;
        this.emitMessage(projectId, 'stderr', content);
      });

      proc.on('close', (code: number | null) => {
        // Process any remaining content in buffer
        if (lineBuffer.trim()) {
          this.processStreamLine(projectId, lineBuffer, projectLogger);
        }

        projectLogger.info('Process closed', { code });

        if (code === 0) {
          this.emitMessage(projectId, 'system', 'Roadmap generation complete.');
          resolveOnce({ success: true });
        } else {
          const errorMsg = stderr || `Claude exited with code ${code}`;
          projectLogger.error('Generation failed', { error: errorMsg });
          this.emitMessage(projectId, 'system', `Generation failed: ${errorMsg}`);
          resolveOnce({ success: false, error: errorMsg });
        }
      });

      proc.on('error', (err: Error) => {
        projectLogger.error('Process error', { error: err.message });
        this.emitMessage(projectId, 'system', `Process error: ${err.message}`);
        resolveOnce({ success: false, error: err.message });
      });
    });
  }

  private processStreamLine(projectId: string, line: string, logger: Logger): void {
    try {
      const parsed: unknown = JSON.parse(line);

      if (typeof parsed !== 'object' || parsed === null) {
        this.emitNonEmpty(projectId, 'stdout', line);
        return;
      }

      const event = parsed as StreamEvent;
      this.handleStreamEvent(projectId, event, logger);
      this.checkForQuestions(projectId, event);
    } catch {
      this.emitNonEmpty(projectId, 'stdout', line);
    }
  }

  private emitNonEmpty(projectId: string, type: 'stdout' | 'stderr' | 'system' | 'question', line: string): void {
    if (line.trim()) {
      this.emitMessage(projectId, type, line);
    }
  }

  private handleStreamEvent(projectId: string, event: StreamEvent, logger: Logger): void {
    switch (event.type) {
      case 'assistant':
        this.handleAssistantEvent(projectId, event);
        break;

      case 'content_block_delta':
        if (event.delta?.text) {
          this.emitMessage(projectId, 'stdout', event.delta.text);
        }
        break;

      case 'content_block_start':
        if (event.content_block?.type === 'tool_use' && event.content_block.name) {
          this.emitMessage(projectId, 'system', `Using tool: ${event.content_block.name}`);
        }
        break;

      case 'result':
        logger.info('Received result event', { result: event.subtype });
        break;

      case 'system':
      case 'user':
        break;

      default:
        logger.debug('Unknown event type', { type: event.type, event });
    }
  }

  private handleAssistantEvent(projectId: string, event: StreamEvent): void {
    if (!event.message?.content) return;

    for (const block of event.message.content) {
      if (block.type === 'text' && block.text) {
        this.emitMessage(projectId, 'stdout', block.text);
      } else if (block.type === 'tool_use' && block.name) {
        this.emitMessage(projectId, 'system', `Using tool: ${block.name}`);
      }
    }
  }

  private checkForQuestions(projectId: string, event: StreamEvent): void {
    if (event.type !== 'assistant' || !event.message?.content) return;

    const textContent = event.message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');

    if (this.looksLikeQuestion(textContent)) {
      this.emitMessage(projectId, 'question', textContent);
    }
  }

  private looksLikeQuestion(text: string): boolean {
    // Detect common question patterns from Claude
    const questionPatterns = [
      /\?\s*$/m,                           // Ends with question mark
      /would you like/i,                   // "Would you like..."
      /do you want/i,                      // "Do you want..."
      /should I/i,                         // "Should I..."
      /can you (confirm|clarify|specify)/i, // "Can you confirm/clarify..."
      /please (choose|select|specify)/i,   // "Please choose/select..."
      /which (one|option)/i,               // "Which one/option..."
      /\(y\/n\)/i,                         // Yes/No prompt
      /\[y\/N\]/i,                         // Yes/No prompt
    ];

    return questionPatterns.some(pattern => pattern.test(text));
  }
}
