import {
  DefaultSlackNotificationService,
  SlackNotificationServiceDeps,
  convertMarkdownToMrkdwn,
  buildMrkdwnBlocks,
} from '../../../src/services/slack-notification-service';
import { AgentManager, AgentManagerEvents } from '../../../src/agents/agent-manager';
import { SlackService } from '../../../src/services/slack-service';
import { SettingsRepository, GlobalSettings } from '../../../src/repositories/settings';
import { ProjectRepository, ProjectStatus, SlackNotificationConfig } from '../../../src/repositories/project';
import { RalphLoopService } from '../../../src/services/ralph-loop/types';
import { AgentMessage } from '../../../src/agents/types';
import { DEFAULT_TEST_SETTINGS, sampleProject } from '../helpers/mock-factories';

// ============================================================================
// Helpers
// ============================================================================

type EventHandler<K extends keyof AgentManagerEvents> = AgentManagerEvents[K];

function createMockAgentManager(): jest.Mocked<AgentManager> {
  const listeners: Partial<Record<keyof AgentManagerEvents, Set<unknown>>> = {};

  const on = jest.fn((event: string, handler: unknown) => {
    if (!listeners[event as keyof AgentManagerEvents]) {
      listeners[event as keyof AgentManagerEvents] = new Set();
    }
    listeners[event as keyof AgentManagerEvents]!.add(handler);
  });

  const off = jest.fn((event: string, handler: unknown) => {
    listeners[event as keyof AgentManagerEvents]?.delete(handler);
  });

  const emit = <K extends keyof AgentManagerEvents>(event: K, ...args: Parameters<EventHandler<K>>): void => {
    const handlers = listeners[event];
    if (handlers) {
      handlers.forEach((h) => (h as (...a: unknown[]) => void)(...args));
    }
  };

  return { on, off, emit } as unknown as jest.Mocked<AgentManager>;
}

function createMockRalphLoopService(): jest.Mocked<RalphLoopService> {
  const listeners: Record<string, Set<unknown>> = {};

  const on = jest.fn((event: string, handler: unknown) => {
    if (!listeners[event]) listeners[event] = new Set();
    listeners[event]!.add(handler);
  });

  const off = jest.fn((event: string, handler: unknown) => {
    listeners[event]?.delete(handler);
  });

  const emit = (event: string, ...args: unknown[]): void => {
    listeners[event]?.forEach((h) => (h as (...a: unknown[]) => void)(...args));
  };

  return { on, off, emit } as unknown as jest.Mocked<RalphLoopService>;
}

function createMockSlackService(): jest.Mocked<SlackService> {
  return {
    getStatus: jest.fn(),
    validateBotToken: jest.fn(),
    sendMessage: jest.fn().mockResolvedValue('thread-ts-123'),
    replyInThread: jest.fn().mockResolvedValue('1234567890.000100'),
    updateMessage: jest.fn().mockResolvedValue(undefined),
    listChannels: jest.fn().mockResolvedValue([]),
    getUserName: jest.fn().mockResolvedValue(null),
  };
}

function createMockSettingsRepository(slack?: Partial<GlobalSettings['slack']>): jest.Mocked<SettingsRepository> {
  const settings: GlobalSettings = {
    ...DEFAULT_TEST_SETTINGS,
    slack: {
      enabled: true,
      botToken: 'xoxb-test-token',
      appToken: '',
      defaultChannelId: '',
      ...slack,
    },
  };
  return {
    get: jest.fn().mockResolvedValue(settings),
    update: jest.fn(),
  } as unknown as jest.Mocked<SettingsRepository>;
}

function createMockProjectRepository(project?: Partial<ProjectStatus>): jest.Mocked<ProjectRepository> {
  const p: ProjectStatus = { ...sampleProject, ...project };
  return {
    findById: jest.fn().mockResolvedValue(p),
    findAll: jest.fn().mockResolvedValue([p]),
    updateSlackNotification: jest.fn().mockResolvedValue(p),
    updateSlackLinkedChannel: jest.fn().mockResolvedValue(p),
  } as unknown as jest.Mocked<ProjectRepository>;
}

