import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';
import {
  ClaudeRoadmapGenerator,
  RoadmapGeneratorDependencies,
  ProcessSpawner,
  FileOperations,
  GenerateRoadmapResult,
  RoadmapMessage,
} from '../../../src/services/roadmap-generator';

// Mock process that extends EventEmitter so process.on() works
class MockChildProcess extends EventEmitter {
  pid: number;
  stdin: {
    write: jest.Mock;
    end: jest.Mock;
  };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: jest.Mock;

  constructor(pid = 12345) {
    super();
    this.pid = pid;
    this.stdin = {
      write: jest.fn(),
      end: jest.fn(),
    };
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.kill = jest.fn();
  }

  // Simulate process close (async to allow event listeners to be registered first)
  async close(code: number | null): Promise<void> {
    // Wait for event listeners to be registered
    await new Promise(resolve => setImmediate(resolve));
    this.emit('close', code);
  }

  // Simulate process error (async to allow event listeners to be registered first)
  async error(err: Error): Promise<void> {
    await new Promise(resolve => setImmediate(resolve));
    this.emit('error', err);
  }
}

function createMockChildProcess(pid = 12345): MockChildProcess {
  return new MockChildProcess(pid);
}

function createMockProcessSpawner(
  mockProcess?: MockChildProcess
): jest.Mocked<ProcessSpawner> & { mockProcess: MockChildProcess } {
  const process = mockProcess || createMockChildProcess();

  return {
    spawn: jest.fn().mockReturnValue(process as unknown as ChildProcess),
    mockProcess: process,
  };
}

function createMockFileOps(): jest.Mocked<FileOperations> {
  return {
    mkdir: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(true),
  };
}

