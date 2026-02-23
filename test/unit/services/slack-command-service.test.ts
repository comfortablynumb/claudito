import { DefaultSlackCommandService, SlackCommandServiceDeps } from '../../../src/services/slack-command-service';
import { SlackSocketService, SlashCommandBody, SlackMessageEvent } from '../../../src/services/slack-service';
import { SlackThreadTracker } from '../../../src/services/slack-thread-tracker';
import { ProjectStatus } from '../../../src/repositories/project';
import {
  createMockAgentManager,
  createMockProjectRepository,
  createMockSettingsRepository,
  createMockSlackService,
  sampleProject,
} from '../helpers/mock-factories';
import { AgentManager } from '../../../src/agents/agent-manager';
import { ProjectRepository } from '../../../src/repositories/project';
import { SettingsRepository } from '../../../src/repositories/settings';
import { SlackService } from '../../../src/services/slack-service';

// ============================================================================
// Helpers
// ============================================================================

function createMockSocketService(): jest.Mocked<SlackSocketService> {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockReturnValue(false),
    onSlashCommand: jest.fn(),
    onInteractiveAction: jest.fn(),
    onMessageEvent: jest.fn(),
  };
}

function createMockTracker(): jest.Mocked<SlackThreadTracker> {
  return {
    register: jest.fn(),
    find: jest.fn().mockReturnValue(null),
    setLatest: jest.fn(),
    getLatest: jest.fn().mockReturnValue(null),
  };
}

const ack = jest.fn().mockResolvedValue(undefined);

interface SetupOpts {
  linkedChannelId?: string;
  agentRunning?: boolean;
  trackerProjectId?: string | null;
}

interface TestSetup {
  deps: {
    agentManager: jest.Mocked<AgentManager>;
    slackService: jest.Mocked<SlackService>;
    socketService: jest.Mocked<SlackSocketService>;
    projectRepository: jest.Mocked<ProjectRepository>;
    settingsRepository: jest.Mocked<SettingsRepository>;
    threadTracker: jest.Mocked<SlackThreadTracker>;
  };
  getMessageHandler(): (event: SlackMessageEvent, ack: () => Promise<void>) => Promise<void>;
}

function createSetup(opts: SetupOpts = {}): TestSetup {
  const agentManager = createMockAgentManager();
  const slackService = createMockSlackService();
  slackService.sendMessage.mockResolvedValue('ts-bot-reply');

  const socketService = createMockSocketService();

  const project = { ...sampleProject, slackLinkedChannelId: opts.linkedChannelId };
  const projectRepository = createMockProjectRepository([project]);
  const settingsRepository = createMockSettingsRepository({
    slack: { enabled: true, botToken: 'xoxb-test', appToken: '', defaultChannelId: '' },
  });
  const threadTracker = createMockTracker();

  if (opts.agentRunning) {
    agentManager.isRunning.mockReturnValue(true);
  }

  if (opts.trackerProjectId !== undefined) {
    threadTracker.find.mockReturnValue(opts.trackerProjectId);
  }

  const deps: TestSetup['deps'] = {
    agentManager,
    slackService,
    socketService,
    projectRepository,
    settingsRepository,
    threadTracker,
  };

  function getMessageHandler() {
    const service = new DefaultSlackCommandService({
      agentManager,
      slackService,
      slackSocketService: socketService,
      projectRepository,
      settingsRepository,
      threadTracker,
    } as SlackCommandServiceDeps);
    service.register();
    return (socketService.onMessageEvent as jest.Mock).mock.calls[0][0] as
      (event: SlackMessageEvent, ack: () => Promise<void>) => Promise<void>;
  }

  return { deps, getMessageHandler };
}

// ============================================================================
// Tests: top-level messages
// ============================================================================

