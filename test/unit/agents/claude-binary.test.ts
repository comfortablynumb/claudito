import { ClaudeBinary, ClaudeBinaryConfig } from '../../../src/agents/claude-binary';
import { createMockChildProcess, createMockProcessSpawner, MockChildProcess } from '../helpers/mock-factories';
import * as fs from 'fs';

// Mock fs module
jest.mock('fs');

// Helper to safely get spawn args
function getSpawnArgs(spawner: ReturnType<typeof createMockProcessSpawner>): string[] {
  const call = spawner.spawn.mock.calls[0];
  return call ? call[1] : [];
}

describe('ClaudeBinary', () => {
  let mockProcess: MockChildProcess;
  let mockSpawner: ReturnType<typeof createMockProcessSpawner>;
  let agent: ClaudeBinary;
  const defaultConfig: ClaudeBinaryConfig = {
    projectId: 'test-project',
    projectPath: '/test/path',
    mode: 'interactive',
    permissions: {
      skipPermissions: true,
      permissionMode: 'acceptEdits',
    },
  };

  beforeEach(() => {
    mockProcess = createMockChildProcess(12345);
    mockSpawner = createMockProcessSpawner(mockProcess);
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Simply reset the agent reference - we don't need to actually stop
    // since we're using mocked processes. Calling stop() would hang
    // because the mock process doesn't auto-exit.
    agent = undefined as unknown as ClaudeBinary;
  });

  describe('constructor', () => {
    it('should initialize with default values when minimal config provided', () => {
      agent = new ClaudeBinary({
        projectId: 'test',
        projectPath: '/test',
        processSpawner: mockSpawner,
      });

      expect(agent.projectId).toBe('test');
      expect(agent.status).toBe('stopped');
      expect(agent.mode).toBe('interactive');
      expect(agent.collectedOutput).toBe('');
      expect(agent.queuedMessageCount).toBe(0);
    });

    it('should use custom processSpawner when provided', () => {
      agent = new ClaudeBinary({
        ...defaultConfig,
        processSpawner: mockSpawner,
      });
      agent.start('test instructions');

      expect(mockSpawner.spawn).toHaveBeenCalled();
    });

    it('should set mode to interactive by default', () => {
      agent = new ClaudeBinary({
        projectId: 'test',
        projectPath: '/test',
        processSpawner: mockSpawner,
      });

      expect(agent.mode).toBe('interactive');
    });

    it('should set mode to autonomous when specified', () => {
      agent = new ClaudeBinary({
        projectId: 'test',
        projectPath: '/test',
        mode: 'autonomous',
        processSpawner: mockSpawner,
      });

      expect(agent.mode).toBe('autonomous');
    });

    it('should use permissions config over legacy skipPermissions', () => {
      agent = new ClaudeBinary({
        projectId: 'test',
        projectPath: '/test',
        skipPermissions: true,
        permissions: {
          skipPermissions: false,
          permissionMode: 'plan',
        },
        processSpawner: mockSpawner,
      });

      expect(agent.permissionMode).toBe('plan');
    });

    it('should keep skipPermissions undefined when permissions object is provided without skipPermissions', () => {
      // Create a permissions object without skipPermissions property
      const permissionsWithoutSkip: any = {
        permissionMode: 'plan',
        allowedTools: ['Read', 'Write'],
      };

      agent = new ClaudeBinary({
        projectId: 'test',
        projectPath: '/test',
        permissions: permissionsWithoutSkip,
        processSpawner: mockSpawner,
      });

      // Access private _permissions property to verify skipPermissions is undefined
      const permissions = (agent as any)._permissions;
      expect(permissions.skipPermissions).toBeUndefined();
      expect(permissions.permissionMode).toBe('plan');
      expect(permissions.allowedTools).toEqual(['Read', 'Write']);
    });

    it('should default skipPermissions to false when no permissions object is provided', () => {
      agent = new ClaudeBinary({
        projectId: 'test',
        projectPath: '/test',
        processSpawner: mockSpawner,
      });

      // Access private _permissions property to verify skipPermissions default
      const permissions = (agent as any)._permissions;
      expect(permissions.skipPermissions).toBe(false);
    });

    it('should respect explicit skipPermissions false value in permissions', () => {
      agent = new ClaudeBinary({
        projectId: 'test',
        projectPath: '/test',
        permissions: {
          skipPermissions: false,
        },
        processSpawner: mockSpawner,
      });

      const permissions = (agent as any)._permissions;
      expect(permissions.skipPermissions).toBe(false);
    });

    it('should respect explicit skipPermissions true value in permissions', () => {
      agent = new ClaudeBinary({
        projectId: 'test',
        projectPath: '/test',
        permissions: {
          skipPermissions: true,
        },
        processSpawner: mockSpawner,
      });

      const permissions = (agent as any)._permissions;
      expect(permissions.skipPermissions).toBe(true);
    });
  });

  describe('start', () => {
    beforeEach(() => {
      agent = new ClaudeBinary({
        ...defaultConfig,
        processSpawner: mockSpawner,
      });
    });

    it('should not start if process already exists', () => {
      agent.start('first instructions');
      const firstCallCount = mockSpawner.spawn.mock.calls.length;

      expect(() => agent.start('second instructions')).toThrow('Agent is already running');

      expect(mockSpawner.spawn.mock.calls.length).toBe(firstCallCount);
    });

    it('should set status to running on start', () => {
      const statusListener = jest.fn();
      agent.on('status', statusListener);

      agent.start('test instructions');

      expect(agent.status).toBe('running');
      expect(statusListener).toHaveBeenCalledWith('running');
    });

    it('should spawn process with correct arguments for interactive mode', () => {
      agent.start('test instructions');

      expect(mockSpawner.spawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--print']),
        expect.objectContaining({ cwd: '/test/path', shell: false })
      );
    });

    it('should add --permission-mode when permissionMode is set', () => {
      agent = new ClaudeBinary({
        ...defaultConfig,
        permissions: { skipPermissions: false, permissionMode: 'plan' },
        processSpawner: mockSpawner,
      });

      agent.start('test instructions');

      const args = getSpawnArgs(mockSpawner);
      expect(args).toContain('--permission-mode');
      expect(args).toContain('plan');
    });

    it('should add --dangerously-skip-permissions when skipPermissions is true', () => {
      agent = new ClaudeBinary({
        ...defaultConfig,
        permissions: { skipPermissions: true },
        processSpawner: mockSpawner,
      });

      agent.start('test instructions');

      const args = getSpawnArgs(mockSpawner);
      expect(args).toContain('--dangerously-skip-permissions');
    });

    it('should add --allowedTools when allowedTools provided', () => {
      agent = new ClaudeBinary({
        ...defaultConfig,
        permissions: { skipPermissions: false, allowedTools: ['Read', 'Write'] },
        processSpawner: mockSpawner,
      });

      agent.start('test instructions');

      const args = getSpawnArgs(mockSpawner);
      expect(args).toContain('--allowedTools');
      expect(args).toContain('Read Write');
    });

    it('should add --disallowedTools when disallowedTools provided', () => {
      agent = new ClaudeBinary({
        ...defaultConfig,
        permissions: { skipPermissions: false, disallowedTools: ['Bash'] },
        processSpawner: mockSpawner,
      });

      agent.start('test instructions');

      const args = getSpawnArgs(mockSpawner);
      expect(args).toContain('--disallowedTools');
      const disallowedIdx = args.indexOf('--disallowedTools');
      const disallowedValue = args[disallowedIdx + 1]!;
      expect(disallowedValue).toContain('Bash');
      expect(disallowedValue).toContain('AskUserQuestion');
    });

    it('should add --append-system-prompt when appendSystemPrompt provided', () => {
      agent = new ClaudeBinary({
        ...defaultConfig,
        permissions: { skipPermissions: false, appendSystemPrompt: 'Custom prompt' },
        processSpawner: mockSpawner,
      });

      agent.start('test instructions');

      const args = getSpawnArgs(mockSpawner);
      expect(args).toContain('--append-system-prompt');
      expect(args).toContain('Custom prompt');
    });

    it('should add --session-id for new sessions', () => {
      agent = new ClaudeBinary({
        ...defaultConfig,
        sessionId: 'test-session-123',
        isNewSession: true,
        processSpawner: mockSpawner,
      });

      agent.start('test instructions');

      const args = getSpawnArgs(mockSpawner);
      expect(args).toContain('--session-id');
      expect(args).toContain('test-session-123');
    });

    it('should add --resume for existing sessions', () => {
      agent = new ClaudeBinary({
        ...defaultConfig,
        sessionId: 'test-session-123',
        isNewSession: false,
        processSpawner: mockSpawner,
      });

      agent.start('test instructions');

      const args = getSpawnArgs(mockSpawner);
      expect(args).toContain('--resume');
      expect(args).toContain('test-session-123');
    });

    it('should add --mcp-config flag for stdio MCP servers', () => {
      const mockFs = jest.mocked(fs);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.mkdirSync.mockImplementation(() => undefined);
      mockFs.writeFileSync.mockImplementation(() => {});

      agent = new ClaudeBinary({
        ...defaultConfig,
        mcpServers: [
          {
            id: 'test-server-1',
            name: 'filesystem',
            enabled: true,
            type: 'stdio',
            command: 'npx @modelcontextprotocol/server-filesystem',
            args: ['--root', '/test/path'],
            env: { NODE_ENV: 'production' },
          },
        ],
        processSpawner: mockSpawner,
      });

      agent.start('test instructions');

      const args = getSpawnArgs(mockSpawner);
      expect(args).toContain('--mcp-config');
      expect(args.find(arg => arg.includes('mcp-test-project-'))).toBeTruthy();

      // Verify the config file was written with correct content
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('mcp-test-project-'),
        expect.stringContaining('"filesystem"')
      );

      const writtenConfig = JSON.parse(mockFs.writeFileSync.mock.calls[0]?.[1] as string || '{}');
      expect(writtenConfig.mcpServers.filesystem).toEqual({
        command: 'npx @modelcontextprotocol/server-filesystem',
        args: ['--root', '/test/path'],
        env: { NODE_ENV: 'production' }
      });
    });

    it('should add --mcp-config flag for http MCP servers', () => {
      const mockFs = jest.mocked(fs);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.mkdirSync.mockImplementation(() => undefined);
      mockFs.writeFileSync.mockImplementation(() => {});

      agent = new ClaudeBinary({
        ...defaultConfig,
        mcpServers: [
          {
            id: 'test-server-2',
            name: 'api-server',
            enabled: true,
            type: 'http',
            url: 'localhost:8080',
            headers: { Authorization: 'Bearer token123' },
          },
        ],
        processSpawner: mockSpawner,
      });

      agent.start('test instructions');

      const args = getSpawnArgs(mockSpawner);
      expect(args).toContain('--mcp-config');

      const writtenConfig = JSON.parse(mockFs.writeFileSync.mock.calls[0]?.[1] as string || '{}');
      expect(writtenConfig.mcpServers['api-server']).toEqual({
        transport: {
          type: 'http',
          url: 'localhost:8080',
          headers: { Authorization: 'Bearer token123' }
        }
      });
    });

    it('should include disabled MCP servers when passed explicitly', () => {
      const mockFs = jest.mocked(fs);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.mkdirSync.mockImplementation(() => undefined);
      mockFs.writeFileSync.mockImplementation(() => {});

      agent = new ClaudeBinary({
        ...defaultConfig,
        mcpServers: [
          {
            id: 'test-server-3',
            name: 'disabled-server',
            enabled: false,
            type: 'stdio',
            command: 'some-command',
          },
        ],
        processSpawner: mockSpawner,
      });

      agent.start('test instructions');

      const args = getSpawnArgs(mockSpawner);
      // Should have --mcp-config flag even with disabled servers (they've been pre-filtered)
      expect(args).toContain('--mcp-config');
      expect(mockFs.writeFileSync).toHaveBeenCalled();

      const writtenConfig = JSON.parse(mockFs.writeFileSync.mock.calls[0]?.[1] as string || '{}');
      expect(writtenConfig.mcpServers['disabled-server']).toEqual({
        command: 'some-command'
      });
    });

    it('should handle multiple MCP servers', () => {
      const mockFs = jest.mocked(fs);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.mkdirSync.mockImplementation(() => undefined);
      mockFs.writeFileSync.mockImplementation(() => {});

      agent = new ClaudeBinary({
        ...defaultConfig,
        mcpServers: [
          {
            id: 'server-1',
            name: 'server1',
            enabled: true,
            type: 'stdio',
            command: 'command1',
          },
          {
            id: 'server-2',
            name: 'server2',
            enabled: true,
            type: 'http',
            url: 'localhost:8081',
          },
        ],
        processSpawner: mockSpawner,
      });

      agent.start('test instructions');

      const args = getSpawnArgs(mockSpawner);
      expect(args).toContain('--mcp-config');

      const writtenConfig = JSON.parse(mockFs.writeFileSync.mock.calls[0]?.[1] as string || '{}');
      expect(writtenConfig.mcpServers).toHaveProperty('server1');
      expect(writtenConfig.mcpServers).toHaveProperty('server2');
      expect(writtenConfig.mcpServers.server1.command).toBe('command1');
      expect(writtenConfig.mcpServers.server2.transport.url).toBe('localhost:8081');
    });

    it('should clean up MCP config file on stop', async () => {
      const mockFs = jest.mocked(fs);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.mkdirSync.mockImplementation(() => undefined);
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.unlinkSync.mockImplementation(() => {});

      let configFilePath: string = '';
      mockFs.writeFileSync.mockImplementation((path: any) => {
        configFilePath = path as string;
      });

      agent = new ClaudeBinary({
        ...defaultConfig,
        mcpServers: [
          {
            id: 'test-cleanup',
            name: 'test-server',
            enabled: true,
            type: 'stdio',
            command: 'test-command',
          },
        ],
        processSpawner: mockSpawner,
      });

      agent.start('test instructions');

      // Verify config file was created
      expect(mockFs.writeFileSync).toHaveBeenCalled();
      expect(configFilePath).toContain('mcp-test-project-');

      // Stop the agent
      await agent.stop();

      // Verify the config file was deleted
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(configFilePath);
    });

    it('should write instructions to stdin on start', () => {
      agent.start('test instructions');

      expect(mockProcess.stdin.write).toHaveBeenCalled();
      const writtenData = mockProcess.stdin.write.mock.calls[0][0];
      const parsed = JSON.parse(writtenData.replace('\n', ''));
      expect(parsed.type).toBe('user');
      expect(parsed.message.content).toBe('test instructions');
    });

    it('should close stdin in autonomous mode after writing', () => {
      agent = new ClaudeBinary({
        ...defaultConfig,
        mode: 'autonomous',
        processSpawner: mockSpawner,
      });

      agent.start('test instructions');

      expect(mockProcess.stdin.end).toHaveBeenCalled();
    });

    it('should keep stdin open in interactive mode', () => {
      agent.start('test instructions');

      expect(mockProcess.stdin.end).not.toHaveBeenCalled();
    });

    it('should emit system message on start', () => {
      const messageListener = jest.fn();
      agent.on('message', messageListener);

      agent.start('test instructions');

      expect(messageListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'system',
          content: expect.stringContaining('Starting Claude agent'),
        })
      );
    });
  });

  describe('stop', () => {
    beforeEach(() => {
      agent = new ClaudeBinary({
        ...defaultConfig,
        processSpawner: mockSpawner,
      });
    });

    it('should do nothing if no process exists', async () => {
      await agent.stop();

      expect(agent.status).toBe('stopped');
    });

    it('should emit system message on exit', () => {
      agent.start('test');
      const messageListener = jest.fn();
      agent.on('message', messageListener);

      // Simulate exit callback to trigger the exit message
      const exitCallback = mockProcess.on.mock.calls.find((c) => c[0] === 'exit')?.[1];

      if (exitCallback) {
        exitCallback(0);
      }

      expect(messageListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'system',
          content: expect.stringContaining('exited'),
        })
      );
    });
  });

  describe('sendInput', () => {
    beforeEach(() => {
      agent = new ClaudeBinary({
        ...defaultConfig,
        processSpawner: mockSpawner,
      });
    });

    it('should ignore input when status is not running', () => {
      expect(() => agent.sendInput('test message')).toThrow('Agent is not running');

      expect(mockProcess.stdin.write).not.toHaveBeenCalled();
    });

    it('should write to stdin when running and not processing', () => {
      agent.start('initial');

      // Clear the initial instruction write
      mockProcess.stdin.write.mockClear();

      // Simulate result event to mark as not processing
      const resultEvent = JSON.stringify({ type: 'result', subtype: 'success' });
      mockProcess.stdout.emit('data', Buffer.from(resultEvent + '\n'));

      agent.sendInput('user message');

      expect(mockProcess.stdin.write).toHaveBeenCalled();
      const writtenData = mockProcess.stdin.write.mock.calls[0][0];
      const parsed = JSON.parse(writtenData.replace('\n', ''));
      expect(parsed.type).toBe('user');
      expect(parsed.message.content).toBe('user message');
    });

    it('should handle multimodal content (JSON array with images)', () => {
      agent.start('initial');
      mockProcess.stdin.write.mockClear();

      // Simulate result event to mark as not processing
      const resultEvent = JSON.stringify({ type: 'result', subtype: 'success' });
      mockProcess.stdout.emit('data', Buffer.from(resultEvent + '\n'));

      const multimodalContent = JSON.stringify([
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
        { type: 'text', text: 'Describe this image' },
      ]);

      agent.sendInput(multimodalContent);

      expect(mockProcess.stdin.write).toHaveBeenCalled();
      const writtenData = mockProcess.stdin.write.mock.calls[0][0];
      const parsed = JSON.parse(writtenData.replace('\n', ''));
      // Claude agent always sends input as a string, multimodal handling is done at agent-manager level
      expect(typeof parsed.message.content).toBe('string');
      expect(parsed.message.content).toBe(multimodalContent);
    });
  });

  describe('removeQueuedMessage', () => {
    beforeEach(() => {
      agent = new ClaudeBinary({
        ...defaultConfig,
        processSpawner: mockSpawner,
      });
    });

    it('should return false for invalid index', () => {
      expect(agent.removeQueuedMessage(-1)).toBe(false);
      expect(agent.removeQueuedMessage(0)).toBe(false);
      expect(agent.removeQueuedMessage(100)).toBe(false);
    });
  });

  describe('Stream Event Handling', () => {
    beforeEach(() => {
      agent = new ClaudeBinary({
        ...defaultConfig,
        processSpawner: mockSpawner,
      });
      agent.start('test');
    });

    describe('handleStreamEvent', () => {
      it('should handle assistant event with text content', () => {
        const messageListener = jest.fn();
        agent.on('message', messageListener);

        const event = {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Hello from Claude' }],
          },
        };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));

        expect(messageListener).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'stdout',
            content: 'Hello from Claude',
          })
        );
      });

      it('should handle assistant event with tool_use content', () => {
        const messageListener = jest.fn();
        agent.on('message', messageListener);

        const event = {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'tool_use', name: 'Read', id: 'tool-1', input: { file_path: '/test.ts' } }],
          },
        };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));

        expect(messageListener).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'tool_use',
            toolInfo: expect.objectContaining({ name: 'Read' }),
          })
        );
      });

      it('should handle content_block_delta with text', () => {
        const messageListener = jest.fn();
        agent.on('message', messageListener);

        const event = { type: 'content_block_delta', delta: { text: 'streaming text' } };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));

        expect(messageListener).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'stdout',
            content: 'streaming text',
          })
        );
      });

      it('should handle content_block_start for tool_use', () => {
        const messageListener = jest.fn();
        agent.on('message', messageListener);

        // First emit content_block_start
        const startEvent = {
          type: 'content_block_start',
          content_block: {
            toolUse: {
              name: 'Bash',
              id: 'tool-2'
            }
          },
        };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(startEvent) + '\n'));

        // Then emit content_block_delta with the input
        const deltaEvent = {
          type: 'content_block_delta',
          delta: {
            partial_json: JSON.stringify({ command: 'ls' })
          }
        };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(deltaEvent) + '\n'));

        // Finally emit content_block_stop to trigger the tool message
        const stopEvent = { type: 'content_block_stop' };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(stopEvent) + '\n'));

        expect(messageListener).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'tool_use',
            toolInfo: expect.objectContaining({ name: 'Bash' }),
          })
        );
      });

      it('should handle content_block_stop and emit tool use', () => {
        const messageListener = jest.fn();
        agent.on('message', messageListener);

        // First emit a tool_use to set activeToolId
        const toolEvent = {
          type: 'content_block_start',
          content_block: {
            toolUse: {
              name: 'Read',
              id: 'tool-3'
            }
          },
        };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(toolEvent) + '\n'));

        // Emit content_block_delta with input
        const deltaEvent = {
          type: 'content_block_delta',
          delta: {
            partial_json: JSON.stringify({ file_path: '/test.txt' })
          }
        };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(deltaEvent) + '\n'));
        messageListener.mockClear();

        // Then emit content_block_stop
        const stopEvent = { type: 'content_block_stop' };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(stopEvent) + '\n'));

        expect(messageListener).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'tool_use',
            toolInfo: expect.objectContaining({
              name: 'Read',
              id: 'tool-3'
            }),
          })
        );
      });

      it('should handle assistant event ask_question without emitting waitingForInput', () => {
        const waitingListener = jest.fn();
        agent.on('waitingForInput', waitingListener);

        const event = {
          type: 'assistant_event',
          assistant_event_type: 'ask_question',
          user_input: {
            question: 'What should I do next?',
            options: ['Option A', 'Option B']
          }
        };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));

        // waitingForInput is only emitted from AskUserQuestion tool and result handlers
        expect(waitingListener).not.toHaveBeenCalled();
      });

      it('should handle system init event and capture session ID', () => {
        const event = { type: 'system', subtype: 'init', session_id: 'captured-session-id' };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));

        expect(agent.sessionId).toBe('captured-session-id');
      });

      it('should handle compaction events', () => {
        const messageListener = jest.fn();
        agent.on('message', messageListener);

        const event = { type: 'system', subtype: 'compact', content: 'Context was compacted' };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));

        expect(messageListener).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'compaction',
          })
        );
      });

      it('should handle user event with tool_result', () => {
        const messageListener = jest.fn();
        agent.on('message', messageListener);

        // First emit a tool_use to set up toolIdMap
        const toolEvent = {
          type: 'content_block_start',
          content_block: {
            toolUse: {
              name: 'Read',
              id: 'tool-result-1'
            }
          },
        };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(toolEvent) + '\n'));
        messageListener.mockClear();

        // Then emit user event with tool_result
        const userEvent = {
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'tool-result-1', content: 'File content' }],
          },
        };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(userEvent) + '\n'));

        expect(messageListener).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'tool_result',
            toolInfo: expect.objectContaining({
              status: 'completed',
              id: 'tool-result-1',
            }),
          })
        );
      });
    });

    describe('updateUsageFromEvent', () => {
      it('should update context usage with input/output tokens', () => {
        const event = {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'test' }],
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));

        expect(agent.contextUsage).not.toBeNull();
        expect(agent.contextUsage?.inputTokens).toBe(100);
        expect(agent.contextUsage?.outputTokens).toBe(50);
        expect(agent.contextUsage?.totalTokens).toBe(150);
      });

      it('should take maximum of new and previous values', () => {
        // First update
        const event1 = {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'test' }],
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event1) + '\n'));

        // Second update with higher values
        const event2 = {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'test2' }],
            usage: { input_tokens: 200, output_tokens: 75 },
          },
        };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event2) + '\n'));

        expect(agent.contextUsage?.inputTokens).toBe(200);
        expect(agent.contextUsage?.outputTokens).toBe(75);
      });

      it('should calculate percentUsed correctly', () => {
        const event = {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'test' }],
            usage: { input_tokens: 100000, output_tokens: 50000 },
          },
        };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));

        // 150000 / 200000 = 75%
        expect(agent.contextUsage?.percentUsed).toBe(75);
      });
    });

    describe('Tool Messages', () => {
      it('should emit tool_use message with proper formatting', () => {
        const messageListener = jest.fn();
        agent.on('message', messageListener);

        const event = {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tool-1',
                name: 'Read',
                input: { file_path: '/path/to/file.ts' }
              }
            ]
          }
        };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));

        expect(messageListener).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'tool_use',
            content: expect.stringContaining('/path/to/file.ts'),
          })
        );
      });

      it('should handle AskUserQuestion tool specially (question message)', () => {
        const messageListener = jest.fn();
        agent.on('message', messageListener);

        const event = {
          type: 'assistant',
          message: {
            content: [{
              type: 'tool_use',
              id: 'ask-1',
              name: 'AskUserQuestion',
              input: {
                questions: [{
                  question: 'Which option?',
                  header: 'Choice',
                  options: [{ label: 'A' }, { label: 'B' }],
                }],
              },
            }],
          },
        };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));

        expect(messageListener).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'tool_use',
            toolInfo: expect.objectContaining({
              name: 'AskUserQuestion',
              id: 'ask-1',
              input: expect.objectContaining({
                questions: expect.arrayContaining([
                  expect.objectContaining({
                    question: 'Which option?',
                  }),
                ]),
              }),
            }),
          })
        );
      });

      it('should handle EnterPlanMode tool (plan_mode message)', () => {
        const messageListener = jest.fn();
        agent.on('message', messageListener);

        const event = {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: 'enter-1', name: 'EnterPlanMode' }],
          },
        };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));

        expect(messageListener).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'plan_mode',
            planModeInfo: expect.objectContaining({ action: 'enter' }),
          })
        );
      });

      it('should handle ExitPlanMode tool (exitPlanMode event)', () => {
        const exitPlanModeListener = jest.fn();
        agent.on('exitPlanMode', exitPlanModeListener);

        const event = {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: 'exit-1', name: 'ExitPlanMode' }],
          },
        };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));

        expect(exitPlanModeListener).toHaveBeenCalled();
        // plan_mode message is now emitted by agent-manager, not stream-handler
      });

      it('should prevent duplicate consecutive plan mode messages', () => {
        const messageListener = jest.fn();
        agent.on('message', messageListener);

        const event = {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: 'enter-dup-1', name: 'EnterPlanMode' }],
          },
        };

        // Emit first event
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));

        // Create a second event with different ID but same tool
        const event2 = {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: 'enter-dup-2', name: 'EnterPlanMode' }],
          },
        };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event2) + '\n'));

        const planModeMessages = messageListener.mock.calls.filter(
          (call) => call[0].type === 'plan_mode'
        );
        expect(planModeMessages.length).toBe(1);
      });

      it('should prevent duplicate question messages', () => {
        const messageListener = jest.fn();
        agent.on('message', messageListener);

        const event = {
          type: 'assistant',
          message: {
            content: [{
              type: 'tool_use',
              id: 'ask-dup-1',
              name: 'AskUserQuestion',
              input: {
                questions: [{
                  question: 'Same question?',
                  options: [{ label: 'Yes' }, { label: 'No' }],
                }],
              },
            }],
          },
        };

        // Emit first question
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));

        // Create a second event with different ID but same question
        const event2 = {
          type: 'assistant',
          message: {
            content: [{
              type: 'tool_use',
              id: 'ask-dup-2',
              name: 'AskUserQuestion',
              input: {
                questions: [{
                  question: 'Same question?',
                  options: [{ label: 'Yes' }, { label: 'No' }],
                }],
              },
            }],
          },
        };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event2) + '\n'));

        const toolMessages = messageListener.mock.calls.filter(
          (call) => call[0].type === 'tool_use' && call[0].toolInfo?.name === 'AskUserQuestion'
        );
        // We now emit all AskUserQuestion tools, not preventing duplicates
        expect(toolMessages.length).toBe(2);
      });
    });
  });

  describe('Properties', () => {
    beforeEach(() => {
      agent = new ClaudeBinary({
        ...defaultConfig,
        processSpawner: mockSpawner,
      });
    });

    it('isWaitingForInput should return true in interactive mode when running and not processing', () => {
      agent.start('test');

      // After result event, should be waiting
      const event = { type: 'result', subtype: 'success' };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));

      expect(agent.isWaitingForInput).toBe(true);
    });

    it('isWaitingForInput should return false in autonomous mode', () => {
      agent = new ClaudeBinary({
        ...defaultConfig,
        mode: 'autonomous',
        processSpawner: mockSpawner,
      });
      agent.start('test');

      const event = { type: 'result', subtype: 'success' };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));

      expect(agent.isWaitingForInput).toBe(false);
    });

    it('waitingVersion should increment when waiting status changes', () => {
      // For this specific test, let's just verify the behavior is correct
      // The stream handler integration has been tested elsewhere
      agent = new ClaudeBinary({
        ...defaultConfig,
        processSpawner: mockSpawner,
      });

      // Simulate the stream handler emitting waitingForInput events
      const streamHandler = (agent as any).streamHandler;

      expect(agent.waitingVersion).toBe(0);

      agent.start('test');

      // Simulate first event
      streamHandler.emit('waitingForInput', { isWaiting: true, version: 1 });
      expect(agent.waitingVersion).toBe(1);

      // Simulate second event
      streamHandler.emit('waitingForInput', { isWaiting: true, version: 2 });
      expect(agent.waitingVersion).toBe(2);
    });

    it('permissionMode should return from permissions config', () => {
      agent = new ClaudeBinary({
        ...defaultConfig,
        permissions: { skipPermissions: false, permissionMode: 'plan' },
        processSpawner: mockSpawner,
      });

      expect(agent.permissionMode).toBe('plan');
    });
  });

  describe('Exit Handling', () => {
    beforeEach(() => {
      agent = new ClaudeBinary({
        ...defaultConfig,
        processSpawner: mockSpawner,
      });
    });

    it('should process remaining buffer content on exit', () => {
      agent.start('test');
      const messageListener = jest.fn();
      agent.on('message', messageListener);

      // Simulate partial line in buffer followed by exit
      mockProcess.stdout.emit('data', Buffer.from('{"type":"assistant","message":{"content":[{"type":"text","text":"final"}]}}'));

      // Find and call exit handler
      const exitHandler = mockProcess.on.mock.calls.find((c) => c[0] === 'exit')?.[1];

      if (exitHandler) {
        exitHandler(0);
      }

      expect(messageListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'stdout',
          content: 'final',
        })
      );
    });

    it('should set status to stopped on graceful exit', () => {
      agent.start('test');

      const exitHandler = mockProcess.on.mock.calls.find((c) => c[0] === 'exit')?.[1];

      if (exitHandler) {
        exitHandler(0);
      }

      expect(agent.status).toBe('stopped');
    });

    it('should set status to error on non-zero exit code', () => {
      agent.start('test');

      const exitHandler = mockProcess.on.mock.calls.find((c) => c[0] === 'exit')?.[1];

      if (exitHandler) {
        exitHandler(1);
      }

      expect(agent.status).toBe('error');
    });

    it('should emit exit event with code', () => {
      agent.start('test');
      const exitListener = jest.fn();
      agent.on('exit', exitListener);

      const exitHandler = mockProcess.on.mock.calls.find((c) => c[0] === 'exit')?.[1];

      if (exitHandler) {
        exitHandler(0);
      }

      expect(exitListener).toHaveBeenCalledWith(0);
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      agent = new ClaudeBinary({
        ...defaultConfig,
        processSpawner: mockSpawner,
      });
    });

    it('should detect session not found error from result', () => {
      agent.start('test');
      const sessionNotFoundListener = jest.fn();
      agent.on('sessionNotFound', sessionNotFoundListener);

      const event = {
        type: 'result',
        is_error: true,
        errors: ['No conversation found with session ID: abc-123-def'],
      };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));

      expect(sessionNotFoundListener).toHaveBeenCalledWith('abc-123-def');
    });

    it('should detect session ID conflict from stderr', () => {
      agent.start('test');

      mockProcess.stderr.emit('data', Buffer.from('Session ID test-session already in use\n'));

      expect(agent.sessionError).toContain('already in use');
    });

    it('should handle process error event', () => {
      agent.start('test');
      const statusListener = jest.fn();
      agent.on('status', statusListener);

      // Find and trigger the error handler
      const errorHandler = mockProcess.on.mock.calls.find((c) => c[0] === 'error')?.[1];
      expect(errorHandler).toBeDefined();

      if (errorHandler) {
        errorHandler(new Error('Process failed'));
      }

      expect(agent.status).toBe('error');
      expect(statusListener).toHaveBeenCalledWith('error');
    });
  });

  describe('Tool Content Formatting', () => {
    beforeEach(() => {
      agent = new ClaudeBinary({
        ...defaultConfig,
        processSpawner: mockSpawner,
      });
      agent.start('test');
    });

    it('should format Read tool content correctly', () => {
      const messageListener = jest.fn();
      agent.on('message', messageListener);

      // Emit content_block_start with toolUse
      const startEvent = {
        type: 'content_block_start',
        content_block: {
          toolUse: {
            name: 'Read',
            id: 'tool-read-1',
          },
        },
      };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(startEvent) + '\n'));

      // Emit content_block_delta with partial_json
      const deltaEvent = {
        type: 'content_block_delta',
        delta: {
          partial_json: JSON.stringify({ file_path: '/path/to/file.ts', offset: 10, limit: 50 }),
        },
      };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(deltaEvent) + '\n'));

      // Emit content_block_stop to trigger the tool message
      const stopEvent = { type: 'content_block_stop' };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(stopEvent) + '\n'));

      expect(messageListener).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('🔧 Using tool: Read'),
        })
      );
    });

    it('should format Write tool content correctly', () => {
      const messageListener = jest.fn();
      agent.on('message', messageListener);

      // Emit content_block_start with toolUse
      const startEvent = {
        type: 'content_block_start',
        content_block: {
          toolUse: {
            name: 'Write',
            id: 'tool-write-1',
          },
        },
      };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(startEvent) + '\n'));

      // Emit content_block_delta with partial_json
      const deltaEvent = {
        type: 'content_block_delta',
        delta: {
          partial_json: JSON.stringify({ file_path: '/path/to/file.ts', content: 'some content here' }),
        },
      };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(deltaEvent) + '\n'));

      // Emit content_block_stop to trigger the tool message
      const stopEvent = { type: 'content_block_stop' };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(stopEvent) + '\n'));

      expect(messageListener).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('🔧 Using tool: Write'),
        })
      );
    });

    it('should format Bash tool content correctly', () => {
      const messageListener = jest.fn();
      agent.on('message', messageListener);

      // Emit content_block_start with toolUse
      const startEvent = {
        type: 'content_block_start',
        content_block: {
          type: 'tool_use',
          toolUse: {
            name: 'Bash',
            id: 'tool-bash-1',
          },
        },
      };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(startEvent) + '\n'));

      // Emit content_block_delta with partial_json
      const deltaEvent = {
        type: 'content_block_delta',
        delta: {
          partial_json: JSON.stringify({ command: 'npm run test' }),
        },
      };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(deltaEvent) + '\n'));

      // Emit content_block_stop to trigger the tool message
      const stopEvent = { type: 'content_block_stop' };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(stopEvent) + '\n'));

      expect(messageListener).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('🔧 Using tool: Bash'),
        })
      );
    });

    it('should format Grep tool content correctly', () => {
      const messageListener = jest.fn();
      agent.on('message', messageListener);

      // Emit content_block_start with toolUse
      const startEvent = {
        type: 'content_block_start',
        content_block: {
          type: 'tool_use',
          toolUse: {
            name: 'Grep',
            id: 'tool-grep-1',
          },
        },
      };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(startEvent) + '\n'));

      // Emit content_block_delta with partial_json
      const deltaEvent = {
        type: 'content_block_delta',
        delta: {
          partial_json: JSON.stringify({ pattern: 'function.*test', path: '/src' }),
        },
      };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(deltaEvent) + '\n'));

      // Emit content_block_stop to trigger the tool message
      const stopEvent = { type: 'content_block_stop' };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(stopEvent) + '\n'));

      expect(messageListener).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('🔧 Using tool: Grep'),
        })
      );
    });

    it('should format Task tool content correctly', () => {
      const messageListener = jest.fn();
      agent.on('message', messageListener);

      // Emit content_block_start with toolUse
      const startEvent = {
        type: 'content_block_start',
        content_block: {
          type: 'tool_use',
          toolUse: {
            name: 'Task',
            id: 'tool-task-1',
          },
        },
      };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(startEvent) + '\n'));

      // Emit content_block_delta with partial_json
      const deltaEvent = {
        type: 'content_block_delta',
        delta: {
          partial_json: JSON.stringify({ description: 'Explore codebase', subagent_type: 'Explore' }),
        },
      };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(deltaEvent) + '\n'));

      // Emit content_block_stop to trigger the tool message
      const stopEvent = { type: 'content_block_stop' };
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(stopEvent) + '\n'));

      expect(messageListener).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('🔧 Using tool: Task'),
        })
      );
    });
  });

  describe('sendToolResult idempotency', () => {
    beforeEach(() => {
      agent = new ClaudeBinary({
        ...defaultConfig,
        processSpawner: mockSpawner,
      });
    });

    it('should send tool result to stdin', () => {
      agent.start('initial');
      mockProcess.stdin.write.mockClear();

      agent.sendToolResult('tool-1', '{"answers":{"0":"Yes"}}');

      expect(mockProcess.stdin.write).toHaveBeenCalledTimes(1);
      const writtenData = mockProcess.stdin.write.mock.calls[0]![0] as string;
      const parsed = JSON.parse(writtenData.replace('\n', ''));
      expect(parsed.type).toBe('user');
      expect(parsed.message.content[0].type).toBe('tool_result');
      expect(parsed.message.content[0].tool_use_id).toBe('tool-1');
    });

    it('should ignore duplicate sendToolResult for the same toolUseId', () => {
      agent.start('initial');
      mockProcess.stdin.write.mockClear();

      agent.sendToolResult('tool-dup-1', '{"answers":{"0":"A"}}');
      agent.sendToolResult('tool-dup-1', '{"answers":{"0":"B"}}');

      // Only the first call should write to stdin
      expect(mockProcess.stdin.write).toHaveBeenCalledTimes(1);
    });

    it('should allow different toolUseIds', () => {
      agent.start('initial');
      mockProcess.stdin.write.mockClear();

      agent.sendToolResult('tool-a', '{"answers":{"0":"Yes"}}');
      agent.sendToolResult('tool-b', '{"answers":{"0":"No"}}');

      expect(mockProcess.stdin.write).toHaveBeenCalledTimes(2);
    });

    it('should throw when agent is not running', () => {
      expect(() => agent.sendToolResult('tool-1', 'content'))
        .toThrow('Agent is not running');
    });
  });
});
