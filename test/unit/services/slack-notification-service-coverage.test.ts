import {
  DefaultSlackNotificationService,
  SlackNotificationServiceDeps,
  createSlackNotificationService,
} from '../../../src/services/slack-notification-service';
import { AgentManagerEvents } from '../../../src/agents/agent-manager';
import { SlackService } from '../../../src/services/slack-service';
import { GlobalSettings } from '../../../src/repositories/settings';
import { ProjectStatus, SlackNotificationConfig, SlackNotificationEvent } from '../../../src/repositories/project';
import { DEFAULT_TEST_SETTINGS, sampleProject } from '../helpers/mock-factories';
import { SlackThreadTracker } from '../../../src/services/slack-thread-tracker';

// ============================================================================
// Helpers
// ============================================================================

function createMockAgentManager() {
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

  const emit = (event: string, ...args: unknown[]): void => {
    const handlers = listeners[event as keyof AgentManagerEvents];
    if (handlers) {
      handlers.forEach((h) => (h as (...a: unknown[]) => void)(...args));
    }
  };

  return { on, off, emit } as unknown as jest.Mocked<import('../../../src/agents').AgentManager> & { emit: (e: string, ...a: unknown[]) => void };
}

function createMockRalphLoopService() {
  const listeners: Record<string, Set<unknown>> = {};

  return {
    on: jest.fn((event: string, handler: unknown) => {
      if (!listeners[event]) listeners[event] = new Set();
      listeners[event]!.add(handler);
    }),
    off: jest.fn((event: string, handler: unknown) => {
      listeners[event]?.delete(handler);
    }),
    emit: (event: string, ...args: unknown[]): void => {
      listeners[event]?.forEach((h) => (h as (...a: unknown[]) => void)(...args));
    },
  } as unknown as jest.Mocked<import('../../../src/services/ralph-loop/types').RalphLoopService> & { emit: (e: string, ...a: unknown[]) => void };
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

function createMockSettingsRepo(slack?: Partial<GlobalSettings['slack']>) {
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
  } as unknown as jest.Mocked<import('../../../src/repositories/settings').SettingsRepository>;
}

function createMockProjectRepo(project?: Partial<ProjectStatus>) {
  const p: ProjectStatus = { ...sampleProject, ...project };
  return {
    findById: jest.fn().mockResolvedValue(p),
    findAll: jest.fn().mockResolvedValue([p]),
    updateSlackNotification: jest.fn().mockResolvedValue(p),
    updateSlackLinkedChannel: jest.fn().mockResolvedValue(p),
  } as unknown as jest.Mocked<import('../../../src/repositories/project').ProjectRepository>;
}

function buildConfig(events: SlackNotificationEvent[] = ['agent_completed']): SlackNotificationConfig {
  return {
    channelId: 'C_TEST',
    events,
    mentionUsers: [],
    threadReplies: false,
  };
}

function createMockThreadTracker(): jest.Mocked<SlackThreadTracker> {
  return {
    register: jest.fn(),
    find: jest.fn().mockReturnValue(null),
    setLatest: jest.fn(),
    getLatest: jest.fn().mockReturnValue(null),
    registerOneOff: jest.fn(),
    findOneOffId: jest.fn().mockReturnValue(null),
  } as unknown as jest.Mocked<SlackThreadTracker>;
}

function createDeps(overrides?: {
  slackEnabled?: boolean;
  notificationConfig?: SlackNotificationConfig | null;
  withRalphLoop?: boolean;
  threadTracker?: SlackThreadTracker;
  linkedChannelId?: string;
}): SlackNotificationServiceDeps & {
  agentManager: ReturnType<typeof createMockAgentManager>;
  slackService: jest.Mocked<SlackService>;
  ralphLoopService?: ReturnType<typeof createMockRalphLoopService>;
} {
  const agentManager = createMockAgentManager();
  const slackService = createMockSlackService();
  const settingsRepository = createMockSettingsRepo({
    enabled: overrides?.slackEnabled !== false,
    botToken: overrides?.slackEnabled === false ? '' : 'xoxb-test-token',
  });

  const projectRepo = createMockProjectRepo({
    slackNotification: overrides?.notificationConfig !== undefined
      ? overrides.notificationConfig
      : buildConfig(),
    slackLinkedChannelId: overrides?.linkedChannelId,
  });

  const ralphLoopService = overrides?.withRalphLoop !== false
    ? createMockRalphLoopService()
    : undefined;

  return {
    agentManager,
    slackService,
    settingsRepository,
    projectRepository: projectRepo,
    ralphLoopService,
    threadTracker: overrides?.threadTracker,
  };
}

