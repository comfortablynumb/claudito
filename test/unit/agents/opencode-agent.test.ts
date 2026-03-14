import { ChildProcess } from 'child_process';
import { OpencodeAgent, OpencodeAgentConfig } from '../../../src/agents/opencode-agent';
import { createMockChildProcess, createMockProcessSpawner, MockChildProcess } from '../helpers/mock-factories';

jest.mock('../../../src/utils/logger', () => ({
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    withProject: jest.fn().mockReturnThis(),
  })),
}));

jest.mock('../../../src/agents/message-builder', () => ({
  MessageBuilder: {
    buildEnvironment: jest.fn().mockReturnValue({ SOME_VAR: 'value' }),
  },
}));

// Helper to trigger all registered handlers for a given event on a mock process.
// For 'exit': both ProcessManager and OpencodeAgent register handlers, we need both.
// For 'error': ProcessManager's handler emits on itself (throws if unhandled), so we skip it
//              and only call OpencodeAgent's handler (the last one registered).
function triggerProcessEvent(mockProcess: MockChildProcess, event: string, ...args: unknown[]): void {
  const handlers = mockProcess.on.mock.calls
    .filter((c) => c[0] === event)
    .map((c) => c[1] as (...a: unknown[]) => void);

  if (event === 'error') {
    // Only call the last handler (OpencodeAgent's) to avoid unhandled ProcessManager error
    const last = handlers[handlers.length - 1];
    last?.(...args);
    return;
  }

  for (const handler of handlers) {
    handler(...args);
  }
}