describe('ClaudeRoadmapGenerator', () => {
  let generator: ClaudeRoadmapGenerator;
  let mockSpawner: jest.Mocked<ProcessSpawner>;
  let mockFileOps: jest.Mocked<FileOperations>;
  let mockProcess: MockChildProcess;

  beforeEach(() => {
    mockProcess = createMockChildProcess();
    mockSpawner = createMockProcessSpawner(mockProcess);
    mockFileOps = createMockFileOps();

    const deps: RoadmapGeneratorDependencies = {
      processSpawner: mockSpawner,
      fileOps: mockFileOps,
    };

    generator = new ClaudeRoadmapGenerator(deps);
  });

  describe('constructor', () => {
    it('should create with default dependencies', () => {
      const gen = new ClaudeRoadmapGenerator();
      expect(gen).toBeDefined();
    });

    it('should use provided dependencies', () => {
      expect(generator).toBeDefined();
    });
  });

  describe('isGenerating', () => {
    it('should return false when not generating', () => {
      expect(generator.isGenerating('test-project')).toBe(false);
    });

    it('should return true during generation', async () => {
      // Start generation but don't await it
      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      // Wait for process to be spawned (after ensureDocFolder completes)
      await new Promise(resolve => setImmediate(resolve));

      // Check isGenerating before process completes
      expect(generator.isGenerating('test-project')).toBe(true);

      // Complete the process
      await mockProcess.close(0);

      await generatePromise;
      expect(generator.isGenerating('test-project')).toBe(false);
    });
  });

  describe('generate', () => {
    it('should spawn claude process with correct arguments', async () => {
      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      // Simulate process exit (await ensures event listeners are registered first)
      await mockProcess.close(0);

      await generatePromise;

      expect(mockSpawner.spawn).toHaveBeenCalledWith(
        'claude',
        ['--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose'],
        expect.objectContaining({
          cwd: '/test/path',
          shell: true,
        })
      );
    });

    it('should write prompt to stdin and close it', async () => {
      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await mockProcess.close(0);

      await generatePromise;

      expect(mockProcess.stdin.write).toHaveBeenCalledWith(
        expect.stringContaining('Test Project')
      );
      expect(mockProcess.stdin.write).toHaveBeenCalledWith(
        expect.stringContaining('Create a roadmap')
      );
      expect(mockProcess.stdin.end).toHaveBeenCalled();
    });

    it('should create doc folder if it does not exist', async () => {
      mockFileOps.exists.mockResolvedValue(false);

      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await mockProcess.close(0);

      await generatePromise;

      expect(mockFileOps.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('doc')
      );
    });

    it('should not create doc folder if it exists', async () => {
      mockFileOps.exists.mockResolvedValue(true);

      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await mockProcess.close(0);

      await generatePromise;

      expect(mockFileOps.mkdir).not.toHaveBeenCalled();
    });

    it('should return success on code 0', async () => {
      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await mockProcess.close(0);

      const result = await generatePromise;

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return failure on non-zero exit code', async () => {
      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await mockProcess.close(1);

      const result = await generatePromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('exited with code 1');
    });

    it('should capture stderr in error message', async () => {
      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await new Promise(resolve => setImmediate(resolve));

      mockProcess.stderr.emit('data', Buffer.from('Error: something went wrong'));
      await mockProcess.close(1);

      const result = await generatePromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('something went wrong');
    });

    it('should handle process error event', async () => {
      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await mockProcess.error(new Error('spawn error'));

      const result = await generatePromise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('spawn error');
    });

    it('should handle failed process start (no PID)', async () => {
      const noPidProcess = createMockChildProcess(0);
      // Set pid to undefined to simulate failed spawn
      Object.defineProperty(noPidProcess, 'pid', { value: undefined, writable: true });
      mockSpawner.spawn.mockReturnValue(noPidProcess as unknown as ChildProcess);

      const result = await generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to start');
    });

    it('should emit message events', async () => {
      const messages: RoadmapMessage[] = [];
      generator.on('message', (_projectId, message) => {
        messages.push(message);
      });

      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await mockProcess.close(0);

      await generatePromise;

      expect(messages.length).toBeGreaterThan(0);
      expect(messages.some((m) => m.type === 'system')).toBe(true);
    });

    it('should emit complete event', async () => {
      const completions: Array<{ projectId: string; result: GenerateRoadmapResult }> = [];
      generator.on('complete', (projectId, result) => {
        completions.push({ projectId, result });
      });

      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await mockProcess.close(0);

      await generatePromise;

      expect(completions).toHaveLength(1);
      expect(completions[0]?.projectId).toBe('test-project');
      expect(completions[0]?.result.success).toBe(true);
    });

    it('should handle error during doc folder creation', async () => {
      mockFileOps.exists.mockResolvedValue(false);
      mockFileOps.mkdir.mockRejectedValue(new Error('Permission denied'));

      const result = await generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Permission denied');
    });
  });

  describe('sendResponse', () => {
    it('should do nothing if no active process', () => {
      generator.sendResponse('test-project', 'yes');
      // Should not throw
    });

    it('should write response to stdin during generation', async () => {
      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await new Promise(resolve => setImmediate(resolve));

      // Send response while generating
      generator.sendResponse('test-project', 'yes');

      expect(mockProcess.stdin.write).toHaveBeenCalledWith('yes\n');

      await mockProcess.close(0);

      await generatePromise;
    });

    it('should emit system message for sent response', async () => {
      const messages: RoadmapMessage[] = [];
      generator.on('message', (_projectId, message) => {
        messages.push(message);
      });

      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await new Promise(resolve => setImmediate(resolve));

      generator.sendResponse('test-project', 'yes');

      await mockProcess.close(0);

      await generatePromise;

      expect(messages.some((m) => m.content === 'You: yes')).toBe(true);
    });
  });

  describe('Event System', () => {
    it('on should register listener', () => {
      const listener = jest.fn();
      generator.on('message', listener);
      // Listener registration should not throw
    });

    it('off should remove listener', async () => {
      const listener = jest.fn();
      generator.on('message', listener);
      generator.off('message', listener);

      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await mockProcess.close(0);

      await generatePromise;

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('Streaming JSON Parsing', () => {
    it('should parse assistant message with text content', async () => {
      const messages: RoadmapMessage[] = [];
      generator.on('message', (_projectId, message) => {
        messages.push(message);
      });

      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      // Wait for process to be spawned
      await new Promise(resolve => setImmediate(resolve));

      // Simulate streaming JSON output
      const assistantEvent = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Here is your roadmap' }],
        },
      });
      mockProcess.stdout.emit('data', Buffer.from(assistantEvent + '\n'));

      await mockProcess.close(0);

      await generatePromise;

      expect(messages.some((m) => m.content === 'Here is your roadmap')).toBe(true);
    });

    it('should parse content_block_delta event', async () => {
      const messages: RoadmapMessage[] = [];
      generator.on('message', (_projectId, message) => {
        messages.push(message);
      });

      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await new Promise(resolve => setImmediate(resolve));

      const deltaEvent = JSON.stringify({
        type: 'content_block_delta',
        delta: { text: 'Streaming text' },
      });
      mockProcess.stdout.emit('data', Buffer.from(deltaEvent + '\n'));

      await mockProcess.close(0);

      await generatePromise;

      expect(messages.some((m) => m.content === 'Streaming text')).toBe(true);
    });

    it('should parse content_block_start for tool_use', async () => {
      const messages: RoadmapMessage[] = [];
      generator.on('message', (_projectId, message) => {
        messages.push(message);
      });

      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await new Promise(resolve => setImmediate(resolve));

      const toolEvent = JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'tool_use', name: 'Write' },
      });
      mockProcess.stdout.emit('data', Buffer.from(toolEvent + '\n'));

      await mockProcess.close(0);

      await generatePromise;

      expect(messages.some((m) => m.content.includes('Using tool: Write'))).toBe(true);
    });

    it('should detect question in assistant message', async () => {
      const messages: RoadmapMessage[] = [];
      generator.on('message', (_projectId, message) => {
        messages.push(message);
      });

      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await new Promise(resolve => setImmediate(resolve));

      const questionEvent = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Would you like me to continue?' }],
        },
      });
      mockProcess.stdout.emit('data', Buffer.from(questionEvent + '\n'));

      await mockProcess.close(0);

      await generatePromise;

      expect(messages.some((m) => m.type === 'question')).toBe(true);
    });

    it('should handle plain text output (non-JSON)', async () => {
      const messages: RoadmapMessage[] = [];
      generator.on('message', (_projectId, message) => {
        messages.push(message);
      });

      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await new Promise(resolve => setImmediate(resolve));

      mockProcess.stdout.emit('data', Buffer.from('Plain text output\n'));

      await mockProcess.close(0);

      await generatePromise;

      expect(messages.some((m) => m.content === 'Plain text output')).toBe(true);
    });

    it('should handle split JSON across multiple data events', async () => {
      const messages: RoadmapMessage[] = [];
      generator.on('message', (_projectId, message) => {
        messages.push(message);
      });

      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await new Promise(resolve => setImmediate(resolve));

      // Split JSON across two data events
      const fullJson = '{"type":"content_block_delta","delta":{"text":"Split text"}}';
      const part1 = fullJson.substring(0, 20);
      const part2 = fullJson.substring(20) + '\n';

      mockProcess.stdout.emit('data', Buffer.from(part1));
      mockProcess.stdout.emit('data', Buffer.from(part2));

      await mockProcess.close(0);

      await generatePromise;

      expect(messages.some((m) => m.content === 'Split text')).toBe(true);
    });

    it('should parse tool_use in assistant message content', async () => {
      const messages: RoadmapMessage[] = [];
      generator.on('message', (_projectId, message) => {
        messages.push(message);
      });

      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await new Promise(resolve => setImmediate(resolve));

      const event = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'I will write the file' },
            { type: 'tool_use', name: 'Edit' },
          ],
        },
      });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));

      await mockProcess.close(0);
      await generatePromise;

      expect(messages.some((m) => m.content === 'Using tool: Edit')).toBe(true);
      expect(messages.some((m) => m.content === 'I will write the file')).toBe(true);
    });

    it('should handle result event type', async () => {
      const messages: RoadmapMessage[] = [];
      generator.on('message', (_projectId, message) => {
        messages.push(message);
      });

      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await new Promise(resolve => setImmediate(resolve));

      const event = JSON.stringify({ type: 'result', subtype: 'success' });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));

      await mockProcess.close(0);
      await generatePromise;

      // result event logs internally but doesn't emit a message
      // Should not throw and should complete normally
    });

    it('should handle system event type', async () => {
      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await new Promise(resolve => setImmediate(resolve));

      const event = JSON.stringify({ type: 'system', session_id: 'abc123' });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));

      await mockProcess.close(0);
      await generatePromise;
      // system event is silently handled — no error
    });

    it('should handle user event type', async () => {
      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await new Promise(resolve => setImmediate(resolve));

      const event = JSON.stringify({ type: 'user' });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));

      await mockProcess.close(0);
      await generatePromise;
      // user event is silently handled — no error
    });

    it('should handle unknown event type', async () => {
      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await new Promise(resolve => setImmediate(resolve));

      const event = JSON.stringify({ type: 'ping', data: 'keepalive' });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));

      await mockProcess.close(0);
      await generatePromise;
      // unknown event type is logged and silently skipped
    });

    it('should handle non-object JSON as plain text', async () => {
      const messages: RoadmapMessage[] = [];
      generator.on('message', (_projectId, message) => {
        messages.push(message);
      });

      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await new Promise(resolve => setImmediate(resolve));

      // JSON number — valid JSON but not an object
      mockProcess.stdout.emit('data', Buffer.from('42\n'));
      // JSON string
      mockProcess.stdout.emit('data', Buffer.from('"hello"\n'));

      await mockProcess.close(0);
      await generatePromise;

      expect(messages.some((m) => m.content === '42')).toBe(true);
      expect(messages.some((m) => m.content === '"hello"')).toBe(true);
    });

    it('should handle content_block_delta without text', async () => {
      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await new Promise(resolve => setImmediate(resolve));

      const event = JSON.stringify({ type: 'content_block_delta', delta: {} });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));

      await mockProcess.close(0);
      await generatePromise;
      // No crash when delta has no text
    });

    it('should handle content_block_start with non-tool_use type', async () => {
      const messages: RoadmapMessage[] = [];
      generator.on('message', (_projectId, message) => {
        messages.push(message);
      });

      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await new Promise(resolve => setImmediate(resolve));

      const event = JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'text' },
      });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));

      await mockProcess.close(0);
      await generatePromise;

      // text content_block_start should not emit "Using tool" message
      expect(messages.some((m) => m.content.includes('Using tool'))).toBe(false);
    });

    it('should handle assistant message without content', async () => {
      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await new Promise(resolve => setImmediate(resolve));

      const event = JSON.stringify({ type: 'assistant', message: {} });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));

      await mockProcess.close(0);
      await generatePromise;
      // No crash when assistant message has no content array
    });

    it('should handle empty line in stream', async () => {
      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await new Promise(resolve => setImmediate(resolve));

      // Send data with empty lines
      mockProcess.stdout.emit('data', Buffer.from('\n\n'));

      await mockProcess.close(0);
      await generatePromise;
      // Empty lines should be silently skipped
    });

    it('should process remaining buffer on close', async () => {
      const messages: RoadmapMessage[] = [];
      generator.on('message', (_projectId, message) => {
        messages.push(message);
      });

      const generatePromise = generator.generate({
        projectId: 'test-project',
        projectPath: '/test/path',
        projectName: 'Test Project',
        prompt: 'Create a roadmap',
      });

      await new Promise(resolve => setImmediate(resolve));

      // Send data without trailing newline
      mockProcess.stdout.emit('data', Buffer.from('Final text without newline'));

      await mockProcess.close(0);

      await generatePromise;

      expect(messages.some((m) => m.content === 'Final text without newline')).toBe(true);
    });
  });

  describe('Question Detection', () => {
    const testPatterns = [
      { text: 'What do you think?', expected: true },
      { text: 'Would you like me to add more details?', expected: true },
      { text: 'Do you want to proceed?', expected: true },
      { text: 'Should I create the files now?', expected: true },
      { text: 'Can you confirm the project name?', expected: true },
      { text: 'Please choose an option:', expected: true },
      { text: 'Which one do you prefer?', expected: true },
      { text: 'Continue? (y/n)', expected: true },
      { text: 'Proceed? [y/N]', expected: true },
      { text: 'Here is the roadmap.', expected: false },
      { text: 'Created the file successfully.', expected: false },
    ];

    testPatterns.forEach(({ text, expected }) => {
      it(`should ${expected ? 'detect' : 'not detect'} question in: "${text.substring(0, 30)}..."`, async () => {
        const messages: RoadmapMessage[] = [];
        generator.on('message', (_projectId, message) => {
          messages.push(message);
        });

        const generatePromise = generator.generate({
          projectId: 'test-project',
          projectPath: '/test/path',
          projectName: 'Test Project',
          prompt: 'Create a roadmap',
        });

        // Wait for process to be spawned and event listeners registered
        await new Promise(resolve => setImmediate(resolve));

        const event = JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'text', text }],
          },
        });
        mockProcess.stdout.emit('data', Buffer.from(event + '\n'));

        await mockProcess.close(0);

        await generatePromise;

        const hasQuestion = messages.some((m) => m.type === 'question');
        expect(hasQuestion).toBe(expected);
      });
    });
  });

  // Note: Timeout handling tests are skipped because jest.useFakeTimers()
  // conflicts with setImmediate used in the mock process close() method.
  // The timeout behavior is covered by the implementation but is difficult
  // to test reliably with fake timers.
});
