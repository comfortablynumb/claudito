import { DefaultSlackCommandService, SlackCommandServiceDeps } from '../../../src/services/slack-command-service';
import { SlackSocketService, SlashCommandBody, SlackMessageEvent, InteractiveActionBody } from '../../../src/services/slack-service';
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
import { AgentStatus } from '../../../src/agents/types';
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
    registerOneOff: jest.fn(),
    findOneOffId: jest.fn().mockReturnValue(null),
  };
}

const ack = jest.fn().mockResolvedValue(undefined);

interface SetupOpts {
  linkedChannelId?: string;
  agentRunning?: boolean;
  trackerProjectId?: string | null;
  trackerOneOffId?: string | null;
  projects?: ProjectStatus[];
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
  getInteractiveHandler(): (body: InteractiveActionBody, ack: () => Promise<void>) => Promise<void>;
}

function createSetup(opts: SetupOpts = {}): TestSetup {
  const agentManager = createMockAgentManager();
  const slackService = createMockSlackService();
  slackService.sendMessage.mockResolvedValue('ts-bot-reply');

  const socketService = createMockSocketService();

  const projectList = opts.projects ?? [
    {
      ...sampleProject,
      ...(opts.linkedChannelId && { slackLinkedChannelId: opts.linkedChannelId }),
    },
  ];
  const projectRepository = createMockProjectRepository(projectList);
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

  if (opts.trackerOneOffId !== undefined) {
    threadTracker.findOneOffId.mockReturnValue(opts.trackerOneOffId);
  }

  const deps: TestSetup['deps'] = {
    agentManager,
    slackService,
    socketService,
    projectRepository,
    settingsRepository,
    threadTracker,
  };

  function buildService() {
    const service = new DefaultSlackCommandService({
      agentManager,
      slackService,
      slackSocketService: socketService,
      projectRepository,
      settingsRepository,
      threadTracker,
    } as SlackCommandServiceDeps);
    service.register();
    return service;
  }

  function getMessageHandler() {
    buildService();
    return (socketService.onMessageEvent as jest.Mock).mock.calls[0][0] as
      (event: SlackMessageEvent, ack: () => Promise<void>) => Promise<void>;
  }

  function getInteractiveHandler() {
    buildService();
    return (socketService.onInteractiveAction as jest.Mock).mock.calls[0][0] as
      (body: InteractiveActionBody, ack: () => Promise<void>) => Promise<void>;
  }

  return { deps, getMessageHandler, getInteractiveHandler };
}

// ============================================================================
// Tests: top-level messages — project selector buttons
// ============================================================================

