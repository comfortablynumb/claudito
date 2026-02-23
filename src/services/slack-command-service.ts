import { AgentManager, AgentStatus } from '../agents';
import { SlackService, SlackSocketService, SlashCommandBody, InteractiveActionBody, SlackMessageEvent } from './slack-service';
import { SlackThreadTracker } from './slack-thread-tracker';
import { ProjectRepository, ProjectStatus } from '../repositories/project';
import { SettingsRepository } from '../repositories/settings';
import { getLogger, Logger } from '../utils';

// ============================================================================
// Types
// ============================================================================

export interface SlackCommandServiceDeps {
  agentManager: AgentManager;
  slackService: SlackService;
  slackSocketService: SlackSocketService;
  projectRepository: ProjectRepository;
  settingsRepository: SettingsRepository;
  threadTracker: SlackThreadTracker;
}

export interface SlackCommandService {
  register(): void;
}

interface PendingContext {
  originalText: string;
  userId?: string;
  selectorMsgTs?: string;
}

interface OneOffSlackSub {
  oneOffId: string;
  projectId: string;
  channelId: string;
  threadTs: string;
  workingMsgTs: string;
  botToken: string;
}

interface StartOneOffOpts {
  projectId: string;
  project: ProjectStatus;
  channelId: string;
  threadTs: string;
  message: string;
  userId?: string;
  botToken: string;
}

// ============================================================================
// Module-level constants
// ============================================================================

const SLACK_AGENT_SYSTEM_PROMPT =
  'In your turn, generate at most one message. If you need to create a plan, just create a ' +
  'message with your plan as brief as possible, and ask the user to write if he approves or not ' +
  '(and if not, what needs to be changed). If he does approve, just work on the issue and send ' +
  'one message with the result. If he does not approve, ask for details if not given and then ' +
  'generate, again, one single message with your plan and ask the user if he approves or not. ' +
  "Also, use Slack's markdown for your messages";

// ============================================================================
// Module-level helpers
// ============================================================================

const BUTTONS_PER_BLOCK = 5;

function buildProjectSelectionBlocks(
  projects: ProjectStatus[], channelId: string, threadTs: string,
): unknown[] {
  const shown = projects.slice(0, 25);
  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: '*Which project would you like me to work on?*' } },
  ];

  for (let i = 0; i < shown.length; i += BUTTONS_PER_BLOCK) {
    blocks.push({
      type: 'actions',
      elements: shown.slice(i, i + BUTTONS_PER_BLOCK).map((p, j) => ({
        type: 'button',
        text: { type: 'plain_text', text: p.name, emoji: false },
        action_id: `select_project_${i + j}`,
        value: `${p.id}|${channelId}|${threadTs}`,
      })),
    });
  }

  return blocks;
}