// ============================================================================
// Tests: start/stop without ralphLoopService
// ============================================================================

describe('SlackNotificationService - start/stop without ralphLoopService', () => {
  it('should start without subscribing to ralph loop events', () => {
    const deps = createDeps({ withRalphLoop: false });
    const service = new DefaultSlackNotificationService(deps);
    service.start();

    expect(deps.agentManager.on).toHaveBeenCalledWith('status', expect.any(Function));
    expect(deps.agentManager.on).toHaveBeenCalledWith('waitingForInput', expect.any(Function));
  });

  it('should stop without unsubscribing from ralph loop events', () => {
    const deps = createDeps({ withRalphLoop: false });
    const service = new DefaultSlackNotificationService(deps);
    service.start();
    service.stop();

    expect(deps.agentManager.off).toHaveBeenCalledWith('status', expect.any(Function));
    expect(deps.agentManager.off).toHaveBeenCalledWith('waitingForInput', expect.any(Function));
  });
});

// ============================================================================
// Tests: createSlackNotificationService factory
// ============================================================================

describe('createSlackNotificationService', () => {
  it('should return a DefaultSlackNotificationService instance', () => {
    const deps = createDeps();
    const service = createSlackNotificationService(deps);
    expect(service).toBeDefined();
    expect(typeof service.start).toBe('function');
    expect(typeof service.stop).toBe('function');
  });
});

// ============================================================================
// Tests: sendLinkedChannelMilestone
// ============================================================================

describe('SlackNotificationService - linked channel milestone', () => {
  it('should send milestone update to linked channel', async () => {
    const threadTracker = createMockThreadTracker();
    threadTracker.getLatest.mockReturnValue({ channelId: 'C_LINKED', threadTs: 'ts-linked' });

    const deps = createDeps({
      notificationConfig: buildConfig(['milestone_completed']),
      threadTracker,
      linkedChannelId: 'C_LINKED',
    });

    const service = new DefaultSlackNotificationService(deps);
    service.start();

    deps.agentManager.emit('milestoneCompleted', sampleProject.id, { milestoneId: 'M1' }, 'All tasks done');

    await new Promise((r) => setTimeout(r, 20));

    // Should send project notification
    expect(deps.slackService.sendMessage).toHaveBeenCalled();

    // Should also send linked channel milestone via replyInThread
    expect(deps.slackService.replyInThread).toHaveBeenCalledWith(
      'xoxb-test-token',
      'C_LINKED',
      'ts-linked',
      expect.stringContaining('Milestone completed'),
    );
  });

  it('should not send milestone to linked channel when no linked channel', async () => {
    const threadTracker = createMockThreadTracker();
    const deps = createDeps({
      notificationConfig: buildConfig(['milestone_completed']),
      threadTracker,
    });

    const service = new DefaultSlackNotificationService(deps);
    service.start();

    deps.agentManager.emit('milestoneCompleted', sampleProject.id, { milestoneId: 'M1' }, 'Done');

    await new Promise((r) => setTimeout(r, 20));

    // Only project notification, no linked channel
    expect(deps.slackService.sendMessage).toHaveBeenCalledTimes(1);
    expect(deps.slackService.replyInThread).not.toHaveBeenCalled();
  });

  it('should not send milestone to linked channel when no thread tracker latest', async () => {
    const threadTracker = createMockThreadTracker();
    threadTracker.getLatest.mockReturnValue(null);

    const deps = createDeps({
      notificationConfig: buildConfig(['milestone_completed']),
      threadTracker,
      linkedChannelId: 'C_LINKED',
    });

    const service = new DefaultSlackNotificationService(deps);
    service.start();

    deps.agentManager.emit('milestoneCompleted', sampleProject.id, { milestoneId: 'M1' }, 'Done');

    await new Promise((r) => setTimeout(r, 20));

    expect(deps.slackService.sendMessage).toHaveBeenCalledTimes(1);
    expect(deps.slackService.replyInThread).not.toHaveBeenCalled();
  });

  it('should not send milestone when bot token is missing', async () => {
    const threadTracker = createMockThreadTracker();
    const deps = createDeps({
      slackEnabled: false,
      notificationConfig: buildConfig(['milestone_completed']),
      threadTracker,
      linkedChannelId: 'C_LINKED',
    });

    const service = new DefaultSlackNotificationService(deps);
    service.start();

    deps.agentManager.emit('milestoneCompleted', sampleProject.id, { milestoneId: 'M1' }, 'Done');

    await new Promise((r) => setTimeout(r, 20));

    expect(deps.slackService.sendMessage).not.toHaveBeenCalled();
    expect(deps.slackService.replyInThread).not.toHaveBeenCalled();
  });

  it('should handle error in sendLinkedChannelMilestone gracefully', async () => {
    const threadTracker = createMockThreadTracker();
    threadTracker.getLatest.mockReturnValue({ channelId: 'C_LINKED', threadTs: 'ts-linked' });

    const deps = createDeps({
      notificationConfig: buildConfig(['milestone_completed']),
      threadTracker,
      linkedChannelId: 'C_LINKED',
    });

    // Make replyInThread fail on second call (first is for project notification threading)
    let callCount = 0;
    deps.slackService.replyInThread.mockImplementation(async () => {
      callCount++;
      if (callCount >= 1) throw new Error('Slack API error');
      return 'ts-ok';
    });

    const service = new DefaultSlackNotificationService(deps);
    service.start();

    // Should not throw
    deps.agentManager.emit('milestoneCompleted', sampleProject.id, { milestoneId: 'M1' }, 'Done');
    await new Promise((r) => setTimeout(r, 20));
  });
});

