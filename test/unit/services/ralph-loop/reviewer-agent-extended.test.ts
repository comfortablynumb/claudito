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
});