describe('SlackCommandService message events — top-level', () => {
  it('posts project selection buttons for any channel message', async () => {
    const { deps, getMessageHandler } = createSetup();
    const handler = getMessageHandler();

    await handler({ type: 'message', text: 'do something', channel: 'C_ANY', ts: 'ts-1', user: 'U_ANY' }, ack);

    expect(deps.slackService.replyInThread).toHaveBeenCalledWith(
      'xoxb-test', 'C_ANY', 'ts-1',
      expect.stringContaining('Which project'),
      expect.any(Array),
    );
    expect(deps.agentManager.startOneOffAgent).not.toHaveBeenCalled();
  });

  it('posts "no projects registered" when project list is empty', async () => {
    const { deps, getMessageHandler } = createSetup({ projects: [] });
    const handler = getMessageHandler();

    await handler({ type: 'message', text: 'hello', channel: 'C_ANY', ts: 'ts-2', user: 'U_ANY' }, ack);

    expect(deps.slackService.replyInThread).toHaveBeenCalledWith(
      'xoxb-test', 'C_ANY', 'ts-2', expect.stringContaining('No projects'),
    );
    expect(deps.agentManager.startOneOffAgent).not.toHaveBeenCalled();
  });

  it('shows project selector for multiple projects', async () => {
    const project1: ProjectStatus = { ...sampleProject, id: 'p1', name: 'Alpha' };
    const project2: ProjectStatus = { ...sampleProject, id: 'p2', name: 'Beta' };
    const { deps, getMessageHandler } = createSetup({ projects: [project1, project2] });
    const handler = getMessageHandler();

    await handler({ type: 'message', text: 'which project?', channel: 'C_ANY', ts: 'ts-3', user: 'U_ANY' }, ack);

    expect(deps.slackService.replyInThread).toHaveBeenCalledWith(
      'xoxb-test', 'C_ANY', 'ts-3',
      expect.any(String),
      expect.any(Array),
    );
    expect(deps.agentManager.startOneOffAgent).not.toHaveBeenCalled();
  });

  it('ignores bot messages (bot_id set)', async () => {
    const { deps, getMessageHandler } = createSetup();
    const handler = getMessageHandler();

    await handler({ type: 'message', text: 'bot says hello', channel: 'C_ANY', bot_id: 'B_BOT' }, ack);

    expect(deps.agentManager.startOneOffAgent).not.toHaveBeenCalled();
    expect(deps.slackService.replyInThread).not.toHaveBeenCalled();
  });

  it('ignores messages with a subtype', async () => {
    const { deps, getMessageHandler } = createSetup();
    const handler = getMessageHandler();

    await handler({ type: 'message', subtype: 'message_changed', text: 'edited', channel: 'C_ANY' }, ack);

    expect(deps.agentManager.startOneOffAgent).not.toHaveBeenCalled();
    expect(deps.slackService.replyInThread).not.toHaveBeenCalled();
  });

  it('ignores messages with empty text', async () => {
    const { deps, getMessageHandler } = createSetup();
    const handler = getMessageHandler();

    await handler({ type: 'message', text: '   ', channel: 'C_ANY' }, ack);

    expect(deps.agentManager.startOneOffAgent).not.toHaveBeenCalled();
    expect(deps.slackService.replyInThread).not.toHaveBeenCalled();
  });

  it('ignores messages with no channel', async () => {
    const { deps, getMessageHandler } = createSetup();
    const handler = getMessageHandler();

    await handler({ type: 'message', text: 'hello' }, ack);

    expect(deps.agentManager.startOneOffAgent).not.toHaveBeenCalled();
    expect(deps.slackService.replyInThread).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Tests: select_project interactive action
// ============================================================================

describe('SlackCommandService interactive action — select_project', () => {
  it('starts one-off agent when user selects a project', async () => {
    const { deps, getMessageHandler, getInteractiveHandler } = createSetup();
    const msgHandler = getMessageHandler();
    const actionHandler = getInteractiveHandler();

    // Step 1: top-level message stores pending context; selector reply returns its ts
    deps.slackService.replyInThread.mockResolvedValueOnce('ts-selector-msg');
    await msgHandler({ type: 'message', text: 'do something', channel: 'C_ANY', ts: 'ts-sel', user: 'U_ANY' }, ack);

    // Step 2: user clicks the button
    const actionBody: InteractiveActionBody = {
      actions: [{
        action_id: 'select_project_0',
        value: `${sampleProject.id}|C_ANY|ts-sel`,
      }],
      user: { id: 'U_ANY' },
    } as unknown as InteractiveActionBody;

    await actionHandler(actionBody, ack);

    expect(deps.agentManager.startOneOffAgent).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: sampleProject.id, message: 'do something' }),
    );
    expect(deps.slackService.replyInThread).toHaveBeenCalledWith(
      'xoxb-test', 'C_ANY', 'ts-sel', '⏳ Working on it...',
    );
    expect(deps.slackService.updateMessage).toHaveBeenCalledWith(
      'xoxb-test', 'C_ANY', 'ts-selector-msg',
      expect.stringContaining(sampleProject.name), [],
    );
  });

  it('silently ignores duplicate action when context is already consumed', async () => {
    const { deps, getInteractiveHandler } = createSetup();
    const actionHandler = getInteractiveHandler();

    const actionBody: InteractiveActionBody = {
      actions: [{
        action_id: 'select_project_0',
        value: `${sampleProject.id}|C_ANY|ts-unknown`,
      }],
      user: { id: 'U_ANY' },
    } as unknown as InteractiveActionBody;

    await actionHandler(actionBody, ack);

    expect(deps.agentManager.startOneOffAgent).not.toHaveBeenCalled();
    expect(deps.slackService.replyInThread).not.toHaveBeenCalledWith(
      expect.any(String), expect.any(String), expect.any(String), expect.stringContaining('expired'),
    );
  });
});

// ============================================================================
// Tests: thread replies
// ============================================================================

describe('SlackCommandService message events — thread replies', () => {
  it('routes thread reply to one-off agent via tracker', async () => {
    const { deps, getMessageHandler } = createSetup({
      trackerOneOffId: 'oneoff-tracked-id',
    });
    deps.agentManager.getOneOffMeta.mockReturnValue({ projectId: sampleProject.id, label: 'test' });
    const handler = getMessageHandler();

    await handler({ type: 'message', text: 'reply text', channel: 'C_ANY', thread_ts: 'ts-tracked' }, ack);

    expect(deps.agentManager.sendOneOffInput).toHaveBeenCalledWith('oneoff-tracked-id', 'reply text');
    expect(deps.threadTracker.findOneOffId).toHaveBeenCalledWith('C_ANY', 'ts-tracked');
  });

  it('starts new one-off agent for thread reply when no active one-off agent, even if main agent is running', async () => {
    const { deps, getMessageHandler } = createSetup({
      agentRunning: true,
      trackerProjectId: sampleProject.id,
    });
    const handler = getMessageHandler();

    await handler({ type: 'message', text: 'follow up', channel: 'C_ANY', thread_ts: 'ts-tracked' }, ack);

    expect(deps.agentManager.sendInput).not.toHaveBeenCalled();
    expect(deps.agentManager.startOneOffAgent).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: sampleProject.id, message: 'follow up' }),
    );
    expect(deps.threadTracker.find).toHaveBeenCalledWith('C_ANY', 'ts-tracked');
  });

  it('ignores thread reply for untracked thread', async () => {
    const { deps, getMessageHandler } = createSetup({ trackerProjectId: null });
    const handler = getMessageHandler();

    await handler({ type: 'message', text: 'reply', channel: 'C_ANY', thread_ts: 'ts-unknown' }, ack);

    expect(deps.agentManager.sendInput).not.toHaveBeenCalled();
    expect(deps.agentManager.startOneOffAgent).not.toHaveBeenCalled();
    expect(deps.slackService.replyInThread).not.toHaveBeenCalled();
  });

  it('starts new one-off agent for subsequent message on known thread when main agent is stopped', async () => {
    const { deps, getMessageHandler } = createSetup({
      agentRunning: false,
      trackerProjectId: sampleProject.id,
    });
    const handler = getMessageHandler();

    await handler({ type: 'message', text: 'hello?', channel: 'C_ANY', thread_ts: 'ts-tracked' }, ack);

    expect(deps.agentManager.sendInput).not.toHaveBeenCalled();
    expect(deps.agentManager.startOneOffAgent).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: sampleProject.id, message: 'hello?' }),
    );
    expect(deps.slackService.replyInThread).toHaveBeenCalledWith(
      'xoxb-test', 'C_ANY', 'ts-tracked', '⏳ Working on it...',
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
  function createListSetup(projects: ProjectStatus[], runningIds: string[]) {
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
    const { slackService, handler } = createListSetup([project1, project2, project3], ['id-1']);

    await handler(listBody('C_CURRENT'), ack);

    const reply = (slackService.sendMessage.mock.calls[0] as string[])[2];
    expect(reply).toContain('Projects (3)');
    expect(reply).toContain('*Project One* — running | → this channel');
    expect(reply).toContain('*Project Two* — → C_OTHER');
    expect(reply).toContain('• *Project Three*');
    expect(reply).not.toMatch(/\*Project Three\* —/);
  });

  it('shows "no projects" message when registry is empty', async () => {
    const { slackService, handler } = createListSetup([], []);

    await handler(listBody('C_CURRENT'), ack);

    const reply = (slackService.sendMessage.mock.calls[0] as string[])[2];
    expect(reply).toContain('No projects are registered.');
  });

  it('shows plain name when project has no running agent and no linked channel', async () => {
    const project = { ...sampleProject, slackLinkedChannelId: undefined };
    const { slackService, handler } = createListSetup([project], []);

    await handler(listBody('C_CURRENT'), ack);

    const reply = (slackService.sendMessage.mock.calls[0] as string[])[2];
    expect(reply).toContain(`• *${sampleProject.name}*`);
    expect(reply).not.toContain(' — ');
  });
});