// ============================================================================
// Tests: handleMilestoneFailed with null milestone
// ============================================================================

describe('SlackNotificationService - milestone failed', () => {
  it('should send notification for failed milestone with milestone ref', async () => {
    const deps = createDeps({ notificationConfig: buildConfig(['milestone_failed']) });
    const service = new DefaultSlackNotificationService(deps);
    service.start();

    deps.agentManager.emit('milestoneFailed', sampleProject.id, { milestoneId: 'M2' }, 'Task failed');

    await new Promise((r) => setTimeout(r, 20));

    expect(deps.slackService.sendMessage).toHaveBeenCalledWith(
      'xoxb-test-token',
      'C_TEST',
      expect.stringContaining('Milestone failed'),
      expect.any(Array),
    );
  });

  it('should send notification for failed milestone with null milestone ref', async () => {
    const deps = createDeps({ notificationConfig: buildConfig(['milestone_failed']) });
    const service = new DefaultSlackNotificationService(deps);
    service.start();

    deps.agentManager.emit('milestoneFailed', sampleProject.id, null, 'Generic failure');

    await new Promise((r) => setTimeout(r, 20));

    expect(deps.slackService.sendMessage).toHaveBeenCalledWith(
      'xoxb-test-token',
      'C_TEST',
      expect.stringContaining('Milestone failed'),
      expect.any(Array),
    );
  });
});

// ============================================================================
// Tests: sendWithThreading error handling
// ============================================================================

describe('SlackNotificationService - sendWithThreading error handling', () => {
  it('should catch and log sendMessage errors gracefully', async () => {
    const deps = createDeps({ notificationConfig: buildConfig(['agent_completed']) });
    deps.slackService.sendMessage.mockRejectedValue(new Error('Network error'));

    const service = new DefaultSlackNotificationService(deps);
    service.start();

    deps.agentManager.emit('status', sampleProject.id, 'running');
    deps.agentManager.emit('status', sampleProject.id, 'stopped');

    await new Promise((r) => setTimeout(r, 20));

    // Should not throw, error is caught internally
    expect(deps.slackService.sendMessage).toHaveBeenCalled();
  });

  it('should catch non-Error objects in sendWithThreading', async () => {
    const deps = createDeps({ notificationConfig: buildConfig(['agent_completed']) });
    deps.slackService.sendMessage.mockRejectedValue('string error');

    const service = new DefaultSlackNotificationService(deps);
    service.start();

    deps.agentManager.emit('status', sampleProject.id, 'running');
    deps.agentManager.emit('status', sampleProject.id, 'stopped');

    await new Promise((r) => setTimeout(r, 20));

    // Should not throw
    expect(deps.slackService.sendMessage).toHaveBeenCalled();
  });
});

// ============================================================================
// Tests: threadTracker.register
// ============================================================================