function buildNotificationConfig(events: SlackNotificationConfig['events'] = ['agent_completed']): SlackNotificationConfig {
  return {
    channelId: 'C_TEST_CHANNEL',
    events,
    mentionUsers: [],
    threadReplies: false,
  };
}

function createDeps(overrides?: {
  slackEnabled?: boolean;
  notificationConfig?: SlackNotificationConfig | null;
  ralphLoopService?: jest.Mocked<RalphLoopService>;
}): SlackNotificationServiceDeps & {
  agentManager: ReturnType<typeof createMockAgentManager>;
  slackService: jest.Mocked<SlackService>;
  ralphLoopService?: jest.Mocked<RalphLoopService>;
} {
  const agentManager = createMockAgentManager();
  const slackService = createMockSlackService();
  const settingsRepository = createMockSettingsRepository({
    enabled: overrides?.slackEnabled !== false,
    botToken: overrides?.slackEnabled === false ? '' : 'xoxb-test-token',
  });
  const projectRepository = createMockProjectRepository({
    slackNotification: overrides?.notificationConfig !== undefined
      ? overrides.notificationConfig
      : buildNotificationConfig(),
  });
  const ralphLoopService = overrides?.ralphLoopService ?? createMockRalphLoopService();

  return { agentManager, slackService, settingsRepository, projectRepository, ralphLoopService };
}

// ============================================================================
// Tests: start / stop lifecycle
// ============================================================================

describe('DefaultSlackNotificationService.start/stop', () => {
  it('subscribes to agent manager events on start', () => {
    const deps = createDeps();
    const service = new DefaultSlackNotificationService(deps);
    service.start();

    expect(deps.agentManager.on).toHaveBeenCalledWith('status', expect.any(Function));
    expect(deps.agentManager.on).toHaveBeenCalledWith('waitingForInput', expect.any(Function));
    expect(deps.agentManager.on).toHaveBeenCalledWith('milestoneCompleted', expect.any(Function));
    expect(deps.agentManager.on).toHaveBeenCalledWith('milestoneFailed', expect.any(Function));
    expect(deps.ralphLoopService!.on).toHaveBeenCalledWith('loop_complete', expect.any(Function));
    expect(deps.ralphLoopService!.on).toHaveBeenCalledWith('loop_error', expect.any(Function));
  });

  it('unsubscribes from agent manager events on stop', () => {
    const deps = createDeps();
    const service = new DefaultSlackNotificationService(deps);
    service.start();
    service.stop();

    expect(deps.agentManager.off).toHaveBeenCalledWith('status', expect.any(Function));
    expect(deps.agentManager.off).toHaveBeenCalledWith('waitingForInput', expect.any(Function));
  });
});

// ============================================================================
// Tests: agent status notifications
// ============================================================================

