import { AgentMessage, AgentMode } from './claude-agent';
import { McpServerConfig } from '../repositories/settings';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Utilities for building and formatting agent messages.
 */
export class MessageBuilder {
  /**
   * Build a user message with optional images.
   */
  static buildUserMessage(content: string, images?: Array<{ data: string; mediaType: string }>): string {
    if (!images || images.length === 0) {
      return content;
    }

    // Build multimodal message with images
    const parts: string[] = [];

    // Add images first
    for (const image of images) {
      parts.push(`<image media_type="${image.mediaType}">${image.data}</image>`);
    }

    // Add text content
    parts.push(content);

    return parts.join('\n\n');
  }

  /**
   * Build command line arguments for Claude CLI.
   * Both interactive and autonomous modes use --print with stream-json format.
   * Messages are always sent via stdin, never as CLI arguments.
   */
  static buildArgs(options: {
    mode: AgentMode;
    sessionId?: string;
    resumeSessionId?: string;
    appendSystemPrompt?: string;
    model?: string;
    waitForReady?: boolean;
    contextTokens?: number;
    agentTurns?: number;
    totalBudget?: number;
    cacheAnything?: boolean;
    allowedTools?: string[];
    disallowedTools?: string[];
    permissionMode?: 'acceptEdits' | 'plan';
    skipPermissions?: boolean;
    message?: string;
    env?: Record<string, string>;
    mcpConfigPath?: string;
    chromeEnabled?: boolean;
  }): string[] {
    const args: string[] = [];

    // Use --print mode for non-interactive piped I/O
    args.push('--print');

    // Add model selection
    if (options.model) {
      args.push('--model', options.model);
    }

    // Always disallow AskUserQuestion — in --print mode the CLI auto-responds
    // with is_error:true before our app can send the real answer via stdin
    const disallowed = MessageBuilder.buildDisallowedTools(options.disallowedTools);
    if (disallowed.length > 0) {
      args.push('--disallowedTools', disallowed.join(' '));
    }

    // Permissions
    if (options.skipPermissions) {
      args.push('--dangerously-skip-permissions');
    } else {
      if (options.permissionMode) {
        args.push('--permission-mode', options.permissionMode);
      }

      // Allowed tools (space-separated string)
      if (options.allowedTools && options.allowedTools.length > 0) {
        args.push('--allowedTools', options.allowedTools.join(' '));
      }

      // Append system prompt (only when not skipping permissions)
      if (options.appendSystemPrompt && options.appendSystemPrompt.trim().length > 0) {
        args.push('--append-system-prompt', options.appendSystemPrompt.trim());
      }
    }

    // Agent limits
    if (options.agentTurns !== undefined && options.agentTurns > 0) {
      args.push('--max-turns', String(options.agentTurns));
    }

    // Handle session ID: use --session-id for new sessions, --resume for existing
    if (options.sessionId) {
      args.push('--session-id', options.sessionId);
    } else if (options.resumeSessionId) {
      args.push('--resume', options.resumeSessionId);
    }

    // stream-json for both input and output (only works with --print)
    args.push('--input-format', 'stream-json');
    args.push('--output-format', 'stream-json');
    args.push('--verbose');

    // Add MCP config file if provided
    if (options.mcpConfigPath) {
      args.push('--mcp-config', options.mcpConfigPath);
    }

    // Chrome browser usage
    if (options.chromeEnabled) {
      args.push('--chrome');
    } else {
      args.push('--no-chrome');
    }

    return args;
  }