// ============================================================================
// Tests: /claudito slash commands — help, start, stop, unknown
// ============================================================================

describe('SlackCommandService slash commands — help/start/stop/unknown', () => {
  function createSlashSetup(projects: ProjectStatus[] = [sampleProject]) {
    const agentManager = createMockAgentManager();
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

    return { agentManager, slackService, handler };
  }

  const makeBody = (text: string): SlashCommandBody => ({
    command: '/claudito',
    text,
    user_id: 'U1',
    channel_id: 'C1',
    response_url: '',
  });

  it('shows help for empty command', async () => {
    const { slackService, handler } = createSlashSetup();
    await handler(makeBody(''), ack);
    const reply = (slackService.sendMessage.mock.calls[0] as string[])[2];
    expect(reply).toContain('Available commands');
  });

  it('shows help for "help" command', async () => {
    const { slackService, handler } = createSlashSetup();
    await handler(makeBody('help'), ack);
    const reply = (slackService.sendMessage.mock.calls[0] as string[])[2];
    expect(reply).toContain('Available commands');
  });

  it('shows unknown command text', async () => {
    const { slackService, handler } = createSlashSetup();
    await handler(makeBody('foobar'), ack);
    const reply = (slackService.sendMessage.mock.calls[0] as string[])[2];
    expect(reply).toContain('Unknown command');
    expect(reply).toContain('foobar');
  });

  it('start command with missing args shows usage', async () => {
    const { slackService, handler } = createSlashSetup();
    await handler(makeBody('start'), ack);
    const reply = (slackService.sendMessage.mock.calls[0] as string[])[2];
    expect(reply).toContain('Usage');
  });

  it('start command with only project name (no prompt) shows usage', async () => {
    const { slackService, handler } = createSlashSetup();
    await handler(makeBody('start my-project'), ack);
    const reply = (slackService.sendMessage.mock.calls[0] as string[])[2];
    expect(reply).toContain('Usage');
  });

  it('start command with unknown project shows error', async () => {
    const { slackService, handler } = createSlashSetup();
    await handler(makeBody('start nonexistent do something'), ack);
    const reply = (slackService.sendMessage.mock.calls[0] as string[])[2];
    expect(reply).toContain('Project not found');
  });

  it('start command starts agent successfully', async () => {
    const { agentManager, slackService, handler } = createSlashSetup();
    await handler(makeBody(`start ${sampleProject.id} fix the bug`), ack);
    expect(agentManager.startInteractiveAgent).toHaveBeenCalledWith(
      sampleProject.id,
      expect.objectContaining({ initialMessage: 'fix the bug' }),
    );
    const reply = (slackService.sendMessage.mock.calls[0] as string[])[2];
    expect(reply).toContain('Agent started');
  });

  it('start command reports error when agent fails to start', async () => {
    const { agentManager, slackService, handler } = createSlashSetup();
    agentManager.startInteractiveAgent.mockRejectedValue(new Error('already running'));
    await handler(makeBody(`start ${sampleProject.id} do stuff`), ack);
    const reply = (slackService.sendMessage.mock.calls[0] as string[])[2];
    expect(reply).toContain('Failed to start agent');
  });

  it('stop command with no args shows usage', async () => {
    const { slackService, handler } = createSlashSetup();
    await handler(makeBody('stop'), ack);
    const reply = (slackService.sendMessage.mock.calls[0] as string[])[2];
    expect(reply).toContain('Usage');
  });

  it('stop command with unknown project shows error', async () => {
    const { slackService, handler } = createSlashSetup();
    await handler(makeBody('stop nonexistent'), ack);
    const reply = (slackService.sendMessage.mock.calls[0] as string[])[2];
    expect(reply).toContain('Project not found');
  });

  it('stop command stops agent successfully', async () => {
    const { agentManager, slackService, handler } = createSlashSetup();
    await handler(makeBody(`stop ${sampleProject.id}`), ack);
    expect(agentManager.stopAgent).toHaveBeenCalledWith(sampleProject.id);
    const reply = (slackService.sendMessage.mock.calls[0] as string[])[2];
    expect(reply).toContain('Agent stopped');
  });

  it('does nothing when botToken is missing', async () => {
    const agentManager = createMockAgentManager();
    const slackService = createMockSlackService();
    const socketService = createMockSocketService();
    const projectRepository = createMockProjectRepository([sampleProject]);
    const settingsRepository = createMockSettingsRepository({});
    const threadTracker = createMockTracker();

    const service = new DefaultSlackCommandService({
      agentManager, slackService,
      slackSocketService: socketService,
      projectRepository, settingsRepository, threadTracker,
    } as SlackCommandServiceDeps);
    service.register();

    const handler = (socketService.onSlashCommand as jest.Mock).mock.calls[0][0] as
      (body: SlashCommandBody, ack: () => Promise<void>) => Promise<void>;

    await handler(makeBody('help'), ack);
    expect(slackService.sendMessage).not.toHaveBeenCalled();
  });

  it('start can find project by id', async () => {
    const { agentManager, handler } = createSlashSetup();
    await handler(makeBody(`start ${sampleProject.id} fix bug`), ack);
    expect(agentManager.startInteractiveAgent).toHaveBeenCalledWith(
      sampleProject.id,
      expect.objectContaining({ initialMessage: 'fix bug' }),
    );
  });
});