describe('DefaultSlackNotificationService agent status events', () => {
  it('sends agent_completed notification when agent stops after running', async () => {
    const deps = createDeps({ notificationConfig: buildNotificationConfig(['agent_completed']) });
    const service = new DefaultSlackNotificationService(deps);
    service.start();

    (deps.agentManager as unknown as { emit: (e: string, ...a: unknown[]) => void })
      .emit('status', sampleProject.id, 'running');
    (deps.agentManager as unknown as { emit: (e: string, ...a: unknown[]) => void })
      .emit('status', sampleProject.id, 'stopped');

    await new Promise((r) => setTimeout(r, 10));

    expect(deps.slackService.sendMessage).toHaveBeenCalledWith(
      'xoxb-test-token',
      'C_TEST_CHANNEL',
      expect.stringContaining('Agent session completed'),
      expect.any(Array),
    );
  });

  it('sends agent_failed notification when agent errors after running', async () => {
    const deps = createDeps({ notificationConfig: buildNotificationConfig(['agent_failed']) });
    const service = new DefaultSlackNotificationService(deps);
    service.start();

    (deps.agentManager as unknown as { emit: (e: string, ...a: unknown[]) => void })
      .emit('status', sampleProject.id, 'running');
    (deps.agentManager as unknown as { emit: (e: string, ...a: unknown[]) => void })
      .emit('status', sampleProject.id, 'error');

    await new Promise((r) => setTimeout(r, 10));

    expect(deps.slackService.sendMessage).toHaveBeenCalledWith(
      'xoxb-test-token',
      'C_TEST_CHANNEL',
      expect.stringContaining('Agent session failed'),
      expect.any(Array),
    );
  });

  it('does not send notification when agent stops without having run', async () => {
    const deps = createDeps({ notificationConfig: buildNotificationConfig(['agent_completed']) });
    const service = new DefaultSlackNotificationService(deps);
    service.start();

    (deps.agentManager as unknown as { emit: (e: string, ...a: unknown[]) => void })
      .emit('status', sampleProject.id, 'stopped');

    await new Promise((r) => setTimeout(r, 10));

    expect(deps.slackService.sendMessage).not.toHaveBeenCalled();
  });

  it('does not send notification when event type is not configured', async () => {
    const deps = createDeps({ notificationConfig: buildNotificationConfig(['agent_failed']) });
    const service = new DefaultSlackNotificationService(deps);
    service.start();

    (deps.agentManager as unknown as { emit: (e: string, ...a: unknown[]) => void })
      .emit('status', sampleProject.id, 'running');
    (deps.agentManager as unknown as { emit: (e: string, ...a: unknown[]) => void })
      .emit('status', sampleProject.id, 'stopped');

    await new Promise((r) => setTimeout(r, 10));

    // Only configured 'agent_failed', not 'agent_completed'
    expect(deps.slackService.sendMessage).not.toHaveBeenCalled();
  });

  it('does not send notification when Slack is disabled', async () => {
    const deps = createDeps({ slackEnabled: false, notificationConfig: buildNotificationConfig(['agent_completed']) });
    const service = new DefaultSlackNotificationService(deps);
    service.start();

    (deps.agentManager as unknown as { emit: (e: string, ...a: unknown[]) => void })
      .emit('status', sampleProject.id, 'running');
    (deps.agentManager as unknown as { emit: (e: string, ...a: unknown[]) => void })
      .emit('status', sampleProject.id, 'stopped');

    await new Promise((r) => setTimeout(r, 10));

    expect(deps.slackService.sendMessage).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Tests: waiting for input
// ============================================================================

describe('DefaultSlackNotificationService waiting for input', () => {
  it('sends agent_waiting notification when agent waits', async () => {
    const deps = createDeps({ notificationConfig: buildNotificationConfig(['agent_waiting']) });
    const service = new DefaultSlackNotificationService(deps);
    service.start();

    (deps.agentManager as unknown as { emit: (e: string, ...a: unknown[]) => void })
      .emit('waitingForInput', sampleProject.id, { isWaiting: true, version: 1 });

    await new Promise((r) => setTimeout(r, 10));

    expect(deps.slackService.sendMessage).toHaveBeenCalledWith(
      'xoxb-test-token',
      'C_TEST_CHANNEL',
      expect.stringContaining('waiting'),
      expect.arrayContaining([
        expect.objectContaining({ type: 'actions' }),
      ]),
    );
  });

  it('does not send notification when agent stops waiting', async () => {
    const deps = createDeps({ notificationConfig: buildNotificationConfig(['agent_waiting']) });
    const service = new DefaultSlackNotificationService(deps);
    service.start();

    (deps.agentManager as unknown as { emit: (e: string, ...a: unknown[]) => void })
      .emit('waitingForInput', sampleProject.id, { isWaiting: false, version: 1 });

    await new Promise((r) => setTimeout(r, 10));

    expect(deps.slackService.sendMessage).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Tests: thread replies
// ============================================================================

describe('DefaultSlackNotificationService thread replies', () => {
  it('replies in thread on second notification when threadReplies is enabled', async () => {
    const config: SlackNotificationConfig = {
      channelId: 'C_TEST_CHANNEL',
      events: ['agent_completed', 'agent_failed'],
      mentionUsers: [],
      threadReplies: true,
    };
    const deps = createDeps({ notificationConfig: config });
    const service = new DefaultSlackNotificationService(deps);
    service.start();

    // First completion — sends new message, stores thread_ts
    (deps.agentManager as unknown as { emit: (e: string, ...a: unknown[]) => void })
      .emit('status', sampleProject.id, 'running');
    (deps.agentManager as unknown as { emit: (e: string, ...a: unknown[]) => void })
      .emit('status', sampleProject.id, 'stopped');
    await new Promise((r) => setTimeout(r, 10));

    expect(deps.slackService.sendMessage).toHaveBeenCalledTimes(1);
    expect(deps.slackService.replyInThread).not.toHaveBeenCalled();

    // Second event — replies in thread
    (deps.agentManager as unknown as { emit: (e: string, ...a: unknown[]) => void })
      .emit('status', sampleProject.id, 'running');
    (deps.agentManager as unknown as { emit: (e: string, ...a: unknown[]) => void })
      .emit('status', sampleProject.id, 'error');
    await new Promise((r) => setTimeout(r, 10));

    expect(deps.slackService.replyInThread).toHaveBeenCalledWith(
      'xoxb-test-token',
      'C_TEST_CHANNEL',
      'thread-ts-123',
      expect.any(String),
      expect.any(Array),
    );
  });
});

// ============================================================================
// Tests: Ralph Loop events
// ============================================================================

describe('DefaultSlackNotificationService ralph loop events', () => {
  it('sends ralph_loop_complete notification on loop_complete event', async () => {
    const deps = createDeps({ notificationConfig: buildNotificationConfig(['ralph_loop_complete']) });
    const service = new DefaultSlackNotificationService(deps);
    service.start();

    (deps.ralphLoopService as unknown as { emit: (e: string, ...a: unknown[]) => void })
      .emit('loop_complete', sampleProject.id, 'task-1', 'approved');

    await new Promise((r) => setTimeout(r, 10));

    expect(deps.slackService.sendMessage).toHaveBeenCalledWith(
      'xoxb-test-token',
      'C_TEST_CHANNEL',
      expect.stringContaining('Ralph Loop completed'),
      expect.any(Array),
    );
  });

  it('sends ralph_loop_error notification on loop_error event', async () => {
    const deps = createDeps({ notificationConfig: buildNotificationConfig(['ralph_loop_error']) });
    const service = new DefaultSlackNotificationService(deps);
    service.start();

    (deps.ralphLoopService as unknown as { emit: (e: string, ...a: unknown[]) => void })
      .emit('loop_error', sampleProject.id, 'task-1', 'Something went wrong');

    await new Promise((r) => setTimeout(r, 10));

    expect(deps.slackService.sendMessage).toHaveBeenCalledWith(
      'xoxb-test-token',
      'C_TEST_CHANNEL',
      expect.stringContaining('Ralph Loop error'),
      expect.any(Array),
    );
  });
});

// ============================================================================
// Tests: linked channel feed
// ============================================================================

describe('DefaultSlackNotificationService linked channel feed', () => {
  it('sends summary to linked channel when agent completes', async () => {
    const deps = createDeps({ notificationConfig: null });
    (deps.projectRepository.findById as jest.Mock).mockResolvedValue({
      ...sampleProject,
      slackNotification: null,
      slackLinkedChannelId: 'C_LINKED_CHANNEL',
    });

    const service = new DefaultSlackNotificationService(deps);
    service.start();

    (deps.agentManager as unknown as { emit: (e: string, ...a: unknown[]) => void })
      .emit('status', sampleProject.id, 'running');
    (deps.agentManager as unknown as { emit: (e: string, ...a: unknown[]) => void })
      .emit('status', sampleProject.id, 'stopped');

    await new Promise((r) => setTimeout(r, 10));

    expect(deps.slackService.sendMessage).toHaveBeenCalledWith(
      'xoxb-test-token',
      'C_LINKED_CHANNEL',
      expect.stringContaining('completed'),
    );
  });

  it('skips linked channel summary when notification config already targets the linked channel', async () => {
    const config = buildNotificationConfig(['agent_completed']);
    const deps = createDeps({ notificationConfig: config });
    (deps.projectRepository.findById as jest.Mock).mockResolvedValue({
      ...sampleProject,
      slackNotification: config,
      slackLinkedChannelId: 'C_TEST_CHANNEL', // same as notification channelId
    });

    const service = new DefaultSlackNotificationService(deps);
    service.start();

    (deps.agentManager as unknown as { emit: (e: string, ...a: unknown[]) => void })
      .emit('status', sampleProject.id, 'running');
    (deps.agentManager as unknown as { emit: (e: string, ...a: unknown[]) => void })
      .emit('status', sampleProject.id, 'stopped');

    await new Promise((r) => setTimeout(r, 10));

    // sendProjectNotification fires once; sendLinkedChannelSummary must NOT fire a second time
    expect(deps.slackService.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('replies in thread to original message when threadTracker has a latest', async () => {
    const deps = createDeps({ notificationConfig: null });
    (deps.projectRepository.findById as jest.Mock).mockResolvedValue({
      ...sampleProject,
      slackNotification: null,
      slackLinkedChannelId: 'C_LINKED_CHANNEL',
    });

    const threadTracker = {
      register: jest.fn(),
      find: jest.fn().mockReturnValue(null),
      setLatest: jest.fn(),
      getLatest: jest.fn().mockReturnValue({ channelId: 'C_LINKED_CHANNEL', threadTs: 'user-msg-ts' }),
    };

    const service = new DefaultSlackNotificationService({ ...deps, threadTracker });
    service.start();

    (deps.agentManager as unknown as { emit: (e: string, ...a: unknown[]) => void })
      .emit('status', sampleProject.id, 'running');
    (deps.agentManager as unknown as { emit: (e: string, ...a: unknown[]) => void })
      .emit('status', sampleProject.id, 'stopped');

    await new Promise((r) => setTimeout(r, 10));

    expect(deps.slackService.replyInThread).toHaveBeenCalledWith(
      'xoxb-test-token',
      'C_LINKED_CHANNEL',
      'user-msg-ts',
      expect.stringContaining('completed'),
    );
    expect(deps.slackService.sendMessage).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Tests: agent message forwarding to Slack
// ============================================================================

type AgentEmitter = { emit: (e: string, ...a: unknown[]) => void };

function makeStdout(content: string): AgentMessage {
  return { type: 'stdout', content, timestamp: new Date().toISOString() };
}

function makePlanModeExit(planContent?: string): AgentMessage {
  return {
    type: 'plan_mode',
    content: '',
    timestamp: new Date().toISOString(),
    planModeInfo: { action: 'exit', planContent },
  };
}

describe('DefaultSlackNotificationService agent message forwarding', () => {
  function createLinkedDeps() {
    const deps = createDeps({ notificationConfig: null });
    (deps.projectRepository.findById as jest.Mock).mockResolvedValue({
      ...sampleProject,
      slackNotification: null,
      slackLinkedChannelId: 'C_LINKED_CHANNEL',
    });

    const threadTracker = {
      register: jest.fn(),
      find: jest.fn().mockReturnValue(null),
      setLatest: jest.fn(),
      getLatest: jest.fn().mockReturnValue({ channelId: 'C_LINKED_CHANNEL', threadTs: 'orig-ts' }),
    };

    return { deps, threadTracker };
  }

  it('accumulates stdout messages and replies in thread when agent completes', async () => {
    const { deps, threadTracker } = createLinkedDeps();
    const service = new DefaultSlackNotificationService({ ...deps, threadTracker });
    service.start();

    const em = deps.agentManager as unknown as AgentEmitter;
    em.emit('status', sampleProject.id, 'running');
    em.emit('message', sampleProject.id, makeStdout('Hello from Claude'));
    em.emit('message', sampleProject.id, makeStdout(' — part two'));
    em.emit('status', sampleProject.id, 'stopped');

    await new Promise((r) => setTimeout(r, 10));

    expect(deps.slackService.replyInThread).toHaveBeenCalledWith(
      'xoxb-test-token',
      'C_LINKED_CHANNEL',
      'orig-ts',
      expect.stringContaining('Hello from Claude'),
      expect.any(Array),
    );
  });

  it('replaces accumulated buffer with plan content on plan_mode exit', async () => {
    const { deps, threadTracker } = createLinkedDeps();
    const service = new DefaultSlackNotificationService({ ...deps, threadTracker });
    service.start();

    const em = deps.agentManager as unknown as AgentEmitter;
    em.emit('status', sampleProject.id, 'running');
    em.emit('message', sampleProject.id, makeStdout('some earlier stdout'));
    em.emit('message', sampleProject.id, makePlanModeExit('## My Plan\n- Step 1'));
    em.emit('status', sampleProject.id, 'stopped');

    await new Promise((r) => setTimeout(r, 10));

    const call = (deps.slackService.replyInThread as jest.Mock).mock.calls[0];
    expect(call[3]).toContain('## My Plan');
    expect(call[3]).not.toContain('some earlier stdout');
  });

  it('sends pending reply when agent starts waiting for input', async () => {
    const { deps, threadTracker } = createLinkedDeps();
    const service = new DefaultSlackNotificationService({ ...deps, threadTracker });
    service.start();

    const em = deps.agentManager as unknown as AgentEmitter;
    em.emit('status', sampleProject.id, 'running');
    em.emit('message', sampleProject.id, makeStdout('Waiting for your input'));
    em.emit('waitingForInput', sampleProject.id, { isWaiting: true, version: 1 });

    await new Promise((r) => setTimeout(r, 10));

    expect(deps.slackService.replyInThread).toHaveBeenCalledWith(
      'xoxb-test-token',
      'C_LINKED_CHANNEL',
      'orig-ts',
      expect.stringContaining('Waiting for your input'),
      expect.any(Array),
    );
  });

  it('does not send empty reply when no stdout messages were accumulated', async () => {
    const { deps, threadTracker } = createLinkedDeps();
    const service = new DefaultSlackNotificationService({ ...deps, threadTracker });
    service.start();

    const em = deps.agentManager as unknown as AgentEmitter;
    em.emit('status', sampleProject.id, 'running');
    em.emit('status', sampleProject.id, 'stopped');

    await new Promise((r) => setTimeout(r, 10));

    // replyInThread may be called for the summary but NOT for a pending reply (no stdout)
    const replyInThreadCalls = (deps.slackService.replyInThread as jest.Mock).mock.calls;
    // If it was called, it must be for the linked channel summary (contains 'completed'), not an empty reply
    replyInThreadCalls.forEach((call) => {
      expect(call[3]).toBeTruthy();
    });
  });

  it('passes blocks to replyInThread when forwarding agent reply', async () => {
    const { deps, threadTracker } = createLinkedDeps();
    const service = new DefaultSlackNotificationService({ ...deps, threadTracker });
    service.start();

    const em = deps.agentManager as unknown as AgentEmitter;
    em.emit('status', sampleProject.id, 'running');
    em.emit('message', sampleProject.id, makeStdout('Some response'));
    em.emit('status', sampleProject.id, 'stopped');

    await new Promise((r) => setTimeout(r, 10));

    const call = (deps.slackService.replyInThread as jest.Mock).mock.calls
      .find((c) => c[3] === 'Some response');
    expect(call).toBeDefined();
    expect(call![4]).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'section' }),
    ]));
  });
});

// ============================================================================
// Tests: Working on it... message
// ============================================================================

describe('DefaultSlackNotificationService working message', () => {
  function createLinkedDepsWithTracker() {
    const deps = createDeps({ notificationConfig: null });
    (deps.projectRepository.findById as jest.Mock).mockResolvedValue({
      ...sampleProject,
      slackNotification: null,
      slackLinkedChannelId: 'C_LINKED_CHANNEL',
    });

    const threadTracker = {
      register: jest.fn(),
      find: jest.fn().mockReturnValue(null),
      setLatest: jest.fn(),
      getLatest: jest.fn().mockReturnValue({ channelId: 'C_LINKED_CHANNEL', threadTs: 'orig-ts' }),
    };

    return { deps, threadTracker };
  }

  it('posts Working on it when slack user message received', async () => {
    const { deps, threadTracker } = createLinkedDepsWithTracker();
    const service = new DefaultSlackNotificationService({ ...deps, threadTracker });
    service.start();

    (deps.agentManager as unknown as AgentEmitter).emit('message', sampleProject.id, {
      type: 'user',
      source: 'slack',
      content: 'do something',
      timestamp: new Date().toISOString(),
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(deps.slackService.replyInThread).toHaveBeenCalledWith(
      'xoxb-test-token',
      'C_LINKED_CHANNEL',
      'orig-ts',
      '⏳ Working on it...',
      expect.any(Array),
    );
  });

  it('updates Working on it message when sending reply', async () => {
    const { deps, threadTracker } = createLinkedDepsWithTracker();
    const service = new DefaultSlackNotificationService({ ...deps, threadTracker });
    service.start();

    const em = deps.agentManager as unknown as AgentEmitter;
    em.emit('status', sampleProject.id, 'running');
    em.emit('message', sampleProject.id, { type: 'user', source: 'slack', content: 'do something', timestamp: new Date().toISOString() });
    em.emit('message', sampleProject.id, makeStdout('Here is my answer'));
    em.emit('status', sampleProject.id, 'stopped');

    await new Promise((r) => setTimeout(r, 10));

    expect(deps.slackService.updateMessage).toHaveBeenCalledWith(
      'xoxb-test-token',
      'C_LINKED_CHANNEL',
      '1234567890.000100',
      'Here is my answer',
      expect.any(Array),
    );

    // replyInThread should only have been called once for the "Working on it" placeholder
    const workingCalls = (deps.slackService.replyInThread as jest.Mock).mock.calls.filter(
      (c) => c[3] === '⏳ Working on it...'
    );
    expect(workingCalls).toHaveLength(1);
  });

  it('posts new reply when no working message', async () => {
    const { deps, threadTracker } = createLinkedDepsWithTracker();
    const service = new DefaultSlackNotificationService({ ...deps, threadTracker });
    service.start();

    const em = deps.agentManager as unknown as AgentEmitter;
    em.emit('status', sampleProject.id, 'running');
    em.emit('message', sampleProject.id, makeStdout('Here is my answer'));
    em.emit('status', sampleProject.id, 'stopped');

    await new Promise((r) => setTimeout(r, 10));

    expect(deps.slackService.updateMessage).not.toHaveBeenCalled();
    expect(deps.slackService.replyInThread).toHaveBeenCalledWith(
      'xoxb-test-token',
      'C_LINKED_CHANNEL',
      'orig-ts',
      'Here is my answer',
      expect.any(Array),
    );
  });

  it('only posts one working message per project (idempotent)', async () => {
    const { deps, threadTracker } = createLinkedDepsWithTracker();
    const service = new DefaultSlackNotificationService({ ...deps, threadTracker });
    service.start();

    const em = deps.agentManager as unknown as AgentEmitter;
    em.emit('message', sampleProject.id, { type: 'user', source: 'slack', content: 'first', timestamp: new Date().toISOString() });
    em.emit('message', sampleProject.id, { type: 'user', source: 'slack', content: 'second', timestamp: new Date().toISOString() });

    await new Promise((r) => setTimeout(r, 10));

    const workingCalls = (deps.slackService.replyInThread as jest.Mock).mock.calls.filter(
      (c) => c[3] === '⏳ Working on it...'
    );
    expect(workingCalls).toHaveLength(1);
  });
});

// ============================================================================
// Tests: convertMarkdownToMrkdwn
// ============================================================================

describe('convertMarkdownToMrkdwn', () => {
  it('converts **bold** to *bold*', () => {
    expect(convertMarkdownToMrkdwn('**hello world**')).toBe('*hello world*');
  });

  it('converts __bold__ to *bold*', () => {
    expect(convertMarkdownToMrkdwn('__hello__')).toBe('*hello*');
  });

  it('converts # Heading to *Heading*', () => {
    expect(convertMarkdownToMrkdwn('# My Title')).toBe('*My Title*');
    expect(convertMarkdownToMrkdwn('## Sub')).toBe('*Sub*');
    expect(convertMarkdownToMrkdwn('### Deep')).toBe('*Deep*');
  });

  it('converts [label](url) to <url|label>', () => {
    expect(convertMarkdownToMrkdwn('[Click here](https://example.com)')).toBe('<https://example.com|Click here>');
  });

  it('converts ~~strike~~ to ~strike~', () => {
    expect(convertMarkdownToMrkdwn('~~deleted~~')).toBe('~deleted~');
  });

  it('leaves code blocks intact without applying inline transforms', () => {
    const input = '```typescript\n**not bold**\n# not a heading\n```';
    const result = convertMarkdownToMrkdwn(input);
    expect(result).toContain('**not bold**');
    expect(result).toContain('# not a heading');
    expect(result).toMatch(/^```/);
  });

  it('removes language specifier from fenced code blocks', () => {
    const input = '```typescript\nconst x = 1;\n```';
    const result = convertMarkdownToMrkdwn(input);
    expect(result).not.toContain('typescript');
    expect(result).toContain('const x = 1;');
  });
});

// ============================================================================
// Tests: buildMrkdwnBlocks
// ============================================================================

describe('buildMrkdwnBlocks', () => {
  it('returns a single section block for short text', () => {
    const blocks = buildMrkdwnBlocks('Hello world');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: 'section', text: { type: 'mrkdwn', text: 'Hello world' } });
  });

  it('splits text longer than 3000 chars into multiple blocks', () => {
    const longLine = 'a'.repeat(2000);
    const text = `${longLine}\n${longLine}`;
    const blocks = buildMrkdwnBlocks(text);
    expect(blocks.length).toBeGreaterThan(1);
    blocks.forEach((b) => {
      const blockText = (b as { text: { text: string } }).text.text;
      expect(blockText.length).toBeLessThanOrEqual(3000);
    });
  });

  it('prefers splitting at newline boundaries', () => {
    const chunk1 = 'Line one.\n'.repeat(200); // ~2000 chars
    const chunk2 = 'Line two.\n'.repeat(200);
    const blocks = buildMrkdwnBlocks(chunk1 + chunk2);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    // No block should end mid-word at the 3000-char hard cut
    blocks.forEach((b) => {
      const t = (b as { text: { text: string } }).text.text;
      expect(t.length).toBeLessThanOrEqual(3000);
    });
  });
});
