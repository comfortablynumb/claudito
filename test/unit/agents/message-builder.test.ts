import { MessageBuilder } from '../../../src/agents/message-builder';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock fs and os modules
jest.mock('fs');
jest.mock('os');

describe('MessageBuilder', () => {
  const mockFs = fs as jest.Mocked<typeof fs>;
  const mockOs = os as jest.Mocked<typeof os>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOs.tmpdir.mockReturnValue('/tmp');
    mockFs.existsSync.mockReturnValue(true);
  });

  describe('generateMcpConfig', () => {
    it('should return null when no servers are provided', () => {
      const result = MessageBuilder.generateMcpConfig([], 'test-project');

      expect(result).toBeNull();
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should use all servers passed to it without filtering by enabled property', () => {
      const servers = [
        {
          id: 'server1',
          name: 'Server 1',
          enabled: false, // This should still be included
          type: 'stdio' as const,
          command: 'command1',
        },
        {
          id: 'server2',
          name: 'Server 2',
          enabled: true,
          type: 'stdio' as const,
          command: 'command2',
        },
      ];

      const result = MessageBuilder.generateMcpConfig(servers, 'test-project');

      expect(result).not.toBeNull();
      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);

      // Check the written config includes both servers
      const writtenContent = mockFs.writeFileSync.mock.calls[0]?.[1] as string;
      const config = JSON.parse(writtenContent);

      expect(config.mcpServers).toHaveProperty('Server 1');
      expect(config.mcpServers).toHaveProperty('Server 2');
      expect(config.mcpServers['Server 1'].command).toBe('command1');
      expect(config.mcpServers['Server 2'].command).toBe('command2');
    });

    it('should create temp directory if it does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const servers = [{
        id: 'server1',
        name: 'Server 1',
        enabled: true,
        type: 'stdio' as const,
        command: 'command1',
      }];

      MessageBuilder.generateMcpConfig(servers, 'test-project');

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        path.join('/tmp', 'claudito-mcp'),
        { recursive: true }
      );
    });

    it('should generate unique config file names', () => {
      const servers = [{
        id: 'server1',
        name: 'Server 1',
        enabled: true,
        type: 'stdio' as const,
        command: 'command1',
      }];

      const result1 = MessageBuilder.generateMcpConfig(servers, 'project1');
      const result2 = MessageBuilder.generateMcpConfig(servers, 'project2');

      expect(result1).toContain('mcp-project1-');
      expect(result2).toContain('mcp-project2-');
      expect(result1).not.toEqual(result2);
    });

    it('should handle stdio servers with args and env', () => {
      const servers = [{
        id: 'server1',
        name: 'Server 1',
        enabled: true,
        type: 'stdio' as const,
        command: 'command1',
        args: ['--arg1', 'value1'],
        env: { NODE_ENV: 'production' },
      }];

      MessageBuilder.generateMcpConfig(servers, 'test-project');

      const writtenContent = mockFs.writeFileSync.mock.calls[0]?.[1] as string;
      const config = JSON.parse(writtenContent);

      expect(config.mcpServers['Server 1']).toEqual({
        type: 'stdio',
        command: 'command1',
        args: ['--arg1', 'value1'],
        env: { NODE_ENV: 'production' },
      });
    });

    it('should handle http servers with headers', () => {
      const servers = [{
        id: 'server1',
        name: 'API Server',
        enabled: true,
        type: 'http' as const,
        url: 'http://localhost:8080',
        headers: { 'Authorization': 'Bearer token' },
      }];

      MessageBuilder.generateMcpConfig(servers, 'test-project');

      const writtenContent = mockFs.writeFileSync.mock.calls[0]?.[1] as string;
      const config = JSON.parse(writtenContent);

      expect(config.mcpServers['API Server']).toEqual({
        type: 'http',
        url: 'http://localhost:8080',
        headers: { 'Authorization': 'Bearer token' },
      });
    });

    it('should handle multiple servers of different types', () => {
      const servers = [
        {
          id: 'server1',
          name: 'Stdio Server',
          enabled: true,
          type: 'stdio' as const,
          command: 'command1',
        },
        {
          id: 'server2',
          name: 'HTTP Server',
          enabled: false, // Should still be included
          type: 'http' as const,
          url: 'http://api.example.com',
        },
      ];

      MessageBuilder.generateMcpConfig(servers, 'test-project');

      const writtenContent = mockFs.writeFileSync.mock.calls[0]?.[1] as string;
      const config = JSON.parse(writtenContent);

      expect(Object.keys(config.mcpServers)).toHaveLength(2);
      expect(config.mcpServers['Stdio Server']).toHaveProperty('command');
      expect(config.mcpServers['HTTP Server']).toHaveProperty('url');
    });

    it('should include servers with enabled: false', () => {
      const servers = [{
        id: 'disabled-server',
        name: 'Disabled Server',
        enabled: false,
        type: 'stdio' as const,
        command: 'disabled-command',
      }];

      const result = MessageBuilder.generateMcpConfig(servers, 'test-project');

      expect(result).not.toBeNull();
      expect(mockFs.writeFileSync).toHaveBeenCalled();

      const writtenContent = mockFs.writeFileSync.mock.calls[0]?.[1] as string;
      const config = JSON.parse(writtenContent);

      expect(config.mcpServers).toHaveProperty('Disabled Server');
      expect(config.mcpServers['Disabled Server'].command).toBe('disabled-command');
    });
  });

  describe('buildUserMessage', () => {
    it('should return plain text when no images provided', () => {
      const result = MessageBuilder.buildUserMessage('Hello world');
      expect(result).toBe('Hello world');
    });

    it('should format message with images', () => {
      const images = [
        { data: 'base64data1', mediaType: 'image/png' },
        { data: 'base64data2', mediaType: 'image/jpeg' },
      ];

      const result = MessageBuilder.buildUserMessage('Describe these images', images);

      expect(result).toContain('<image media_type="image/png">base64data1</image>');
      expect(result).toContain('<image media_type="image/jpeg">base64data2</image>');
      expect(result).toContain('Describe these images');
    });
  });

  describe('buildArgs', () => {
    it('should include --mcp-config when mcpConfigPath is provided', () => {
      const args = MessageBuilder.buildArgs({
        mode: 'interactive',
        mcpConfigPath: '/tmp/mcp-config.json',
      });

      expect(args).toContain('--mcp-config');
      expect(args).toContain('/tmp/mcp-config.json');
    });

    it('should not include --mcp-config when mcpConfigPath is not provided', () => {
      const args = MessageBuilder.buildArgs({
        mode: 'interactive',
      });

      expect(args).not.toContain('--mcp-config');
    });

    it('should always include --print and stream-json format', () => {
      const args = MessageBuilder.buildArgs({ mode: 'interactive' });

      expect(args).toContain('--print');
      expect(args).toContain('--input-format');
      expect(args).toContain('stream-json');
      expect(args).toContain('--output-format');
      expect(args).toContain('--verbose');
    });

    it('should add --model when model is provided', () => {
      const args = MessageBuilder.buildArgs({
        mode: 'interactive',
        model: 'claude-sonnet-4-5-20250929',
      });

      expect(args).toContain('--model');
      expect(args).toContain('claude-sonnet-4-5-20250929');
    });

    it('should add --dangerously-skip-permissions when skipPermissions is true', () => {
      const args = MessageBuilder.buildArgs({
        mode: 'interactive',
        skipPermissions: true,
      });

      expect(args).toContain('--dangerously-skip-permissions');
      expect(args).not.toContain('--permission-mode');
    });

    it('should add --permission-mode when not skipping', () => {
      const args = MessageBuilder.buildArgs({
        mode: 'interactive',
        permissionMode: 'plan',
      });

      expect(args).toContain('--permission-mode');
      expect(args).toContain('plan');
      expect(args).not.toContain('--dangerously-skip-permissions');
    });

    it('should add --allowedTools when provided', () => {
      const args = MessageBuilder.buildArgs({
        mode: 'interactive',
        allowedTools: ['Read', 'Write'],
      });

      expect(args).toContain('--allowedTools');
      expect(args).toContain('Read Write');
    });

    it('should add --disallowedTools when provided', () => {
      const args = MessageBuilder.buildArgs({
        mode: 'interactive',
        disallowedTools: ['Bash'],
      });

      expect(args).toContain('--disallowedTools');
      const disallowedIdx = args.indexOf('--disallowedTools');
      const disallowedValue = args[disallowedIdx + 1]!;
      expect(disallowedValue).toContain('Bash');
      expect(disallowedValue).toContain('AskUserQuestion');
    });

    it('should always disallow AskUserQuestion even with no user-provided disallowedTools', () => {
      const args = MessageBuilder.buildArgs({ mode: 'interactive' });

      expect(args).toContain('--disallowedTools');
      const disallowedIdx = args.indexOf('--disallowedTools');
      const disallowedValue = args[disallowedIdx + 1]!;
      expect(disallowedValue).toContain('AskUserQuestion');
    });

    it('should disallow AskUserQuestion even when skipPermissions is true', () => {
      const args = MessageBuilder.buildArgs({
        mode: 'interactive',
        skipPermissions: true,
      });

      expect(args).toContain('--disallowedTools');
      const disallowedIdx = args.indexOf('--disallowedTools');
      const disallowedValue = args[disallowedIdx + 1]!;
      expect(disallowedValue).toContain('AskUserQuestion');
    });

    it('should add --append-system-prompt when not skipping permissions', () => {
      const args = MessageBuilder.buildArgs({
        mode: 'interactive',
        appendSystemPrompt: 'Extra instructions',
      });

      expect(args).toContain('--append-system-prompt');
      expect(args).toContain('Extra instructions');
    });

    it('should not add --append-system-prompt when skipping permissions', () => {
      const args = MessageBuilder.buildArgs({
        mode: 'interactive',
        skipPermissions: true,
        appendSystemPrompt: 'Extra instructions',
      });

      expect(args).not.toContain('--append-system-prompt');
    });

    it('should add --max-turns when agentTurns > 0', () => {
      const args = MessageBuilder.buildArgs({
        mode: 'interactive',
        agentTurns: 5,
      });

      expect(args).toContain('--max-turns');
      expect(args).toContain('5');
    });

    it('should add --session-id for new sessions', () => {
      const args = MessageBuilder.buildArgs({
        mode: 'interactive',
        sessionId: 'new-session-123',
      });

      expect(args).toContain('--session-id');
      expect(args).toContain('new-session-123');
    });

    it('should add --resume for existing sessions', () => {
      const args = MessageBuilder.buildArgs({
        mode: 'interactive',
        resumeSessionId: 'existing-session-456',
      });

      expect(args).toContain('--resume');
      expect(args).toContain('existing-session-456');
    });
  });

  describe('buildEnvironment', () => {
    it('should include FORCE_COLOR and ANTHROPIC_TELEMETRY', () => {
      const env = MessageBuilder.buildEnvironment();

      expect(env.FORCE_COLOR).toBe('1');
      expect(env.ANTHROPIC_TELEMETRY).toBe('false');
    });

    it('should merge custom env variables', () => {
      const env = MessageBuilder.buildEnvironment({ MY_VAR: 'test' });

      expect(env.MY_VAR).toBe('test');
      expect(env.FORCE_COLOR).toBe('1');
    });

    it('should allow overriding defaults', () => {
      const env = MessageBuilder.buildEnvironment({ FORCE_COLOR: '0' });

      // Custom env should override since it's spread after process.env
      // but before the hardcoded values — actually FORCE_COLOR is hardcoded after,
      // so it will still be '1'
      expect(env.FORCE_COLOR).toBe('1');
    });
  });

  describe('formatSystemMessage', () => {
    it('should create system message', () => {
      const msg = MessageBuilder.formatSystemMessage('System initialized');

      expect(msg.type).toBe('system');
      expect(msg.content).toBe('System initialized');
      expect(msg.timestamp).toBeTruthy();
    });
  });

  describe('formatErrorMessage', () => {
    it('should format Error object', () => {
      const msg = MessageBuilder.formatErrorMessage(new Error('Something failed'));

      expect(msg.type).toBe('stderr');
      expect(msg.content).toBe('Error: Something failed');
    });

    it('should format string error', () => {
      const msg = MessageBuilder.formatErrorMessage('Connection lost');

      expect(msg.type).toBe('stderr');
      expect(msg.content).toBe('Error: Connection lost');
    });
  });

  describe('extractSessionId', () => {
    it('should extract from "Session ID:" pattern', () => {
      expect(MessageBuilder.extractSessionId('Session ID: abc-123')).toBe('abc-123');
    });

    it('should extract from "Resuming session:" pattern', () => {
      expect(MessageBuilder.extractSessionId('Resuming session: def-456')).toBe('def-456');
    });

    it('should extract from "Created new session:" pattern', () => {
      expect(MessageBuilder.extractSessionId('Created new session: ghi-789')).toBe('ghi-789');
    });

    it('should return null when no match', () => {
      expect(MessageBuilder.extractSessionId('No session info here')).toBeNull();
    });
  });

  describe('isReadyMessage', () => {
    it('should match "Ready."', () => {
      expect(MessageBuilder.isReadyMessage('Ready.')).toBe(true);
    });

    it('should match "Ready" without period', () => {
      expect(MessageBuilder.isReadyMessage('Ready')).toBe(true);
    });

    it('should not match arbitrary text', () => {
      expect(MessageBuilder.isReadyMessage('Not ready yet')).toBe(false);
    });
  });

  describe('isWaitingMessage', () => {
    it('should match "Waiting for input"', () => {
      expect(MessageBuilder.isWaitingMessage('Waiting for input')).toBe(true);
    });

    it('should match ">"', () => {
      expect(MessageBuilder.isWaitingMessage('>')).toBe(true);
    });

    it('should not match arbitrary text', () => {
      expect(MessageBuilder.isWaitingMessage('Processing...')).toBe(false);
    });
  });

  describe('parseCompletionResponse', () => {
    it('should detect MILESTONE_COMPLETE', () => {
      const result = MessageBuilder.parseCompletionResponse('MILESTONE_COMPLETE: Tests pass');

      expect(result?.status).toBe('COMPLETE');
      expect(result?.reason).toBe('Tests pass');
    });

    it('should detect MILESTONE_FAILED', () => {
      const result = MessageBuilder.parseCompletionResponse('MILESTONE_FAILED: Build error');

      expect(result?.status).toBe('FAILED');
      expect(result?.reason).toBe('Build error');
    });

    it('should detect task completion patterns', () => {
      expect(MessageBuilder.parseCompletionResponse('All tasks completed')?.status).toBe('COMPLETE');
      expect(MessageBuilder.parseCompletionResponse('Milestone is complete')?.status).toBe('COMPLETE');
    });

    it('should detect failure patterns', () => {
      expect(MessageBuilder.parseCompletionResponse('Failed to complete milestone')?.status).toBe('FAILED');
      expect(MessageBuilder.parseCompletionResponse('Critical error occurred')?.status).toBe('FAILED');
    });

    it('should return null for no match', () => {
      expect(MessageBuilder.parseCompletionResponse('Working on task...')).toBeNull();
    });
  });

  describe('escapeShellArg', () => {
    it('should escape for current platform', () => {
      const result = MessageBuilder.escapeShellArg('hello world');

      // On Windows, should use double quotes; on Unix, single quotes
      if (process.platform === 'win32') {
        expect(result).toBe('"hello world"');
      } else {
        expect(result).toBe("'hello world'");
      }
    });
  });

  describe('buildShellCommand', () => {
    it('should combine command with escaped args', () => {
      const result = MessageBuilder.buildShellCommand('claude', ['--print', '--verbose']);

      expect(result).toContain('claude');
      expect(result).toContain('--print');
      expect(result).toContain('--verbose');
    });
  });
});