describe('OpencodeAgent', () => {
  let mockProcess: MockChildProcess;
  let mockSpawner: ReturnType<typeof createMockProcessSpawner>;
  let agent: OpencodeAgent;

  const defaultConfig: OpencodeAgentConfig = {
    projectId: 'test-project',
    projectPath: '/test/path',
  };

  beforeEach(() => {
    mockProcess = createMockChildProcess(12345);
    mockSpawner = createMockProcessSpawner(mockProcess);
    jest.clearAllMocks();
  });

  afterEach(() => {
    agent = undefined as unknown as OpencodeAgent;
  });

  // ============================================================================
  // Constructor
  // ============================================================================

  describe('constructor', () => {
    it('sets default values with minimal config', () => {
      agent = new OpencodeAgent({ ...defaultConfig, processSpawner: mockSpawner });

      expect(agent.projectId).toBe('test-project');
      expect(agent.status).toBe('stopped');
      expect(agent.mode).toBe('interactive');
      expect(agent.collectedOutput).toBe('');
      expect(agent.queuedMessageCount).toBe(0);
      expect(agent.queuedMessages).toEqual([]);
      expect(agent.contextUsage).toBeNull();
      expect(agent.lastCommand).toBeNull();
      expect(agent.processInfo).toBeNull();
      expect(agent.sessionId).toBeNull();
      expect(agent.sessionError).toBeNull();
      expect(agent.permissionMode).toBeNull();
    });

    it('sets mode from config', () => {
      agent = new OpencodeAgent({ ...defaultConfig, mode: 'autonomous', processSpawner: mockSpawner });
      expect(agent.mode).toBe('autonomous');
    });

    it('stores configured sessionId', () => {
      agent = new OpencodeAgent({
        ...defaultConfig,
        sessionId: 'my-session',
        processSpawner: mockSpawner,
      });
      // sessionId is null until start() is called (it copies _configuredSessionId on start)
      expect((agent as any)._configuredSessionId).toBe('my-session');
    });

    it('defaults isNewSession to true', () => {
      agent = new OpencodeAgent({ ...defaultConfig, processSpawner: mockSpawner });
      expect((agent as any)._isNewSession).toBe(true);
    });

    it('uses isNewSession from config', () => {
      agent = new OpencodeAgent({ ...defaultConfig, isNewSession: false, processSpawner: mockSpawner });
      expect((agent as any)._isNewSession).toBe(false);
    });

    it('stores model from config', () => {
      agent = new OpencodeAgent({ ...defaultConfig, model: 'claude-3-5-sonnet', processSpawner: mockSpawner });
      expect((agent as any)._model).toBe('claude-3-5-sonnet');
    });
  });

  // ============================================================================
  // Getter properties
  // ============================================================================

  describe('getters', () => {
    beforeEach(() => {
      agent = new OpencodeAgent({ ...defaultConfig, processSpawner: mockSpawner });
    });

    it('isWaitingForInput is false when stopped', () => {
      expect(agent.isWaitingForInput).toBe(false);
    });

    it('isWaitingForInput is true when running and not processing', () => {
      agent.start('hello');
      // After start the first message is being processed, so isProcessing=true
      expect(agent.isWaitingForInput).toBe(false);

      // Simulate exit so isProcessing resets and queue is empty => emitWaiting(true)
      triggerProcessEvent(mockProcess, 'exit', 0);

      expect(agent.status).toBe('running');
      expect(agent.isWaitingForInput).toBe(true);
    });

    it('waitingVersion increments on each emitWaiting call', () => {
      agent.start('hello');
      const versionAfterStart = agent.waitingVersion;

      triggerProcessEvent(mockProcess, 'exit', 0);

      expect(agent.waitingVersion).toBeGreaterThan(versionAfterStart);
    });

    it('contextUsage always returns null', () => {
      agent.start('hello');
      expect(agent.contextUsage).toBeNull();
    });

    it('permissionMode always returns null', () => {
      expect(agent.permissionMode).toBeNull();
    });
  });

  // ============================================================================
  // start()
  // ============================================================================

  describe('start()', () => {
    beforeEach(() => {
      agent = new OpencodeAgent({ ...defaultConfig, processSpawner: mockSpawner });
    });

    it('sets status to running', () => {
      const statusListener = jest.fn();
      agent.on('status', statusListener);

      agent.start('do something');

      expect(agent.status).toBe('running');
      expect(statusListener).toHaveBeenCalledWith('running');
    });

    it('emits a system message on start', () => {
      const messageListener = jest.fn();
      agent.on('message', messageListener);

      agent.start('do something');

      expect(messageListener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'system', content: 'Starting opencode agent' })
      );
    });

    it('calls the process spawner with opencode command', () => {
      agent.start('do something');
      expect(mockSpawner.spawn).toHaveBeenCalledWith(
        'opencode',
        expect.any(Array),
        expect.objectContaining({ cwd: '/test/path', shell: false })
      );
    });

    it('throws when called while already processing', () => {
      agent.start('first');
      expect(() => agent.start('second')).toThrow('Agent is already running');
    });

    it('sets sessionId from configuredSessionId on start', () => {
      agent = new OpencodeAgent({
        ...defaultConfig,
        sessionId: 'sess-123',
        processSpawner: mockSpawner,
      });

      agent.start('go');

      expect(agent.sessionId).toBe('sess-123');
    });

    it('resets state before starting (clears collectedOutput)', () => {
      // Manually corrupt state to verify reset
      (agent as any)._collectedOutput = 'old output';

      agent.start('fresh start');

      expect(agent.collectedOutput).toBe('');
    });

    it('sets lastCommand after spawning', () => {
      agent.start('my prompt');

      expect(agent.lastCommand).toMatch(/^opencode run/);
    });
  });

  // ============================================================================
  // stop()
  // ============================================================================

  describe('stop()', () => {
    beforeEach(() => {
      agent = new OpencodeAgent({ ...defaultConfig, processSpawner: mockSpawner });
    });

    it('is a no-op when already stopped', async () => {
      await expect(agent.stop()).resolves.toBeUndefined();
      expect(agent.status).toBe('stopped');
    });

    it('sets status to stopped when running', async () => {
      agent.start('work');

      // Simulate exit so processManager.isRunning() returns false (cleanup nulls process)
      triggerProcessEvent(mockProcess, 'exit', 0);

      await agent.stop();

      expect(agent.status).toBe('stopped');
    });

    it('emits status stopped event', async () => {
      agent.start('work');

      triggerProcessEvent(mockProcess, 'exit', 0);

      const statusListener = jest.fn();
      agent.on('status', statusListener);

      await agent.stop();

      expect(statusListener).toHaveBeenCalledWith('stopped');
    });

    it('clears queued messages on stop', async () => {
      agent.start('work');

      // Queue a message without triggering processNextInput (process is already processing)
      (agent as any).inputQueue.push('queued task');

      await agent.stop();

      expect(agent.queuedMessageCount).toBe(0);
    });
  });

  // ============================================================================
  // sendInput()
  // ============================================================================

  describe('sendInput()', () => {
    beforeEach(() => {
      agent = new OpencodeAgent({ ...defaultConfig, processSpawner: mockSpawner });
    });

    it('throws when agent is stopped', () => {
      expect(() => agent.sendInput('hello')).toThrow('Agent is not running');
    });

    it('adds message to queue when processing is active', () => {
      agent.start('initial task'); // starts processing, isProcessing=true

      agent.sendInput('follow-up task');

      // The input gets shifted for immediate processing OR stays in queue
      // Since isProcessing is true, processNextInput will not run; message stays queued
      expect(agent.queuedMessageCount).toBe(1);
      expect(agent.queuedMessages).toEqual(['follow-up task']);
    });

    it('processes input immediately when not processing', () => {
      agent.start('initial task');

      // Let first task complete
      triggerProcessEvent(mockProcess, 'exit', 0);

      // Now isProcessing=false, queue is empty, agent is waiting
      // Fresh mock process for the next spawn
      const secondProcess = createMockChildProcess(99999);
      mockSpawner.spawn.mockReturnValue(secondProcess as unknown as ChildProcess);

      agent.sendInput('second task');

      // The input was immediately dequeued and started a new process
      expect(agent.queuedMessageCount).toBe(0);
      expect(mockSpawner.spawn).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================================
  // sendToolResult()
  // ============================================================================

  describe('sendToolResult()', () => {
    it('logs a warning and does nothing else', () => {
      agent = new OpencodeAgent({ ...defaultConfig, processSpawner: mockSpawner });
      const messageListener = jest.fn();
      agent.on('message', messageListener);

      agent.sendToolResult('tool-1', 'some content');

      expect(messageListener).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // removeQueuedMessage()
  // ============================================================================

  describe('removeQueuedMessage()', () => {
    beforeEach(() => {
      agent = new OpencodeAgent({ ...defaultConfig, processSpawner: mockSpawner });
      agent.start('first'); // starts processing so subsequent sendInput stays queued
      agent.sendInput('task-a');
      agent.sendInput('task-b');
      agent.sendInput('task-c');
    });

    it('removes message at valid index', () => {
      const result = agent.removeQueuedMessage(1);

      expect(result).toBe(true);
      expect(agent.queuedMessages).toEqual(['task-a', 'task-c']);
    });

    it('removes first item at index 0', () => {
      const result = agent.removeQueuedMessage(0);

      expect(result).toBe(true);
      expect(agent.queuedMessages).toEqual(['task-b', 'task-c']);
    });

    it('returns false for negative index', () => {
      const result = agent.removeQueuedMessage(-1);

      expect(result).toBe(false);
      expect(agent.queuedMessageCount).toBe(3);
    });

    it('returns false for out-of-bounds index', () => {
      const result = agent.removeQueuedMessage(10);

      expect(result).toBe(false);
      expect(agent.queuedMessageCount).toBe(3);
    });

    it('returns false for index equal to queue length', () => {
      const result = agent.removeQueuedMessage(3);

      expect(result).toBe(false);
    });
  });

  // ============================================================================
  // on() / off()
  // ============================================================================

  describe('on() / off()', () => {
    beforeEach(() => {
      agent = new OpencodeAgent({ ...defaultConfig, processSpawner: mockSpawner });
    });

    it('registers and receives message events', () => {
      const listener = jest.fn();
      agent.on('message', listener);

      agent.start('go');

      expect(listener).toHaveBeenCalled();
    });

    it('deregisters listener with off()', () => {
      const listener = jest.fn();
      agent.on('message', listener);
      agent.off('message', listener);
      listener.mockClear();

      agent.start('go');

      expect(listener).not.toHaveBeenCalled();
    });

    it('registers and receives status events', () => {
      const listener = jest.fn();
      agent.on('status', listener);

      agent.start('go');

      expect(listener).toHaveBeenCalledWith('running');
    });

    it('registers and receives waitingForInput events', () => {
      const listener = jest.fn();
      agent.on('waitingForInput', listener);

      agent.start('go');
      triggerProcessEvent(mockProcess, 'exit', 0);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ isWaiting: true })
      );
    });
  });

  // ============================================================================
  // buildArgs() - tested via spawn call inspection
  // ============================================================================

  describe('buildArgs()', () => {
    function getSpawnArgs(): string[] {
      const call = mockSpawner.spawn.mock.calls[0];
      return call ? call[1] : [];
    }

    it('starts with "run" subcommand', () => {
      agent = new OpencodeAgent({ ...defaultConfig, processSpawner: mockSpawner });
      agent.start('my prompt');

      const args = getSpawnArgs();
      expect(args[0]).toBe('run');
    });

    it('appends message as last arg', () => {
      agent = new OpencodeAgent({ ...defaultConfig, processSpawner: mockSpawner });
      agent.start('my prompt');

      const args = getSpawnArgs();
      expect(args[args.length - 1]).toBe('my prompt');
    });

    it('includes --model flag when model is set', () => {
      agent = new OpencodeAgent({
        ...defaultConfig,
        model: 'claude-opus-4',
        processSpawner: mockSpawner,
      });
      agent.start('prompt');

      const args = getSpawnArgs();
      expect(args).toContain('--model');
      expect(args).toContain('claude-opus-4');
    });

    it('does not include --model flag when model is not set', () => {
      agent = new OpencodeAgent({ ...defaultConfig, processSpawner: mockSpawner });
      agent.start('prompt');

      const args = getSpawnArgs();
      expect(args).not.toContain('--model');
    });

    it('includes --session and no --continue for new session (isFirst=true, isNewSession=true)', () => {
      agent = new OpencodeAgent({
        ...defaultConfig,
        sessionId: 'sess-abc',
        isNewSession: true,
        processSpawner: mockSpawner,
      });
      agent.start('first prompt');

      const args = getSpawnArgs();
      expect(args).toContain('--session');
      expect(args).toContain('sess-abc');
      expect(args).not.toContain('--continue');
    });

    it('includes --session and --continue for existing session (isFirst=true, isNewSession=false)', () => {
      agent = new OpencodeAgent({
        ...defaultConfig,
        sessionId: 'sess-abc',
        isNewSession: false,
        processSpawner: mockSpawner,
      });
      agent.start('resume prompt');

      const args = getSpawnArgs();
      expect(args).toContain('--session');
      expect(args).toContain('sess-abc');
      expect(args).toContain('--continue');
    });

    it('includes --continue but no --session for subsequent messages without sessionId', () => {
      agent = new OpencodeAgent({ ...defaultConfig, processSpawner: mockSpawner });
      agent.start('first');

      // Simulate process exit so next queued message fires
      const secondProcess = createMockChildProcess(99999);
      mockSpawner.spawn.mockReturnValue(secondProcess as unknown as ChildProcess);

      triggerProcessEvent(mockProcess, 'exit', 0);

      agent.sendInput('second prompt');

      // The second spawn call uses isFirst=false
      const secondArgs = mockSpawner.spawn.mock.calls[1]?.[1] ?? [];
      expect(secondArgs).toContain('--continue');
      expect(secondArgs).not.toContain('--session');
    });

    it('includes no session flags when no sessionId and isFirst=true', () => {
      agent = new OpencodeAgent({ ...defaultConfig, processSpawner: mockSpawner });
      agent.start('first prompt');

      const args = getSpawnArgs();
      expect(args).not.toContain('--session');
      expect(args).not.toContain('--continue');
    });
  });

  // ============================================================================
  // Process stream handling
  // ============================================================================

  describe('process stream handling', () => {
    beforeEach(() => {
      agent = new OpencodeAgent({ ...defaultConfig, processSpawner: mockSpawner });
    });

    it('emits stdout message when process stdout emits data', () => {
      const messageListener = jest.fn();
      agent.on('message', messageListener);

      agent.start('task');
      messageListener.mockClear();

      mockProcess.stdout.emit('data', Buffer.from('hello output'));

      expect(messageListener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'stdout', content: 'hello output' })
      );
    });

    it('accumulates collectedOutput from stdout', () => {
      agent.start('task');

      mockProcess.stdout.emit('data', Buffer.from('chunk 1 '));
      mockProcess.stdout.emit('data', Buffer.from('chunk 2'));

      expect(agent.collectedOutput).toBe('chunk 1 chunk 2');
    });

    it('emits stderr message when process stderr emits data', () => {
      const messageListener = jest.fn();
      agent.on('message', messageListener);

      agent.start('task');
      messageListener.mockClear();

      mockProcess.stderr.emit('data', Buffer.from('error output'));

      expect(messageListener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'stderr', content: 'error output' })
      );
    });

    it('emits system message on non-zero exit code', () => {
      const messageListener = jest.fn();
      agent.on('message', messageListener);

      agent.start('task');
      messageListener.mockClear();

      triggerProcessEvent(mockProcess, 'exit', 1);

      expect(messageListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'system',
          content: 'opencode exited with code 1',
        })
      );
    });

    it('does not emit system message on exit code 0', () => {
      const messageListener = jest.fn();
      agent.on('message', messageListener);

      agent.start('task');
      messageListener.mockClear();

      triggerProcessEvent(mockProcess, 'exit', 0);

      const systemMessages = messageListener.mock.calls.filter(
        (c) => c[0]?.type === 'system'
      );
      expect(systemMessages).toHaveLength(0);
    });

    it('does not emit system message on null exit code', () => {
      const messageListener = jest.fn();
      agent.on('message', messageListener);

      agent.start('task');
      messageListener.mockClear();

      triggerProcessEvent(mockProcess, 'exit', null);

      const systemMessages = messageListener.mock.calls.filter(
        (c) => c[0]?.type === 'system'
      );
      expect(systemMessages).toHaveLength(0);
    });

    it('sets status to error on process error event', () => {
      const statusListener = jest.fn();
      agent.on('status', statusListener);

      agent.start('task');
      statusListener.mockClear();

      triggerProcessEvent(mockProcess, 'error', new Error('spawn failed'));

      expect(agent.status).toBe('error');
      expect(statusListener).toHaveBeenCalledWith('error');
    });

    it('resets isProcessing on process error', () => {
      agent.start('task');

      triggerProcessEvent(mockProcess, 'error', new Error('oops'));

      expect((agent as any).isProcessing).toBe(false);
    });

    it('resets processManager to null on process exit', () => {
      agent.start('task');
      expect(agent.processInfo).not.toBeNull();

      triggerProcessEvent(mockProcess, 'exit', 0);

      expect(agent.processInfo).toBeNull();
    });
  });

  // ============================================================================
  // Queue processing after process exit
  // ============================================================================

  describe('queue processing after exit', () => {
    it('emits waitingForInput when queue is empty after exit', () => {
      agent = new OpencodeAgent({ ...defaultConfig, processSpawner: mockSpawner });
      const waitingListener = jest.fn();
      agent.on('waitingForInput', waitingListener);

      agent.start('task');
      waitingListener.mockClear();

      triggerProcessEvent(mockProcess, 'exit', 0);

      expect(waitingListener).toHaveBeenCalledWith(
        expect.objectContaining({ isWaiting: true })
      );
    });

    it('processes next queued message after exit', () => {
      agent = new OpencodeAgent({ ...defaultConfig, processSpawner: mockSpawner });

      agent.start('first');
      agent.sendInput('second');

      expect(agent.queuedMessageCount).toBe(1);

      const secondProcess = createMockChildProcess(99999);
      mockSpawner.spawn.mockReturnValue(secondProcess as unknown as ChildProcess);

      triggerProcessEvent(mockProcess, 'exit', 0);

      // Queue drained — second message is now being processed
      expect(agent.queuedMessageCount).toBe(0);
      expect(mockSpawner.spawn).toHaveBeenCalledTimes(2);
    });

    it('processes multiple queued messages sequentially', () => {
      agent = new OpencodeAgent({ ...defaultConfig, processSpawner: mockSpawner });

      agent.start('first');
      agent.sendInput('second');
      agent.sendInput('third');

      expect(agent.queuedMessageCount).toBe(2);

      // Set up mock for second spawn
      const secondProcess = createMockChildProcess(22222);
      mockSpawner.spawn.mockReturnValue(secondProcess as unknown as ChildProcess);

      // First process exits -> triggers second message
      triggerProcessEvent(mockProcess, 'exit', 0);

      expect(agent.queuedMessageCount).toBe(1);
      expect(mockSpawner.spawn).toHaveBeenCalledTimes(2);

      // Set up mock for third spawn
      const thirdProcess = createMockChildProcess(33333);
      mockSpawner.spawn.mockReturnValue(thirdProcess as unknown as ChildProcess);

      // Second process exits -> triggers third message
      triggerProcessEvent(secondProcess, 'exit', 0);

      expect(agent.queuedMessageCount).toBe(0);
      expect(mockSpawner.spawn).toHaveBeenCalledTimes(3);
    });

    it('does not process queue if status changes to non-running before exit', async () => {
      agent = new OpencodeAgent({ ...defaultConfig, processSpawner: mockSpawner });

      agent.start('first');
      agent.sendInput('second');

      // Stop the agent before the exit fires
      await agent.stop();

      // Now simulate the exit from the (already-stopped) process
      triggerProcessEvent(mockProcess, 'exit', 0);

      // Queue was cleared by stop(); and the exit guard (_status !== 'running') fires
      expect(agent.queuedMessageCount).toBe(0);
      // spawn was only called once (for the first message)
      expect(mockSpawner.spawn).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================================
  // Spawn failure
  // ============================================================================

  describe('spawn failure', () => {
    it('sets status to error when spawner throws', () => {
      const erroringSpawner = {
        spawn: jest.fn().mockImplementation(() => {
          throw new Error('spawn ENOENT');
        }),
      };

      agent = new OpencodeAgent({
        ...defaultConfig,
        processSpawner: erroringSpawner,
      });

      const statusListener = jest.fn();
      agent.on('status', statusListener);

      agent.start('task');

      expect(agent.status).toBe('error');
      expect(statusListener).toHaveBeenCalledWith('error');
    });

    it('emits stderr message when spawner throws', () => {
      const erroringSpawner = {
        spawn: jest.fn().mockImplementation(() => {
          throw new Error('spawn ENOENT');
        }),
      };

      agent = new OpencodeAgent({
        ...defaultConfig,
        processSpawner: erroringSpawner,
      });

      const messageListener = jest.fn();
      agent.on('message', messageListener);

      agent.start('task');

      expect(messageListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'stderr',
          content: expect.stringContaining('spawn ENOENT'),
        })
      );
    });
  });
});
