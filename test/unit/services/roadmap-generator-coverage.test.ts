import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';
import {
  ClaudeRoadmapGenerator,
  RoadmapGeneratorDependencies,
  ProcessSpawner,
  FileOperations,
  RoadmapMessage,
} from '../../../src/services/roadmap-generator';

class MockChildProcess extends EventEmitter {
  pid: number;
  stdin: { write: jest.Mock; end: jest.Mock };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: jest.Mock;

  constructor(pid = 12345) {
    super();
    this.pid = pid;
    this.stdin = { write: jest.fn(), end: jest.fn() };
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.kill = jest.fn();
  }

  async close(code: number | null): Promise<void> {
    await new Promise(resolve => setImmediate(resolve));
    this.emit('close', code);
  }
}

function createMockFileOps(): jest.Mocked<FileOperations> {
  return {
    mkdir: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(true),
  };
}

function createGenerator(mockProcess: MockChildProcess): {
  generator: ClaudeRoadmapGenerator;
  spawner: jest.Mocked<ProcessSpawner>;
} {
  const spawner: jest.Mocked<ProcessSpawner> = {
    spawn: jest.fn().mockReturnValue(mockProcess as unknown as ChildProcess),
  };

  const deps: RoadmapGeneratorDependencies = {
    processSpawner: spawner,
    fileOps: createMockFileOps(),
  };

  return { generator: new ClaudeRoadmapGenerator(deps), spawner };
}

const DEFAULT_OPTIONS = {
  projectId: 'test-project',
  projectPath: '/test/path',
  projectName: 'Test Project',
  prompt: 'Create a roadmap',
};