// ============================================================================
// Tests: interactive actions — stop/approve/reject
// ============================================================================

describe('SlackCommandService interactive actions — stop/approve/reject', () => {
  function createInteractiveSetup() {
    const agentManager = createMockAgentManager();
    const slackService = createMockSlackService();
    const socketService = createMockSocketService();
    const projectRepository = createMockProjectRepository([sampleProject]);
    const settingsRepository = createMockSettingsRepository({
      slack: { enabled: true, botToken: 'xoxb-test', appToken: '', defaultChannelId: '' },
    });
    const threadTracker = createMockTracker();
    threadTracker.getLatest.mockReturnValue({ channelId: 'C1', threadTs: 'ts-1' });

    const service = new DefaultSlackCommandService({
      agentManager, slackService,
      slackSocketService: socketService,
      projectRepository, settingsRepository, threadTracker,
    } as SlackCommandServiceDeps);
    service.register();

    const handler = (socketService.onInteractiveAction as jest.Mock).mock.calls[0][0] as
      (body: InteractiveActionBody, ack: () => Promise<void>) => Promise<void>;

    return { agentManager, slackService, handler, threadTracker };
  }

  it('stop_agent action stops the agent', async () => {
    const { agentManager, slackService, handler } = createInteractiveSetup();
    const body = { actions: [{ action_id: `stop_agent:${sampleProject.id}`, value: '' }] } as unknown as InteractiveActionBody;
    await handler(body, ack);
    expect(agentManager.stopAgent).toHaveBeenCalledWith(sampleProject.id);
    expect(slackService.replyInThread).toHaveBeenCalledWith(
      'xoxb-test', 'C1', 'ts-1', expect.stringContaining('Agent stopped'),
    );
  });

  it('approve_plan action sends "yes" input', async () => {
    const { agentManager, slackService, handler } = createInteractiveSetup();
    const body = { actions: [{ action_id: `approve_plan:${sampleProject.id}`, value: '' }] } as unknown as InteractiveActionBody;
    await handler(body, ack);
    expect(agentManager.sendInput).toHaveBeenCalledWith(sampleProject.id, 'yes');
    expect(slackService.replyInThread).toHaveBeenCalledWith(
      'xoxb-test', 'C1', 'ts-1', expect.stringContaining('Plan approved'),
    );
  });

  it('reject_plan action sends "no" input', async () => {
    const { agentManager, slackService, handler } = createInteractiveSetup();
    const body = { actions: [{ action_id: `reject_plan:${sampleProject.id}`, value: '' }] } as unknown as InteractiveActionBody;
    await handler(body, ack);
    expect(agentManager.sendInput).toHaveBeenCalledWith(sampleProject.id, 'no');
    expect(slackService.replyInThread).toHaveBeenCalledWith(
      'xoxb-test', 'C1', 'ts-1', expect.stringContaining('Plan rejected'),
    );
  });

  it('ignores action with no actions array', async () => {
    const { agentManager, handler } = createInteractiveSetup();
    const body = { actions: [] } as unknown as InteractiveActionBody;
    await handler(body, ack);
    expect(agentManager.stopAgent).not.toHaveBeenCalled();
  });

  it('ignores action with missing botToken', async () => {
    const agentManager = createMockAgentManager();
    const slackService = createMockSlackService();
    const socketService = createMockSocketService();
    const projectRepository = createMockProjectRepository([sampleProject]);
    const settingsRepository = createMockSettingsRepository({});
    const threadTracker = createMockTracker();

    const service = new DefaultSlackCommandService({
      agentManager, slackService,
      slackSocketService: socketService,
      projectRepository, settingsRepository, threadTracker,
    } as SlackCommandServiceDeps);
    service.register();

    const handler = (socketService.onInteractiveAction as jest.Mock).mock.calls[0][0] as
      (body: InteractiveActionBody, ack: () => Promise<void>) => Promise<void>;

    const body = { actions: [{ action_id: `stop_agent:${sampleProject.id}`, value: '' }] } as unknown as InteractiveActionBody;
    await handler(body, ack);
    expect(agentManager.stopAgent).not.toHaveBeenCalled();
  });

  it('ignores action with invalid action_id format (no parts)', async () => {
    const { agentManager, handler } = createInteractiveSetup();
    const body = { actions: [{ action_id: 'singlepart', value: '' }] } as unknown as InteractiveActionBody;
    await handler(body, ack);
    expect(agentManager.stopAgent).not.toHaveBeenCalled();
  });

  it('select_project action with incomplete value is ignored', async () => {
    const { agentManager, handler } = createInteractiveSetup();
    const body = { actions: [{ action_id: 'select_project_0', value: 'onlyone' }] } as unknown as InteractiveActionBody;
    await handler(body, ack);
    expect(agentManager.startOneOffAgent).not.toHaveBeenCalled();
  });

  it('does not reply if threadTracker has no latest for project', async () => {
    const { slackService, handler, threadTracker } = createInteractiveSetup();
    threadTracker.getLatest.mockReturnValue(null);
    const body = { actions: [{ action_id: `stop_agent:${sampleProject.id}`, value: '' }] } as unknown as InteractiveActionBody;
    await handler(body, ack);
    expect(slackService.replyInThread).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Tests: thread reply edge cases
// ============================================================================

describe('SlackCommandService — thread reply edge cases', () => {
  it('drops thread reply when tracked project is not found in repo', async () => {
    const { deps, getMessageHandler } = createSetup({
      trackerProjectId: 'deleted-project-id',
      projects: [],
    });
    const handler = getMessageHandler();

    await handler({ type: 'message', text: 'hello', channel: 'C_ANY', thread_ts: 'ts-1' }, ack);

    expect(deps.agentManager.startOneOffAgent).not.toHaveBeenCalled();
  });

  it('reports error when startOneOffAgent fails for thread reply', async () => {
    const { deps, getMessageHandler } = createSetup({ trackerProjectId: sampleProject.id });
    deps.agentManager.startOneOffAgent.mockRejectedValue(new Error('max agents'));
    deps.slackService.replyInThread.mockResolvedValueOnce('ts-working');
    const handler = getMessageHandler();

    await handler({ type: 'message', text: 'hello', channel: 'C_ANY', thread_ts: 'ts-1' }, ack);

    expect(deps.slackService.updateMessage).toHaveBeenCalledWith(
      'xoxb-test', 'C_ANY', 'ts-working',
      expect.stringContaining('Failed to start agent'),
    );
  });

  it('falls back to replyInThread when startOneOffAgent fails and no workingMsgTs', async () => {
    const { deps, getMessageHandler } = createSetup({ trackerProjectId: sampleProject.id });
    deps.agentManager.startOneOffAgent.mockRejectedValue(new Error('fail'));
    deps.slackService.replyInThread.mockResolvedValueOnce(undefined as unknown as string);
    const handler = getMessageHandler();

    await handler({ type: 'message', text: 'hello', channel: 'C_ANY', thread_ts: 'ts-1' }, ack);

    // Should fall back to replyInThread (called twice: once for working, once for error)
    expect(deps.slackService.replyInThread).toHaveBeenCalledTimes(2);
  });

  it('drops message event when eventTs is missing (top-level)', async () => {
    const { deps, getMessageHandler } = createSetup();
    const handler = getMessageHandler();

    // Top-level message (no thread_ts) with no ts
    await handler({ type: 'message', text: 'hello', channel: 'C_ANY' }, ack);

    expect(deps.slackService.replyInThread).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Tests: subscribeOneOffToSlack result delivery
// ============================================================================

describe('SlackCommandService — subscribeOneOffToSlack result delivery', () => {
  async function setupAndTriggerAction(deps: TestSetup['deps'], getMessageHandler: TestSetup['getMessageHandler'], getInteractiveHandler: TestSetup['getInteractiveHandler']) {
    const msgHandler = getMessageHandler();
    const actionHandler = getInteractiveHandler();

    deps.slackService.replyInThread
      .mockResolvedValueOnce('ts-selector-msg')
      .mockResolvedValueOnce('ts-working-msg');

    await msgHandler({ type: 'message', text: 'do something', channel: 'C_ANY', ts: 'ts-sel', user: 'U_ANY' }, ack);

    const actionBody: InteractiveActionBody = {
      actions: [{ action_id: 'select_project_0', value: `${sampleProject.id}|C_ANY|ts-sel` }],
      user: { id: 'U_ANY' },
    } as unknown as InteractiveActionBody;

    await actionHandler(actionBody, ack);
  }

  function extractListener<T extends (...args: never[]) => void>(
    onMock: jest.Mock,
    event: string,
  ): T {
    const call = onMock.mock.calls.find(([e]: [string]) => e === event);
    return call![1] as T;
  }

  it('sends delta to Slack when one-off agent is waiting (keeps agent alive)', async () => {
    const { deps, getMessageHandler, getInteractiveHandler } = createSetup();
    deps.agentManager.getOneOffCollectedOutput.mockReturnValue('Task completed successfully');

    await setupAndTriggerAction(deps, getMessageHandler, getInteractiveHandler);

    const onWaiting = extractListener<(id: string, isWaiting: boolean, version: number) => void>(
      deps.agentManager.on as jest.Mock,
      'oneOffWaiting',
    );
    onWaiting('oneoff-test-id', true, 1);
    await Promise.resolve();

    // Agent is NOT stopped — it stays alive for the user's thread reply
    expect(deps.agentManager.stopOneOffAgent).not.toHaveBeenCalled();
    expect(deps.slackService.updateMessage).toHaveBeenCalledWith(
      'xoxb-test', 'C_ANY', 'ts-working-msg',
      expect.stringContaining('Task completed successfully'),
    );
  });

  it('falls back to oneOffStatus=stopped when agent exits unexpectedly', async () => {
    const { deps, getMessageHandler, getInteractiveHandler } = createSetup();
    deps.agentManager.getOneOffCollectedOutput.mockReturnValue('Fallback output');

    await setupAndTriggerAction(deps, getMessageHandler, getInteractiveHandler);

    const onStatus = extractListener<(id: string, status: AgentStatus) => void>(
      deps.agentManager.on as jest.Mock,
      'oneOffStatus',
    );
    onStatus('oneoff-test-id', 'stopped');
    await Promise.resolve();

    expect(deps.slackService.updateMessage).toHaveBeenCalledWith(
      'xoxb-test', 'C_ANY', 'ts-working-msg',
      expect.stringContaining('Fallback output'),
    );
  });

  it('does not double-send if both oneOffWaiting and oneOffStatus=stopped fire', async () => {
    const { deps, getMessageHandler, getInteractiveHandler } = createSetup();
    deps.agentManager.getOneOffCollectedOutput.mockReturnValue('Output text');

    await setupAndTriggerAction(deps, getMessageHandler, getInteractiveHandler);

    const onWaiting = extractListener<(id: string, isWaiting: boolean, version: number) => void>(
      deps.agentManager.on as jest.Mock,
      'oneOffWaiting',
    );
    const onStatus = extractListener<(id: string, status: AgentStatus) => void>(
      deps.agentManager.on as jest.Mock,
      'oneOffStatus',
    );

    onWaiting('oneoff-test-id', true, 1);
    onStatus('oneoff-test-id', 'stopped');
    await Promise.resolve();

    // 2 total updateMessage calls: 1 for selector update + 1 for result (not 3)
    expect(deps.slackService.updateMessage).toHaveBeenCalledTimes(2);
    expect(deps.slackService.updateMessage).toHaveBeenCalledWith(
      'xoxb-test', 'C_ANY', 'ts-working-msg',
      expect.stringContaining('Output text'),
    );
  });
});

// ============================================================================
// Tests: error paths and factory
// ============================================================================

describe('SlackCommandService — error paths and factory', () => {
  it('catches and logs error in message event handler', async () => {
    const { deps, getMessageHandler } = createSetup();
    // Make findAll throw to trigger catch in the message event handler wrapper
    deps.projectRepository.findAll.mockRejectedValue(new Error('DB down'));
    const handler = getMessageHandler();

    // Should not throw
    await handler({ type: 'message', text: 'hello', channel: 'C_ANY', ts: 'ts-err' }, ack);

    // The error is caught internally (line 186)
  });

  it('catches error when reply sendMessage fails', async () => {
    const { deps } = createSetup();
    deps.slackService.sendMessage.mockRejectedValue(new Error('Slack API down'));

    const socketService = deps.socketService;
    const service = new DefaultSlackCommandService({
      agentManager: deps.agentManager,
      slackService: deps.slackService,
      slackSocketService: socketService,
      projectRepository: deps.projectRepository,
      settingsRepository: deps.settingsRepository,
      threadTracker: deps.threadTracker,
    } as SlackCommandServiceDeps);
    service.register();

    const slashHandler = (socketService.onSlashCommand as jest.Mock).mock.calls[0][0] as
      (body: SlashCommandBody, ack: () => Promise<void>) => Promise<void>;

    // help command triggers reply which calls sendMessage
    await slashHandler({
      command: '/claudito',
      text: 'help',
      channel_id: 'C1',
      user_id: 'U1',
      response_url: '',
    } as SlashCommandBody, ack);

    // Should not throw - error is caught at line 203
  });

  it('handles project not found during handleProjectSelected', async () => {
    const { deps, getMessageHandler, getInteractiveHandler } = createSetup({ projects: [] });

    const msgHandler = getMessageHandler();
    const actionHandler = getInteractiveHandler();

    deps.slackService.replyInThread.mockResolvedValueOnce('ts-selector');

    // Use a non-empty project list for the top-level message so selector is posted
    deps.projectRepository.findAll.mockResolvedValueOnce([sampleProject]);
    await msgHandler({ type: 'message', text: 'hello', channel: 'C_ANY', ts: 'ts-sel', user: 'U_ANY' }, ack);

    // Now when interactive action fires, findAll returns empty list
    deps.projectRepository.findAll.mockResolvedValue([]);

    const actionBody = {
      actions: [{ action_id: 'select_project_0', value: `${sampleProject.id}|C_ANY|ts-sel` }],
      user: { id: 'U_ANY' },
    } as unknown as InteractiveActionBody;

    await actionHandler(actionBody, ack);

    // Should have replied with "Project not found" (line 411)
    expect(deps.slackService.replyInThread).toHaveBeenCalledWith(
      'xoxb-test', 'C_ANY', 'ts-sel',
      expect.stringContaining('Project not found'),
    );
  });
});

describe('createSlackCommandService factory', () => {
  it('returns a SlackCommandService instance', () => {
    const { createSlackCommandService } = require('../../../src/services/slack-command-service');
    const deps = {
      agentManager: createMockAgentManager(),
      slackService: createMockSlackService(),
      slackSocketService: createMockSocketService(),
      projectRepository: createMockProjectRepository(),
      settingsRepository: createMockSettingsRepository(),
      threadTracker: createMockTracker(),
    };

    const service = createSlackCommandService(deps);

    expect(service).toBeDefined();
    expect(typeof service.register).toBe('function');
  });
});
