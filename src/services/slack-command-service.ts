import { AgentManager } from '../agents';
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

// ============================================================================
// DefaultSlackCommandService
// ============================================================================

export class DefaultSlackCommandService implements SlackCommandService {
  private readonly deps: SlackCommandServiceDeps;
  private readonly logger: Logger;

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
      await this.handleMessageEvent(event);
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
      case 'link':
        await this.handleLink(botToken, body.channel_id, args);
        break;
      case 'unlink':
        await this.handleUnlink(botToken, body.channel_id);
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
    if (!nameOrId) {
      this.logger.warn('Start command: missing args', { channelId });
      await this.reply(botToken, channelId, '❌ Usage: `/claudito start <project-name> <prompt>`');
      return;
    }

    const prompt = promptParts.join(' ');
    if (!prompt) {
      this.logger.warn('Start command: missing args', { channelId });
      await this.reply(botToken, channelId, '❌ Usage: `/claudito start <project-name> <prompt>`');
      return;
    }

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

  private async handleLink(botToken: string, channelId: string, args: string[]): Promise<void> {
    const [nameOrId] = args;
    if (!nameOrId) {
      await this.reply(botToken, channelId, '❌ Usage: `/claudito link <project-name>`');
      return;
    }

    const projects = await this.deps.projectRepository.findAll();
    const project = findProject(projects, nameOrId);

    if (!project) {
      this.logger.warn('Link command: project not found', { nameOrId });
      await this.reply(botToken, channelId, `❌ Project not found: *${nameOrId}*`);
      return;
    }

    await this.deps.projectRepository.updateSlackLinkedChannel(project.id, channelId);
    this.logger.info('Link command: channel linked', { projectId: project.id, channelId });
    await this.reply(botToken, channelId, `✅ Channel linked to *${project.name}*. Project updates will be posted here.`);
  }

  private async handleUnlink(botToken: string, channelId: string): Promise<void> {
    const projects = await this.deps.projectRepository.findAll();
    const linked = projects.filter((p) => p.slackLinkedChannelId === channelId);

    if (!linked.length) {
      this.logger.warn('Unlink command: no project linked to channel', { channelId });
      await this.reply(botToken, channelId, '❌ No project is linked to this channel.');
      return;
    }

    await Promise.all(linked.map((p) => this.deps.projectRepository.updateSlackLinkedChannel(p.id, null)));
    const names = linked.map((p) => `*${p.name}*`).join(', ');
    this.logger.info('Unlink command: channel unlinked', { count: linked.length });
    await this.reply(botToken, channelId, `✅ Unlinked ${names} from this channel.`);
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
      await this.handleThreadReply(channelId, event.thread_ts, text);
      return;
    }

    await this.handleTopLevelMessage(channelId, text, event.ts, event.user);
  }

  private async getSlackUsername(userId: string): Promise<string | undefined> {
    const botToken = await this.getBotToken();
    if (!botToken) return undefined;
    return (await this.deps.slackService.getUserName(botToken, userId)) ?? undefined;
  }

  private async handleTopLevelMessage(channelId: string, text: string, eventTs?: string, userId?: string): Promise<void> {
    const projects = await this.deps.projectRepository.findAll();
    const project = projects.find((p) => p.slackLinkedChannelId === channelId);

    if (!project) {
      this.logger.debug('Message dropped: no project linked to channel', { channelId });
      return;
    }

    if (eventTs) {
      this.deps.threadTracker.register(project.id, channelId, eventTs);
      this.deps.threadTracker.setLatest(project.id, channelId, eventTs);
    }

    const slackUsername = userId ? await this.getSlackUsername(userId) : undefined;
    const slackMeta = { source: 'slack' as const, slackUsername };
    const isRunning = this.deps.agentManager.isRunning(project.id);

    if (isRunning) {
      this.deps.agentManager.sendInput(project.id, text, undefined, slackMeta);
      this.logger.info('Top-level message routed to running agent', { projectId: project.id });
      return;
    }

    try {
      await this.deps.agentManager.startInteractiveAgent(project.id, { initialMessage: text, slackMeta });
      this.logger.info('Top-level message: agent started', { projectId: project.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const botToken = await this.getBotToken();

      if (botToken && eventTs) {
        await this.deps.slackService.replyInThread(botToken, channelId, eventTs, `❌ Failed to start agent: ${message}`);
      }
    }
  }

  private async handleThreadReply(channelId: string, threadTs: string, text: string): Promise<void> {
    const projectId = this.deps.threadTracker.find(channelId, threadTs);

    if (!projectId) {
      this.logger.debug('Thread reply dropped: no tracked project for thread', { channelId, threadTs });
      return;
    }

    const botToken = await this.getBotToken();
    if (!botToken) return;

    if (this.deps.agentManager.isRunning(projectId)) {
      this.deps.agentManager.sendInput(projectId, text);
      this.logger.info('Thread reply routed to agent', { projectId, channelId });
      return;
    }

    await this.deps.slackService.replyInThread(botToken, channelId, threadTs, 'ℹ️ No agent is running for this project.');
  }

  private async handleInteractiveAction(body: InteractiveActionBody): Promise<void> {
    const action = body.actions?.[0];
    if (!action) return;

    const botToken = await this.getBotToken();
    if (!botToken) return;

    const channelId = body.channel?.id;
    const parts = action.action_id.split(':');
    const actionType = parts[0];
    const projectId = parts[1];

    if (!actionType || !projectId) return;

    this.logger.info('Slack interactive action received', { actionType, projectId });

    switch (actionType) {
      case 'stop_agent':
        await this.handleInteractiveStop(botToken, channelId, projectId);
        break;
      case 'approve_plan':
        await this.handleInteractiveApprove(botToken, channelId, projectId);
        break;
      case 'reject_plan':
        await this.handleInteractiveReject(botToken, channelId, projectId);
        break;
    }
  }

  private async handleInteractiveStop(botToken: string, channelId: string | undefined, projectId: string): Promise<void> {
    await this.deps.agentManager.stopAgent(projectId);
    this.logger.info('Interactive: agent stopped', { projectId });

    if (channelId) {
      await this.reply(botToken, channelId, `✅ Agent stopped.`);
    }
  }

  private async handleInteractiveApprove(botToken: string, channelId: string | undefined, projectId: string): Promise<void> {
    this.deps.agentManager.sendInput(projectId, 'yes');
    this.logger.info('Interactive: plan approved', { projectId });

    if (channelId) {
      await this.reply(botToken, channelId, `✅ Plan approved.`);
    }
  }

  private async handleInteractiveReject(botToken: string, channelId: string | undefined, projectId: string): Promise<void> {
    this.deps.agentManager.sendInput(projectId, 'no');
    this.logger.info('Interactive: plan rejected', { projectId });

    if (channelId) {
      await this.reply(botToken, channelId, `❌ Plan rejected.`);
    }
  }
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
      const ch = p.slackLinkedChannelId === currentChannelId ? 'this channel' : p.slackLinkedChannelId;
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
    '• `/claudito link <project>` — link this channel to a project',
    '• `/claudito unlink` — unlink this channel',
  ].join('\n');
}

function buildUnknownCommandText(subCommand: string): string {
  return `❓ Unknown command: \`${subCommand}\`\n\n${buildHelpText()}`;
}

// ============================================================================
// Factory
// ============================================================================

export function createSlackCommandService(deps: SlackCommandServiceDeps): SlackCommandService {
  return new DefaultSlackCommandService(deps);
}