describe('SlackNotificationService - threadTracker.register', () => {
  it('should register thread with threadTracker on first message', async () => {
    const threadTracker = createMockThreadTracker();
    const deps = createDeps({
      notificationConfig: buildConfig(['agent_completed']),
      threadTracker,
    });

    const service = new DefaultSlackNotificationService(deps);
    service.start();

    deps.agentManager.emit('status', sampleProject.id, 'running');
    deps.agentManager.emit('status', sampleProject.id, 'stopped');

    await new Promise((r) => setTimeout(r, 20));

    expect(threadTracker.register).toHaveBeenCalledWith(sampleProject.id, 'C_TEST', 'thread-ts-123');
  });

  it('should not register when sendMessage returns null', async () => {
    const threadTracker = createMockThreadTracker();
    const deps = createDeps({
      notificationConfig: buildConfig(['agent_completed']),
      threadTracker,
    });
    deps.slackService.sendMessage.mockResolvedValue(null as unknown as string);

    const service = new DefaultSlackNotificationService(deps);
    service.start();

    deps.agentManager.emit('status', sampleProject.id, 'running');
    deps.agentManager.emit('status', sampleProject.id, 'stopped');

    await new Promise((r) => setTimeout(r, 20));

    expect(threadTracker.register).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Tests: mention users in notifications
// ============================================================================

describe('SlackNotificationService - mention users', () => {
  it('should include user mentions in notification blocks', async () => {
    const config: SlackNotificationConfig = {
      channelId: 'C_TEST',
      events: ['agent_completed'],
      mentionUsers: ['U123', 'U456'],
      threadReplies: false,
    };
    const deps = createDeps({ notificationConfig: config });

    const service = new DefaultSlackNotificationService(deps);
    service.start();

    deps.agentManager.emit('status', sampleProject.id, 'running');
    deps.agentManager.emit('status', sampleProject.id, 'stopped');

    await new Promise((r) => setTimeout(r, 20));

    const blocks = deps.slackService.sendMessage.mock.calls[0]?.[3] as object[];
    const sectionBlock = blocks?.find((b: any) => b.type === 'section') as any;
    expect(sectionBlock?.text?.text).toContain('<@U123>');
    expect(sectionBlock?.text?.text).toContain('<@U456>');
  });
});

// ============================================================================
// Tests: getBotToken error path
// ============================================================================

describe('SlackNotificationService - getBotToken error', () => {
  it('should return null when settings repository throws', async () => {
    const deps = createDeps({ notificationConfig: buildConfig(['agent_completed']) });
    (deps.settingsRepository.get as jest.Mock).mockRejectedValue(new Error('Settings error'));

    const service = new DefaultSlackNotificationService(deps);
    service.start();

    deps.agentManager.emit('status', sampleProject.id, 'running');
    deps.agentManager.emit('status', sampleProject.id, 'stopped');

    await new Promise((r) => setTimeout(r, 20));

    // Should not send anything when token retrieval fails
    expect(deps.slackService.sendMessage).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Tests: getProjectConfig error path
// ============================================================================

describe('SlackNotificationService - getProjectConfig error', () => {
  it('should return null when projectRepository throws', async () => {
    const deps = createDeps({ notificationConfig: buildConfig(['agent_completed']) });
    (deps.projectRepository.findById as jest.Mock).mockRejectedValue(new Error('DB error'));

    const service = new DefaultSlackNotificationService(deps);
    service.start();

    deps.agentManager.emit('status', sampleProject.id, 'running');
    deps.agentManager.emit('status', sampleProject.id, 'stopped');

    await new Promise((r) => setTimeout(r, 20));

    expect(deps.slackService.sendMessage).not.toHaveBeenCalled();
  });

  it('should return null when project is not found', async () => {
    const deps = createDeps({ notificationConfig: buildConfig(['agent_completed']) });
    (deps.projectRepository.findById as jest.Mock).mockResolvedValue(null);

    const service = new DefaultSlackNotificationService(deps);
    service.start();

    deps.agentManager.emit('status', sampleProject.id, 'running');
    deps.agentManager.emit('status', sampleProject.id, 'stopped');

    await new Promise((r) => setTimeout(r, 20));

    expect(deps.slackService.sendMessage).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Tests: sendLinkedChannelSummary error handling
// ============================================================================

describe('SlackNotificationService - sendLinkedChannelSummary error', () => {
  it('should handle error in sendLinkedChannelSummary gracefully', async () => {
    const threadTracker = createMockThreadTracker();
    threadTracker.getLatest.mockReturnValue({ channelId: 'C_LINKED', threadTs: 'ts-linked' });

    const deps = createDeps({
      notificationConfig: null,
      threadTracker,
      linkedChannelId: 'C_LINKED',
    });
    deps.slackService.replyInThread.mockRejectedValue(new Error('Linked channel error'));

    const service = new DefaultSlackNotificationService(deps);
    service.start();

    // Should not throw even though replyInThread fails
    deps.agentManager.emit('status', sampleProject.id, 'running');
    deps.agentManager.emit('status', sampleProject.id, 'stopped');

    await new Promise((r) => setTimeout(r, 20));
  });

  it('should skip linked channel when project has no linked channel id', async () => {
    const threadTracker = createMockThreadTracker();
    const deps = createDeps({
      notificationConfig: null,
      threadTracker,
      // No linkedChannelId
    });

    const service = new DefaultSlackNotificationService(deps);
    service.start();

    deps.agentManager.emit('status', sampleProject.id, 'running');
    deps.agentManager.emit('status', sampleProject.id, 'stopped');

    await new Promise((r) => setTimeout(r, 20));

    expect(deps.slackService.replyInThread).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Tests: duration detail with minutes
// ============================================================================

describe('SlackNotificationService - duration detail', () => {
  it('should include duration in notification when startTime is available', async () => {
    const deps = createDeps({ notificationConfig: buildConfig(['agent_completed']) });

    const service = new DefaultSlackNotificationService(deps);
    service.start();

    deps.agentManager.emit('status', sampleProject.id, 'running');

    // Wait a small amount so duration is calculable
    await new Promise((r) => setTimeout(r, 10));

    deps.agentManager.emit('status', sampleProject.id, 'stopped');

    await new Promise((r) => setTimeout(r, 20));

    expect(deps.slackService.sendMessage).toHaveBeenCalled();
  });
});

// ============================================================================
// Tests: threadReplies stores thread_ts
// ============================================================================

describe('SlackNotificationService - threadReplies stores ts', () => {
  it('should store thread_ts when threadReplies is enabled and sendMessage returns ts', async () => {
    const config: SlackNotificationConfig = {
      channelId: 'C_TEST',
      events: ['agent_completed', 'agent_waiting'],
      mentionUsers: [],
      threadReplies: true,
    };
    const deps = createDeps({ notificationConfig: config });

    const service = new DefaultSlackNotificationService(deps);
    service.start();

    // First event - sendMessage, thread_ts stored
    deps.agentManager.emit('status', sampleProject.id, 'running');
    deps.agentManager.emit('status', sampleProject.id, 'stopped');
    await new Promise((r) => setTimeout(r, 20));

    expect(deps.slackService.sendMessage).toHaveBeenCalledTimes(1);

    // Second event - should use replyInThread with stored thread_ts
    deps.agentManager.emit('waitingForInput', sampleProject.id, { isWaiting: true, version: 1 });
    await new Promise((r) => setTimeout(r, 20));

    expect(deps.slackService.replyInThread).toHaveBeenCalledWith(
      'xoxb-test-token',
      'C_TEST',
      'thread-ts-123',
      expect.any(String),
      expect.any(Array),
    );
  });

  it('should not store thread_ts when threadReplies is disabled', async () => {
    const config: SlackNotificationConfig = {
      channelId: 'C_TEST',
      events: ['agent_completed', 'agent_waiting'],
      mentionUsers: [],
      threadReplies: false,
    };
    const deps = createDeps({ notificationConfig: config });

    const service = new DefaultSlackNotificationService(deps);
    service.start();

    // First event
    deps.agentManager.emit('status', sampleProject.id, 'running');
    deps.agentManager.emit('status', sampleProject.id, 'stopped');
    await new Promise((r) => setTimeout(r, 20));

    // Second event - should send new message, not reply in thread
    deps.agentManager.emit('waitingForInput', sampleProject.id, { isWaiting: true, version: 1 });
    await new Promise((r) => setTimeout(r, 20));

    expect(deps.slackService.sendMessage).toHaveBeenCalledTimes(2);
    expect(deps.slackService.replyInThread).not.toHaveBeenCalled();
  });
});