describe('SlackCommandService message events — top-level', () => {
  it('routes to running agent and registers thread', async () => {
    const { deps, getMessageHandler } = createSetup({ linkedChannelId: 'C_LINKED', agentRunning: true });
    const handler = getMessageHandler();

    await handler({ type: 'message', text: 'hello agent', channel: 'C_LINKED', ts: 'user-ts-1' }, ack);

    expect(deps.agentManager.sendInput).toHaveBeenCalledWith(
      sampleProject.id, 'hello agent', undefined, expect.objectContaining({ source: 'slack' }),
    );
    expect(deps.threadTracker.register).toHaveBeenCalledWith(sampleProject.id, 'C_LINKED', 'user-ts-1');
    expect(deps.threadTracker.setLatest).toHaveBeenCalledWith(sampleProject.id, 'C_LINKED', 'user-ts-1');
    expect(deps.slackService.sendMessage).not.toHaveBeenCalled();
  });

  it('starts agent when none is running and routes initial message', async () => {
    const { deps, getMessageHandler } = createSetup({ linkedChannelId: 'C_LINKED', agentRunning: false });
    const handler = getMessageHandler();

    await handler({ type: 'message', text: 'start doing stuff', channel: 'C_LINKED' }, ack);

    expect(deps.agentManager.startInteractiveAgent).toHaveBeenCalledWith(
      sampleProject.id,
      expect.objectContaining({ initialMessage: 'start doing stuff', slackMeta: expect.objectContaining({ source: 'slack' }) }),
    );
    expect(deps.slackService.sendMessage).not.toHaveBeenCalled();
  });

  it('ignores message in unlinked channel', async () => {
    const { deps, getMessageHandler } = createSetup({ linkedChannelId: 'C_OTHER' });
    const handler = getMessageHandler();

    await handler({ type: 'message', text: 'hello', channel: 'C_UNRELATED' }, ack);

    expect(deps.agentManager.sendInput).not.toHaveBeenCalled();
    expect(deps.agentManager.startInteractiveAgent).not.toHaveBeenCalled();
  });

  it('ignores bot messages (bot_id set)', async () => {
    const { deps, getMessageHandler } = createSetup({ linkedChannelId: 'C_LINKED' });
    const handler = getMessageHandler();

    await handler({ type: 'message', text: 'bot says hello', channel: 'C_LINKED', bot_id: 'B_BOT' }, ack);

    expect(deps.agentManager.sendInput).not.toHaveBeenCalled();
    expect(deps.agentManager.startInteractiveAgent).not.toHaveBeenCalled();
  });

  it('ignores messages with a subtype', async () => {
    const { deps, getMessageHandler } = createSetup({ linkedChannelId: 'C_LINKED' });
    const handler = getMessageHandler();

    await handler({ type: 'message', subtype: 'message_changed', text: 'edited', channel: 'C_LINKED' }, ack);

    expect(deps.agentManager.sendInput).not.toHaveBeenCalled();
    expect(deps.agentManager.startInteractiveAgent).not.toHaveBeenCalled();
  });

  it('ignores messages with empty text', async () => {
    const { deps, getMessageHandler } = createSetup({ linkedChannelId: 'C_LINKED' });
    const handler = getMessageHandler();

    await handler({ type: 'message', text: '   ', channel: 'C_LINKED' }, ack);

    expect(deps.agentManager.sendInput).not.toHaveBeenCalled();
    expect(deps.agentManager.startInteractiveAgent).not.toHaveBeenCalled();
  });

  it('ignores messages with no channel', async () => {
    const { deps, getMessageHandler } = createSetup({ linkedChannelId: 'C_LINKED' });
    const handler = getMessageHandler();

    await handler({ type: 'message', text: 'hello' }, ack);

    expect(deps.agentManager.sendInput).not.toHaveBeenCalled();
    expect(deps.agentManager.startInteractiveAgent).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Tests: thread replies
// ============================================================================

describe('SlackCommandService message events — thread replies', () => {
  it('routes thread reply to running agent', async () => {
    const { deps, getMessageHandler } = createSetup({
      agentRunning: true,
      trackerProjectId: sampleProject.id,
    });
    const handler = getMessageHandler();

    await handler({ type: 'message', text: 'follow up', channel: 'C_ANY', thread_ts: 'ts-tracked' }, ack);

    expect(deps.agentManager.sendInput).toHaveBeenCalledWith(sampleProject.id, 'follow up');
    expect(deps.threadTracker.find).toHaveBeenCalledWith('C_ANY', 'ts-tracked');
  });

  it('ignores thread reply for untracked thread', async () => {
    const { deps, getMessageHandler } = createSetup({ trackerProjectId: null });
    const handler = getMessageHandler();

    await handler({ type: 'message', text: 'reply', channel: 'C_ANY', thread_ts: 'ts-unknown' }, ack);

    expect(deps.agentManager.sendInput).not.toHaveBeenCalled();
    expect(deps.slackService.replyInThread).not.toHaveBeenCalled();
  });

  it('sends "no agent running" reply for tracked thread when agent is stopped', async () => {
    const { deps, getMessageHandler } = createSetup({
      agentRunning: false,
      trackerProjectId: sampleProject.id,
    });
    const handler = getMessageHandler();

    await handler({ type: 'message', text: 'hello?', channel: 'C_ANY', thread_ts: 'ts-tracked' }, ack);

    expect(deps.agentManager.sendInput).not.toHaveBeenCalled();
    expect(deps.slackService.replyInThread).toHaveBeenCalledWith(
      'xoxb-test',
      'C_ANY',
      'ts-tracked',
      expect.stringContaining('No agent is running'),
    );
  });
});

// ============================================================================
// Tests: /claudito status slash command
// ============================================================================

describe('SlackCommandService slash commands — status', () => {
  function createStatusSetup(projects: ProjectStatus[], runningIds: string[]) {
    const agentManager = createMockAgentManager();
    agentManager.getRunningProjectIds.mockReturnValue(runningIds);

    const slackService = createMockSlackService();
    const socketService = createMockSocketService();
    const projectRepository = createMockProjectRepository(projects);
    const settingsRepository = createMockSettingsRepository({
      slack: { enabled: true, botToken: 'xoxb-test', appToken: '', defaultChannelId: '' },
    });
    const threadTracker = createMockTracker();

    const service = new DefaultSlackCommandService({
      agentManager,
      slackService,
      slackSocketService: socketService,
      projectRepository,
      settingsRepository,
      threadTracker,
    } as SlackCommandServiceDeps);
    service.register();

    const handler = (socketService.onSlashCommand as jest.Mock).mock.calls[0][0] as
      (body: SlashCommandBody, ack: () => Promise<void>) => Promise<void>;

    return { slackService, handler };
  }

  const statusBody = (channelId: string): SlashCommandBody => ({
    command: '/claudito',
    text: 'status',
    user_id: 'U1',
    channel_id: channelId,
    response_url: '',
  });

  it('shows both sections when agents running and channels linked', async () => {
    const project = { ...sampleProject, slackLinkedChannelId: 'C_CURRENT' };
    const { slackService, handler } = createStatusSetup([project], [sampleProject.id]);

    await handler(statusBody('C_CURRENT'), ack);

    const reply = (slackService.sendMessage.mock.calls[0] as string[])[2];
    expect(reply).toContain('Running agents (1)');
    expect(reply).toContain(`*${sampleProject.name}*`);
    expect(reply).toContain('Linked channels (1)');
    expect(reply).toContain('this channel');
  });

  it('shows "No agents are currently running." when nothing is running', async () => {
    const project = { ...sampleProject, slackLinkedChannelId: 'C_CURRENT' };
    const { slackService, handler } = createStatusSetup([project], []);

    await handler(statusBody('C_CURRENT'), ack);

    const reply = (slackService.sendMessage.mock.calls[0] as string[])[2];
    expect(reply).toContain('No agents are currently running.');
    expect(reply).toContain('Linked channels (1)');
  });

  it('shows "No channels are linked." when no project has a linked channel', async () => {
    const project = { ...sampleProject };
    const { slackService, handler } = createStatusSetup([project], [sampleProject.id]);

    await handler(statusBody('C_CURRENT'), ack);

    const reply = (slackService.sendMessage.mock.calls[0] as string[])[2];
    expect(reply).toContain('Running agents (1)');
    expect(reply).toContain('No channels are linked.');
  });

  it('shows "this channel" for current channel and raw ID for others', async () => {
    const project1 = { ...sampleProject, id: 'id-1', name: 'Project One', slackLinkedChannelId: 'C_CURRENT' };
    const project2 = { ...sampleProject, id: 'id-2', name: 'Project Two', slackLinkedChannelId: 'C_OTHER' };
    const { slackService, handler } = createStatusSetup([project1, project2], []);

    await handler(statusBody('C_CURRENT'), ack);

    const reply = (slackService.sendMessage.mock.calls[0] as string[])[2];
    expect(reply).toContain('this channel');
    expect(reply).toContain('C_OTHER');
  });
});

// ============================================================================
// Tests: /claudito list slash command
// ============================================================================

describe('SlackCommandService slash commands — list', () => {
  function createStatusSetup(projects: ProjectStatus[], runningIds: string[]) {
    const agentManager = createMockAgentManager();
    agentManager.getRunningProjectIds.mockReturnValue(runningIds);

    const slackService = createMockSlackService();
    const socketService = createMockSocketService();
    const projectRepository = createMockProjectRepository(projects);
    const settingsRepository = createMockSettingsRepository({
      slack: { enabled: true, botToken: 'xoxb-test', appToken: '', defaultChannelId: '' },
    });
    const threadTracker = createMockTracker();

    const service = new DefaultSlackCommandService({
      agentManager,
      slackService,
      slackSocketService: socketService,
      projectRepository,
      settingsRepository,
      threadTracker,
    } as SlackCommandServiceDeps);
    service.register();

    const handler = (socketService.onSlashCommand as jest.Mock).mock.calls[0][0] as
      (body: SlashCommandBody, ack: () => Promise<void>) => Promise<void>;

    return { slackService, handler };
  }

  const listBody = (channelId: string): SlashCommandBody => ({
    command: '/claudito',
    text: 'list',
    user_id: 'U1',
    channel_id: channelId,
    response_url: '',
  });

  it('lists all projects with running and linked annotations', async () => {
    const project1 = { ...sampleProject, id: 'id-1', name: 'Project One', slackLinkedChannelId: 'C_CURRENT' };
    const project2 = { ...sampleProject, id: 'id-2', name: 'Project Two', slackLinkedChannelId: 'C_OTHER' };
    const project3 = { ...sampleProject, id: 'id-3', name: 'Project Three', slackLinkedChannelId: undefined };
    const { slackService, handler } = createStatusSetup([project1, project2, project3], ['id-1']);

    await handler(listBody('C_CURRENT'), ack);

    const reply = (slackService.sendMessage.mock.calls[0] as string[])[2];
    expect(reply).toContain('Projects (3)');
    expect(reply).toContain('*Project One* — running | → this channel');
    expect(reply).toContain('*Project Two* — → C_OTHER');
    expect(reply).toContain('• *Project Three*');
    expect(reply).not.toMatch(/\*Project Three\* —/);
  });

  it('shows "no projects" message when registry is empty', async () => {
    const { slackService, handler } = createStatusSetup([], []);

    await handler(listBody('C_CURRENT'), ack);

    const reply = (slackService.sendMessage.mock.calls[0] as string[])[2];
    expect(reply).toContain('No projects are registered.');
  });

  it('shows plain name when project has no running agent and no linked channel', async () => {
    const project = { ...sampleProject, slackLinkedChannelId: undefined };
    const { slackService, handler } = createStatusSetup([project], []);

    await handler(listBody('C_CURRENT'), ack);

    const reply = (slackService.sendMessage.mock.calls[0] as string[])[2];
    expect(reply).toContain(`• *${sampleProject.name}*`);
    expect(reply).not.toContain(' — ');
  });
});