function stripSlackFormatting(text: string): string {
  return text.replace(/[`*_~]/g, '');
}

function findProject(projects: ProjectStatus[], nameOrId: string): ProjectStatus | undefined {
  const lower = nameOrId.toLowerCase();
  return projects.find(
    (p) => p.name.toLowerCase() === lower || p.id.toLowerCase() === lower
  );
}

function convertToMrkdwn(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*');
}

function buildListLines(projects: ProjectStatus[], runningIds: Set<string>, channelId: string): string[] {
  return projects.map((p) => {
    const tags: string[] = [];

    if (runningIds.has(p.id)) tags.push('running');

    if (p.slackLinkedChannelId) {
      const ch = p.slackLinkedChannelId === channelId ? 'this channel' : p.slackLinkedChannelId;
      tags.push(`→ ${ch}`);
    }

    const suffix = tags.length ? ` — ${tags.join(' | ')}` : '';
    return `• *${p.name}*${suffix}`;
  });
}

function buildRunningLines(projects: ProjectStatus[], runningIds: Set<string>): string[] {
  return projects
    .filter((p) => runningIds.has(p.id))
    .map((p) => `• *${p.name}*`);
}

function buildLinkedLines(projects: ProjectStatus[], currentChannelId: string): string[] {
  return projects
    .filter((p) => p.slackLinkedChannelId)
    .map((p) => {
      const ch = p.slackLinkedChannelId === currentChannelId ? 'this channel' : p.slackLinkedChannelId!;
      return `• *${p.name}* → ${ch}`;
    });
}

function buildHelpText(): string {
  return [
    '🤖 *Claudito Help*',
    '',
    '*Available commands:*',
    '• `/claudito status` — list running agents and linked channels',
    '• `/claudito list` — list all registered projects',
    '• `/claudito start <project> <prompt>` — start an agent',
    '• `/claudito stop <project>` — stop an agent',
  ].join('\n');
}

function buildUnknownCommandText(subCommand: string): string {
  return `❓ Unknown command: \`${subCommand}\`\n\n${buildHelpText()}`;
}

// ============================================================================
// DefaultSlackCommandService
// ============================================================================

export class DefaultSlackCommandService implements SlackCommandService {
  private readonly deps: SlackCommandServiceDeps;
  private readonly logger: Logger;
  private readonly pendingContexts = new Map<string, PendingContext>();

  constructor(deps: SlackCommandServiceDeps) {
    this.deps = deps;
    this.logger = getLogger('slack-commands');
  }

  register(): void {
    this.deps.slackSocketService.onSlashCommand(async (body, ack) => {
      await ack();
      await this.handleSlashCommand(body);
    });

    this.deps.slackSocketService.onInteractiveAction(async (body, ack) => {
      await ack();
      await this.handleInteractiveAction(body);
    });

    this.deps.slackSocketService.onMessageEvent(async (event, ack) => {
      await ack();
      try {
        await this.handleMessageEvent(event);
      } catch (err) {
        this.logger.error('Unhandled error in Slack message event handler', { error: String(err) });
      }
    });

    this.logger.info('Slack command handlers registered');
  }

  private async getBotToken(): Promise<string | null> {
    const settings = await this.deps.settingsRepository.get();
    return settings.slack?.botToken || null;
  }

  private async reply(botToken: string, channelId: string, text: string): Promise<void> {
    try {
      await this.deps.slackService.sendMessage(botToken, channelId, text);
      this.logger.debug('Slack reply sent', { channelId });
    } catch (err) {
      this.logger.error('Failed to send slash command reply', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleSlashCommand(body: SlashCommandBody): Promise<void> {
    const botToken = await this.getBotToken();
    if (!botToken) return;

    const parts = (body.text || '').trim().split(/\s+/);
    const subCommand = parts[0] ?? '';
    const args = parts.slice(1).map(stripSlackFormatting);

    this.logger.info('Slack slash command received', { command: subCommand, userId: body.user_id });

    switch (subCommand.toLowerCase()) {
      case '':
      case 'help':
        await this.reply(botToken, body.channel_id, buildHelpText());
        break;
      case 'status':
        await this.handleStatus(botToken, body.channel_id);
        break;
      case 'list':
        await this.handleList(botToken, body.channel_id);
        break;
      case 'start':
        await this.handleStart(botToken, body.channel_id, args);
        break;
      case 'stop':
        await this.handleStop(botToken, body.channel_id, args);
        break;
      default:
        await this.reply(botToken, body.channel_id, buildUnknownCommandText(subCommand));
    }
  }

  private async handleList(botToken: string, channelId: string): Promise<void> {
    const projects = await this.deps.projectRepository.findAll();

    if (!projects.length) {
      await this.reply(botToken, channelId, '📋 No projects are registered.');
      return;
    }

    const runningIds = new Set(this.deps.agentManager.getRunningProjectIds());
    const lines = buildListLines(projects, runningIds, channelId);

    await this.reply(botToken, channelId, `📋 *Projects (${projects.length}):*\n${lines.join('\n')}`);
    this.logger.info('List command responded', { count: projects.length });
  }

  private async handleStatus(botToken: string, channelId: string): Promise<void> {
    const runningIds = new Set(this.deps.agentManager.getRunningProjectIds());
    const allProjects = await this.deps.projectRepository.findAll();

    const runningLines = buildRunningLines(allProjects, runningIds);
    const linkedLines = buildLinkedLines(allProjects, channelId);

    const parts: string[] = [];

    if (runningLines.length) {
      parts.push(`*Running agents (${runningLines.length}):*\n${runningLines.join('\n')}`);
    } else {
      parts.push('No agents are currently running.');
    }

    if (linkedLines.length) {
      parts.push(`*Linked channels (${linkedLines.length}):*\n${linkedLines.join('\n')}`);
    } else {
      parts.push('No channels are linked.');
    }

    await this.reply(botToken, channelId, `🤖 *Claudito Status*\n\n${parts.join('\n\n')}`);
    this.logger.info('Status command responded', { running: runningLines.length, linked: linkedLines.length });
  }

  private async handleStart(botToken: string, channelId: string, args: string[]): Promise<void> {
    const [nameOrId, ...promptParts] = args;
    if (!nameOrId || !promptParts.length) {
      this.logger.warn('Start command: missing args', { channelId });
      await this.reply(botToken, channelId, '❌ Usage: `/claudito start <project-name> <prompt>`');
      return;
    }

    const prompt = promptParts.join(' ');
    const projects = await this.deps.projectRepository.findAll();
    const project = findProject(projects, nameOrId);

    if (!project) {
      this.logger.warn('Start command: project not found', { nameOrId });
      await this.reply(botToken, channelId, `❌ Project not found: *${nameOrId}*`);
      return;
    }

    try {
      await this.deps.agentManager.startInteractiveAgent(project.id, { initialMessage: prompt });
      this.logger.info('Start command: agent started', { projectId: project.id, projectName: project.name });
      await this.reply(botToken, channelId, `✅ Agent started for *${project.name}* with prompt:\n> ${prompt}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.reply(botToken, channelId, `❌ Failed to start agent: ${message}`);
    }
  }

  private async handleStop(botToken: string, channelId: string, args: string[]): Promise<void> {
    const [nameOrId] = args;
    if (!nameOrId) {
      await this.reply(botToken, channelId, '❌ Usage: `/claudito stop <project-name>`');
      return;
    }

    const projects = await this.deps.projectRepository.findAll();
    const project = findProject(projects, nameOrId);

    if (!project) {
      this.logger.warn('Stop command: project not found', { nameOrId });
      await this.reply(botToken, channelId, `❌ Project not found: *${nameOrId}*`);
      return;
    }

    await this.deps.agentManager.stopAgent(project.id);
    this.logger.info('Stop command: agent stopped', { projectId: project.id, projectName: project.name });
    await this.reply(botToken, channelId, `✅ Agent stopped for *${project.name}*`);
  }

  private async handleMessageEvent(event: SlackMessageEvent): Promise<void> {
    if (event.bot_id || event.subtype) {
      this.logger.debug('Message dropped: bot or subtype', { bot_id: event.bot_id, subtype: event.subtype });
      return;
    }

    const text = (event.text || '').trim();

    if (!text) {
      this.logger.debug('Message dropped: empty text');
      return;
    }

    const channelId = event.channel;

    if (!channelId) {
      this.logger.debug('Message dropped: missing channel');
      return;
    }

    if (event.thread_ts) {
      await this.handleThreadReply(channelId, event.thread_ts, text, event.user);
      return;
    }

    await this.handleTopLevelMessage(channelId, text, event.ts, event.user);
  }

  private async getSlackUsername(userId: string): Promise<string | undefined> {
    const botToken = await this.getBotToken();
    if (!botToken) return undefined;
    return (await this.deps.slackService.getUserName(botToken, userId)) ?? undefined;
  }

  private async handleTopLevelMessage(
    channelId: string,
    text: string,
    eventTs?: string,
    userId?: string,
  ): Promise<void> {
    if (!eventTs) {
      this.logger.debug('Message dropped: missing eventTs');
      return;
    }

    const botToken = await this.getBotToken();
    if (!botToken) return;

    const projects = await this.deps.projectRepository.findAll();

    if (!projects.length) {
      await this.deps.slackService.replyInThread(botToken, channelId, eventTs, '❌ No projects are registered.');
      return;
    }

    const contextKey = `${channelId}:${eventTs}`;
    const blocks = buildProjectSelectionBlocks(projects, channelId, eventTs);
    const selectorMsgTs = await this.deps.slackService.replyInThread(
      botToken, channelId, eventTs, 'Which project would you like me to work on?', blocks,
    );
    this.pendingContexts.set(contextKey, { originalText: text, userId, selectorMsgTs });
    this.logger.info('Project selector posted', { channelId, eventTs, count: projects.length });
  }

  private async handleProjectSelected(
    projectId: string,
    channelId: string,
    threadTs: string,
    userId: string | undefined,
    botToken: string,
  ): Promise<void> {
    const contextKey = `${channelId}:${threadTs}`;
    const context = this.pendingContexts.get(contextKey);
    this.pendingContexts.delete(contextKey);

    if (!context) return; // second delivery — first call already handled it

    const projects = await this.deps.projectRepository.findAll();
    const project = projects.find((p) => p.id === projectId);

    if (!project) {
      await this.deps.slackService.replyInThread(botToken, channelId, threadTs, '❌ Project not found.');
      return;
    }

    if (context.selectorMsgTs) {
      await this.deps.slackService.updateMessage(
        botToken, channelId, context.selectorMsgTs,
        `✅ Got it! Working on *${project.name}*…`, [],
      );
    }

    await this.startOneOffAgentForThread({
      projectId: project.id, project, channelId, threadTs,
      message: context.originalText, userId: context.userId ?? userId, botToken,
    });
  }

  private async startOneOffAgentForThread(opts: StartOneOffOpts): Promise<void> {
    const { projectId, channelId, threadTs, message, userId, botToken } = opts;
    const workingMsgTs = await this.deps.slackService.replyInThread(
      botToken, channelId, threadTs, '⏳ Working on it...',
    );

    this.deps.threadTracker.register(projectId, channelId, threadTs);
    this.deps.threadTracker.setLatest(projectId, channelId, threadTs);

    try {
      const slackUsername = userId ? await this.getSlackUsername(userId) : undefined;
      const label = `Slack: ${slackUsername ? '@' + slackUsername : (userId || 'unknown')}`;
      const oneOffId = await this.deps.agentManager.startOneOffAgent({
        projectId,
        message,
        label,
        permissionMode: 'acceptEdits',
        appendSystemPrompt: SLACK_AGENT_SYSTEM_PROMPT,
      });

      this.deps.threadTracker.registerOneOff(channelId, threadTs, oneOffId);
      this.logger.info('One-off agent started for thread', { projectId, oneOffId });
      this.subscribeOneOffToSlack({ oneOffId, projectId, channelId, threadTs, workingMsgTs: workingMsgTs || '', botToken });
    } catch (err) {
      const text = `❌ Failed to start agent: ${err instanceof Error ? err.message : String(err)}`;

      if (workingMsgTs) {
        await this.deps.slackService.updateMessage(botToken, channelId, workingMsgTs, text);
      } else {
        await this.deps.slackService.replyInThread(botToken, channelId, threadTs, text);
      }
    }
  }

  private async handleThreadReply(channelId: string, threadTs: string, text: string, _userId?: string): Promise<void> {
    const oneOffId = this.deps.threadTracker.findOneOffId(channelId, threadTs);

    if (oneOffId) {
      const meta = this.deps.agentManager.getOneOffMeta(oneOffId);

      if (meta) {
        this.deps.agentManager.sendOneOffInput(oneOffId, text);
        this.logger.info('Thread reply routed to one-off agent', { oneOffId, channelId });
        return;
      }
    }

    const projectId = this.deps.threadTracker.find(channelId, threadTs);

    if (!projectId) {
      this.logger.debug('Thread reply dropped: no tracked project for thread', { channelId, threadTs });
      return;
    }

    const botToken = await this.getBotToken();
    if (!botToken) return;

    const projects = await this.deps.projectRepository.findAll();
    const project = projects.find((p) => p.id === projectId);

    if (!project) {
      this.logger.debug('Thread reply dropped: project not found', { channelId, threadTs, projectId });
      return;
    }

    await this.startOneOffAgentForThread({ projectId, project, channelId, threadTs, message: text, botToken });
  }

  private subscribeOneOffToSlack(opts: OneOffSlackSub): void {
    const { oneOffId, channelId, threadTs, botToken } = opts;
    let pendingMsgTs = opts.workingMsgTs;
    let lastSentLength = 0;
    let done = false;

    const cleanup = (): void => {
      this.deps.agentManager.off('oneOffWaiting', onWaiting);
      this.deps.agentManager.off('oneOffStatus', onStatus);
    };

    const sendDelta = (output: string, fallback: string): void => {
      const raw = convertToMrkdwn(output.slice(lastSentLength).trim()) || fallback;
      lastSentLength = output.length;
      if (!raw) return;
      const ts = pendingMsgTs;
      pendingMsgTs = '';
      this.sendSlackDelta({ botToken, channelId, threadTs }, raw, ts).catch((err) => {
        this.logger.error('sendSlackDelta failed', { error: String(err) });
      });
    };

    const onWaiting = (id: string, isWaiting: boolean): void => {
      if (id !== oneOffId || !isWaiting) return;
      sendDelta(this.deps.agentManager.getOneOffCollectedOutput(oneOffId) || '', '');
    };

    const onStatus = (id: string, status: AgentStatus): void => {
      if (id !== oneOffId || done) return;
      if (status !== 'stopped' && status !== 'error') return;
      done = true;
      cleanup();
      sendDelta(this.deps.agentManager.getOneOffCollectedOutput(oneOffId) || '', '✅ Done.');
    };

    this.deps.agentManager.on('oneOffWaiting', onWaiting);
    this.deps.agentManager.on('oneOffStatus', onStatus);
  }

  private async sendSlackDelta(
    opts: { botToken: string; channelId: string; threadTs: string },
    text: string,
    workingMsgTs: string,
  ): Promise<void> {
    const { botToken, channelId, threadTs } = opts;
    const safe = text.length > 39000 ? text.slice(0, 39000) + '\n… (truncated)' : text;

    if (workingMsgTs) {
      await this.deps.slackService.updateMessage(botToken, channelId, workingMsgTs, safe);
    } else {
      await this.deps.slackService.replyInThread(botToken, channelId, threadTs, safe);
    }
  }

  private async handleInteractiveAction(body: InteractiveActionBody): Promise<void> {
    const action = body.actions?.[0];
    if (!action) return;

    const botToken = await this.getBotToken();
    if (!botToken) return;

    if (action.action_id.startsWith('select_project')) {
      const [projectId, channelId, threadTs] = (action.value || '').split('|');

      if (projectId && channelId && threadTs) {
        await this.handleProjectSelected(projectId, channelId, threadTs, body.user?.id, botToken);
      }

      return;
    }

    const parts = action.action_id.split(':');
    const actionType = parts[0];
    const projectId = parts[1];

    if (!actionType || !projectId) return;

    this.logger.info('Slack interactive action received', { actionType, projectId });

    switch (actionType) {
      case 'stop_agent':
        await this.handleInteractiveStop(botToken, projectId);
        break;
      case 'approve_plan':
        await this.handleInteractiveApprove(botToken, projectId);
        break;
      case 'reject_plan':
        await this.handleInteractiveReject(botToken, projectId);
        break;
    }
  }

  private async replyInProjectThread(botToken: string, projectId: string, text: string): Promise<void> {
    const latest = this.deps.threadTracker.getLatest(projectId);
    if (!latest) return;

    try {
      await this.deps.slackService.replyInThread(botToken, latest.channelId, latest.threadTs, text);
    } catch (err) {
      this.logger.error('Failed to reply in project thread', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleInteractiveStop(botToken: string, projectId: string): Promise<void> {
    await this.deps.agentManager.stopAgent(projectId);
    this.logger.info('Interactive: agent stopped', { projectId });
    await this.replyInProjectThread(botToken, projectId, '✅ Agent stopped.');
  }

  private async handleInteractiveApprove(botToken: string, projectId: string): Promise<void> {
    this.deps.agentManager.sendInput(projectId, 'yes');
    this.logger.info('Interactive: plan approved', { projectId });
    await this.replyInProjectThread(botToken, projectId, '✅ Plan approved.');
  }

  private async handleInteractiveReject(botToken: string, projectId: string): Promise<void> {
    this.deps.agentManager.sendInput(projectId, 'no');
    this.logger.info('Interactive: plan rejected', { projectId });
    await this.replyInProjectThread(botToken, projectId, '❌ Plan rejected.');
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createSlackCommandService(deps: SlackCommandServiceDeps): SlackCommandService {
  return new DefaultSlackCommandService(deps);
}