describe('ClaudeRoadmapGenerator - Coverage', () => {
  describe('processStreamLine - assistant tool_use blocks', () => {
    it('should emit system message for tool_use in assistant message', async () => {
      const mockProcess = new MockChildProcess();
      const { generator } = createGenerator(mockProcess);
      const messages: RoadmapMessage[] = [];
      generator.on('message', (_id, msg) => messages.push(msg));

      const generatePromise = generator.generate(DEFAULT_OPTIONS);
      await new Promise(resolve => setImmediate(resolve));

      const event = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Write' },
            { type: 'text', text: 'Writing file' },
          ],
        },
      });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));
      await mockProcess.close(0);
      await generatePromise;

      expect(messages.some(m => m.content === 'Using tool: Write')).toBe(true);
      expect(messages.some(m => m.content === 'Writing file')).toBe(true);
    });
  });

  describe('processStreamLine - result event', () => {
    it('should log result event', async () => {
      const mockProcess = new MockChildProcess();
      const { generator } = createGenerator(mockProcess);

      const generatePromise = generator.generate(DEFAULT_OPTIONS);
      await new Promise(resolve => setImmediate(resolve));

      const event = JSON.stringify({
        type: 'result',
        subtype: 'success',
      });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));
      await mockProcess.close(0);
      await generatePromise;
      // No crash expected, result event is logged
    });
  });

  describe('processStreamLine - system event', () => {
    it('should handle system event silently', async () => {
      const mockProcess = new MockChildProcess();
      const { generator } = createGenerator(mockProcess);

      const generatePromise = generator.generate(DEFAULT_OPTIONS);
      await new Promise(resolve => setImmediate(resolve));

      const event = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-1' });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));
      await mockProcess.close(0);
      await generatePromise;
    });
  });

  describe('processStreamLine - user event', () => {
    it('should handle user event silently', async () => {
      const mockProcess = new MockChildProcess();
      const { generator } = createGenerator(mockProcess);

      const generatePromise = generator.generate(DEFAULT_OPTIONS);
      await new Promise(resolve => setImmediate(resolve));

      const event = JSON.stringify({ type: 'user', message: { content: [] } });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));
      await mockProcess.close(0);
      await generatePromise;
    });
  });

  describe('processStreamLine - unknown event type', () => {
    it('should handle unknown event type', async () => {
      const mockProcess = new MockChildProcess();
      const { generator } = createGenerator(mockProcess);

      const generatePromise = generator.generate(DEFAULT_OPTIONS);
      await new Promise(resolve => setImmediate(resolve));

      const event = JSON.stringify({ type: 'unknown_event_type' });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));
      await mockProcess.close(0);
      await generatePromise;
    });
  });

  describe('processStreamLine - non-object JSON', () => {
    it('should emit non-object JSON as stdout', async () => {
      const mockProcess = new MockChildProcess();
      const { generator } = createGenerator(mockProcess);
      const messages: RoadmapMessage[] = [];
      generator.on('message', (_id, msg) => messages.push(msg));

      const generatePromise = generator.generate(DEFAULT_OPTIONS);
      await new Promise(resolve => setImmediate(resolve));

      // A number is valid JSON but not an object
      mockProcess.stdout.emit('data', Buffer.from('42\n'));
      await mockProcess.close(0);
      await generatePromise;

      expect(messages.some(m => m.content === '42')).toBe(true);
    });
  });

  describe('processStreamLine - content_block_start without tool_use', () => {
    it('should handle content_block_start for text type', async () => {
      const mockProcess = new MockChildProcess();
      const { generator } = createGenerator(mockProcess);

      const generatePromise = generator.generate(DEFAULT_OPTIONS);
      await new Promise(resolve => setImmediate(resolve));

      const event = JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'text' },
      });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));
      await mockProcess.close(0);
      await generatePromise;
    });
  });

  describe('question detection patterns', () => {
    it('should detect "Can you specify" pattern', async () => {
      const mockProcess = new MockChildProcess();
      const { generator } = createGenerator(mockProcess);
      const messages: RoadmapMessage[] = [];
      generator.on('message', (_id, msg) => messages.push(msg));

      const generatePromise = generator.generate(DEFAULT_OPTIONS);
      await new Promise(resolve => setImmediate(resolve));

      const event = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Can you specify the target framework?' }],
        },
      });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));
      await mockProcess.close(0);
      await generatePromise;

      expect(messages.some(m => m.type === 'question')).toBe(true);
    });

    it('should detect "Please select" pattern', async () => {
      const mockProcess = new MockChildProcess();
      const { generator } = createGenerator(mockProcess);
      const messages: RoadmapMessage[] = [];
      generator.on('message', (_id, msg) => messages.push(msg));

      const generatePromise = generator.generate(DEFAULT_OPTIONS);
      await new Promise(resolve => setImmediate(resolve));

      const event = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Please select a database.' }],
        },
      });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));
      await mockProcess.close(0);
      await generatePromise;

      expect(messages.some(m => m.type === 'question')).toBe(true);
    });

    it('should detect "Which option" pattern', async () => {
      const mockProcess = new MockChildProcess();
      const { generator } = createGenerator(mockProcess);
      const messages: RoadmapMessage[] = [];
      generator.on('message', (_id, msg) => messages.push(msg));

      const generatePromise = generator.generate(DEFAULT_OPTIONS);
      await new Promise(resolve => setImmediate(resolve));

      const event = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Which option do you prefer?' }],
        },
      });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));
      await mockProcess.close(0);
      await generatePromise;

      expect(messages.some(m => m.type === 'question')).toBe(true);
    });
  });

  describe('content_block_delta without text', () => {
    it('should ignore content_block_delta with no text', async () => {
      const mockProcess = new MockChildProcess();
      const { generator } = createGenerator(mockProcess);
      const stdoutMessages: RoadmapMessage[] = [];
      generator.on('message', (_id, msg) => {
        if (msg.type === 'stdout') stdoutMessages.push(msg);
      });

      const generatePromise = generator.generate(DEFAULT_OPTIONS);
      await new Promise(resolve => setImmediate(resolve));

      const event = JSON.stringify({ type: 'content_block_delta', delta: {} });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));
      await mockProcess.close(0);
      await generatePromise;

      // No stdout message for empty delta
      const deltaMessages = stdoutMessages.filter(m => !m.content.includes('Running Claude'));
      expect(deltaMessages).toHaveLength(0);
    });
  });

  describe('assistant message without content', () => {
    it('should handle assistant message with no content array', async () => {
      const mockProcess = new MockChildProcess();
      const { generator } = createGenerator(mockProcess);

      const generatePromise = generator.generate(DEFAULT_OPTIONS);
      await new Promise(resolve => setImmediate(resolve));

      const event = JSON.stringify({ type: 'assistant', message: {} });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));
      await mockProcess.close(0);
      await generatePromise;
    });
  });

  describe('empty lines in stream', () => {
    it('should skip empty lines', async () => {
      const mockProcess = new MockChildProcess();
      const { generator } = createGenerator(mockProcess);

      const generatePromise = generator.generate(DEFAULT_OPTIONS);
      await new Promise(resolve => setImmediate(resolve));

      mockProcess.stdout.emit('data', Buffer.from('\n\n\n'));
      await mockProcess.close(0);
      await generatePromise;
    });
  });

  describe('multiple content blocks in single message', () => {
    it('should combine text blocks for question detection', async () => {
      const mockProcess = new MockChildProcess();
      const { generator } = createGenerator(mockProcess);
      const messages: RoadmapMessage[] = [];
      generator.on('message', (_id, msg) => messages.push(msg));

      const generatePromise = generator.generate(DEFAULT_OPTIONS);
      await new Promise(resolve => setImmediate(resolve));

      const event = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'I have two options. ' },
            { type: 'text', text: 'Would you like option A or B?' },
          ],
        },
      });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));
      await mockProcess.close(0);
      await generatePromise;

      expect(messages.some(m => m.type === 'question')).toBe(true);
    });
  });
});
