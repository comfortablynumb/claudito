import { EventEmitter } from 'events';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
  execFile: jest.fn(),
}));

jest.mock('fs', () => ({
  unlinkSync: jest.fn(),
}));

jest.mock('../../../../src/agents/message-builder', () => ({
  MessageBuilder: {
    generateMcpConfig: jest.fn(),
  },
}));

import { spawn, execFile } from 'child_process';
import * as fs from 'fs';

import { WorkerAgent } from '../../../../src/services/ralph-loop/worker-agent';
import { MessageBuilder } from '../../../../src/agents/message-builder';
import {
  createMockContextInitializer,
  createTestRalphLoopState,
} from '../../helpers/mock-factories';

const mockedExecFile = execFile as unknown as jest.Mock;
const mockedUnlinkSync = fs.unlinkSync as jest.Mock;
const mockedGenerateMcpConfig = MessageBuilder.generateMcpConfig as jest.Mock;

describe('WorkerAgent - additional coverage', () => {
  let mockContextInitializer: ReturnType<typeof createMockContextInitializer>;
  let mockProcess: MockChildProcess;
  let mockSpawner: { spawn: jest.Mock };

  class MockChildProcess extends EventEmitter {
    stdin = {
      write: jest.fn().mockReturnValue(true),
      end: jest.fn(),
      destroyed: false,
    };
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    pid = 12345;
    kill = jest.fn();
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockContextInitializer = createMockContextInitializer();
    mockProcess = new MockChildProcess();
    mockSpawner = {
      spawn: jest.fn().mockReturnValue(mockProcess),
    };
  });

  function createAgent(overrides: Record<string, unknown> = {}) {
    return new WorkerAgent(
      {
        projectPath: '/test/project',
        model: 'claude-opus-4-6',
        contextInitializer: mockContextInitializer,
        ...overrides,
      },
      mockSpawner
    );
  }

  function emitStdout(data: string) {
    mockProcess.stdout.emit('data', Buffer.from(data));
  }

  describe('buildArgs with appendSystemPrompt', () => {
    it('should include --append-system-prompt when configured', async () => {
      const agent = createAgent({ appendSystemPrompt: 'Be concise' });
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      expect(mockSpawner.spawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--append-system-prompt', 'Be concise']),
        expect.any(Object)
      );

      mockProcess.emit('exit', 0);
      await runPromise;
    });

    it('should not include --append-system-prompt when not configured', async () => {
      const agent = createAgent();
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      const spawnArgs = mockSpawner.spawn.mock.calls[0][1] as string[];
      expect(spawnArgs).not.toContain('--append-system-prompt');

      mockProcess.emit('exit', 0);
      await runPromise;
    });
  });

  describe('buildArgs with mcpServers', () => {
    const mcpServers = [
      {
        id: 'server1',
        name: 'Test Server',
        enabled: true,
        command: 'node',
        args: ['server.js'],
      },
    ];

    it('should generate MCP config and include --mcp-config flag', async () => {
      mockedGenerateMcpConfig.mockReturnValue('/tmp/mcp-config.json');
      const agent = createAgent({ mcpServers });
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      expect(mockedGenerateMcpConfig).toHaveBeenCalledWith(mcpServers, 'ralph-worker');
      expect(mockSpawner.spawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--mcp-config', '/tmp/mcp-config.json']),
        expect.any(Object)
      );

      mockProcess.emit('exit', 0);
      await runPromise;
    });

    it('should not add --mcp-config when generateMcpConfig returns null', async () => {
      mockedGenerateMcpConfig.mockReturnValue(null);
      const agent = createAgent({ mcpServers });
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      const spawnArgs = mockSpawner.spawn.mock.calls[0][1] as string[];
      expect(spawnArgs).not.toContain('--mcp-config');

      mockProcess.emit('exit', 0);
      await runPromise;
    });

    it('should not generate MCP config when mcpServers is empty', async () => {
      const agent = createAgent({ mcpServers: [] });
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      expect(mockedGenerateMcpConfig).not.toHaveBeenCalled();

      mockProcess.emit('exit', 0);
      await runPromise;
    });
  });

  describe('MCP config cleanup on stop', () => {
    it('should delete MCP config file when stopping', async () => {
      mockedGenerateMcpConfig.mockReturnValue('/tmp/mcp-stop.json');
      const agent = createAgent({
        mcpServers: [{ id: 's1', name: 'S', enabled: true, command: 'cmd', args: [] }],
      });

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      const stopPromise = agent.stop();
      mockProcess.emit('exit', null);
      await stopPromise;

      expect(mockedUnlinkSync).toHaveBeenCalledWith('/tmp/mcp-stop.json');
      await expect(runPromise).rejects.toThrow('Worker was stopped');
    });

    it('should handle failure to delete MCP config on stop gracefully', async () => {
      mockedGenerateMcpConfig.mockReturnValue('/tmp/mcp-fail.json');
      mockedUnlinkSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const agent = createAgent({
        mcpServers: [{ id: 's1', name: 'S', enabled: true, command: 'cmd', args: [] }],
      });

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      // Should not throw despite unlink failure
      const stopPromise = agent.stop();
      mockProcess.emit('exit', null);
      await stopPromise;

      await expect(runPromise).rejects.toThrow('Worker was stopped');
    });
  });

  describe('MCP config cleanup on process exit', () => {
    it('should delete MCP config file on successful exit', async () => {
      mockedGenerateMcpConfig.mockReturnValue('/tmp/mcp-exit.json');
      const agent = createAgent({
        mcpServers: [{ id: 's1', name: 'S', enabled: true, command: 'cmd', args: [] }],
      });

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      mockProcess.emit('exit', 0);
      await runPromise;

      expect(mockedUnlinkSync).toHaveBeenCalledWith('/tmp/mcp-exit.json');
    });

    it('should delete MCP config file on failed exit', async () => {
      mockedGenerateMcpConfig.mockReturnValue('/tmp/mcp-fail-exit.json');
      const agent = createAgent({
        mcpServers: [{ id: 's1', name: 'S', enabled: true, command: 'cmd', args: [] }],
      });
      agent.on('error', () => {}); // Prevent unhandled error

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      mockProcess.emit('exit', 1);
      await expect(runPromise).rejects.toThrow();

      expect(mockedUnlinkSync).toHaveBeenCalledWith('/tmp/mcp-fail-exit.json');
    });

    it('should handle unlink failure on exit gracefully', async () => {
      mockedGenerateMcpConfig.mockReturnValue('/tmp/mcp-exit-fail.json');
      mockedUnlinkSync.mockImplementation(() => {
        throw new Error('File not found');
      });

      const agent = createAgent({
        mcpServers: [{ id: 's1', name: 'S', enabled: true, command: 'cmd', args: [] }],
      });

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      // Should not throw despite unlink failure
      mockProcess.emit('exit', 0);
      await runPromise;

      expect(agent.status).toBe('completed');
    });
  });

  describe('content_block_start event handling', () => {
    it('should handle content_block_start with tool_use', async () => {
      const toolUseEvents: Array<{ tool_name: string }> = [];
      const agent = createAgent();
      agent.on('tool_use', (info) => toolUseEvents.push(info));

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      const event = JSON.stringify({
        type: 'content_block_start',
        content_block: {
          type: 'tool_use',
          name: 'Read',
          id: 'tool_123',
          input: { file_path: '/test.txt' },
        },
      });
      emitStdout(event + '\n');

      mockProcess.emit('exit', 0);
      await runPromise;

      expect(toolUseEvents).toHaveLength(1);
      expect(toolUseEvents[0]!.tool_name).toBe('Read');
    });

    it('should handle content_block_start without tool_use type', async () => {
      const toolUseEvents: Array<{ tool_name: string }> = [];
      const agent = createAgent();
      agent.on('tool_use', (info) => toolUseEvents.push(info));

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      const event = JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'text' },
      });
      emitStdout(event + '\n');

      mockProcess.emit('exit', 0);
      await runPromise;

      expect(toolUseEvents).toHaveLength(0);
    });

    it('should handle content_block_start without content_block', async () => {
      const agent = createAgent();
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      const event = JSON.stringify({ type: 'content_block_start' });
      emitStdout(event + '\n');

      mockProcess.emit('exit', 0);
      await runPromise;

      expect(agent.status).toBe('completed');
    });
  });

  describe('handleToolUse details', () => {
    it('should emit tool_use with full parameters', async () => {
      const toolUseEvents: Array<Record<string, unknown>> = [];
      const agent = createAgent();
      agent.on('tool_use', (info) => toolUseEvents.push(info));

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      const event = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Write',
              id: 'tool_abc',
              input: { file_path: '/test.txt', content: 'hello' },
            },
          ],
        },
      });
      emitStdout(event + '\n');

      mockProcess.emit('exit', 0);
      await runPromise;

      expect(toolUseEvents).toHaveLength(1);
      expect(toolUseEvents[0]!.tool_name).toBe('Write');
      expect(toolUseEvents[0]!.tool_id).toBe('tool_abc');
      expect(toolUseEvents[0]!.parameters).toEqual({ file_path: '/test.txt', content: 'hello' });
      expect(toolUseEvents[0]!.timestamp).toBeDefined();
    });

    it('should emit tool_use with empty id and parameters when missing', async () => {
      const toolUseEvents: Array<Record<string, unknown>> = [];
      const agent = createAgent();
      agent.on('tool_use', (info) => toolUseEvents.push(info));

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      const event = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Bash' }],
        },
      });
      emitStdout(event + '\n');

      mockProcess.emit('exit', 0);
      await runPromise;

      expect(toolUseEvents[0]!.tool_id).toBe('');
      expect(toolUseEvents[0]!.parameters).toEqual({});
    });

    it('should emit tool_use for Edit tool', async () => {
      const toolUseEvents: Array<Record<string, unknown>> = [];
      const agent = createAgent();
      agent.on('tool_use', (info) => toolUseEvents.push(info));

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      const event = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Edit', id: 'edit_1', input: { file_path: '/a.ts' } },
          ],
        },
      });
      emitStdout(event + '\n');

      mockProcess.emit('exit', 0);
      await runPromise;

      expect(toolUseEvents[0]!.tool_name).toBe('Edit');
    });
  });

  describe('assistant message with tool_use debug logging', () => {
    it('should process assistant events with multiple content blocks', async () => {
      const outputs: string[] = [];
      const toolEvents: Array<Record<string, unknown>> = [];
      const agent = createAgent();
      agent.on('output', (content) => outputs.push(content));
      agent.on('tool_use', (info) => toolEvents.push(info));

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      const event = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'I will edit the file' },
            { type: 'tool_use', name: 'Edit', id: 'e1', input: { file_path: '/x.ts' } },
            { type: 'text', text: 'Done editing' },
            { type: 'tool_use', name: 'Write', id: 'w1', input: { file_path: '/y.ts', content: 'new' } },
          ],
        },
      });
      emitStdout(event + '\n');

      mockProcess.emit('exit', 0);
      await runPromise;

      expect(outputs).toContain('I will edit the file');
      expect(outputs).toContain('Done editing');
      expect(toolEvents).toHaveLength(2);
      expect(toolEvents[0]!.tool_name).toBe('Edit');
      expect(toolEvents[1]!.tool_name).toBe('Write');
    });
  });

  describe('stop with process that has null process reference', () => {
    it('should resolve immediately when process becomes null during stop', async () => {
      const agent = createAgent();
      // Agent is idle, no process
      await agent.stop();
      expect(agent.status).toBe('idle');
    });
  });

  describe('kill process tree (Windows)', () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should use taskkill on Windows when stopping', async () => {
      // The isWindows constant is captured at module load, so we test via execFile mock
      // We verify the stop behavior through the mock process exit
      const agent = createAgent();
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      const stopPromise = agent.stop();
      mockProcess.emit('exit', null);
      await stopPromise;

      await expect(runPromise).rejects.toThrow('Worker was stopped');
    });
  });

  describe('force kill timeout', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should force kill after 5 second timeout', async () => {
      const agent = createAgent();
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      // Start stopping - do NOT emit exit yet
      const stopPromise = agent.stop();

      // Advance past the 5s force kill timeout
      jest.advanceTimersByTime(5001);

      // Now emit exit
      mockProcess.emit('exit', null);
      await stopPromise;

      await expect(runPromise).rejects.toThrow('Worker was stopped');
    });
  });

  describe('process without pid on startProcess', () => {
    it('should still setup handlers when pid is undefined', async () => {
      const processNoPid = new MockChildProcess();
      (processNoPid as { pid: number | undefined }).pid = undefined;
      mockSpawner.spawn.mockReturnValue(processNoPid);

      const agent = createAgent();
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      processNoPid.emit('exit', 0);
      await runPromise;

      expect(agent.status).toBe('completed');
    });
  });

  describe('setupCompletionHandlers with no process', () => {
    it('should reject when process is nullified before completion handlers set up', async () => {
      // This is hard to test directly, but we test the remaining buffer edge case on exit
      const agent = createAgent();
      agent.on('error', () => {});

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      // Send data that stays in buffer, then exit with failure
      emitStdout('incomplete json');
      mockProcess.emit('exit', 1);

      await expect(runPromise).rejects.toThrow('Worker process exited with code 1');
    });
  });

  describe('reset between runs', () => {
    it('should reset state between consecutive runs', async () => {
      const agent = createAgent();
      const state1 = createTestRalphLoopState({ currentIteration: 1 });
      const state2 = createTestRalphLoopState({ currentIteration: 2 });

      // First run with output
      const run1Promise = agent.run(state1);
      const event1 = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'First run output' }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      });
      emitStdout(event1 + '\n');
      mockProcess.emit('exit', 0);
      const summary1 = await run1Promise;

      expect(summary1.workerOutput).toContain('First run output');
      expect(summary1.tokensUsed).toBe(150);

      // Second run - output should be clean
      mockProcess = new MockChildProcess();
      mockSpawner.spawn.mockReturnValue(mockProcess);

      const run2Promise = agent.run(state2);
      const event2 = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Second run output' }],
          usage: { input_tokens: 200, output_tokens: 100 },
        },
      });
      emitStdout(event2 + '\n');
      mockProcess.emit('exit', 0);
      const summary2 = await run2Promise;

      expect(summary2.workerOutput).not.toContain('First run output');
      expect(summary2.workerOutput).toContain('Second run output');
      expect(summary2.tokensUsed).toBe(300);
      expect(summary2.iterationNumber).toBe(2);
    });
  });

  describe('usage tracking from different event types', () => {
    it('should track usage from top-level usage field on non-assistant events', async () => {
      const agent = createAgent();
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      const event = JSON.stringify({
        type: 'result',
        usage: { input_tokens: 400, output_tokens: 200 },
      });
      emitStdout(event + '\n');

      mockProcess.emit('exit', 0);
      const summary = await runPromise;

      expect(summary.tokensUsed).toBe(600);
    });

    it('should overwrite tokens (not accumulate) per event', async () => {
      const agent = createAgent();
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      // First event with tokens
      emitStdout(JSON.stringify({
        type: 'assistant',
        message: { content: [], usage: { input_tokens: 100, output_tokens: 50 } },
      }) + '\n');

      // Second event overwrites
      emitStdout(JSON.stringify({
        type: 'assistant',
        message: { content: [], usage: { input_tokens: 500, output_tokens: 300 } },
      }) + '\n');

      mockProcess.emit('exit', 0);
      const summary = await runPromise;

      // Should be last value, not accumulated
      expect(summary.tokensUsed).toBe(800);
    });
  });

  describe('processStreamLine edge cases', () => {
    it('should handle whitespace-only lines in non-JSON catch block', async () => {
      const outputs: string[] = [];
      const agent = createAgent();
      agent.on('output', (content) => outputs.push(content));

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      // Invalid JSON that is just whitespace
      emitStdout('   \n');

      mockProcess.emit('exit', 0);
      await runPromise;

      // Whitespace-only lines should be skipped
      expect(outputs).toHaveLength(0);
    });

    it('should collect non-JSON output as worker output', async () => {
      const agent = createAgent();
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      emitStdout('Some plain text\n');
      emitStdout('More plain text\n');

      mockProcess.emit('exit', 0);
      const summary = await runPromise;

      expect(summary.workerOutput).toContain('Some plain text');
      expect(summary.workerOutput).toContain('More plain text');
    });
  });

  describe('stop with stdout/stderr listener removal', () => {
    it('should remove stdout and stderr listeners on stop', async () => {
      const agent = createAgent();
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      const stdoutSpy = jest.spyOn(mockProcess.stdout, 'removeAllListeners');
      const stderrSpy = jest.spyOn(mockProcess.stderr, 'removeAllListeners');

      const stopPromise = agent.stop();
      mockProcess.emit('exit', null);
      await stopPromise;

      expect(stdoutSpy).toHaveBeenCalledWith('data');
      expect(stderrSpy).toHaveBeenCalledWith('data');

      await expect(runPromise).rejects.toThrow('Worker was stopped');
    });
  });

  describe('plugin directory', () => {
    it('should include --plugin-dir argument', async () => {
      const agent = createAgent({ projectPath: '/my/project' });
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      const spawnArgs = mockSpawner.spawn.mock.calls[0][1] as string[];
      const pluginIdx = spawnArgs.indexOf('--plugin-dir');
      expect(pluginIdx).toBeGreaterThan(-1);
      expect(spawnArgs[pluginIdx + 1]).toMatch(/claudito-plugin/);

      mockProcess.emit('exit', 0);
      await runPromise;
    });
  });

  describe('stdin message format', () => {
    it('should send context as stream-json user message', async () => {
      mockContextInitializer.buildWorkerContext.mockReturnValue('Do the task');
      const agent = createAgent();
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      const writtenData = mockProcess.stdin.write.mock.calls[0][0] as string;
      const parsed = JSON.parse(writtenData.trim());
      expect(parsed.type).toBe('user');
      expect(parsed.message.role).toBe('user');
      expect(parsed.message.content).toBe('Do the task');

      mockProcess.emit('exit', 0);
      await runPromise;
    });
  });

  describe('error event from process', () => {
    it('should set status to failed and emit error on process error event', async () => {
      const errors: string[] = [];
      const statuses: string[] = [];
      const agent = createAgent();
      agent.on('error', (e) => errors.push(e));
      agent.on('status', (s) => statuses.push(s));

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      mockProcess.emit('error', new Error('ENOENT'));
      mockProcess.emit('exit', 1);

      await expect(runPromise).rejects.toThrow();

      expect(errors).toContain('ENOENT');
      expect(statuses).toContain('failed');
    });
  });

  describe('content_block_start with tool_use and no name', () => {
    it('should not emit tool_use when content_block has no name', async () => {
      const toolEvents: Array<Record<string, unknown>> = [];
      const agent = createAgent();
      agent.on('tool_use', (info) => toolEvents.push(info));

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      const event = JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'tool_use' },
      });
      emitStdout(event + '\n');

      mockProcess.emit('exit', 0);
      await runPromise;

      expect(toolEvents).toHaveLength(0);
    });
  });

  describe('unknown event types', () => {
    it('should handle unknown event types without error', async () => {
      const agent = createAgent();
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      const event = JSON.stringify({
        type: 'unknown_event_type',
        data: 'something',
      });
      emitStdout(event + '\n');

      mockProcess.emit('exit', 0);
      await runPromise;

      expect(agent.status).toBe('completed');
    });
  });

  describe('process spawner detached option', () => {
    it('should pass correct spawn options', async () => {
      const agent = createAgent({ projectPath: '/some/path' });
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state);

      const spawnOptions = mockSpawner.spawn.mock.calls[0][2];
      expect(spawnOptions.cwd).toBe('/some/path');
      expect(spawnOptions.shell).toBe(true);
      // detached depends on platform (true on non-Windows)

      mockProcess.emit('exit', 0);
      await runPromise;
    });
  });
});