  /**
   * Generate MCP configuration file for enabled servers.
   * Returns the path to the generated config file or null if no servers are enabled.
   */
  static generateMcpConfig(servers: McpServerConfig[], projectId: string): string | null {
    // No filtering here - servers have already been filtered by applyMcpOverrides
    if (servers.length === 0) {
      return null;
    }

    interface McpTransport {
      type: string;
      url?: string;
      headers?: Record<string, string>;
    }

    interface McpServerEntry {
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      transport?: McpTransport;
    }

    // Build the config object
    const mcpServers: Record<string, McpServerEntry> = {};

    for (const server of servers) {
      const serverConfig: McpServerEntry = {};

      if (server.type === 'stdio') {
        serverConfig.command = server.command;
        if (server.args && server.args.length > 0) {
          serverConfig.args = server.args;
        }
        if (server.env && Object.keys(server.env).length > 0) {
          serverConfig.env = server.env;
        }
      } else if (server.type === 'http') {
        // For HTTP servers, we need to handle the URL and headers differently
        serverConfig.transport = {
          type: 'http',
          url: server.url
        };
        if (server.headers && Object.keys(server.headers).length > 0) {
          serverConfig.transport.headers = server.headers;
        }
      }

      mcpServers[server.name] = serverConfig;
    }

    // Create temp directory if it doesn't exist
    const tempDir = path.join(os.tmpdir(), 'claudito-mcp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Generate a unique filename for this project/session
    const timestamp = Date.now();
    const configFileName = `mcp-${projectId}-${timestamp}.json`;
    const configPath = path.join(tempDir, configFileName);

    // Write the config file
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers }, null, 2));

    return configPath;
  }

  /**
   * Build the disallowed tools list, always including AskUserQuestion.
   * In --print mode the CLI auto-responds to AskUserQuestion with is_error:true
   * before our app can provide the real answer via stdin.
   */
  static buildDisallowedTools(userDisallowed?: string[]): string[] {
    const tools = new Set(userDisallowed || []);
    tools.add('AskUserQuestion');
    return Array.from(tools);
  }

  /**
   * Build environment variables for Claude CLI.
   */
  static buildEnvironment(env?: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {
      ...process.env,
      ...env,
      // Force color output for better formatting
      FORCE_COLOR: '1',
      // Disable telemetry
      ANTHROPIC_TELEMETRY: 'false',
    };

    // Remove CLAUDECODE to prevent "nested session" errors when
    // claudito itself runs inside a Claude Code terminal session
    delete result['CLAUDECODE'];

    return result;
  }

  /**
   * Format a system message for display.
   */
  static formatSystemMessage(content: string): AgentMessage {
    return {
      type: 'system',
      content,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Format an error message for display.
   */
  static formatErrorMessage(error: Error | string): AgentMessage {
    const content = error instanceof Error ? error.message : error;
    return {
      type: 'stderr',
      content: `Error: ${content}`,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Extract session ID from a message.
   * Looks for patterns like "Session ID: xxx" or "Resuming session: xxx"
   */
  static extractSessionId(message: string): string | null {
    const patterns = [
      /Session ID: ([a-zA-Z0-9-]+)/i,
      /Resuming session: ([a-zA-Z0-9-]+)/i,
      /Created new session: ([a-zA-Z0-9-]+)/i,
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Check if a message indicates the agent is ready.
   */
  static isReadyMessage(message: string): boolean {
    const readyPatterns = [
      /^Ready\.?$/i,
      /Agent is ready/i,
      /Claude is ready/i,
      /Assistant is ready/i,
    ];

    return readyPatterns.some(pattern => pattern.test(message.trim()));
  }

  /**
   * Check if a message indicates the agent is waiting for input.
   */
  static isWaitingMessage(message: string): boolean {
    const waitingPatterns = [
      /Waiting for input/i,
      /Waiting for user input/i,
      /Enter your message/i,
      /^>$/,
    ];

    return waitingPatterns.some(pattern => pattern.test(message.trim()));
  }

  /**
   * Parse agent response for completion status.
   * Used in autonomous mode to detect when the agent has finished.
   */
  static parseCompletionResponse(content: string): { status: 'COMPLETE' | 'FAILED'; reason: string } | null {
    // Check for explicit completion markers
    if (content.includes('MILESTONE_COMPLETE')) {
      const match = content.match(/MILESTONE_COMPLETE: (.+)/);
      return {
        status: 'COMPLETE',
        reason: match?.[1] || 'Milestone completed',
      };
    }

    if (content.includes('MILESTONE_FAILED')) {
      const match = content.match(/MILESTONE_FAILED: (.+)/);
      return {
        status: 'FAILED',
        reason: match?.[1] || 'Milestone failed',
      };
    }

    // Check for task completion patterns
    const completionPatterns = [
      /All tasks? (?:have been )?completed?/i,
      /Milestone is complete/i,
      /Successfully completed all tasks/i,
      /Finished all pending tasks/i,
    ];

    for (const pattern of completionPatterns) {
      if (pattern.test(content)) {
        return {
          status: 'COMPLETE',
          reason: 'All tasks completed',
        };
      }
    }

    // Check for failure patterns
    const failurePatterns = [
      /Failed to complete milestone/i,
      /Cannot continue with milestone/i,
      /Milestone cannot be completed/i,
      /Critical error occurred/i,
    ];

    for (const pattern of failurePatterns) {
      if (pattern.test(content)) {
        return {
          status: 'FAILED',
          reason: content.trim(),
        };
      }
    }

    return null;
  }

  /**
   * Escape command line arguments for shell execution.
   * This is used when shell mode is required.
   */
  static escapeShellArg(arg: string): string {
    if (process.platform === 'win32') {
      // Windows: Double quotes and escape internal quotes
      return `"${arg.replace(/"/g, '""')}"`;
    } else {
      // Unix: Single quotes and escape internal quotes
      return `'${arg.replace(/'/g, "'\"'\"'")}'`;
    }
  }

  /**
   * Build a shell command from command and arguments.
   * Used when shell execution is required.
   */
  static buildShellCommand(command: string, args: string[]): string {
    const escapedArgs = args.map(arg => this.escapeShellArg(arg));
    return `${command} ${escapedArgs.join(' ')}`;
  }
}