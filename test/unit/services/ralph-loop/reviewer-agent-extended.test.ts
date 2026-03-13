import { EventEmitter } from 'events';

import { ReviewerAgent } from '../../../../src/services/ralph-loop/reviewer-agent';
import {
  createMockContextInitializer,
  createTestRalphLoopState,
} from '../../helpers/mock-factories';

describe('ReviewerAgent - Extended Coverage', () => {
  let agent: ReviewerAgent;
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

  function createAgent(config?: {
    appendSystemPrompt?: string;
  }): ReviewerAgent {
    return new ReviewerAgent(
      {
        projectPath: '/test/project',
        model: 'claude-opus-4-6',
        contextInitializer: mockContextInitializer,
        ...config,
      },
      mockSpawner
    );
  }

  function sendFeedbackAndExit(
    feedback: Record<string, unknown>,
    exitCode = 0
  ): void {
    const event = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: JSON.stringify(feedback) }] },
    });
    mockProcess.stdout.emit('data', Buffer.from(event + '\n'));
    mockProcess.emit('exit', exitCode);
  }

  beforeEach(() => {
    mockContextInitializer = createMockContextInitializer();
    mockProcess = new MockChildProcess();
    mockSpawner = {
      spawn: jest.fn().mockReturnValue(mockProcess),
    };
    agent = createAgent();
  });

  describe('tool_use events', () => {
    it('should emit tool_use from assistant message blocks', async () => {
      const toolEvents: Array<{ tool_name: string; tool_id: string }> = [];
      agent.on('tool_use', (info) => toolEvents.push(info));

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      // Send assistant message with tool_use block
      const event = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Read', id: 'tool-123', input: { path: '/foo' } },
            { type: 'text', text: '{"decision":"approve","feedback":"ok"}' },
          ],
        },
      });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));
      mockProcess.emit('exit', 0);

      await runPromise;

      expect(toolEvents).toHaveLength(1);
      expect(toolEvents[0]!.tool_name).toBe('Read');
      expect(toolEvents[0]!.tool_id).toBe('tool-123');
    });

    it('should emit tool_use from content_block_start events', async () => {
      const toolEvents: Array<{ tool_name: string }> = [];
      agent.on('tool_use', (info) => toolEvents.push(info));

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      const blockStart = JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'tool_use', name: 'Bash', id: 'tool-456', input: { command: 'ls' } },
      });
      mockProcess.stdout.emit('data', Buffer.from(blockStart + '\n'));

      sendFeedbackAndExit({ decision: 'approve', feedback: 'good' });
      await runPromise;

      expect(toolEvents).toHaveLength(1);
      expect(toolEvents[0]!.tool_name).toBe('Bash');
    });
  });

  describe('result event handling', () => {
    it('should handle result events without error', async () => {
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      const resultEvent = JSON.stringify({
        type: 'result',
        subtype: 'success',
      });
      mockProcess.stdout.emit('data', Buffer.from(resultEvent + '\n'));

      sendFeedbackAndExit({ decision: 'approve', feedback: 'ok' });
      await runPromise;
    });
  });

  describe('stderr handling', () => {
    it('should log stderr output without crashing', async () => {
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      mockProcess.stderr.emit('data', Buffer.from('Warning: something\n'));

      sendFeedbackAndExit({ decision: 'approve', feedback: 'ok' });
      await runPromise;
      // Should complete without error
    });
  });

  describe('appendSystemPrompt', () => {
    it('should include --append-system-prompt arg when configured', async () => {
      agent = createAgent({ appendSystemPrompt: 'Be very strict' });

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      expect(mockSpawner.spawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--append-system-prompt', 'Be very strict']),
        expect.any(Object)
      );

      sendFeedbackAndExit({ decision: 'approve', feedback: 'ok' });
      await runPromise;
    });

    it('should not include --append-system-prompt when not configured', async () => {
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      const args = mockSpawner.spawn.mock.calls[0]![1] as string[];
      expect(args).not.toContain('--append-system-prompt');

      sendFeedbackAndExit({ decision: 'approve', feedback: 'ok' });
      await runPromise;
    });
  });

  describe('decision normalization edge cases', () => {
    it('should normalize "needschanges" to "needs_changes"', async () => {
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      sendFeedbackAndExit({ decision: 'needschanges', feedback: 'Fix stuff' });
      const result = await runPromise;
      expect(result.decision).toBe('needs_changes');
    });

    it('should normalize "changes_needed" to "needs_changes"', async () => {
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      sendFeedbackAndExit({ decision: 'changes_needed', feedback: 'Fix stuff' });
      const result = await runPromise;
      expect(result.decision).toBe('needs_changes');
    });

    it('should normalize "revise" to "needs_changes"', async () => {
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      sendFeedbackAndExit({ decision: 'revise', feedback: 'Needs revision' });
      const result = await runPromise;
      expect(result.decision).toBe('needs_changes');
    });

    it('should reject when decision is unrecognized', async () => {
      agent.on('error', () => {});

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      // Unknown decision causes parseJsonFeedback to return null
      // Since extractJsonFromOutput found JSON, parseReviewerOutput returns null
      // which triggers 'Failed to parse reviewer feedback' rejection
      sendFeedbackAndExit({ decision: 'maybe', feedback: 'Unsure' });
      await expect(runPromise).rejects.toThrow('Failed to parse reviewer feedback');
    });
  });

  describe('parseJsonFeedback edge cases', () => {
    it('should handle non-string feedback field', async () => {
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      sendFeedbackAndExit({ decision: 'approve', feedback: 123 });
      const result = await runPromise;
      expect(result.decision).toBe('approve');
      expect(result.feedback).toBe('');
    });

    it('should handle missing specificIssues and suggestedImprovements', async () => {
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      sendFeedbackAndExit({ decision: 'reject', feedback: 'bad' });
      const result = await runPromise;
      expect(result.specificIssues).toEqual([]);
      expect(result.suggestedImprovements).toEqual([]);
    });

    it('should filter non-string items from arrays', async () => {
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      sendFeedbackAndExit({
        decision: 'needs_changes',
        feedback: 'issues',
        specificIssues: ['real issue', 42, null, 'another issue'],
        suggestedImprovements: [true, 'improve this'],
      });
      const result = await runPromise;
      expect(result.specificIssues).toEqual(['real issue', 'another issue']);
      expect(result.suggestedImprovements).toEqual(['improve this']);
    });

    it('should reject when JSON in code block is invalid', async () => {
      agent.on('error', () => {});

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      const response = '```json\n{invalid json}\n```';
      const event = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: response }] },
      });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));
      mockProcess.emit('exit', 0);

      // Invalid JSON in code block: extractJsonFromOutput finds code block,
      // parseJsonFeedback fails to parse -> returns null,
      // parseReviewerOutput returns null -> rejects
      await expect(runPromise).rejects.toThrow('Failed to parse reviewer feedback');
    });
  });

  describe('stop with MCP config cleanup', () => {
    it('should handle stop when process has no pid', async () => {
      const noPidProcess = new MockChildProcess();
      noPidProcess.pid = 0;
      mockSpawner.spawn.mockReturnValue(noPidProcess);

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      await agent.stop();

      // Complete the run to avoid hanging promise
      noPidProcess.emit('exit', null);
      await expect(runPromise).rejects.toThrow('Reviewer was stopped');
    });
  });

  describe('exit with remaining line buffer', () => {
    it('should process remaining buffer on exit', async () => {
      const outputs: string[] = [];
      agent.on('output', (content) => outputs.push(content));

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      // Send feedback without trailing newline so it stays in buffer
      const feedback = JSON.stringify({ decision: 'approve', feedback: 'buffered' });
      const event = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: feedback }] },
      });
      mockProcess.stdout.emit('data', Buffer.from(event));
      // No newline - stays in buffer, processed on exit
      mockProcess.emit('exit', 0);

      const result = await runPromise;
      expect(result.decision).toBe('approve');
      expect(result.feedback).toBe('buffered');
    });
  });

  describe('off method', () => {
    it('should remove event listeners', async () => {
      const handler = jest.fn();
      agent.on('output', handler);
      agent.off('output', handler);

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      sendFeedbackAndExit({ decision: 'approve', feedback: 'ok' });
      await runPromise;

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('content_block_delta without text', () => {
    it('should handle delta without text field', async () => {
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      const delta = JSON.stringify({
        type: 'content_block_delta',
        delta: {},
      });
      mockProcess.stdout.emit('data', Buffer.from(delta + '\n'));

      sendFeedbackAndExit({ decision: 'approve', feedback: 'ok' });
      await runPromise;
    });
  });

  describe('empty output handling', () => {
    it('should handle empty collected output on exit code 0', async () => {
      agent.on('error', () => {});

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      // Exit without any output
      mockProcess.emit('exit', 0);

      // createFallbackFeedback with empty string defaults to needs_changes
      const result = await runPromise;
      expect(result.decision).toBe('needs_changes');
    });
  });

  describe('non-object JSON parsed from stream line', () => {
    it('should handle JSON array silently (no crash)', async () => {
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      // JSON array parses as object but has no type field, hits no switch case
      mockProcess.stdout.emit('data', Buffer.from('[1, 2, 3]\n'));

      sendFeedbackAndExit({ decision: 'approve', feedback: 'ok' });
      await runPromise;
    });

    it('should treat JSON null as plain text output', async () => {
      const outputs: string[] = [];
      agent.on('output', (content) => outputs.push(content));

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      // null: typeof null === 'object' AND parsed === null => treated as plain text
      mockProcess.stdout.emit('data', Buffer.from('null\n'));

      sendFeedbackAndExit({ decision: 'approve', feedback: 'ok' });
      await runPromise;

      expect(outputs).toContain('null');
    });
  });

  describe('fallback feedback text detection', () => {
    it('should detect needs_changes when no keywords found', async () => {
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      const event = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Some regular feedback without keywords' }] },
      });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));
      mockProcess.emit('exit', 0);

      const result = await runPromise;
      expect(result.decision).toBe('needs_changes');
    });

    it('should truncate long feedback to 1000 chars', async () => {
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      const longText = 'A'.repeat(2000);
      const event = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: longText }] },
      });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));
      mockProcess.emit('exit', 0);

      const result = await runPromise;
      expect(result.feedback.length).toBe(1000);
    });
  });

  describe('assistant message edge cases', () => {
    it('should handle assistant message with no content array', async () => {
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      const event = JSON.stringify({
        type: 'assistant',
        message: {},
      });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));

      sendFeedbackAndExit({ decision: 'approve', feedback: 'ok' });
      await runPromise;
    });

    it('should handle content block without text field', async () => {
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      const event = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text' }] },
      });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));

      sendFeedbackAndExit({ decision: 'approve', feedback: 'ok' });
      await runPromise;
    });
  });

  describe('MCP server configuration', () => {
    it('should pass --mcp-config when mcpServers are configured', async () => {
      const mockGenerateMcpConfig = jest.spyOn(
        require('../../../../src/agents/message-builder').MessageBuilder,
        'generateMcpConfig'
      ).mockReturnValue('/tmp/mcp-config.json');

      agent = new ReviewerAgent(
        {
          projectPath: '/test/project',
          model: 'claude-opus-4-6',
          contextInitializer: mockContextInitializer,
          mcpServers: [{ id: 'test-1', name: 'test-server', enabled: true, type: 'http', url: 'http://localhost:3000' }],
        },
        mockSpawner
      );

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      const args = mockSpawner.spawn.mock.calls[0]![1] as string[];
      expect(args).toContain('--mcp-config');
      expect(args).toContain('/tmp/mcp-config.json');

      sendFeedbackAndExit({ decision: 'approve', feedback: 'ok' });
      await runPromise;

      mockGenerateMcpConfig.mockRestore();
    });

    it('should not pass --mcp-config when generateMcpConfig returns null', async () => {
      const mockGenerateMcpConfig = jest.spyOn(
        require('../../../../src/agents/message-builder').MessageBuilder,
        'generateMcpConfig'
      ).mockReturnValue(null);

      agent = new ReviewerAgent(
        {
          projectPath: '/test/project',
          model: 'claude-opus-4-6',
          contextInitializer: mockContextInitializer,
          mcpServers: [{ id: 'test-1', name: 'test-server', enabled: true, type: 'http', url: 'http://localhost:3000' }],
        },
        mockSpawner
      );

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      const args = mockSpawner.spawn.mock.calls[0]![1] as string[];
      expect(args).not.toContain('--mcp-config');

      sendFeedbackAndExit({ decision: 'approve', feedback: 'ok' });
      await runPromise;

      mockGenerateMcpConfig.mockRestore();
    });

    it('should not add --mcp-config when mcpServers is empty', async () => {
      agent = new ReviewerAgent(
        {
          projectPath: '/test/project',
          model: 'claude-opus-4-6',
          contextInitializer: mockContextInitializer,
          mcpServers: [],
        },
        mockSpawner
      );

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      const args = mockSpawner.spawn.mock.calls[0]![1] as string[];
      expect(args).not.toContain('--mcp-config');

      sendFeedbackAndExit({ decision: 'approve', feedback: 'ok' });
      await runPromise;
    });
  });

  describe('MCP config cleanup on stop', () => {
    it('should delete MCP config file when stopping', async () => {
      const mockUnlinkSync = jest.spyOn(require('fs'), 'unlinkSync').mockImplementation(() => {});
      const mockGenerateMcpConfig = jest.spyOn(
        require('../../../../src/agents/message-builder').MessageBuilder,
        'generateMcpConfig'
      ).mockReturnValue('/tmp/mcp-reviewer.json');

      agent = new ReviewerAgent(
        {
          projectPath: '/test/project',
          model: 'claude-opus-4-6',
          contextInitializer: mockContextInitializer,
          mcpServers: [{ id: 'srv-1', name: 'srv', enabled: true, type: 'http', url: 'http://localhost' }],
        },
        mockSpawner
      );

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      // Start stop, then emit exit to satisfy both the stop promise and run promise
      const stopPromise = agent.stop();
      // Emit exit shortly after so the 'exit' listener in stop() fires
      setImmediate(() => mockProcess.emit('exit', null));

      await stopPromise;
      await expect(runPromise).rejects.toThrow('Reviewer was stopped');
      expect(mockUnlinkSync).toHaveBeenCalledWith('/tmp/mcp-reviewer.json');

      mockUnlinkSync.mockRestore();
      mockGenerateMcpConfig.mockRestore();
    });

    it('should handle MCP config file deletion error gracefully', async () => {
      const mockUnlinkSync = jest.spyOn(require('fs'), 'unlinkSync').mockImplementation(() => {
        throw new Error('ENOENT: no such file');
      });
      const mockGenerateMcpConfig = jest.spyOn(
        require('../../../../src/agents/message-builder').MessageBuilder,
        'generateMcpConfig'
      ).mockReturnValue('/tmp/mcp-reviewer.json');

      agent = new ReviewerAgent(
        {
          projectPath: '/test/project',
          model: 'claude-opus-4-6',
          contextInitializer: mockContextInitializer,
          mcpServers: [{ id: 'srv-1', name: 'srv', enabled: true, type: 'http', url: 'http://localhost' }],
        },
        mockSpawner
      );

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      // Should not throw even if unlink fails
      const stopPromise = agent.stop();
      setImmediate(() => mockProcess.emit('exit', null));

      await stopPromise;
      await expect(runPromise).rejects.toThrow('Reviewer was stopped');

      mockUnlinkSync.mockRestore();
      mockGenerateMcpConfig.mockRestore();
    });
  });

  describe('MCP config cleanup on exit', () => {
    it('should delete MCP config file on successful exit', async () => {
      const mockUnlinkSync = jest.spyOn(require('fs'), 'unlinkSync').mockImplementation(() => {});
      const mockGenerateMcpConfig = jest.spyOn(
        require('../../../../src/agents/message-builder').MessageBuilder,
        'generateMcpConfig'
      ).mockReturnValue('/tmp/mcp-exit.json');

      agent = new ReviewerAgent(
        {
          projectPath: '/test/project',
          model: 'claude-opus-4-6',
          contextInitializer: mockContextInitializer,
          mcpServers: [{ id: 'srv-1', name: 'srv', enabled: true, type: 'http', url: 'http://localhost' }],
        },
        mockSpawner
      );

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      sendFeedbackAndExit({ decision: 'approve', feedback: 'done' });
      await runPromise;

      // unlinkSync called during stop (if applicable) or exit cleanup
      expect(mockUnlinkSync).toHaveBeenCalledWith('/tmp/mcp-exit.json');

      mockUnlinkSync.mockRestore();
      mockGenerateMcpConfig.mockRestore();
    });

    it('should handle MCP config deletion error on exit gracefully', async () => {
      const mockUnlinkSync = jest.spyOn(require('fs'), 'unlinkSync').mockImplementation(() => {
        throw new Error('Permission denied');
      });
      const mockGenerateMcpConfig = jest.spyOn(
        require('../../../../src/agents/message-builder').MessageBuilder,
        'generateMcpConfig'
      ).mockReturnValue('/tmp/mcp-exit-err.json');

      agent = new ReviewerAgent(
        {
          projectPath: '/test/project',
          model: 'claude-opus-4-6',
          contextInitializer: mockContextInitializer,
          mcpServers: [{ id: 'srv-1', name: 'srv', enabled: true, type: 'http', url: 'http://localhost' }],
        },
        mockSpawner
      );

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      sendFeedbackAndExit({ decision: 'approve', feedback: 'done' });

      // Should not throw despite unlink error
      await runPromise;

      mockUnlinkSync.mockRestore();
      mockGenerateMcpConfig.mockRestore();
    });
  });

  describe('sendContext without stdin', () => {
    it('should handle missing stdin gracefully', async () => {
      const noStdinProcess = new MockChildProcess();
      Object.defineProperty(noStdinProcess, 'stdin', { value: null });
      noStdinProcess.pid = 99999;
      mockSpawner.spawn.mockReturnValue(noStdinProcess);

      agent.on('error', () => {});

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      // Process exits immediately since no context sent
      noStdinProcess.emit('exit', 0);

      // Should create fallback feedback
      const result = await runPromise;
      expect(result.decision).toBe('needs_changes');
    });
  });

  describe('stop with force kill timeout', () => {
    it('should force kill after timeout if process does not exit', async () => {
      jest.useFakeTimers();

      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      const stopPromise = agent.stop();

      // Advance past the 5s forceKill timeout
      jest.advanceTimersByTime(5100);

      // Then process exits
      mockProcess.emit('exit', null);

      await stopPromise;
      await expect(runPromise).rejects.toThrow('Reviewer was stopped');

      jest.useRealTimers();
    });
  });

  describe('stop when process becomes null during stop', () => {
    it('should handle isStopping when already stopping', async () => {
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      // First stop call
      const stop1 = agent.stop();
      // Second stop call while first is in progress (isStopping = true)
      const stop2 = agent.stop();

      mockProcess.emit('exit', null);

      await stop1;
      await stop2;
      await expect(runPromise).rejects.toThrow('Reviewer was stopped');
    });
  });

  describe('killProcessTree on stop', () => {
    it('should call kill on process when stopping with valid pid', async () => {
      const state = createTestRalphLoopState();
      const runPromise = agent.run(state, 'Worker output');

      // Stop the agent - it will try to kill the process tree
      const stopPromise = agent.stop();
      mockProcess.emit('exit', null);

      await stopPromise;
      await expect(runPromise).rejects.toThrow('Reviewer was stopped');
    });
  });
});
